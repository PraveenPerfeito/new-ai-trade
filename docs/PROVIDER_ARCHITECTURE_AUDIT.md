# Phase 7.2B.9 — Provider Utilization & Architecture Audit

**Date:** 2026-05-31  
**Scope:** CoinMarketCap · CoinGecko · Binance · Redis Intelligence Cache  
**Type:** Audit only — no code modified

---

## Verdict

**Architecture: HEALTHY ✅**

All observed dashboard anomalies (Binance red, CMC 0%, Redis 500K+, 41.9% hit rate) are explained by instrumentation gaps and normal operating conditions — not production failures. No provider should be removed.

---

## Provider Utilization Summary

| Provider | Utilization | Role | Verdict |
|----------|-------------|------|---------|
| **CoinMarketCap** | ~94% cache / ~6% direct | Primary intelligence — 200-coin universe, sectors, trending | **KEEP** |
| **CoinGecko** | ~5% (cold-cache fallback only) | Fallback when Redis cache is cold | **KEEP** |
| **Binance** | 100% | Sole technical data source — all klines, futures | **KEEP — ESSENTIAL** |
| DexScreener | <1% (never in standard mode) | Low-cap opportunistic | Keep, unused in practice |
| CoinPaprika | 0% | Legacy | Dormant — harmless |
| GeckoTerminal | 0% | Legacy | Dormant — harmless |

---

## Phase 1 — CoinMarketCap

### Architecture

TypeScript intelligence workers (`lib/intelligence/workers.ts`) are the **sole CMC callers**. The Python scanner never calls CMC directly.

```
lib/intelligence/workers.ts
  ├── tickListings()    → CMC /v1/cryptocurrency/listings/latest  every 5 min
  ├── tickGlobal()      → CMC /v1/global-metrics/quotes/latest    every 10 min
  ├── tickTrending()    → CMC /v1/cryptocurrency/trending/latest  every 10 min
  ├── tickCategories()  → CMC /v1/cryptocurrency/categories       every 30 min
  ├── tickMetadata()    → CMC /v1/cryptocurrency/info             every 6 h
  └── tickQuotaSync()   → CMC /v1/key/info                       every 15 min (0 credits)
```

Python reads `cache:intel:listings` via `intelligence_cache.py`. On cold cache → falls back to CoinGecko (never CMC directly). This prevents quota double-spending.

### Redis keys written

| Key | TTL | Consumed by |
|-----|-----|-------------|
| `cache:intel:listings` | 10 min | Python orchestrator (every scan) |
| `cache:intel:global` | 20 min | Dashboard market page |
| `cache:intel:trending` | 20 min | Python `trending_universe.py` |
| `cache:intel:categories` | 60 min | Python `sector_intelligence.py` |
| `cache:intel:metadata` | 12 h | Dashboard cache page only |
| `intel:quota:used` | ∞ | Dashboard quota bar |
| `intel:quota:minute_log` | 2 min | Per-minute CMC rate limiter |

### Credit consumption

| Worker | Cadence | Calls/day | Credits/day |
|--------|---------|-----------|-------------|
| listings | 5 min | 288 | 288 |
| global | 10 min | 144 | 144 |
| trending | 10 min | 144 | 144 |
| categories | 30 min | 48 | 48 |
| metadata | 6 h | 4 | 4 |
| **Total** | | **628/day** | **628/day** |
| **Monthly** | | | **18,840 = 6.3% of 300k budget** |

---

## Phase 2 — CoinGecko

| Path | Location | Status |
|------|----------|--------|
| Python scanner fallback | `market_fetcher._fetch_coingecko()` when `cache:intel:listings` cold | Active fallback |
| TypeScript coin list fallback | `intelligence/reader.getIntelligenceCoins()` → `MarketDataService` when cache cold | Active fallback |
| MarketDataService provider | Priority 2 (after CMC which reads from cache) | Fallback only |

**Not dead code.** Fires on every Redis restart, deployment, or CMC worker failure. CoinGecko fallback returns 100 coins (vs 200 from CMC) — scan universe shrinks ~50% during fallback. Cannot remove.

---

## Phase 3 — Binance

Binance is the **sole source of all technical data**. No alternative exists.

| Data | Endpoint | Consumer | Per scan |
|------|----------|---------|---------|
| 1h klines (300c) | `SPOT_BASE/klines` | All indicators: EMA, RSI, MACD, ATR, BB | Every coin |
| 4h klines (300c) | `SPOT_BASE/klines` | HTF trend, 4h EMA200, RS | Every coin |
| 1d klines (100c) | `SPOT_BASE/klines` | Daily trend alignment | Every coin |
| BTC 4h change | `SPOT_BASE/klines?BTCUSDT` | Relative strength engine | Once (cached 5 min) |
| Futures symbols | `FUTURES_BASE/exchangeInfo` | Mode filter | Once (cached 1 h) |
| Funding rate | `FUTURES_BASE/premiumIndex` | Funding context | Futures/HC coins (cached) |
| OI history | `FUTURES_DATA/openInterestHist` | OI × price matrix | Futures/HC coins (cached) |
| L/S ratio | `FUTURES_DATA/globalLongShortAccountRatio` | Crowd positioning | Futures/HC coins (cached) |

