-- ============================================================
-- PHASE 4.7 — Edge Validation Schema Migration
-- Run AFTER analytics-schema.sql
-- ============================================================

-- Add pre_score to signals for future persistence of SetupResult.pre_score
ALTER TABLE signals
  ADD COLUMN IF NOT EXISTS pre_score        INTEGER,
  ADD COLUMN IF NOT EXISTS quality_score    INTEGER,
  ADD COLUMN IF NOT EXISTS risk_score       INTEGER,
  ADD COLUMN IF NOT EXISTS risk_grade       TEXT,
  ADD COLUMN IF NOT EXISTS scanner_mode_str TEXT;   -- redundant with scanner_mode for fast filter

-- Add pre_score to signal_outcomes for fine-grained setup analysis
ALTER TABLE signal_outcomes
  ADD COLUMN IF NOT EXISTS pre_score INTEGER;

-- Indexes for edge validation queries
CREATE INDEX IF NOT EXISTS idx_signals_pre_score
  ON signals(pre_score DESC);

CREATE INDEX IF NOT EXISTS idx_signal_outcomes_pre_score
  ON signal_outcomes(pre_score DESC);

CREATE INDEX IF NOT EXISTS idx_signal_outcomes_quality_score
  ON signal_outcomes(quality_score DESC);

CREATE INDEX IF NOT EXISTS idx_signal_outcomes_risk_grade
  ON signal_outcomes(risk_grade);

CREATE INDEX IF NOT EXISTS idx_signal_outcomes_confidence_outcome
  ON signal_outcomes(confidence, outcome);

CREATE INDEX IF NOT EXISTS idx_signal_outcomes_mode_outcome
  ON signal_outcomes(scanner_mode, outcome);

CREATE INDEX IF NOT EXISTS idx_signal_outcomes_symbol_outcome
  ON signal_outcomes(symbol, outcome);

CREATE INDEX IF NOT EXISTS idx_signal_outcomes_regime_outcome
  ON signal_outcomes(volatility_regime, outcome);

CREATE INDEX IF NOT EXISTS idx_ai_call_log_signal_id
  ON ai_call_log(signal_id);

CREATE INDEX IF NOT EXISTS idx_ai_call_log_fallback
  ON ai_call_log(used_fallback);

-- ── Rolling window view ───────────────────────────────────────────────────────
-- Pre-materialised daily summary for fast calibration charts
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_daily_outcome_summary AS
SELECT
    DATE_TRUNC('day', created_at AT TIME ZONE 'UTC') AS day,
    scanner_mode,
    volatility_regime,
    risk_grade,
    outcome,
    COUNT(*)                                AS total,
    AVG(CASE WHEN outcome='TP_HIT' THEN 1 ELSE 0 END) AS win_rate,
    AVG(rr_achieved)                        AS avg_rr,
    SUM(CASE WHEN outcome='TP_HIT' THEN 1 ELSE 0 END) AS tp_hits,
    SUM(CASE WHEN outcome='SL_HIT' THEN 1 ELSE 0 END) AS sl_hits,
    SUM(CASE WHEN outcome='TIMEOUT' THEN 1 ELSE 0 END) AS timeouts
FROM signal_outcomes
WHERE outcome != 'PENDING'
GROUP BY 1, 2, 3, 4, 5
WITH DATA;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_daily_outcome_summary
  ON mv_daily_outcome_summary(day, scanner_mode, volatility_regime, risk_grade, outcome);

-- Refresh daily (call from a Celery Beat task or scheduled job):
-- REFRESH MATERIALIZED VIEW CONCURRENTLY mv_daily_outcome_summary;
