# Deployment Guide

Complete guide for running the Crypto Market Scanner — from local development to production Docker deployment.

---

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | 20+ | Next.js frontend dev |
| npm | 10+ | Package management |
| Python | 3.12+ | FastAPI backend (local dev) |
| Docker | 24+ | Container build + run |
| Docker Compose | v2 | Multi-container orchestration |
| Supabase account | — | PostgreSQL database (free tier works) |
| Redis | 7+ | Cache, broker, distributed locks |
| Anthropic API key | — | AI signal validation (optional) |

---

## 1. Database Setup (Required First)

Create a Supabase project at [supabase.com](https://supabase.com), then run all schema files in **SQL Editor → New Query** in order:

```sql
-- Step 1: Core tables (coins, scan_runs, signals)
-- Paste contents of database/schema.sql and run

-- Step 2: Backtest tables
-- Paste contents of database/backtest-schema.sql and run

-- Step 3: Paper trading tables
-- Paste contents of database/paper-trading-schema.sql and run

-- Step 4: Analytics tables
-- Paste contents of database/analytics-schema.sql and run
```

Collect from **Settings → API**:
- Project URL → `NEXT_PUBLIC_SUPABASE_URL`
- `anon` / `public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `service_role` key → `SUPABASE_SERVICE_ROLE_KEY`

Collect from **Settings → Database** (for Python asyncpg):
- Connection string → `DATABASE_URL` (use the connection pooler URI, port 6543)

---

## 2. Environment Configuration

```bash
cp .env.example .env.local
```

Edit `.env.local`. Minimum required:

```env
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGci...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGci...
REDIS_URL=redis://localhost:6379/0
DATABASE_URL=postgresql+asyncpg://postgres:password@db.xxxx.supabase.co:5432/postgres
```

Full reference — see [Environment Variables Reference](#6-environment-variables-reference).

---

## 3. Local Development

### Option A — Docker (recommended)

Starts all services (web, api, worker, beat, redis) with one command:

```bash
docker compose up --build -d
```

| Service | URL |
|---------|-----|
| Next.js dashboard | http://localhost:3000/dashboard |
| FastAPI backend | http://localhost:8000 |
| FastAPI docs | http://localhost:8000/docs |
| Prometheus metrics | http://localhost:8000/metrics |
| Redis | localhost:6379 |

### Option B — Individual processes

```bash
# Terminal 1: Redis
docker run -d --name redis -p 6379:6379 redis:7-alpine

# Terminal 2: FastAPI backend
cd backend
uvicorn backend.main:app --reload --port 8000

# Terminal 3: Celery worker
cd backend
celery -A backend.workers.celery_app worker -l info -Q scanner,paper_trading -c 2

# Terminal 4: Celery Beat scheduler
cd backend
celery -A backend.workers.celery_app beat -l info

# Terminal 5: Next.js dev server
npm run dev
```

### Useful dev commands

```bash
# Next.js
npm run build        # production build — catches type + config errors
npm run start        # run production build locally
npx tsc --noEmit     # type-check without building
npm run lint         # ESLint

# Python backend
python -m pytest backend/core/scanner/tests/ -v   # run 98 unit tests
python -m pytest backend/core/scanner/tests/ -q   # quiet summary only
```

---

## 4. Docker Deployment

### 4.1 Services overview

`docker-compose.yml` defines five services:

| Service | Image | Port | Purpose |
|---------|-------|------|---------|
| `redis` | redis:7-alpine | 6379 | Cache, Celery broker, distributed locks |
| `api` | backend/Dockerfile | 8000 | FastAPI: health, scheduler control, metrics |
| `worker` | backend/Dockerfile | — | Celery: scanner + paper trading tasks |
| `beat` | backend/Dockerfile | — | Celery Beat: cron-style scan schedule |
| `web` | Dockerfile (root) | 3000 | Next.js: frontend + API routes |

All services read from `.env.local` via `env_file`.

### 4.2 Build and start

```bash
# First run (builds all images)
docker compose up --build -d

# Subsequent starts (no rebuild needed)
docker compose up -d

# View logs for a specific service
docker compose logs -f web
docker compose logs -f api
docker compose logs -f worker

# Stop all services (preserves volumes)
docker compose down

# Stop and remove volumes
docker compose down -v
```

### 4.3 Verify the deployment

```bash
# Next.js liveness
curl -s http://localhost:3000/api/health | jq .

# FastAPI liveness
curl -s http://localhost:8000/health | jq .

# FastAPI readiness (Redis + Postgres check)
curl -s http://localhost:8000/health/ready | jq .
```

Expected readiness response:
```json
{
  "status": "ready",
  "checks": {
    "redis":    { "status": "ok",   "latencyMs": 1 },
    "postgres": { "status": "ok",   "latencyMs": 12 }
  }
}
```

HTTP status codes:
- `200` — all checks ok
- `503` — Redis or Postgres unreachable

### 4.4 Scheduler control

```bash
# Check scheduler state
curl -s http://localhost:8000/api/scheduler/status | jq .

# Enable scheduled scanning
curl -s -X POST http://localhost:8000/api/scheduler/start | jq .

# Disable scheduled scanning
curl -s -X POST http://localhost:8000/api/scheduler/stop | jq .
```

Celery Beat schedule (defined in `backend/workers/beat_schedule.py`):

| Task | Interval | Offset |
|------|----------|--------|
| Standard scan | 15 min | — |
| High-confidence scan | 30 min | +5 min |
| Futures scan | 30 min | +10 min |
| Paper position monitor | 1 min | — |

---

## 5. Production Checklist

### Required before going live

- [ ] `NEXT_PUBLIC_SUPABASE_URL` set and reachable
- [ ] `NEXT_PUBLIC_SUPABASE_ANON_KEY` set
- [ ] `SUPABASE_SERVICE_ROLE_KEY` set
- [ ] `REDIS_URL` set and reachable from all containers
- [ ] `DATABASE_URL` set (asyncpg DSN for Python backend)
- [ ] All four database schemas applied
- [ ] `GET /health/ready` on FastAPI returns `200`
- [ ] `GET /api/health` on Next.js returns `200`
- [ ] `NODE_ENV=production` in web container environment
- [ ] `LOG_LEVEL=info` (not `debug` in production)

### Strongly recommended

- [ ] `ANTHROPIC_API_KEY` set (heuristic fallback used without it)
- [ ] `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` set for alerts
- [ ] `ALLOWED_ORIGINS` set to your actual domain(s)
- [ ] Reverse proxy (nginx / Caddy) with TLS termination in front
- [ ] Redis `maxmemory 256mb` + `maxmemory-policy allkeys-lru` (already set in docker-compose)
- [ ] Docker restart policy: `unless-stopped` (already in compose)

### Nice to have

- [ ] `COINGECKO_API_KEY` for higher rate limits during scans
- [ ] Log aggregation (ship stdout JSON to Datadog / Loki / CloudWatch)
- [ ] Prometheus scrape + Grafana dashboard pointed at `:8000/metrics`
- [ ] Uptime monitor (UptimeRobot / Checkly) on both `/api/health` and `:8000/health/ready`

---

## 6. Environment Variables Reference

### Next.js

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NODE_ENV` | — | `development` | Set to `production` in container |
| `PORT` | — | `3000` | Server port |
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | — | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | — | Supabase public key |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | — | Supabase service-role key (server only) |
| `REDIS_URL` | ✅ | `redis://localhost:6379/0` | Redis URL (ioredis) |
| `ANTHROPIC_API_KEY` | ⚠ | — | Claude API key — heuristic fallback if absent |
| `TELEGRAM_BOT_TOKEN` | ✗ | — | Telegram bot token |
| `TELEGRAM_CHAT_ID` | ✗ | — | Telegram chat ID for alerts |
| `COINGECKO_API_KEY` | ✗ | — | CoinGecko API key (free tier if absent) |
| `SCANNER_MIN_CONFIDENCE_ALERT` | ✗ | `85` | Min confidence for Telegram alerts (50–100) |
| `SCANNER_DELAY_MS` | ✗ | `300` | Delay between coin scans in ms |
| `LOG_LEVEL` | ✗ | `info` | `fatal`/`error`/`warn`/`info`/`debug`/`trace` |
| `ALLOWED_ORIGINS` | ✗ | *(all)* | Comma-separated CORS allow-list |

### Python backend (FastAPI + Celery)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `REDIS_URL` | ✅ | `redis://localhost:6379/0` | Redis URL (redis-py + Celery broker) |
| `DATABASE_URL` | ✅ | — | asyncpg DSN: `postgresql+asyncpg://user:pass@host:port/db` |
| `LOG_LEVEL` | ✗ | `info` | Python log level |
| `ENVIRONMENT` | ✗ | `development` | `development` or `production` |

---

## 7. Reverse Proxy (nginx example)

```nginx
# Next.js frontend
server {
    listen 443 ssl;
    server_name scanner.yourdomain.com;

    ssl_certificate     /etc/ssl/certs/your-cert.pem;
    ssl_certificate_key /etc/ssl/private/your-key.pem;

    location / {
        proxy_pass         http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}

# FastAPI backend (internal — do not expose publicly unless needed)
server {
    listen 8000;
    server_name localhost;

    location / {
        proxy_pass         http://localhost:8000;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
    }
}
```

Set `ALLOWED_ORIGINS=https://scanner.yourdomain.com` in `.env.local`.

---

## 8. Logs

### Next.js

All logs are structured JSON written to stdout:

```json
{"level":30,"time":"2026-05-18T10:00:00.000Z","env":"production","module":"lib/scanner","requestId":"a1b2c3","mode":"futures","msg":"Scan completed","coinsScanned":40,"signalsFound":3}
```

### Python backend

structlog emits structured JSON in production, colorized key=value in development:

```json
{"event":"scan_lock_acquired","mode":"spot","timestamp":"2026-05-18T10:00:00Z","level":"info"}
```

Collect with:
- **Docker:** `docker compose logs -f <service>` (json-file driver, 10 MB × 5 rotation)
- **Cloud:** route container stdout to your log aggregator

---

## 9. Scaling Notes

### Multi-instance (supported)

Phase 1 replaced all in-memory singletons with Redis-backed equivalents:

| Concern | Before | After |
|---------|--------|-------|
| Rate limiting | In-memory Map (per-process) | Redis INCR/EXPIRE (shared) |
| Scan scheduler | `globalThis` singleton | Celery Beat + Redis `SET NX EX` lock |
| Cache | In-memory TTL Map | Redis TTL cache |

Multiple `web` or `worker` replicas can run safely behind a load balancer.

### Recommended instance sizes

| Workload | RAM | CPU |
|----------|-----|-----|
| Light (spot mode, 15-min scans) | 512 MB | 0.5 vCPU |
| Standard (futures, 50 coins) | 1 GB | 1 vCPU |
| Heavy (all modes, continuous) | 2 GB | 2 vCPU |

Redis itself is lightweight; 256 MB is sufficient for this workload.

---

## 10. Troubleshooting

### FastAPI won't start — missing env vars

```
pydantic_settings.env_settings.EnvSettingsError: ...REDIS_URL field required
```

**Fix:** Set `REDIS_URL` in `.env.local`. The Python backend validates all env vars at startup via pydantic-settings.

### Next.js environment validation error

```
Environment validation failed:
  • NEXT_PUBLIC_SUPABASE_URL: must be a valid URL
```

**Fix:** Check `.env.local`. The variable must be a full URL including `https://`.

### FastAPI readiness returns 503

```json
{ "status": "not_ready", "checks": { "redis": { "status": "error" } } }
```

**Fix:** Confirm Redis is running. In Docker: `docker compose ps redis`. Standalone: `redis-cli ping`.

### Celery worker not picking up tasks

```
[ERROR/MainProcess] consumer: Cannot connect to redis://redis:6379/0
```

**Fix:** The `worker` service depends on the `redis` health check. If Redis started slowly, restart the worker: `docker compose restart worker`.

### Scan produces no signals

1. Check `GET /health/ready` — Redis and Postgres must be `ok`
2. Check logs for rejection reasons: `sideways market`, `MTF rejected`, `EXTREME volatility`, `risk engine`, etc.
3. Try `spot` mode (loosest filters)
4. Ensure at least 60 candles are available on Binance for the scanned coins

### Docker build fails — standalone output missing

Ensure `next.config.mjs` has `output: 'standalone'`. Without it the runner stage has nothing to copy.

### Rate limit 429 in development

Redis-backed rate limiting applies in dev. Increase the limit in `.env.local`:

```env
RATE_LIMIT_MAX=1000
```

### Telegram alerts not sending

1. Check `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are set
2. Verify the bot has been started in the chat (`/start` command)
3. Check `SCANNER_MIN_CONFIDENCE_ALERT` — only signals above this threshold trigger alerts
4. Check logs for `sendMessage failed` error lines
