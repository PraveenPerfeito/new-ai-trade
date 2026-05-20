# Crypto Market Scanner — Claude Code Guide

## Project Overview

AI-powered crypto trading signal scanner built with **Next.js 14 App Router** + **TypeScript** + **Python FastAPI** backend. Scans top-100 coins, applies a 10-step quality pipeline, and surfaces high-probability trade setups via a glassmorphism admin dashboard and Telegram alerts.

**Stack:** Next.js 14 · React 18 · TypeScript · Tailwind CSS · Supabase (PostgreSQL + Auth) · @supabase/ssr · Anthropic Claude Haiku · Binance API · CoinGecko API · FastAPI · Celery · Redis · pino · zod

---

## Key Architecture Decisions

1. **10-step pipeline before AI**: MTF confirmation → volatility gate → trend strength → setup scoring → RR check → risk engine → futures intelligence → Claude Haiku. Each gate reduces expensive API calls.
2. **`runtime = 'nodejs'`** on all API routes — Edge runtime not used (need pino + Binance TCP connections). Exception: `middleware.ts` uses Edge.
3. **`globalThis` scheduler singleton** — survives Next.js hot-module replacement without duplicate timers.
4. **Risk engine before AI** — rejects grade-F signals without spending Anthropic tokens.
5. **Futures intelligence** only runs for `futures` and `high_confidence` modes.
6. **Admin auth — two-layer protection:**
   - Layer 1: `middleware.ts` (Edge) — Supabase session validation + email allowlist
   - Layer 2: `AdminAuthMiddleware` (FastAPI) — shared `X-Admin-Secret` header from Next.js proxy
7. **Settings system — 3-layer cache**: 30s in-process dict → 1h Redis → PostgreSQL (source of truth). Generation counter + Redis pub/sub propagates changes to all workers within ≤ 5 s.
8. **Safety layer** — `backend/system_settings/safety.py` runs before every `patch_group()` write: Tier 1 hard caps block saves, Tier 2 semantic rules return warnings.
9. **Experiments** — layered on top of base settings; active experiments are resolved per-request in `SettingsService.get_group()` using context matching and rollout %.

---

## File Map

```
lib/
  scanner.ts            ← main pipeline; exports detectSetup(), tradeLevels(), scanCoin()
  scheduler.ts          ← auto-scan scheduler with distributed lock (in-memory)
  indicators.ts         ← RSI, MACD, EMA, ATR, volume spike, trend strength
  risk.ts               ← risk score, quality score, grade A-F, leverage tiers
  futures-intelligence.ts ← funding rate, OI, L/S ratio, liq zones, breakout, momentum
  ai-validator.ts       ← Claude Haiku validation + heuristic fallback
  binance.ts            ← spot + futures klines, funding, OI, L/S; withApiRetry wrapped
  coingecko.ts          ← top-100 market data; withApiRetry wrapped
  supabase.ts           ← all DB operations (signals, scan runs, coins, backtest)
  telegram.ts           ← signal alert + daily summary formatting
  logger.ts             ← pino child loggers — use createLogger('module-name')
  env.ts                ← Zod env validation — use getEnv() or env proxy
  cache.ts              ← TTL cache; shared instances: coinsCache, signalsCache, etc.
  retry.ts              ← withRetry(), withApiRetry() with exponential backoff
  validate.ts           ← parseQuery(), parseBody() + shared Zod schemas
  backtest.ts           ← historical candle replay engine
  admin-api.ts          ← typed fetch client for the Python backend (/api/admin/* proxy)
  auth-audit.ts         ← logAuthEvent() — writes login/logout/failed events to Supabase

lib/supabase/
  server.ts             ← createSupabaseServerClient() — cookie-based, for Server Components
  client.ts             ← createSupabaseBrowserClient() — singleton, for Client Components
  admin.ts              ← createSupabaseAdminClient() — service role, server-only

app/api/
  admin/[...path]/      ← proxy to Python FastAPI; injects X-Admin-Secret header
  auth/signout/         ← POST — clears session cookies + writes audit log
  scanner/run/          ← POST — manual scan trigger (protected by middleware)
  signals/              ← GET — fetch recent signals (API-key auth)
  health/               ← GET — liveness probe (public)
  scheduler/            ← status · start · stop (protected)
  backtest/             ← run · results · [id] · compare (protected)

app/
  login/page.tsx        ← email + password login; terminal glassmorphism theme
  auth/callback/        ← PKCE code exchange (magic-link / OAuth flows)
  actions/auth.ts       ← Server Actions: recordLoginEvent() for client-side login form
  admin/layout.tsx      ← async Server Component; secondary auth check; passes user to topbar

components/admin/
  topbar.tsx            ← receives email + lastSignIn props; renders SessionBadge
  session-badge.tsx     ← user identity display + sign-out button
  sidebar.tsx           ← navigation

components/dashboard/
  market-scanner.tsx    ← root orchestrator; polling + state
  signals-feed.tsx      ← signal cards with risk grade + futures badges

middleware.ts           ← Edge: Supabase auth gate, email allowlist, security headers, CORS

backend/system_settings/
  groups.py             ← Pydantic v2 group models (9 groups) with Field bounds
  service.py            ← SettingsService — 3-layer cache, patch_group(), experiments
  safety.py             ← check_safety() — SAFETY_CAPS + 5 semantic rule functions
  experiments.py        ← ExperimentService — staged rollouts, dry-run, context filter
  propagation.py        ← PropagationListener (FastAPI async) + CeleryConfigWatcher (sync)

backend/middleware/
  admin_auth.py         ← validates X-Admin-Secret header on all non-public FastAPI routes
  rate_limit.py         ← slowapi rate limiter
  request_id.py         ← per-request UUID stamping

database/
  experiments-migration.sql   ← settings_experiments table
  admin-auth-migration.sql    ← admin_auth_log table + RLS deny policy
```

