# MASTER PLATFORM STATUS — SignalEdge AI
<!-- Single source of truth. Updated: 2026-06-25. Supersedes all historical audit docs. -->
<!-- Consolidated from: SYSTEM_STABILIZATION_FINAL_1, STABILIZATION_CLOSEOUT_1, PLATFORM_STABILIZATION_1, SIGNAL_QUALITY_END_TO_END_VALIDATION_1, DOCUMENT_CONSOLIDATION_1 -->

---

## CURRENT ARCHITECTURE

**Stack:** Next.js 14 (Vercel) · FastAPI + Celery (Railway) · Supabase PostgreSQL · Redis Cloud · CloudAMQP  
**Admin dashboard:** 3 centers — `/admin/signals` · `/admin/performance` · `/admin/system`  
**Member dashboard:** `/dashboard` — 5 pages (Overview / Active Signals / Closed Signals / Performance / Settings). Auth-gated (any Supabase user). No scanner internals exposed. See `docs/USER_DASHBOARD_1.md`.  
**Primary scanner:** Python (`backend/core/scanner/`) — TypeScript `lib/scanner.ts` is legacy  
**Signal universe:** Top-200 coins via CoinMarketCap (TypeScript workers → Redis cache → Python reads cache)  
**Signal delivery:** WhatsApp via UltraMsg (instance181885, +919600190022). Source code says "Telegram" — that's the old channel name, never renamed.  
**Landing page:** Outcome-first copy (SAAS.POSITIONING.1, June 25) — hero: "High-Probability Crypto Signals / Delivered to WhatsApp". Real 30D metrics (WR 34.8%, Exp +0.10R). Performance section above Features. See `docs/SAAS_POSITIONING_1.md`.  
**Production score:** 9.5/10 (PROD.FIX.1 complete + FRONTEND.SYSTEM.TRUTH.FIXES complete)  
**Current status:** Monitoring freeze June 23–30. No strategy changes permitted.

---

## ACTIVE SCAN MODES

| Mode | Min MCap | Min Vol | Min Confidence | Max Coins | Status |
|------|---------|---------|----------------|-----------|--------|
| SPOT | $200M | $20M | 85 | 80 | ACTIVE |
| FUTURES | $1B | $200M | 85 | 50 | ACTIVE |
| TRENDING | $50M | $10M | 85 | 80 | ACTIVE |
| HIGH_CONFIDENCE | $2B | $500M | 87 | 30 | **PAUSED** — `high_confidence_mode_enabled=OFF` |

Beat schedule: SPOT every 15 min (*/15) · FUTURES every 30 min (at :10,:40) · TRENDING every 30 min (at :20,:50)  
HIGH_CONFIDENCE: removed from beat schedule entirely (permanently disabled — 0/9 wins last week)

---

## SIGNAL PIPELINE GATES (ordered)

| Step | Gate | Notes |
|------|------|-------|
| Pre | NULL regime hard gate | `if not btc_regime: return None` — N=677, WR=14.9% (ALPHA.TRUTH.1) |
| 1 | KLINE fetch | Tracks `KLINE_EMPTY` / `KLINE_PARTIAL` |
| 2 | MTF confirmation | 1h + 4h + 1d alignment |
| 3 | Volatility gate | ATR within range |
| 4 | Trend strength | ADX ≥ 16 |
| 5 | Market structure | 7 filters — regime-aware thresholds (MARKET_STRUCTURE.FIX.1) |
| 6 | Setup scoring | `detect_setup()` with ADX, volume gradient, RSI pullback, 4h MACD/RSI, daily patterns, RSI divergence, counter-EMA200 |
| 7 | R:R check | Minimum 2.0 |
| 8 | Risk engine | Grade A–F; grade F rejected without AI |
| 9 | Futures intelligence | FUTURES mode only (OI × price, funding, positioning) |
| 10 | Continuation gate | continuationProbability < 25 → reject |
| 10.5 | REGIME.HARD.GATE.V2 | `regime_hard_gate_v2=ON` — contra-regime rejected unless HIGH_MOMENTUM or aligned OI |
| 10.5.5 | **SIDEWAYS gate** | `btc_regime == SIDEWAYS` rejected unless HIGH_MOMENTUM or CONFIRMED_BREAKOUT (Jun 23) |
| 11 | AI / heuristic | `ai.enabled + setup_score ≥ 78` → Claude; else heuristic. ANTHROPIC_API_KEY unset → 100% heuristic |
| 12 | Confidence floor | 85 minimum (mode-specific) |
| Delivery | Probability gate | Cohort WR < 40% → WhatsApp suppressed (delivery only, not rejection) |

**EARLY_BREAKOUT penalty:** −8 setup score for BUY+EARLY_BREAKOUT when `early_breakout_penalty_v1=ON`

---

## FEATURE FLAGS (current state, June 23)

