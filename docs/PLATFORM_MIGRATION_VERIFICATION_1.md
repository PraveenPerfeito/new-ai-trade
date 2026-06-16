# PLATFORM_MIGRATION_VERIFICATION_1.md

**Date:** 2026-06-16  
**Scope:** Database migration inventory, schema verification, code–schema alignment, probability engine validation, Telegram delivery validation, AI traceability validation  
**Method:** Read-only audit (static) + live PostgREST schema verification (automated)  
**Signal Quality Audit GO/NO-GO:** See section 7

---

## LIVE VERIFICATION UPDATE (2026-06-16)

Automated schema check via PostgREST (`check-schema.py`) confirmed all 7 migrations are **already applied and operational** in production Supabase.

| Check | Result |
|---|---|
| `signals.validation_source` | ✅ EXISTS — recent signals show `HEURISTIC` (AI currently off) |
| `signals.empirical_wr/empirical_n/empirical_grade` | ✅ EXISTS + POPULATED — probability engine stamping live (e.g., `wr=27.78%, grade=D`) |
| `signals.telegram_delivered/telegram_delivery_error` | ✅ EXISTS — but `NULL` for all 626 sent signals (delivery write-back not firing — see F5) |
| `signal_outcomes.empirical_wr/empirical_n/empirical_grade` | ✅ EXISTS — columns reserved, not yet written (by design per migration comment) |
| `signal_outcomes.market_regime` | ✅ EXISTS + POPULATED — backfill joined from `signals` |
| `ai_call_log.symbol/setup_score` | ✅ EXISTS + POPULATED — tracking live (e.g., SOL setup_score=77) |
| `attribution_snapshots` table | ✅ EXISTS — **1,243 rows**, nightly batch running |

**GO/NO-GO for Signal Quality Audit: GO.**

---

## 1. Executive Summary

All 7 migration SQL files exist in `database/` and have been confirmed applied to production Supabase via automated PostgREST column existence checks (2026-06-16). The 7th migration (`signal-outcomes-regime-migration.sql`) was created during this audit and also confirmed applied.

**Operational state:**

- `outcome_learning.py`'s INSERT into `attribution_snapshots` has **no try/except** — code-quality gap, but moot since the table exists and the batch has run (1,243 rows).
- Probability engine is live: signals are being stamped with `empirical_wr`, `empirical_n`, `empirical_grade` from attribution cohort lookups.
- `telegram_delivered` column exists but remains `NULL` for all 626 sent signals — the WS2 drain worker write-back is not executing (deployed version gap or silent failure). Delivery itself is unaffected; only ground-truth tracking is blind.
- Attribution snapshots have 1,243 rows across multiple dimension keys — probability engine has real cohort data to work with.

**GO/NO-GO for Signal Quality Audit: GO.**

---

## 2. Part 1 — Migration Inventory

| Migration File | Purpose | Tables Affected | Columns Added | File Exists | Applied? |
|---|---|---|---|---|---|
| `validation-source-migration.sql` | Audit trail for Claude vs heuristic validation | `signals` | `validation_source TEXT` (CLAUDE / HEURISTIC) | ✅ YES | ⚠️ UNCONFIRMED |
| `probability-gate-migration.sql` | Cohort win-rate and sample-size stamping | `signals`, `signal_outcomes` | `empirical_wr NUMERIC`, `empirical_n INT` | ✅ YES | ⚠️ UNCONFIRMED |
| `probability-engine-migration.sql` | Shadow empirical grade from cohort expectancy | `signals`, `signal_outcomes` | `empirical_grade TEXT` (A+/A/B+/B/C/D) | ✅ YES | ⚠️ UNCONFIRMED |
| `telegram-delivery-migration.sql` | Delivery ground truth for TELEGRAM.RELIABILITY.1 | `signals` | `telegram_delivered BOOLEAN`, `telegram_delivery_error TEXT` | ✅ YES | ⚠️ UNCONFIRMED |
| `ai-call-log-trace-migration.sql` | Claude kill-gate cost traceability by symbol | `ai_call_log` | `symbol TEXT`, `setup_score INT` | ✅ YES | ⚠️ UNCONFIRMED |
| `attribution-snapshots-migration.sql` | Foundation table for probability engine nightly aggregates | NEW TABLE `attribution_snapshots` | `id`, `window_days`, `dim_key`, `dim_value`, `n`, `tp`, `sl`, `wr`, `exp`, `pf`, `computed_at` | ✅ YES | ⚠️ UNCONFIRMED |

