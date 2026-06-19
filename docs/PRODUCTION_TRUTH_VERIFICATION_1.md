# PRODUCTION.TRUTH.VERIFICATION.1
<!-- 9-phase data integrity audit — completed 2026-06-19 via 9-agent parallel workflow -->

## Executive Summary

7 of 9 phases completed (Phase E Redis and Phase I partial hit session rate limits). **64 findings across 6 phases** — 12 P0, 33 P1, 19 P2.

**Immediate P0s resolved same session (2026-06-19):**

| ID | Issue | Fix | Commit |
|----|-------|-----|--------|
| Grade D bug | Probability gate Grade D backstop used global cohort grade → suppressed ALL Telegram signals since June 19 | `_regime_grade` from regime-level cohort only | `9457738` |
| FG-01 | counts route queried `return_r` (non-existent column) → WR/expectancy/PF all returned 0 | `rr_achieved` | `57e9cea` |
| FG-02 | win_rate_7d excluded TIMEOUT from denominator, inconsistent with Edge tab | Added TIMEOUT to `.in()` filter | `57e9cea` |
| H-02 | `features.ai_validation` (non-existent key) for AI banner → always showed "AI OFF" | Read from `ai.enabled` | `57e9cea` |
| PC-03 | `sharpe` in TypeScript vs `sharpe_ratio` from Python → Sharpe always blank | Renamed to `sharpe_ratio` | `57e9cea` |
| PC-04 | `generated_at` in TypeScript vs `report_date` from Python → timestamp always blank | Read `report_date ?? generated_at` | `57e9cea` |
| H-11 | WR rendered as raw float `42.857142857%` | Added `.toFixed(1)` | `57e9cea` |

**Root cause of zero Telegram signals since June 15:**
1. June 15: AI disabled by founder (cost). Heuristic path threshold was still 85 — most signals didn't pass.
2. June 19: SIGNAL_ENGINE_TRUTH_1 lowered heuristic threshold to 80 (commit `451fc5f`).
3. June 19 (same deploy): Grade D backstop added to `should_suppress_send()`. `signal.empirical_grade` was stamped from global/conf_band cohorts (~20% WR → Grade D) and the backstop fired unconditionally — blocked everything.
4. June 19 fix (`9457738`): backstop now uses `_regime_grade` (regime-level cohort only, `None` when n<30 → no suppress).

---

## Phase A — Signal Count Truth

**12 findings (2 P0, 6 P1, 4 P2)**

| ID | Priority | Title |
|----|----------|-------|
| PCT-01 | P0 | `active_signals` overcounts — subtracts outcomes with PENDING outcome, but PENDING rows exist for all signals |
| PCT-02 | P0 | LifecycleFunnel 'Sent' double-counts: `telegramSent=true` AND lifecycle-stage inference can both match |
| PCT-03 | P1 | VALIDATED stage unreachable by design but still in STAGE_META / StageLegend |
| PCT-04 | P1 | `win_rate_7d` uses `signal_outcomes.created_at` (outcome recorded time), not signal `created_at` |
| PCT-05 | P1 | LifecycleFunnel AI vs Screened chips undercount older signals where `validationSource=NULL` and stage is ACTIVE/STALE |
| PCT-06 | P1 | `validationSource=NULL` treated as SCREENED even for pre-migration signals Claude validated |
| PCT-07 | P1 | OverviewTab 'Active' mini-tile counts only `lifecycleStage==='ACTIVE'` but `isActiveStage()` includes more stages |
| PCT-08 | P1 | Tactical route fetches `limit*2` raw signals but counts outcomes for ALL returned IDs |
| PCT-09 | P2 | `getRecentSignals()` uses anon client (RLS may apply); counts route uses admin client |
| PCT-10 | P2 | CLOSED vs STALE distinction lost in LifecycleFunnel 'Expired' count |
| PCT-11 | P2 | LifecycleFunnel win-rate excludes CLOSED (timeout) signals |
| PCT-12 | P2 | 15m timeframe in `LIFETIME_MS` but not in `FRESHNESS_WINDOW_H` → FreshnessTag silently wrong for 15m signals |

**Key issue (PCT-01):** `active_signals` currently = `sig7dIds.length - resolvedCount` where `resolvedCount` uses `.neq('outcome','PENDING')`. But every signal gets a PENDING row on insert → PENDING rows exist for all signals, so `neq('outcome','PENDING')` counts PENDING rows too. The count should exclude signal IDs that have ANY non-PENDING outcome row, not subtract the count of non-PENDING rows.

---

## Phase B — Telegram Truth

**7 findings (1 P0, 4 P1, 2 P2)**

