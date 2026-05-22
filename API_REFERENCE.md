# API Reference & Local URLs

Complete reference for all endpoints, local URLs, and usage instructions.

---

## Local Development URLs

| Service | URL | Purpose |
|---------|-----|---------|
| **Public landing page** | http://localhost:3000 | SignalEdge AI homepage |
| **Pricing page** | http://localhost:3000/pricing | Free / Pro / Institutional tiers |
| **Investors page** | http://localhost:3000/investors | Investor overview |
| **About page** | http://localhost:3000/about | Mission and pipeline |
| **Login page** | http://localhost:3000/login | Sign in with Supabase account |
| **Admin dashboard** | http://localhost:3000/admin | Admin overview |
| **Admin scanner** | http://localhost:3000/admin/scanner | Scanner control panel |
| **FastAPI backend** | http://localhost:8000 | Python API server |
| **FastAPI health** | http://localhost:8000/health | Liveness probe |
| **Swagger UI (docs)** | http://localhost:8000/docs | Interactive API explorer |
| **Redoc docs** | http://localhost:8000/redoc | Readable API reference |

> Celery worker has no URL — it is a background task processor. Verify it is connected by checking the terminal for `celery@PRAVEEN ready`.

---

## Starting All Services

Open **three separate terminals** from the project root:

```bash
# Terminal 1 — Next.js frontend
npm run dev

# Terminal 2 — FastAPI backend
.venv\Scripts\activate
uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload

# Terminal 3 — Celery worker
.venv\Scripts\activate
celery -A backend.workers.celery_app worker --loglevel=info --concurrency=1
```

Quick verification:
```bash
curl http://localhost:8000/health
curl http://localhost:3000/api/health
```

---

## Next.js API Routes (`/api/*`)

All Next.js routes are proxied from the browser. Protected routes require a valid Supabase session cookie.

### Health

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/health` | Public | System liveness — Supabase, Anthropic, Telegram, CoinGecko |
| GET | `/api/health/providers` | Public | Live latency check for all external data providers |

```bash
curl http://localhost:3000/api/health
curl http://localhost:3000/api/health/providers
```

**`GET /api/health/providers` response:**
```json
{
  "success": true,
  "healthy": true,
  "providers": [
    { "name": "Binance",   "healthy": true,  "latencyMs": 42 },
    { "name": "CoinGecko", "healthy": true,  "latencyMs": 210 },
    { "name": "Redis",     "healthy": true,  "latencyMs": 5 },
    { "name": "Supabase",  "healthy": false, "latencyMs": 0, "error": "Not configured" }
  ],
  "checkedAt": "2026-05-20T12:00:00.000Z"
}
```

---

### Authentication

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/signout` | Session | Sign out current user, clears session cookies |

---

### Scanner

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/scanner/run` | Session | Trigger a manual scan |

```bash
# Full top-100 spot scan
curl -X POST http://localhost:3000/api/scanner/run \
  -H "Content-Type: application/json" \
  -d '{"mode":"spot"}'

# Deep-scan specific coins only
curl -X POST http://localhost:3000/api/scanner/run \
  -H "Content-Type: application/json" \
  -d '{"mode":"spot","coins":["BTC","ETH","SOL"]}'
```

**Body:**
```json
{
  "mode":  "spot",                  // spot | futures | high_confidence | trending
  "coins": ["BTC","ETH","SOL"]      // optional — restrict to these symbols (max 100)
}
```

When `coins` is provided the scanner filters to those symbols after the priority gates; if none match, it falls back to the full list.

### Cache

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/cache/clear` | Session | Flush all in-process + Redis caches |

```bash
curl -X POST http://localhost:3000/api/cache/clear
```

**Response:**
```json
{
  "success": true,
  "cleared": ["coins","signals","open-interest","funding-rate","long-short"],
  "clearedAt": "2026-05-20T12:00:00.000Z"
}
```

---

### Scheduler

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/scheduler/status` | Session | Get current scheduler state |
| POST | `/api/scheduler/start` | Session | Start auto-scan scheduler |
| POST | `/api/scheduler/stop` | Session | Stop auto-scan scheduler |

```bash
# Start scheduler every 15 minutes
curl -X POST http://localhost:3000/api/scheduler/start \
  -H "Content-Type: application/json" \
  -d '{"intervalMinutes": 15, "mode": "spot"}'

