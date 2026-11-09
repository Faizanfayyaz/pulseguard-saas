/**
 * PulseGuard Synthetic Ping Worker
 * High-Throughput Background Monitoring Engine
 * 
 * Strict Compliance:
 * - mysql2/promise connection pooling
 * - ACID transactions with SELECT ... FOR UPDATE SKIP LOCKED
 * - Batch inserts into partitioned ping_logs
 * - Resilient Axios ping execution with timeout handling
 * - Monitor state & consecutive failure updates
 * - Graceful shutdown and container heartbeat checks
 */

require('dotenv').config();
const mysql = require('mysql2/promise');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// -----------------------------------------------------------------------------
// Configuration
// -----------------------------------------------------------------------------
const CONFIG = {
  db: {
    host: process.env.DB_HOST || 'mysql-db',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'pulseguard_user',
    password: process.env.DB_PASSWORD || 'pulseguard_secret_pass',
    database: process.env.DB_NAME || 'pulseguard',
    connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT || '10', 10),
    queueLimit: 0,
    waitForConnections: true,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
  },
  worker: {
    pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS || '3000', 10),
    batchSize: parseInt(process.env.WORKER_BATCH_SIZE || '25', 10),
    defaultTimeoutMs: 10000,
    consecutiveFailureThreshold: 3,
    heartbeatPath: process.env.HEARTBEAT_PATH || '/tmp/pulseguard/heartbeat',
  },
};

// -----------------------------------------------------------------------------
// Global State & Lifecycle
// -----------------------------------------------------------------------------
let pool = null;
let isShuttingDown = false;
let isProcessingTick = false;

/**
 * Update container healthcheck heartbeat file
 */
function updateHeartbeat() {
  try {
    const dir = path.dirname(CONFIG.worker.heartbeatPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(CONFIG.worker.heartbeatPath, Date.now().toString(), 'utf8');
  } catch (err) {
    // Non-fatal logging if heartbeat write fails in dev environments
    // console.warn('[Worker] Failed to write heartbeat file:', err.message);
  }
}

/**
 * Initialize MySQL Connection Pool with retry on startup
 */
async function initDatabasePool(retries = 10, delayMs = 3000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`[Worker] Connecting to MySQL at ${CONFIG.db.host}:${CONFIG.db.port} (Attempt ${attempt}/${retries})...`);
      pool = mysql.createPool(CONFIG.db);
      
      // Test connectivity
      const [rows] = await pool.query('SELECT 1 AS alive');
      if (rows && rows[0].alive === 1) {
        console.log('[Worker] Connected to database successfully.');
        return pool;
      }
    } catch (err) {
      console.error(`[Worker] DB connection error: ${err.message}`);
      if (attempt === retries) throw err;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

/**
 * Execute a single HTTP/HTTPS ping against a monitor
 * @param {Object} monitor
 * @returns {Promise<Object>} Ping result metrics
 */
async function pingEndpoint(monitor) {
  const startTime = process.hrtime.bigint();
  const timeoutMs = monitor.timeout_ms || CONFIG.worker.defaultTimeoutMs;
  const method = (monitor.method || 'GET').toUpperCase();
  const expectedStatus = monitor.expected_status_code || 200;

  let headers = {
    'User-Agent': 'PulseGuard-Synthetic-Monitor/1.0 (+https://pulseguard.dev)',
    Accept: '*/*',
  };

  if (monitor.headers) {
    try {
      const parsed = typeof monitor.headers === 'string' ? JSON.parse(monitor.headers) : monitor.headers;
      headers = { ...headers, ...parsed };
    } catch (e) {
      // Ignore header parsing errors
    }
  }

  let statusCode = null;
  let isSuccess = 0;
  let errorMessage = null;

  try {
    const response = await axios({
      url: monitor.url,
      method: method,
      headers: headers,
      data: monitor.body || undefined,
      timeout: timeoutMs,
      maxRedirects: 5,
      validateStatus: () => true, // Don't throw on non-2xx status
    });

    statusCode = response.status;
    isSuccess = (statusCode === expectedStatus) ? 1 : 0;
    if (!isSuccess) {
      errorMessage = `HTTP ${statusCode} (Expected: ${expectedStatus})`;
    }
  } catch (error) {
    if (error.response) {
      statusCode = error.response.status;
      isSuccess = (statusCode === expectedStatus) ? 1 : 0;
      errorMessage = `HTTP ${statusCode} (Expected: ${expectedStatus})`;
    } else if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
      statusCode = 408;
      errorMessage = `Request timed out after ${timeoutMs}ms`;
    } else {
      errorMessage = error.code ? `${error.code}: ${error.message}` : error.message;
    }
  }

  const endTime = process.hrtime.bigint();
  const durationMs = Number((endTime - startTime) / 1000000n);

  return {
    tenantId: monitor.tenant_id,
    monitorId: monitor.id,
    statusCode: statusCode,
    responseTimeMs: Math.max(1, durationMs),
    isSuccess: isSuccess,
    errorMessage: errorMessage ? errorMessage.substring(0, 500) : null,
    dnsLookupMs: 0,
    tcpConnectMs: 0,
    tlsHandshakeMs: 0,
    createdAt: new Date(),
    monitor,
  };
}

