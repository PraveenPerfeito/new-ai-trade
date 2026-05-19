-- ============================================================
-- Experimental Configuration Schema
-- Run AFTER settings-groups-migration.sql
-- ============================================================

-- Staged rollouts, temporary overrides, dry-run experiments
CREATE TABLE IF NOT EXISTS settings_experiments (
    id             BIGSERIAL    PRIMARY KEY,
    name           TEXT         NOT NULL,
    description    TEXT         NOT NULL DEFAULT '',
    group_name     TEXT         NOT NULL,
    overrides      JSONB        NOT NULL DEFAULT '{}',
    status         TEXT         NOT NULL DEFAULT 'draft'
                                CHECK (status IN ('draft', 'active', 'paused', 'concluded')),
    rollout_pct    INTEGER      NOT NULL DEFAULT 100
                                CHECK (rollout_pct BETWEEN 0 AND 100),
    context_filter JSONB        NOT NULL DEFAULT '{}',
    dry_run        BOOLEAN      NOT NULL DEFAULT FALSE,
    expires_at     TIMESTAMPTZ,
    created_by     TEXT         NOT NULL DEFAULT 'admin',
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Fast lookup of active experiments per group
CREATE INDEX IF NOT EXISTS idx_experiments_active_group
    ON settings_experiments (group_name, id)
    WHERE status = 'active';

-- Efficient expiry sweep
CREATE INDEX IF NOT EXISTS idx_experiments_active_expires
    ON settings_experiments (expires_at)
    WHERE status = 'active' AND expires_at IS NOT NULL;

COMMENT ON TABLE  settings_experiments IS 'Staged rollouts and temporary config overrides layered on top of settings_groups';
COMMENT ON COLUMN settings_experiments.rollout_pct     IS '0–100: probability this experiment is applied per evaluation (100 = always)';
COMMENT ON COLUMN settings_experiments.context_filter  IS 'Key-value pairs that must match the caller context (empty = apply to all)';
COMMENT ON COLUMN settings_experiments.dry_run         IS 'Log what would change without actually applying the overrides';
COMMENT ON COLUMN settings_experiments.expires_at      IS 'Auto-deactivate at this UTC timestamp (NULL = no expiry)';