# Stop scheduler
curl -X POST http://localhost:3000/api/scheduler/stop
```

---

### Signals

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/signals` | Session | Fetch recent trade signals |

```bash
curl "http://localhost:3000/api/signals?limit=20&minConfidence=85"
```

**Query params:** `limit` (default 20), `minConfidence` (0–100)

**Phase 6.1 signal response fields** (added to every signal object):

| Field | Type | Description |
|-------|------|-------------|
| `signalState` | `DEVELOPING\|CONFIRMED\|EXTENDED\|COOLING\|CORRECTING\|INVALIDATED\|EXPIRED` | Lifecycle state from indicator snapshot |
| `institutionalScore` | `number` (0–100) | Multi-dimensional quality composite (AI 25% + grade 20% + trend 20% + quality 15% + vol 10% + RR 5% + futures 5%) ± regime flat |
| `regimeAlignmentScore` | `number` | Flat ± adjustment for regime fit (e.g. BUY in BULL_TREND = +15, BUY in BEAR_TREND = −25) |
| `marketRegime` | `BULL_TREND\|BEAR_TREND\|SIDEWAYS\|HIGH_VOLATILITY\|EUPHORIA\|CAPITULATION` | BTC 4h regime at scan time |
| `continuation` | `ContinuationAnalysis` | `{ continuationProbability, exhaustionRisk, momentumHealth, reasons }` |
| `explainability.continuationCase` | `string` | AI's best-case continuation scenario |
| `explainability.cautionCase` | `string` | AI's primary risk / failure mode |
| `explainability.regimeNote` | `string` | AI's comment on how the current regime affects this setup |

---

### Coins

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/coins/top100` | Session | Top 100 coins by market cap (cached) |

---

### Backtest

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/backtest/run` | Session | Run a new backtest |
| GET | `/api/backtest/results` | Session | List recent backtest runs |
| GET | `/api/backtest/[id]` | Session | Get specific backtest with trades |
| GET | `/api/backtest/compare` | Session | Compare multiple runs |

```bash
# Run backtest
curl -X POST http://localhost:3000/api/backtest/run \
  -H "Content-Type: application/json" \
  -d '{"strategyName":"default","mode":"spot","lookbackDays":30,"maxHoldCandles":24,"minRRRatio":2,"maxCoins":20}'

# Compare runs
curl "http://localhost:3000/api/backtest/compare?ids=id1,id2,id3"
```

---

### Paper Trading

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/paper-trading/portfolio` | Session | Portfolio snapshot — equity, PnL, win rate, open positions |
| POST | `/api/paper-trading/portfolio/reset` | Session | Reset portfolio to initial state |
| POST | `/api/paper-trading/enter` | Session | Enter a paper trade |
| POST | `/api/paper-trading/check` | Session | Check open positions against current prices |
| POST | `/api/paper-trading/trades/[id]/close` | Session | Manually close a trade |

```bash
# Enter a trade
curl -X POST http://localhost:3000/api/paper-trading/enter \
  -H "Content-Type: application/json" \
  -d '{"signal": {...}, "leverage": 5, "riskPct": 1}'
```

---

### Analytics

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/analytics/performance` | Session | Full analytics data |
| GET | `/api/analytics/breakdown` | Session | Breakdown by dimension |
| GET | `/api/analytics/patterns` | Session | Best/worst setups and AI accuracy |
| POST | `/api/analytics/tracker/run` | Session | Run outcome tracker |

```bash
# Breakdown by symbol
curl "http://localhost:3000/api/analytics/breakdown?by=symbol"
# by= symbol | timeframe | scannerMode | volatilityRegime

# Top N patterns
curl "http://localhost:3000/api/analytics/patterns?n=10"
```

---

### API Keys

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/keys` | Session | List your active API keys |
| POST | `/api/keys` | Session | Create a new API key |
| DELETE | `/api/keys/[id]` | Session | Revoke an API key |

```bash
# Create a key
curl -X POST http://localhost:3000/api/keys \
  -H "Content-Type: application/json" \
  -d '{"name":"my-key"}'
