-- ============================================================
-- PHASE 5 Extended v2 — Strongly-Typed Settings Groups
-- Run AFTER settings-migration.sql
-- ============================================================

-- Primary group storage: one row per settings group, full JSONB blob.
-- data_version increments on every write — consumers use it as an ETag.
-- schema_version records which Python model generated the data (migration aid).

CREATE TABLE IF NOT EXISTS settings_groups (
  group_name     TEXT        PRIMARY KEY,
  schema_version INTEGER     NOT NULL DEFAULT 1,
  data_version   BIGINT      NOT NULL DEFAULT 1,
  data           JSONB       NOT NULL DEFAULT '{}',
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by     TEXT        NOT NULL DEFAULT 'system'
);

CREATE INDEX IF NOT EXISTS idx_settings_groups_updated
  ON settings_groups(updated_at DESC);

-- Audit trail with field-level diff per write.
-- changed_fields: {"field_name": {"old": x, "new": y}, ...}

CREATE TABLE IF NOT EXISTS settings_group_audit (
  id              BIGSERIAL   PRIMARY KEY,
  group_name      TEXT        NOT NULL,
  old_version     BIGINT      NOT NULL,
  new_version     BIGINT      NOT NULL,
  changed_fields  JSONB       NOT NULL DEFAULT '{}',
  schema_version  INTEGER     NOT NULL DEFAULT 1,
  updated_by      TEXT        NOT NULL,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_settings_group_audit_group
  ON settings_group_audit(group_name);

CREATE INDEX IF NOT EXISTS idx_settings_group_audit_updated
  ON settings_group_audit(updated_at DESC);