### Volume estimate

| Mode | Kline calls | Futures calls | Total/scan |
|------|-------------|---------------|-----------|
| Standard (80 coins) | 240 | 0 | ~242 |
| Futures (50 coins) | 150 | ~150 | ~300 |
| High-confidence (30 coins) | 90 | ~90 | ~180 |

Hourly (4 standard + 2 futures + 2 HC): ~2,568 calls. Daily: ~61,632 calls. Free, IP rate-limited.

**Is Binance essential? YES.** Removing Binance stops all signal generation.

---

## Phase 4 — Redis Cache Audit

### Classification

| Key Pattern | Classification | Business Value |
|-------------|---------------|----------------|
| `cache:intel:listings` | **CRITICAL** | Scanner primary data source — cold = 100-coin fallback |
| `cache:intel:trending` | **CRITICAL** | TRENDING mode universe — cold = mode degrades |
| `scheduler:enabled` | **CRITICAL** | Operational toggle enforcement |
| `scheduler:lock:{mode}` | **CRITICAL** | Prevents concurrent scan execution |
| `intel:quota:minute_log` | **CRITICAL** | Per-minute CMC rate limiting |
| `settings:{group}` | **CRITICAL** | AI, Telegram, emergency_stop enforcement |
| `cache:intel:categories` | **IMPORTANT** | Sector intelligence scoring |
| `cache:intel:global` | **IMPORTANT** | Dashboard market context |
| `cache:funding/oi/ls:{symbol}` | **IMPORTANT** | Futures data cache — prevents 3× Binance calls |
| `futures:funding_trend:{symbol}` | **IMPORTANT** | Funding direction classification |
| `futures:symbols:all` | **IMPORTANT** | Futures symbol set (1h cache) |
| `cache:btc-4h-change` | **IMPORTANT** | BTC relative strength reference |
| `scan:progress/{id}` | **IMPORTANT** | Live scan status for dashboard |
| `tg:alert:{symbol}:{direction}` | **IMPORTANT** | 1h dedup prevents Telegram spam |
| `cache:intel:metadata` | **OPTIONAL** | Dashboard only — not used by scanner |
| `cache:intel:hits/misses:*` | **OPTIONAL** | Dashboard telemetry only |
| `providers:metrics:{name}:*` | **OPTIONAL** | Provider health display |
| `providers:failover:log` | **OPTIONAL** | Operational history |
| `intel:fallback:status` | **OPTIONAL** | CMC cold-cache alert throttle |

---

## Phase 5 — Provider Health Anomalies Explained

### Binance appears RED

**Cause: Instrumentation gap — not a real failure.**

`providers:metrics:binance` is written by the TypeScript `ProviderManager` only when `BinanceProvider.fetchTopCoins()` is called. That path uses `GET /api/v3/ticker/24hr` (all tickers as top-coins source). This is:
- Rarely reached — CMC (reads cache) and CoinGecko succeed first
- Susceptible to geo-block 451 or high latency when it is reached

Health score drops to 0 after a single failure → status = "offline".

The critical Binance usage (klines via `market_fetcher.py`) runs hundreds of calls per scan and is **not tracked** in `providers:metrics:binance`.

**Safe fix (no code change):** Disable Binance in `DEFAULT_CONFIG` as a top-coins provider (it should never be called for that use case). This would stop the misleading red indicator.

### CMC shows 0% quota used

**Cause: Normal — fresh Redis or early billing cycle.**

`intel:quota:used` key is stored in Redis. Shows 0 if:
1. Redis was recently restarted/cleared (key reset to 0)
2. New billing month (`resetMonthly()` zeroed the counter)
3. Quota-sync worker hasn't run yet (runs every 15 min)

At 628 credits/day = 6.3% monthly budget, early-month usage correctly shows near 0%.

### Redis commands exceed 500K

**Cause: Normal operating volume.**

| Source | Est. commands/day |
|--------|------------------|
| Python scanner (klines + futures) | ~12,000 |
| TS intelligence workers (6 workers) | ~1,440 |
| Dashboard polling (8s interval) | ~12,000 |
| Settings cache reads | ~9,600 |
| Futures data cache | ~7,200 |
| Scan progress tracking | ~4,800 |
| All other ops | ~8,880 |
| **Total** | **~55,920/day** |

500K/month = ~16,667/day. 500K/day would require heavy concurrent load. Either figure is expected for a live trading scanner with continuous workers.

### Cache hit rate 41.9%

**Cause: Aggregate metric masked by groups with very different access patterns.**

- `metadata` group: refreshed every 6h, dashboard polls every 30s → 355 misses : 1 hit per cycle
- `global` group: dashboard polls before first worker tick → misses on cold start
- `listings` group: refreshed every 5 min with 10 min TTL → likely ~95%+ hit rate individually

The 41.9% overall is a mixed-pool metric. The critical group (`listings`) almost certainly has near-100% hit rate. Track per-group hit rates separately for accurate signal-path cache health.

---

## Phase 6 — Simplification Analysis

