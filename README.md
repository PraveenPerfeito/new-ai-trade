# Crypto Market Scanner

AI-powered cryptocurrency trading signal scanner with multi-timeframe analysis, futures intelligence, risk management, and backtesting — built on a **Next.js 14 frontend** and a **FastAPI/Python backend**.

---

## Features

**Signal Scanner**
- Scans the top 100 coins by market cap (CoinGecko + Binance)
- Multi-timeframe confirmation: 1h entry signals filtered by 4h trend
- 10-step quality pipeline before any AI call (MTF, volatility, RSI, MACD, volume, setup score, RR ratio, risk engine, futures intelligence, Claude validation)
- Four scan modes: `spot` · `futures` · `high_confidence` · `trending`
- Distributed auto-scheduler (Celery Beat + Redis lock) — safe for multi-instance deployments

**Risk Engine**
- Trade quality score (0–100) and risk grade (A–F) per signal
- Stop-loss distance, volatility, overextension, and liquidity validators
- Safe leverage tiers: 1×, 2×, 3×, 5×, 10×, 15×, 20×
- Position-size multiplier based on grade (A = 1.0×, F = rejected)

**Market Structure Filters** *(Python core engine)*
- Sideways market detection (ADX + range-band analysis)
- Fake volume / wash-trade signature detection
- Candle structure quality (doji, rejection wicks)
- Trend exhaustion (RSI divergence + extension)
- Support/resistance rejection from swing pivots
- Overextension guard (ATR multiplier)
- Failed breakout / stop-hunt detection

**Futures Intelligence** *(futures / high_confidence modes)*
- Live funding rate with bias detection (LONG_HEAVY / SHORT_HEAVY / NEUTRAL)
- Open-interest 24h trend (RISING / FALLING / STABLE)
- Long/short account ratio (global)
- Liquidation-zone detection from swing highs/lows + ATR levels
- Breakout detector: 20-candle consolidation + volume confirmation
- Trend continuation / pullback depth analysis
- Composite momentum score (0–100) with BTC/ETH/SOL priority bonus

**Paper Trading**
- Virtual position tracking from signal entry to exit
- Outcome resolution: TP hit, SL hit, timeout
- Tracks PnL, win rate, avg RR per signal type and mode

**Performance Analytics**
- Signal outcome aggregation with win/loss/breakeven breakdown
- Per-symbol, per-mode, per-grade analytics
- Rolling daily/weekly performance tables

**Backtesting Engine**
- Replays 1h historical candles with synthetic 4h aggregation
- Simulates signal generation using the same live scanner pipeline
- Metrics: win rate, profit factor, max drawdown, Sharpe ratio, avg RR, equity curve
- Strategy comparison with composite scoring
- Results persisted to Supabase

**Dashboard**
- TradingView-inspired dark terminal UI
- Live price ticker, top-mover widgets, stats bar
- Signal feed with confidence bar, risk grade, futures badges, liquidation zone proximity
- Paper trading panel: live positions, outcome history
- Performance analytics panel
- Backtest panel: run, compare strategies, view trade list, equity curve SVG chart

**Production Infrastructure**
- Redis-backed distributed cache, rate limiting, and scheduler lock
- Celery workers + Beat scheduler for async scan tasks
- Prometheus `/metrics` endpoint (FastAPI) + FastAPI health/readiness probe
- Structured JSON logging: pino (Next.js) + structlog (Python backend)
- Zod-validated environment variables (Next.js) + pydantic-settings (Python)
- Per-IP Redis rate limiting on all API routes
- Security headers (CSP, HSTS, X-Frame-Options, …)
- React error boundaries
- Retry with exponential backoff on all external API calls
- Docker multi-service deployment (web, api, worker, beat, redis)

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend framework | Next.js 14 (App Router, server components, Edge middleware) |
| Frontend language | TypeScript 5 (strict) |
| UI | React 18 · Tailwind CSS · Lucide icons |
| Backend framework | FastAPI + Uvicorn (Python 3.12) |
| Backend language | Python 3.12 (asyncio, pydantic v2) |
| Task queue | Celery 5 + Celery Beat |
| Cache / broker | Redis 7 (ioredis on Node, redis-py on Python) |
| Database | Supabase (PostgreSQL) · asyncpg |
| AI validation | Anthropic Claude Haiku 4.5 |
| Market data | Binance REST API (spot + futures) |
| Coin data | CoinGecko API (top 100 by market cap) |
| Notifications | Telegram Bot API |
| Indicators (Python) | pandas + numpy (TradingView-compatible Wilder EWM) |
| Logging | pino (Next.js) · structlog (Python) |
| Validation | Zod (Next.js) · pydantic-settings (Python) |
| Metrics | prometheus-client + prometheus-fastapi-instrumentator |
| Container | Docker (multi-stage) · Docker Compose v2 |

