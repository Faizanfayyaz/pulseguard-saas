-- ============================================================================
-- PulseGuard Multi-Tenant SaaS - Initial Seed Data
-- ============================================================================

USE `pulseguard`;

-- Disable foreign key checks for clean atomic population
SET FOREIGN_KEY_CHECKS = 0;

-- Clean existing seed data if re-running
DELETE FROM `ping_logs`;
DELETE FROM `incidents`;
DELETE FROM `alert_channels`;
DELETE FROM `monitors`;
DELETE FROM `users`;
DELETE FROM `tenants`;

SET FOREIGN_KEY_CHECKS = 1;

-- ----------------------------------------------------------------------------
-- 1. Tenants
-- ----------------------------------------------------------------------------
INSERT INTO `tenants` (`id`, `name`, `slug`, `api_key`, `plan`, `max_monitors`, `retention_days`)
VALUES
  (
    '00000000-0000-0000-0000-000000000001',
    'Acme Technologies',
    'acme-tech',
    'pg_live_acme_8f9a2b4c6e1d3f5a7b9c0e2d4f6a8b1c',
    'enterprise',
    100,
    90
  ),
  (
    '00000000-0000-0000-0000-000000000002',
    'Starlight Labs',
    'starlight-labs',
    'pg_live_star_1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d',
    'pro',
    25,
    30
  );

-- ----------------------------------------------------------------------------
-- 2. Users (Bcrypt hash for 'Password123!')
-- Hash: $2b$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQmG6W5650h57CeuE228C
-- ----------------------------------------------------------------------------
INSERT INTO `users` (`id`, `tenant_id`, `email`, `name`, `password_hash`, `role`)
VALUES
  (
    '10000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    'alex@acme.com',
    'Alex Rivera',
    '$2b$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQmG6W5650h57CeuE228C',
    'owner'
  ),
  (
    '10000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000001',
    'devops@acme.com',
    'Jordan Lee',
    '$2b$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQmG6W5650h57CeuE228C',
    'admin'
  ),
  (
    '10000000-0000-0000-0000-000000000003',
    '00000000-0000-0000-0000-000000000002',
    'sara@starlight.io',
    'Sara Chen',
    '$2b$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQmG6W5650h57CeuE228C',
    'owner'
  );

-- ----------------------------------------------------------------------------
-- 3. Synthetic Monitors
-- ----------------------------------------------------------------------------
INSERT INTO `monitors` (`id`, `tenant_id`, `name`, `url`, `method`, `interval_seconds`, `timeout_ms`, `expected_status_code`, `status`, `current_state`, `last_checked_at`)
VALUES
  (
    '20000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    'Production API Gateway',
    'https://httpbin.org/status/200',
    'GET',
    30,
    5000,
    200,
    'active',
    'up',
    '2026-11-02 21:00:00'
  ),
  (
    '20000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000001',
    'Auth Service Identity Provider',
    'https://httpbin.org/delay/1',
    'GET',
    60,
    10000,
    200,
    'active',
    'up',
    '2026-11-02 21:00:00'
  ),
  (
    '20000000-0000-0000-0000-000000000003',
    '00000000-0000-0000-0000-000000000001',
    'Legacy Billing Webhook',
    'https://httpbin.org/status/503',
    'POST',
    120,
    8000,
    200,
    'active',
    'down',
    '2026-11-02 21:00:00'
  ),
  (
    '20000000-0000-0000-0000-000000000004',
    '00000000-0000-0000-0000-000000000002',
    'Starlight Landing Page',
    'https://httpbin.org/html',
    'GET',
    60,
    5000,
    200,
    'active',
    'up',
    '2026-11-02 21:00:00'
  );

-- ----------------------------------------------------------------------------
-- 4. Alert Channels
-- ----------------------------------------------------------------------------
INSERT INTO `alert_channels` (`id`, `tenant_id`, `name`, `type`, `config`, `is_active`)
VALUES
  (
    '30000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    'DevOps Slack Channel',
    'slack',
    '{"webhook_url": "https://hooks.slack.com/services/T00/B00/XXXXX", "channel": "#alerts-prod"}',
    1
  ),
  (
    '30000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000001',
    'On-Call PagerDuty',
    'pagerduty',
    '{"routing_key": "pd_routing_key_mock_12345", "severity": "error"}',
    1
  );

-- ----------------------------------------------------------------------------
-- 5. Incidents
-- ----------------------------------------------------------------------------
INSERT INTO `incidents` (`id`, `tenant_id`, `monitor_id`, `status`, `title`, `cause`, `started_at`, `resolved_at`)
VALUES
  (
    '40000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000003',
    'investigating',
    'Legacy Billing Webhook returned HTTP 503',
    'Upstream billing service unavailable during maintenance window.',
    '2026-11-02 20:30:00',
    NULL
  );

-- ----------------------------------------------------------------------------
-- 6. Telemetry Seed Data (ping_logs)
-- Seeded into p_2026_q4 partition (created_at = 2026-11-02)
-- ----------------------------------------------------------------------------
INSERT INTO `ping_logs` (`tenant_id`, `monitor_id`, `status_code`, `response_time_ms`, `is_success`, `error_message`, `dns_lookup_ms`, `tcp_connect_ms`, `tls_handshake_ms`, `created_at`)
VALUES
  -- Monitor 1: Production API Gateway (healthy series)
  ('00000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 200, 45,  1, NULL, 5,  10, 15, '2026-11-02 20:45:00'),
  ('00000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 200, 52,  1, NULL, 4,  11, 14, '2026-11-02 20:46:00'),
  ('00000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 200, 48,  1, NULL, 4,  9,  16, '2026-11-02 20:47:00'),
  ('00000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 200, 61,  1, NULL, 6,  12, 18, '2026-11-02 20:48:00'),
  ('00000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 200, 43,  1, NULL, 4,  8,  14, '2026-11-02 20:49:00'),
  ('00000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 200, 110, 1, NULL, 8,  20, 25, '2026-11-02 20:50:00'),
  
  -- Monitor 2: Auth Service (higher latency series)
  ('00000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 200, 1020, 1, NULL, 8,  15, 22, '2026-11-02 20:45:00'),
  ('00000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 200, 980,  1, NULL, 7,  14, 20, '2026-11-02 20:47:00'),
  ('00000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 200, 1050, 1, NULL, 9,  16, 23, '2026-11-02 20:49:00'),

  -- Monitor 3: Legacy Billing Webhook (failures series)
  ('00000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000003', 503, 310,  0, 'HTTP 503: Service Unavailable', 10, 25, 30, '2026-11-02 20:45:00'),
  ('00000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000003', 503, 290,  0, 'HTTP 503: Service Unavailable', 8,  22, 28, '2026-11-02 20:47:00'),
  ('00000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000003', 503, 305,  0, 'HTTP 503: Service Unavailable', 9,  24, 29, '2026-11-02 20:49:00'),

  -- Monitor 4: Starlight Landing Page
  ('00000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000004', 200, 120,  1, NULL, 12, 18, 25, '2026-11-02 20:50:00');

