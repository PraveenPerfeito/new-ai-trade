-- PHASE.9.1 — probability gate (empirical probability stamp)
-- Adds the empirical cohort win-rate columns written best-effort by
-- backend/analytics/probability.py.  The scanner tolerates these columns
-- being absent (stamp persistence is a try/except UPDATE), so this migration
-- can run before or after deploy with zero risk.

ALTER TABLE signals
  ADD COLUMN IF NOT EXISTS empirical_wr NUMERIC,   -- cohort win rate %, n>=30 (attribution snapshots)
  ADD COLUMN IF NOT EXISTS empirical_n  INT;       -- cohort sample size

-- Future symmetry for outcome-side analysis (not written yet; reserved):
ALTER TABLE signal_outcomes
  ADD COLUMN IF NOT EXISTS empirical_wr NUMERIC,
  ADD COLUMN IF NOT EXISTS empirical_n  INT;