/**
 * Core Polling Tick:
 * 1. ACID Transaction: Fetch & Lock due monitors (SELECT ... FOR UPDATE SKIP LOCKED)
 * 2. Update last_checked_at immediately within transaction to release locks safely
 * 3. Ping endpoints concurrently
 * 4. Batch insert telemetry logs into ping_logs
 * 5. Update monitor statuses, consecutive failures, and incidents
 */
async function processDueMonitors() {
  if (isShuttingDown || isProcessingTick) return;
  isProcessingTick = true;

  let connection = null;
  let claimedMonitors = [];

  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    // Row-level locking with SKIP LOCKED for high-throughput distributed workers
    const [monitors] = await connection.query(
      `SELECT 
         id, tenant_id, name, url, method, headers, body, 
         interval_seconds, timeout_ms, expected_status_code, 
         status, current_state, consecutive_failures, last_checked_at
       FROM monitors
       WHERE status = 'active'
         AND (last_checked_at IS NULL OR last_checked_at <= DATE_SUB(NOW(), INTERVAL interval_seconds SECOND))
       ORDER BY last_checked_at ASC
       LIMIT ?
       FOR UPDATE SKIP LOCKED`,
      [CONFIG.worker.batchSize]
    );

    if (monitors.length > 0) {
      claimedMonitors = monitors;
      const monitorIds = monitors.map((m) => m.id);

      // Immediately timestamp claim so subsequent worker ticks don't re-select
      await connection.query(
        'UPDATE monitors SET last_checked_at = NOW() WHERE id IN (?)',
        [monitorIds]
      );
    }

    await connection.commit();
  } catch (err) {
    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackErr) {
        // Ignore rollback failure
      }
    }
    console.error('[Worker] Error claiming due monitors:', err.message);
    claimedMonitors = [];
  } finally {
    if (connection) connection.release();
  }

  // If no monitors are due, touch heartbeat and finish tick
  if (claimedMonitors.length === 0) {
    updateHeartbeat();
    isProcessingTick = false;
    return;
  }

  console.log(`[Worker] Claimed ${claimedMonitors.length} due monitors for pinging...`);

  // Execute synthetic pings concurrently
  const pingResults = await Promise.all(claimedMonitors.map((m) => pingEndpoint(m)));

  // Batch insert telemetry writes into partitioned ping_logs
  try {
    const batchValues = pingResults.map((r) => [
      r.tenantId,
      r.monitorId,
      r.statusCode,
      r.responseTimeMs,
      r.isSuccess,
      r.errorMessage,
      r.dnsLookupMs,
      r.tcpConnectMs,
      r.tlsHandshakeMs,
      r.createdAt,
    ]);

    await pool.query(
      `INSERT INTO ping_logs (
         tenant_id, monitor_id, status_code, response_time_ms,
         is_success, error_message, dns_lookup_ms, tcp_connect_ms, tls_handshake_ms, created_at
       ) VALUES ?`,
      [batchValues]
    );

    console.log(`[Worker] Telemetry batch written: ${batchValues.length} rows inserted into ping_logs.`);
  } catch (err) {
    console.error('[Worker] Failed to write batch telemetry into ping_logs:', err.message);
  }

  // Update monitors state, consecutive failures, and incident life-cycle
  for (const result of pingResults) {
    const monitor = result.monitor;
    const isSuccess = result.isSuccess === 1;

    try {
      if (isSuccess) {
        const nextState = 'up';
        const consecutiveFailures = 0;

        await pool.query(
          `UPDATE monitors
           SET current_state = ?, consecutive_failures = ?, updated_at = NOW()
           WHERE id = ?`,
          [nextState, consecutiveFailures, monitor.id]
        );

        // Auto-resolve any active incident for this monitor
        await pool.query(
          `UPDATE incidents
           SET status = 'resolved', resolved_at = NOW(), updated_at = NOW()
           WHERE monitor_id = ? AND status != 'resolved'`,
          [monitor.id]
        );
      } else {
        const nextFailures = (monitor.consecutive_failures || 0) + 1;
        const nextState = nextFailures >= CONFIG.worker.consecutiveFailureThreshold ? 'down' : 'degraded';

        await pool.query(
          `UPDATE monitors
           SET current_state = ?, consecutive_failures = ?, updated_at = NOW()
           WHERE id = ?`,
          [nextState, nextFailures, monitor.id]
        );

        // If threshold exceeded, open an incident if one isn't already active
        if (nextFailures >= CONFIG.worker.consecutiveFailureThreshold) {
          const incidentId = crypto.randomUUID();
          const title = `Synthetic check failure: ${monitor.name}`;
          const cause = result.errorMessage || 'Unknown endpoint outage';

          await pool.query(
            `INSERT INTO incidents (id, tenant_id, monitor_id, status, title, cause, started_at)
             SELECT ?, ?, ?, 'investigating', ?, ?, NOW()
             WHERE NOT EXISTS (
               SELECT 1 FROM incidents 
               WHERE monitor_id = ? AND status IN ('investigating', 'identified', 'monitoring')
             )`,
            [incidentId, monitor.tenant_id, monitor.id, title, cause, monitor.id]
          );
        }
      }
    } catch (err) {
      console.error(`[Worker] Error updating state for monitor ${monitor.id}:`, err.message);
    }
  }

  updateHeartbeat();
  isProcessingTick = false;
}

