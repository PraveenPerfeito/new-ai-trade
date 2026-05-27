# Crypto Market Scanner

AI-powered cryptocurrency trading signal scanner with multi-timeframe analysis, futures intelligence, risk management, and an institutional-grade founder operations dashboard.

**Stack:** Next.js 14 · TypeScript · FastAPI (Python 3.12) · Supabase · Upstash Redis · Claude Haiku · Binance · CoinGecko · CoinMarketCap

---

## Features

### Signal Pipeline
- Scans top-100 coins by market cap every N minutes (configurable)
- 10-gate quality pipeline before any AI call: MTF confirmation → volatility → trend strength → market structure → setup score → R:R → volume → risk engine → futures intelligence → Claude Haiku
- Four scan modes: `spot` · `futures` · `high_confidence` · `trending`
- Signal lifecycle: `VALIDATED → AI_APPROVED → TELEGRAM_SENT → ACTIVE → TP_HIT / SL_HIT → CLOSED → ANALYZED`

### Admin Command Center (Phase 7)

| Page | Path | Description |
|------|------|-------------|
| Command Overview | `/admin/overview` | Scanner status bar, live regime card, signal metrics, global market strip, recent signals table |
| Market Intelligence | `/admin/market` | BTC-derived regime hero, global metrics, market breadth, trending assets |
| Scanner Control | `/admin/scanner` | Start / stop / pause / resume / emergency-stop · mode & interval selectors · rejection diagnostics · near-miss panel |
| Tactical Feed | `/admin/tactical` | Live signal lifecycle table — filter by stage, type, mode — 10 s refresh |
| Sector Rotation | `/admin/sectors` | CMC ecosystem categories + coin-derived breadth with momentum badges |
| Regime Intelligence | `/admin/regime` | RSI gauge, trading implication, recommended scanner params, regime reference table |
| Calibration | `/admin/calibration` | Claude API health, verdict distribution, effectiveness panel, confidence bands, pipeline threshold reference |
| Edge Analytics | `/admin/analytics` | Win rate, expectancy, profit factor, Sharpe — per symbol / mode / grade |
| Providers | `/admin/providers` | Data source health (Binance, CoinGecko, CoinMarketCap) |
| Cache Operations | `/admin/cache` | CMC quota guard, 5-group intelligence cache freshness, worker statuses |
| System Health | `/admin/system` | Process health, uptime, memory |
| Diagnostics | `/admin/anomalies` | Scanner anomaly log |
| Settings | `/admin/settings` | System settings with safety layer |

### Intelligence Cache (Phase 6.9)
- 5-group CMC-backed Redis cache: listings · global · trending · categories · metadata
- QuotaGuard: 300K monthly budget, 30 req/min, rolling-window enforcement, 5-level warnings
- Background workers auto-refresh each group on its own TTL (5 min – 6 hr)
- Scanner reads from cache-first; falls back to CoinGecko if CMC is cold

### Risk & Analytics
- Signal risk grade A–F, quality score 0–100, safe leverage tiers 1×–20×
- Edge report: win rate CI, profit factor, Sharpe, max drawdown
- Signal outcome attribution with confidence-band calibration
- Backtesting engine: historical candle replay, strategy comparison, equity curve

### Infrastructure
- Distributed auto-scheduler (in-memory singleton, HMR-safe) with pause/resume/emergency-stop
- Redis-backed rate limiting, caching, and distributed locks
- Celery workers + Beat for async scan tasks (Python backend)
- Structured logging: pino (Next.js) + structlog (Python)
- Edge middleware: Supabase session auth, email allowlist, security headers, CORS
- Telegram alerts on high-confidence signals

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14 (App Router) · TypeScript 5 · React 18 · Tailwind CSS |
| Backend | FastAPI + Uvicorn · Python 3.12 · asyncio · Pydantic v2 |
| Task queue | Celery 5 + Celery Beat |
| Cache / broker | Upstash Redis (ioredis · redis-py) |
| Database | Supabase PostgreSQL · asyncpg |
| Auth | Supabase Auth + `@supabase/ssr` |
| AI validation | Anthropic Claude Haiku 4.5 |
| Market data | Binance REST (spot + futures) · CoinGecko · CoinMarketCap Pro |
| Notifications | Telegram Bot API |
| Hosting | Vercel (Next.js) · Railway (FastAPI + Celery worker) |

---

## Quick Start (Local)

See [RUNNING_LOCAL.md](RUNNING_LOCAL.md) for the full local setup guide.

```bash
# 1. Install dependencies
npm install
py -3.12 -m venv .venv && source .venv/Scripts/activate
pip install -r backend/requirements.txt

# 2. Fill in .env (see RUNNING_LOCAL.md)
cp .env.example .env.local

# 3. Apply Supabase migrations (SQL Editor in Supabase dashboard)
#    database/schema.sql → backtest-schema.sql → analytics-schema.sql
#    → admin-auth-migration.sql → experiments-migration.sql

# 4. Start the stack (3 terminals)
npm run dev                                                    # Terminal 1: Next.js
uvicorn backend.main:app --reload --port 8000                 # Terminal 2: FastAPI
celery -A backend.workers.celery_app worker --concurrency=1  # Terminal 3: Celery
```

