-- ============================================================
-- PAPER TRADING ENGINE — Supabase Schema
-- Run AFTER schema.sql in your Supabase SQL Editor
-- ============================================================

-- Virtual portfolio: holds balance and aggregate stats
CREATE TABLE IF NOT EXISTS paper_portfolios (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT          NOT NULL DEFAULT 'Paper Portfolio',
  initial_capital   NUMERIC(18,2) NOT NULL DEFAULT 10000,
  available_capital NUMERIC(18,2) NOT NULL DEFAULT 10000,  -- cash not locked in trades
  realized_pnl      NUMERIC(18,4) NOT NULL DEFAULT 0,      -- cumulative closed-trade PnL
  total_trades      INTEGER       NOT NULL DEFAULT 0,
  wins              INTEGER       NOT NULL DEFAULT 0,
  losses            INTEGER       NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Prevent duplicate portfolios created under race conditions
CREATE UNIQUE INDEX IF NOT EXISTS idx_paper_portfolios_name
  ON paper_portfolios(name);

-- Individual paper trades
CREATE TABLE IF NOT EXISTS paper_trades (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id      UUID          NOT NULL REFERENCES paper_portfolios(id) ON DELETE CASCADE,
  signal_id         UUID          REFERENCES signals(id) ON DELETE SET NULL,

  -- Signal context (denormalized for self-contained trade records)
  symbol            TEXT          NOT NULL,
  signal_type       TEXT          NOT NULL,   -- 'BUY' | 'SELL'
  timeframe         TEXT          NOT NULL,
  scanner_mode      TEXT          NOT NULL,
  confidence        INTEGER       NOT NULL DEFAULT 0,

  -- Trade levels
  entry_price       NUMERIC(24,8) NOT NULL,
  target_price      NUMERIC(24,8) NOT NULL,
  stop_loss         NUMERIC(24,8) NOT NULL,
  rr_ratio          NUMERIC(6,2)  NOT NULL,

  -- Position sizing
  leverage          INTEGER       NOT NULL DEFAULT 1,
  risk_pct          NUMERIC(8,6)  NOT NULL DEFAULT 0.01,   -- fraction of equity risked
  notional_usdt     NUMERIC(18,4) NOT NULL,                -- position face value
  margin_usdt       NUMERIC(18,4) NOT NULL,                -- capital locked = notional / leverage
  risk_amount_usdt  NUMERIC(18,4) NOT NULL,                -- max loss in USDT
  quantity          NUMERIC(24,8) NOT NULL,

  -- Status
  status            TEXT          NOT NULL DEFAULT 'OPEN', -- see PaperTradeStatus

  -- Exit fields (NULL while OPEN)
  exit_price        NUMERIC(24,8),
  exit_reason       TEXT,                                  -- 'TP_HIT' | 'SL_HIT' | 'MANUAL' | 'EXPIRED'
  realized_pnl      NUMERIC(18,4),
  realized_pnl_pct  NUMERIC(8,4),
  duration_hours    NUMERIC(8,2),

  -- Bookkeeping
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  closed_at         TIMESTAMPTZ,
  last_checked_at   TIMESTAMPTZ
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_paper_trades_portfolio    ON paper_trades(portfolio_id);
CREATE INDEX IF NOT EXISTS idx_paper_trades_status       ON paper_trades(status);
CREATE INDEX IF NOT EXISTS idx_paper_trades_symbol       ON paper_trades(symbol);
CREATE INDEX IF NOT EXISTS idx_paper_trades_created_at   ON paper_trades(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_paper_portfolios_created  ON paper_portfolios(created_at DESC);

-- RLS: full access (paper trading is local, no multi-user isolation needed)
ALTER TABLE paper_portfolios ENABLE ROW LEVEL SECURITY;
ALTER TABLE paper_trades     ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allow_all_paper_portfolios" ON paper_portfolios FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_paper_trades"     ON paper_trades     FOR ALL USING (true) WITH CHECK (true);
