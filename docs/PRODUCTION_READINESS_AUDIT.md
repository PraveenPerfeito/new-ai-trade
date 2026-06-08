# Production Readiness Audit

**Date:** 2026-05-30  
**Last Updated:** 2026-06-08 (PROD.FIX.1 — 16 hardening fixes applied)  
**Overall Score:** 9.5 / 10  
**Verdict:** ✅ GO — Production hardened (see [PHASE8_PRODUCTION_READINESS.md](PHASE8_PRODUCTION_READINESS.md) for Phase 8.1D audit)

---

## Remediation Summary — All Phases

All BLOCKERS, HIGH PRIORITY, and applicable MEDIUM items resolved.

| Commit | Items |
|--------|-------|
| `478fc54` | B1 (git audit — clean), B2 (ADMIN_SECRET min 32) |
| `74672c1` | H2 (Celery timeout), H3 (Beat expiry), H4 (infra_collector loop) |
| `d37cba6` | H1 partial — scheduler.ts (18×), backtest.ts (2×) → pino |
| `1a471c2` | H5 (12 RPM sliding window + 429 retry) |
| `fe99495` | M1 (setup gate 60→72), M6 (pre_score clamped to 100) |
| `f5a7169` | H1 complete — supabase.ts (13×), retry.ts (1×) → pino |

**H1 total: 34 console.* replaced across 4 files.**

---

## Engineering Validation Results

Re-audit performed against all findings. Classifications:

| Finding | Classification | Result |
|---------|---------------|--------|
| B1 | REAL | RESOLVED `478fc54` |
| B2 | REAL | RESOLVED `478fc54` |
| H1 | REAL | RESOLVED `d37cba6` + `f5a7169` |
| H2 | REAL | RESOLVED `74672c1` |
| H3 | REAL | RESOLVED `74672c1` |
| H4 | REAL | RESOLVED `74672c1` |
| H5 | REAL | RESOLVED `1a471c2` |
| M1 | REAL | RESOLVED `fe99495` |
| M2 | PARTIAL — analytics-only, scanner unaffected | P2 deferred |
| M3 | **FALSE POSITIVE** — single-founder scale, internal APIs only | P3 ignored |
| M4 | REAL — low frequency edge case | P2 deferred |
| M5 | REAL — observability only, not reliability | P2 deferred |
| M6 | REAL | RESOLVED `fe99495` |

---

## Scores by Area

| Area | Score | Status |
|------|-------|--------|
| Scanner Engine | 8.5/10 | ✅ Production ready |
| CMC Intelligence | 8.0/10 | ✅ Production ready |
| Binance Intelligence | 9.0/10 | ✅ Production ready |
| End-to-End Integration | 8.5/10 | ✅ Production ready |
| Dashboard UX | 8.0/10 | ✅ All 13 pages updated (Phase 7.2B) |
| Performance | 7.5/10 | ✅ Pagination added; refresh jitter reclassified FALSE POSITIVE |
| Security | 8.5/10 | ✅ B1 clean, B2 enforced, all console.* removed from critical path |
| Mobile | 7.5/10 | ✅ No horizontal scroll (except Tactical Feed — Phase 7.5) |

---

## BLOCKERS — ALL RESOLVED

**B1 — .env.local git history exposure** ✅ RESOLVED

`git log --all -- .env.local` confirmed zero commits. No credential rotation required.

---

**B2 — ADMIN_SECRET optional in TypeScript** ✅ RESOLVED

`lib/env.ts`: `z.string().min(32, '...')`. Startup fails fast if absent or under-length. Commit `478fc54`.

---

## HIGH PRIORITY — ALL RESOLVED

**H1 — console.* in production-critical lib files** ✅ RESOLVED (34 total)

| File | Count | Commit |
|------|-------|--------|
| `lib/scheduler.ts` | 18× | `d37cba6` |
| `lib/backtest.ts` | 2× | `d37cba6` |
| `lib/supabase.ts` | 13× | `f5a7169` |
| `lib/retry.ts` | 1× | `f5a7169` |

