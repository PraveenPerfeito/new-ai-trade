# CMC.FREE.PLAN.READINESS.1 — CoinMarketCap Free Plan Readiness Audit

**Date:** 2026-06-24  
**Sources audited:** `lib/intelligence/cmc-client.ts` · `lib/intelligence/workers.ts` · `lib/intelligence/cache-groups.ts` · `lib/intelligence/normalizer.ts` · `backend/core/scanner/intelligence_cache.py` · `backend/core/scanner/orchestrator.py` · `lib/market-data/providers/coingecko.ts`

---

## Executive Summary

**Yes — SignalEdge can run on CMC Free with two code changes.**

The critical signal pipeline (BTC regime, breakout, OI, funding, positioning) runs entirely on Binance and is not affected by CMC plan changes. CMC provides the coin universe: market cap filtering, volume filtering, price_change_24h, and binance symbol. The Free plan budget (10,000 credits/month) comfortably covers the two endpoints that remain available.

Two CMC endpoints — `/trending/latest` and `/cryptocurrency/categories` — are restricted on the Free plan. Their workers currently have no fallback and will fail silently, causing those cache keys to go stale. CoinGecko Free provides equivalent data for both; `tickTrending()` and `tickCategories()` need CoinGecko catch blocks added — the same pattern already in `tickListings()`. With this change, CoinGecko Free becomes a full drop-in for CMC Free with zero signal pipeline impact.

---

## PART A — Endpoint Inventory

Six CMC call sites across the codebase. Four TypeScript intelligence workers populate Redis; one Python last-resort fallback; one metadata-only quota sync.

| # | Endpoint | Caller | Frequency | Redis Key | Redis TTL | Credits/Day | Fallback |
|---|----------|--------|-----------|-----------|-----------|-------------|---------|
| 1 | `/cryptocurrency/listings/latest` (limit=100) | `tickListings()` | Every 15 min | `cache:intel:listings` | ttlMs × 6 = 90s | 96 | CoinGecko ✓ (already implemented) |
| 2 | `/global-metrics/quotes/latest` | `tickGlobal()` | Every 30 min | `cache:intel:global` | 180s | 48 | None |
| 3 | `/cryptocurrency/trending/latest` (limit=20) | `tickTrending()` | Every 30 min | `cache:intel:trending` | 180s | 48 | **None ← needs fix** |
| 4 | `/cryptocurrency/categories` (limit=100) | `tickCategories()` | Every 60 min | `cache:intel:categories` | 360s | 24 | **None ← needs fix** |
| 5 | `/key/info` | `tickQuotaSync()` | Every 15 min | N/A (metadata) | — | 0 | N/A |
| 6 | `/cryptocurrency/listings/latest` (limit=200) | `_fallback_cmc_direct()` (Python) | Cache miss only | N/A | — | 0–24 | Itself a fallback |

**Architecture note:** `normalizeListings()` in `lib/intelligence/normalizer.ts` sets `hasFutures: false` for all coins — it is never populated by CMC. FUTURES mode coin selection uses `binance_symbol in futures_symbols` (a Binance API set fetched at scan time). `hasFutures` is a non-field for plan migration purposes.

### Credit Budget Math

| Scenario | Credits/Day | Credits/Month | vs Budget |
|----------|-------------|---------------|-----------|
| Startup plan (all 4 endpoints) | 216 | 6,480 | 2.2% of 300,000 |
| Free plan (listings + global only) | 144 | 4,320 | **43% of 10,000** |
| Free plan budget | — | 10,000 | 2.3× headroom |

---

## PART B — Field Classification

### From `cache:intel:listings` — `/cryptocurrency/listings/latest`

| CMC Field | Python Field | Gate / Effect | Classification |
|-----------|--------------|---------------|----------------|
| `symbol` | `CoinData.symbol` | Coin identity — required for all downstream | **CRITICAL** |
| `quote.USD.market_cap` | `CoinData.market_cap` | Hard gate: rejects if below mode minimum ($200M–$2B) | **CRITICAL** |
| `quote.USD.volume_24h` | `CoinData.volume_24h` | Hard gate: rejects if below mode minimum ($10M–$500M) | **CRITICAL** |
| `quote.USD.percent_change_24h` | `CoinData.price_change_24h` | Crash gate (−20% reject); relative strength setup score ±8–10 pts | **CRITICAL** |
| `symbol` → `"{symbol}USDT"` | `CoinData.binance_symbol` | Kline fetch pair — how Python scanner knows the Binance symbol | **CRITICAL** |
| `cmc_rank` | `CoinData.rank` | TrendScore CMC rank component (0–8 pts) | USEFUL |
| `name` | `CoinData.name` | Signal display name only | DISPLAY ONLY |
| `quote.USD.price` | `CoinData.price` | Seed value — overwritten by Binance kline close price | DISPLAY ONLY |

