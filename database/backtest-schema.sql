-- ─── Backtesting tables ───────────────────────────────────────────────────────
-- Run this against your Supabase project after the main schema.sql

CREATE TABLE IF NOT EXISTS backtest_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_name TEXT    NOT NULL,
  mode          TEXT    NOT NULL,   -- ScannerMode
  coins_tested  INTEGER NOT NULL DEFAULT 0,
  total_trades  INTEGER NOT NULL DEFAULT 0,
  status        TEXT    NOT NULL DEFAULT 'running', -- running | completed | failed
  error         TEXT,

  -- Aggregate metrics (NULL while running)
  win_rate      DECIMAL(6,4),
  loss_rate     DECIMAL(6,4),
  timeout_rate  DECIMAL(6,4),
  avg_rr        DECIMAL(10,4),
  profit_factor DECIMAL(10,4),
  total_return  DECIMAL(10,4),
  max_drawdown  DECIMAL(10,4),
  avg_win       DECIMAL(10,4),
  avg_loss      DECIMAL(10,4),
  best_trade    DECIMAL(10,4),
  worst_trade   DECIMAL(10,4),
  sharpe_ratio  DECIMAL(10,4),
  avg_duration_candles INTEGER,
  equity_curve  JSONB,             -- number[]

  config        JSONB NOT NULL,    -- BacktestConfig snapshot
  started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at  TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS backtest_trades (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  backtest_run_id   UUID    NOT NULL REFERENCES backtest_runs(id) ON DELETE CASCADE,
  symbol            TEXT    NOT NULL,
  type              TEXT    NOT NULL,  -- BUY | SELL
  entry_price       DECIMAL(24,8) NOT NULL,
  exit_price        DECIMAL(24,8) NOT NULL,
  stop_loss         DECIMAL(24,8) NOT NULL,
  take_profit       DECIMAL(24,8) NOT NULL,
  rr_ratio          DECIMAL(10,4),
  outcome           TEXT    NOT NULL,  -- WIN | LOSS | TIMEOUT
  pnl_pct           DECIMAL(10,4) NOT NULL,
  entry_time        TIMESTAMPTZ,
  exit_time         TIMESTAMPTZ,
  duration_candles  INTEGER,
  exit_reason       TEXT,              -- TP_HIT | SL_HIT | TIMEOUT
  rsi_at_entry      DECIMAL(8,2),
  volume_spike      DECIMAL(8,4),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_backtest_runs_started    ON backtest_runs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_backtest_runs_status     ON backtest_runs(status);
CREATE INDEX IF NOT EXISTS idx_backtest_trades_run_id   ON backtest_trades(backtest_run_id);
CREATE INDEX IF NOT EXISTS idx_backtest_trades_symbol   ON backtest_trades(symbol);
CREATE INDEX IF NOT EXISTS idx_backtest_trades_outcome  ON backtest_trades(outcome);

-- Row-level security (same pattern as signals table)
ALTER TABLE backtest_runs   ENABLE ROW LEVEL SECURITY;
ALTER TABLE backtest_trades ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read"   ON backtest_runs;
DROP POLICY IF EXISTS "Service write" ON backtest_runs;
DROP POLICY IF EXISTS "Public read"   ON backtest_trades;
DROP POLICY IF EXISTS "Service write" ON backtest_trades;

CREATE POLICY "Public read"   ON backtest_runs   FOR SELECT USING (true);
CREATE POLICY "Service write" ON backtest_runs   FOR ALL    USING (auth.role() = 'service_role');
CREATE POLICY "Public read"   ON backtest_trades FOR SELECT USING (true);
CREATE POLICY "Service write" ON backtest_trades FOR ALL    USING (auth.role() = 'service_role');
