-- ============================================================
-- Phase 6.7 — Quant Outcome Attribution Migration
-- Adds tactical intelligence fields to the signals table so
-- outcome attribution can be run against market_regime,
-- signal_state, mcap_tier, etc.
-- Run in Supabase SQL Editor AFTER analytics-schema.sql
-- ============================================================

ALTER TABLE signals
  ADD COLUMN IF NOT EXISTS market_regime            TEXT,
  ADD COLUMN IF NOT EXISTS institutional_score      NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS signal_state             TEXT,
  ADD COLUMN IF NOT EXISTS extension_risk           TEXT,
  ADD COLUMN IF NOT EXISTS mcap_tier                TEXT,
  ADD COLUMN IF NOT EXISTS sector_name              TEXT,
  ADD COLUMN IF NOT EXISTS continuation_probability NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS regime_alignment_score   NUMERIC(5,2);

-- Indexes for fast GROUP BY in attribution queries
CREATE INDEX IF NOT EXISTS idx_signals_market_regime
  ON signals (market_regime);

CREATE INDEX IF NOT EXISTS idx_signals_mcap_tier
  ON signals (mcap_tier);

CREATE INDEX IF NOT EXISTS idx_signals_signal_state
  ON signals (signal_state);

CREATE INDEX IF NOT EXISTS idx_signals_extension_risk
  ON signals (extension_risk);

CREATE INDEX IF NOT EXISTS idx_signals_sector_name
  ON signals (sector_name);

-- Composite index for (regime, signal_state) — the primary edge pattern axis
CREATE INDEX IF NOT EXISTS idx_signals_regime_state
  ON signals (market_regime, signal_state)
  WHERE market_regime IS NOT NULL AND signal_state IS NOT NULL;
