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
> Download Python 3.12: https://www.python.org/downloads/release/python-31210/

---

## One-time Setup

### 1. Clone and enter the project

```bash
git clone <repo-url>
cd simulation-engine/new-ai-trade
```

### 2. Configure environment

```bash
# .env is already the working config file for local dev
# Fill in these required fields:
```

| Field | Where to get it |
|-------|----------------|
| `DATABASE_URL` | Supabase → Settings → Database → Transaction Pooler URI (port 6543) |
| `REDIS_URL` | Upstash dashboard → copy the `rediss://` URL |
| `COINMARKETCAP_API_KEY` | coinmarketcap.com → API Keys → Startup Plan key |
| `ADMIN_EMAILS` | Your Supabase Auth user email |
| `ADMIN_SECRET` | Run `openssl rand -hex 32` |
| `BACKEND_URL` | `http://localhost:8000` for local dev |

### 3. Install Node.js dependencies

```bash
npm install
```

### 4. Create Python virtual environment (must use Python 3.12)

```bash
py -3.12 -m venv .venv

# Activate (Git Bash / WSL)
source .venv/Scripts/activate

# Activate (PowerShell)
.venv\Scripts\Activate.ps1

# Verify
python --version   # must show 3.12.x
```

### 5. Install Python dependencies

```bash
pip install --prefer-binary -r backend/requirements.txt
```

> `--prefer-binary` uses pre-built wheels for numpy/pandas — prevents a 1-hour compile.

---

## Starting the Stack

You need **3 terminals** running simultaneously, all from the project root.

### Terminal 1 — Next.js frontend

```bash
npm run dev
```

| URL | Purpose |
|-----|---------|
| http://localhost:3000 | Public landing page |
| http://localhost:3000/admin | Admin dashboard |
| http://localhost:3000/admin/scanner | Scanner control |
| http://localhost:3000/admin/signals | Signal feed |
| http://localhost:3000/admin/calibration | Claude AI toggle |

### Terminal 2 — Python FastAPI backend

```bash
source .venv/Scripts/activate   # Git Bash
# .venv\Scripts\Activate.ps1   # PowerShell

uvicorn backend.main:app --reload --port 8000
```

| URL | Purpose |
|-----|---------|
| http://localhost:8000/health | Liveness probe |
| http://localhost:8000/docs | Swagger UI |

> Always run from the **project root**, not from inside `backend/`.

### Terminal 3 — Celery worker

```bash
source .venv/Scripts/activate

celery -A backend.workers.celery_app.celery_app worker --beat --loglevel=info --concurrency=1 -Q celery,scanner
```

> `--concurrency=1` is correct for local dev — one scan at a time.
> `--beat` runs the scheduler in the same process (fine for local dev).

---

## Verifying Everything Works

```bash
# FastAPI health
curl http://localhost:8000/health

# Next.js health
curl http://localhost:3000/api/health

# Trigger a manual scan
curl -X POST http://localhost:3000/api/scanner/run \
  -H "Content-Type: application/json" \
  -d '{"mode":"spot"}'
```

---

## Environment Variables Reference (local dev)

```bash
# Runtime
NODE_ENV=development
PORT=3000
ENVIRONMENT=development

# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
SUPABASE_SERVICE_ROLE_KEY=<service role key>

# Database — Transaction Pooler (port 6543, not 5432)
DATABASE_URL=postgresql://postgres.<project>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres

# Redis — Upstash
REDIS_URL=rediss://default:<password>@<host>.upstash.io:6379

# Admin auth — REQUIRED
ADMIN_EMAILS=your@email.com
ADMIN_SECRET=<32-byte hex>

# Backend proxy (local FastAPI)
BACKEND_URL=http://localhost:8000

# AI (can be toggled from Admin → Calibration)
ANTHROPIC_API_KEY=sk-ant-...

# Market data
COINMARKETCAP_API_KEY=<Startup Plan key>
COINGECKO_API_KEY=<optional>

# Telegram alerts (optional)
TELEGRAM_BOT_TOKEN=<token>
TELEGRAM_CHAT_ID=<chat id>

# Scanner
SCANNER_MIN_CONFIDENCE_ALERT=85
LOG_LEVEL=info
```

---

## Common Problems

### `asyncpg` or `numpy` fails to build
Use Python 3.12 and `pip install --prefer-binary`:
```bash
py -3.12 -m venv .venv
pip install --prefer-binary -r backend/requirements.txt
```

### `uvicorn: command not found`
Venv not activated, or running from wrong directory:
```bash
source .venv/Scripts/activate
# then from PROJECT ROOT:
uvicorn backend.main:app --reload --port 8000
```

### Celery import error
Always run Celery from the project root, not inside `backend/`:
```bash
celery -A backend.workers.celery_app.celery_app worker --loglevel=info --concurrency=1 -Q celery,scanner
```

### Admin dashboard shows login loop
`ADMIN_EMAILS` in `.env` doesn't match your Supabase account email.

### Signals not showing in admin dashboard
Make sure `ADMIN_EMAILS` is set — the signals API gives you enterprise-level access when logged in as admin.

### Database connection refused
Use Transaction Pooler URL (port **6543**), not Direct Connection (port 5432):
```
postgresql://postgres.<project>:<pass>@aws-0-<region>.pooler.supabase.com:6543/postgres
```

### TypeScript errors
```bash
npx tsc --noEmit   # must be zero errors
```

---

## Development Workflow

```bash
# Type check before committing
npx tsc --noEmit

# Build check
npm run build

# Python syntax check
python -c "import ast, pathlib; [ast.parse(f.read_text()) for f in pathlib.Path('backend').rglob('*.py')]"
```