Admin dashboard: http://localhost:3000/admin

---

## Deployment

See [DEPLOYMENT.md](DEPLOYMENT.md) for the full Vercel + Render + Upstash + Supabase + Anthropic guide.

**Short version:**

| Step | Service | What you do |
|------|---------|-------------|
| 1 | Supabase | Create project → run 6 migration files → create admin user |
| 2 | Upstash | Create Redis database → copy `rediss://` URL |
| 3 | Anthropic | Create API key → set spend limit |
| 4 | CoinMarketCap | Get Startup Plan API key |
| 5 | Railway | Deploy FastAPI as Web Service + Celery as Background Worker (separate service, `-Q celery,scanner`) |
| 6 | Vercel | Import repo → set env vars → deploy |

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Supabase service role key (server-side only) |
| `DATABASE_URL` | ✅ (backend) | PostgreSQL DSN for Python asyncpg |
| `REDIS_URL` | ✅ | Upstash `rediss://` URL |
| `ADMIN_EMAILS` | ✅ | Comma-separated allowed admin emails |
| `ADMIN_SECRET` | ✅ | 32-byte hex — `openssl rand -hex 32` |
| `BACKEND_URL` | ✅ | Render FastAPI URL (used by Next.js proxy) |
| `ANTHROPIC_API_KEY` | ⚠ | Claude Haiku key — heuristic fallback if absent |
| `COINMARKETCAP_API_KEY` | ⚠ | CMC Startup Plan key for intelligence cache |
| `COINGECKO_API_KEY` | ✗ | Unlocks higher CoinGecko rate limits |
| `TELEGRAM_BOT_TOKEN` | ✗ | Bot token for signal alerts |
| `TELEGRAM_CHAT_ID` | ✗ | Channel ID for signal alerts |
| `SCANNER_MIN_CONFIDENCE_ALERT` | ✗ | Min confidence % to fire Telegram alert (default: 85) |

---

## API Routes

### Next.js routes (`/api/...`)

| Method | Path | Description |
|--------|------|-------------|
| `GET/POST` | `/api/scanner/control` | Scheduler status · start/stop/pause/resume/emergency-stop/reset |
| `POST` | `/api/scanner/run` | Manual one-shot scan |
| `GET` | `/api/signals` | Fetch recent signals |
| `GET` | `/api/signals/tactical` | Signal lifecycle feed with filters |
| `GET` | `/api/market/intelligence` | Regime + global metrics + breadth + trending |
| `GET` | `/api/market/sectors` | CMC categories + coin-derived sector breadth |
| `GET/POST` | `/api/cache/intelligence` | Cache telemetry + force-refresh all groups |
| `POST` | `/api/cache/intelligence/[group]` | Force-refresh a single cache group |
| `GET` | `/api/scheduler/status` | Scheduler status |
| `POST` | `/api/scheduler/start` | Start auto-scheduler |
| `POST` | `/api/scheduler/stop` | Stop auto-scheduler |
| `GET` | `/api/health` | Liveness probe |
| `POST` | `/api/backtest/run` | Run backtest |
| `GET` | `/api/backtest/results` | List backtest runs |

### FastAPI routes (Render, port 8000)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Liveness probe |
| `GET` | `/health/ready` | Readiness: Redis + Postgres |
| `GET` | `/api/analytics/ai` | Claude API summary |
| `GET` | `/api/analytics/edge/report` | Edge report (win rate, expectancy, Sharpe) |
| `GET` | `/api/burnin/readiness` | 5-component readiness score |
| `GET` | `/api/burnin/status` | Burn-in progress + live metrics |

---

## Database Tables

| Table | Purpose |
|-------|---------|
| `signals` | Trading signals with indicators, risk grade, futures data |
| `scan_runs` | Audit log of every scan |
| `coins` | Top-100 coin metadata |
| `signal_outcomes` | TP/SL/timeout outcome tracking |
| `backtest_runs` | Backtest job metadata |
| `backtest_trades` | Individual simulated trades |
| `performance_stats` | Aggregated analytics |
| `settings_groups` | System settings (9 groups) |
| `settings_experiments` | Staged experiment rollouts |
| `admin_auth_log` | Login/logout audit log |

---

## Development

```bash
npm run dev          # Next.js dev server (hot reload)
npm run build        # Production build — checks for bundle errors
npx tsc --noEmit     # Type check (must be zero errors before commit)
npm run lint         # ESLint

# Python
python -m pytest backend/core/scanner/tests/ -v
uvicorn backend.main:app --reload --port 8000
```

---

## License

Private — all rights reserved.
