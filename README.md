# Crypto Market Scanner

AI-powered cryptocurrency trading signal scanner with multi-timeframe analysis, futures intelligence, risk management, and backtesting — built on Next.js 14.

---

## Features

**Signal Scanner**
- Scans the top 100 coins by market cap (CoinGecko + Binance)
- Multi-timeframe confirmation: 1h entry signals filtered by 4h trend
- 10-step quality pipeline before any AI call (MTF, volatility, RSI, MACD, volume, setup score, RR ratio, risk engine, futures intelligence, Claude validation)
- Four scan modes: `spot` · `futures` · `high_confidence` · `trending`
- Auto-scheduler with configurable interval and exponential-backoff retry

**Risk Engine**
- Trade quality score (0–100) and risk grade (A–F) per signal
- Stop-loss distance, volatility, overextension, and liquidity validators
- Safe leverage tiers: 1×, 2×, 3×, 5×, 10×, 15×, 20×
- Position-size multiplier based on grade (A = 1.0×, F = rejected)

**Futures Intelligence** *(futures / high_confidence modes)*
- Live funding rate with bias detection (LONG_HEAVY / SHORT_HEAVY / NEUTRAL)
- Open-interest 24h trend (RISING / FALLING / STABLE)
- Long/short account ratio (global)
- Liquidation-zone detection from swing highs/lows + ATR levels
- Breakout detector: 20-candle consolidation + volume confirmation
- Trend continuation / pullback depth analysis
- Composite momentum score (0–100) with BTC/ETH/SOL priority bonus

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
- Backtest panel: run, compare strategies, view trade list, equity curve SVG chart

**Production Infrastructure**
- Structured JSON logging (pino) with request IDs
- Zod-validated environment variables and API request bodies
- Per-IP rate limiting in Edge middleware
- Security headers (CSP, HSTS, X-Frame-Options, …)
- `GET /api/health` liveness + readiness probe
- React error boundaries
- Retry with exponential backoff on all external API calls
- Docker multi-stage build with standalone Next.js output

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 14 (App Router, server components, Edge middleware) |
| Language | TypeScript 5 (strict) |
| UI | React 18 · Tailwind CSS · Lucide icons |
| Database | Supabase (PostgreSQL) |
| AI validation | Anthropic Claude Haiku 4.5 |
| Market data | Binance REST API (spot + futures) |
| Coin data | CoinGecko API (top 100 by market cap) |
| Notifications | Telegram Bot API |
| Logging | pino + pino-pretty |
| Validation | Zod |
| Container | Docker (multi-stage) |

---

## Quick Start

### Prerequisites

