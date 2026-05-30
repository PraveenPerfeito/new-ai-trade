-- Phase 7.4A.6.3 — Signal Intelligence Model Upgrade
-- Adds 5 columns to signals table and 1 column to signal_outcomes.
-- Run once in Supabase SQL Editor (safe: uses ADD COLUMN IF NOT EXISTS).

-- ── signals: Phase 7.4A.6.3 promoted intelligence columns ───────────────────

ALTER TABLE signals
  ADD COLUMN IF NOT EXISTS breakout_strength  TEXT,          -- EARLY_BREAKOUT | CONFIRMED_BREAKOUT | HIGH_MOMENTUM_BREAKOUT
  ADD COLUMN IF NOT EXISTS oi_interpretation  TEXT,          -- NEW_LONGS | NEW_SHORTS | SHORT_COVERING | LONG_LIQUIDATION | NEUTRAL
  ADD COLUMN IF NOT EXISTS funding_trend      TEXT,          -- RISING | FALLING | STABLE
  ADD COLUMN IF NOT EXISTS positioning_context TEXT,         -- EXTREME_LONG | LONG_HEAVY | BALANCED | SHORT_HEAVY | EXTREME_SHORT
  ADD COLUMN IF NOT EXISTS trend_score        NUMERIC(5,2);  -- 0-100 TrendScore (TRENDING mode; NULL for SPOT/FUTURES)

-- ── signal_outcomes: add breakout_strength (missed in Phase 7.4A.6.1) ────────

ALTER TABLE signal_outcomes
  ADD COLUMN IF NOT EXISTS breakout_strength TEXT;  -- matches signals.breakout_strength

-- ── Indexes for win-rate analytics ───────────────────────────────────────────

CREATE INDEX IF NOT EXISTS signals_breakout_strength_idx
  ON signals (breakout_strength)
  WHERE breakout_strength IS NOT NULL;

CREATE INDEX IF NOT EXISTS signals_oi_interpretation_idx
  ON signals (oi_interpretation)
  WHERE oi_interpretation IS NOT NULL;

CREATE INDEX IF NOT EXISTS signal_outcomes_breakout_strength_idx
  ON signal_outcomes (breakout_strength)
  WHERE breakout_strength IS NOT NULL;

-- ── Analytics queries unlocked by this migration ──────────────────────────────

-- Win rate by breakout strength (distinguishes HIGH_MOMENTUM vs CONFIRMED vs EARLY):
-- SELECT so.breakout_strength,
--        ROUND(100.0 * COUNT(*) FILTER (WHERE so.outcome = 'TP_HIT') /
--              NULLIF(COUNT(*) FILTER (WHERE so.outcome != 'PENDING'), 0), 1) AS win_pct,
--        COUNT(*) AS total
-- FROM signal_outcomes so
-- WHERE so.breakout_strength IS NOT NULL
-- GROUP BY so.breakout_strength ORDER BY win_pct DESC;

-- Cross-tabulate breakout_type × breakout_strength:
-- SELECT breakout_type, breakout_strength, COUNT(*) AS n,
--        COUNT(*) FILTER (WHERE outcome = 'TP_HIT') AS wins
-- FROM signal_outcomes
-- GROUP BY 1, 2 ORDER BY wins DESC;

-- OI interpretation vs positioning vs outcome:
-- SELECT oi_interpretation, positioning_context, outcome, COUNT(*)
-- FROM signal_outcomes
-- WHERE oi_interpretation IS NOT NULL AND positioning_context IS NOT NULL
-- GROUP BY 1, 2, 3;