---

## Coding Conventions

- **New API routes**: import `parseBody`/`parseQuery` from `lib/validate`, `createLogger` from `lib/logger`. Return `{ success, error }` envelope.
- **New lib modules**: `createLogger('lib/module-name')` at module level. Wrap external API calls in `withApiRetry`.
- **No `console.log`** — use pino logger (`log.info`, `log.warn`, `log.error`). Exception: `middleware.ts` is Edge-only; use `console.warn`.
- **Env access**: use `getEnv()` or the `env` proxy from `lib/env.ts`, never `process.env` directly.
- **Cache**: use `getOrSet()` on the shared cache instances in `lib/cache.ts` for any data fetched from external APIs.
- **Client components**: prefix file with `'use client'`. Error boundary is already at root layout. Never import `lib/supabase/server.ts` or `lib/supabase/admin.ts` in client components.
- **Supabase clients**: use `createSupabaseServerClient()` in Server Components/Route Handlers, `createSupabaseBrowserClient()` in Client Components, `createSupabaseAdminClient()` only for server-side writes that need to bypass RLS.
- **Admin auth**: all `/admin/*` and `/api/admin/*` routes are protected by middleware. The Python proxy at `app/api/admin/[...path]/route.ts` adds `X-Admin-Secret` automatically — do not duplicate this.
- **Settings writes**: always call `svc.patch_group()`, never write to `settings_groups` directly. The service runs safety checks and wraps writes in a transaction.
- **Types**: all shared types in `types/index.ts`.

---

## Running the Project

```bash
npm run dev           # Next.js dev server
npx tsc --noEmit      # type check (must be zero errors)
npm run build         # production build

# Python backend
uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload

# Required env vars (copy .env.example → .env.local)
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
ADMIN_EMAILS=your@email.com        # REQUIRED — blocks all admin access if unset
ADMIN_SECRET=<32-byte hex>         # REQUIRED in prod — openssl rand -hex 32

# First-time setup
# 1. Run database/admin-auth-migration.sql in Supabase SQL Editor
# 2. Create your admin user in Supabase Auth dashboard → Users → Add user
# 3. Set ADMIN_EMAILS to that user's email
```

---

## MCP Tools: code-review-graph

**IMPORTANT: This project has a knowledge graph. ALWAYS use the
code-review-graph MCP tools BEFORE using Grep/Glob/Read to explore
the codebase.** The graph is faster, cheaper (fewer tokens), and gives
you structural context (callers, dependents, test coverage) that file
scanning cannot.

### When to use graph tools FIRST

- **Exploring code**: `semantic_search_nodes` or `query_graph` instead of Grep
- **Understanding impact**: `get_impact_radius` instead of manually tracing imports
- **Code review**: `detect_changes` + `get_review_context` instead of reading entire files
- **Finding relationships**: `query_graph` with callers_of/callees_of/imports_of/tests_for
- **Architecture questions**: `get_architecture_overview` + `list_communities`

Fall back to Grep/Glob/Read **only** when the graph doesn't cover what you need.

### Key Tools

| Tool | Use when |
|------|----------|
| `detect_changes` | Reviewing code changes — gives risk-scored analysis |
| `get_review_context` | Need source snippets for review — token-efficient |
| `get_impact_radius` | Understanding blast radius of a change |
| `get_affected_flows` | Finding which execution paths are impacted |
| `query_graph` | Tracing callers, callees, imports, tests, dependencies |
| `semantic_search_nodes` | Finding functions/classes by name or keyword |
| `get_architecture_overview` | Understanding high-level codebase structure |
| `refactor_tool` | Planning renames, finding dead code |

### Workflow

1. The graph auto-updates on file changes (via hooks).
2. Use `detect_changes` for code review.
3. Use `get_affected_flows` to understand impact.
4. Use `query_graph` pattern="tests_for" to check coverage.