```

---

### Usage & Quotas

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/usage` | Session | Quota status and usage metrics |

---

### Admin Proxy

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `*` | `/api/admin/[...path]` | Session + Admin email | Proxy to FastAPI — adds `X-Admin-Secret` header automatically |

All `/api/admin/*` calls are forwarded to `http://localhost:8000/*` with the admin secret injected. Use these from the frontend only.

---

## FastAPI Endpoints (`localhost:8000`)

Access the Swagger UI at **http://localhost:8000/docs** to try these interactively.

All routes except `/health` and `/health/ready` require `X-Admin-Secret` header when called directly.

```bash
# Set once for curl testing
ADMIN_SECRET="9d6c21dc1fedf752d4c0b30b6b3cc7dbbf69a4d1e06535db5d31669f3f6a0f5c"
```

---

### Health

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Liveness probe — always 200 if process alive |
| GET | `/health/ready` | Readiness probe — checks Redis + database |

```bash
curl http://localhost:8000/health
curl http://localhost:8000/health/ready
```

---

### Scanner

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/scanner/trigger` | Trigger on-demand scan |
| GET | `/api/scanner/status` | Latest scan progress across all modes |
| GET | `/api/scanner/progress/{scan_id}` | Progress for a specific scan |
| GET | `/api/scanner/metrics/summary` | Active tasks + latest stats snapshot |

```bash
# Trigger scan
curl -X POST http://localhost:8000/api/scanner/trigger \
  -H "X-Admin-Secret: $ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"mode": "spot"}'

# Check status
curl http://localhost:8000/api/scanner/status \
  -H "X-Admin-Secret: $ADMIN_SECRET"
```

---

### Scheduler

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/scheduler/status` | Scheduler enabled/disabled state |
| POST | `/api/scheduler/start` | Enable Celery Beat scheduler |
| POST | `/api/scheduler/stop` | Disable Celery Beat scheduler |

---

### Settings

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/settings` | All 9 settings groups |
| GET | `/api/settings/audit` | Recent change log |
| GET | `/api/settings/{group}` | Single group |
| GET | `/api/settings/{group}/version` | ETag / version counter only |
| PATCH | `/api/settings/{group}` | Update specific fields (merge) |
| PUT | `/api/settings/{group}` | Replace entire group |
| POST | `/api/settings/{group}/reset` | Reset group to defaults |
| POST | `/api/settings/reset/all` | Reset all groups to defaults |

**Available groups:** `scanner` · `ai` · `risk` · `providers` · `failover` · `market_cache` · `quota` · `telegram` · `paper_trading`

```bash
# Read scanner settings
curl http://localhost:8000/api/settings/scanner \
  -H "X-Admin-Secret: $ADMIN_SECRET"

# Update a field
curl -X PATCH http://localhost:8000/api/settings/scanner \
  -H "X-Admin-Secret: $ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"fields": {"min_confidence": 90}, "updated_by": "praveen"}'

# Audit log
curl "http://localhost:8000/api/settings/audit?limit=20" \
  -H "X-Admin-Secret: $ADMIN_SECRET"
```

---

### Experiments

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/experiments` | List experiments |
| POST | `/api/experiments` | Create experiment |
| GET | `/api/experiments/{id}` | Get experiment |
| PATCH | `/api/experiments/{id}` | Update experiment |
| DELETE | `/api/experiments/{id}` | Delete draft/concluded experiment |
| POST | `/api/experiments/{id}/activate` | Set active |
| POST | `/api/experiments/{id}/pause` | Set paused |
| POST | `/api/experiments/{id}/conclude` | Set concluded |
| GET | `/api/experiments/{id}/preview` | Preview overrides vs current settings |

```bash
# List active experiments
curl "http://localhost:8000/api/experiments?status=active" \
  -H "X-Admin-Secret: $ADMIN_SECRET"

# Create experiment
curl -X POST http://localhost:8000/api/experiments \
  -H "X-Admin-Secret: $ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "higher-confidence-test",
    "group_name": "scanner",
    "overrides": {"min_confidence": 92},
    "rollout_pct": 10,
    "dry_run": true,
    "created_by": "praveen"
  }'
```