**All 6 files are idempotent.** Every statement uses `ADD COLUMN IF NOT EXISTS` or `CREATE TABLE IF NOT EXISTS`. Safe to re-run.

**Source of "UNCONFIRMED":** CLAUDE.md decision #59 reads *"Run all 6 in Supabase SQL Editor before next deploy"* — present-tense instruction, not past-tense confirmation.

---

## 3. Part 2 — Schema vs Code Verification

### 3a. `signals` table

Full expected schema after all migrations applied (65 columns). Columns relevant to this audit:

| Column | Added By | Code Reader | Code Writer | Status |
|---|---|---|---|---|
| `validation_source` | `validation-source-migration.sql` | `lib/supabase.ts:rowToSignal():462`, `lib/signal-lifecycle.ts:36` | `backend/core/scanner/signal_pipeline.py` | ⚠️ MISSING until migration |
| `empirical_wr` | `probability-gate-migration.sql` | `lib/supabase.ts:rowToSignal():464`, `app/api/signals/tactical/route.ts` | `backend/analytics/probability.py:212` (tolerant) | ⚠️ MISSING until migration |
| `empirical_n` | `probability-gate-migration.sql` | `lib/supabase.ts:rowToSignal():465` | `backend/analytics/probability.py:212` (tolerant) | ⚠️ MISSING until migration |
| `empirical_grade` | `probability-engine-migration.sql` | `lib/supabase.ts:rowToSignal():466` | `backend/analytics/probability.py:212` (tolerant, with 2-col fallback at line 220) | ⚠️ MISSING until migration |
| `telegram_delivered` | `telegram-delivery-migration.sql` | `backend/api/analytics.py:222` (delivery funnel) | `backend/core/scanner/telegram_notifier.py:144` (tolerant) | ⚠️ MISSING until migration |
| `telegram_delivery_error` | `telegram-delivery-migration.sql` | `backend/api/analytics.py:225` | `backend/core/scanner/telegram_notifier.py:144` (tolerant) | ⚠️ MISSING until migration |
| `market_regime` | `phase-6.7-attribution-migration.sql` | `backend/analytics/performance_verification.py:130` (JOIN from signals) | `backend/core/scanner/orchestrator.py:481` | ✅ Migration exists and applied (older) |
| `breakout_strength` | `phase-7-4a-6-3-migration.sql` | `backend/analytics/performance_verification.py:131,165` | Scanner pipeline | ✅ Migration exists and applied (older) |

`lib/supabase.ts` uses `select('*')` — all columns are returned automatically when they exist in the schema. The `rowToSignal()` mapping safely reads `empirical_wr`, `empirical_n`, `empirical_grade`, and `validation_source` — they will be `undefined`/`null` until migrations run, not errors.

---

### 3b. `signal_outcomes` table

Full expected schema after all migrations (39 columns). Critical gap found:

| Column | Expected By | Migration That Adds It | Status |
|---|---|---|---|
| `empirical_wr` | `probability-gate-migration.sql`, `performance_verification.py:130` | `probability-gate-migration.sql` | ⚠️ MISSING until migration |
| `empirical_n` | `probability-gate-migration.sql` | `probability-gate-migration.sql` | ⚠️ MISSING until migration |
| `empirical_grade` | `probability-engine-migration.sql`, `performance_verification.py:130` | `probability-engine-migration.sql` | ⚠️ MISSING until migration |
| `market_regime` | `performance_verification.py:165,192` reads from `signal_outcomes` | **NO MIGRATION FOUND** | 🔴 CRITICAL GAP |
| `breakout_strength` | `performance_verification.py:165,192` | `phase-7-4a-6-3-migration.sql` | ✅ Applied (older) |
| `signal_type` | `performance_verification.py:165` | Base schema (`analytics-schema.sql`) | ✅ Present in base |
| `rr_achieved` | `performance_verification.py:165`, tactical route | Base schema | ✅ Present in base |
| `risk_grade` | `performance_verification.py:165` | Base schema | ✅ Present in base |

