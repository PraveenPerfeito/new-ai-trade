# SignalEdge AI — Claude Code Guide

## Project Overview

AI-powered crypto trading signal scanner (public brand: **SignalEdge AI**) built with **Next.js 14 App Router** + **TypeScript** + **Python FastAPI** backend. Scans top-**200** coins via **CoinMarketCap** (primary), applies an 11-gate quality pipeline, and surfaces high-probability trade setups via a glassmorphism admin dashboard and Telegram alerts. Deployed on **Vercel** (Next.js) + **Railway** (FastAPI + Celery worker).

**Stack:** Next.js 14 · React 18 · TypeScript · Tailwind CSS · Supabase (PostgreSQL + Auth) · @supabase/ssr · Anthropic Claude Haiku · Binance API · CoinMarketCap API · CoinGecko (fallback) · FastAPI · Celery · Upstash Redis · pino · zod

---

## Key Architecture Decisions

1. **11-gate waterfall before AI**: MTF(1h+4h+1d) → volatility → trend strength → setup score → RR check → risk engine → futures intelligence → continuation gate → Claude Haiku. Each gate reduces expensive API calls.
2. **CoinMarketCap primary** — 200 coins in a single API call. CoinGecko is fallback only.
3. **Python scanner is the primary scanner** — `backend/core/scanner/`. The TypeScript `lib/scanner.ts` exists but `/api/scanner/run` now proxies to the Python backend's `/api/scanner/trigger`.
4. **`runtime = 'nodejs'`** on all API routes — Edge runtime not used. Exception: `middleware.ts`.
5. **`globalThis` scheduler singleton** — survives Next.js HMR without duplicate timers.
6. **Risk engine before AI** — rejects grade-F signals without spending Anthropic tokens.
7. **AI toggle** — `AISettings.enabled` in system settings; checked by `ai_validator.py` before each Claude call. Toggle from Admin → Analytics → Calibration tab without redeploying. (`/admin/calibration` redirects there — standalone page was merged in ADMIN.CONSOLIDATION.1.)
8. **Futures intelligence** only runs for `futures` and `high_confidence` modes.
9. **Admin auth — two-layer:**
   - Layer 1: `middleware.ts` (Edge) — Supabase session validation + email allowlist. `ADMIN_PREFIXES` array is the single source of truth for protected paths; includes `/admin`, `/api/admin`, and `/api/analytics` (all 6 analytics routes).
   - Layer 2: `AdminAuthMiddleware` (FastAPI) — shared `X-Admin-Secret` header from proxy
10. **Settings — 3-layer cache**: 60s in-process dict → 1h Redis → PostgreSQL. Redis pub/sub propagates changes to workers within ≤ 5s. (`_MEM_TTL = 60`, `_GEN_CHECK_INTERVAL = 120.0` — both raised from 30s/60s in OPS.CONSOLIDATION.1 R3.)
11. **Safety layer** — `backend/system_settings/safety.py` runs before every `patch_group()` write.
12. **BTC regime cache** — `lib/market-regime.ts` classifies BULL_TREND/BEAR_TREND/SIDEWAYS/HIGH_VOLATILITY/EUPHORIA/CAPITULATION, 5-min module cache.
13. **Continuation gate before AI** — continuationProbability < 25 rejects without AI tokens.
14. **Institutional score** — `calcInstitutionalScore()`: AI 25% + grade 20% + trend 20% + quality 15% + vol 10% + RR 5% + futures 5% ± regimeAlignment, clamped [0, 100]. FuturesData now includes 5 Phase 7.4A fields: oi_interpretation, funding_trend, positioning_context, breakout_strength, momentum_score.
15. **Signal lifecycle — two systems:**
   - `lib/signal-lifecycle.ts` → `computeLifecycleStage(signal, outcome?)` — server-side computation used by `/api/signals/tactical` and the admin dashboard. Returns: `VALIDATED | AI_APPROVED | TELEGRAM_SENT | ACTIVE | STALE | TP_HIT | SL_HIT | CLOSED | ANALYZED`. ACTIVE = telegramSent + within timeframe window (1h:8h, 4h:24h, 1d:72h). STALE = past window. Used in TacticalTab preset filters and OverviewTab lifecycle chips.
   - `lib/signal-state.ts` → `computeSignalState()` — legacy 7-state computation (DEVELOPING/CONFIRMED/EXTENDED/COOLING/CORRECTING/INVALIDATED/EXPIRED). Retained for TypeScript scanner path; Python backend does not use it.
