# API Reference & Local URLs

Complete reference for all endpoints, local URLs, and usage instructions.

---

## Local Development URLs

| Service | URL | Purpose |
|---------|-----|---------|
| Public landing page | http://localhost:3000 | SignalEdge AI homepage |
| Admin dashboard | http://localhost:3000/admin | Admin overview |
| Admin scanner | http://localhost:3000/admin/scanner | Scanner control panel |
| Admin signals | http://localhost:3000/admin/signals | Signal feed (all signals as admin) |
| Admin calibration | http://localhost:3000/admin/calibration | Claude AI on/off toggle |
| Login page | http://localhost:3000/login | Sign in with Supabase account |
| FastAPI backend | http://localhost:8000 | Python API server |
| FastAPI health | http://localhost:8000/health | Liveness probe |
| Swagger UI | http://localhost:8000/docs | Interactive API explorer |

> Celery worker has no HTTP URL — verify it's running by checking terminal for `celery@HOST ready`.
> The worker also starts a health HTTP server on `$PORT` for Railway health checks.

---

## Starting All Services

```bash
# Terminal 1 — Next.js frontend
npm run dev

# Terminal 2 — FastAPI backend
.venv\Scripts\Activate.ps1   # PowerShell
# source .venv/Scripts/activate  # Git Bash
uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload

# Terminal 3 — Celery worker + Beat
.venv\Scripts\Activate.ps1
celery -A backend.workers.celery_app.celery_app worker --beat --loglevel=info --concurrency=1 -Q celery,scanner
```

---

## Next.js API Routes (`/api/*`)

### Health

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/health` | Public | Liveness — Supabase, Anthropic, Telegram, CMC |
| GET | `/api/health/providers` | Public | Live latency check for all data providers |

### Scanner

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/scanner/run` | Session | Trigger scan — proxies to Python backend |
| GET/POST | `/api/scanner/control` | Session | Scheduler status + start/stop/pause/resume/e-stop |

```bash
# Trigger manual scan (proxies to Python backend /api/scanner/trigger)
curl -X POST http://localhost:3000/api/scanner/run \
  -H "Content-Type: application/json" \
  -d '{"mode":"spot"}'
# modes: spot | futures | high_confidence | trending
```

### Signals

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/signals` | Session | Recent signals — last 7 days, newest first |

```bash
curl "http://localhost:3000/api/signals?limit=100&minConfidence=0"
```

> Admin users (email in ADMIN_EMAILS) see **all signals** with no confidence floor or daily cap.
> Non-admin users see free-plan filtered results (confidence ≥ 85, max 10/day).

### Coins

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/coins/top100` | Session | Top 200 coins from CMC via MarketDataService |

### Analytics

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/analytics/attribution` | Session | Signal attribution by regime/mode/grade |
| POST | `/api/analytics/daily-report` | Session | Trigger Telegram daily report |

### Backtest

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/backtest/run` | Session | Run a new backtest |
| GET | `/api/backtest/results` | Session | List recent backtest runs |
| GET | `/api/backtest/[id]` | Session | Get specific backtest with trades |

### Admin Proxy

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `*` | `/api/admin/[...path]` | Session + Admin email | Proxy to FastAPI — injects `X-Admin-Secret` automatically |

---

## FastAPI Endpoints (`localhost:8000`)

All routes except `/health` and `/health/ready` require `X-Admin-Secret` header.

```bash
ADMIN_SECRET="your-admin-secret-from-env"
```

### Health

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Liveness probe |
| GET | `/health/ready` | Readiness: Redis + Postgres |

### Scanner

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/scanner/trigger` | Trigger on-demand scan (async, returns immediately) |
| GET | `/api/scanner/status` | Latest progress across all modes |
| GET | `/api/scanner/progress/{scan_id}` | Progress for specific scan |

```bash
curl -X POST http://localhost:8000/api/scanner/trigger \
  -H "X-Admin-Secret: $ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"mode":"spot"}'
```

### Settings

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/settings` | All settings groups |
| GET | `/api/settings/{group}` | Single group |
| PATCH | `/api/settings/{group}` | Update fields (merge) |
| POST | `/api/settings/{group}/reset` | Reset to defaults |

**Available groups:** `scanner` · `ai` · `risk` · `providers` · `failover` · `market_cache` · `quota` · `telegram`

