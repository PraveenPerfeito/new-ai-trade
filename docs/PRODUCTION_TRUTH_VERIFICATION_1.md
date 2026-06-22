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

---

## SECOND PASS ADDENDUM — 2026-06-22

**Method:** 4 parallel agents re-audited phases A, E, F+G, H with full file reads. All 9 phases now complete.  
**New findings:** 32 additional bugs (4 new P0, 14 new P1, 14 new P2) beyond the June 19 report.

### New P0 Findings

#### P0-NEW-01 · `flags.telegram` always `false` — SystemStatusBanner permanently shows "TELEGRAM OFF"

**Files:** `app/admin/signals/page.tsx:2208–2218`

`flagsFetcher` in `signals/page.tsx` fetches only the `features` group and reads `field(featRes, 'telegram')`. The `features` group has no `telegram` key — that key lives in `telegram.alerts_enabled`. The field lookup returns `undefined` → `Boolean(undefined) = false` → `flags.telegram` is permanently `false`. The SystemStatusBanner always displays "TELEGRAM OFF" regardless of actual state.

**Context:** H-02 (fixed in `57e9cea`) corrected `features.ai_validation` → `ai.enabled` for the AI banner. That same fix was NOT applied to the Telegram banner. The same pattern broke in both places.

**Fix (5 min):** In `flagsFetcher`, add `adminApi.settings.group('telegram')` to the Promise.all, then read `field(teleRes, 'alerts_enabled')` for `flags.telegram`. The correct implementation is already in `system/page.tsx:sysFlagsFetcher`.

---

#### P0-NEW-02 · LifecycleFunnel "Generated" count is capped at `limit=200`, not the true DB total

**Files:** `app/admin/signals/page.tsx:1287,1683–1714`

Funnel "Generated" = number of signals returned by the tactical feed (capped at `limit=200`). When there are 300+ signals in the 7-day window, the funnel shows "Generated = 200" and all downstream conversion rates are wrong. The true DB total (`dbTotal`) is available in the API response but is never passed to `LifecycleFunnel`.

**Fix (15 min):** Pass `dbTotal` as a prop to `LifecycleFunnel` and use it for the "Generated" step.

---

#### P0-NEW-03 · LifecycleFunnel double-counts `TELEGRAM_SENT` — Active > Sent paradox

**Files:** `app/admin/signals/page.tsx:1697`

`TELEGRAM_SENT` signals are counted in both the `sent` funnel step and the `active` funnel step. This makes Active > Sent mathematically possible, producing >100% conversion in the funnel display.

**Fix (5 min):** Remove `s.lifecycleStage === 'TELEGRAM_SENT'` from the `active` filter in `LifecycleFunnel`. `TELEGRAM_SENT` is already in `sentStages`.

---

#### P0-NEW-04 · Tactical route outcome map non-deterministic — resolved signals may appear ACTIVE

**Files:** `app/api/signals/tactical/route.ts:43–59`

The outcome fetch has no `ORDER BY` and no `.neq('outcome', 'PENDING')` filter. If a signal has both a PENDING row and a TP_HIT row in `signal_outcomes`, the `outcomeMap.set(signal_id, row)` loop keeps whichever row DB returns last. Row order is undefined without `ORDER BY`. A resolved signal shows as ACTIVE intermittently depending on Postgres execution plan.

**Fix (5 min):** Add `.neq('outcome', 'PENDING')` to the outcome query. If a signal has no non-PENDING row, it correctly gets no outcome → ACTIVE/SCREENED/etc.

---

### New P1 Findings — Signal Counts (Phase A)

| ID | Title | File | Fix |
|----|-------|------|-----|
| SIGCNT-A1 | `signals_today` is rolling 24h window labeled "Today" — does not reset at midnight, drifts throughout day | `api/signals/counts/route.ts:20–25` | Rename label to "Last 24h" or change to calendar-day query |
| SIGCNT-A2 | Active preset badge counts use unfiltered `signals` array — ignore `modeFilter`, `typeFilter`, `gradeFilter`. Badge shows "Active (47)" but list shows 8 results after mode filter. | `signals/page.tsx:1324–1328` | Compute counts from post-filter `filtered` array |
| SIGCNT-A3 | Mode filter is client-side only. API is called without `mode` param. With >200 signals in 7d, filtered results from signals #201+ are silently absent. | `signals/page.tsx`, `api/signals/tactical/route.ts` | Pass mode/type/grade as API query params |
| SIGCNT-A4 | Pagination footer "N of M in last 7d" — M is unfiltered DB count. With mode filter active: "5 of 847" → user thinks 842 results are hidden. | `signals/page.tsx:1494–1497` | Show "5 matched · 847 total (unfiltered)" |
| SIGCNT-A5 | AI/Screened funnel chips use `validationSource === 'CLAUDE' \|\| lifecycleStage === 'AI_APPROVED'` — can double-count signals that match both conditions | `signals/page.tsx:1691–1692` | Use `lifecycleStage === 'AI_APPROVED'` and `=== 'SCREENED'` only |
| SIGCNT-A6 | "Sent" defined differently in 3 places: preset `['TELEGRAM_SENT']`, OverviewTab broadens to include ACTIVE/STALE/TP_HIT/SL_HIT, LifecycleFunnel uses union. Three "sent" counts on same page. | `signals/page.tsx:1140,1274–1280,1695–1696` | Standardise to `telegramSent === true` everywhere |