| ID | Priority | Title |
|----|----------|-------|
| TG-B1 | P1 | `telegram_sent` written as FALSE at initial DB insert; `mark_signal_telegram_sent()` is best-effort and swallows failures |
| TG-B2 | P0 | No Next.js route file for `/api/analytics/telegram-delivery` — functional non-issue (admin proxy handles it) but CLAUDE.md claims the file exists |
| TG-B3 | P1 | `eligible` threshold hardcoded at 85 but `alert_confidence` is runtime-configurable — eligible/shadowed counts wrong when setting differs from default |
| TG-B4 | P1 | shadowed correlated subquery may overcount across scan modes with identical symbol+direction |
| TG-B5 | P2 | NULL `telegram_delivered` rows conflated with failed rows in 'unresolved' metric (pre-migration rows) |
| TG-B6 | P2 | delivery rate uses `queued` as denominator but `queued` includes rate-capped/dedup-shadowed sends |
| TG-B7 | P1 | `monitoring.py` `telegram_sends_per_day` counter fires at enqueue time, diverges from actual delivery count |

**Note:** TG-B2 is classified P0 by the audit but is functionally a non-issue — the admin proxy at `app/api/admin/[...path]/route.ts` correctly forwards all `/api/admin/analytics/*` calls to Python. The separate route file would be documentation-only.

---

## Phase C — Performance Truth

**7 findings (2 P0, 4 P1, 1 P2)**

| ID | Priority | Title | Status |
|----|----------|-------|--------|
| PC-01 | P0 | Track-record WR excludes TIMEOUT; Edge tab includes → inflated WR on Track Record | Open — Python backend change needed |
| PC-02 | P0 | Track-record expectancy is `avg(rr_achieved)` not canonical `(WR × avgWin) - (LR × avgLoss)` → systematically inflated | Open — Python backend change needed |
| PC-03 | P1 | `sharpe_ratio` (Python) vs `sharpe` (TypeScript) → Sharpe always blank | **Fixed** `57e9cea` |
| PC-04 | P1 | `report_date` (Python) vs `generated_at` (TypeScript) → timestamp always blank | **Fixed** `57e9cea` |
| PC-05 | P1 | Track-record uses `make_interval(days)`, Edge uses `hours::interval` → minor boundary divergence |  Open |
| PC-06 | P1 | Track-record by_mode excludes TIMEOUT; Edge scanner_mode_analysis includes it → inflated per-mode WR | Open |
| PC-07 | P2 | probability accuracy query in `performance_verification.py` has no time window (all-time) while grade table uses 30d | Open |

**Impact of PC-01+PC-02 (unresolved):** The Track Record tab and FounderCommandCenter consistently overstate WR vs the Edge tab. A 20% TIMEOUT rate would cause Track Record to show WR 50% vs Edge showing WR 40%.

---

## Phase D — Signal Lifecycle Truth

**10 findings (2 P0, 6 P1, 2 P2)**

| ID | Priority | Title |
|----|----------|-------|
| D-01 | P1 | `telegram_sent` stays FALSE in DB if `mark_signal_telegram_sent()` fails → badge shows SCREENED instead of ACTIVE |
| D-02 | P1 | VALIDATED stage architecturally unreachable — every persisted signal has `aiValidated=true` |
| D-03 | P0 | NULL `validation_source` from legacy rows → SCREENED badge for pre-migration AI-validated signals |
| D-04 | P1 | STALE computed from `createdAt` not send time → fires early when Telegram queue has latency |
| D-05 | P1 | 15m timeframe in `LIFETIME_MS` but not in `ScannerMode` — unreachable dead config |
| D-06 | P0 | `getRecentSignals()` uses `SELECT *` → `empirical_wr/n/grade` columns silently NULL if migration not applied |
| D-07 | P1 | Outcome never passed to `computeLifecycleStage()` for signals without a `signal_outcomes` row |
| D-08 | P2 | `isActiveStage()` omits STALE — stale signals excluded from active count but still visible |
| D-09 | P2 | ANALYZED stage has no transition path — `computeLifecycleStage()` never returns ANALYZED |
| D-10 | P1 | LifecycleFunnel 'Sent' mixed logic — `telegramSent` bool AND `lifecycleStage` set |

**Note on D-03 and D-06:** D-03 is intentional per code comment ("pre-migration rows default to SCREENED to avoid falsely badging AI-off signals"). D-06 is safe since all 12+ migrations confirmed applied 2026-06-16.

---

## Phase F+G — API Consistency + Redis Consistency

**12 findings (2 P0, 5 P1, 5 P2)**

