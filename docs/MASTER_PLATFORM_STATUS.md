# MASTER PLATFORM STATUS — SignalEdge AI
<!-- Single source of truth. Updated: 2026-06-17. Supersedes all historical audit docs. -->

---

## CURRENT ARCHITECTURE

**Stack:** Next.js 14 (Vercel) · FastAPI + Celery (Railway) · Supabase PostgreSQL · Redis Cloud · CloudAMQP  
**Admin dashboard:** 3 centers — `/admin/signals` · `/admin/performance` · `/admin/system`  
**Primary scanner:** Python (`backend/core/scanner/`) — TypeScript `lib/scanner.ts` is legacy  
**Signal universe:** Top-200 coins via CoinMarketCap (single API call from TypeScript workers → Redis cache → Python reads cache)  
**Production score:** 9.5/10 (PROD.FIX.1 complete, June 2026)

---

## ACTIVE SCAN MODES

| Mode | Min MCap | Min Vol | Min Confidence | Max Coins | Status |
|------|---------|---------|----------------|-----------|--------|
| SPOT | $200M | $20M | 85 | 80 | ACTIVE |
| FUTURES | $1B | $200M | **85** | 50 | ACTIVE — raised from 82 (SIGNAL_ENGINE_TRUTH_1) |
| TRENDING | $50M | $10M | **85** | 80 | ACTIVE — raised from 78 (SIGNAL_ENGINE_TRUTH_1) |
| HIGH_CONFIDENCE | $2B | $500M | 87 | 30 | **PAUSED** — `high_confidence_mode_enabled=False` (0/9 wins last 7D) |

**Beat schedule:** SPOT every 15 min · FUTURES every 30 min · TRENDING every 30 min · HIGH_CONFIDENCE task exists but blocked by operational gate

---

## SIGNAL PIPELINE GATES (in order)

1. **NULL regime hard gate** — `if not btc_regime: return None` (N=677, WR=14.9% historically)
2. **MTF confirmation** — 1h + 4h + 1d alignment
3. **Volatility gate** — ATR > 8%
4. **Trend strength** — ADX ≥ 16
5. **Market structure** — 7 false-positive filters (regime-aware thresholds since MARKET_STRUCTURE.FIX.1)
6. **Setup scoring** — `detect_setup()` with structure stops, ADX, volume gradient, RSI pullback, 4h MACD, 4h RSI, daily patterns, RSI divergence, counter-EMA200 penalty
7. **R:R check** — minimum 2.0
8. **Risk engine** — grade A–F; grade F rejected without AI
9. **Futures intelligence** — OI × price matrix, funding trend, positioning (FUTURES + HIGH_CONFIDENCE only)
10. **Continuation gate** — continuationProbability < 25 → reject (no AI tokens spent)
10.5. **REGIME.HARD.GATE.V2** (flag ON) — hard-rejects contra-regime unless HIGH_MOMENTUM or aligned OI
11. **Claude Haiku** — if AI enabled AND setup_score ≥ 78 (heuristic fallback otherwise)

**EARLY_BREAKOUT penalty:** −8 setup score for BUY+EARLY_BREAKOUT (flag `early_breakout_penalty_v1=True`)

---

## FEATURE FLAGS (current state, 2026-06-16)

| Flag | State | Reason |
|------|-------|--------|
| `high_confidence_mode_enabled` | **OFF** | 0/9 wins last 7D (SQA3) |
| `regime_hard_gate_v2` | **ON** | Contra-regime BUY: WR=19%, Exp=−0.405R (SQA3) |
| `early_breakout_penalty_v1` | **ON** | BUY+EARLY was unpenalized (SQA3) |
| `probability_gate_v1` | **ON** | 2/3 live signals in WR<40% cohorts (SQA3) |
| `riskgrade_v2` | **ON** | Heuristic grades inverted A<C; empirical: zero inversions (SQA3) |
| `confidence_calibration_v2` | OFF | Data-gathering only, no production path changes |
| `attribution_snapshots` | ON | Nightly at 00:15 UTC; 1,243 rows confirmed |
| `output_collapse_alert` | ON | Alerts after 2 consecutive scans <25% of 7d baseline |
| `emergency_stop` | OFF | Emergency use only |
| `maintenance_mode` | OFF | Maintenance use only |
| `apply_founder_thresholds` | OFF | Quick Controls floors — careful: changes scan behavior |

---

## SIGNAL QUALITY (empirical, from PERFORMANCE_VERIFICATION_1.md)

