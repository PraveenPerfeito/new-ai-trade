-- Phase 7.2B.9 — validation_source column
-- Tracks whether a signal was validated by Claude or the heuristic fallback.
-- Added by commit 8a41de7; column is written in backend/core/scanner/db.py.

ALTER TABLE signals
  ADD COLUMN IF NOT EXISTS validation_source TEXT;

-- Back-fill existing rows: signals with ai_validated=true were Claude-validated;
-- ai_validated=false means the heuristic path was taken.
-- IMPORTANT: values must be UPPERCASE — Python writes "CLAUDE"/"HEURISTIC" and the
-- UI (lib/signal-lifecycle.ts, admin trading page) compares uppercase.
UPDATE signals
SET validation_source = CASE
  WHEN ai_validated = true  THEN 'CLAUDE'
  WHEN ai_validated = false THEN 'HEURISTIC'
  ELSE NULL
END
WHERE validation_source IS NULL;

-- Corrective pass for any rows back-filled with lowercase values by an earlier
-- run of this migration:
UPDATE signals
SET validation_source = UPPER(validation_source)
WHERE validation_source IN ('claude', 'heuristic');