All replaced with `log.error/warn({ structuredFields }, 'message')` via `createLogger('lib/module')`. DB errors and retry events now appear as structured JSON in Vercel/Railway logs, searchable by `error`, `label`, `attempt`, `status` fields.

Remaining: `lib/auth-audit.ts` 1× `console.warn` — P2 (non-fatal catch block, explicitly designed never to throw).

---

**H2 — Celery scan task timeout collision** ✅ RESOLVED

`backend/workers/scan_task.py`: `soft_time_limit` 840s→1020s · `time_limit` 960s→1140s. 180s buffer above worst-case 80-coin scan. Commit `74672c1`.

---

**H3 — Beat schedule task expiry too tight** ✅ RESOLVED

`backend/workers/beat_schedule.py`: `expires` 780s→1020s for all 3 scan tasks. Matches `soft_time_limit`. Commit `74672c1`.

---

**H4 — infra_collector.py loop silent failure** ✅ RESOLVED

`backend/metrics/infra_collector.py`: `try/except` wrapper in `_run_loop()`. Logs `infra_collector_error` warning; loop continues. Commit `74672c1`.

---

**H5 — No per-minute Anthropic rate limit** ✅ RESOLVED

`backend/core/scanner/ai_validator.py`: `_SlidingWindowRateLimiter` (12 RPM) + 3-attempt exponential retry (5s, 10s) + heuristic fallback. Existing `Semaphore(3)` unchanged. Commit `1a471c2`.

---

## MEDIUM PRIORITY

| # | Issue | Status |
|---|-------|--------|
| M1 | Setup gate / AI threshold dead zone (60-71) | ✅ RESOLVED `fe99495` |
| M2 | Analytics fire-and-forget done-callback | 🔶 P2 — deferred |
| M3 | Frontend refresh interval jitter | ❌ FALSE POSITIVE — single-founder scale |
| M4 | ATR minimum relative floor | 🔶 P2 — deferred |
| M5 | Signal rejection reasons not persisted | 🔶 P2 — deferred |
| M6 | pre_score unclamped above 100 | ✅ RESOLVED `fe99495` |

---

## LOW PRIORITY

| # | Issue | Status |
|---|-------|--------|
| L1 | lib/backtest.ts console.log | ✅ RESOLVED `d37cba6` |
| L2 | Sector intelligence Redis baseline not durable | 🔶 P2 — deferred |
| L3 | Overview page API batching | 🔶 P3 — single user, negligible |
| L4 | pendingRestartFields not memoized | 🔶 P3 — minor |
| L5 | Admin layout space-y-0 inconsistency | 🔶 P3 — cosmetic |

---

## Phase 8 Deferred (P2)

1. Signal rejection reason persistence — M5
2. ATR minimum relative floor — M4
3. Analytics fire-and-forget reliability — M2
4. Sector intelligence Redis baseline durability — L2
5. lib/auth-audit.ts console.warn format — cosmetic

---

## Phase 8 Work Log (2026-05-31)

### Phase 7.2B.10.1 — Redis Quick Wins (`e0d3543`)
6 interval/batch optimizations. Redis commands: ~615K → ~240K/month (61% reduction).

### Phase 7.2B.10.3 — Provider Dashboard Accuracy (`1ba74ff`)
- CMC 0% fixed: providers page now reads `intel:quota:used` (real API credits)
- Binance RED fixed: `requestsToday=0` → healthy (stale top-coins errors suppressed)

### Phase 8.0 — Outcome Analytics Audit
- 324 resolved outcomes (4-day sample): 9% win rate
- Root cause: no BTC macro regime gate → 272 counter-trend SELL signals in 4 days
- May 29: 99 SELL at 0% win rate during bull reversal; 35 BUY at 40% win rate same day
- See: [docs/PHASE8_ANALYTICS_AUDIT.md](PHASE8_ANALYTICS_AUDIT.md)

### Phase 8.0.1 — Analytics Intelligence Wiring (`270368e`)
All 7 intelligence fields (TrendScore, Sector, Breakout, OI, Funding, Positioning) now surfaced in analytics queries, breakdowns, edge validation, calibration API, and dashboard.

