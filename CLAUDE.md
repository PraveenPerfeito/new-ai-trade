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
7. **AI toggle** — `AISettings.enabled` in system settings; checked by `ai_validator.py` before each Claude call. Toggle from Admin → Calibration page without redeploying.
8. **Futures intelligence** only runs for `futures` and `high_confidence` modes.
9. **Admin auth — two-layer:**
   - Layer 1: `middleware.ts` (Edge) — Supabase session validation + email allowlist
   - Layer 2: `AdminAuthMiddleware` (FastAPI) — shared `X-Admin-Secret` header from proxy
10. **Settings — 3-layer cache**: 30s in-process dict → 1h Redis → PostgreSQL. Redis pub/sub propagates changes to workers within ≤ 5s.
11. **Safety layer** — `backend/system_settings/safety.py` runs before every `patch_group()` write.
12. **BTC regime cache** — `lib/market-regime.ts` classifies BULL_TREND/BEAR_TREND/SIDEWAYS/HIGH_VOLATILITY/EUPHORIA/CAPITULATION, 5-min module cache.
13. **Continuation gate before AI** — continuationProbability < 25 rejects without AI tokens.
14. **Institutional score** — `calcInstitutionalScore()`: AI 25% + grade 20% + trend 20% + quality 15% + vol 10% + RR 5% + futures 5% ± regimeAlignment, clamped [0, 100].
15. **Signal lifecycle** — `computeSignalState()` → DEVELOPING/CONFIRMED/EXTENDED/COOLING/CORRECTING/INVALIDATED/EXPIRED.
16. **Health server in Celery worker** — `backend/workers/health_server.py` starts HTTP server on `$PORT` at `worker_ready` signal so Railway health checks pass.
17. **Scan Now routes to Python backend** — `app/api/scanner/run/route.ts` proxies to `${BACKEND_URL}/api/scanner/trigger` (not TypeScript scanner).
18. **AI credit saving** — `AI_MIN_SETUP_SCORE = 72` in `ai_validator.py`. Setup score < 72 → heuristic (no API call). Score ≥ 72 → Claude. Reduces credits ~40%.
19. **Admin users see all signals** — `getAccessContext()` in `lib/access-control.ts` reads Supabase session cookie; admin email → enterprise plan → no confidence floor/daily cap.
20. **Settings API uses class not string** — `get_settings_service().get_group(AISettings)` must pass model class. Passing string `"ai"` causes silent TypeError → setting never read.
21. **Telegram alert deduplication** — Redis key `tg:alert:{SYMBOL}:{LONG|SHORT}` with 1-hour TTL prevents duplicate alerts for the same coin+direction. Direction flip (BUY→SELL) fires immediately. `ALERT_COOLDOWN_HOURS = 1` in `telegram_notifier.py`.

---

## Phase 7.3A & 7.4A Intelligence Pipeline Overhaul

### Phase 7.3A (CMC Intelligence Pipeline + Trending Universe Fusion + 10 New Intelligence Modules)

**Motivation:** Split CMC quota consumption into two independent paths — TypeScript workers write to Redis cache every 5 minutes, Python scanner reads cache only. Eliminate double-spending that was burning 40% of quota budget on duplicate API calls.

**Key Changes:**
1. **Redis Intelligence Cache** — TypeScript workers (`lib/intelligence/`) fetch CMC trending, listings, sector data → write to Redis keys `cache:intel:listings`, `cache:intel:trending`, etc. (5-min TTL). Python scanner reads cache, zero direct CMC calls.
2. **Trending Universe Fusion** — 5-source discovery (CMC Trending, Rising Sectors, Top Movers, Listings, Watchlist) replaces basic 24h price-change filter. Consistent 80-coin universe.
3. **TrendScore Engine** — 7-component 0-100 prioritization: CMC rank weight, Relative Strength (4h), Sector Strength, Volume, Market Cap Tier, Breakout Momentum, Futures Integration.
4. **Relative Strength 4h** — Replaced 24h RS (too noisy) with 4h coin close change / 4h BTC close change. BTC 4h fetched once per scan, Redis-cached 5 min.
5. **Sector Intelligence** — CMC sector states tracked per category: STRONGEST, ACCELERATING, NEUTRAL, WEAKENING, OVERCROWDED (45-min baseline TTL for delta detection).
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
5. **Positioning Intelligence** — L/S crowd context (EXTREME_LONG/LONG_HEAVY/BALANCED/SHORT_HEAVY/EXTREME_SHORT). Contrarian scoring: extremes penalized, opposite side rewarded. Replaces old 2-case check.

