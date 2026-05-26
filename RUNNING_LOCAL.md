# Running Locally

Complete guide to running the full stack on your machine.

---

## Prerequisites

| Tool | Required Version | Check |
|------|-----------------|-------|
| Node.js | 18+ (20.x recommended) | `node --version` |
| npm | 9+ | `npm --version` |
| Python | **3.12.x exactly** | `py -3.12 --version` |
| Git | any | `git --version` |

> **Python 3.14 does not work** — `asyncpg` has no pre-built wheel for it yet.
> Download Python 3.12: https://www.python.org/ftp/python/3.12.10/python-3.12.10-amd64.exe
> Tick "Add to PATH" during install.

---

## One-time Setup

### 1. Clone and enter the project

```bash
git clone <repo-url>
cd simulation-engine/new-ai-trade
```

### 2. Copy environment file

The `.env` file in the project root is your local config. It already has dev values
filled in. The fields you must fill yourself:

| Field | Where to get it |
|-------|----------------|
| `DATABASE_URL` | Supabase → Settings → Database → URI (Direct connection) |
| `REDIS_URL` | Upstash dashboard → copy the `rediss://` URL |
| `COINMARKETCAP_API_KEY` | coinmarketcap.com → API Keys → copy Pro API key (Startup Plan) |

```bash
# .env is already the working config file for local dev — no need to copy it
# Just open it and fill DATABASE_URL and REDIS_URL
```

### 3. Install Node.js dependencies

```bash
npm install
```

### 4. Create Python virtual environment (must use Python 3.12)

```bash
# Create venv with Python 3.12 specifically
py -3.12 -m venv .venv

# Activate (Git Bash / WSL)
source .venv/Scripts/activate

# Activate (PowerShell)
.venv\Scripts\Activate.ps1

# Verify — must show 3.12.x
python --version
```

### 5. Install Python dependencies

```bash
# With venv activated
pip install -r backend/requirements.txt
```

---

## Starting the Stack

You need **3 terminals** running simultaneously. All from the project root.

### Terminal 1 — Next.js frontend

```bash
npm run dev
```

Opens at: http://localhost:3000
Admin dashboard: http://localhost:3000/admin

### Terminal 2 — Python FastAPI backend

```bash
# Activate venv first
source .venv/Scripts/activate   # Git Bash
# .venv\Scripts\Activate.ps1   # PowerShell

uvicorn backend.main:app --reload --port 8000
```

API docs: http://localhost:8000/docs
Health check: http://localhost:8000/health

> Run from the **project root**, not from inside `backend/`.
> Using `uvicorn main:app` from inside `backend/` breaks all imports.

### Terminal 3 — Celery worker (background scan tasks)

```bash
source .venv/Scripts/activate

celery -A backend.workers.celery_app worker --loglevel=info --concurrency=1
```

> `--concurrency=1` is correct for local dev — one scan at a time.

---

## Verifying Everything Works

After all 3 terminals are running:

```bash
# FastAPI is up
curl http://localhost:8000/health

# Next.js is up
curl http://localhost:3000/api/health

# Redis connection (uses ioredis)
node -e "
const { Redis } = require('ioredis');
const r = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', { tls: {} });
r.ping().then(x => { console.log('Redis:', x); r.disconnect(); });
"
```

Open http://localhost:3000/admin — you should see the scanner dashboard.

---

## Environment Variables Reference (local dev)

All in `.env` at the project root.

```bash
# Runtime
NODE_ENV=development
PORT=3000

# Supabase (already filled in .env)
NEXT_PUBLIC_SUPABASE_URL=https://prdqdmozaxkohlceamoa.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your anon key>
SUPABASE_SERVICE_ROLE_KEY=<your service role key>

# Database — fill this in
DATABASE_URL=postgresql://postgres:<password>@db.<project>.supabase.co:5432/postgres

# Redis — Upstash or local
REDIS_URL=rediss://default:<password>@<host>.upstash.io:6379

# AI (already filled)
ANTHROPIC_API_KEY=sk-ant-...

# Telegram alerts (already filled)
TELEGRAM_BOT_TOKEN=<token>
TELEGRAM_CHAT_ID=<chat id>

# Admin access
ADMIN_EMAILS=your@email.com
ADMIN_SECRET=<32-byte hex>

# CoinMarketCap (Startup Plan — intelligence cache)
COINMARKETCAP_API_KEY=<your-cmc-pro-api-key>

# Backend proxy
BACKEND_URL=http://localhost:8000
```

---

## Common Problems

### `asyncpg` fails to build
You are using Python 3.14. Create the venv with `py -3.12 -m venv .venv` instead.

### `uvicorn: command not found`
Venv is not activated, or you're running from wrong directory.
```bash
source .venv/Scripts/activate
# then from project root:
uvicorn backend.main:app --reload --port 8000
```

### `celery -A workers.celery_app` fails with import error
You're inside the `backend/` folder. Always run Celery from the project root:
```bash
celery -A backend.workers.celery_app worker --loglevel=info --concurrency=1
```

### Admin dashboard shows login loop
`ADMIN_EMAILS` in `.env` doesn't include your Supabase account email.
Add your email: `ADMIN_EMAILS=you@example.com`

### Redis connection refused
If using local Redis, make sure it's running:
```bash
# Docker
docker run -d -p 6379:6379 redis:7-alpine
# or WSL
sudo service redis-server start
```
Or switch to Upstash (recommended) — update `REDIS_URL` in `.env`.

### `startup_check_passed` not seen in FastAPI logs
Check that `DATABASE_URL` and `ADMIN_SECRET` are set in `.env`.
The startup check throws if either is missing when `NODE_ENV=production`.
In `development` mode it only warns.

### TypeScript errors
```bash
npx tsc --noEmit
```
Must be zero errors before committing.

---

## Development Workflow

```bash
# Type check
npx tsc --noEmit

# Build (catches import errors)
npm run build

# Manual scan trigger (with FastAPI running)
curl -X POST http://localhost:3000/api/scanner/run \
  -H "Content-Type: application/json" \
  -d '{"mode":"spot"}'
```

