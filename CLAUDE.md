# Crypto Market Scanner — Claude Code Guide

## Project Overview

AI-powered crypto trading signal scanner built with **Next.js 14 App Router** + **TypeScript**. Scans top-100 coins, applies a 10-step quality pipeline, and surfaces high-probability trade setups via a glassmorphism dashboard and Telegram alerts.

**Stack:** Next.js 14 · React 18 · TypeScript · Tailwind CSS · Supabase (PostgreSQL) · Anthropic Claude Haiku · Binance API · CoinGecko API · pino · zod

---

## Key Architecture Decisions

1. **10-step pipeline before AI**: MTF confirmation → volatility gate → trend strength → setup scoring → RR check → risk engine → futures intelligence → Claude Haiku. Each gate reduces expensive API calls.
2. **`runtime = 'nodejs'`** on all API routes — Edge runtime not used (need pino + Binance TCP connections).
3. **`globalThis` scheduler singleton** — survives Next.js hot-module replacement without duplicate timers.
4. **Risk engine before AI** — rejects grade-F signals without spending Anthropic tokens.
5. **Futures intelligence** only runs for `futures` and `high_confidence` modes.

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

app/api/
  scanner/run/          ← POST — manual scan trigger
  signals/              ← GET — fetch recent signals
  coins/top100/         ← GET — cached coin list
  health/               ← GET — liveness + readiness probe
  scheduler/            ← status · start · stop
  backtest/             ← run · results · [id] · compare

components/dashboard/
  market-scanner.tsx    ← root orchestrator; polling + state
  signals-feed.tsx      ← signal cards with risk grade + futures badges
  backtest-panel.tsx    ← backtest UI with run/compare/trades tabs
  equity-chart.tsx      ← pure SVG equity curve (no charting lib)

middleware.ts           ← Edge: request ID, per-IP rate limit, security headers, CORS
```

---

## Coding Conventions

- **New API routes**: import `parseBody`/`parseQuery` from `lib/validate`, `createLogger` from `lib/logger`. Return `{ success, error }` envelope.
- **New lib modules**: `createLogger('lib/module-name')` at module level. Wrap external API calls in `withApiRetry`.
- **No `console.log`** — use pino logger (`log.info`, `log.warn`, `log.error`).
- **Env access**: use `getEnv()` or the `env` proxy from `lib/env.ts`, never `process.env` directly.
- **Cache**: use `getOrSet()` on the shared cache instances in `lib/cache.ts` for any data fetched from external APIs.
- **Client components**: prefix file with `'use client'`. Error boundary is already at root layout.
- **Types**: all shared types in `types/index.ts`.

---

## Running the Project

```bash
npm run dev           # dev server
npx tsc --noEmit      # type check
npm run build         # production build
docker compose up --build  # Docker
curl localhost:3000/api/health
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