---

### Providers

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/providers` | All providers with health metrics |
| GET | `/api/providers/failover-history` | Recent failover events |
| GET | `/api/providers/config` | Current configuration |
| POST | `/api/providers/{name}/enable` | Enable provider |
| POST | `/api/providers/{name}/disable` | Disable provider |
| POST | `/api/providers/{name}/priority` | Set priority (1–6) |
| POST | `/api/providers/{name}/reset-metrics` | Clear Redis metrics |
| POST | `/api/providers/force-failover` | Force failover from a provider |
| POST | `/api/providers/clear-cache` | Clear market-data Redis cache |

**Provider names:** `coingecko` · `binance` · `coinmarketcap` · `dexscreener` · `geckoterm`

```bash
# List providers and health
curl http://localhost:8000/api/providers \
  -H "X-Admin-Secret: $ADMIN_SECRET"

# Disable a provider
curl -X POST http://localhost:8000/api/providers/dexscreener/disable \
  -H "X-Admin-Secret: $ADMIN_SECRET"

# Clear cache
curl -X POST http://localhost:8000/api/providers/clear-cache \
  -H "X-Admin-Secret: $ADMIN_SECRET"
```

---

### Analytics

| Method | Path | Query | Description |
|--------|------|-------|-------------|
| GET | `/api/analytics/summary` | `window_hours=168` | All analytics in one call |
| GET | `/api/analytics/performance` | `window_hours=168` | Signal performance by mode, grade, volatility |
| GET | `/api/analytics/ai` | `window_hours=24` | Claude approval rates, latency, fallback % |
| GET | `/api/analytics/scans` | `window_hours=24` | Scan throughput and duration trends |
| GET | `/api/analytics/paper-trading/portfolio` | — | Virtual portfolio equity and PnL |
| GET | `/api/analytics/paper-trading/trades` | `limit=50&status=all` | Recent paper trades |
| GET | `/api/analytics/signal-validation` | `window_hours=168` | Combined signal validation report |
| GET | `/api/analytics/signal-validation/confidence` | `window_hours=168` | TP_HIT by confidence band |
| GET | `/api/analytics/signal-validation/setup-score` | `window_hours=168` | TP_HIT by setup quality score |
| GET | `/api/analytics/signal-validation/ai-vs-heuristic` | `window_hours=168` | Claude vs heuristic fallback comparison |
| GET | `/api/analytics/edge/report` | `window_hours=720` | Full edge validation report |
| GET | `/api/analytics/edge/calibration` | `window_hours=720` | Confidence calibration analysis |
| GET | `/api/analytics/edge/claude` | `window_hours=720` | Claude AI effectiveness |
| GET | `/api/analytics/edge/setup-score` | `window_hours=720` | Setup score analysis by band |
| GET | `/api/analytics/edge/regime` | `window_hours=720` | Market regime analysis |
| GET | `/api/analytics/edge/modes` | `window_hours=720` | Scanner mode comparison |
| GET | `/api/analytics/edge/coins` | `window_hours=720&top_n=20` | Per-coin performance |
| GET | `/api/analytics/stream` | `timeout=300` | SSE stream of realtime metrics |

```bash
# 7-day summary
curl "http://localhost:8000/api/analytics/summary?window_hours=168" \
  -H "X-Admin-Secret: $ADMIN_SECRET"

# Realtime SSE stream (keep connection open)
curl -N "http://localhost:8000/api/analytics/stream?timeout=60" \
  -H "X-Admin-Secret: $ADMIN_SECRET"
```

---

### Burn-in Monitoring

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/burnin/status` | Current burn-in progress and anomaly summary |
| GET | `/api/burnin/snapshots` | Historical snapshots |
| GET | `/api/burnin/anomalies` | Recent anomaly records |
| GET | `/api/burnin/readiness` | Production readiness score (0–100) |

```bash
# Check production readiness
curl http://localhost:8000/api/burnin/readiness \
  -H "X-Admin-Secret: $ADMIN_SECRET"
```

---

## Celery Tasks (Background Workers)

These run automatically via Celery Beat. No manual invocation needed in normal use.

