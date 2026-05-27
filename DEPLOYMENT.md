# Deployment Guide — Phase 7

Production stack: **Vercel** (Next.js) · **Render** (FastAPI + Celery) · **Upstash** (Redis) · **Supabase** (Postgres + Auth) · **Anthropic** (Claude Haiku)

---

## Architecture

```
Browser
  └─▶ Vercel  (Next.js 14 · App Router · Edge middleware)
        ├─▶ Supabase  (Auth + Postgres)
        ├─▶ Upstash Redis  (intelligence cache · scheduler · rate limit)
        └─▶ Render Web Service — FastAPI :8000
              ├─▶ Supabase Postgres  (direct asyncpg)
              ├─▶ Upstash Redis  (same instance)
              └─▶ Render Background Worker — Celery
                    ├─▶ Binance API
                    ├─▶ CoinGecko API
                    ├─▶ CoinMarketCap API
                    └─▶ Anthropic Claude Haiku
```

---

## Service Overview

| Service | Role | Free tier |
|---------|------|-----------|
| **Vercel** | Next.js hosting + CDN | 100 GB bandwidth/mo, unlimited deploys |
| **Render** | FastAPI + Celery | 750 hrs/mo web service; background workers sleep on free tier — use $7/mo Starter for always-on |
| **Supabase** | Postgres + Auth | 500 MB DB, 50 K MAU, 2 GB bandwidth |
| **Upstash** | Redis | 10 K commands/day free; $0.2/100K commands above that |
| **Anthropic** | Claude Haiku AI | Pay-per-token — Haiku is cheapest (~$0.25/M input tokens) |
| **CoinMarketCap** | Intelligence cache | Startup Plan: 300K credits/month |

---

## Step 1 — Supabase

### 1a. Create project

