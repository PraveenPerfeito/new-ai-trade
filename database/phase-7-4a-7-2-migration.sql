-- Phase 7.4A.7.2 — Sector Intelligence Signal Propagation
-- Adds sector_status column to signals and signal_outcomes tables.
-- Run once in Supabase SQL Editor (safe: ADD COLUMN IF NOT EXISTS).

ALTER TABLE signals
  ADD COLUMN IF NOT EXISTS sector_status TEXT;  -- STRONGEST | ACCELERATING | NEUTRAL | WEAKENING | OVERCROWDED

ALTER TABLE signal_outcomes
  ADD COLUMN IF NOT EXISTS sector_status TEXT;  -- mirrors signals.sector_status

-- Index for sector win-rate analytics
CREATE INDEX IF NOT EXISTS signals_sector_status_idx
  ON signals (sector_status)
  WHERE sector_status IS NOT NULL;

CREATE INDEX IF NOT EXISTS signal_outcomes_sector_status_idx
  ON signal_outcomes (sector_status)
  WHERE sector_status IS NOT NULL;

-- ── Analytics queries unlocked ────────────────────────────────────────────────

-- Win rate by sector status (TRENDING mode signals):
-- SELECT sector_status,
--        COUNT(*) FILTER (WHERE outcome = 'TP_HIT') AS wins,
--        COUNT(*) FILTER (WHERE outcome != 'PENDING') AS total,
--        ROUND(100.0 * COUNT(*) FILTER (WHERE outcome = 'TP_HIT') /
--              NULLIF(COUNT(*) FILTER (WHERE outcome != 'PENDING'), 0), 1) AS win_pct
-- FROM signal_outcomes
-- WHERE sector_status IS NOT NULL
-- GROUP BY sector_status
-- ORDER BY win_pct DESC;