| Task | Schedule | Queue | Description |
|------|----------|-------|-------------|
| `run_scheduled_scan` (spot) | Every 15 min | scanner | Standard spot signal scan |
| `run_scheduled_scan` (high_confidence) | Every 30 min (at :05, :35) | scanner | High-confidence scan |
| `run_scheduled_scan` (futures) | Every 30 min (at :10, :40) | scanner | Futures-mode scan |
| `monitor_paper_positions` | Every 1 min | paper_trading | Check open paper trade positions |
| `check_signal_outcomes` | Every 10 min | paper_trading | Resolve pending signal outcomes |
| `daily_analytics_snapshot` | Daily at 23:59 UTC | celery | Edge report + 7-day signal summary |
| `hourly_anomaly_check` | Every hour (:00) | celery | Anomaly detection run |
| `refresh_daily_view` | Daily at 00:05 UTC | celery | Refresh materialized view |

**Monitor tasks from terminal:**
```bash
# Watch Celery task events in realtime
celery -A backend.workers.celery_app events --dump

# Inspect active tasks
celery -A backend.workers.celery_app inspect active
```

---

## Common curl Patterns

```bash
# Set the admin secret once (from .env)
ADMIN_SECRET="9d6c21dc1fedf752d4c0b30b6b3cc7dbbf69a4d1e06535db5d31669f3f6a0f5c"

# Full health check
curl http://localhost:8000/health
curl http://localhost:8000/health/ready

# Trigger a manual scan
curl -X POST http://localhost:8000/api/scanner/trigger \
  -H "X-Admin-Secret: $ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"mode":"spot"}'

# Read all settings
curl http://localhost:8000/api/settings \
  -H "X-Admin-Secret: $ADMIN_SECRET" | python -m json.tool

# Get 7-day analytics
curl "http://localhost:8000/api/analytics/summary?window_hours=168" \
  -H "X-Admin-Secret: $ADMIN_SECRET" | python -m json.tool

# Check provider health
curl http://localhost:8000/api/providers \
  -H "X-Admin-Secret: $ADMIN_SECRET" | python -m json.tool

# Check production readiness
curl http://localhost:8000/api/burnin/readiness \
  -H "X-Admin-Secret: $ADMIN_SECRET" | python -m json.tool
```

---

## Environment Variable Quick Reference

| Variable | Where set | Required | Description |
|----------|-----------|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | `.env` | Yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `.env` | Yes | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | `.env` | Yes | Supabase service role (server only) |
| `DATABASE_URL` | `.env` | Yes | Direct Postgres URL for asyncpg |
| `REDIS_URL` | `.env` | Yes | Redis/Upstash URL (supports rediss://) |
| `ANTHROPIC_API_KEY` | `.env` | Recommended | Claude Haiku for AI validation |
| `ADMIN_EMAILS` | `.env` | Yes | Comma-separated admin email(s) |
| `ADMIN_SECRET` | `.env` | Yes (prod) | Shared secret for Next.js → FastAPI |
| `TELEGRAM_BOT_TOKEN` | `.env` | Optional | Telegram alert bot |
| `TELEGRAM_CHAT_ID` | `.env` | Optional | Telegram target chat |
| `COINGECKO_API_KEY` | `.env` | Optional | Removes rate limits on CoinGecko |
| `COINMARKETCAP_API_KEY` | `.env` | Optional | Enables CoinMarketCap provider |
| `ENVIRONMENT` | `.env` | Yes (prod) | `development` or `production` (Python) |
| `NODE_ENV` | `.env` | Yes (prod) | `development` or `production` (Node.js) |
| `ALLOWED_ORIGINS` | `.env` | Yes (prod) | CORS origins for Next.js middleware |
| `CORS_ORIGINS` | `.env` | Yes (prod) | CORS origins for FastAPI |
| `LOG_LEVEL` | `.env` | No | `info` \| `debug` \| `warning` \| `error` |
| `SCANNER_DELAY_MS` | `.env` | No | Delay between coin scans (default 300) |
| `SCANNER_MIN_CONFIDENCE_ALERT` | `.env` | No | Min confidence for Telegram alert (default 85) |
| `BACKEND_URL` | `.env` | Yes | FastAPI URL for Next.js proxy (default http://localhost:8000) |