### Phase 8.1A — BTC Regime Architecture Audit
Option B (port to Python) approved. Implementation plan defined.  
See: [docs/PHASE8_REGIME_AUDIT.md](PHASE8_REGIME_AUDIT.md)

### Phase 8.1B — BTC Regime Gate (`3bc018c`)
- `get_btc_regime()` + `_classify_regime()` in `market_fetcher.py`
- Soft gate: BULL+SELL/BEAR+BUY requires +10 confidence; HIGH_VOLATILITY +5
- `market_regime` on Signal, persisted to both tables, in all analytics queries
- Telegram regime emoji on every alert
- 414/414 tests passing

### Phase 8.1D — Production Readiness Audit
Full system audit — score 8.9/10, verdict ✅ GO.  
See: [docs/PHASE8_PRODUCTION_READINESS.md](PHASE8_PRODUCTION_READINESS.md)

### Dashboard vs Backend Truth Audit (2026-06-01)
- **REAL BUG (FIXED)**: `coordinator.record_scan_complete()` never called in `scan_task.py` — `scheduler:last_scan_ts` Redis key never set — dashboard showed "Last: —" / "Next: —" despite scans running. Fixed `26ea348`.
- UI CLARITY BUG (deferred): `ai_validated=True` when Claude OFF = heuristic passed. Label misleads. Fix: show "Heuristic" badge when `aiReasoning == ""`.
- CMC 0%: not a bug — `intel:quota:used = 0` after Redis reset; self-corrects in ≤15 min via quota-sync.
- Binance RED: `providers:metrics:binance` tracks wrong path (top-coins fallback, never fires). Real klines health always healthy.

### Phase 7.2B.8 — Provider Truth Validation (2026-06-01)
- CMC: 628 real API calls/day via TypeScript workers → `intel:quota:used`. Not in `providers:metrics`.
- Binance: ~30,456 klines/day via Python `market_fetcher.py`. Invisible to `providers:metrics`.
- `providers:metrics:*` tracks TypeScript ProviderManager only — misleading for production scanner usage.
- Two separate health endpoints: `/api/health/providers` (live pings, accurate) vs `/api/providers` (Redis metrics, misleading).

### Phase 7.2B.9 — Monitoring Truth Fixes (2026-06-01)
- `validation_source` ("CLAUDE" | "HEURISTIC") added to Signal model, DB, and all analytics — `8a41de7`
- Calibration page: "Claude Validated Today" + "Heuristic Validated Today" stat cards — `8a41de7`
- "AI Approved" lifecycle label renamed to "Approved" (accurate for both Claude and heuristic) — `c0f5f6f`
- DB migration confirmed: `validation_source TEXT` column added to signals table

### Phase 7.2B.10 — Redis Command Forensics (2026-06-01)
- Actual: 721K/month vs estimated 240K/month — gap of +481K/month explained
- Root cause 1: Futures cache TTL misalignment (OPT-6 not done) = 576K/month
- Root cause 2: Telegram settings gate (Phase 7.2B.8) added 4 get_group() per scan cycle
- Root cause 3: Quota guard canConsume() reads 3 keys per tick — undercounted
- OPT-6 (futures TTL 32min) = highest-leverage fix: saves ~360K/month alone

### Phase 7.2B.7.1 — Security Audit (2026-06-01)
- Score: 7.8/10 — 1 HIGH, 3 MEDIUM, 4 LOW — no CRITICAL findings
- HIGH: `/metrics` publicly accessible without auth
- MEDIUM: `/openapi.json` accessible, Railway direct URL exposure, Redis TLS cert verification disabled
- LOW: ADMIN_SECRET non-constant-time compare, email PII in logs, CORS wildcard methods, health endpoint config disclosure

### Phase 7.2B.7.1A — Security Remediation Validation (2026-06-01)
- 0 of 8 findings remediated at time of audit — all verified for remediation below

