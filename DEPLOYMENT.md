# Deployment Guide

Production stack: **Vercel** (Next.js) · **Railway** (FastAPI + Celery worker) · **Redis Cloud** (Redis) · **Supabase** (Postgres + Auth) · **Anthropic** (Claude Haiku) · **CoinMarketCap** (coin data)

---

## Architecture

```
Browser
  └─▶ Vercel  (Next.js 14 · App Router · Edge middleware)
        ├─▶ Supabase  (Auth + Postgres)
        ├─▶ Redis Cloud  (intelligence cache · scheduler · rate limit)
        └─▶ Railway Web Service — FastAPI :PORT
              ├─▶ Supabase Postgres  (direct asyncpg, Transaction Pooler port 6543)
              ├─▶ Redis Cloud  (same instance)
              └─▶ Railway Background Worker — Celery + Beat
                    ├─▶ Binance API  (spot + futures klines)
                    ├─▶ CoinMarketCap API  (200 coins, primary)
                    ├─▶ CoinGecko API  (fallback only)
                    └─▶ Anthropic Claude Haiku  (AI validation, toggleable)
```

---

## Service Overview

| Service | Role | Notes |
|---------|------|-------|
| **Vercel** | Next.js hosting + CDN | Free tier: 100 GB bandwidth, unlimited deploys |
| **Railway** | FastAPI + Celery worker | Separate services from same Dockerfile |
| **Supabase** | Postgres + Auth | Use Transaction Pooler URL (port 6543) for Railway |
| **Redis Cloud** | Redis (`rediss://`) | Free tier: 30 MB storage, zero command billing |
| **Anthropic** | Claude Haiku AI | Toggle on/off from Admin → System → Settings → Quick Controls to save credits |
| **CoinMarketCap** | 200 coins per scan | Startup Plan: 10,000 credits/month |

---

## Step 1 — Supabase

### 1a. Create project

