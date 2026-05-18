# Crypto Market Scanner — Gemini Guide

## Project Summary

**Type:** Next.js 14 App Router  
**Purpose:** Real-time AI-powered cryptocurrency trading signal scanner  
**Language:** TypeScript 5 (strict mode)  
**Runtime:** Node.js 20 (all API routes use `runtime = 'nodejs'`)  
**Database:** Supabase (PostgreSQL) via `@supabase/supabase-js`  
**AI validation:** Anthropic Claude Haiku 4.5 via `@anthropic-ai/sdk`  
**Market data:** Binance REST API (no auth required for public endpoints)  
**Coin data:** CoinGecko REST API  
**Alerts:** Telegram Bot API  

---

## Directory Map

```
app/api/          ← Next.js API routes (server-only)
lib/              ← Business logic modules (server-only, except utils)
components/       ← React components (mix of server + client)
types/index.ts    ← All shared TypeScript interfaces
database/         ← SQL schema files for Supabase
docs/             ← PRD.md + DEPLOYMENT.md
middleware.ts     ← Edge runtime: rate limiting, request ID, security headers
```

---

## Core Pipeline (read `lib/scanner.ts`)

The `scanCoin()` function runs 10 sequential gates on each coin. A coin that fails any gate returns `null` immediately — no further processing:

1. Binance 1h + 4h candles
2. Technical indicators (RSI, MACD, EMA, ATR)
3. Multi-timeframe trend confirmation
4. Volatility gate (EXTREME rejected)
5. Trend strength gate (< 30 rejected)
6. Pre-AI setup scoring (< 65 rejected)
7. R:R ratio check (< 2.0 rejected)
8. Risk engine: grade A–F (`lib/risk.ts`)
9. Futures intelligence (`lib/futures-intelligence.ts`) — futures/HC modes
10. Claude Haiku validation (`lib/ai-validator.ts`)

---

## Production Infrastructure Added (2026-05-18)

| Module | Purpose |
|--------|---------|
| `lib/logger.ts` | pino structured logger — `createLogger('name')` |
| `lib/env.ts` | Zod env validation — `getEnv()` / `env` proxy |
| `lib/cache.ts` | TTL cache with `getOrSet()` |
| `lib/retry.ts` | `withApiRetry()` for all external API calls |
| `lib/validate.ts` | `parseBody()` / `parseQuery()` with Zod schemas |
| `app/api/health/` | `GET /api/health` — readiness probe |
| `middleware.ts` | Edge: per-IP rate limit, CORS, security headers |
| `components/error-boundary.tsx` | React error boundary on root layout |
| `Dockerfile` | Multi-stage standalone build |
| `docker-compose.yml` | Production compose with health check |

---

## Rules for Gemini Code Changes

1. **No `console.log`** — use `createLogger('module').info({...}, 'message')`.
2. **No raw `process.env`** — use `getEnv()` from `lib/env.ts`.
3. **Validate API inputs** with `parseBody`/`parseQuery` from `lib/validate.ts`.
4. **Wrap external HTTP calls** with `withApiRetry` from `lib/retry.ts`.
5. **All types** in `types/index.ts`, never inline in components or routes.
6. **Run `npx tsc --noEmit`** after every change — zero errors required.
7. **Client components** must have `'use client'` at line 1. Do not import server-only modules (`lib/logger`, `lib/env`, `lib/supabase`) inside client components.
8. **API response format**: always `{ success: boolean, error?: string, data?: unknown }`.

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