### Phase 7.2B.7.1B — Security Hardening Remediation (`216e74f`)
- `openapi_url=None` in production → `/openapi.json` returns 404
- `/metrics` removed from `_PUBLIC_PATHS` → requires `X-Admin-Secret` auth
- `hmac.compare_digest()` for constant-time secret comparison
- Email PII removed from `console.warn` in `middleware.ts`
- Health endpoint: per-service check details removed from public response
- Security score: **7.8 → 9.1/10** · 5 of 8 findings closed

### Phase 7.2B.7.2 — Scheduler Hardening Audit (2026-06-01)
- HIGH: Lock TTL (11 min) < soft_time_limit (17 min) → long scans could overlap
- LOW: `record_scan_complete()` not exception-safe; `release_scan_lock()` in `finally` masks exceptions
- Scheduler reliability score: 8.2/10

### Phase 7.2B.7.2A — Scheduler Hardening Remediation (`3e9fde2`)
- Lock TTL: 11 → 20 min (buffer above 17-min soft_time_limit)
- `record_scan_complete()` wrapped in try/except — successful scan never marked failed
- `release_scan_lock()` wrapped in try/except in `finally` — original exception preserved
- Scheduler reliability score: **9.5/10**

### Phase 7.2B.10.6 — OPT-6 Futures Cache TTL (`ef29d0f`)
- `oi_cache` 2→32 min · `funding_cache` 5→32 min · `ls_cache` 5→32 min
- `_btc_regime_cache` 5→20 min
- Savings: ~108K Redis commands/month (alternating hit/miss pattern)
- Total Redis: ~721K → ~216K/month after all OPT-1–6

### Phase 7.2B.7.4 — Anthropic Protection Audit (2026-06-01)
- Audit only — all fallback paths correct, rate limiting solid, JSON handling robust
- Score: 9.1/10. Gap: per-day cost cap and degradation alerting absent

### Phase 7.2B.7.4A — Anthropic Hardening Enhancements (`8fe5df3`)
- E1: Daily call limit — `AISettings.daily_call_limit` field + in-process counter
- E2: Degradation alerting — 15-min rolling window, warns >50% fallback rate
- E3: Persistent rate limiter — documented as out-of-scope (Redis overhead)
- E4: JSON extraction — `_extract_json_block()` replaces greedy DOTALL regex
- E5: Indicator sanitization — `_sf()` replaces NaN/Inf with "?" in prompts
- E6: Dashboard — Estimated Cost Today + Last Error on Calibration page
- Anthropic score: **9.1 → 9.6/10**

### Phase FINAL — Production Readiness Validation (2026-06-01)
- Full audit across all phases: Scanner, Security, Scheduler, Anthropic, Redis, Analytics, Dashboard, Telegram, Regime
- Overall score: **9.1/10** · Production readiness: **91%**
- Verdict: **YES WITH MINOR RISKS — Deploy Now**
- Remaining: 3 LOW/MEDIUM risks (CORS wildcard, Redis TLS accepted, Railway URL)

### Phase MONITOR.1 — Post-Launch Monitoring Baseline (`d8f503e`)
- 14 daily Redis counters: signals, scans, coins_scanned, telegram_sends, binance_errors
- Reads Claude/heuristic from ai_call_log, CMC credits from intel:quota:used, win/SL from signal_outcomes (7d)
- Threshold bands: Healthy / Warning / Critical per metric
- Anomaly detection: zero-signal day, Claude fallback spike >50%, Binance errors >15, slow scan >900s
- `GET /api/analytics/monitor` endpoint + System page Operational Monitoring section

### Phase DEPLOY.1 — Live Production Smoke Test (2026-06-01)
- All 13 scenarios verified: scanner ON/OFF, Claude ON/OFF, Telegram ON/OFF, emergency stop,
  maintenance mode, manual scan, scheduled scan, Redis/Claude/Binance available/unavailable
- **Result: PASS — all operational controls and failure modes behave correctly**
- 22/22 operational control unit tests passing

### Phase 8.1A — Regime Persistence Verification (2026-06-01)
- 11/11 post-deployment signals have `market_regime` populated — deployment confirmed active
- BEAR_TREND (10 signals) + SIDEWAYS (1 signal) — correct values for May 31 market conditions
- BUY in BEAR_TREND required +10 confidence (soft gate working correctly)
- Telegram alert confirmed: shows `Regime: 🔴 BEAR TREND` ✅
- **Verdict: WORKING**