**CRITICAL:** `performance_verification.py` (lines 160–166, 189–196) queries `market_regime` directly from `signal_outcomes`:
```sql
SELECT outcome, rr_achieved, market_regime, signal_type, breakout_strength, risk_grade
FROM signal_outcomes
WHERE outcome IN ('TP_HIT','SL_HIT') AND created_at > NOW() - INTERVAL '30 days'
```

`market_regime` was added to `signals` by `phase-6.7-attribution-migration.sql` — **but this migration does not add the column to `signal_outcomes`**. No other migration does either. The queries will fail with `column "market_regime" does not exist` if `performance_verification.py` is called against a live DB where `signal_outcomes` lacks this column.

---

### 3c. `attribution_snapshots` table

| Column | INSERT By `outcome_learning.py` | SELECT By `probability.py` | SELECT By `edge-matrix` | Status |
|---|---|---|---|---|
| `window_days` | ✅ line 158 | ✅ filter | ✅ filter | ⚠️ TABLE MISSING until migration |
| `dim_key` | ✅ line 158 | ✅ line 84 | ✅ | ⚠️ TABLE MISSING until migration |
| `dim_value` | ✅ line 158 | ✅ line 84 | ✅ | ⚠️ TABLE MISSING until migration |
| `n` | ✅ line 158 | ✅ line 84 | ✅ | ⚠️ TABLE MISSING until migration |
| `tp` | ✅ line 158 | ✗ not selected | ✗ | ⚠️ TABLE MISSING until migration |
| `sl` | ✅ line 158 | ✗ not selected | ✗ | ⚠️ TABLE MISSING until migration |
| `wr` | ✅ line 158 | ✅ line 84 | ✅ | ⚠️ TABLE MISSING until migration |
| `exp` | ✅ line 158 | ✅ line 84 | ✅ | ⚠️ TABLE MISSING until migration |
| `pf` | ✅ line 158 | ✅ line 84 | ✅ | ⚠️ TABLE MISSING until migration |
| `computed_at` | auto DEFAULT now() | ✅ filter (48h window) | ✅ filter | ⚠️ TABLE MISSING until migration |
| `id` | auto BIGSERIAL | ✗ | ✗ | ⚠️ TABLE MISSING until migration |

INSERT vs SELECT column alignment: **SAFE** — `outcome_learning.py` inserts 9 payload columns; `probability.py` selects 6 of those (skips `tp`, `sl` which are raw counts not needed for lookup). No column name mismatch.

---

### 3d. `ai_call_log` table

| Column | Base Schema | Migration | Code Writer | Status |
|---|---|---|---|---|
| `signal_id` | ✅ `analytics-schema.sql` | — | `ai_metrics.py:53` | ✅ Present |
| `model` | ✅ | — | `ai_metrics.py:53` | ✅ Present |
| `latency_ms` | ✅ | — | `ai_metrics.py:53` | ✅ Present |
| `prompt_tokens` | ✅ | — | `ai_metrics.py:53` | ✅ Present |
| `completion_tokens` | ✅ | — | `ai_metrics.py:53` | ✅ Present |
| `validated` | ✅ | — | `ai_metrics.py:53` | ✅ Present |
| `confidence` | ✅ | — | `ai_metrics.py:53` | ✅ Present |
| `used_fallback` | ✅ | — | `ai_metrics.py:53` | ✅ Present |
| `error` | ✅ | — | `ai_metrics.py:53` | ✅ Present |
| `symbol` | ✗ | `ai-call-log-trace-migration.sql` | `ai_metrics.py:53` (tolerant) | ⚠️ MISSING until migration |
| `setup_score` | ✗ | `ai-call-log-trace-migration.sql` | `ai_metrics.py:53` (tolerant) | ⚠️ MISSING until migration |