---

## Quick Start

### Prerequisites

- Node.js 20+ and npm 10+
- Python 3.12+ (for running backend locally without Docker)
- Docker 24+ and Docker Compose v2 (for full-stack deployment)
- A [Supabase](https://supabase.com) project with schemas applied (see [Database Setup](#database-setup))
- Binance and CoinGecko are public APIs — no key required for basic use
- An [Anthropic API key](https://console.anthropic.com) (optional — heuristic fallback used without it)

### 1 — Clone and install

```bash
git clone <repo-url> crypto-market-scanner
cd crypto-market-scanner
npm install
pip install -r backend/requirements.txt   # only needed for local Python backend
```

### 2 — Configure environment

```bash
cp .env.example .env.local
# Edit .env.local — see Environment Variables section
```

Minimum required:
```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

### 3 — Apply database schemas

Run all schema files in your Supabase SQL Editor (Dashboard → SQL Editor):

```
database/schema.sql
database/backtest-schema.sql
database/paper-trading-schema.sql
database/analytics-schema.sql
```

### 4 — Start (Docker — recommended)

```bash
docker compose up --build -d
# Opens: http://localhost:3000/dashboard
# API:   http://localhost:8000/health
```

### 5 — Or start in development mode

```bash
# Terminal 1: Redis (required)
docker run -d -p 6379:6379 redis:7-alpine

# Terminal 2: FastAPI backend
cd backend && uvicorn backend.main:app --reload --port 8000

# Terminal 3: Celery worker
cd backend && celery -A backend.workers.celery_app worker -l info -Q scanner,paper_trading

# Terminal 4: Next.js frontend
npm run dev
```

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | — | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | — | Supabase anon/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | — | Supabase service role key (server-side only) |
| `REDIS_URL` | ✅ | `redis://localhost:6379/0` | Redis connection URL (Next.js + Python) |
| `DATABASE_URL` | ✅ | — | PostgreSQL DSN for Python asyncpg |
| `ANTHROPIC_API_KEY` | ⚠ | — | Claude API key — heuristic fallback if absent |
| `TELEGRAM_BOT_TOKEN` | ✗ | — | Telegram bot token for signal alerts |
| `TELEGRAM_CHAT_ID` | ✗ | — | Telegram chat/channel ID |
| `COINGECKO_API_KEY` | ✗ | — | CoinGecko API key — free tier used without it |
| `SCANNER_MIN_CONFIDENCE_ALERT` | ✗ | `85` | Minimum confidence % to send a Telegram alert |
| `SCANNER_DELAY_MS` | ✗ | `300` | Delay between coins during scan (ms) |
| `LOG_LEVEL` | ✗ | `info` | `fatal`/`error`/`warn`/`info`/`debug`/`trace` |
| `ALLOWED_ORIGINS` | ✗ | *(all)* | Comma-separated CORS allow-list |

---

## Database Setup

Apply schemas in order via Supabase SQL Editor:

```sql
-- 1. Core tables (coins, scan_runs, signals)
\i database/schema.sql

-- 2. Backtest tables (backtest_runs, backtest_trades)
\i database/backtest-schema.sql

-- 3. Paper trading tables (paper_positions, paper_trades)
\i database/paper-trading-schema.sql

-- 4. Analytics tables (signal_outcomes, performance_stats)
\i database/analytics-schema.sql
```

Tables created:

| Table | Purpose |
|-------|---------|
| `coins` | Top-100 coin metadata, refreshed each scan |
| `scan_runs` | Audit log of every scan (mode, duration, signals found) |
| `signals` | Trading signals with indicators, risk grade, futures data |
| `backtest_runs` | Backtest job metadata and aggregate metrics |
| `backtest_trades` | Individual simulated trades per backtest run |
| `paper_positions` | Open and closed paper trading positions |
| `paper_trades` | Resolved paper trades with PnL |
| `signal_outcomes` | Tracked real-world outcomes for signals |
| `performance_stats` | Aggregated analytics by symbol/mode/grade |

---

## API Reference

### Next.js API Routes

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/scanner/run` | Trigger a manual scan (`{ mode }`) |
| `GET` | `/api/signals` | Fetch signals (`?limit=50&minConfidence=75`) |
| `GET` | `/api/coins/top100` | Fetch cached top-100 coin list |
| `POST` | `/api/paper-trading/enter` | Open a paper position |
| `POST` | `/api/paper-trading/exit` | Close a paper position |
| `GET` | `/api/paper-trading/positions` | List open/closed positions |
| `GET` | `/api/analytics/performance` | Aggregated signal analytics |
| `POST` | `/api/backtest/run` | Run a backtest (`{ mode, lookbackDays, … }`) |
| `GET` | `/api/backtest/results` | List recent backtest runs |
| `GET` | `/api/backtest/[id]` | Get single backtest run + trades |
| `GET` | `/api/backtest/compare` | Compare runs (`?ids=id1,id2,id3`) |
| `GET` | `/api/health` | Next.js liveness probe |

### FastAPI Routes (port 8000)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | FastAPI liveness probe |
| `GET` | `/health/ready` | Readiness: Redis ping + Postgres SELECT 1 |
| `GET` | `/api/scheduler/status` | Celery Beat scheduler state |
| `POST` | `/api/scheduler/start` | Enable scheduled scanning |
| `POST` | `/api/scheduler/stop` | Disable scheduled scanning |
| `GET` | `/metrics` | Prometheus metrics endpoint |

---

## Architecture

```
┌───────────────────────────────────────────────────────────────┐
│                           Browser                              │
│  MarketScanner · PaperTrading · Analytics · BacktestPanel     │
└───────────────────────┬───────────────────────────────────────┘
                        │ fetch / polling
┌───────────────────────▼───────────────────────────────────────┐
│                  Next.js 14  (port 3000)                       │
│  middleware.ts  ─  request ID · security headers · CORS       │
│                                                                │
│  API Routes                                                    │
│  /scanner/run  /signals  /coins/top100  /health               │
│  /paper-trading/*  /analytics/*  /backtest/*                  │
└──────┬────────────────┬──────────────────────────────────────-┘
       │                │ Redis-backed cache + rate limit
       │          ┌─────▼──────┐
┌──────▼──────┐   │  Redis 7   │
│  Supabase   │   │  (cache,   │
│  PostgreSQL │   │   broker,  │
│             │   │   locks)   │
│  signals    │   └─────┬──────┘
│  scan_runs  │         │
│  coins      │  ┌──────▼────────────────────────────────────┐
│  backtest_* │  │         FastAPI  (port 8000)               │
│  paper_*    │  │  /health  /health/ready  /metrics          │
│  analytics  │  │  /api/scheduler/*                          │
└─────────────┘  └──────┬────────────────────────────────────┘
                        │ Celery tasks
              ┌─────────▼──────────────────────────────────┐
              │          Celery Workers                      │
              │                                             │
              │  run_scheduled_scan(mode)                   │
              │    └─ Python Core Engine                    │
              │         backend/core/scanner/               │
              │           indicators.py  (RSI/MACD/EMA/ATR)│
              │           risk.py        (grade A–F)        │
              │           market_structure.py  (7 filters)  │
              │                                             │
              │  monitor_paper_positions()                  │
              └─────────────────────────────────────────────┘
                        │
              ┌─────────▼──────────────────────────────────┐
              │          Celery Beat                         │
              │  Standard scan  → every 15 min              │
              │  High-confidence → every 30 min (offset 5)  │
              │  Futures scan   → every 30 min (offset 10)  │
              │  Paper monitor  → every 1 min               │
              └─────────────────────────────────────────────┘
```

---

## Project Structure

```
crypto-market-scanner/
├── app/
│   ├── api/
│   │   ├── analytics/         # signal performance aggregation
│   │   ├── backtest/          # run · results · [id] · compare
│   │   ├── coins/top100/
│   │   ├── health/            # liveness probe
│   │   ├── paper-trading/     # enter · exit · positions
│   │   ├── scanner/run/
│   │   └── signals/
│   ├── dashboard/page.tsx
│   ├── layout.tsx
│   └── globals.css
├── backend/
│   ├── api/
│   │   ├── health.py          # /health + /health/ready (Redis + Postgres)
│   │   └── scheduler.py       # /api/scheduler/* (Celery Beat control)
│   ├── cache/
│   │   └── redis_cache.py     # async Redis TTL cache with in-memory fallback
│   ├── core/
│   │   └── scanner/
│   │       ├── models.py      # Pydantic models (Candle, TechnicalIndicators, …)
│   │       ├── indicators.py  # RSI · MACD · EMA · ATR · volume · MTF (pandas)
│   │       ├── risk.py        # risk scoring · grade A–F · leverage safety
│   │       ├── market_structure.py  # 7-filter market quality gate
│   │       └── tests/         # 98 pytest unit tests
│   ├── database/
│   │   └── session.py         # asyncpg pool (min=2, max=10)
│   ├── middleware/
│   │   ├── rate_limit.py      # slowapi Redis rate limiter
│   │   └── request_id.py      # structlog request ID binding
│   ├── scheduler/
│   │   └── coordinator.py     # Redis SET NX EX distributed scan lock
│   ├── workers/
│   │   ├── celery_app.py      # Celery factory
│   │   ├── beat_schedule.py   # scan + paper monitoring schedule
│   │   └── scan_task.py       # @shared_task scan entry points
│   ├── main.py                # FastAPI app factory + lifespan
│   ├── Dockerfile
│   ├── .env.example
│   └── requirements.txt
├── components/
│   └── dashboard/
│       ├── market-scanner.tsx        # root orchestrator
│       ├── signals-feed.tsx          # signal cards
│       ├── paper-trading.tsx         # paper position tracker
│       ├── performance-analytics.tsx # analytics panel
│       ├── backtest-panel.tsx        # backtest UI
│       └── equity-chart.tsx          # SVG equity curve
├── lib/
│   ├── ai-validator.ts        # Claude Haiku signal validation
│   ├── analytics-db.ts        # analytics DB operations
│   ├── backtest.ts            # backtesting engine
│   ├── binance.ts             # Binance REST client (spot + futures)
│   ├── cache.ts               # Redis-backed TTL cache
│   ├── coingecko.ts           # CoinGecko REST client
│   ├── env.ts                 # Zod environment validation
│   ├── futures-intelligence.ts
│   ├── indicators.ts          # TypeScript indicator suite (Next.js side)
│   ├── logger.ts              # pino structured logger
│   ├── market-structure.ts    # market structure filters (TypeScript)
│   ├── outcome-tracker.ts     # signal outcome resolution
│   ├── paper-trading-db.ts    # paper trading DB operations
│   ├── paper-trading-engine.ts
│   ├── redis.ts               # ioredis singleton (HMR-safe)
│   ├── retry.ts               # exponential backoff + jitter
│   ├── risk.ts                # risk engine (TypeScript)
│   ├── scanner.ts             # full scan pipeline
│   ├── signal-analytics.ts    # analytics aggregation
│   ├── supabase.ts            # database operations
│   ├── telegram.ts            # alert formatting + delivery
│   └── validate.ts            # Zod request validation helpers
├── types/index.ts             # all shared TypeScript types
├── database/
│   ├── schema.sql
│   ├── backtest-schema.sql
│   ├── paper-trading-schema.sql
│   └── analytics-schema.sql
├── docs/
│   ├── PRD.md
│   └── DEPLOYMENT.md
├── middleware.ts              # Edge: request ID · security headers · CORS
├── pytest.ini                 # Python test runner config
├── next.config.mjs
├── Dockerfile                 # Next.js multi-stage build
├── docker-compose.yml         # web · api · worker · beat · redis
└── .env.example
```

---

## Docker Deployment

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for the complete guide.

Quick reference:

```bash
# Build and start all services
docker compose up --build -d

# Health checks
curl http://localhost:3000/api/health        # Next.js
curl http://localhost:8000/health/ready      # FastAPI + Redis + Postgres

# View logs
docker compose logs -f web     # Next.js
docker compose logs -f api     # FastAPI
docker compose logs -f worker  # Celery

# Stop everything
docker compose down
```

Services started:

| Service | Port | Description |
|---------|------|-------------|
| `web` | 3000 | Next.js frontend + API routes |
| `api` | 8000 | FastAPI backend (health, scheduler, metrics) |
| `worker` | — | Celery scanner + paper trading worker |
| `beat` | — | Celery Beat scheduler |
| `redis` | 6379 | Redis 7 (cache, broker, distributed locks) |

---

## Development

```bash
# Next.js
npm run dev          # dev server with hot reload
npm run build        # production build
npx tsc --noEmit     # type check
npm run lint         # ESLint

# Python backend
python -m pytest backend/core/scanner/tests/ -v   # run 98 unit tests
uvicorn backend.main:app --reload --port 8000      # FastAPI dev server
celery -A backend.workers.celery_app worker -l info -Q scanner,paper_trading
```

---

## Scan Modes

| Mode | Min Market Cap | Min Volume 24h | Min Confidence | Notes |
|------|---------------|----------------|----------------|-------|
| `spot` | $500M | $50M | 80% | Default — broad scan |
| `futures` | $1B | $200M | 82% | Adds funding + OI + liq zones |
| `high_confidence` | $2B | $500M | 87% | Tightest filters, best signals |
| `trending` | $100M | $20M | 78% | Catches momentum plays |

---

## License

Private — all rights reserved.