**New files:**
- `backend/core/scanner/breakout_intelligence.py` — 20/30-day breakout detection
- `backend/core/scanner/oi_intelligence.py` — OI × price direction matrix
- `backend/core/scanner/positioning_intelligence.py` — L/S crowd positioning

**Calibration updates:**
- AI_MIN_SETUP_SCORE: 70 → 72
- Funding gate: abs > 0.002 → directional adverse > 0.007
- Price crash filter: -50% → -20%
- BB squeeze: 80% → 70% of avg width
- THREE_WHITE_SOLDIERS: added body overlap check
- MORNING/EVENING_STAR: body ratio 0.45 → 0.60
- Futures symbol cache: 30 min → 60 min
- Stablecoin prefix filter added (USD*, DAI*, BUSD*, USDE*)

**Current scanner config (tuned for production):**
- **Spot:** min_mcap=$200M, min_vol=$20M, confidence≥80, max_coins=80
- **Futures:** min_mcap=$1B, min_vol=$200M, confidence≥82, max_coins=50
- **High_confidence:** min_mcap=$2B, min_vol=$500M, confidence≥87, max_coins=30
- **Trending:** min_mcap=$50M, min_vol=$10M, confidence≥78, max_coins=80

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

backend/core/scanner/   ← PRIMARY scanner (Python) — all new features here
  models.py             ← Pydantic models; TechnicalIndicators has ema200, bb, candle_pattern, ema_cross
  indicators.py         ← RSI·MACD·EMA20/50/200·ATR·BB·volume·ADX·candlestick·EMA crossover
  market_structure.py   ← 7-filter market quality gate
  signal_pipeline.py    ← detect_setup() scores EMA200/BB/daily/patterns/crossover/rel-strength/breakout
  orchestrator.py       ← run_scan(); CMC 200 coins; 3 timeframes (1h+4h+1d); btc_change_24h; Redis intel cache reader
  market_fetcher.py     ← reads Redis intelligence cache (populated by TS layer); CMC fallback via TS
  ai_validator.py       ← checks AISettings.enabled + setup_score < 72 → heuristic; semaphore(3)
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
  breakout_intelligence.py← 20/30-day high/low detection; NONE/EARLY_BREAKOUT/CONFIRMED/HIGH_MOMENTUM
  oi_intelligence.py    ← OI × price direction matrix (NEW_LONGS, NEW_SHORTS, SHORT_COVERING, LONG_LIQUIDATION, NEUTRAL)
  positioning_intelligence.py← L/S crowd context (EXTREME_LONG/LONG_HEAVY/BALANCED/SHORT_HEAVY/EXTREME_SHORT); contrarian scoring

backend/workers/
  celery_app.py         ← Celery factory + worker_ready signal starts health server
  health_server.py      ← HTTP server on $PORT — Railway health check target
  scan_task.py          ← @shared_task run_scheduled_scan + check_signal_outcomes
  beat_schedule.py      ← standard/high_confidence/futures + outcome tracker schedules

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
  calibration/page.tsx  ← Claude AI on/off toggle + verdict distribution + confidence bands
  signals/page.tsx      ← card-based signal feed with filters/sort/expand; admin sees ALL signals
  scanner/page.tsx      ← Celery status + enable/disable auto-scan + manual scan trigger
  analytics/page.tsx    ← edge validation + attribution tabs
  settings/page.tsx     ← system settings; paper_trading group hidden (feature removed)

lib/
  access-control.ts     ← getAccessContext() checks Supabase session — admin email → enterprise plan

Dockerfile              ← python:3.12-slim + gcc + pip --prefer-binary (prevents 1hr numpy compile)
database/
  analytics-schema.sql  ← signal_outcomes with partial index for PENDING resolution query
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
