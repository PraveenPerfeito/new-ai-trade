# Production Readiness Audit

**Date:** 2026-05-30  
**Overall Score:** 7.4 / 10  
**Verdict:** CONDITIONAL GO

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
| Security | 5.0/10 | ⚠️ .env.local exposure risk + optional ADMIN_SECRET |
| Mobile | 7.5/10 | ✅ No horizontal scroll (except Tactical Feed — Phase 7.5) |

---

## BLOCKERS (fix before deploy)

**B1 — .env.local potential git history exposure**

Risk: Supabase service role, Anthropic key, Telegram token, DB password, Redis auth, Admin Secret

Action: Run `git log --all -- .env.local`. If committed, rotate ALL credentials immediately.

Effort: 30 min

---

**B2 — ADMIN_SECRET optional in TypeScript (lib/env.ts)**

Risk: If unset, Python backend accepts all admin API requests from the proxy

Action: Change z.string().optional() to z.string().min(32) in lib/env.ts

Effort: 5 min

---

## HIGH PRIORITY (fix before first load)

**H1 — 13 console.log statements in lib/scheduler.ts**

Impact: Exposes scan timing and retry patterns in logs

Effort: 1 hour

---

**H2 — Celery scan task timeout collision**

Issue: soft_time_limit=14min but worst-case scan ~13-14min. Kills scans on completion.

Fix: Increase soft_time_limit to 17min, time_limit to 19min

Effort: 5 min

---

**H3 — Beat schedule task expiry too tight**

Issue: expires=13min, task takes 14min. Scheduled scans silently dropped.

Fix: expires=17min

Effort: 5 min

---

**H4 — infra_collector.py background loop swallows exceptions**

Impact: Prometheus metrics stop updating silently

Fix: Add try/except wrapper around loop body

Effort: 15 min

---

**H5 — No per-minute Anthropic API rate limit**

Issue: Only concurrency semaphore=3, no rate limiting per minute. Burst of signals could hit Anthropic 429, silently fall back to heuristic.

Effort: Medium (implement token bucket or queue-based limiter)

---

## MEDIUM PRIORITY (fix within a week)

| # | Issue | Impact |
|---|-------|--------|
| M1 | Setup score 60 + AI threshold 72 = dead zone for signals 60-71 | ~10% of signals incorrectly filtered |
| M2 | _register_analytics() fire-and-forget: verify done-callback fires correctly | Stale analytics data |
| M3 | Frontend refresh intervals hardcoded, no jitter | Thundering herd on API at exact minute boundaries |
| M4 | ATR minimum relative floor missing (< 0.1% of price = invalid) | Extreme volatility coins generate false signals |
| M5 | Signal rejection reasons not persisted to database | Cannot analyze filter effectiveness |
| M6 | Breakout score bonus not clamped at detect_setup level | Score can exceed 100 in edge cases |

---

## LOW PRIORITY

| # | Issue | Impact |
|---|-------|--------|
| L1 | lib/backtest.ts has console.log | Minor logging noise |
| L2 | Sector intelligence Redis baseline not durable | Redis restart loses sector history |
| L3 | Overview page fetches 5 APIs every 15s without batching | Inefficient API consumption |
| L4 | pendingRestartFields not memoized in Settings | Minor performance (Settings page) |
| L5 | Admin layout space-y-0 inconsistency | Visual polish |

---

## Conditional GO Criteria

Before deploying to production:

1. **Git history audit** — Run `git log --all -- .env.local` and check if secrets were committed
   - If YES → rotate ALL credentials (Supabase, Anthropic, Telegram, Redis, Admin Secret) immediately
2. **ADMIN_SECRET enforcement** — Change lib/env.ts to require ADMIN_SECRET as z.string().min(32)
3. **Celery timeout fix** — H2 + H3 (10 min total)
4. **Anthropic rate limiting** — At minimum, add logging to detect 429 responses; implement queue-based limiter if budget allows

---

## Top 5 Phase 8 Improvements (deferred)

1. Anthropic per-minute rate limiter
2. Signal rejection reason persistence
3. Refresh interval jitter + centralized config
4. ATR minimum relative floor
5. cache:intel:global BTC dominance reader

---

*Last updated: 2026-05-30*
*Generated from Phase 7.2B.7 audit*
