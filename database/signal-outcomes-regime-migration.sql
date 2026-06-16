-- signal-outcomes-regime-migration.sql
-- Adds market_regime to signal_outcomes.
-- Required by performance_verification.py (lines 165, 192) which queries this column
-- directly from signal_outcomes. The column exists on signals (phase-6.7-attribution-migration.sql)
-- but was never mirrored to signal_outcomes.
-- Idempotent: safe to re-run.

ALTER TABLE signal_outcomes ADD COLUMN IF NOT EXISTS market_regime TEXT;

-- Backfill existing resolved outcomes from the joined signals table.
UPDATE signal_outcomes so
SET market_regime = s.market_regime
FROM signals s
WHERE so.signal_id = s.id
  AND so.market_regime IS NULL
  AND s.market_regime IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_signal_outcomes_market_regime
  ON signal_outcomes (market_regime)
  WHERE market_regime IS NOT NULL;
