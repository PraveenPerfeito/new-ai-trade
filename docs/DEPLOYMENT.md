# Deployment Guide

> **See [MASTER_PLATFORM_STATUS.md](MASTER_PLATFORM_STATUS.md) for the authoritative production status, env vars, and deployment checklist.**

## Quick Reference

| Service | Platform | Config |
|---------|----------|--------|
| Next.js frontend | Vercel | Auto-deploy from `main` branch |
| FastAPI + Celery worker | Railway | Two services: `api` + `worker` |
| PostgreSQL + Auth | Supabase | `NEXT_PUBLIC_SUPABASE_URL` + keys |
| Redis | Redis Cloud / Upstash | `REDIS_URL` |
| Message broker | CloudAMQP (AMQP) | `CELERY_BROKER_URL` |
| WhatsApp alerts | UltraMsg | `WHATSAPP_API_URL` + `WHATSAPP_TOKEN` |

## Required Environment Variables

### Vercel (Next.js)
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
ADMIN_EMAILS=your@email.com          # blocks all admin access if unset
ADMIN_SECRET=<32-byte hex>           # openssl rand -hex 32
REDIS_URL=rediss://...
BACKEND_URL=https://your-railway-app.railway.app
```

### Railway (FastAPI + Celery)
```
DATABASE_URL=postgresql://...
REDIS_URL=rediss://...
CELERY_BROKER_URL=amqps://...@cloudamqp.com/...
CELERY_RESULT_BACKEND=rpc://
BINANCE_API_KEY=
COINMARKETCAP_API_KEY=
WHATSAPP_API_URL=https://api.ultramsg.com/instance.../messages/chat
WHATSAPP_TOKEN=
ADMIN_SECRET=<same 32-byte hex as Vercel>
```

## Database Setup (Supabase)

Run all files in `database/` via Supabase SQL Editor (all are idempotent — safe to re-run):
1. `admin-auth-migration.sql`
2. `analytics-schema.sql`
3. `phase-7-4a-intelligence-migration.sql`
4. `cmc-backup-migration.sql`
5. All remaining `*.sql` files in any order

## First-Time CMC Data Capture

After Railway deploy, trigger the one-time CMC sector backup from Railway shell:
```bash
python -c "
import asyncio
from backend.core.scanner.cmc_backup import capture_full_backup
result = asyncio.run(capture_full_backup())
print(result)
"
```
Expected: `{'sectors': ~150, 'assignments': ~3000-8000, 'mappings': ~200, 'rankings': ~200}`

See [CMC_REMOVAL_IMPLEMENTATION_1.md](CMC_REMOVAL_IMPLEMENTATION_1.md) for the full migration checklist.