`ai_metrics.py` has two-tier fallback: tries 11-column INSERT first; if `symbol` or `setup_score` columns are absent, falls back to 9-column legacy INSERT. **Base functionality is unaffected** even without the migration.

---

## 4. Part 3 — Gaps, Silent Fallbacks, Unused Columns

### 4a. Missing Migrations

| Gap | Severity | Detail |
|---|---|---|
| 6 migrations not applied to Supabase production | 🔴 CRITICAL | All files exist, none confirmed applied |
| `market_regime` column missing from `signal_outcomes` | 🔴 CRITICAL | `performance_verification.py` queries it directly; no migration adds it to that table |

### 4b. Missing Columns (runtime impact)

| Column | Table | Missing Until | Runtime Behaviour |
|---|---|---|---|
| `validation_source` | `signals` | migration applied | `computeLifecycleStage()` returns AI_APPROVED for all signals (null ≠ 'HEURISTIC') |
| `empirical_wr`, `empirical_n` | `signals`, `signal_outcomes` | migration applied | P chips in signal rows blank; probability gate uses global fallback only |
| `empirical_grade` | `signals`, `signal_outcomes` | migration applied | Empirical grade display shows nothing; heuristic grade used instead |
| `telegram_delivered` | `signals` | migration applied | TelegramDeliveryCard shows all NULL; delivery funnel shows "unresolved" for everything |
| `telegram_delivery_error` | `signals` | migration applied | Error diagnosis impossible |
| `symbol`, `setup_score` | `ai_call_log` | migration applied | Claude cost-per-symbol unmeasurable; kill-gate analysis impossible |
| `attribution_snapshots` (entire table) | NEW TABLE | migration applied | Probability engine returns no cohorts; nightly batch fails with UndefinedTable |
| `market_regime` | `signal_outcomes` | **no migration written** | `performance_verification.py` queries fail with column-not-found error |

### 4c. Silent Fallbacks (code gracefully degrades)

