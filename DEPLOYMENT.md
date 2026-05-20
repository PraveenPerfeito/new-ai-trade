# Deployment Guide

Production deployment using **Vercel** (Next.js) + **Railway** (FastAPI + Celery) + **Upstash** (Redis) + **Supabase** (Postgres + Auth).

---

## Architecture

```
Browser
  └─▶ Vercel (Next.js 14)
        ├─▶ Supabase (Auth + Postgres)
        └─▶ Railway Service — FastAPI :8000
              ├─▶ Supabase Postgres (direct asyncpg)
              ├─▶ Upstash Redis (TLS)
              └─▶ Railway Service — Celery Worker
                    ├─▶ Binance API
                    ├─▶ CoinGecko API
                    └─▶ Anthropic Claude API
```

---

## Services & Free Tiers

| Service | Role | Free Tier Limits |
|---------|------|-----------------|
| **Vercel** | Next.js hosting | 100GB bandwidth/mo, unlimited deployments |
| **Railway** | FastAPI + Celery | $5 credit/mo (covers 2 small services) |
| **Supabase** | Postgres + Auth | 500MB DB, 50K MAU, 2GB bandwidth |
| **Upstash** | Redis | 10,000 commands/day, 256MB |
| **Anthropic** | AI validation | Pay per token (Haiku is cheapest) |

---

## Step 1 — Supabase Setup

1. Go to https://supabase.com → create project
2. Run migrations in **SQL Editor**:
   ```
   database/admin-auth-migration.sql
   database/experiments-migration.sql
   ```
3. Create your admin user:
   - Supabase Dashboard → Authentication → Users → Add user
   - Use the email you'll put in `ADMIN_EMAILS`
4. Copy these from **Settings → API**:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
5. Copy `DATABASE_URL` from **Settings → Database → URI** (Direct connection, not pooler)

---

## Step 2 — Upstash Redis Setup

1. Go to https://upstash.com → create account → New Database
2. Region: pick closest to your Railway region
3. Copy the **Redis URL** — it looks like:
   ```
   rediss://default:<password>@<host>.upstash.io:6379
   ```
4. This same URL is used in both Vercel and Railway env vars.

---

## Step 3 — Railway Deployment (FastAPI + Celery)

### 3a. Create Railway project

1. Go to https://railway.app → New Project → Deploy from GitHub repo
2. Select your repository

### 3b. FastAPI service

1. Railway auto-detects Python. If not, set:
   - **Build Command:** `pip install -r backend/requirements.txt`
   - **Start Command:** `uvicorn backend.main:app --host 0.0.0.0 --port $PORT`
2. Set **Root Directory** to `/` (project root, not `/backend`)

### 3c. Celery worker service

Add a second Railway service from the same repo:
- **Start Command:** `celery -A backend.workers.celery_app worker --loglevel=info --concurrency=2`
- **Root Directory:** `/` (project root)
- No public domain needed for the worker

### 3d. Environment variables for both Railway services

Set these in Railway → service → Variables:

```bash
# Python runtime
PYTHON_VERSION=3.12

# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
SUPABASE_SERVICE_ROLE_KEY=<service role key>
DATABASE_URL=postgresql://postgres:<password>@db.<project>.supabase.co:5432/postgres

# Redis
REDIS_URL=rediss://default:<password>@<host>.upstash.io:6379

# Admin auth — REQUIRED, app refuses to start without these in production
ADMIN_SECRET=<run: openssl rand -hex 32>
ADMIN_EMAILS=your@email.com

# AI
ANTHROPIC_API_KEY=sk-ant-...

# Telegram
TELEGRAM_BOT_TOKEN=<token>
TELEGRAM_CHAT_ID=<chat id>

# Market data
COINGECKO_API_KEY=<optional, unlocks higher rate limits>
COINMARKETCAP_API_KEY=<optional>

# Scanner
SCANNER_DELAY_MS=300
SCANNER_MIN_CONFIDENCE_ALERT=85

# Environment
ENVIRONMENT=production
NODE_ENV=production
LOG_LEVEL=info
```

### 3e. Get Railway service URL

After deploying the FastAPI service, copy its public URL from Railway dashboard.
It will look like: `https://your-service.up.railway.app`

---

## Step 4 — Vercel Deployment (Next.js)

### 4a. Connect repo

1. Go to https://vercel.com → New Project → Import Git repository
2. Framework preset: **Next.js** (auto-detected)
3. Root directory: `/` (project root)

### 4b. Environment variables