16. **Health server in Celery worker** — `backend/workers/health_server.py` starts HTTP server on `$PORT` at `worker_ready` signal so Railway health checks pass.
17. **Scan Now routes to Python backend** — `app/api/scanner/run/route.ts` proxies to `${BACKEND_URL}/api/scanner/trigger` (not TypeScript scanner).
18. **AI credit saving** — `AI_MIN_SETUP_SCORE = 78` in `ai_validator.py`. Setup score < 78 → heuristic (no API call). Score ≥ 78 → Claude. Reduces credits ~50%.
19. **Admin users see all signals** — `getAccessContext()` in `lib/access-control.ts` reads Supabase session cookie; admin email → enterprise plan → no confidence floor/daily cap.
20. **Settings API uses class not string** — `get_settings_service().get_group(AISettings)` must pass model class. Passing string `"ai"` causes silent TypeError → setting never read.
21. **Telegram alert deduplication** — Redis key `tg:alert:{SYMBOL}:{LONG|SHORT}` with 1-hour TTL prevents duplicate alerts for the same coin+direction. Direction flip (BUY→SELL) fires immediately. `ALERT_COOLDOWN_HOURS = 1` in `telegram_notifier.py`.
22. **BTC regime native Python gate** — `get_btc_regime()` in `market_fetcher.py` fetches BTC 4h klines, classifies BULL/BEAR/SIDEWAYS/HIGH_VOLATILITY. Two gates in `signal_pipeline.py`: (1) **NULL regime hard gate** — signals with no regime detected are rejected outright (ALPHA.TRUTH.1: N=677, WR=14.9%); (2) soft gate — contra-regime signals require +10 confidence. `market_regime` field persisted to `signals` + `signal_outcomes`.
23. **Operational control gates** — Scanner, Telegram, emergency stop, maintenance mode all enforced in `scan_task.py` + `telegram_notifier.py`. Toggle from Operations Control page. 18 unit tests verify all gate paths.
24. **Analytics intelligence wiring** — All 7 intelligence fields (TrendScore, Sector, Breakout, OI, Funding, Positioning, Regime) flow through: Scanner → Signal → DB → `get_analytics()` → Edge validation → Attribution → Dashboard.
25. **MONITOR.1 operational metrics** — 14 Redis counters track daily scans, signals, Claude rate, fallback rate, Telegram delivery, Binance errors, scan duration. Threshold bands (Healthy/Warning/Critical). `GET /api/analytics/monitor`. `signals_per_day` is now DB-authoritative (queries `signals` table for rolling 24h count; Redis counter is fallback only).
26. **Gate rejection tracking** — `gate_rejections: dict[str, int]` collected per scan in `orchestrator.py`, persisted to `scan_metrics_log` via `record_scan()`. 6 canonical gate keys: `BTC_DOWN_BUY`, `TOXIC_DENYLIST`, `DUPLICATE_SIGNAL`, `CONFIDENCE_REJECTION`, `CMC_REJECTION`, `REGIME_REJECTION`. Visible in System page `GateRejectionGrid`. `normalize_gate_rejections()` in `scan_metrics.py` maps aliases (e.g. `btc_context` → `BTC_DOWN_BUY`).
27. **Production readiness: 9.5/10** — PROD.FIX.1 complete (June 2026): 16 production hardening fixes across P0–P3 + Redis reduction pass. asyncio.run() nesting in FastAPI fixed, analytics auth gap closed, AI degradation Telegram alerts, Binance 451 geo-block detection, Celery worker heartbeat, kline metric batching (~98% Redis reduction per scan). All deferred P2/P3 items from Phase 8.1D resolved. See `docs/PRODUCTION_READINESS_AUDIT.md`.
37. **REDIS.OPTIMIZE.1 — Superseded by OPS.CONSOLIDATION.1** — All O1–O7 items from this audit are implemented. See decision #38 for the live status. `docs/REDIS_OPTIMIZATION_AUDIT.md` is a historical snapshot; `docs/OPS_CONSOLIDATION_1.md` is authoritative.
38. **OPS.CONSOLIDATION.1 — Full ops optimization (June 2026, COMPLETE)** — Supersedes REDIS.OPTIMIZE.1. Target: <200K Redis ops/month + <39K CloudAMQP msgs/month. All backend batches implemented: R1–R6 done (scan_durations removed, heartbeat 600s, gen-check 120s, quota snapshot hourly, EXPIRE skip, health cache 90s). A1–A3 done (heartbeat 600s, outcomes every 30m, anomaly every 2h — all exceed original targets). R8 done: Python INCR calls removed; TypeScript `telemetry.ts` dead reads removed (June 2026). Dashboard consolidation landed as 4 centers (see decision #39), not 3 as originally planned (Anomalies moved to System center). See `docs/OPS_CONSOLIDATION_1.md`.
39. **ADMIN.CONSOLIDATION.1 — 13 pages → 4 operational centers (June 2026)** — All admin pages merged into: `/admin/trading` (overview/scanner/signals/tactical/regime), `/admin/intelligence` (providers/cache/sectors/market), `/admin/analytics` (edge/attribution/calibration), `/admin/system` (system/anomalies). Old URLs 301/302 redirect. Shared `ProviderHealthTable` component in `components/admin/provider-health-table.tsx`. `SignalsTab` fetches from `/api/signals/tactical` (with `lifecycleStage` computed) not `/api/signals` (raw). `byGrade` attribution dimension added to `computeAttribution()` for RISKGRADE.FIX.1 validation. See `docs/ADMIN_CONSOLIDATION_1.md`.
40. **active_signals count — PostgREST subquery fix (June 2026)** — `/api/signals/counts` was using `.not('id','in','(select signal_id from ...)')` — PostgREST does NOT support SQL subqueries in filter values. The query errored silently; `count ?? 0` always returned 0. Fixed via two-step: fetch signal IDs first, then `.in('signal_id', ids).neq('outcome','PENDING')` count.
41. **ALPHA.TRUTH.1 — Signal quality audit (June 2026, commits `70af050` + `11a3133`)** — 30d/1,708 resolved signal audit found 3 root causes. Fixes: (1) **NULL regime hard gate** in `signal_pipeline.py`: `if not btc_regime: return None` — N=677 NULL-regime signals had WR=14.9%, Exp=−0.543R; prior `regime_adj=15` soft gate was bypassed by intelligence boosts. (2) **OI_NEUTRAL +6 boost restored** — CONF.FIX.1 had wrongly removed it; OI_NEUTRAL signals are N=38, WR=76.3%, Exp=+1.776R; the 90-95 confidence band collapse was caused by NULL-regime signals getting the boost, not OI_NEUTRAL itself. (3) **Futures risk penalty → 0.0** — penalty `5.0 → 2.0` (RISKGRADE.FIX.1) was insufficient; Grade C is 98.9% futures + 72.5% confirmed breakout = genuinely outperforming cohort; penalty distorted grades without improving outcomes. Also: spot `min_confidence` raised 80 → 85 (80-85 band was −0.09R expectancy).
28. **Celery broker — CloudAMQP (AMQP), not Redis** — `CELERY_BROKER_URL=amqps://...@cloudamqp.com` set in Railway. Eliminates ~34,560 Redis BLPOP ops/day (the dominant consumer). `celery_app.py` checks `broker_use_ssl` and `redis_backend_use_ssl` independently so switching broker to AMQP doesn't break Upstash result backend SSL. `SchedulerCoordinator` uses `redis_url` directly (not `broker_url`) — distributed locks, enable/disable state, and scan timestamps are unaffected by broker change.
29. **Celery result backend — `rpc://`** — `CELERY_RESULT_BACKEND=rpc://` set in Railway. Stores task results in CloudAMQP instead of Upstash. Zero Redis ops for result storage. Safe: no code calls `AsyncResult.get()` on scheduled task results.
30. **SchedulerCoordinator fail-open** — `is_enabled()` and `acquire_scan_lock()` in `backend/scheduler/coordinator.py` catch all Redis exceptions and return `True` (enabled / lock-acquired). Scans continue during Redis quota exhaustion or outages. Emergency stop still propagates via settings pub/sub (independent path). Dashboard polling reduced to 60–120s (was 30s) across all admin pages — saves ~22,000 Redis ops/day.
31. **SchedulerCoordinator async variant** — FastAPI callers must use `await coordinator.status_async()`, not `coordinator.status()`. The sync `status()` calls `asyncio.run()` which raises `RuntimeError: This event loop is already running` inside FastAPI's running event loop. `status_async()` uses `loop.run_in_executor()` for sync Redis reads and `asyncpg` directly for DB reads — no nested event loops.
32. **Celery worker heartbeat** — `celery:worker:last_heartbeat` Redis key (TTL 1800s) written by `write_worker_heartbeat()` on `worker_ready` signal and refreshed every **600s (10 min)** via the `worker-heartbeat` beat task. `/health/ready` checks age < 900s → ok. (`beat_schedule.py` was 60s → 240s → 600s per PLATFORM.TRUTH.1 + OPS.CONSOLIDATION.1; saves 4,320 CloudAMQP msgs/month.)
33. **Binance kline metric batching** — `_record_binance_kline_metric()` in `market_fetcher.py` accumulates successes/latencies/errors for 5 seconds, then flushes a single Redis pipeline. Reduces Redis ops from ~240 individual pipelines per scan to 1 batched pipeline (~98% reduction). Binance 451 (geo-block) detected separately: consecutive failures ≥ 5 or HTTP 451 → hourly-throttled Telegram alert.
34. **useAutoRefresh stable identity** — `lib/use-auto-refresh.ts` uses a `fetcherRef = useRef(fetcher)` to hold the latest fetcher without it becoming a `useCallback` dependency. The refresh callback has empty deps `[]` — stable identity across renders — so the `useEffect` interval is set once and never reset by inline function recreation. Previously a new arrow function passed as `fetcher` caused the interval to reset every render cycle (over-fetching).
35. **Grade calibration — RISKGRADE.FIX.1 superseded by ALPHA.TRUTH.1** — Root cause audit (30d, n=1,708): Grade C Exp=+0.962R vs A=+0.098R (9.8×). RISKGRADE.FIX.1 (commit `1ad5ef2`) reduced futures penalty `5.0 → 2.0`; added breakout quality bonus (HIGH_MOMENTUM +15, CONFIRMED +10, EARLY +4); regime quality adjustment (BEAR/BULL +5, UNKNOWN −10). Grade C > A persisted post-fix. ALPHA.TRUTH.1 (commit `11a3133`) completed the fix: futures penalty **removed entirely (0.0)** — Grade C is 98.9% futures + 72.5% confirmed breakout = genuinely better cohort, not a penalty artifact. NULL regime hard gate (decision #22) removed the contaminating N=677 NULL-regime signals. `RiskInput` has `btc_regime` + `breakout_strength`; `RiskResult` has `grade_factors` dict. See `docs/RISKGRADE_TRUTH_1.md`. POSTFIX.1 targets from FIX.1 are void — superseded by ALPHA.TRUTH.1.
36. **MARKET_STRUCTURE.FIX.1 — regime-aware thresholds** — F4 trend exhaustion SELL RSI-sustained threshold 5→8 in BEAR_TREND/CAPITULATION; F6 S/R rejection SELL pivot threshold 2→3 in BEAR_TREND/CAPITULATION. 7 `ms_*` sub-condition keys tracked in `gate_rejections` per scan; `MarketStructureBreakdown` table on System dashboard (24h + 7d). Commit `405c11f`. POSTFIX.1 validation after 7 days deployed.
42. **SCREENED lifecycle stage** — `computeLifecycleStage()` in `lib/signal-lifecycle.ts` returns `SCREENED` (sky-400) when `signal.validationSource === 'HEURISTIC'`, and `AI_APPROVED` (purple) only for Claude-validated signals. Fixes false "AI Approved" badge when AI toggle is disabled. `STAGE_META` + `STAGE_TIPS` in `app/admin/trading/page.tsx` define labels/colors/hover tooltips for all 10 stages. Telegram alerts show "🤖 AI Approved" vs "🔍 Screened" on the Grade line based on `validation_source`. `isActiveStage()` includes SCREENED.
43. **INTELLIGENCE.CENTER.1 — Intelligence Center redesign (June 2026)** — All 4 tabs (+ new News tab) overhauled: **Providers**: 4 summary tiles (services up, avg latency, CMC cache, Celery worker) + ProviderHealthTable + provider stack cards with latency. **Cache**: 4 quick-refresh cards per intelligence source (Market Snapshot/Global Metrics/Sector Intelligence/Trending Engine) each with FRESH/STALE + age + individual Refresh; Refresh All Sources propagates to sectors + market polling hooks; hit-rate mini bars on groups. **Sectors**: up to 8 coins per category, mini price bar, volume, stacked distribution bar. **Market**: restructured into 5 sections — BTC Regime, Global Metrics, Market Breadth + Top Movers, Trending Assets table, News Sentiment. **News** (new 5th tab): Grok live search via `/api/news/grok`; auto-fetches on tab open; bullish/bearish/neutral summary tiles; article feed with sentiment badges + source + time-ago. See decision #44.
44. **Grok live news — `/api/news/grok`** — Calls xAI `grok-2-latest` with `search_parameters.mode="on"` + `sources=[news,web]` for real-time crypto headlines. Returns 12–15 structured articles (title, url, source, publishedAt, sentiment, summary). **No Redis** — 5-min module-level in-process cache only (resets on Vercel cold start). Force-bypass via `?force=1`. Falls back to `citations[]` array if JSON parse of content fails. Requires `XAI_API_KEY` env var in Vercel (not Railway — route is Next.js only). Without key returns 503 with clear message.

---

## Phase 7.3A & 7.4A Intelligence Pipeline Overhaul

### Phase 7.3A (CMC Intelligence Pipeline + Trending Universe Fusion + 10 New Intelligence Modules)

**Motivation:** Split CMC quota consumption into two independent paths — TypeScript workers write to Redis cache every 5 minutes, Python scanner reads cache only. Eliminate double-spending that was burning 40% of quota budget on duplicate API calls.

**Key Changes:**
1. **Redis Intelligence Cache** — TypeScript workers (`lib/intelligence/`) fetch CMC trending, listings, sector data → write to Redis keys `cache:intel:listings`, `cache:intel:trending`, etc. (5-min TTL). Python scanner reads cache, zero direct CMC calls.
2. **Trending Universe Fusion** — 5-source discovery (CMC Trending, Rising Sectors, Top Movers, Listings, Watchlist) replaces basic 24h price-change filter. Consistent 80-coin universe.
3. **TrendScore Engine** — 7-component 0-100 prioritization: CMC rank weight, Relative Strength (4h), Sector Strength, Volume, Market Cap Tier, Breakout Momentum, Futures Integration.
4. **Relative Strength 4h** — Replaced 24h RS (too noisy) with 4h coin close change / 4h BTC close change. BTC 4h fetched once per scan, Redis-cached 5 min.
5. **Sector Intelligence** — CMC sector states tracked per category: STRONGEST, ACCELERATING, NEUTRAL, WEAKENING, OVERCROWDED (60-min baseline TTL aligned with CMC categories cache refresh cycle).
6. **Futures Funding Calibration** — Directional decomposition: adverse_rate = max(0, ±funding_rate) based on signal direction. FAVORABLE/NORMAL/ELEVATED/EXTREME tiers.
7. **EMA200 Convergence Guards** — 1h/4h fetch increased 200→300 candles. `direction_reliable(≥250c)` / `bounce_reliable(≥280c)` gates prevent unconverged EMA200 false signals.
8. **Fallback Observability** — Redis `intel:fallback:status` key (30-min TTL), Telegram alert on CMC cache cold (15-min throttle), Prometheus counter.

**New files:**
- `backend/core/scanner/intelligence_cache.py` — Redis CMC cache reader
- `backend/core/scanner/trending_universe.py` — 5-source trending discovery
- `backend/core/scanner/trend_score.py` — 7-component prioritization
- `backend/core/scanner/relative_strength.py` — 4h RS vs BTC
- `backend/core/scanner/sector_intelligence.py` — CMC sector classification
- `backend/core/scanner/futures_funding.py` — Directional funding context
- `backend/core/scanner/ema_convergence.py` — EMA200 convergence math

### Phase 7.4A (Breakout + OI + Positioning Intelligence)

**Motivation:** Detect institutional entry points (breakout above resistance, OI accumulation patterns, crowd position extremes). Add missing 20/30-day momentum signals that systematically missed 25% of best setups.

**Key Changes:**
1. **Breakout Intelligence** — 20/30-day high/low breakout detection (ALL modes including SPOT). BB expansion after squeeze. NONE/EARLY_BREAKOUT(+5)/CONFIRMED(+8)/HIGH_MOMENTUM(+12) scoring.
2. **OI Intelligence** — Replaces raw OI_change_24h. Price×OI matrix: NEW_LONGS, NEW_SHORTS, SHORT_COVERING, LONG_LIQUIDATION, NEUTRAL. Fixes bug where SHORT_COVERING rallies were incorrectly penalized.
3. **4h EMA200 Guard** — `candle_count_4h` passed to `detect_setup()`. Same direction_reliable/bounce_reliable gates applied to 4h EMA200.
4. **Funding Trend** — Last 3 funding readings stored in Redis (8-hour TTL). RISING/FALLING/STABLE classification. RISING → adverse × 1.3, FALLING → adverse × 0.7 before tier classification.
5. **Positioning Intelligence** — L/S crowd context (EXTREME_LONG/LONG_HEAVY/BALANCED/SHORT_HEAVY/EXTREME_SHORT). Contrarian scoring: EXTREME_SHORT on BUY = +8, EXTREME_LONG on BUY = −8. Replaces old 2-case check.

**New files:**
- `backend/core/scanner/breakout_intelligence.py` — 20/30-day breakout detection
- `backend/core/scanner/oi_intelligence.py` — OI × price direction matrix
- `backend/core/scanner/positioning_intelligence.py` — L/S crowd positioning

**Database migrations:**
- `database/phase-7-4a-intelligence-migration.sql` — signals + signal_outcomes: +breakout_type, +breakout_strength, +oi_interpretation, +funding_trend, +positioning_context, +momentum_score, +trend_score
- `database/phase-7-4a-6-3-migration.sql` — Signal model: +breakout_strength, +oi_interpretation, +funding_trend, +positioning_context
- `database/phase-7-4a-7-2-migration.sql` — signals + signal_outcomes: +sector_status

**Calibration updates:**
- AI_MIN_SETUP_SCORE: 70 → 72
- Funding gate: abs > 0.002 → directional adverse > 0.007
- Price crash filter: -50% → -20%
- BB squeeze: 80% → 70% of avg width
- THREE_WHITE_SOLDIERS: added body overlap check
- MORNING/EVENING_STAR: body ratio 0.45 → 0.60
- Futures symbol cache: 30 min → 60 min
- Stablecoin prefix filter added (USD*, DAI*, BUSD*, USDE*)

**Phase 7.4A.6 — Claude Institutional Context Upgrade:**
- Claude prompt now receives OI interpretation, funding trend, positioning context, breakout type, rejection criteria
- AI input completeness: 62% → 85%

**Phase 7.4A.6.4 — Telegram Institutional Context Upgrade:**
- Intel line: "OI: NEW LONGS · Pos: SHORT HEAVY · Fund: RISING ↗"
- Breakout line: "Breakout: HIGH MOM (30d high)" in Technical section

**Phase 7.4A.7.1 — TrendScore Signal Propagation:**
- trend_score_map built from TrendingMeta in orchestrator
- TrendScore flows: TrendingMeta → scan_coin() → Signal → signals table → signal_outcomes

**Phase 7.4A.7.2 — Sector Intelligence Signal Propagation:**
- sector_status_map built from SectorIntelligenceReport in orchestrator
- sector_status flows: orchestrator → scan_coin() → Signal → DB → Claude → Telegram
- Telegram: "Sector: 🚀 ACCELERATING" in Technical section
- Claude: "Sector: ACCELERATING" in Quality Metrics section

**Phase 7.2B.0 — Dashboard Intelligence Visibility:**
- /admin/signals: Intelligence section added to every expanded signal card
- Shows: TrendScore tier badge, Sector status, Breakout strength+type, OI interpretation, Funding trend, Positioning context
- Color-coded: Elite/Strong/Good/Weak tiers for TrendScore
- Mobile: flex-wrap chips, readable on all screen sizes

---

## Phase 7.2B — Founder Settings & Operations Simplification (May 2026)

Complete redesign of admin dashboard for founder operational clarity and workflow efficiency.

### Phase 7.2B.1 — Founder Settings Simplification
- `/admin/settings` redesigned as "Founder Control Center"
- 3 primary modes: Conservative / Balanced / Aggressive
- Advanced Presets accordion: Institutional / Sniper / Futures Tactical / Rotation Hunter
- FounderSummaryCard: signals/day, quality, risk, min R:R
- 4 key controls: Signal Quality, Signal Frequency, Risk Level, Min RR
- Advanced Settings accordion for remaining controls
- ActiveSettingsSummary panel

### Phase 7.2B.2 — Provider Operations Simplification
- `/admin/providers` redesigned as "Operations Dashboard"
- ProviderStatusBoard: 3 compact cards (CMC/Binance/CoinGecko)
- OperationsSummary: 5 cells (Primary/Execution/Fallback/Quota/Failovers)
- QuotaBurnForecast: Safe/Moderate/High + days remaining
- CompactProviderCard: collapsed by default (~56px), Details expands

### Phase 7.2B.3 — Regime Workflow Automation
- `/admin/regime`: Apply Regime Settings button added
- Preview modal shows current → new values before applying
- 6 regime mappings: BULL_TREND→Aggressive, BEAR_TREND→Conservative, etc.
- Regime vs Applied Profile mismatch indicator
- Last Applied timestamp (localStorage)
- applyMode() calls adminApi.settings.patch()

### Phase 7.2B.4 — Anomalies Action Center
- `/admin/anomalies` redesigned as "Anomaly Action Center"
- 4 action buttons per anomaly: Acknowledge, Mute (15m/1h/24h), Resolve, Detail
- State machine: NEW → ACKNOWLEDGED → MUTED → RESOLVED
- Detail drawer: source, provider, suggested action
- 4-tile Active Issues summary (Critical/Warning/Info/Muted)
- State persisted in localStorage

### Phase 7.2B.5 — Founder Navigation Cleanup
> **Superseded by ADMIN.CONSOLIDATION.1 (June 2026).** The 13 individual pages below were consolidated into 4 centers. See Key Architecture Decision #39 and `docs/ADMIN_CONSOLIDATION_1.md`.
- Sidebar restructured into 4 groups:
  - TRADING DESK: Overview, Signals, Tactical, Settings
  - MARKET: Intelligence, Regime, Sectors
  - OPERATIONS: Scanner, Anomalies, Providers, Cache, System
  - REVIEW: Analytics, Calibration
- Brand renamed to "SignalEdge"
- Quick Actions footer: Signals, Scanner links

### Phase 7.2B.6 — Dashboard UX Updates
- **Overview (6.1)**: Scanner + Regime as hero row (3:2 split); Metric tiles: Sent Today, TP Hit, SL Hit, Providers Up
- **Signals (6.2)**: Expanded card: Trade / Technical / AI / Intelligence / Futures sections
- **Tactical (6.3)**: Table replaced with card-based rows; colored left accent bar per stage; preset buttons with live counts
- **Market (6.4)**: Hero regime card, compact breadth bar, 6 trending coins
- **Sectors (6.4)**: Category cards with STRONGEST/ACCELERATING/WEAKENING/OVERCROWDED badges
- **Analytics & Calibration (6.5)**: 3 section dividers (Current State/Performance/Historical); Confidence tiers as 2×2 cards; Confidence bands as progress bar rows
- **Cache & System (6.6)**: Hit-rate progress bars, fresh/stale count, compact workers; larger status banner, System Stack table removed

### Phase 7.2B.7 — Production Readiness Audit
- Overall score: 7.4/10
- 2 BLOCKERS: .env.local git exposure risk, ADMIN_SECRET optional
- 5 HIGH PRIORITY: console.log, Celery timeout, beat expiry, infra_collector exception loop, no per-minute Anthropic rate limit
- 6 MEDIUM PRIORITY: setup/AI threshold mismatch, fire-and-forget logging, hardcoded refresh intervals, ATR floor, rejection persistence, score clamp
- CONDITIONAL GO for production (see `docs/PRODUCTION_READINESS_AUDIT.md`)

**Current scanner config (tuned for production):**
- **Spot:** min_mcap=$200M, min_vol=$20M, confidence≥80, max_coins=80
- **Futures:** min_mcap=$1B, min_vol=$200M, confidence≥82, max_coins=50
- **High_confidence:** min_mcap=$2B, min_vol=$500M, confidence≥87, max_coins=30
- **Trending:** min_mcap=$50M, min_vol=$10M, confidence≥78, max_coins=80

---

## Phase MARKET_STRUCTURE.FIX.1 — Regime-Aware Thresholds + Sub-Condition Telemetry (June 2026)

**Motivation:** MARKET_STRUCTURE.TRUTH.1 audit identified 939 market structure rejections over 14 days. F6 S/R rejection was too aggressive in BEAR_TREND (support levels break; blocking SELL there hurts expectancy). F4 trend exhaustion RSI threshold was too tight for extended bear markets.

**Changes:**
1. **F4 Trend Exhaustion** — SELL RSI-sustained candle threshold: 5→8 in `BEAR_TREND`/`CAPITULATION`. Spot bears run longer before exhaustion; the old threshold was firing on normal trend continuation.
2. **F6 S/R Rejection** — SELL pivot-support count threshold: 2→3 in `BEAR_TREND`/`CAPITULATION`. Support levels break down in bear markets; prior threshold was blocking valid breakdown SELL signals.
3. **Sub-condition telemetry** — `_ms_record(key, gate_rejections)` helper records which of 7 market structure filters fired per scan. 7 new keys (`ms_sideways`…`ms_weak_breakout`) in `GATE_REJECTION_KEYS`. `MarketStructureBreakdown` table on System dashboard shows 24h + 7d breakdown.

**Files changed:** `backend/core/scanner/market_structure.py`, `signal_pipeline.py`, `backend/analytics/scan_metrics.py`, `app/admin/system/page.tsx`  
**Tests:** 46/46 passing (16 new regime-aware tests). Commit `405c11f`.  
**POSTFIX.1:** After 7 days, validate ms_sr_rejection + ms_trend_exhaustion counts decrease and newly unblocked signals have WR ≥ 48%.

---

## Phase RISKGRADE.TRUTH.1 — Grade Audit (June 2026)

**Finding:** Grade C Exp=+0.962R vs Grade A Exp=+0.098R (9.8× gap). Grade C is not a quality tier — it is an accidental futures-mode bucket.

**Root causes:**
1. **Flat +5 futures penalty** (`risk.py:295`) pushes confirmed-breakout futures signals (quality 75, risk 32→37) from Grade B into Grade C. Grade C is 98.9% futures, 70.3% confirmed breakout.
2. **NULL market_regime contaminates A/B** — 40% of Grade A signals have NULL `market_regime` with WR=15%, Exp=−0.535R, dragging Grade A headline from ~+0.48R to +0.098R.
3. **Quality score ignores breakout/regime context** — `_calc_quality_score()` scores RR, volume, MACD, RSI, volatility, SL distance. No breakout, regime alignment, OI, or positioning input. Confirmed breakout signals (WR=54–82%) receive same quality weight as no-breakout signals.

**Key data (30d, n=1,708 resolved):**

| Grade | n | WR | Exp | Futures% | Confirmed Breakout% | NULL Regime% |
|-------|---|----|-----|---------|--------------------|----|
| A | 845 | 35.4% | +0.098R | 12.9% | 31.8% | 39.6% |
| B | 772 | 36.7% | +0.136R | 10.4% | 44.4% | 41.3% |
| C | 91 | 56.0% | +0.962R | 98.9% | 70.3% | 26.4% |

Grade A/B in BEAR_TREND (regime known): WR=49–51%, Exp=+0.52–0.59R — excellent. The problem is grade contamination from NULL-regime signals, not bad signal generation.

**Fix:** RISKGRADE.FIX.1. See `docs/RISKGRADE_TRUTH_1.md`.

---

## Phase RISKGRADE.FIX.1 — Grade Recalibration (June 2026)

**Motivation:** RISKGRADE.TRUTH.1 audit found Grade C Exp=+0.962R vs Grade A Exp=+0.098R (9.8× gap). Flat +5 futures risk penalty was the primary driver — pushing quality futures signals from Grade B into Grade C. NULL-regime contamination (40% of Grade A/B signals) was secondary. Quality scoring had no breakout or regime inputs.

**Changes (commit `1ad5ef2`):**
1. **Futures risk penalty** — `risk.py`: `+5.0 → +2.0`. Promotes confirmed-breakout futures signals (quality ~75, base risk ~32) from Grade C back to Grade B.
2. **Breakout quality bonus** — `_calc_quality_score()`: HIGH_MOMENTUM_BREAKOUT +15, CONFIRMED_BREAKOUT +10, EARLY_BREAKOUT +4. Rewards the highest-WR signal type in the system (WR 54–82%).
3. **Regime quality adjustment** — `_calc_quality_score()`: BEAR/BULL/CAPITULATION/EUPHORIA +5, UNKNOWN/NULL −10. Penalises the NULL-regime cohort (WR=15%) that was contaminating Grades A and B.
4. **Grade factors telemetry** — `RiskResult.grade_factors` dict: `base_quality`, `breakout_bonus`, `regime_bonus`, `futures_penalty`, `final_quality`, `final_risk`. Enables post-deployment calibration analysis.

**Model changes:**
- `RiskInput`: +`btc_regime: str = "SIDEWAYS"`, +`breakout_strength: str | None = None`
- `RiskResult`: +`grade_factors: dict[str, float] = {}`
- `signal_pipeline.py`: Step 9 `validate_risk()` call now passes `btc_regime` + `breakout_strength`

**Tests:** 40/40 passing (8 new in `TestRiskgradeFix1`).

**Expected outcome (simulation):**
- Grade A WR: 35.4% → ~42–48% (NULL-regime signals deprioritized via quality penalty)
- Grade B WR: 36.7% → ~43–47% (confirmed-breakout futures migrate in from C)
- Grade C: residual borderline signals only; WR ~50–55%
- Monotonicity A > B > C for WR and expectancy ✅

**POSTFIX.1 (7 days post-deploy):** Measure grade distribution shift, WR per grade, % Grade A with NULL regime, % Grade C from futures.

---

## File Map

```
lib/
  scanner.ts            ← TypeScript scanner (legacy — Scan Now button now proxies to Python backend)
  coingecko.ts          ← delegates to MarketDataService; CMC primary, CoinGecko fallback
  market-data/
    manager.ts          ← ProviderManager; CMC priority 1, CoinGecko priority 2
    service.ts          ← MarketDataService singleton
    providers/          ← coinmarketcap.ts · coingecko.ts · binance.ts · dexscreener.ts
  indicators.ts         ← RSI, MACD, EMA, ATR, volume spike, trend strength (TypeScript)
  risk.ts               ← risk score, quality score, grade A-F, leverage tiers
  ai-validator.ts       ← Claude Haiku validation + heuristic fallback
  market-regime.ts      ← getMarketRegime() — BTC 4h regime; 5-min module cache
  continuation.ts       ← analyzeContinuation() — probability 10–95
  signal-state.ts       ← computeSignalState() — 7-state lifecycle
  institutional-score.ts← calcInstitutionalScore() — 7-component weighted composite
  market-structure.ts   ← 10 false-positive filters
  binance.ts            ← spot + futures klines, funding, OI, L/S; withApiRetry wrapped
  supabase.ts           ← DB ops; getRecentSignals() orders by created_at DESC (last 7 days)
  admin-api.ts          ← typed fetch client for the Python backend (/api/admin/* proxy)
  window-label.ts       ← analyticsWindowLabel(hours) + explicitWindowNote(hours) — consistent window labels across dashboard

backend/core/scanner/   ← PRIMARY scanner (Python) — all new features here
  models.py             ← Pydantic models; TechnicalIndicators has ema200, bb, candle_pattern, ema_cross
  indicators.py         ← RSI·MACD·EMA20/50/200·ATR·BB·volume·ADX·candlestick·EMA crossover
  market_structure.py   ← 7-filter market quality gate
  signal_pipeline.py    ← detect_setup() scores EMA200/BB/daily/patterns/crossover/rel-strength/breakout
  orchestrator.py       ← run_scan(); CMC 200 coins; 3 timeframes (1h+4h+1d); btc_change_24h; Redis intel cache reader; gate_rejections dict per scan
  market_fetcher.py     ← reads Redis intelligence cache (populated by TS layer); CMC fallback via TS
  ai_validator.py       ← checks AISettings.enabled + setup_score < 78 → heuristic; semaphore(3)
  risk.py               ← grade A–F; quality score; leverage tiers
  futures_intelligence.py← directional funding rate, OI×price intelligence, L/S positioning, funding trend
  telegram_notifier.py  ← detailed signal format with leverage/% targets; 1-hour dedup cooldown per symbol+direction
  intelligence_cache.py ← Redis CMC intelligence reader (trending, listings, sector data)
  trending_universe.py  ← 5-source fusion (CMC Trending, Rising Sectors, Top Movers, Listings, Watchlist); 80 coins
  trend_score.py        ← 7-component 0-100 prioritization (CMC rank, RS, sector, volume, mcap tier, momentum, futures)
  relative_strength.py  ← 4h RS engine vs BTC; cached 5 min
  sector_intelligence.py← CMC sector states (STRONGEST/ACCELERATING/NEUTRAL/WEAKENING/OVERCROWDED)
  futures_funding.py    ← directional funding context (FAVORABLE/NORMAL/ELEVATED/EXTREME)
  ema_convergence.py    ← 250/280 candle guards for direction_reliable / bounce_reliable
  breakout_intelligence.py← 20/30-day high/low detection; detect_breakout_strength() returns EARLY_BREAKOUT(+5)/CONFIRMED_BREAKOUT(+8)/HIGH_MOMENTUM_BREAKOUT(+12); BB expansion after squeeze
  oi_intelligence.py    ← OI × price direction matrix; classify_oi() → NEW_LONGS/NEW_SHORTS/SHORT_COVERING/LONG_LIQUIDATION/NEUTRAL; corrects inverted scoring
  positioning_intelligence.py← L/S crowd context (EXTREME_LONG/LONG_HEAVY/BALANCED/SHORT_HEAVY/EXTREME_SHORT); contrarian scoring: EXTREME_SHORT on BUY = +8 pts

backend/workers/
  celery_app.py         ← Celery factory; broker SSL and result-backend SSL checked independently (REDIS.FIX.2 prep)
  health_server.py      ← HTTP server on $PORT — Railway health check target
  scan_task.py          ← @shared_task run_scheduled_scan + check_signal_outcomes; acquire_scan_lock wrapped in try/except
  beat_schedule.py      ← standard/high_confidence/futures + outcome tracker schedules

backend/scheduler/
  coordinator.py        ← SchedulerCoordinator; is_enabled() + acquire_scan_lock() fail-open on Redis errors

backend/system_settings/
  groups.py             ← Pydantic v2 models; AISettings.enabled toggles Claude calls
  service.py            ← SettingsService — 3-layer cache, patch_group()
  safety.py             ← SAFETY_CAPS + semantic rules
  propagation.py        ← PropagationListener + CeleryConfigWatcher

app/api/
  admin/[...path]/      ← proxy to Python FastAPI; injects X-Admin-Secret header
  scanner/run/          ← POST — proxies to Python backend /api/scanner/trigger
  signals/              ← GET — recent signals (last 7 days, newest first)

app/admin/
  trading/page.tsx      ← Trading Operations — 5 tabs: overview(scanner+regime+metrics+recent signals) · scanner(celery+ops toggles+gate analysis) · signals(feed, /api/signals/tactical, pagination 20/page) · tactical(lifecycle preset filter+LifecycleFunnel+StageLegend) · regime(apply regime settings). STAGE_META + STAGE_TIPS define 10-stage badge labels/colors/hover tooltips. fmtPx() formats entry/TP/SL prices. SCREENED stage (sky-400) for heuristic validation; AI_APPROVED (purple) for Claude only.
  intelligence/page.tsx ← Intelligence Center — 5 tabs: providers(8-service health+summary tiles) · cache(quick-refresh cards+quota+groups+workers) · sectors(category grid+coins+distribution bar) · market(regime+global+breadth+trending+news) · news(Grok live search)
  analytics/page.tsx    ← Analytics & Calibration — 3 tabs: edge(verdict+calibration bands) · attribution(by regime/state/grade/mcap/timeframe + AI effectiveness + RiskGradeAnalysis) · calibration(Claude success+latency+verdict distribution)
  system/page.tsx       ← System Health — 2 tabs: system(service grid+provider health+monitor+pipeline integrity+gate rejections+market structure breakdown) · anomalies(4-state action center)
  settings/page.tsx     ← Founder Control Center — 3 primary modes, Advanced Presets, 4 key controls; paper_trading group hidden
  [old pages]           ← overview/scanner/signals/tactical/regime/providers/cache/sectors/market/calibration/anomalies all redirect via next.config.mjs + server-side redirect()

components/admin/
  provider-health-table.tsx ← shared ProviderHealthTable + ProviderCheckResult type; used by system/ and intelligence/ pages

app/api/signals/
  tactical/route.ts     ← GET — maps raw signals through computeLifecycleStage(); filters by lifecycleStage/type/mode; used by all dashboard signal feeds
  counts/route.ts       ← GET — DB-authoritative counts: signals_today(24h), active_signals(7d minus resolved), win_rate_7d, expectancy_7d

app/api/news/
  route.ts              ← GET — fear & greed + headlines (cached in Redis); used by Market tab
  grok/route.ts         ← GET — xAI Grok-2 live web+news search; returns 12–15 structured articles; 5-min module cache only (no Redis); requires XAI_API_KEY (Vercel env)

lib/
  access-control.ts     ← getAccessContext() checks Supabase session — admin email → enterprise plan

Dockerfile              ← python:3.12-slim + gcc + pip --prefer-binary (prevents 1hr numpy compile)
database/
  analytics-schema.sql  ← signal_outcomes with partial index for PENDING resolution query

backend/analytics/
  tests/test_dashboard_truth.py ← AI summary null-token column handling + monitoring DB signal count tests
```

---

## Coding Conventions

- **New API routes**: import `parseBody`/`parseQuery` from `lib/validate`, `createLogger` from `lib/logger`. Return `{ success, error }` envelope.
- **New lib modules**: `createLogger('lib/module-name')` at module level. Wrap external API calls in `withApiRetry`.
- **No `console.log`** — use pino logger (`log.info`, `log.warn`, `log.error`). Exception: `middleware.ts` is Edge-only; use `console.warn`.
- **Env access**: use `getEnv()` or the `env` proxy from `lib/env.ts`, never `process.env` directly.
- **Cache**: use `getOrSet()` on the shared cache instances in `lib/cache.ts` for any data fetched from external APIs.
- **Client components**: prefix file with `'use client'`. Error boundary is already at root layout. Never import `lib/supabase/server.ts` or `lib/supabase/admin.ts` in client components.
- **Supabase clients**: use `createSupabaseServerClient()` in Server Components/Route Handlers, `createSupabaseBrowserClient()` in Client Components, `createSupabaseAdminClient()` only for server-side writes that need to bypass RLS.
- **Admin auth**: all `/admin/*` and `/api/admin/*` routes are protected by middleware. The Python proxy at `app/api/admin/[...path]/route.ts` adds `X-Admin-Secret` automatically — do not duplicate this.
- **Settings writes**: always call `svc.patch_group()`, never write to `settings_groups` directly. The service runs safety checks and wraps writes in a transaction.
- **Types**: all shared types in `types/index.ts`.

---

## Running the Project

```bash
npm run dev           # Next.js dev server
npx tsc --noEmit      # type check (must be zero errors)
npm run build         # production build

# Python backend
uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload

# Required env vars (copy .env.example → .env.local)
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
ADMIN_EMAILS=your@email.com        # REQUIRED — blocks all admin access if unset
ADMIN_SECRET=<32-byte hex>         # REQUIRED in prod — openssl rand -hex 32

# First-time setup
# 1. Run database/admin-auth-migration.sql in Supabase SQL Editor
# 2. Create your admin user in Supabase Auth dashboard → Users → Add user
# 3. Set ADMIN_EMAILS to that user's email
```

---

## MCP Tools: code-review-graph

**IMPORTANT: This project has a knowledge graph. ALWAYS use the
code-review-graph MCP tools BEFORE using Grep/Glob/Read to explore
the codebase.** The graph is faster, cheaper (fewer tokens), and gives
you structural context (callers, dependents, test coverage) that file
scanning cannot.

### When to use graph tools FIRST

- **Exploring code**: `semantic_search_nodes` or `query_graph` instead of Grep
- **Understanding impact**: `get_impact_radius` instead of manually tracing imports
- **Code review**: `detect_changes` + `get_review_context` instead of reading entire files
- **Finding relationships**: `query_graph` with callers_of/callees_of/imports_of/tests_for
- **Architecture questions**: `get_architecture_overview` + `list_communities`

Fall back to Grep/Glob/Read **only** when the graph doesn't cover what you need.

### Key Tools

| Tool | Use when |
|------|----------|
| `detect_changes` | Reviewing code changes — gives risk-scored analysis |
| `get_review_context` | Need source snippets for review — token-efficient |
| `get_impact_radius` | Understanding blast radius of a change |
| `get_affected_flows` | Finding which execution paths are impacted |
| `query_graph` | Tracing callers, callees, imports, tests, dependencies |
| `semantic_search_nodes` | Finding functions/classes by name or keyword |
| `get_architecture_overview` | Understanding high-level codebase structure |
| `refactor_tool` | Planning renames, finding dead code |

### Workflow

1. The graph auto-updates on file changes (via hooks).
2. Use `detect_changes` for code review.
3. Use `get_affected_flows` to understand impact.
4. Use `query_graph` pattern="tests_for" to check coverage.