| Code | Behaviour Without Migration | Classification |
|---|---|---|
| `probability.py:211-223` | Tries 3-col UPDATE; catches `empirical_grade` error; falls back to 2-col UPDATE; logs debug | ✅ SAFE |
| `ai_metrics.py:48-73` | Tries 11-col INSERT; catches `symbol`/`setup_score` error; falls back to 9-col INSERT; logs warning | ✅ SAFE |
| `telegram_notifier.py:144-152` | UPDATE includes both delivery cols; exception caught and logged at debug; delivery continues unaffected | ✅ SAFE (delivery works, tracking doesn't) |
| `outcome_learning.py:157-164` | **NO try/except on INSERT** — if `attribution_snapshots` missing, exception propagates to Celery beat task → entire nightly batch fails | 🔴 NOT SAFE |

### 4d. Unused Columns (schema drift)

| Column | Table | Added By | Code Reference | Classification |
|---|---|---|---|---|
| `scanner_mode_str` | `signals` | `edge-validation-migration.sql` | None found | UNUSED — redundant with `scanner_mode` |
| `pre_score` | `signals` | `edge-validation-migration.sql` | None found in scanner pipeline | UNUSED |
| `pre_score` | `signal_outcomes` | `edge-validation-migration.sql` | None found | UNUSED |
| `momentum_score` | `signal_outcomes` | `phase-7-4a-intelligence-migration.sql` | Not mapped in rowToSignal | LOW USE — written by scanner, not read in UI |

---

## 5. Part 4 — Probability Engine Validation

### 5a. Does `attribution_snapshots` table exist?

**Status: UNKNOWN (migrations not confirmed applied).** If not applied:
- `outcome_learning.py` INSERT → `UndefinedTable` exception on every nightly run
- `probability.py` SELECT → `UndefinedTable` or empty rows
- `edge-matrix` endpoint → returns `{"success": false}` or empty cohort list

### 5b. Nightly generation path

```
beat_schedule.py → 00:15 UTC → compute_attribution_snapshots task
  → outcome_learning.compute_snapshots()
      → SELECT from signal_outcomes (resolved last 30d)
      → aggregate 23 dimension sets
      → executemany INSERT INTO attribution_snapshots  ← NO try/except
```

**If table missing:** Exception at line 157 propagates → Celery task marked FAILED → no retry by default → cohort data never populates → probability engine permanently falls back to global.

**Nightly generation is NOT tolerant of missing schema.** This is the only major write path without defensive exception handling.

### 5c. Cohort hierarchy population after migration applied

**Hierarchy:** `regime|type|breakout` → `regime|type` → `regime` → `conf_band` → `global`

Requirements for non-global cohorts (n ≥ 30):
- Minimum ~30 resolved outcomes per cohort cell
- `window_days = 30` data (nightly batch populates this)
- `computed_at` within 48 hours (probability.py filter at line 86)

With a fresh production DB (no prior attribution snapshots):
1. First nightly run populates snapshots (assuming migration applied and outcomes exist)
2. Probability engine becomes useful once ≥30 resolved signals per cohort exist
3. Global fallback is used until cohorts reach n ≥ 30

**Expected cold-start timeline:** 7–14 days of production scanning before cohorts reach n ≥ 30 for common combinations.

### 5d. Fallback to global-only — detection

The probability engine logs its lookup level. Search logs for:
```
level='global'
```
If every signal shows `level='global'`, the table is either missing or under-populated. Target state: majority of signals show `level='regime|type'` or deeper.

---

## 6. Part 5 — Telegram Delivery Validation

### 6a. Does `telegram_delivered` exist and get populated?

**Status: UNKNOWN until migration applied.** If not applied:

```python
# telegram_notifier.py:144
"UPDATE signals SET telegram_delivered = $1, telegram_delivery_error = $2 WHERE id = $3::uuid"
```

The UPDATE silently fails (caught at line 151, logged debug). Telegram delivery itself **is not blocked** — the signal still sends. But:
- Every signal shows `telegram_delivered = NULL`
- TelegramDeliveryCard shows 100% "unresolved"
- Dedup-upgrade logic (`DEDUP_UPGRADE_DELTA`) cannot read prior confidence from cooldown correctly
- Delivery audit is blind

### 6b. Population verification (post-migration)

After migration applied, verify with:
```sql
SELECT 
  COUNT(*) FILTER (WHERE telegram_sent = true)             AS sent,
  COUNT(*) FILTER (WHERE telegram_delivered = true)        AS delivered,
  COUNT(*) FILTER (WHERE telegram_delivered = false)       AS failed,
  COUNT(*) FILTER (WHERE telegram_sent = true 
                    AND telegram_delivered IS NULL)        AS unresolved
FROM signals
WHERE created_at > NOW() - INTERVAL '24 hours';
```

Expected healthy state: `delivered / sent > 0.95`, `unresolved` near zero after 30-min drain window.

### 6c. `telegram_delivery_error` usage

Written by `telegram_notifier.py:144` only when `delivered=false` (send failed after retries). If delivery consistently fails, this column will contain the error message for diagnosis. Currently unmeasurable without the migration.

---

## 7. Part 6 — AI Traceability Validation

### 7a. Do `symbol` and `setup_score` exist on `ai_call_log`?

**Status: UNKNOWN until migration applied.** If not applied:
- `ai_metrics.py` falls back to 9-column INSERT (line 62) silently
- No error in logs (only `log.warning` if even the fallback fails)
- Claude cost attribution by symbol: impossible
- Kill-gate value (`AI_MIN_SETUP_SCORE = 78`) measurement: impossible
- P0 analysis question "which symbols consume most Claude tokens?" cannot be answered

### 7b. Post-migration verification

```sql
SELECT symbol, setup_score, COUNT(*) as calls, 
       AVG(latency_ms) as avg_latency_ms,
       SUM(prompt_tokens + completion_tokens) as total_tokens
FROM ai_call_log
WHERE created_at > NOW() - INTERVAL '7 days'
  AND symbol IS NOT NULL
GROUP BY symbol, setup_score
ORDER BY total_tokens DESC
LIMIT 20;
```

If `symbol IS NULL` for all rows: migration not yet applied or code not yet writing the new columns.

---

## 8. Critical Findings Summary (Updated Post-Verification)

| # | Finding | Severity | Status |
|---|---|---|---|
| F1 | 7 migrations applied to production | 🟢 RESOLVED | Confirmed via PostgREST 2026-06-16 |
| F2 | `market_regime` on `signal_outcomes` | 🟢 RESOLVED | Column exists + populated (backfill ran) |
| F3 | `outcome_learning.py` attribution INSERT has no try/except | ⚠️ WARNING | Code gap remains — moot now since table exists and 1,243 rows confirmed, but fragile if table is ever dropped/recreated |
| F4 | Probability cohort warmup needed | 🟢 RESOLVED | attribution_snapshots has 1,243 rows; empirical grades stamping live on signals |
| F5 | `telegram_delivered` NULL for all 626 sent signals | ⚠️ WARNING | Column exists but drain worker not writing back — WS2 delivery ground truth remains blind; delivery itself unaffected |
| F6 | `symbol`/`setup_score` on `ai_call_log` | 🟢 RESOLVED | Confirmed tracking live (SOL, VIRTUAL logged with setup_score) |
| F7 | `scanner_mode_str`, `pre_score` columns have no code readers | LOW | Unchanged — schema drift, no functional impact |

---

## 9. Exact SQL Required

### Step 1: Add `market_regime` to `signal_outcomes` (NEW — not in any existing migration)

This column is missing from `signal_outcomes` but queried by `performance_verification.py`. Create a new migration:

```sql
-- File: database/signal-outcomes-regime-migration.sql
-- Adds market_regime to signal_outcomes to match signals table (required by performance_verification.py)
ALTER TABLE signal_outcomes ADD COLUMN IF NOT EXISTS market_regime TEXT;

-- Backfill from joined signals table for existing resolved outcomes
UPDATE signal_outcomes so
SET market_regime = s.market_regime
FROM signals s
WHERE so.signal_id = s.id
  AND so.market_regime IS NULL
  AND s.market_regime IS NOT NULL;

-- Index for performance verification regime-based queries
CREATE INDEX IF NOT EXISTS idx_signal_outcomes_market_regime 
  ON signal_outcomes(market_regime) 
  WHERE market_regime IS NOT NULL;
```

### Step 2: Run the 6 existing migrations (in order)

```sql
-- 1. Validation source (must precede probability writes)
-- database/validation-source-migration.sql
-- Adds: signals.validation_source TEXT

-- 2. Probability gate columns
-- database/probability-gate-migration.sql  
-- Adds: signals.empirical_wr NUMERIC, signals.empirical_n INT
--       signal_outcomes.empirical_wr NUMERIC, signal_outcomes.empirical_n INT

-- 3. Probability engine (empirical grade)
-- database/probability-engine-migration.sql
-- Adds: signals.empirical_grade TEXT, signal_outcomes.empirical_grade TEXT

-- 4. Telegram delivery tracking
-- database/telegram-delivery-migration.sql
-- Adds: signals.telegram_delivered BOOLEAN, signals.telegram_delivery_error TEXT

-- 5. AI call log traceability
-- database/ai-call-log-trace-migration.sql
-- Adds: ai_call_log.symbol TEXT, ai_call_log.setup_score INT

-- 6. Attribution snapshots table (LAST — other migrations must be in place first)
-- database/attribution-snapshots-migration.sql
-- Creates: attribution_snapshots table with index
```

### Complete execution order:

```sql
-- Run in Supabase SQL Editor in this order:
\i database/signal-outcomes-regime-migration.sql    -- NEW: must create first
\i database/validation-source-migration.sql
\i database/probability-gate-migration.sql
\i database/probability-engine-migration.sql
\i database/telegram-delivery-migration.sql
\i database/ai-call-log-trace-migration.sql
\i database/attribution-snapshots-migration.sql     -- LAST
```

All 7 statements are idempotent. All use `IF NOT EXISTS`. Zero downtime. No locks on live traffic.

---

## 10. Post-Migration Verification Checklist

Run these queries in Supabase SQL Editor immediately after applying migrations:

```sql
-- 1. Confirm new columns exist on signals
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'signals'
  AND column_name IN (
    'validation_source', 'empirical_wr', 'empirical_n', 'empirical_grade',
    'telegram_delivered', 'telegram_delivery_error'
  )
ORDER BY column_name;
-- Expected: 6 rows returned

-- 2. Confirm new columns exist on signal_outcomes
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'signal_outcomes'
  AND column_name IN ('empirical_wr', 'empirical_n', 'empirical_grade', 'market_regime')
ORDER BY column_name;
-- Expected: 4 rows returned

-- 3. Confirm ai_call_log has new columns
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'ai_call_log'
  AND column_name IN ('symbol', 'setup_score')
ORDER BY column_name;
-- Expected: 2 rows returned

-- 4. Confirm attribution_snapshots table exists
SELECT COUNT(*) FROM attribution_snapshots;
-- Expected: returns 0 (empty until next nightly run at 00:15 UTC)

-- 5. Confirm index exists
SELECT indexname FROM pg_indexes
WHERE tablename = 'attribution_snapshots';
-- Expected: idx_attribution_snapshots_lookup

-- 6. Check existing signals for validation_source backfill
SELECT validation_source, COUNT(*) 
FROM signals
GROUP BY validation_source
ORDER BY COUNT(*) DESC;
-- Expected: NULL for pre-migration signals (backfill is per-design — no retroactive stamping)
```

---

## 11. Deployment Actions (Exact Order)

| Action | Who | When | Command |
|---|---|---|---|
| Create `signal-outcomes-regime-migration.sql` | Dev | Before deploy | Write new file (SQL in §9 Step 1) |
| Run all 7 migrations in Supabase SQL Editor | Dev | Before deploy, before scanner restart | Ordered sequence in §9 |
| Verify migrations applied | Dev | Immediately after | Verification queries in §10 |
| Restart Celery worker | Ops | After migrations confirmed | Railway redeploy worker |
| Monitor first nightly attribution batch | Dev | 00:15 UTC following night | Check Celery beat logs for UndefinedTable errors |
| Verify probability cohorts populated | Dev | Next day | `SELECT COUNT(*), dim_key FROM attribution_snapshots GROUP BY dim_key` |
| Confirm telegram_delivered populating | Dev | After next scan | Verification query in §6b |

---

## 12. GO / NO-GO for Signal Quality Audit

| Requirement | Status | Evidence |
|---|---|---|
| `empirical_wr`, `empirical_n` populated on signals | ✅ MET | Live: `wr=27.78%, 31.21%, 40.65%` on recent signals |
| `empirical_grade` on signals | ✅ MET | Live: `D`, `B`, `C` grades stamping on new signals |
| `attribution_snapshots` populated with ≥30 cohort rows | ✅ MET | **1,243 rows** across regime/oi/other dims; n=677, 992, 200 in top cohorts |
| `validation_source` for SCREENED vs AI_APPROVED split | ✅ MET | Live: recent signals show `HEURISTIC` (AI currently off) |
| `market_regime` queryable from `signal_outcomes` | ✅ MET | Column exists + populated from backfill |
| `telegram_delivered` for delivery accuracy | ⚠️ PARTIAL | Column exists; NULL for all 626 sent signals (drain worker not writing — F5) |

**VERDICT: GO.**

Remaining gap (F5 `telegram_delivered` = NULL) is a monitoring blind spot, not a signal quality blocker. The audit can proceed on:
- Empirical grade vs heuristic grade comparison ✅
- Probability cohort WR vs stated confidence ✅
- Validation source SCREENED/AI_APPROVED split ✅
- Regime-conditional performance verification ✅
- AI call log cost attribution by symbol ✅