/**
 * Main Worker Loop
 */
async function startWorker() {
  console.log('================================================================');
  console.log('        PulseGuard Synthetic Ping Worker Starting               ');
  console.log('================================================================');

  await initDatabasePool();
  updateHeartbeat();

  // Run first cycle immediately
  await processDueMonitors();

  // Schedule interval loop
  const intervalHandle = setInterval(async () => {
    if (!isShuttingDown) {
      await processDueMonitors();
    }
  }, CONFIG.worker.pollIntervalMs);

  // Graceful shutdown handlers
  const shutdown = async (signal) => {
    if (isShuttingDown) return;
    console.log(`\n[Worker] Received ${signal}. Initiating graceful shutdown...`);
    isShuttingDown = true;
    clearInterval(intervalHandle);

    // Wait up to 5s for in-flight tick to finish
    let waitCount = 0;
    while (isProcessingTick && waitCount < 10) {
      await new Promise((r) => setTimeout(r, 500));
      waitCount++;
    }

    if (pool) {
      console.log('[Worker] Closing database connection pool...');
      await pool.end();
    }

    console.log('[Worker] Shutdown complete. Exiting.');
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

// Global unhandled error handlers
process.on('uncaughtException', (err) => {
  console.error('[Worker] Fatal Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[Worker] Unhandled Promise Rejection:', reason);
});

startWorker();