1. Go to [supabase.com](https://supabase.com) → **New project**
2. Choose a region close to your Render region (e.g. US East)
3. Save the database password — you need it for `DATABASE_URL`

### 1b. Run migrations

Open **SQL Editor** in Supabase dashboard and run each file in order:

```sql
-- Copy/paste contents of each file:
database/schema.sql
database/backtest-schema.sql
database/paper-trading-schema.sql
database/analytics-schema.sql
database/admin-auth-migration.sql
database/experiments-migration.sql
```

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
| `SUPABASE_SERVICE_ROLE_KEY` | Settings → API → service_role (**keep secret**) |
| `DATABASE_URL` | Settings → Database → URI → **Direct connection** (not pooler) |

---

## Step 2 — Upstash Redis

1. Go to [upstash.com](https://upstash.com) → **Create account → New Database**
2. Name: `crypto-scanner-prod`, type: **Redis**
3. Region: pick the same region as your Render + Supabase
4. Copy the **Redis URL** — it starts with `rediss://`

```
rediss://default:<password>@<host>.upstash.io:6379
```

This single URL is used by **all three services** (Vercel, Render FastAPI, Render Celery).

---

## Step 3 — Anthropic Claude API key

1. Go to [console.anthropic.com](https://console.anthropic.com)
2. **API Keys → Create Key** — name it `crypto-scanner-prod`
3. Copy it: `sk-ant-api03-...`
4. Set a spend limit under **Billing → Spend Limits** (e.g. $20/month) to prevent surprises

The app uses **Claude Haiku** for signal validation — cheapest model, ~$0.25/M input tokens.

---

## Step 4 — CoinMarketCap API key

1. Go to [coinmarketcap.com/api](https://coinmarketcap.com/api/)
2. Sign up → **Get Free API Key** (or upgrade to Startup Plan for 300K credits/month)
3. Copy the key from the developer portal

Used by the intelligence cache layer (`lib/intelligence/`) to power the Market Intelligence, Sector Rotation, and Trending pages.

---

## Step 5 — Render Deployment (FastAPI + Celery)

### 5a. Connect GitHub repo

1. Go to [render.com](https://render.com) → **New → Web Service**
2. Connect your GitHub account → select this repository
3. Branch: `main`

### 5b. FastAPI web service settings

| Setting | Value |
|---------|-------|
| **Name** | `crypto-scanner-api` |
| **Environment** | `Python 3` |
| **Region** | Same as Supabase/Upstash |
| **Build Command** | `pip install -r backend/requirements.txt` |
| **Start Command** | `uvicorn backend.main:app --host 0.0.0.0 --port $PORT` |
| **Instance Type** | Starter ($7/mo) for always-on; Free tier sleeps after 15 min |

### 5c. Celery background worker settings

From your Render project → **New → Background Worker** (same repo):

| Setting | Value |
|---------|-------|
| **Name** | `crypto-scanner-worker` |
| **Build Command** | `pip install -r backend/requirements.txt` |
| **Start Command** | `celery -A backend.workers.celery_app worker --loglevel=info --concurrency=2` |
| **Instance Type** | Free or Starter |

### 5d. Environment variables (both Render services)

Set these under **Environment → Environment Variables** in each service:

```bash
# Python runtime
PYTHON_VERSION=3.12.0

# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
SUPABASE_SERVICE_ROLE_KEY=<service role key>
DATABASE_URL=postgresql://postgres:<password>@db.<project>.supabase.co:5432/postgres

# Redis
REDIS_URL=rediss://default:<password>@<host>.upstash.io:6379

# Admin auth — REQUIRED
ADMIN_SECRET=<run: openssl rand -hex 32>
ADMIN_EMAILS=your@email.com

# AI
ANTHROPIC_API_KEY=sk-ant-...

# Telegram (optional)
TELEGRAM_BOT_TOKEN=<token>
TELEGRAM_CHAT_ID=<chat id>

# Market data
COINGECKO_API_KEY=<optional — unlocks higher rate limits>
COINMARKETCAP_API_KEY=<Startup Plan key>

# Scanner
SCANNER_DELAY_MS=300
SCANNER_MIN_CONFIDENCE_ALERT=85

# CORS — fill in after you have Vercel URL
CORS_ORIGINS=https://your-app.vercel.app,https://your-api.onrender.com

# Environment
ENVIRONMENT=production
NODE_ENV=production
LOG_LEVEL=info
```

> Tip: In Render dashboard, you can copy env vars from one service to another under **Environment → Copy From Service**.

### 5e. Get Render service URL

After deploying, copy the public URL from the Render dashboard — it looks like:
```
https://crypto-scanner-api.onrender.com
```
You need this for `BACKEND_URL` in Vercel.

---

## Step 6 — Vercel Deployment (Next.js)

### 6a. Import project

1. Go to [vercel.com](https://vercel.com) → **New Project → Import Git Repository**
2. Select this repository → Framework preset: **Next.js** (auto-detected)
3. Root directory: `/` (leave as default)

### 6b. Environment variables

In **Vercel → Project → Settings → Environment Variables**, add all of these.
Set them for **Production**, **Preview**, and **Development**.

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
SUPABASE_SERVICE_ROLE_KEY=<service role key>

# Redis
REDIS_URL=rediss://default:<password>@<host>.upstash.io:6379

# Admin auth — REQUIRED
ADMIN_EMAILS=your@email.com
ADMIN_SECRET=<same value as Render>

# Backend — your Render FastAPI URL
BACKEND_URL=https://crypto-scanner-api.onrender.com

# CORS — your Vercel URL
ALLOWED_ORIGINS=https://your-app.vercel.app

# AI
ANTHROPIC_API_KEY=sk-ant-...

# Market data
COINGECKO_API_KEY=<optional>
COINMARKETCAP_API_KEY=<Startup Plan key>

# Telegram (optional)
TELEGRAM_BOT_TOKEN=<token>
TELEGRAM_CHAT_ID=<chat id>

# Scanner
SCANNER_DELAY_MS=300
SCANNER_MIN_CONFIDENCE_ALERT=85

# Runtime
NODE_ENV=production
LOG_LEVEL=info
```

### 6c. Deploy

```bash
# Pushing to main automatically triggers a Vercel deploy
git push origin main
```

Or click **Deploy** in the Vercel dashboard.

---

## Step 7 — Post-Deployment Checklist

Run these after every production deploy:

```bash
# Render FastAPI health
curl https://crypto-scanner-api.onrender.com/health

# Vercel Next.js health
curl https://your-app.vercel.app/api/health

# Admin panel loads
open https://your-app.vercel.app/admin

# Test scanner control
curl https://your-app.vercel.app/api/scanner/control

# Test market intelligence
curl https://your-app.vercel.app/api/market/intelligence
```

Expected responses:
```json
// FastAPI
{"status": "ok", "version": "1.0.0"}

// scanner/control
{"success": true, "scheduler": {"started": false, ...}}
```

---

## Environment Variables — Full Reference

| Variable | Vercel | Render FastAPI | Render Celery |
|----------|--------|----------------|---------------|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | ✅ | ✅ |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | ✅ | ✅ |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | ✅ | ✅ |
| `DATABASE_URL` | ❌ | ✅ | ✅ |
| `REDIS_URL` | ✅ | ✅ | ✅ |
| `ADMIN_EMAILS` | ✅ | ❌ | ❌ |
| `ADMIN_SECRET` | ✅ | ✅ | ❌ |
| `BACKEND_URL` | ✅ | ❌ | ❌ |
| `ALLOWED_ORIGINS` | ✅ | ❌ | ❌ |
| `CORS_ORIGINS` | ❌ | ✅ | ❌ |
| `ANTHROPIC_API_KEY` | ✅ | ✅ | ✅ |
| `COINMARKETCAP_API_KEY` | ✅ | ✅ | ✅ |
| `COINGECKO_API_KEY` | ✅ | ✅ | ✅ |
| `TELEGRAM_BOT_TOKEN` | ✅ | ✅ | ✅ |
| `TELEGRAM_CHAT_ID` | ✅ | ✅ | ✅ |
| `SCANNER_DELAY_MS` | ✅ | ✅ | ✅ |
| `NODE_ENV` | ✅ | ✅ | ✅ |
| `ENVIRONMENT` | ❌ | ✅ | ✅ |

---

## Updating Production

```bash
# 1. Make changes locally, type-check
node --max-old-space-size=4096 node_modules/typescript/bin/tsc --noEmit --skipLibCheck

# 2. Commit and push
git add -p
git commit -m "feat: ..."
git push origin main

# Vercel: auto-deploys from main (2-3 min)
# Render: auto-deploys from main if GitHub integration is enabled (3-5 min)
```

---

## Monitoring

| What | Where |
|------|-------|
| FastAPI logs | Render → service → Logs |
| Celery task logs | Render → worker → Logs |
| Next.js logs | Vercel → project → Deployments → Functions |
| Redis usage | Upstash → database → Data Browser |
| Redis commands | Upstash → database → Metrics |
| DB tables | Supabase → Database → Table Editor |
| Scan signals | Supabase → Table Editor → `signals` |
| Admin dashboard | `/admin/overview` — live scanner + regime + signals |
| Cache health | `/admin/cache` — CMC quota, group freshness, worker status |
| Scanner control | `/admin/scanner` — start/stop/pause/e-stop |

---

## Security Checklist (before going live)

- [ ] `ADMIN_SECRET` is a random 32-byte hex — run `openssl rand -hex 32`
- [ ] `ADMIN_EMAILS` lists only your email — never left empty
- [ ] `ALLOWED_ORIGINS` is set to your exact Vercel domain
- [ ] `SUPABASE_SERVICE_ROLE_KEY` is **never** in a `NEXT_PUBLIC_` variable
- [ ] `.env` and `.env.local` are in `.gitignore` — run `git status` to verify
- [ ] Supabase RLS is enabled on all tables
- [ ] Admin user created in Supabase Auth with a strong password
- [ ] Anthropic spend limit set in console.anthropic.com

---

## Rollback

```bash
# Vercel: instant rollback
# Vercel → project → Deployments → find last working deploy → "Promote to Production"

# Render: redeploy a previous build
# Render → service → Events → find last good deploy → Redeploy

# Git rollback
git revert HEAD
git push origin main
```