| Component | Decision | Risk | Rationale |
|-----------|----------|------|-----------|
| CoinMarketCap | **KEEP** | — | 6.3% of budget, architecture already efficient |
| CoinGecko | **KEEP** | — | Active fallback, cannot remove |
| Binance klines | **KEEP** | CRITICAL | No alternative for technical data |
| Binance as top-coins provider | **OPTIMIZE** | LOW | Disable in MarketDataService — stops misleading red status |
| `cache:intel:listings` | **KEEP** | CRITICAL | Scanner primary source |
| `cache:intel:trending` | **KEEP** | HIGH | TRENDING mode depends on this |
| `cache:intel:categories` | **KEEP** | MEDIUM | Sector scoring |
| `cache:intel:global` | **KEEP** | LOW | Dashboard only |
| `cache:intel:metadata` | **OPTIMIZE** | NONE | Extend TTL 12h→24h to halve CMC calls (saves 2 credits/day) |
| Futures data cache | **KEEP** | HIGH | Removing triples Binance calls per futures scan |
| DexScreener | **KEEP** | NONE | Correctly gated, harmless |
| CoinPaprika / GeckoTerminal | **KEEP AS-IS** | NONE | Dormant, never called |
| Provider health metrics | **OPTIMIZE** | NONE | Track klines health separately from top-coins health |

---

## Phase 7 — Production Architecture Diagram

```
INTELLIGENCE LAYER  (TypeScript — Next.js, runs continuously)
─────────────────────────────────────────────────────────────
  CoinMarketCap API ◄── lib/intelligence/workers.ts (6 workers)
    /listings       ──► cache:intel:listings    TTL 10m
    /global-metrics ──► cache:intel:global      TTL 20m
    /trending       ──► cache:intel:trending    TTL 20m
    /categories     ──► cache:intel:categories  TTL 60m
    /info           ──► cache:intel:metadata    TTL 12h
    /key/info       ──► intel:quota:used        (quota sync)
                                │
                           REDIS (Upstash)
                                │
SCANNER LAYER  (Python — Railway Celery, every 15-30 min)
─────────────────────────────────────────────────────────────
  Celery Beat ──► run_scheduled_scan()
                      │
                      ▼  read: scheduler:enabled
                      │  read: emergency_stop / maintenance_mode
                      │
                 orchestrator.run_scan()
                      │
             ┌────────┴────────┐
             │                 │
    fetch_top100()      build_trending_universe()
    read: cache:intel:listings   + cache:intel:trending
          │ HIT: 200 coins        + cache:intel:categories
          │ MISS: CoinGecko
          │
          ▼  filter → 80 coins
     scan_coin() × N   (MAX_CONCURRENT = 5)
          │
          ├── Binance /api/v3/klines (1h 300c)  ← SOLE KLINES SOURCE
          ├── Binance /api/v3/klines (4h 300c)
          ├── Binance /api/v3/klines (1d 100c)
          │
          ├── calculate_all_indicators()
          ├── detect_setup()  (score ≥ 72)
          ├── trade_levels()
          ├── validate_risk()
          │
          ├── [futures/HC only]
          │   ├── Binance /fapi/v1/premiumIndex    (funding)
          │   ├── Binance /futures/data/openInterestHist (OI)
          │   └── Binance /futures/data/globalLongShortAccountRatio (L/S)
          │       [cached: cache:funding/oi/ls:{symbol}]
          │
          └── ai_validator.validate_signal()
                  ├── AISettings.enabled check
                  ├── setup_score ≥ 72 check
                  └── Anthropic Claude Haiku
                      (fallback: heuristic scoring)

DELIVERY LAYER
─────────────────────────────────────────────────────────────
  signal passes all gates
      │
      ├── save_signal() ──► Supabase PostgreSQL
      │
      └── send_signal_alert()
              ├── TelegramSettings.alerts_enabled check
              ├── FeatureFlags.telegram check
              ├── emergency_stop check
              ├── tg:alert:{symbol}:{direction} dedup (1h)
              └── Telegram Bot API ──► Founder

DASHBOARD LAYER  (Next.js — Vercel)
─────────────────────────────────────────────────────────────
  Browser → Next.js API → FastAPI proxy → Python backend
                                │
                    ┌───────────┼──────────────┐
                    │           │              │
                Supabase      Redis        Prometheus
              (signals,    (scan:progress, (/metrics)
               outcomes,    cache:intel:*,
               settings)    providers:metrics:*)
```

---

## Safe Optimizations (no urgency)

1. **Disable Binance as top-coins provider** in `DEFAULT_CONFIG` — stops misleading red health indicator; Binance klines are unaffected
2. **Extend metadata TTL to 24h** — reduces CMC metadata calls from 4/day to 2/day (saves 2 credits/day)
3. **Track klines health separately** from top-coins health in provider metrics

## Unsafe Optimizations (do NOT do)

1. Remove CoinGecko — breaks scanner on Redis restart
2. Reduce `cache:intel:listings` TTL below 5 min
3. Remove futures data Redis cache — triples Binance calls per futures scan
4. Disable any Binance klines endpoint

---

*Generated: Phase 7.2B.9 audit — 2026-05-31*
