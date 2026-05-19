-- ============================================================
-- PHASE 5 — Admin Settings & Audit Log Migration
-- Run AFTER analytics-schema.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS system_settings (
  id          BIGSERIAL PRIMARY KEY,
  category    TEXT        NOT NULL,
  key         TEXT        NOT NULL UNIQUE,
  value       JSONB       NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by  TEXT        NOT NULL DEFAULT 'system'
);

CREATE INDEX IF NOT EXISTS idx_system_settings_category
  ON system_settings(category);

CREATE INDEX IF NOT EXISTS idx_system_settings_key
  ON system_settings(key);

-- ── Audit trail ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS settings_audit_log (
  id          BIGSERIAL PRIMARY KEY,
  category    TEXT        NOT NULL,
  key         TEXT        NOT NULL,
  old_value   JSONB,
  new_value   JSONB       NOT NULL,
  updated_by  TEXT        NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_settings_audit_category
  ON settings_audit_log(category);

CREATE INDEX IF NOT EXISTS idx_settings_audit_key
  ON settings_audit_log(key);

CREATE INDEX IF NOT EXISTS idx_settings_audit_updated_at
  ON settings_audit_log(updated_at DESC);