| Grade | n | WR | Expectancy | Notes |
|-------|---|----|-----------|-------|
| A+ | — | 73.5% | +1.286R | PF 5.85 |
| A | — | — | — | |
| B+ | — | — | — | |
| B | — | — | — | |
| C | — | — | — | |
| D | — | 13.6% | −0.581R | PF 0.33 |

Empirical grades: **zero inversions** (monotonically decreasing WR/exp A+ → D, n=1,822 in-sample)  
Heuristic grades: **inverted** (A 33.9% < B 36.1% < C 56.4%) — reason `riskgrade_v2=True`

**Current 7D WR:** ~20% (pre-P0-fix baseline)  
**Day 7 checkpoint:** 2026-06-23 — target 33–38% recovery

---

## TELEGRAM CONFIGURATION

- **Dedup:** 1-hour cooldown per symbol+direction. Direction flip fires immediately.
- **Upgrade dedup:** Signal with confidence ≥ previous_sent + 5 sends as "⬆ UPGRADE"
- **Ops alerts:** `telegram.ops_alerts_enabled = false` (default) — only signal alerts by default
- **Daily summary:** `telegram.daily_summary_enabled = false` (default)
- **Rate limit:** `max_alerts_per_hour` from TelegramSettings
- **Queue drain:** `flush_queue(30s)` in scan task finally-block; `flush_queue(15s)` in analytics tasks
- **Delivery tracking:** `signals.telegram_delivered` column exists but NULL for 626 signals (WS2 drain worker issue — P1 open)

---

## REDIS BUDGET (as of June 2026)

**Target:** <200K ops/month · **Actual:** Met per OPS.CONSOLIDATION.1

Key reductions implemented:
- Broker switched to CloudAMQP (eliminated ~34,560 Redis BLPOP ops/day)
- Result backend `rpc://` (zero Redis ops for task results)
- Heartbeat 60s → 600s
- Settings gen-check 60s → 120s
- `scan_durations` key retired
- Hit/miss counters retired
- Binance kline metric batching (5s window, single pipeline)
- Quota snapshot gated to hourly

---

## DATABASE MIGRATIONS (all applied 2026-06-16)

| Migration | Purpose | Status |
|-----------|---------|--------|
| `admin-auth-migration.sql` | Admin user tables | Applied |
| `analytics-schema.sql` | signal_outcomes with partial index | Applied |
| `phase-7-4a-intelligence-migration.sql` | breakout_type, breakout_strength, oi_interpretation, funding_trend, positioning_context, momentum_score, trend_score | Applied |
| `phase-7-4a-6-3-migration.sql` | breakout_strength, oi_interpretation, funding_trend, positioning_context on Signal | Applied |
| `phase-7-4a-7-2-migration.sql` | sector_status on signals + signal_outcomes | Applied |
| `probability-gate-migration.sql` | empirical_wr, empirical_n on signals | Applied |
| `probability-engine-migration.sql` | empirical_grade on signals | Applied |
| `telegram-delivery-migration.sql` | telegram_delivered, telegram_delivery_error | Applied |
| `validation-source-migration.sql` | validation_source | Applied |
| `ai-call-log-trace-migration.sql` | symbol, setup_score on ai_call_log | Applied |
| `attribution-snapshots-migration.sql` | attribution_snapshots table | Applied |
| `signal-outcomes-regime-migration.sql` | market_regime on signal_outcomes | Applied |
| `probability-engine-migration.sql` | (see above) | Applied |

**All 7+ confirmed applied.** CLAUDE.md #59 "6 pending" is stale.

---

## OPEN ITEMS (prioritized)

### Must-Fix (P0 — within 24h)
- ✅ `test_probability_engine.py:129` — resolved (SQA3 updated the test)

### High Priority (P1 — within 7 days)
- `telegram_delivered = NULL` for 626 sent signals — WS2 drain worker not writing back to DB
- CMC cache refresh has no UI entry point (W4/BF1) — add to System → Health tab
- Day 7 recovery checkpoint: 2026-06-23 — assess if WR recovering to 33–38%
- MARKET_STRUCTURE.FIX.1 POSTFIX.1: verify reduced `ms_sr_rejection` + `ms_trend_exhaustion` counts
- P1-02: `_NULL_CONFIDENCE_PENALTIES` × 0.7 for heuristic path — deferred to 2026-06-23 with outcome data