- Node.js 20+
- A [Supabase](https://supabase.com) project with the schema applied (see [Database Setup](#database-setup))
- Binance and CoinGecko are public APIs — no key required for basic use
- An [Anthropic API key](https://console.anthropic.com) (optional — heuristic fallback used without it)

### 1 — Clone and install

```bash
git clone <repo-url> crypto-market-scanner
cd crypto-market-scanner
npm install
```

### 2 — Configure environment

```bash
cp .env.example .env.local
# Edit .env.local with your Supabase credentials and optional API keys
```

Minimum required:
```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

### 3 — Apply database schema

Run both schema files in your Supabase SQL editor (Dashboard → SQL Editor):

```
database/schema.sql
database/backtest-schema.sql
```

### 4 — Start development server

```bash
npm run dev
# Open http://localhost:3000/dashboard
```

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | — | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | — | Supabase anon/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | — | Supabase service role key (server-side only) |
| `ANTHROPIC_API_KEY` | ⚠ | — | Claude API key — heuristic fallback if absent |
| `TELEGRAM_BOT_TOKEN` | ✗ | — | Telegram bot token for signal alerts |
| `TELEGRAM_CHAT_ID` | ✗ | — | Telegram chat/channel ID |
| `COINGECKO_API_KEY` | ✗ | — | CoinGecko API key — free tier used without it |
| `SCANNER_MIN_CONFIDENCE_ALERT` | ✗ | `85` | Minimum confidence % to send a Telegram alert |
| `SCANNER_DELAY_MS` | ✗ | `300` | Delay between coins during scan (ms) |
| `LOG_LEVEL` | ✗ | `info` | `fatal`/`error`/`warn`/`info`/`debug`/`trace` |
| `RATE_LIMIT_MAX` | ✗ | `100` | Max API requests per IP per window |
| `RATE_LIMIT_WINDOW_MS` | ✗ | `60000` | Rate-limit window duration (ms) |
| `ALLOWED_ORIGINS` | ✗ | *(all)* | Comma-separated CORS allow-list |

---

## Database Setup

Apply schemas in order via Supabase SQL Editor:

```sql
-- 1. Core tables (coins, scan_runs, signals)
\i database/schema.sql

-- 2. Backtest tables (backtest_runs, backtest_trades)
\i database/backtest-schema.sql
```

Tables created:

| Table | Purpose |
|-------|---------|
| `coins` | Top-100 coin metadata, refreshed each scan |
| `scan_runs` | Audit log of every scan (mode, duration, signals found) |
| `signals` | Trading signals with indicators, risk grade, futures data |
| `backtest_runs` | Backtest job metadata and aggregate metrics |
| `backtest_trades` | Individual simulated trades per backtest run |

---

## API Reference

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/scanner/run` | Trigger a manual scan (`{ mode }`) |
| `GET` | `/api/signals` | Fetch signals (`?limit=50&minConfidence=75`) |
| `GET` | `/api/coins/top100` | Fetch cached top-100 coin list |
| `GET` | `/api/scheduler/status` | Scheduler state and last scan info |
| `POST` | `/api/scheduler/start` | Start auto-scheduler (`{ mode, intervalMinutes }`) |
| `POST` | `/api/scheduler/stop` | Stop auto-scheduler |
| `POST` | `/api/backtest/run` | Run a backtest (`{ mode, lookbackDays, … }`) |
| `GET` | `/api/backtest/results` | List recent backtest runs |
| `GET` | `/api/backtest/[id]` | Get single backtest run + trades |
| `GET` | `/api/backtest/compare` | Compare runs (`?ids=id1,id2,id3`) |
| `GET` | `/api/health` | Liveness + readiness probe |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         Browser                              │
│  MarketScanner (dashboard) ─── BacktestPanel                │
└──────────────────────┬──────────────────────────────────────┘
                       │ fetch / polling
┌──────────────────────▼──────────────────────────────────────┐
│                  Next.js 14 (App Router)                     │
│  middleware.ts  ─  request ID · rate limit · security hdrs  │
│                                                              │
│  API Routes                                                  │
│  /scanner/run  /signals  /coins/top100  /health             │
│  /scheduler/*  /backtest/*                                   │
└──────┬───────────────┬───────────────────────────────────────┘
       │               │
┌──────▼──────┐ ┌──────▼──────────────────────────────────────┐
│  Supabase   │ │            Scanner Pipeline                   │
│  PostgreSQL │ │                                               │
│             │ │  CoinGecko → filter → prioritise             │
│  signals    │ │    └─ per coin (parallel, rate-limited):     │
│  scan_runs  │ │         Binance 1h + 4h klines               │
│  coins      │ │         → indicators (RSI/MACD/EMA/ATR)      │
│  backtest_* │ │         → MTF confirmation                    │
└─────────────┘ │         → volatility gate                    │
                │         → setup scoring                      │
                │         → risk engine (grade A–F)            │
                │         → futures intelligence (futures mode)│
                │         → Claude Haiku validation            │
                │         → save + Telegram alert              │
                └─────────────────────────────────────────────┘
```

---

## Project Structure

```
crypto-market-scanner/
├── app/
│   ├── api/
│   │   ├── backtest/          # run · results · [id] · compare
│   │   ├── coins/top100/
│   │   ├── health/            # liveness + readiness probe
│   │   ├── scanner/run/
│   │   ├── scheduler/         # status · start · stop
│   │   └── signals/
│   ├── dashboard/page.tsx
│   ├── layout.tsx             # root layout with ErrorBoundary
│   └── globals.css
├── components/
│   ├── error-boundary.tsx     # React error boundary
│   └── dashboard/
│       ├── market-scanner.tsx # main orchestrator component
│       ├── signals-feed.tsx   # live signal cards
│       ├── backtest-panel.tsx # backtest UI
│       ├── equity-chart.tsx   # SVG equity curve
│       ├── top-coins-table.tsx
│       ├── top-movers.tsx
│       ├── market-widgets.tsx
│       ├── scanner-controls.tsx
│       └── stats-bar.tsx
├── lib/
│   ├── ai-validator.ts        # Claude Haiku signal validation
│   ├── backtest.ts            # backtesting engine
│   ├── binance.ts             # Binance REST client (spot + futures)
│   ├── cache.ts               # TTL cache with LRU eviction
│   ├── coingecko.ts           # CoinGecko REST client
│   ├── env.ts                 # Zod environment validation
│   ├── futures-intelligence.ts # funding · OI · liq zones · breakout
│   ├── indicators.ts          # RSI · MACD · EMA · ATR · volume
│   ├── logger.ts              # pino structured logger
│   ├── retry.ts               # exponential backoff + jitter
│   ├── risk.ts                # risk engine (grade A–F)
│   ├── scanner.ts             # full scan pipeline
│   ├── scheduler.ts           # auto-scan scheduler
│   ├── supabase.ts            # database operations
│   ├── telegram.ts            # alert formatting + delivery
│   ├── utils.ts               # formatting helpers
│   └── validate.ts            # Zod request validation helpers
├── types/index.ts             # all shared TypeScript types
├── database/
│   ├── schema.sql
│   └── backtest-schema.sql
├── docs/
│   ├── PRD.md
│   └── DEPLOYMENT.md
├── middleware.ts              # Edge: rate limit · CORS · security headers
├── next.config.mjs
├── Dockerfile
├── docker-compose.yml
└── .env.example
```

---

## Docker Deployment

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for the complete deployment guide.

Quick reference:

```bash
# Build and run
docker compose up --build -d

# Health check
curl http://localhost:3000/api/health

# View logs
docker compose logs -f web

# Stop
docker compose down
```

---

## Development

```bash
npm run dev      # start dev server with hot reload
npm run build    # production build
npm run start    # start production server locally
npm run lint     # ESLint
npx tsc --noEmit # type check without emitting files
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