### From `cache:intel:trending` — `/cryptocurrency/trending/latest`

| CMC Field | Used In | Score Effect | Classification |
|-----------|---------|--------------|----------------|
| Position in trending list | `compute_trend_score()` | Discovery: +30 pts (highest source weight). Rank 1–5 = +20 pts, 6–10 = +15 pts, 11–20 = +8 pts | USEFUL |
| `quote.USD.percent_change_1h` | TrendScore breakout momentum | >3% = +10 pts; >1.5% = +8 pts; >0.5% = +5 pts | USEFUL |

### From `cache:intel:categories` — `/cryptocurrency/categories`

| CMC Field | Used In | Score Effect | Classification |
|-----------|---------|--------------|----------------|
| `avg_price_change` | `analyze_sectors()` + TrendScore | Sector state classification (STRONGEST/ACCELERATING/WEAKENING/OVERCROWDED). TrendScore: +5–15 pts | USEFUL |
| `market_cap_change` | OVERCROWDED detection | avg_price_change >7% AND mcap_change <0.3×avg → OVERCROWDED | USEFUL |
| `coins[]` | Sector membership assignment | Associates each coin with sector for `sector_status` field | USEFUL |
| `name` | WhatsApp alert + IntelligencePanel | "Sector: ACCELERATING" display line only | DISPLAY ONLY |

### From `cache:intel:global` — `/global-metrics/quotes/latest`

All fields are **DISPLAY ONLY**. No field from this endpoint feeds the signal pipeline, a gate, or a scoring function.

| CMC Field | Used In |
|-----------|---------|
| `btc_dominance`, `eth_dominance` | Market tab breadth display |
| `total_market_cap`, `total_volume_24h` | Market breadth display |
| `total_market_cap_yesterday_percentage_change` | Market breadth display |

### Fields that are NOT CMC-sourced

| Field | True Source | Migration impact |
|-------|-------------|-----------------|
| `market_regime` | BTC 4h klines — Binance | Not affected by any CMC plan change |
| `breakout_strength` | 20/30d klines — Binance | Not affected |
| `oi_interpretation` | Binance futures OI API | Not affected |
| `funding_trend` | Binance funding rate history (8h, Redis) | Not affected |
| `positioning_context` | Binance long/short ratio | Not affected |
| `has_futures` | Binance `futures_symbols` set at scan time | Not affected — CMC always sets false, Binance overrides |
| All MTF, RSI, MACD, EMA, ADX, patterns | Binance 1h/4h/1d klines | Not affected |

---

## PART C — Plan Coverage Matrix

### Endpoint availability by plan

| Endpoint | CMC Startup | CMC Free | CoinGecko Free | CoinGecko Equivalent | Field Fidelity |
|----------|-------------|----------|----------------|----------------------|----------------|
| `/listings/latest` | ✓ 96/day | ✓ 96/day | ✓ Already implemented | `/coins/markets` → `_cgFetchListings()` | Full — mcap, volume, price_change_24h all present |
| `/global-metrics` | ✓ 48/day | ✓ 48/day | ✓ Not yet wired | `/global` | Full for display fields |
| `/trending/latest` | ✓ 48/day | ✗ Plan restricted | Partial — not yet wired | `/search/trending` (15 coins) | Partial: symbols/names, no `percent_change_1h`, different ranking algorithm |
| `/categories` | ✓ 24/day | ✗ Plan restricted | Partial — not yet wired | `/coins/categories` | Partial: no `avg_price_change`; `coins[]` limited to top 3 |
| `/key/info` | ✓ 0 credits | ✓ 0 credits | N/A | — | Available on all plans |

### CoinGecko Free rate limit budget

| Metric | Value |
|--------|-------|
| CoinGecko calls needed/month | ~6,480 (listings 2,880 + global 1,440 + trending 1,440 + categories 720) |
| CoinGecko Free limit | ~10,000 calls/month (demo key tier) |
| Peak rate required | <1 call/min (workers run every 15–60 min, never concurrent) |

Add `COINGECKO_API_KEY` to Vercel env vars (free demo key at coingecko.com/api). The existing `CoinGeckoProvider` already reads it via `x-cg-demo-api-key` header.

---

## PART D — What Breaks When the Startup Plan Expires

Without code changes, two workers fail on plan restriction. `assertCmcData()` in `cmc-client.ts` throws on null response. Neither `tickTrending()` nor `tickCategories()` has a catch block — the error sets `status.state = 'error'`, cache key is not refreshed.

