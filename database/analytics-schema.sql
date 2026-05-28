-- ============================================================
-- SIGNAL PERFORMANCE ANALYTICS — Supabase Schema Extension
-- Run AFTER schema.sql in your Supabase SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS signal_outcomes (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id         UUID          REFERENCES signals(id) ON DELETE CASCADE,

  -- Denormalized signal context for fast group-by queries
  symbol            TEXT          NOT NULL,
  signal_type       TEXT          NOT NULL,   -- 'BUY' | 'SELL'
  timeframe         TEXT          NOT NULL,   -- '15m' | '1h' | '4h' | '1d'
  scanner_mode      TEXT          NOT NULL,   -- 'spot' | 'futures' | 'high_confidence' | 'trending'
  entry_price       NUMERIC(24,8) NOT NULL,
  target_price      NUMERIC(24,8) NOT NULL,
  stop_loss         NUMERIC(24,8) NOT NULL,
  rr_ratio          NUMERIC(6,2)  NOT NULL,
  confidence        INTEGER       NOT NULL,
  ai_validated      BOOLEAN       NOT NULL DEFAULT FALSE,

  -- Derived classification fields for slice-and-dice analytics
  volatility_regime TEXT,                     -- 'LOW' | 'NORMAL' | 'HIGH' | 'EXTREME'
  risk_grade        TEXT,                     -- 'A' | 'B' | 'C' | 'D' | 'F'
  risk_score        INTEGER,
  quality_score     INTEGER,

  -- Outcome (populated by the automated tracker)
  outcome           TEXT          NOT NULL DEFAULT 'PENDING',  -- 'PENDING' | 'TP_HIT' | 'SL_HIT' | 'TIMEOUT'
  exit_price        NUMERIC(24,8),
  exit_time         TIMESTAMPTZ,
  rr_achieved       NUMERIC(8,4),             -- positive = gain in R, negative = loss in R
  pnl_pct           NUMERIC(8,4),             -- percentage gain/loss
  duration_hours    NUMERIC(8,2),

  -- Tracker bookkeeping
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  resolved_at       TIMESTAMPTZ,
  checked_at        TIMESTAMPTZ,
  check_count       INTEGER       NOT NULL DEFAULT 0
);

-- One outcome record per signal
CREATE UNIQUE INDEX IF NOT EXISTS idx_signal_outcomes_signal_id
  ON signal_outcomes(signal_id);

CREATE INDEX IF NOT EXISTS idx_signal_outcomes_outcome
  ON signal_outcomes(outcome);

CREATE INDEX IF NOT EXISTS idx_signal_outcomes_created_at
  ON signal_outcomes(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_signal_outcomes_symbol
  ON signal_outcomes(symbol);

CREATE INDEX IF NOT EXISTS idx_signal_outcomes_scanner_mode
  ON signal_outcomes(scanner_mode);

CREATE INDEX IF NOT EXISTS idx_signal_outcomes_timeframe
  ON signal_outcomes(timeframe);

CREATE INDEX IF NOT EXISTS idx_signal_outcomes_confidence
  ON signal_outcomes(confidence DESC);

CREATE INDEX IF NOT EXISTS idx_signal_outcomes_volatility
  ON signal_outcomes(volatility_regime);

-- Partial composite index for the PENDING outcome resolution query:
-- WHERE outcome='PENDING' AND created_at > $1 AND check_count < $2
-- ORDER BY created_at ASC LIMIT $3
-- Without this, Postgres scans the full outcome index then re-filters on created_at
-- and check_count. This index covers the exact query shape in signal_metrics.py.
CREATE INDEX IF NOT EXISTS idx_signal_outcomes_pending_resolution
  ON signal_outcomes(created_at ASC, check_count)
  WHERE outcome = 'PENDING';

-- Row-level security (mirrors existing tables)
ALTER TABLE signal_outcomes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allow_read_signal_outcomes"   ON signal_outcomes;
DROP POLICY IF EXISTS "allow_insert_signal_outcomes" ON signal_outcomes;
DROP POLICY IF EXISTS "allow_update_signal_outcomes" ON signal_outcomes;

CREATE POLICY "allow_read_signal_outcomes"
  ON signal_outcomes FOR SELECT USING (true);

CREATE POLICY "allow_insert_signal_outcomes"
  ON signal_outcomes FOR INSERT WITH CHECK (true);

CREATE POLICY "allow_update_signal_outcomes"
  ON signal_outcomes FOR UPDATE USING (true);


-- ── AI call log ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ai_call_log (
  id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id           UUID          REFERENCES signals(id) ON DELETE SET NULL,
  model               TEXT          NOT NULL,
  latency_ms          INTEGER       NOT NULL DEFAULT 0,
  prompt_tokens       INTEGER,
  completion_tokens   INTEGER,
  validated           BOOLEAN       NOT NULL DEFAULT FALSE,
  confidence          INTEGER       NOT NULL DEFAULT 0,
  used_fallback       BOOLEAN       NOT NULL DEFAULT FALSE,
  error               TEXT,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_call_log_created_at
  ON ai_call_log(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_call_log_validated
  ON ai_call_log(validated);


-- ── Scan metrics log ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS scan_metrics_log (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id         TEXT          NOT NULL,
  mode            TEXT          NOT NULL,
  coins_scanned   INTEGER       NOT NULL DEFAULT 0,
  signals_found   INTEGER       NOT NULL DEFAULT 0,
  duration_ms     INTEGER       NOT NULL DEFAULT 0,
  errors          INTEGER       NOT NULL DEFAULT 0,
  gate_rejections JSONB,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scan_metrics_log_created_at
  ON scan_metrics_log(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_scan_metrics_log_mode
  ON scan_metrics_log(mode);


-- ── Analytics snapshots (cached computed analytics) ───────────────────────────

CREATE TABLE IF NOT EXISTS analytics_snapshots (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_type TEXT          NOT NULL,   -- 'overall' | 'by_mode' | 'ai' | 'scan'
  window_hours  INTEGER       NOT NULL DEFAULT 168,
  data          JSONB         NOT NULL,
  computed_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_analytics_snapshots_type_window
  ON analytics_snapshots(snapshot_type, window_hours, computed_at DESC);