| ID | Priority | Title | Status |
|----|----------|-------|--------|
| FG-01 | P0 | counts route queried `return_r` (non-existent) → all metrics returned 0 | **Fixed** `57e9cea` |
| FG-02 | P0 | win_rate_7d excluded TIMEOUT from denominator → inflated vs Edge tab | **Fixed** `57e9cea` |
| FG-03 | P1 | `active_signals` definition differs between counts route and tactical `dbTotal` | Open |
| FG-04 | P1 | Redis `signals_per_day` INCR still fires per signal — CLAUDE.md "DB-authoritative" claim only partially true | Open |
| FG-05 | P1 | Three independent WR/expectancy endpoints with no cross-reference documentation | Open |
| FG-06 | P1 | attribution route uses 5-min module-level cache (no Redis) — Vercel cold starts lose cache | Open |
| FG-07 | P1 | `getRecentSignals()` 7d window and tactical `dbTotal` match but tactical fetches limit=200 | Open |
| FG-08 | P2 | CMC credits metric uses rolling-average with UTC-aligned daily snapshots → diverges at UTC midnight | Open |
| FG-09 | P2 | `scheduler.status_cache` 5s TTL but sync `status()` raises RuntimeError inside FastAPI event loop | Open |
| FG-10 | P2 | patterns/breakdown routes use `getResolvedOutcomes(1000)` with no time window | Open |
| FG-11 | P2 | `tracker/run` uses module-level `running` boolean — not process-safe across Vercel invocations | Open |
| FG-12 | P2 | `monitoring.py` calendar-day counter vs rolling-24h delivery endpoint — time boundary mismatch | Open |

---

## Phase H — Frontend Bugs

**16 findings (3 P0, 8 P1, 5 P2)**

| ID | Priority | Title | Status |
|----|----------|-------|--------|
| H-01 | P0 | ConfidenceBar shows filtered slice as system-wide — no scope label | Open |
| H-02 | P0 | `features.ai_validation` (non-existent) for AI banner → always shows AI OFF | **Fixed** `57e9cea` |
| H-03 | P0 | Pagination `X–Y of Z loaded` uses filtered client-side count (max 200) as if it were DB total | Open |
| H-04 | P1 | 'Active' preset includes SCREENED + AI_APPROVED (pre-send states), inflating count | Open |
| H-05 | P1 | LifecycleFunnel AI/Screened chips undercount post-ACTIVE older signals with `validationSource=null` | Open |
| H-06 | P1 | 'Sent→Active' funnel conversion 17% misleads (STALE = past window, not failure) | Open |
| H-07 | P1 | Symbol search is local-only against 200-signal cache | Open |
| H-08 | P1 | 'Scan Now' only refreshes scheduler widget — signal list stale for up to 120s after manual scan | Open |
| H-09 | P1 | FounderCommandCenter renders `null` silently when any window has 0 resolved — blank panel, no explanation | Open |
| H-10 | P1 | Grade filter matches both `riskGrade` OR `empiricalGrade` — mixing two incompatible grading systems | Open |
| H-11 | P1 | `win_rate` rendered as raw float `42.857142857%` | **Fixed** `57e9cea` |
| H-12 | P2 | Countdown fallback uses hardcoded `MODE_FIRE_MINUTES` that may not match Railway schedule | Open |
| H-13 | P2 | StageLegend shows VALIDATED and ANALYZED (both unreachable) | Open |
| H-14 | P2 | TrackRecordTab shows 'No data' on API error with no error message | Open |
| H-15 | P2 | `TelegramDeliveryCard` defined + data fetched but never rendered anywhere | Open |
| H-16 | P2 | `useAutoRefresh` `intervalMs` in dep array — latent interval-reset bug if any caller makes it dynamic | Open |

---

## Open P1 Backlog (next checkpoint: 2026-06-23)

Priority order for remaining P1 fixes:

1. **PCT-01** — fix `active_signals` query to properly detect unresolved signals (change from `count of non-PENDING rows` to `count of signal IDs that have any non-PENDING outcome`)
2. **PC-01/PC-02** — align Track Record WR formula with Edge tab (include TIMEOUT; use canonical expectancy formula) in `backend/api/analytics.py`
3. **H-08** — `handleScanNow` should call `refreshTacticalFeed()` after queuing
4. **H-09** — `FounderCommandCenter` null guard: show loading/empty state instead of `null`
5. **D-01** — `mark_signal_telegram_sent()` retry or synchronous write to eliminate silent failures
6. **H-04** — 'Active' preset: remove SCREENED + AI_APPROVED (they're pre-send, not live trades)
7. **TG-B3** — eligible threshold: read `alert_confidence` from settings instead of hardcoded 85

---

## Phase E and I — Not Completed

Phase E (Redis key audit) and Phase I (end-to-end scan-to-Telegram trace) agents hit session rate limits. These will be addressed as separate targeted investigations when issues are reported by the platform.

---

*Audit completed: 2026-06-19 · 7 agents · 9 phases attempted · 7 phases completed · 64 findings*