### Applied 2026-06-19 (PLATFORM_STABILIZATION_1 P1+P2)
- ✅ P1-01: Display-only callout banner added to scanner/signals/risk groups in Settings tab (`app/admin/system/page.tsx`)
- ✅ P1-03: `scheduler:enabled` 90-day TTL (earlier SIGNAL_ENGINE_TRUTH_1 pass)
- ✅ P2-01: 7-day EXPIRE on all `providers:metrics:*` keys (TypeScript + Python Binance pipeline)
- ✅ P2-02: LPUSH → RPUSH + LTRIM(-N,-1) standardized in `lib/market-data/metrics.ts`
- ✅ P2-03: Dead `providers:metrics:coinmarketcap:quota` write removed (CMC uses `intel:quota:used`)
- ✅ P2-05: `PaperTradingSettings` deprecation comment added to `groups.py`
- ✅ `outcome_learning.py`: attribution INSERT wrapped in try/except with warning log

### Applied 2026-06-19 (SIGNAL_ENGINE_TRUTH_1)
- ✅ FUTURES `min_confidence` 82→85 — 82-84 band is negative-expectancy
- ✅ TRENDING `min_confidence` 78→85 — 78-84 band is negative-expectancy
- ✅ Intelligence boost inflation cap — base_conf < 87 + boost > 89 → capped at 89 (HIGH_MOMENTUM exempt)
- ✅ Grade D empirical backstop in `should_suppress_send()` — suppresses Grade D even without WR stamp
- ✅ `scheduler:enabled` Redis key — 90-day TTL added (prevents orphaned key accumulation)

### Applied 2026-06-19 (TELEGRAM.GATE.FIX.1) — commit `9457738`
- ✅ **P0 — Telegram signals restored**: Grade D backstop in `should_suppress_send()` restricted to regime-level cohort grade only. Was using `signal.empirical_grade` (from any cohort level including global at ~20% WR → Grade D) → suppressed ALL signals since backstop was added. Now uses `_regime_grade` from `_regime_cohort` only — `None` when no regime-level cohort with n≥30 → never gates (consistent with WR gate behavior). **Root cause of zero Telegram signals June 15–19 confirmed and fixed.**

### Applied 2026-06-19 (PRODUCTION.TRUTH.VERIFICATION.1) — commit `57e9cea`
- ✅ **P0 FG-01**: counts route queried `return_r` (non-existent) — all WR/expectancy/PF metrics returned 0. Fixed to `rr_achieved`.
- ✅ **P0 FG-02**: win_rate_7d denominator excluded TIMEOUT outcomes → inflated vs Edge tab. Added TIMEOUT to resolved set.
- ✅ **P0 H-02**: SystemStatusBanner AI status read from `features.ai_validation` (non-existent) → always showed AI OFF. Fixed to `ai.enabled`.
- ✅ **P1 PC-03**: `sharpe_ratio` (Python) vs `sharpe` (TypeScript) → Sharpe always blank. Fixed TypeScript interface + render.
- ✅ **P1 PC-04**: `report_date` (Python) vs `generated_at` (TypeScript) → Edge tab timestamp always blank. Fixed to read `report_date ?? generated_at`.
- ✅ **P1 H-11**: win_rate rendered as raw float `42.857142857%`. Added `.toFixed(1)` rounding in TrackRecordTab.
- See `docs/PRODUCTION_TRUTH_VERIFICATION_1.md` for full 64-finding audit (12 P0 / 33 P1 / 19 P2).

---

## KEY ADMIN ROUTES

| Route | Purpose |
|-------|---------|
| `/admin/signals` | Trading overview, signals feed, regime |
| `/admin/performance` | Track record, edge validation, attribution |
| `/admin/system` | Health, anomalies, settings, feature flags |
| `/admin/signals` → (old `/admin/trading`) | Redirects work via next.config.mjs |
| `/admin/performance` → (old `/admin/analytics`) | Redirects work |
| `/admin/system?tab=health` → (old `/admin/intelligence`) | Redirects work |
| `/admin/system?tab=settings` → (old `/admin/settings`) | Redirects work |

---

## DEPLOYMENT CHECKLIST (corrected)

1. Set env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_EMAILS`, `ADMIN_SECRET` (32-byte hex), `BACKEND_URL`
2. Railway: `DATABASE_URL` (port 6543 Transaction Pooler), `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `COINMARKETCAP_API_KEY`, `BINANCE_API_KEY`, `ANTHROPIC_API_KEY`
3. Run all 12 migration files from `database/` in Supabase SQL Editor (order matters — see migration list above)
4. Create admin user in Supabase Auth dashboard
5. Set Anthropic spend limit
6. Verify `/health/ready` returns `{status: "OK"}` on Railway
7. Admin dashboard at `/admin/signals` (not `/admin/trading` — that redirects)
8. AI toggle: System → Settings tab → Quick Controls
9. Feature flags: System → Settings tab → Feature Flags section