| Flag | State | Reason |
|------|-------|--------|
| `high_confidence_mode_enabled` | **OFF** | 0/9 wins 7D; 26.8% WR 30D |
| `regime_hard_gate_v2` | **ON** | Contra-regime BUY WR=19%, Exp=−0.405R |
| `early_breakout_penalty_v1` | **ON** | BUY+EARLY unpenalized → negative-expectancy cohort |
| `probability_gate_v1` | **ON** | min_empirical_wr=40.0; fail-open on unknown cohorts |
| `riskgrade_v2` | **ON** | Heuristic grades inverted; empirical: monotonic zero inversions |
| `confidence_calibration_v2` | OFF | Data-gathering only, flag OFF = returns `{enabled:false}` |
| `attribution_snapshots` | ON | Nightly 00:15 UTC; 1,243 rows confirmed |
| `output_collapse_alert` | ON | 2 consecutive scans <25% of 7d baseline → WhatsApp alert |
| `apply_founder_thresholds` | OFF | Quick Controls floors — OFF = no-op (test-locked) |
| `probability_gate_v2` | OFF | Not yet built |
| `emergency_stop` | OFF | Emergency use only |
| `maintenance_mode` | OFF | Maintenance use only |
| `ops_alerts_enabled` | OFF | Signal alerts only; ops alerts disabled by default |

**All 5 P0 flags (above) applied June 16 as a package. Frozen through June 30.**

---

## PERFORMANCE (current, June 23)

| Metric | Value | Period | vs Pre-P0 |
|--------|-------|--------|-----------|
| Win Rate | **33.52%** | 7D | +13.52pp vs 20% crisis |
| Profit Factor | **1.2266** | 7D | +0.707 vs 0.52 |
| Expectancy | **+0.137R** | 7D | +0.527R vs −0.39R |
| Win Rate | 34.84% | 30D | — |
| Expectancy | +0.098R | 30D | — |
| Recovery Score | 7.85/10 | D7 | Decision: CONTINUE |
| WR Breakeven | 32.3% | At 2.1:1 RR | +1.22pp margin |

**Next checkpoint: D7 = June 30.** Full measurement + SIDEWAYS.EXEMPTION.1 POSTFIX.1 + BULL_TREND gate decision.

---

## WHATSAPP DELIVERY

- **Platform:** UltraMsg (source code: "Telegram" = historical name, not current channel)
- **Dedup:** `tg:alert:{SYMBOL}:{LONG|SHORT}` Redis key, 1h TTL
- **Direction flip:** delivers immediately regardless of cooldown
- **Upgrade dedup:** confidence ≥ previous + 5 → sends as "⬆ UPGRADE"
- **Ops alerts:** `telegram.ops_alerts_enabled=false` (default) — signal alerts only
- **WS1–WS5 reliability fixes:** Applied (queue drain, delivery ground truth, dedup-after-delivery, semaphore fix)
- **`telegram_delivered` column:** NULL for ~626 pre-WS2 signals — expected, not an error

---

## REDIS BUDGET

Key reductions implemented (OPS.CONSOLIDATION.1 + PROD.FIX.1 + 2026-06-22):
- Broker: CloudAMQP AMQP (eliminates ~34,560 Redis BLPOP ops/day)
- Result backend: `rpc://` (zero Redis for task results)
- Worker heartbeat: 600s (was 60s)
- Kline metric batching: 5s window, single pipeline (~98% reduction)
- `scan_durations` key retired; hit/miss counters retired; quota snapshot hourly
- **REDIS.REDUCE.4** — Dead monitoring metrics removed from `monitoring.py`; AI summary counters removed from `orchestrator.py`
- **REDIS.REDUCE.4b** — `infra_collector` background task disabled in `main.py` (864 dead ops/day saved)
- **REDIS.CONN.1** — aioredis pool capped at 5 connections; ioredis closed after each Intelligence cron tick (prevents connection leak on Vercel)

**Actual ops:** ~44K ops/day (~1.32M/month) — higher than 200K/month original target. Re-evaluate Redis Cloud plan limits (P2).

---

## DATABASE MIGRATIONS (all applied June 16)

The 7 Phase-9+ migrations (all idempotent — IF NOT EXISTS, safe to re-run):

| Migration | Purpose |
|-----------|---------|
| `probability-gate-migration.sql` | `probability_gate_enabled` flag |
| `probability-engine-migration.sql` | `empirical_grade/wr/n` on signals |
| `telegram-delivery-migration.sql` | `telegram_delivered` + `telegram_delivery_error` |
| `validation-source-migration.sql` | `validation_source` column |
| `ai-call-log-trace-migration.sql` | `symbol` + `setup_score` on `ai_call_log` |
| `attribution-snapshots-migration.sql` | `attribution_snapshots` table |
| `signal-outcomes-regime-migration.sql` | `market_regime` on `signal_outcomes` |

Earlier migrations (also applied):
`admin-auth-migration.sql` · `analytics-schema.sql` · `phase-7-4a-intelligence-migration.sql` · `phase-7-4a-6-3-migration.sql` · `phase-7-4a-7-2-migration.sql`