```bash
# Toggle Claude AI on/off
curl -X PATCH http://localhost:8000/api/settings/ai \
  -H "X-Admin-Secret: $ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"fields": {"enabled": false}, "updated_by": "admin"}'
```

### Providers

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/providers` | All providers with health metrics |
| POST | `/api/providers/{name}/enable` | Enable provider |
| POST | `/api/providers/{name}/disable` | Disable provider |
| POST | `/api/providers/{name}/priority` | Set priority (1–6) |
| POST | `/api/providers/clear-cache` | Clear market-data cache |

**Provider names:** `coinmarketcap` (primary) · `coingecko` (fallback) · `binance` · `dexscreener` · `coinpaprika` · `geckoterm`

### Analytics

| Method | Path | Query | Description |
|--------|------|-------|-------------|
| GET | `/api/analytics/summary` | `window_hours=168` | All analytics in one call |
| GET | `/api/analytics/ai` | `window_hours=24` | Claude approval rates, latency |
| GET | `/api/analytics/scans` | `window_hours=24` | Scan throughput trends |
| GET | `/api/analytics/edge/report` | `window_hours=720` | Full edge validation report |
| GET | `/api/analytics/edge/calibration` | `window_hours=720` | Confidence calibration |
| GET | `/api/analytics/edge/claude` | `window_hours=720` | Claude vs heuristic |
| GET | `/api/analytics/edge/regime` | `window_hours=720` | Market regime analysis |
| GET | `/api/analytics/edge/modes` | `window_hours=720` | Scanner mode comparison |
| GET | `/api/analytics/edge/coins` | `window_hours=720` | Per-coin performance |
| GET | `/api/analytics/stream` | `timeout=300` | SSE realtime metrics stream |

### Burn-in Monitoring

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/burnin/status` | Burn-in progress and anomaly summary |
| GET | `/api/burnin/readiness` | Production readiness score (0–100) |
| GET | `/api/burnin/anomalies` | Recent anomaly records |

---

## Celery Tasks (Background Workers)

These run automatically via Celery Beat. No manual invocation needed.

| Task | Schedule | Queue | Description |
|------|----------|-------|-------------|
| `run_scheduled_scan` (spot) | Every 15 min | scanner | Standard 80-coin spot scan |
| `run_scheduled_scan` (high_confidence) | Every 30 min (at :05, :35) | scanner | 30-coin high-confidence scan |
| `run_scheduled_scan` (futures) | Every 30 min (at :10, :40) | scanner | 50-coin futures scan |
| `check_signal_outcomes` | Every 10 min | celery | Resolve pending TP/SL/timeout outcomes |
| `daily_analytics_snapshot` | Daily at 23:59 UTC | celery | Edge report snapshot |
| `hourly_anomaly_check` | Every hour | celery | Anomaly detection |
| `refresh_daily_view` | Daily at 00:05 UTC | celery | Refresh materialized analytics view |

---

## Environment Variables Quick Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Supabase service role (server only) |
| `DATABASE_URL` | ✅ | Transaction Pooler URL (port 6543) |
| `REDIS_URL` | ✅ | Upstash `rediss://` URL |
| `ADMIN_EMAILS` | ✅ | Comma-separated admin email(s) |
| `ADMIN_SECRET` | ✅ | 32-byte hex — `openssl rand -hex 32` |
| `BACKEND_URL` | ✅ | Railway FastAPI URL (or `http://localhost:8000`) |
| `ANTHROPIC_API_KEY` | ⚠ | Claude Haiku — toggleable from Admin → Calibration |
| `COINMARKETCAP_API_KEY` | ⚠ | Primary coin data (200 coins per scan) |
| `COINGECKO_API_KEY` | ✗ | CoinGecko fallback key |
| `TELEGRAM_BOT_TOKEN` | ✗ | Telegram alert bot token |
| `TELEGRAM_CHAT_ID` | ✗ | Telegram channel/chat ID |
| `SCANNER_MIN_CONFIDENCE_ALERT` | ✗ | Min confidence for Telegram (default 85) |
| `ENVIRONMENT` | ✗ | `development` or `production` |
| `LOG_LEVEL` | ✗ | `info` / `debug` / `warning` / `error` |
