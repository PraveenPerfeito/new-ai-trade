-- ATTRIBUTION.SNAPSHOTS.1 (PHASE.9.P0.EXPECTANCY.RECOVERY.1)
-- Nightly aggregates of resolved signal_outcomes per intelligence dimension.
-- Foundation for: Probability Engine, Confidence Calibration 2, RiskGrade 2.0,
-- Outcome Learning. Pure SQL aggregation — no ML, no model training.
--
-- Written by backend/analytics/outcome_learning.py (Celery beat, 00:15 UTC).

CREATE TABLE IF NOT EXISTS attribution_snapshots (
  id          BIGSERIAL PRIMARY KEY,
  window_days INT  NOT NULL,            -- 7 | 30
  dim_key     TEXT NOT NULL,            -- e.g. 'regime|type|breakout'
  dim_value   TEXT NOT NULL,            -- e.g. 'BEAR_TREND|SELL|CONFIRMED_BREAKOUT'
  n           INT,
  tp          INT,
  sl          INT,
  wr          NUMERIC,                  -- win rate %, TP/(TP+SL)
  exp         NUMERIC,                  -- mean rr_achieved (expectancy, R)
  pf          NUMERIC,                  -- profit factor (NULL when no losses)
  computed_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_attribution_snapshots_lookup
  ON attribution_snapshots (dim_key, dim_value, window_days, computed_at DESC);

-- Retention: keep 90 days of snapshots (cleanup handled by the nightly task).
