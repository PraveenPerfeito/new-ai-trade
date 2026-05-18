# Crypto Market Scanner — Agent Guide

## Project Summary

**Type:** Next.js 14 App Router monorepo  
**Purpose:** AI-powered crypto trading signal scanner  
**Language:** TypeScript (strict)  
**Database:** Supabase (PostgreSQL)  
**AI:** Anthropic Claude Haiku 4.5 (signal validation)  
**Data sources:** Binance REST API, CoinGecko API  
**Notifications:** Telegram Bot API  

---

## How the System Works

1. **Scheduler** triggers a scan every N minutes (configurable, default 5).
2. **Scanner** fetches top-100 coins from CoinGecko, applies market-cap/volume filters.
3. For each coin: fetch 1h + 4h Binance klines → run 10-step quality pipeline.
4. Survivors go to **Claude Haiku** for final confidence scoring (0–100).
5. Signals above threshold are saved to **Supabase** and sent via **Telegram**.
6. The **dashboard** polls for signals every 30s and displays them in real time.

---

## 10-Step Signal Pipeline (`lib/scanner.ts`)

```
1.  Fetch 1h + 4h candles (Binance)
2.  Calculate indicators (RSI, MACD, EMA20/50, ATR, volume spike)
3.  Multi-timeframe confirmation — 4h direction, 1h confirmation
4.  Volatility gate — reject EXTREME (ATR > 8% of price)
5.  Trend strength gate — reject if combined score < 30
6.  Setup scoring — pre-AI score ≥ 65 to proceed
7.  ATR-based trade levels — RR ≥ 2.0 required
8.  Risk engine — grade A–F, reject F (CRITICAL violations)
9.  Futures intelligence — funding rate, OI, liq zones, breakout (futures/HC modes only)
10. Claude Haiku validation — final confidence + rejection criteria
```

---

## Critical Files for Any Agent

| Task | Primary files to read |
|------|----------------------|
| Add a new scan filter | `lib/scanner.ts` (scanCoin function) |
| Change risk grading | `lib/risk.ts` |
| Change signal display | `components/dashboard/signals-feed.tsx` |
| Add a new API route | Copy pattern from `app/api/signals/route.ts` |
| Change DB operations | `lib/supabase.ts` |
| Change futures analysis | `lib/futures-intelligence.ts` |
| Change AI prompt | `lib/ai-validator.ts` (validateSignal) |
| Change Telegram format | `lib/telegram.ts` |
| Change indicator calc | `lib/indicators.ts` |

---

## Conventions All Agents Must Follow

- **Logger:** `createLogger('lib/name')` from `lib/logger.ts`. No `console.log`.
- **Env:** `getEnv()` or `env` proxy from `lib/env.ts`. Never raw `process.env`.
- **API validation:** `parseBody(schema)` / `parseQuery(schema)` from `lib/validate.ts`.
- **External APIs:** wrap in `withApiRetry()` from `lib/retry.ts`.
- **Cache:** use `getOrSet()` on instances from `lib/cache.ts`.
- **Error envelope:** all API routes return `{ success: true/false, error?: string }`.
- **Types:** all shared types live in `types/index.ts` — add there, not inline.
- **Client components:** `'use client'` directive required. No pino, no env proxy.
- **Type check:** run `npx tsc --noEmit` after any change. Zero errors required.

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