---

### New P1 Findings — Dashboard Wiring (Phase E)

| ID | Title | File | Fix |
|----|-------|------|-----|
| DASH-E1 | `adminApi.scheduler.status()` return type missing `next_scan_at`, `is_overdue`, `last_scan_age_seconds` — Scanner tab "Next Scan" countdown and "Overdue" indicator always show `—` / `false` | `lib/admin-api.ts` | Extend return type with three optional fields |
| DASH-E2 | `AlphaWatchlist` uses raw `fetch('/api/signals/watchlist')` outside `adminApi`; `.catch(() => [])` swallows all errors (401, 404, network) — silent empty list | `signals/page.tsx:AlphaWatchlist` | Add `adminApi.signals.watchlist()` typed method; surface errors |
| DASH-E3 | `WrSparkBar` expects win_rate as 0–1 (multiplies by 100); `TrackRecordTab` expects 0–100 (appends `%`). `AttributionDimension.winRate` — one consumer is always wrong. | `performance/page.tsx`, `types/index.ts` | Check backend scale; normalize and document in the type |
| DASH-E4 | `DimTable` calls `rows.length` without null guard — throws `TypeError` if a dimension key is absent from the attribution response | `performance/page.tsx:DimTable` | Change `if (!rows.length)` to `if (!rows?.length)` |
| DASH-E5 | `RegimeHardGateCard` and `GradeValidationStrip` bypass shared polling, fire `useEffect` on every tab mount — duplicate API calls outside the 120s polling budget | `signals/page.tsx` | Lift to parent page polling registry or increase intervals |

---

### New P1 Findings — API Consistency (Phase F)

| ID | Title | File | Fix |
|----|-------|------|-----|
| APIC-F1 | (Confirms FG-05 with root cause) Three `/api/signals/counts`, `monitoring.py`, `analytics.py` compute win_rate with different TIMEOUT inclusion — max divergence ≥15pp | See above FG-05 | Delegate all three to `expectancy.py:compute_stats()` |
| APIC-F2 | Tactical route `dbTotal` counts signals with only `minConfidence` applied — when type/mode filters are active, pagination "of N" refers to unfiltered DB count | `api/signals/tactical/route.ts:24–32` | Rename `dbTotal` → `dbTotalUnfiltered` in response and update UI label |
| APIC-F3 | Tactical route outcome fetch failure returns HTTP 200 with empty outcome map — all lifecycle stages silently show as ACTIVE. No way to detect from response. | `api/signals/tactical/route.ts:57–59` | Add `outcomesError: boolean` to response; show stale-data warning in UI |

---

### New P1 Findings — Redis Consistency (Phase G)

| ID | Title | File | Fix |
|----|-------|------|-----|
| REDIS-G1 | `telegram_sends_per_day` counter is Redis-only. Returns 0 on quota exhaustion — monitoring shows "0 Telegram sends" precisely when you most need to see it. No DB fallback. | `monitoring.py:108–109` | Add DB fallback: `SELECT COUNT(*) FROM signals WHERE telegram_sent AND created_at > NOW() - INTERVAL '24h'` |
| REDIS-G2 | `binance_errors_per_day` is Redis-only. Anomaly detection `if binance_errs >= 15` silently stops working during Redis outage — the exact scenario most likely to coincide with Binance errors. | `monitoring.py:111,234,389` | Accept limitation; add warning log when counter returns 0 after a scan |

---

### New P2 Findings

