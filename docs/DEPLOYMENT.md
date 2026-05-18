# Deployment Guide

This guide covers every way to run the Crypto Market Scanner — from local development to production Docker deployment.

---

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | 20+ | Local development |
| npm | 10+ | Package management |
| Docker | 24+ | Container build + run |
| Docker Compose | v2 | Multi-container orchestration |
| Supabase account | — | Database (free tier works) |
| Anthropic API key | — | AI signal validation (optional) |

---

## 1. Database Setup (Required First)

Create a Supabase project at [supabase.com](https://supabase.com), then run both schema files in **SQL Editor → New Query**:

```sql
-- Step 1: Core tables
-- Paste contents of database/schema.sql and run

-- Step 2: Backtest tables
-- Paste contents of database/backtest-schema.sql and run
```

Collect from **Settings → API**:
- Project URL → `NEXT_PUBLIC_SUPABASE_URL`
- `anon` / `public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `service_role` key → `SUPABASE_SERVICE_ROLE_KEY`

---

## 2. Environment Configuration

```bash
cp .env.example .env.local
```

Edit `.env.local`. Minimum required to start:

```env
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGci...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGci...
```

Full reference — see [Environment Variables](#environment-variables-reference).

The app validates all environment variables on first request using Zod. Missing required vars produce a clear error:

```
Environment validation failed:
  • NEXT_PUBLIC_SUPABASE_URL: NEXT_PUBLIC_SUPABASE_URL must be a valid URL
```

---

## 3. Local Development

```bash
# Install dependencies
npm install

# Start dev server (hot reload enabled)
npm run dev
```

Open [http://localhost:3000/dashboard](http://localhost:3000/dashboard).

Dev-mode features:
- `pino-pretty` formatted logs in terminal (colorized, human-readable)
- React error boundaries show full stack trace
- No CORS restrictions (`ALLOWED_ORIGINS` defaults to open)

### Useful dev commands

```bash
npm run build        # production build — catches type + config errors
npm run start        # run production build locally
npx tsc --noEmit     # type-check without building
npm run lint         # ESLint
```

---

## 4. Docker Deployment

### 4.1 Build the image

```bash
docker build -t crypto-market-scanner:latest .
```

Multi-stage build:
1. **deps** — `npm ci` (all dependencies)
2. **builder** — `npm run build` → `.next/standalone`
3. **runner** — minimal Alpine image, non-root user, standalone output copied in

### 4.2 Run with Docker Compose (recommended)

```bash
# First run (builds + starts)
docker compose up --build -d

# Subsequent starts
docker compose up -d

# View logs
docker compose logs -f web

# Stop
docker compose down
```

Docker Compose reads `.env.local` automatically via `env_file`.

### 4.3 Run the container directly

```bash
docker run -d \
  --name market-scanner \
  -p 3000:3000 \
  --env-file .env.local \
  -e NODE_ENV=production \
  --restart unless-stopped \
  crypto-market-scanner:latest
```

### 4.4 Verify the deployment

```bash
# Health check
curl -s http://localhost:3000/api/health | jq .

# Expected response
{
  "status": "ok",
  "version": "0.1.0",
  "uptime": 42,
  "uptimeHuman": "42s",
  "timestamp": "2026-05-18T10:00:00.000Z",
  "responseMs": 87,
  "checks": {
    "supabase":  { "status": "ok",       "latencyMs": 78 },
    "anthropic": { "status": "ok" },
    "telegram":  { "status": "degraded", "message": "Not configured — alerts disabled" },
    "coingecko": { "status": "degraded", "message": "No API key — using free tier" }
  }
}
```

HTTP status codes:
- `200` — all checks ok or degraded (app is serving)
- `503` — at least one check is `down` (Supabase unreachable)

---

## 5. Production Checklist

### Required before going live

- [ ] `NEXT_PUBLIC_SUPABASE_URL` set and reachable
- [ ] `NEXT_PUBLIC_SUPABASE_ANON_KEY` set
- [ ] `SUPABASE_SERVICE_ROLE_KEY` set
- [ ] Database schema applied (`schema.sql` + `backtest-schema.sql`)
- [ ] `/api/health` returns `200` with `status: "ok"`
- [ ] `NODE_ENV=production` in container environment
- [ ] `LOG_LEVEL=info` (not `debug` or `trace` in production)

### Strongly recommended

- [ ] `ANTHROPIC_API_KEY` set (without it, all signals use heuristic validation)
- [ ] `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` set for alerts
- [ ] `ALLOWED_ORIGINS` set to your actual domain(s)
- [ ] `RATE_LIMIT_MAX` tuned for expected traffic (default: 100 req/60s per IP)
- [ ] Reverse proxy (nginx / Caddy) in front with TLS termination
- [ ] Docker restart policy: `unless-stopped` (already in compose)

### Nice to have

- [ ] `COINGECKO_API_KEY` for higher rate limits during scans
- [ ] Log aggregation (ship container stdout JSON to Datadog / Loki / CloudWatch)
- [ ] Uptime monitor (UptimeRobot / Checkly) pointing at `/api/health`

---

## 6. Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NODE_ENV` | — | `development` | Set to `production` in container |
| `PORT` | — | `3000` | Server port |
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | — | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | — | Supabase public key |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | — | Supabase service-role key (server only) |
| `ANTHROPIC_API_KEY` | ⚠ | — | Claude API key — heuristic fallback if absent |
| `TELEGRAM_BOT_TOKEN` | ✗ | — | Telegram bot token |
| `TELEGRAM_CHAT_ID` | ✗ | — | Telegram chat ID for alerts |
| `COINGECKO_API_KEY` | ✗ | — | CoinGecko API key (free tier if absent) |
| `SCANNER_MIN_CONFIDENCE_ALERT` | ✗ | `85` | Min confidence for Telegram alerts (50–100) |
| `SCANNER_DELAY_MS` | ✗ | `300` | Delay between coin scans in ms |
| `LOG_LEVEL` | ✗ | `info` | `fatal`/`error`/`warn`/`info`/`debug`/`trace` |
| `RATE_LIMIT_MAX` | ✗ | `100` | Max requests per IP per window |
| `RATE_LIMIT_WINDOW_MS` | ✗ | `60000` | Rate-limit window in milliseconds |
| `ALLOWED_ORIGINS` | ✗ | *(all)* | Comma-separated CORS allow-list |

---

## 7. Reverse Proxy (nginx example)

```nginx
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
```

Set `ALLOWED_ORIGINS=https://scanner.yourdomain.com` in `.env.local`.

---

## 8. Logs

In production, all logs are structured JSON written to stdout:

```json
{"level":30,"time":"2026-05-18T10:00:00.000Z","env":"production","module":"api/scanner/run","requestId":"a1b2c3","mode":"futures","msg":"Manual scan requested"}
{"level":30,"time":"2026-05-18T10:01:30.000Z","env":"production","module":"api/scanner/run","requestId":"a1b2c3","mode":"futures","coinsScanned":40,"signalsFound":3,"durationMs":87432,"msg":"Scan completed"}
```

Collect with:
- **Docker:** `docker compose logs -f web` (json-file driver, 10 MB × 5 files rotation)
- **Cloud:** route container stdout to your log aggregator
- **Local dev:** pino-pretty colorized output in terminal

---

## 9. Scaling Notes

### Single instance (current)

The in-memory rate limiter and scan scheduler use module-level singletons. This works correctly for a single container. Cold starts reset rate-limit buckets (acceptable for low traffic).

### Multi-instance

To run multiple replicas:

1. **Rate limiting** — replace `middleware.ts` in-memory Map with an Upstash Redis adapter
2. **Scheduler lock** — replace `globalThis.__market_scanner_sched` with a Redis distributed lock (e.g., `ioredis` + Redlock)
3. **Session state** — none currently; stateless — no changes needed
4. **Load balancer** — any L7 proxy works; sticky sessions not required

### Recommended instance size

| Workload | RAM | CPU |
|----------|-----|-----|
| Light (spot mode, 5-min scans) | 512 MB | 0.5 vCPU |
| Standard (futures, 50 coins) | 1 GB | 1 vCPU |
| Heavy (all modes, continuous) | 2 GB | 2 vCPU |

---

## 10. Troubleshooting

### App won't start — environment validation error

```
Environment validation failed:
  • NEXT_PUBLIC_SUPABASE_URL: must be a valid URL
```

**Fix:** Check `.env.local`. The variable must be a full URL including `https://`.

### Health check returns `degraded` for Supabase

```json
{ "status": "down", "latencyMs": 5001, "message": "..." }
```

**Fix:** Check `NEXT_PUBLIC_SUPABASE_URL` is reachable from inside the container. Test with `docker exec market-scanner wget -qO- https://your-project.supabase.co`.

### Scan produces no signals

1. Check `/api/health` — Supabase must be `ok`
2. Check logs for rejection reasons: `MTF rejected`, `EXTREME volatility`, `risk engine`, etc.
3. Try `spot` mode which has the loosest filters
4. Ensure at least 60 candles are available on Binance for the scanned coins

### Docker build fails — standalone output missing

Ensure `next.config.mjs` has `output: 'standalone'`. Without it, the runner stage has nothing to copy.

### Rate limit 429 in development

The middleware rate limiter applies in dev too. Increase `RATE_LIMIT_MAX` in `.env.local` for development:

```env
RATE_LIMIT_MAX=1000
```

### Telegram alerts not sending

1. Check `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are set
2. Verify the bot has been started in the chat (`/start` command)
3. Check `SCANNER_MIN_CONFIDENCE_ALERT` — only signals above this threshold trigger alerts
4. Inspect logs for `[Telegram]` error lines
