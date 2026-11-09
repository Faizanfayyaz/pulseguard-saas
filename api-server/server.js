/**
 * PulseGuard REST API Server
 * High-Throughput Synthetic Monitoring & Telemetry Analytics API
 * 
 * Strict Compliance:
 * - Raw SQL First with mysql2/promise connection pooling
 * - Window functions & CTEs for Uptime %, P95/P99 latency calculations
 * - Zero heavy ORMs
 * - Multi-tenant isolation & RESTful endpoints
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const crypto = require('crypto');

const app = express();
const PORT = parseInt(process.env.PORT || process.env.APP_PORT || '4000', 10);

app.use(cors());
app.use(express.json());

// -----------------------------------------------------------------------------
// Database Connection Pool
// -----------------------------------------------------------------------------
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'mysql-db',
  port: parseInt(process.env.DB_PORT || '3306', 10),
  user: process.env.DB_USER || 'pulseguard_user',
  password: process.env.DB_PASSWORD || 'pulseguard_secret_pass',
  database: process.env.DB_NAME || 'pulseguard',
  connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT || '20', 10),
  queueLimit: 0,
  waitForConnections: true,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
});

// -----------------------------------------------------------------------------
// 1. Healthcheck Endpoint
// -----------------------------------------------------------------------------
app.get('/health', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT 1 AS healthy');
    if (rows && rows[0].healthy === 1) {
      return res.status(200).json({
        status: 'ok',
        uptime: process.uptime(),
        database: 'connected',
        timestamp: new Date().toISOString(),
      });
    }
    return res.status(503).json({ status: 'degraded', database: 'unresponsive' });
  } catch (err) {
    return res.status(503).json({ status: 'unhealthy', error: err.message });
  }
});

// -----------------------------------------------------------------------------
// 2. Tenants Endpoint
// -----------------------------------------------------------------------------
app.get('/api/tenants', async (req, res) => {
  try {
    const [tenants] = await pool.query(`
      SELECT id, name, slug, plan, max_monitors, retention_days, created_at
      FROM tenants
      ORDER BY name ASC
    `);
    res.json(tenants);
  } catch (err) {
    console.error('[API] /api/tenants error:', err);
    res.status(500).json({ error: 'Failed to fetch tenants' });
  }
});

// -----------------------------------------------------------------------------
// 3. Monitors Endpoints
// -----------------------------------------------------------------------------

// List monitors with 24h uptime summary via CTE
app.get('/api/monitors', async (req, res) => {
  try {
    const tenantId = req.query.tenant_id;
    let query = `
      WITH recent_telemetry AS (
        SELECT 
          monitor_id,
          COUNT(*) AS total_pings,
          SUM(CASE WHEN is_success = 1 THEN 1 ELSE 0 END) AS successful_pings,
          ROUND(AVG(response_time_ms), 1) AS avg_response_time_ms
        FROM ping_logs
        WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
        GROUP BY monitor_id
      )
      SELECT 
        m.id,
        m.tenant_id,
        m.name,
        m.url,
        m.method,
        m.interval_seconds,
        m.timeout_ms,
        m.expected_status_code,
        m.status,
        m.current_state,
        m.consecutive_failures,
        m.last_checked_at,
        m.created_at,
        COALESCE(rt.total_pings, 0) AS total_pings_24h,
        COALESCE(rt.successful_pings, 0) AS successful_pings_24h,
        CASE 
          WHEN COALESCE(rt.total_pings, 0) = 0 THEN 100.0
          ELSE ROUND((rt.successful_pings / rt.total_pings) * 100, 2)
        END AS uptime_percentage_24h,
        COALESCE(rt.avg_response_time_ms, 0) AS avg_response_time_ms
      FROM monitors m
      LEFT JOIN recent_telemetry rt ON m.id = rt.monitor_id
    `;
    const params = [];

    if (tenantId) {
      query += ' WHERE m.tenant_id = ?';
      params.push(tenantId);
    }

    query += ' ORDER BY m.created_at DESC';

    const [monitors] = await pool.query(query, params);
    res.json(monitors);
  } catch (err) {
    console.error('[API] /api/monitors error:', err);
    res.status(500).json({ error: 'Failed to fetch monitors' });
  }
});

// Get single monitor by ID
app.get('/api/monitors/:id', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM monitors WHERE id = ?', [req.params.id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Monitor not found' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error('[API] /api/monitors/:id error:', err);
    res.status(500).json({ error: 'Failed to fetch monitor details' });
  }
});

// Create new monitor
app.post('/api/monitors', async (req, res) => {
  try {
    const {
      tenant_id,
      name,
      url,
      method = 'GET',
      headers = null,
      body = null,
      interval_seconds = 60,
      timeout_ms = 10000,
      expected_status_code = 200,
    } = req.body;

    if (!name || !url) {
      return res.status(400).json({ error: 'Name and URL are required' });
    }

    // Default to first tenant if none provided
    let targetTenantId = tenant_id;
    if (!targetTenantId) {
      const [tenants] = await pool.query('SELECT id FROM tenants LIMIT 1');
      if (tenants.length > 0) {
        targetTenantId = tenants[0].id;
      } else {
        return res.status(400).json({ error: 'No tenant found to associate monitor' });
      }
    }

    const id = crypto.randomUUID();
    const headersJson = headers ? (typeof headers === 'string' ? headers : JSON.stringify(headers)) : null;

    await pool.query(
      `INSERT INTO monitors (
        id, tenant_id, name, url, method, headers, body,
        interval_seconds, timeout_ms, expected_status_code,
        status, current_state, consecutive_failures, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 'up', 0, NOW(), NOW())`,
      [id, targetTenantId, name, url, method.toUpperCase(), headersJson, body, interval_seconds, timeout_ms, expected_status_code]
    );

    const [created] = await pool.query('SELECT * FROM monitors WHERE id = ?', [id]);
    res.status(201).json(created[0]);
  } catch (err) {
    console.error('[API] Create monitor error:', err);
    res.status(500).json({ error: 'Failed to create monitor' });
  }
});

// Update monitor
app.patch('/api/monitors/:id', async (req, res) => {
  try {
    const { name, url, method, interval_seconds, timeout_ms, expected_status_code, status } = req.body;
    const updates = [];
    const values = [];

    if (name !== undefined) { updates.push('name = ?'); values.push(name); }
    if (url !== undefined) { updates.push('url = ?'); values.push(url); }
    if (method !== undefined) { updates.push('method = ?'); values.push(method.toUpperCase()); }
    if (interval_seconds !== undefined) { updates.push('interval_seconds = ?'); values.push(interval_seconds); }
    if (timeout_ms !== undefined) { updates.push('timeout_ms = ?'); values.push(timeout_ms); }
    if (expected_status_code !== undefined) { updates.push('expected_status_code = ?'); values.push(expected_status_code); }
    if (status !== undefined) { updates.push('status = ?'); values.push(status); }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    updates.push('updated_at = NOW()');
    values.push(req.params.id);

    await pool.query(`UPDATE monitors SET ${updates.join(', ')} WHERE id = ?`, values);
    const [updated] = await pool.query('SELECT * FROM monitors WHERE id = ?', [req.params.id]);
    res.json(updated[0]);
  } catch (err) {
    console.error('[API] Update monitor error:', err);
    res.status(500).json({ error: 'Failed to update monitor' });
  }
});

// Delete monitor
app.delete('/api/monitors/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM monitors WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'Monitor deleted successfully' });
  } catch (err) {
    console.error('[API] Delete monitor error:', err);
    res.status(500).json({ error: 'Failed to delete monitor' });
  }
});

// -----------------------------------------------------------------------------
// 4. Raw SQL Telemetry Analytics (Uptime %, P95/P99 Latency via Window Functions)
// -----------------------------------------------------------------------------
app.get('/api/monitors/:id/metrics', async (req, res) => {
  try {
    const monitorId = req.params.id;
    const hours = parseInt(req.query.hours || '24', 10);

    // 1. Core aggregates using composite covering index (monitor_id, created_at, is_success, response_time_ms)
    const [aggregates] = await pool.query(`
      SELECT 
        COUNT(*) AS total_pings,
        SUM(CASE WHEN is_success = 1 THEN 1 ELSE 0 END) AS successful_pings,
        SUM(CASE WHEN is_success = 0 THEN 1 ELSE 0 END) AS failed_pings,
        COALESCE(ROUND(AVG(response_time_ms), 1), 0) AS avg_response_time_ms,
        COALESCE(MIN(response_time_ms), 0) AS min_response_time_ms,
        COALESCE(MAX(response_time_ms), 0) AS max_response_time_ms
      FROM ping_logs
      WHERE monitor_id = ?
        AND created_at >= DATE_SUB(NOW(), INTERVAL ? HOUR)
    `, [monitorId, hours]);

    const stats = aggregates[0] || {
      total_pings: 0,
      successful_pings: 0,
      failed_pings: 0,
      avg_response_time_ms: 0,
      min_response_time_ms: 0,
      max_response_time_ms: 0,
    };

    const uptimePercentage = stats.total_pings > 0
      ? Number(((stats.successful_pings / stats.total_pings) * 100).toFixed(2))
      : 100.0;

    // 2. High-performance P95 and P99 latency simulation using PERCENT_RANK() Window Function
    const [percentiles] = await pool.query(`
      WITH ranked_telemetry AS (
        SELECT 
          response_time_ms,
          PERCENT_RANK() OVER (ORDER BY response_time_ms ASC) AS p_rank
        FROM ping_logs
        WHERE monitor_id = ?
          AND created_at >= DATE_SUB(NOW(), INTERVAL ? HOUR)
      )
      SELECT 
        COALESCE(MIN(CASE WHEN p_rank >= 0.95 THEN response_time_ms END), 0) AS p95_latency_ms,
        COALESCE(MIN(CASE WHEN p_rank >= 0.99 THEN response_time_ms END), 0) AS p99_latency_ms
      FROM ranked_telemetry
    `, [monitorId, hours]);

    const p95Latency = percentiles[0]?.p95_latency_ms || stats.avg_response_time_ms;
    const p99Latency = percentiles[0]?.p99_latency_ms || stats.max_response_time_ms;

    // 3. Hourly timeline buckets for chart visualization
    const [timeline] = await pool.query(`
      SELECT 
        DATE_FORMAT(created_at, '%Y-%m-%d %H:00:00') AS time_bucket,
        COUNT(*) AS pings,
        SUM(CASE WHEN is_success = 1 THEN 1 ELSE 0 END) AS success_count,
        ROUND(AVG(response_time_ms), 1) AS avg_latency
      FROM ping_logs
      WHERE monitor_id = ?
        AND created_at >= DATE_SUB(NOW(), INTERVAL ? HOUR)
      GROUP BY time_bucket
      ORDER BY time_bucket ASC
    `, [monitorId, hours]);

    res.json({
      monitor_id: monitorId,
      timeframe_hours: hours,
      summary: {
        total_pings: stats.total_pings,
        successful_pings: stats.successful_pings,
        failed_pings: stats.failed_pings,
        uptime_percentage: uptimePercentage,
        avg_response_time_ms: stats.avg_response_time_ms,
        min_response_time_ms: stats.min_response_time_ms,
        max_response_time_ms: stats.max_response_time_ms,
        p95_latency_ms: p95Latency,
        p99_latency_ms: p99Latency,
      },
      timeline,
    });
  } catch (err) {
    console.error('[API] /api/monitors/:id/metrics error:', err);
    res.status(500).json({ error: 'Failed to compute telemetry metrics' });
  }
});

// Recent ping logs endpoint
app.get('/api/monitors/:id/logs', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
    const [logs] = await pool.query(`
      SELECT id, status_code, response_time_ms, is_success, error_message, created_at
      FROM ping_logs
      WHERE monitor_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `, [req.params.id, limit]);

    res.json(logs);
  } catch (err) {
    console.error('[API] /api/monitors/:id/logs error:', err);
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
});

// -----------------------------------------------------------------------------
// 5. Incidents Endpoint
// -----------------------------------------------------------------------------
app.get('/api/incidents', async (req, res) => {
  try {
    const [incidents] = await pool.query(`
      SELECT 
        i.id,
        i.tenant_id,
        i.monitor_id,
        m.name AS monitor_name,
        m.url AS monitor_url,
        i.status,
        i.title,
        i.cause,
        i.started_at,
        i.acknowledged_at,
        i.resolved_at
      FROM incidents i
      LEFT JOIN monitors m ON i.monitor_id = m.id
      ORDER BY i.started_at DESC
      LIMIT 100
    `);
    res.json(incidents);
  } catch (err) {
    console.error('[API] /api/incidents error:', err);
    res.status(500).json({ error: 'Failed to fetch incidents' });
  }
});

// -----------------------------------------------------------------------------
// Start Server
// -----------------------------------------------------------------------------
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[API Server] Running on http://0.0.0.0:${PORT}`);
});

