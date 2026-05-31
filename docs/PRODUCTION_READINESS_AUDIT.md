# Production Readiness Audit

**Date:** 2026-05-30  
**Last Updated:** 2026-05-30 (Phase 7.2B.7.1–7.2B.7.5)  
**Overall Score:** 8.7 / 10  
**Verdict:** ✅ GO

---

## Phase 7.2B.7 — Remediation Summary

All BLOCKERS and HIGH PRIORITY items resolved. 2 of 6 MEDIUM items resolved.

| Phase | Commit | Items |
|-------|--------|-------|
| 7.2B.7.1 — Security Blockers | `478fc54` | B1 (git audit — clean), B2 (ADMIN_SECRET min 32) |
| 7.2B.7.2 — Scheduler Stability | `74672c1` | H2 (Celery timeout), H3 (Beat expiry), H4 (infra_collector loop) |
| 7.2B.7.3 — Logging Cleanup | `d37cba6` | H1 (console.log → pino in scheduler + backtest), L1 |
| 7.2B.7.4 — Anthropic Rate Protection | `1a471c2` | H5 (12 RPM sliding window + 429 retry) |
| 7.2B.7.5 — Scanner Calibration | `fe99495` | M1 (setup gate 60→72), M6 (pre_score clamped to 100) |

---

## Scores by Area

| Area | Score | Status |
|------|-------|--------|
| Scanner Engine | 8.5/10 | ✅ Production ready |
| CMC Intelligence | 8.0/10 | ✅ Production ready |
| Binance Intelligence | 9.0/10 | ✅ Production ready |
| End-to-End Integration | 8.5/10 | ✅ Production ready |
| Dashboard UX | 8.0/10 | ✅ All 13 pages updated (Phase 7.2B) |
| Performance | 7.0/10 | ⚠️ Pagination added, refresh intervals hardcoded |
| Security | 8.0/10 | ✅ B1 clean, B2 enforced, secrets in env |
| Mobile | 7.5/10 | ✅ No horizontal scroll (except Tactical Feed — Phase 7.5) |

---

## BLOCKERS — ALL RESOLVED

**B1 — .env.local git history exposure** ✅ RESOLVED (7.2B.7.1)

`git log --all -- .env.local` confirmed no commit in history. No credential rotation required.

---

**B2 — ADMIN_SECRET optional in TypeScript** ✅ RESOLVED (7.2B.7.1)

`lib/env.ts`: changed from `z.string().optional()` to `z.string().min(32, '...')`. Startup now fails fast if ADMIN_SECRET is absent or under-length. Commit `478fc54`.

---

## HIGH PRIORITY — ALL RESOLVED

**H1 — console.log in lib/scheduler.ts and lib/backtest.ts** ✅ RESOLVED (7.2B.7.3)

18 occurrences in `scheduler.ts`, 2 in `backtest.ts` replaced with structured pino logger (`createLogger('lib/scheduler')` / `createLogger('lib/backtest')`). Fields: `mode`, `triggeredBy`, `retryCount`, `durationMs`, `consecutiveFailures`, `symbol`, `trades`. Commit `d37cba6`.

---

**H2 — Celery scan task timeout collision** ✅ RESOLVED (7.2B.7.2)

`backend/workers/scan_task.py`:
- `soft_time_limit`: 840s → 1020s (17 min) — 180s buffer above worst-case 80-coin scan (~840s)
- `time_limit`: 960s → 1140s (19 min) — 2-min gap for graceful SoftTimeLimitExceeded handler

Commit `74672c1`.

---

**H3 — Beat schedule task expiry too tight** ✅ RESOLVED (7.2B.7.2)

`backend/workers/beat_schedule.py`: `expires` for all 3 scan tasks (standard, high_confidence, futures): 780s → 1020s (17 min). Now matches `soft_time_limit` so delayed queued tasks can still complete. Commit `74672c1`.

---

**H4 — infra_collector.py loop swallows exceptions silently** ✅ RESOLVED (7.2B.7.2)

`backend/metrics/infra_collector.py`: Added `try/except Exception as exc` around `await _collect_once()` in `_run_loop()`. Logs `infra_collector_error` warning instead of crashing the metrics loop. Commit `74672c1`.

---

**H5 — No per-minute Anthropic API rate limit** ✅ RESOLVED (7.2B.7.4)

`backend/core/scanner/ai_validator.py`:
- `_SlidingWindowRateLimiter` (12 RPM ceiling) — `acquire()` blocks until slot available in rolling 60-s window
- Retry loop inside `Semaphore(3)`: on `RateLimitError`, retries up to 2× with exponential back-off (5s, 10s)
- Exhausted retries: logs `ai_rate_limit_exhausted`, re-raises → caught by outer `except Exception` → heuristic fallback
- Existing `Semaphore(3)` concurrency cap unchanged

Commit `1a471c2`.

---

## MEDIUM PRIORITY

| # | Issue | Status |
|---|-------|--------|
| M1 | Setup score 60 + AI threshold 72 = dead zone for signals 60-71 | ✅ RESOLVED (7.2B.7.5) |
| M2 | `_register_analytics()` fire-and-forget: done-callback reliability | 🔶 Pending |
| M3 | Frontend refresh intervals hardcoded, no jitter | 🔶 Pending |
| M4 | ATR minimum relative floor missing | 🔶 Pending |
| M5 | Signal rejection reasons not persisted to database | 🔶 Pending |
| M6 | Breakout score bonus not clamped at detect_setup level | ✅ RESOLVED (7.2B.7.5) |

**M1 detail** — `backend/core/scanner/signal_pipeline.py`: setup gate raised from `score >= 60` to `score >= 72`. Signals with scores 60-71 no longer enter the pipeline and reach heuristic — they were wasting steps and almost never reached `min_confidence` anyway. Commit `fe99495`.

**M6 detail** — `backend/core/scanner/signal_pipeline.py`: `score = min(score, 100)` added before `SetupResult` construction. A perfect setup could previously accumulate ~199 points; clamped to 100. Commit `fe99495`.

---

## LOW PRIORITY

| # | Issue | Status |
|---|-------|--------|
| L1 | lib/backtest.ts had console.log | ✅ RESOLVED (7.2B.7.3 — included in H1 fix) |
| L2 | Sector intelligence Redis baseline not durable | 🔶 Pending |
| L3 | Overview page fetches 5 APIs every 15s without batching | 🔶 Pending |
| L4 | pendingRestartFields not memoized in Settings | 🔶 Pending |
| L5 | Admin layout space-y-0 inconsistency | 🔶 Pending |

---

## Remaining Phase 8 Improvements (deferred)

1. Signal rejection reason persistence (M5)
2. Refresh interval jitter + centralized config (M3)
3. ATR minimum relative floor (M4)
4. Sector intelligence Redis baseline durability (L2)
5. cache:intel:global BTC dominance reader

---

*Last updated: 2026-05-30*  
*Phase 7.2B.7.1–7.2B.7.5 remediation complete*