**All confirmed applied.** For fresh deploy: run all `database/` files in Supabase SQL Editor in any order.

---

## OPEN ITEMS

### P0 — Act immediately
| Item | Notes |
|------|-------|
| Set `ANTHROPIC_API_KEY` in Railway | Currently 100% heuristic. WR=33.52% achieved heuristically — not urgent but limits future alpha |
| **Re-run CMC one-time sector capture** | Initial run returned `assignments: 0` (rate limit). Fix deployed Jun 24 (commit `c187ab2`). Run: `python -c "import asyncio; from backend.core.scanner.cmc_backup import capture_full_backup; print(asyncio.run(capture_full_backup()))"` from Railway shell. Expect `assignments: 3000+`. Without this, sector intelligence falls back to metadata-only (no coin membership). |

### P1 — Act post June 30
| Item | Notes |
|------|-------|
| BULL_TREND gate: WR=21.65%, Exp=−0.330R, n=97 | Implement after D7 measurement. Probability gate currently suppresses delivery. |
| `telegram_delivered=NULL` for ~626 pre-WS2 signals | Expected state. WS2 fix writes on future signals only. |
| CMC cache manual refresh UI gone | Deleted in PLATFORM.SIMPLIFICATION.1. Add back to System → Health if needed. |
| D7 measurement (June 30) | SIDEWAYS.EXEMPTION.1 POSTFIX.1 + BULL_TREND gate decision |
| `/api/signals/counts` IN clause limit | `.in('signal_id', sig7dIds)` silent failure if >1,000 signals in 7d; safe until ~150 signals/day |

### P2 — Monitor
| Item |
|------|
| Redis actual ops ~1.32M/month vs 200K target — re-evaluate plan |
| TRENDING mode WR=28.2% 30D negative — probability gate handles delivery; consider gate post-D7 |

---

## KEY ROUTES

### Admin (email allowlist required)

| Route | Purpose |
|-------|---------|
| `/admin/signals` | Overview · Signals · Regime |
| `/admin/performance` | Track Record · Edge · Attribution |
| `/admin/system` | Health · Anomalies · Settings |
| `/admin/trading` | → `/admin/signals` (redirect) |
| `/admin/analytics` | → `/admin/performance` (redirect) |
| `/admin/intelligence` | → `/admin/system?tab=system` (redirect) |
| `/admin/settings` | → `/admin/system?tab=settings` (redirect) |

### Member Dashboard (any authenticated user)

| Route | Purpose |
|-------|---------|
| `/dashboard` | Overview — stat tiles, recent signals, 7D perf snapshot |
| `/dashboard/signals/active` | Live active signals with dir/mode filter chips |
| `/dashboard/signals/closed` | Closed signals with period selector + outcome filter |
| `/dashboard/performance` | WR / PF / Exp by period, by mode, by grade |
| `/dashboard/settings` | Account · WhatsApp number · Plan · Security |

AI toggle: **System → Settings → Quick Controls**  
Feature flags: **System → Settings → Feature Flags**  
WhatsApp toggle: **System → Settings → Quick Controls**  
Emergency stop: **System → Settings → Quick Controls** (red when ON)

---

## DEPLOYMENT CHECKLIST (fresh deploy)

1. **Vercel env vars:**
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
   - `ADMIN_EMAILS` (required — blocks all admin access if unset)
   - `ADMIN_SECRET` (32-byte hex — required in prod)
   - `BACKEND_URL=https://crypto-scanner-api-production.up.railway.app`

2. **Railway env vars:**
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
   - `REDIS_URL` (Redis Cloud connection string)
   - `CELERY_BROKER_URL` (CloudAMQP amqps:// URL)
   - `CELERY_RESULT_BACKEND=rpc://`
   - `ADMIN_SECRET` (same as Vercel)
   - `BINANCE_API_KEY`, `BINANCE_SECRET_KEY`
   - `COINMARKETCAP_API_KEY`
   - `WHATSAPP_API_URL` (e.g. `https://api.ultramsg.com/instance181885/`)
   - `WHATSAPP_TOKEN` (UltraMsg instance token)
   - `WHATSAPP_PHONE` (recipient number with country code, e.g. `+919600190022`)
   - `ANTHROPIC_API_KEY` (**P0 open item** — unset currently)

3. **Database:** Run all files in `database/` via Supabase SQL Editor (idempotent)

4. **Admin user:** Create in Supabase Auth dashboard; set ADMIN_EMAILS to match

5. **Apply P0 feature flags** from System → Settings → Feature Flags:
   - `high_confidence_mode_enabled=OFF`
   - `regime_hard_gate_v2=ON`
   - `early_breakout_penalty_v1=ON`
   - `probability_gate_v1=ON`
   - `riskgrade_v2=ON`

6. **Verify health:** `GET /health/ready` → all checks HEALTHY  
   - Note: `celery_worker` check shows `HEALTHY` / `DEGRADED` / `OFFLINE` (not `'ok'`)

7. **Dashboard at:** `/admin/signals` (old `/admin/trading` → redirects)
