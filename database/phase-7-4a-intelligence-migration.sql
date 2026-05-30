-- Phase 7.4A.6.1 — Outcome Intelligence Persistence
-- Adds 6 Phase 7.x intelligence columns to signal_outcomes and 1 to signals.
-- Run once in Supabase SQL Editor.

-- ── signal_outcomes: Phase 7.x intelligence columns ──────────────────────────

ALTER TABLE signal_outcomes
  ADD COLUMN IF NOT EXISTS breakout_type       TEXT,          -- 20d_high | 30d_high | 20d_low | 30d_low | bb_expansion | 30d_high+bb_expansion | ...
  ADD COLUMN IF NOT EXISTS oi_interpretation   TEXT,          -- NEW_LONGS | NEW_SHORTS | SHORT_COVERING | LONG_LIQUIDATION | NEUTRAL
  ADD COLUMN IF NOT EXISTS funding_trend       TEXT,          -- RISING | FALLING | STABLE
  ADD COLUMN IF NOT EXISTS positioning_context TEXT,          -- EXTREME_LONG | LONG_HEAVY | BALANCED | SHORT_HEAVY | EXTREME_SHORT
  ADD COLUMN IF NOT EXISTS momentum_score      INTEGER,       -- 0-100 futures momentum score (includes OI + positioning + funding adjustments)
  ADD COLUMN IF NOT EXISTS trend_score         NUMERIC(5,2);  -- 0-100 TrendScore from Phase 7.3A.3 (TRENDING mode only, NULL otherwise)

-- ── signals: breakout_type column ────────────────────────────────────────────

ALTER TABLE signals
  ADD COLUMN IF NOT EXISTS breakout_type TEXT;  -- mirrors signal_outcomes.breakout_type

-- ── Indexes for analytics queries ────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS signal_outcomes_breakout_type_idx
  ON signal_outcomes (breakout_type)
  WHERE breakout_type IS NOT NULL;

CREATE INDEX IF NOT EXISTS signal_outcomes_oi_interpretation_idx
  ON signal_outcomes (oi_interpretation)
  WHERE oi_interpretation IS NOT NULL;

CREATE INDEX IF NOT EXISTS signal_outcomes_funding_trend_idx
  ON signal_outcomes (funding_trend)
  WHERE funding_trend IS NOT NULL;

CREATE INDEX IF NOT EXISTS signal_outcomes_positioning_context_idx
  ON signal_outcomes (positioning_context)
  WHERE positioning_context IS NOT NULL;

-- ── Analytics queries now possible ───────────────────────────────────────────

-- Win rate by breakout type:
-- SELECT breakout_type,
--        COUNT(*) FILTER (WHERE outcome = 'TP_HIT') AS wins,
--        COUNT(*) FILTER (WHERE outcome != 'PENDING') AS total,
--        ROUND(COUNT(*) FILTER (WHERE outcome = 'TP_HIT')::numeric /
--              NULLIF(COUNT(*) FILTER (WHERE outcome != 'PENDING'), 0) * 100, 1) AS win_pct
-- FROM signal_outcomes
-- WHERE breakout_type IS NOT NULL
-- GROUP BY breakout_type ORDER BY win_pct DESC;

-- Win rate by OI interpretation:
-- SELECT oi_interpretation,
--        COUNT(*) FILTER (WHERE outcome = 'TP_HIT') AS wins,
--        COUNT(*) FILTER (WHERE outcome != 'PENDING') AS total
-- FROM signal_outcomes WHERE oi_interpretation IS NOT NULL
-- GROUP BY oi_interpretation;

-- Momentum score vs outcome:
-- SELECT
--   CASE WHEN momentum_score >= 80 THEN 'high'
--        WHEN momentum_score >= 60 THEN 'medium'
--        ELSE 'low' END AS momentum_tier,
--   outcome, COUNT(*)
-- FROM signal_outcomes WHERE momentum_score IS NOT NULL
-- GROUP BY 1, 2;