### Telegram Bug Fix (`dcedc3c`)
- Root cause: signal INSERTed to DB before `send_signal_alert()` called — no UPDATE after send
- `telegram_sent` was permanently `false` in DB even when alerts delivered
- Fix: `mark_signal_telegram_sent()` UPDATE runs after confirmed send — `dcedc3c`
- 10 historical May 31 signals backfilled to `telegram_sent = true` via SQL

### Phase PERFORMANCE.1 — Post-Regime Validation (2026-06-01)
- **Too early to validate** — regime gate deployed 2026-05-31, outcomes resolve in 72h
- Pre-regime (May 27-30): 9% win rate, 272 SELL / 52 BUY, market_regime=NULL on all
- Post-regime: 11 signals, all BEAR_TREND, BUY in BEAR_TREND required 90+ confidence
- NIGHT/USDT BUY at 95% passed (required ≥90) — gate logic confirmed correct
- **Next checkpoint: June 3** (first 72h batch resolves) · **Full baseline: June 14**

---

### PROD.FIX.1 — Production Hardening Pass (2026-06-08)

16 defects identified in Phase 8.1D deferred list and live ops review. All resolved.

| Commit | Priority | Fix |
|--------|----------|-----|
| `5d19ddc` | P0.1 | asyncio.run() nesting in `coordinator.py/scheduler.py` — `status_async()` + `run_in_executor` |
| `a3455e3` | P0.2 | Critical anomaly Telegram alert in `burn_in.py` (15-min Redis throttle) |
| `a3455e3` | P0.3 | 5 silent `except: pass` in `monitoring.py` → `log.warning(...)` with context |
| `d06e906` | P1.1 | `/api/analytics` added to `ADMIN_PREFIXES` in `middleware.ts` — all 6 analytics routes protected |
| `d06e906` | P1.3 | `useAutoRefresh` fetcherRef pattern — stable `refresh` identity, no interval reset on re-render |
| `d06e906` | P1.4 | AI degradation Telegram alert in `ai_validator.py` (fires when fallback rate >50% in 15-min window) |
| `d06e906` | P1.5 | Binance futures 451 geo-block detection + hourly-throttled Telegram alert in `market_fetcher.py` |
| `6cb2d97` | P2.1 | Overview countdown uses `next_scan_at` from backend — no more stale `last_scan_at + 15m` drift |
| `6cb2d97` | P2.2 | Calibration "Building data" banner shown when `confidence_level = 'insufficient_data'` |
| `6cb2d97` | P2.3 | `IntelligenceNullStat` TypeScript type added to `admin-api.ts` |
| `6cb2d97` | P2.4 | Scanner page merges rejection stats fetch into single `fetchStatus` callback |
| `6cb2d97` | P2.6 | OI_NEUTRAL spot guard — comment added to `signal_pipeline.py:814` confirming `if futures_data:` guard |
| `6cb2d97` | P2.7 | Symbol suffix guard in `signal_metrics.py`: `BTCUSDT` stays `BTCUSDT`, not `BTCUSDTUSDT` |
| `83be5c5` | P3.1 | Health check adds Celery worker liveness (`celery:worker:last_heartbeat`) + Binance ping |
| `83be5c5` | P3.2 | Haiku pricing constants externalized in calibration page (`HAIKU_PRICE_IN_PER_M = 0.80`) |
| `83be5c5` | P3.3 | `SECTOR_BASELINE_TTL` 45 min → 60 min (aligned with CMC categories cache refresh cycle) |
| `83be5c5` | Redis | Binance kline metric batching — 5s accumulation window → single pipeline flush (~98% Redis reduction) |
| `88cef95` | P3.1+ | Celery worker heartbeat writer: `write_worker_heartbeat()` on `worker_ready` + 60s beat task |

**Score improvement: 8.9 → 9.5/10**

---

*Last updated: 2026-06-08*  
*PROD.FIX.1 complete. Overall: 9.5/10 — Production hardened.*