1. Go to [supabase.com](https://supabase.com) → **New project**
2. Choose region close to your Railway region (e.g. Singapore)
3. Save the database password — needed for `DATABASE_URL`

### 1b. Run migrations

Open **SQL Editor** in Supabase dashboard and run each file in order:

```sql
database/schema.sql
database/backtest-schema.sql
database/analytics-schema.sql
database/admin-auth-migration.sql
database/experiments-migration.sql
database/settings-migration.sql
database/settings-groups-migration.sql
database/edge-validation-migration.sql
database/phase-6.7-attribution-migration.sql
database/phase-7-4a-intelligence-migration.sql
database/phase-7-4a-6-3-migration.sql
database/phase-7-4a-7-2-migration.sql
database/validation-source-migration.sql
database/probability-gate-migration.sql
database/probability-engine-migration.sql
database/telegram-delivery-migration.sql
database/ai-call-log-trace-migration.sql
database/attribution-snapshots-migration.sql
database/signal-outcomes-regime-migration.sql
```

> Run them in the order listed. Each migration is idempotent (`IF NOT EXISTS` / `IF NOT EXISTS`), so re-running is safe.

### 1c. Create admin user

1. Supabase Dashboard → **Authentication → Users → Add user**
2. Use the email you will put in `ADMIN_EMAILS`
3. Set a strong password — this is your login to the admin dashboard

### 1d. Copy credentials

From **Settings → API**:

| Variable | Where |
|----------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Settings → API → anon / public |
| `SUPABASE_SERVICE_ROLE_KEY` | Settings → API → service_role (keep secret) |
| `DATABASE_URL` | Settings → Database → URI → **Transaction Pooler** (port **6543**) |

> **Use Transaction Pooler (port 6543)** — not Direct Connection (port 5432).
> Railway uses IPv6 which is blocked by Supabase's direct connection.

---

## Step 2 — Redis Cloud (free tier)

1. Go to [redis.io/try-free](https://redis.io/try-free) → **Get started free**
2. Create a subscription → **Free** plan (30 MB, zero command billing)
3. Create a database — any name (e.g. `new-ai`)
4. Click the database → **Connect** → copy the public endpoint + password
5. Construct the URL:

```
rediss://default:<password>@<host>.db.redis.io:<port>
```

This single URL is used by **all services** (Vercel, Railway API, Railway Worker).

> **Why Redis Cloud instead of Upstash?** Upstash bills per command (~$0.20/100K ops). Redis Cloud free tier bills by storage only — command count is unlimited. This app uses ~50K commands/day at peak, which costs $0 on Redis Cloud vs ~$3/month on Upstash.

---

## Step 3 — Anthropic

1. Go to [console.anthropic.com](https://console.anthropic.com)
2. **API Keys → Create Key** → copy `sk-ant-api03-...`
3. Set a spend limit under **Billing → Spend Limits** (e.g. $20/month)
4. To get 50 req/min (vs free 5 req/min): **add payment and spend $5** → auto-upgrades to Tier 1

> You can toggle Claude on/off from **Admin → System → Settings → Quick Controls** without redeploying.
> When off, heuristic scoring is used — zero API credits consumed.

---

## Step 4 — CoinMarketCap

1. Go to [coinmarketcap.com/api](https://coinmarketcap.com/api/) → Sign up
2. Get **Startup Plan** key (10,000 credits/month)
3. Copy the Pro API key

Used by the Python scanner to fetch 200 coins per scan in a single API call.

---

## Step 5 — Railway Deployment (FastAPI + Celery Worker)

### 5a. Create Railway project

1. Go to [railway.app](https://railway.app) → **New Project**
2. **Deploy from GitHub repo** → select your repository

### 5b. API service settings

In Railway → your service → **Settings**:

| Setting | Value |
|---------|-------|
| **Builder** | Dockerfile |
| **Start Command** | `/bin/sh -c "exec uvicorn backend.main:app --host 0.0.0.0 --port ${PORT:-8000}"` |
| **Healthcheck Path** | `/health` |

### 5c. Create Celery worker service

In the same Railway project → **New Service → GitHub Repo** (same repo):

| Setting | Value |
|---------|-------|
| **Builder** | Dockerfile |
| **Start Command** | `celery -A backend.workers.celery_app.celery_app worker --beat --loglevel=info --concurrency=2 -Q celery,scanner` |
| **Healthcheck Path** | `/health` |

> The worker starts a tiny HTTP health server on `$PORT` at startup.
> Railway requires the healthcheck to pass — this is what makes the worker show Online.

### 5d. Environment variables (both Railway services)

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
SUPABASE_SERVICE_ROLE_KEY=<service role key>
DATABASE_URL=postgresql://postgres.<project>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres

# Redis
REDIS_URL=rediss://default:<password>@<host>.upstash.io:6379

# Admin auth — REQUIRED
ADMIN_SECRET=<run: openssl rand -hex 32>
ADMIN_EMAILS=your@email.com

# AI (toggleable from Admin → System → Settings → Quick Controls without redeploying)
ANTHROPIC_API_KEY=sk-ant-...

# Market data
COINMARKETCAP_API_KEY=<Startup Plan key>
COINGECKO_API_KEY=<optional fallback key>

# Telegram
TELEGRAM_BOT_TOKEN=<token>
TELEGRAM_CHAT_ID=<chat id>

# Scanner
SCANNER_MIN_CONFIDENCE_ALERT=85

# Runtime
ENVIRONMENT=production
LOG_LEVEL=info
```

### 5e. Get Railway service URL

After deploying, copy the public URL from Railway → API service → **Settings → Domains**:
```
https://crypto-scanner-api-production.up.railway.app
```
You need this for `BACKEND_URL` in Vercel.

---

## Step 6 — Vercel Deployment (Next.js)

### 6a. Import project

1. Go to [vercel.com](https://vercel.com) → **New Project → Import Git Repository**
2. Select this repository → Framework preset: **Next.js** (auto-detected)

### 6b. Environment variables

In **Vercel → Project → Settings → Environment Variables**:

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
SUPABASE_SERVICE_ROLE_KEY=<service role key>

# Redis
REDIS_URL=rediss://default:<password>@<host>.upstash.io:6379

# Admin auth — REQUIRED
ADMIN_EMAILS=your@email.com
ADMIN_SECRET=<same value as Railway>

# Backend — your Railway FastAPI URL
BACKEND_URL=https://crypto-scanner-api-production.up.railway.app

# AI
ANTHROPIC_API_KEY=sk-ant-...

# Market data
COINMARKETCAP_API_KEY=<Startup Plan key>
COINGECKO_API_KEY=<optional>

# Telegram
TELEGRAM_BOT_TOKEN=<token>
TELEGRAM_CHAT_ID=<chat id>

# Scanner
SCANNER_MIN_CONFIDENCE_ALERT=85
```

### 6c. Deploy

```bash
git push origin main   # auto-deploys to Vercel
```

---

## Step 7 — Post-Deployment Checklist

```bash
# Railway FastAPI health
curl https://crypto-scanner-api-production.up.railway.app/health

# Vercel Next.js health
curl https://your-app.vercel.app/api/health

# Admin panel
open https://your-app.vercel.app/admin

# Verify scanner works — trigger manual scan
curl -X POST https://your-app.vercel.app/api/scanner/run \
  -H "Content-Type: application/json" \
  -d '{"mode":"spot"}'
```

---

## Environment Variables — Full Reference

| Variable | Vercel | Railway API | Railway Worker |
|----------|--------|-------------|----------------|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | ✅ | ✅ |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | ✅ | ✅ |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | ✅ | ✅ |
| `DATABASE_URL` | ❌ | ✅ | ✅ |
| `REDIS_URL` | ✅ | ✅ | ✅ |
| `ADMIN_EMAILS` | ✅ | ✅ | ❌ |
| `ADMIN_SECRET` | ✅ | ✅ | ❌ |
| `BACKEND_URL` | ✅ | ❌ | ❌ |
| `ANTHROPIC_API_KEY` | ✅ | ✅ | ✅ |
| `COINMARKETCAP_API_KEY` | ✅ | ✅ | ✅ |
| `COINGECKO_API_KEY` | ✅ | ✅ | ✅ |
| `TELEGRAM_BOT_TOKEN` | ❌ | ✅ | ✅ |
| `TELEGRAM_CHAT_ID` | ❌ | ✅ | ✅ |
| `ENVIRONMENT` | ❌ | ✅ | ✅ |

---

## Monitoring

| What | Where |
|------|-------|
| FastAPI logs | Railway → API service → Logs |
| Celery scan logs | Railway → Worker service → Logs |
| Next.js logs | Vercel → project → Deployments → Functions |
| Redis usage | Redis Cloud console → your database → Metrics |
| DB tables | Supabase → Table Editor → `signals` |
| Admin dashboard | `/admin/signals` |
| Scanner control | `/admin/system?tab=health` |
| AI toggle | `/admin/system?tab=settings` (Quick Controls) |
| Signal feed | `/admin/signals?tab=signals` |
| Performance / track record | `/admin/performance` |
| Feature flags | `/admin/system?tab=settings` (Feature Flags section) |

---

## Security Checklist

- [ ] `ADMIN_SECRET` is a random 32-byte hex — `openssl rand -hex 32`
- [ ] `ADMIN_EMAILS` lists only your email
- [ ] `SUPABASE_SERVICE_ROLE_KEY` is never in a `NEXT_PUBLIC_` variable
- [ ] `.env` and `.env.local` are in `.gitignore`
- [ ] Supabase RLS is enabled on all tables
- [ ] Admin user created in Supabase Auth with strong password
- [ ] Anthropic spend limit set at console.anthropic.com

---

## Rollback

```bash
# Vercel: Vercel → project → Deployments → find last good deploy → Promote to Production

# Railway: Railway → service → Deployments → find last good deploy → Redeploy

# Git rollback
git revert HEAD
git push origin main
```