### Failures (without code changes)

| Worker | Failure Mode | Cache Outcome | Signal Pipeline Effect | Severity |
|--------|-------------|---------------|----------------------|----------|
| `tickTrending()` | Throws on plan restriction; no catch block | `cache:intel:trending` goes stale after 18 min (180s × 6). `read_trending_coins()` returns `[]` | TRENDING mode loses trending discovery (+30 pts) and CMC rank component (0–30 pts). 1h price change breakout component (0–10 pts) zero. | **Moderate** |
| `tickCategories()` | Throws on plan restriction; no catch block | `cache:intel:categories` goes stale after 36 min (360s × 6). `read_categories()` returns `([], "")` | Sector intelligence disabled: all signals get `sector_status = null`. TrendScore loses sector component (0–15 pts). WhatsApp alerts lose sector line. | **Moderate** |
| `tickListings()` | Already has CoinGecko catch | Falls back to `_cgFetchListings(100)`; cache populates normally | No impact | None |
| `tickGlobal()` | Fails if also restricted | `cache:intel:global` goes stale | Admin dashboard market breadth goes stale — zero signal pipeline impact | Display only |

### What is NOT affected (all Binance)

All of the following run on Binance data and are completely unaffected by any CMC plan change:

- BTC regime classification (BULL/BEAR/SIDEWAYS/HIGH_VOLATILITY/EUPHORIA/CAPITULATION)
- FUTURES mode coin filtering (`hasFutures` via Binance `/fapi/v1/exchangeInfo`)
- `breakout_strength` (EARLY/CONFIRMED/HIGH_MOMENTUM) — 20/30d klines
- `oi_interpretation` (NEW_LONGS/SHORT_COVERING/etc.) — Binance futures OI
- `funding_trend` (RISING/FALLING/STABLE) — Binance funding rate history
- `positioning_context` (EXTREME_SHORT/etc.) — Binance long/short ratio
- MTF, volatility, trend strength, setup scoring
- RSI, MACD, EMA, ADX, candlestick patterns
- Probability gate (empirical WR cohort suppression via Postgres `attribution_snapshots`)
- All 5 active P0 feature flags
- SPOT / FUTURES core signal pipeline

---

## PART E — Migration Plan

Four stages in order of urgency.

---

### Stage 1: CMC Startup → CMC Free (RECOMMENDED — do first)

**Effort:** ~2 hours | **Signal quality impact:** None for SPOT/FUTURES; minor degradation for TRENDING mode

Credit math: listings (96/day) + global (48/day) = 144/day × 30 = **4,320/month** — inside the 10,000/month Free allowance. Trending and categories move to CoinGecko. Pattern is identical to the existing catch block in `tickListings()`.

**Changes required:**

**`lib/intelligence/workers.ts`** — Add CoinGecko catch to `tickTrending()`:
```typescript
export async function tickTrending(): Promise<void> {
  const quota = getQuotaGuard();
  if (!(await quota.canConsume(1))) return;

  let raw: CmcTrendingResponse;
  let usedCmc = true;
  try {
    raw = await fetchTrending(20);
  } catch (cmcErr) {
    log.warn({ err: cmcErr }, 'cmc_trending_plan_restricted_falling_back_to_coingecko');
    raw = await _cgFetchTrending();  // new helper — calls /search/trending
    usedCmc = false;
  }

  const snap = normalizeTrending(raw);
  const redis = getRedis();
  await redis.set(CACHE_GROUPS.trending.redisKey, JSON.stringify(snap), 'PX', CACHE_GROUPS.trending.ttlMs * 6);
  if (usedCmc) await quota.consume(1);
  log.debug({ count: snap.trending.length, source: usedCmc ? 'cmc' : 'coingecko' }, 'worker_trending_refreshed');
}
```

`_cgFetchTrending()` helper — calls CoinGecko `/search/trending`, maps to `CmcTrendingCoin[]` format. Note: CoinGecko returns up to 15 coins (not 20), no `percent_change_1h` — set to 0 in normalizer.

**`lib/intelligence/workers.ts`** — Add CoinGecko catch to `tickCategories()`:
```typescript
export async function tickCategories(): Promise<void> {
  const quota = getQuotaGuard();
  if (!(await quota.canConsume(1))) return;

  let raw: CmcCategoriesResponse;
  let usedCmc = true;
  try {
    raw = await fetchCategories();
  } catch (cmcErr) {
    log.warn({ err: cmcErr }, 'cmc_categories_plan_restricted_falling_back_to_coingecko');
    raw = await _cgFetchCategories();  // new helper — calls /coins/categories
    usedCmc = false;
  }

  const snap = normalizeCategories(raw);
  const redis = getRedis();
  await redis.set(CACHE_GROUPS.categories.redisKey, JSON.stringify(snap), 'PX', CACHE_GROUPS.categories.ttlMs * 6);
  if (usedCmc) await quota.consume(1);
  log.debug({ count: snap.categories.length, source: usedCmc ? 'cmc' : 'coingecko' }, 'worker_categories_refreshed');
}
```

