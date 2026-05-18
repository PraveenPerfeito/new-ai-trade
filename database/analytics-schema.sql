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

-- Row-level security (mirrors existing tables)
ALTER TABLE signal_outcomes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allow_read_signal_outcomes"
  ON signal_outcomes FOR SELECT USING (true);

CREATE POLICY "allow_insert_signal_outcomes"
  ON signal_outcomes FOR INSERT WITH CHECK (true);

CREATE POLICY "allow_update_signal_outcomes"
  ON signal_outcomes FOR UPDATE USING (true);
