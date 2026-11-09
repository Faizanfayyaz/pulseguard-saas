-- ============================================================================
-- PulseGuard Multi-Tenant SaaS - Database Initialization (DDL)
-- Target: MySQL 8.0+
-- Strict Compliance: Raw SQL First, Composite Covering Indexes, Partitioning
-- ============================================================================

CREATE DATABASE IF NOT EXISTS `pulseguard`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE `pulseguard`;

-- ----------------------------------------------------------------------------
-- 1. Tenants (Organizations / Multi-tenant isolation)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `tenants` (
  `id` CHAR(36) NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `slug` VARCHAR(100) NOT NULL,
  `api_key` VARCHAR(64) NOT NULL,
  `plan` ENUM('free', 'pro', 'enterprise') NOT NULL DEFAULT 'free',
  `max_monitors` INT NOT NULL DEFAULT 10,
  `retention_days` INT NOT NULL DEFAULT 30,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tenants_slug` (`slug`),
  UNIQUE KEY `uq_tenants_api_key` (`api_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 2. Users (Tenant Members & Administrators)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `users` (
  `id` CHAR(36) NOT NULL,
  `tenant_id` CHAR(36) NOT NULL,
  `email` VARCHAR(255) NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `password_hash` VARCHAR(255) NOT NULL,
  `role` ENUM('owner', 'admin', 'member') NOT NULL DEFAULT 'member',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_users_tenant_email` (`tenant_id`, `email`),
  CONSTRAINT `fk_users_tenant` FOREIGN KEY (`tenant_id`)
    REFERENCES `tenants` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 3. Monitors (Synthetic Health & Uptime Endpoints)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `monitors` (
  `id` CHAR(36) NOT NULL,
  `tenant_id` CHAR(36) NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `url` VARCHAR(2048) NOT NULL,
  `method` ENUM('GET', 'POST', 'HEAD', 'PUT', 'PATCH') NOT NULL DEFAULT 'GET',
  `headers` JSON NULL,
  `body` TEXT NULL,
  `interval_seconds` INT NOT NULL DEFAULT 60,
  `timeout_ms` INT NOT NULL DEFAULT 10000,
  `expected_status_code` INT NOT NULL DEFAULT 200,
  `status` ENUM('active', 'paused', 'pending') NOT NULL DEFAULT 'active',
  `current_state` ENUM('up', 'down', 'degraded') NOT NULL DEFAULT 'up',
  `consecutive_failures` INT NOT NULL DEFAULT 0,
  `last_checked_at` TIMESTAMP NULL DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  -- Multi-tenant query covering index
  KEY `idx_monitors_tenant_state` (`tenant_id`, `current_state`, `status`),
  -- Distributed worker scheduling index (with row-level lock support)
  KEY `idx_monitors_scheduler` (`status`, `last_checked_at`),
  CONSTRAINT `fk_monitors_tenant` FOREIGN KEY (`tenant_id`)
    REFERENCES `tenants` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 4. Incidents (Downtime / Outage Tracking)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `incidents` (
  `id` CHAR(36) NOT NULL,
  `tenant_id` CHAR(36) NOT NULL,
  `monitor_id` CHAR(36) NOT NULL,
  `status` ENUM('investigating', 'identified', 'monitoring', 'resolved') NOT NULL DEFAULT 'investigating',
  `title` VARCHAR(255) NOT NULL,
  `cause` TEXT NULL,
  `started_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `acknowledged_at` TIMESTAMP NULL DEFAULT NULL,
  `resolved_at` TIMESTAMP NULL DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_incidents_tenant_monitor` (`tenant_id`, `monitor_id`, `status`),
  KEY `idx_incidents_timeline` (`tenant_id`, `started_at` DESC),
  CONSTRAINT `fk_incidents_tenant` FOREIGN KEY (`tenant_id`)
    REFERENCES `tenants` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_incidents_monitor` FOREIGN KEY (`monitor_id`)
    REFERENCES `monitors` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 5. Alert Channels (Notification Integrations)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `alert_channels` (
  `id` CHAR(36) NOT NULL,
  `tenant_id` CHAR(36) NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  `type` ENUM('email', 'slack', 'webhook', 'pagerduty') NOT NULL,
  `config` JSON NOT NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_alert_channels_tenant` (`tenant_id`, `is_active`),
  CONSTRAINT `fk_alert_channels_tenant` FOREIGN KEY (`tenant_id`)
    REFERENCES `tenants` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 6. Telemetry Writes: Ping Logs
-- High throughput batch writes & Range Partitioning by created_at.
-- Primary key composite includes partition key. No FKs on partitioned tables.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `ping_logs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id` CHAR(36) NOT NULL,
  `monitor_id` CHAR(36) NOT NULL,
  `status_code` SMALLINT UNSIGNED NULL,
  `response_time_ms` INT UNSIGNED NOT NULL,
  `is_success` TINYINT(1) NOT NULL DEFAULT 1,
  `error_message` VARCHAR(512) NULL,
  `dns_lookup_ms` INT UNSIGNED NULL DEFAULT 0,
  `tcp_connect_ms` INT UNSIGNED NULL DEFAULT 0,
  `tls_handshake_ms` INT UNSIGNED NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`, `created_at`),
  -- Critical Composite Covering Index: enables zero-table-lookup reads for
  -- Uptime %, P95/P99 latency CTEs, and timeline aggregations
  KEY `idx_covering_telemetry` (`monitor_id`, `created_at`, `is_success`, `response_time_ms`),
  -- Multi-tenant aggregation index
  KEY `idx_telemetry_tenant_time` (`tenant_id`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
PARTITION BY RANGE COLUMNS(`created_at`) (
  PARTITION p_2026_q1 VALUES LESS THAN ('2026-04-01 00:00:00'),
  PARTITION p_2026_q2 VALUES LESS THAN ('2026-07-01 00:00:00'),
  PARTITION p_2026_q3 VALUES LESS THAN ('2026-10-01 00:00:00'),
  PARTITION p_2026_q4 VALUES LESS THAN ('2027-01-01 00:00:00'),
  PARTITION p_2027_q1 VALUES LESS THAN ('2027-04-01 00:00:00'),
  PARTITION p_2027_q2 VALUES LESS THAN ('2027-07-01 00:00:00'),
  PARTITION p_future  VALUES LESS THAN (MAXVALUE)
);