| ID | Title | File |
|----|-------|------|
| P2-N01 | `VALIDATED` stage unreachable by design but in `STAGE_META`, `STAGE_TIPS`, `tacticalQuerySchema`, `isTerminalStage` (also noted as PCT-03) | `lib/signal-lifecycle.ts`, `lib/validate.ts`, `signals/page.tsx` |
| P2-N02 | `ANALYZED` stage: `computeLifecycleStage()` never returns it but in `isTerminalStage()`, `STAGE_META`, `STAGE_TIPS`, schema enum — always 0 results | same files |
| P2-N03 | `adminApi.analytics.regime()` typed as `Record<string,unknown>` — double `as` cast hides backend field rename risk | `lib/admin-api.ts` |
| P2-N04 | `/api/analytics/attribution` not in `adminApi` — raw fetch with silent error swallow on non-200 response | `performance/page.tsx`, `lib/admin-api.ts` |
| P2-N05 | `ai?.verdicts ?? ai?.verdict_distribution` dual-key fallback in AttributionTab — masks which field name backend actually returns | `performance/page.tsx` |
| P2-N06 | `intel:quota:used` billing-cycle reset: after counter resets to 0, prior-month snapshots cause `cmc_credits_per_day = 0` for first 7 days of each billing month | `monitoring.py:249–279` |
| P2-N07 | `_initialized_keys` set in `monitoring.py` never prunes — grows ~5 entries/day indefinitely in long-running worker | `monitoring.py:43–55` |
| P2-N08 | `signals_cache` TTL = 30s; dashboard polling interval = 60–120s — every second poll is a cache miss, defeating the cache purpose | `backend/cache/redis_cache.py:147` |
| P2-N09 | SystemPage provider health fetch is raw `fetch()` outside `adminApi` — errors silently produce empty provider list | `system/page.tsx` |
| P2-N10 | `MonitorRow` calls `.toLocaleString()` on metric value without null guard — renders "NaN" if any counter is NULL on first day of deployment | `system/page.tsx:MonitorRow` |
| P2-N11 | `PipelineIntegrityCard` hardcodes `"12"` in gate coverage display — stale when a gate is added to `PIPELINE_CANON_KEYS` | `system/page.tsx` |
| P2-N12 | `GradeValidationStrip` has its own unshared 300s poll — fires on every signals page mount outside the shared polling registry | `signals/page.tsx:442–443` |
| P2-N13 | `AlphaWatchlist` polls at 120s even when section is collapsed and invisible | `signals/page.tsx:AlphaWatchlist` |
| P2-N14 | All `SignalsTab` filter/sort state lost on tab navigation — remount resets to defaults silently | `signals/page.tsx:2329` |

---

### Updated Open P1 Backlog — Priority Order (post-second-pass)

1. **P0-NEW-01** — Fix `flags.telegram` → read `telegram.alerts_enabled` (5 min, eliminates false TELEGRAM OFF banner)
2. **P0-NEW-04** — Add `.neq('outcome','PENDING')` to tactical outcome query (5 min, fixes intermittent resolved→ACTIVE)
3. **P0-NEW-03** — Remove TELEGRAM_SENT from LifecycleFunnel `active` filter (5 min, eliminates Active > Sent paradox)
4. **P0-NEW-02** — Pass `dbTotal` to LifecycleFunnel as "Generated" (15 min, funnel conversion rates become meaningful)
5. **SIGCNT-A2** — Compute preset badge counts from filtered array (30 min, badge N matches list length)
6. **APIC-F3** — Add `outcomesError` to tactical response (15 min, operators know when lifecycle data is stale)
7. **PC-01/PC-02** — Align Track Record WR formula with Edge tab (1 hr, three surfaces show same win rate)
8. **REDIS-G1** — Add DB fallback for telegram_sends_per_day (1 hr, monitoring survives Redis quota exhaustion)
9. **DASH-E1** — Extend `adminApi.scheduler.status()` return type (15 min, next-scan countdown renders)
10. **DASH-E4** — Null guard in `DimTable.rows.length` (5 min, prevents Attribution tab crash)

---

### Documentation Gaps (new)

| ID | Issue | File |
|----|-------|------|
| DOC-01 | `DEPLOYMENT.md` Step 5d and Step 6b placeholder `REDIS_URL` still shows `...upstash.io:6379` — wrong host format for Redis Cloud (should be `...db.redis.io:<port>`) | `DEPLOYMENT.md:176,230` |
| DOC-02 | `README.md` local dev section lists only 5 migration files; `DEPLOYMENT.md` lists 21. A developer following README misses 16 required migrations. | `README.md:174–177` |
| DOC-03 | `API_REFERENCE.md` local URLs table references pages consolidated in ADMIN.CONSOLIDATION.1 (`/admin/scanner`, `/admin/calibration`, `/admin/anomalies`, etc.) | `API_REFERENCE.md:12–19` |

---

*Second pass completed: 2026-06-22 · 4 agents · phases A, E, F+G, H re-audited · 32 additional findings*
