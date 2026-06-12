-- CLAUDE.OPTIMIZATION.1 — ai_call_log traceability
-- symbol + setup_score let Claude verdicts be joined to candidates/outcomes,
-- making the Claude kill-gate's filter value measurable (the audit found 82
-- calls/7d with 6% approval and no way to trace which candidates they were).
--
-- The insert code falls back to the legacy column list when these columns are
-- absent, so this migration can run before or after deploy with zero risk.

ALTER TABLE ai_call_log
  ADD COLUMN IF NOT EXISTS symbol TEXT,
  ADD COLUMN IF NOT EXISTS setup_score INT;