`_cgFetchCategories()` helper — calls CoinGecko `/coins/categories`, maps `market_cap_change_24h` as proxy for `avg_price_change`. Note: `coins[]` limited to top 3 per category in CoinGecko response (vs full list in CMC) — sector membership for mid-ranking coins will be null.

**`lib/intelligence/quota-guard.ts`** — Update `MONTHLY_BUDGET` from `300_000` to `10_000`.

---

### Stage 2: CMC Free → CoinGecko Free (full replacement — optional)

**Effort:** ~4 hours | Removes CMC dependency entirely

If the CMC Free API key is also removed, all four workers need to operate via CoinGecko. `tickListings()` already works this way.

- `tickListings()` — already handles CoinGecko fallback. Gate CMC path on key presence: `if (!process.env.COINMARKETCAP_API_KEY) skip CMC try block`
- `tickGlobal()` — add CoinGecko `/global` primary or fallback. Display-only endpoint — low urgency.
- `tickTrending()` + `tickCategories()` — promote Stage 1 catch blocks to primary path (remove CMC try block)
- `lib/intelligence/cmc-client.ts` — add early-return guard: `if (!process.env.COINMARKETCAP_API_KEY) throw new Error('CMC key not set')`
- `backend/core/scanner/intelligence_cache.py` — remove `_fallback_cmc_direct()` from fallback chain or gate on key presence

---

### Stage 3: Postgres `coins` table staleness cache (contingency)

**Effort:** ~2 hours | Handles CoinGecko outages

The Postgres `coins` table is already populated by `db.upsert_coins()` at the end of every scan. It holds all critical fields: `symbol, binance_symbol, market_cap, volume_24h, price_change_24h, has_futures, rank, last_updated`.

Add `_fallback_postgres(limit)` to `backend/core/scanner/intelligence_cache.py`:
- Query: `SELECT * FROM coins ORDER BY rank LIMIT $1`
- Warn in logs if `last_updated < now() - interval '2 hours'`

Fallback chain becomes: Redis → CMC direct (if key set) → CoinGecko → Postgres cache → empty list.

**Staleness risk:** Market cap data in Postgres is only as fresh as the last successful scan. Acceptable as last resort; not as primary source.

---

### Stage 4: Binance-only universe (emergency)

**Effort:** ~8 hours | Hard blocker: Binance does not expose market cap

Binance `/api/v3/ticker/24hr` provides volume, price_change, symbol — but not market cap. Without mcap, the mode minimum filters ($200M–$2B) cannot be applied to new coins.

Practical approach: use Postgres cache (Stage 3) for `market_cap` on known coins + Binance `/api/v3/ticker/24hr` for volume/price_change. Effectively Stage 3 with Binance volume sorting replacing CoinGecko market ranking for new or unknown coins.

---

## Decision Matrix

| Scenario | Effort | Signal Quality | Monthly Cost | Recommendation |
|----------|--------|---------------|--------------|----------------|
| Keep CMC Startup | Zero | Full | $79/month | Status quo. Justified if budget stays low. |
| CMC Free + CoinGecko fallback (Stage 1) | ~2h | Full for SPOT/FUTURES; degraded for TRENDING | $0 | **Recommended.** TRENDING mode WR=28.2% 30D and probability-gated — degradation has minimal practical impact during monitoring freeze. |
| CoinGecko Free only (Stage 2) | ~4h | Full for SPOT/FUTURES; degraded for TRENDING | $0 | Reasonable if removing CMC dependency entirely. Same quality as Stage 1. |
| Postgres staleness cache (Stage 3) | ~2h | Full for known coins; stale mcap risk for new listings | $0 | Build as insurance only, not primary path. |
| Binance-only (Stage 4) | ~8h | Degraded (no mcap for new coins) | $0 | Not recommended. Use only if all external data APIs fail simultaneously. |

**Recommendation:** Implement Stage 1 after D7 monitoring freeze ends (June 30). Two targeted code changes to `workers.ts` + update quota guard budget constant. No changes to signal pipeline, gates, scoring, or Python backend required.

---

*See also: `docs/archive/CMC_REDIS_TRUTH_1.md` (historical Redis optimization audit)*