In Vercel → project → Settings → Environment Variables, add:

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
BACKEND_URL=https://your-service.up.railway.app

# CORS — your Vercel frontend URL
ALLOWED_ORIGINS=https://your-app.vercel.app

# Telegram (optional but recommended)
TELEGRAM_BOT_TOKEN=<token>
TELEGRAM_CHAT_ID=<chat id>

# AI
ANTHROPIC_API_KEY=sk-ant-...

# Market data
COINGECKO_API_KEY=<optional>
COINMARKETCAP_API_KEY=<optional>

# Scanner
SCANNER_DELAY_MS=300
SCANNER_MIN_CONFIDENCE_ALERT=85

# Runtime
NODE_ENV=production
LOG_LEVEL=info
```

> Set all variables for **Production**, **Preview**, and **Development** environments in Vercel.

### 4c. Deploy

```bash
# Push to main triggers auto-deploy on Vercel
git push origin main
```

Or click **Deploy** manually in the Vercel dashboard.

---

## Step 5 — Post-Deployment Checklist

Run these after every production deploy:

```bash
# 1. FastAPI health
curl https://your-service.up.railway.app/health

# 2. Next.js health
curl https://your-app.vercel.app/api/health

# 3. Admin panel loads
open https://your-app.vercel.app/admin

# 4. Manual scan trigger
curl -X POST https://your-app.vercel.app/api/scanner/run \
  -H "Content-Type: application/json" \
  -H "Cookie: <your session cookie>" \
  -d '{"mode":"spot"}'
```

Expected FastAPI health response:
```json
{"status": "ok", "version": "1.0.0"}
```

---

## Environment Variables — Quick Reference

### Which service needs which variable

| Variable | Vercel | Railway FastAPI | Railway Celery |
|----------|--------|-----------------|----------------|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | ✅ | ✅ |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | ✅ | ✅ |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | ✅ | ✅ |
| `DATABASE_URL` | ❌ | ✅ | ✅ |
| `REDIS_URL` | ✅ | ✅ | ✅ |
| `ADMIN_EMAILS` | ✅ | ❌ | ❌ |
| `ADMIN_SECRET` | ✅ | ✅ | ❌ |
| `BACKEND_URL` | ✅ | ❌ | ❌ |
| `ALLOWED_ORIGINS` | ✅ | ❌ | ❌ |
| `ANTHROPIC_API_KEY` | ✅ | ✅ | ✅ |
| `TELEGRAM_BOT_TOKEN` | ✅ | ✅ | ✅ |
| `TELEGRAM_CHAT_ID` | ✅ | ✅ | ✅ |
| `COINGECKO_API_KEY` | ✅ | ✅ | ✅ |
| `SCANNER_DELAY_MS` | ✅ | ✅ | ✅ |
| `NODE_ENV` | ✅ | ✅ | ✅ |

---

## Updating Production

```bash
# 1. Make changes locally
# 2. Type check
npx tsc --noEmit

# 3. Commit and push
git add .
git commit -m "your change"
git push origin main

# Vercel: auto-deploys from main branch
# Railway: auto-deploys from main branch (if GitHub integration is enabled)
```

---

## Monitoring

| What | Where |
|------|-------|
| FastAPI logs | Railway → service → Deployments → Logs |
| Celery task logs | Railway → worker service → Logs |
| Next.js logs | Vercel → project → Deployments → Functions |
| Redis usage | Upstash → database → Data Browser |
| DB usage | Supabase → Database → Tables |
| Scan signals | Supabase → Database → Table Editor → signals |
| Prometheus metrics | `https://your-fastapi.up.railway.app/metrics` |

---

## Security Checklist (before going live)

- [ ] `ADMIN_SECRET` is a random 32-byte hex (`openssl rand -hex 32`) — not a simple password
- [ ] `ADMIN_EMAILS` lists only your email(s) — not empty
- [ ] `ALLOWED_ORIGINS` is set to your Vercel domain — not empty
- [ ] `SUPABASE_SERVICE_ROLE_KEY` is **never** in a `NEXT_PUBLIC_` variable
- [ ] `.env` is in `.gitignore` — confirm with `git status` that it's not tracked
- [ ] Supabase RLS is enabled on all tables
- [ ] Admin user created in Supabase Auth with a strong password

---

## Rollback

If a deploy breaks production:

```bash
# Vercel — instant rollback in dashboard
# Vercel → project → Deployments → find last working deploy → Promote to Production

# Railway — redeploy a previous image
# Railway → service → Deployments → find last working deploy → Redeploy

# Git rollback
git revert HEAD
git push origin main
```
