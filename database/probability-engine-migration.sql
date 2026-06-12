-- PHASE.9.P1.PROBABILITY.ENGINE.1 — RiskGrade 2.0 shadow grade
-- empirical_grade = A+/A/B+/B/C/D derived from the signal's cohort expectancy
-- (attribution snapshots, n>=30). Written best-effort alongside empirical_wr;
-- the code falls back gracefully when this migration has not been run.
-- The heuristic risk_grade column is untouched (riskgrade_v2 flag only
-- switches which grade dashboards display).

ALTER TABLE signals
  ADD COLUMN IF NOT EXISTS empirical_grade TEXT;

ALTER TABLE signal_outcomes
  ADD COLUMN IF NOT EXISTS empirical_grade TEXT;
