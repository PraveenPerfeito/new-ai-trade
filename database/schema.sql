-- ============================================================
-- CRYPTO MARKET SCANNER — Supabase Schema
-- Run this in your Supabase SQL Editor
-- ============================================================

-- Scan runs: records every scanner execution
CREATE TABLE IF NOT EXISTS scan_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mode          TEXT NOT NULL,  -- 'spot' | 'futures' | 'high_confidence' | 'trending'
  status        TEXT NOT NULL DEFAULT 'running',  -- 'running' | 'completed' | 'failed'
  coins_scanned INTEGER NOT NULL DEFAULT 0,
  signals_found INTEGER NOT NULL DEFAULT 0,
  error         TEXT,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at  TIMESTAMPTZ
);

-- Coins: cached top-100 list from CoinGecko
CREATE TABLE IF NOT EXISTS coins (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol          TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  coingecko_id    TEXT,
  binance_symbol  TEXT,
  market_cap      BIGINT,
  volume_24h      BIGINT,
  price           NUMERIC(24, 8),
  price_change_24h NUMERIC(8, 2),
  rank            INTEGER,
  has_futures     BOOLEAN NOT NULL DEFAULT FALSE,
  last_updated    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Signals: detected trading opportunities
CREATE TABLE IF NOT EXISTS signals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_run_id     UUID REFERENCES scan_runs(id) ON DELETE SET NULL,
  symbol          TEXT NOT NULL,
  name            TEXT,
  type            TEXT NOT NULL,       -- 'BUY' | 'SELL'
  timeframe       TEXT NOT NULL,       -- '1h' | '4h' | etc.
  scanner_mode    TEXT,               -- 'spot' | 'futures' | ...
  entry_price     NUMERIC(24, 8),
  target_price    NUMERIC(24, 8),
  stop_loss       NUMERIC(24, 8),
  rr_ratio        NUMERIC(6, 2),
  confidence      INTEGER,            -- 0-100
  rsi             NUMERIC(6, 2),
  macd_histogram  NUMERIC(20, 8),
  ema_trend       TEXT,               -- 'BULLISH' | 'BEARISH' | 'RANGING'
  atr             NUMERIC(20, 8),
  volume_spike    NUMERIC(8, 2),
  setup_description TEXT,
  ai_validated    BOOLEAN NOT NULL DEFAULT FALSE,
  ai_reasoning      TEXT,
  ai_explainability JSONB,        -- {trend, momentum, volatility, rationale, summary}
  risks             TEXT[],
  strengths         TEXT[],
  telegram_sent     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Migration: add ai_explainability if upgrading from an earlier schema
-- ALTER TABLE signals ADD COLUMN IF NOT EXISTS ai_explainability JSONB;

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_signals_created_at   ON signals(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_signals_confidence   ON signals(confidence DESC);
CREATE INDEX IF NOT EXISTS idx_signals_symbol       ON signals(symbol);
CREATE INDEX IF NOT EXISTS idx_signals_type         ON signals(type);
CREATE INDEX IF NOT EXISTS idx_scan_runs_started_at ON scan_runs(started_at DESC);

-- Row-level security (open read for dashboard, restricted write)
ALTER TABLE scan_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE coins     ENABLE ROW LEVEL SECURITY;
ALTER TABLE signals   ENABLE ROW LEVEL SECURITY;

-- Allow all reads with the anon key (dashboard reads)
CREATE POLICY "allow_read_scan_runs" ON scan_runs FOR SELECT USING (true);
CREATE POLICY "allow_read_coins"     ON coins     FOR SELECT USING (true);
CREATE POLICY "allow_read_signals"   ON signals   FOR SELECT USING (true);

-- Allow writes with service role key (scanner writes)
CREATE POLICY "allow_insert_scan_runs" ON scan_runs FOR INSERT WITH CHECK (true);
CREATE POLICY "allow_update_scan_runs" ON scan_runs FOR UPDATE USING (true);
CREATE POLICY "allow_insert_coins"     ON coins     FOR INSERT WITH CHECK (true);
CREATE POLICY "allow_update_coins"     ON coins     FOR UPDATE USING (true);
CREATE POLICY "allow_insert_signals"   ON signals   FOR INSERT WITH CHECK (true);
CREATE POLICY "allow_update_signals"   ON signals   FOR UPDATE USING (true);
