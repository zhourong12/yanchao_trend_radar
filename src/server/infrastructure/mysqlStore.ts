import mysql, { type Pool } from "mysql2/promise";

let pool: Pool | null = null;
let initialized: Promise<void> | null = null;

export function isMysqlConfigured() {
  return Boolean(process.env.MYSQL_URL || process.env.MYSQL_HOST);
}

export function mysqlPool() {
  if (pool) return pool;
  if (!isMysqlConfigured()) throw new Error("MySQL is not configured");
  pool = process.env.MYSQL_URL
    ? mysql.createPool(process.env.MYSQL_URL)
    : mysql.createPool({
        host: process.env.MYSQL_HOST,
        port: Number(process.env.MYSQL_PORT ?? 3306),
        user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE ?? "trend_radar",
        connectionLimit: 8,
        enableKeepAlive: true,
        charset: "utf8mb4"
      });
  return pool;
}

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS source_connections (
    source_id VARCHAR(80) NOT NULL PRIMARY KEY,
    label VARCHAR(120) NOT NULL,
    status ENUM('unconfigured','ready','degraded','disabled') NOT NULL DEFAULT 'unconfigured',
    config_json JSON NULL,
    last_checked_at DATETIME(3) NULL,
    last_success_at DATETIME(3) NULL,
    last_error VARCHAR(1000) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS integration_credentials (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    provider VARCHAR(40) NOT NULL,
    account_scope VARCHAR(80) NOT NULL DEFAULT 'default',
    app_key_hash CHAR(64) NOT NULL,
    encrypted_payload JSON NOT NULL,
    status ENUM('pending','authorized','expired','revoked','error') NOT NULL DEFAULT 'pending',
    access_expires_at DATETIME(3) NULL,
    refresh_expires_at DATETIME(3) NULL,
    owner_label VARCHAR(160) NULL,
    last_error VARCHAR(1000) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    UNIQUE KEY uq_integration_account (provider, account_scope, app_key_hash)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS collection_runs (
    id CHAR(36) NOT NULL PRIMARY KEY,
    trigger_type ENUM('scheduled','manual','test') NOT NULL,
    status ENUM('running','succeeded','partial','failed') NOT NULL,
    started_at DATETIME(3) NOT NULL,
    completed_at DATETIME(3) NULL,
    raw_count INT UNSIGNED NOT NULL DEFAULT 0,
    mapped_count INT UNSIGNED NOT NULL DEFAULT 0,
    error_count INT UNSIGNED NOT NULL DEFAULT 0,
    summary_json JSON NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS collection_records (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    run_id CHAR(36) NULL,
    collection_date DATE NOT NULL,
    channel VARCHAR(80) NOT NULL,
    external_id VARCHAR(191) NOT NULL,
    platform VARCHAR(80) NOT NULL,
    market VARCHAR(16) NULL,
    title VARCHAR(500) NOT NULL,
    collected_at DATETIME(3) NOT NULL,
    observed_at DATETIME(3) NULL,
    metric_label VARCHAR(80) NULL,
    metric_value DECIMAL(20,6) NULL,
    rank_value INT NULL,
    source_url VARCHAR(1500) NULL,
    outcome ENUM('mapped','filtered','validation','demo') NOT NULL,
    entered_analysis TINYINT(1) NOT NULL,
    mapped_keyword VARCHAR(191) NULL,
    category VARCHAR(120) NULL,
    mapping_confidence DECIMAL(8,6) NULL,
    reason VARCHAR(1000) NOT NULL,
    origin ENUM('live','seed') NOT NULL,
    extension_json JSON NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    UNIQUE KEY uq_collection_record (collection_date, channel, external_id),
    KEY idx_collection_channel_date (channel, collection_date),
    KEY idx_collection_market_date (market, collection_date),
    CONSTRAINT fk_collection_run FOREIGN KEY (run_id) REFERENCES collection_runs(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS opportunities (
    id VARCHAR(191) NOT NULL PRIMARY KEY,
    origin ENUM('manual','discovered') NOT NULL,
    product_name VARCHAR(240) NOT NULL,
    market VARCHAR(16) NOT NULL,
    category VARCHAR(120) NOT NULL,
    event_name VARCHAR(240) NOT NULL,
    demand VARCHAR(500) NOT NULL,
    reason VARCHAR(1000) NOT NULL,
    time_window VARCHAR(120) NULL,
    next_action VARCHAR(1000) NULL,
    snapshot_json JSON NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    KEY idx_opportunity_market (market, updated_at),
    KEY idx_opportunity_category (category, updated_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS opportunity_feedback (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    opportunity_id VARCHAR(191) NOT NULL,
    action ENUM('useful','not_useful','follow_up','verifying','sampling','listed','rejected') NOT NULL,
    note VARCHAR(500) NULL,
    owner VARCHAR(80) NULL,
    due_date DATE NULL,
    evidence_url VARCHAR(1500) NULL,
    outcome_json JSON NULL,
    created_at DATETIME(3) NOT NULL,
    KEY idx_feedback_opportunity (opportunity_id, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS opportunity_validations (
    opportunity_id VARCHAR(191) NOT NULL PRIMARY KEY,
    supply_status ENUM('pending','in_progress','verified','blocked') NOT NULL DEFAULT 'pending',
    sales_status ENUM('pending','in_progress','verified','blocked') NOT NULL DEFAULT 'pending',
    last_note VARCHAR(500) NULL,
    last_evidence_url VARCHAR(1500) NULL,
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
];

export function initializeMysqlStore() {
  if (!isMysqlConfigured()) return Promise.resolve();
  if (!initialized) {
    initialized = (async () => {
      for (const statement of schemaStatements) await mysqlPool().query(statement);
    })();
  }
  return initialized;
}

export async function checkMysqlStore() {
  await initializeMysqlStore();
  await mysqlPool().query("SELECT 1");
  return { ok: true, driver: "mysql" as const, database: process.env.MYSQL_DATABASE ?? "trend_radar" };
}
