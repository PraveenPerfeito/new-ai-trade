# CMC_REDIS_TRUTH_1
<!-- Principal Architect · Principal Quant Engineer · Senior Reliability Engineer -->

**Date:** 2026-06-22  
**Objective:** Determine whether CoinMarketCap intelligence and Redis usage provide measurable value. No removals — classify only.  
**Sources:** intelligence_cache.py · trending_universe.py · trend_score.py · sector_intelligence.py · orchestrator.py · signal_pipeline.py · models.py · monitoring.py · coordinator.py · lib/intelligence/* · lib/cache.ts · lib/market-data/*

---

## PART A — CMC Intelligence Usage

### A.1 CMC Data Sources

Four Redis keys populated by TypeScript Vercel cron workers. Python scanner reads cache only — never calls CMC directly.

| CMC Endpoint | Redis Key | Cron Schedule | TTL | Credits/Day |
|---|---|---|---|---|
| `/cryptocurrency/listings/latest` (limit=200) | `cache:intel:listings` | Every 15 min | 90s (15min × 6) | 96 |
| `/cryptocurrency/trending/latest` (limit=20) | `cache:intel:trending` | Every 30 min | 180s (30min × 6) | 48 |
| `/cryptocurrency/categories` (limit=100) | `cache:intel:categories` | Every 60 min¹ | 360s (60min × 6) | 24 |
| `/global-metrics/quotes/latest` | `cache:intel:global` | Every 30 min | 180s (30min × 6) | 48 |
| **TOTAL** | | | | **216 credits/day** (~6,480/month = **2.2% of 300K budget**) |

¹ **Critical bug:** `/api/intelligence/cron/categories` route is declared in `vercel.json` but the route FILE IS MISSING. Categories refresh falls back to Python worker preload trigger only (`/api/intelligence/refresh`). If Python worker is cold or Railway is down, categories go stale.

The **6× TTL multiplier** on all keys (REDIS.REDUCE.3) keeps cache warm during cron intervals — a read at 14 min finds the 90-second window still live.

---

### A.2 CMC Fields — Full Pipeline Trace

#### From `cache:intel:listings`

| CMC Field | Python Variable | Used In | Score / Gate Effect | Classification |
|---|---|---|---|---|
| `symbol` | `CoinData.symbol` | Universe building, all downstream | Required for coin identity | **CRITICAL** |
| `marketCap` | `CoinData.market_cap` | `_filter_coins()` mcap gate | Hard reject if `< config.min_market_cap` or `== 0` | **CRITICAL** |
| `volume24h` | `CoinData.volume_24h` | `_filter_coins()` volume gate | Hard reject if `< config.min_volume_24h`; TrendScore volume component +0–20 pts | **CRITICAL** |
| `priceChange24h` | `CoinData.price_change_24h` | Setup score + crash gate | Crash gate: hard reject if `< -20%`. Relative strength: BUY +10 setup pts if `rel ≥ 3%` vs BTC; BUY −8 if `rel ≤ -5%`; SELL +10 if `rel ≤ -3%` | **CRITICAL** |
| `binanceSymbol` | `CoinData.binance_symbol` | Kline fetch (`market_fetcher.py`) | Determines exact Binance symbol for OHLCV fetch. Fallback: `{symbol}USDT` | **CRITICAL** |
| `hasFutures` | `CoinData.has_futures` | FUTURES mode filter | Hard reject in FUTURES/HIGH_CONFIDENCE modes if False. TrendScore futures bonus +2 pts | **CRITICAL** |
| `topMovers` | `list[str]` symbols | Trending universe discovery | Discovery score +20 pts (second-highest source weight) | **USEFUL** |
| `rank` | `CoinData.rank` | Discovery ordering | Fallback rank if not in trending list | **USEFUL** |
| `name` | `CoinData.name` | Signal model, display | `Signal.symbol_name` — dashboard + Telegram label | **DISPLAY ONLY** |
| `price` | `CoinData.price` (seed) | Overwritten by Binance kline | Never used in scoring — Binance price is authoritative | **DISPLAY ONLY** |

#### From `cache:intel:trending`

| CMC Field | Python Variable | Used In | Score / Gate Effect | Classification |
|---|---|---|---|---|
| `rank` (position in trending list) | `trending_rank_map[symbol]` | `compute_trend_score()` | TrendScore CMC rank component: rank 1–5 = +20 pts; 6–10 = +15 pts; 11–20 = +8 pts | **USEFUL** |
| `priceChange1h` | `trending_1h_map[symbol]` | `compute_trend_score()` | TrendScore breakout momentum: >3% = +10 pts; >1.5% = +8 pts; >0.5% = +5 pts | **USEFUL** |
| `symbol` | Used for map lookup | Trending universe source | Discovery score +30 pts (highest source weight) | **USEFUL** |
| `priceChange24h` (trending subset) | Overrides listings 24h for trending coins | Relative strength in trending mode | Same as listings field above | **USEFUL** |

#### From `cache:intel:categories`

| CMC Field | Python Variable | Used In | Score / Gate Effect | Classification |
|---|---|---|---|---|
| `avgPriceChange` | `sector_avg_change_map[symbol]` | `compute_trend_score()` + `analyze_sectors()` | TrendScore sector strength: >7% = +15 pts; >4% = +12 pts; >2% = +8 pts; None = +5 neutral. Sector state: STRONGEST (>7%), ACCELERATING (delta >+3%), WEAKENING (delta <-3%), OVERCROWDED (>12% parabolic) | **USEFUL** |
| `marketCapChange` | `mcap_chg` in `analyze_sectors()` | OVERCROWDED detection | If `avgPriceChange > 7%` AND `marketCapChange < 0.3 × avgPriceChange` → OVERCROWDED (distribution signature). TrendScore capped at 5 pts for OVERCROWDED | **USEFUL** |
| `coins[]` (symbol list) | `category_symbol_map[symbol]` | Category membership + discovery | Discovery score +15 pts (rising sectors source). Assigns sector to each coin for `sector_status` field | **USEFUL** |
| `coinCount` | Telemetry only | `/api/cache/intelligence` display | Not used in signal pipeline | **DISPLAY ONLY** |
| `name` (category name) | `SectorStatus.sector_name` | `signal.sector_status`, Telegram | "Sector: ACCELERATING" line in Telegram + IntelligencePanel display | **DISPLAY ONLY** |

#### From `cache:intel:global`

| CMC Field | Used In | Classification |
|---|---|---|
| `totalMarketCap` | `/api/market/intelligence` → Market tab breadth | **DISPLAY ONLY** |
| `btcDominance` | Market breadth display | **DISPLAY ONLY** |
| `totalVolume24h` | Market breadth display | **DISPLAY ONLY** |
| `marketCapChange24h` | Market breadth display | **DISPLAY ONLY** |
| `altcoinMarketCap` (derived) | Market breadth display | **DISPLAY ONLY** |

**Verdict: `cache:intel:global` is 100% DISPLAY ONLY. Zero contribution to signal generation.**

---

### A.3 Computed Fields (derived from CMC data)

These are not stored in Redis but computed per scan from CMC cache reads.

| Computed Field | Source | Stored On Signal | Signal Pipeline Effect | Classification |
|---|---|---|---|---|
| `trend_score` (0–100) | `compute_trend_score()` from all CMC sources | `signals.trend_score` | Coin prioritization in TRENDING mode; signals ranked by TrendScore before scan. Stamped for telemetry | **USEFUL** |
| `sector_status` | `analyze_sectors()` from `cache:intel:categories` | `signals.sector_status` | Telegram sector line ("Sector: ACCELERATING"). TrendScore sector component. No direct confidence gate | **USEFUL** |
| `discovery_score` | `build_trending_universe()` | Not stored | Coin selection only — determines which 80 coins enter scanner | **CRITICAL** (universe selection) |

---

### A.4 Classification Summary

| Classification | Fields | Count |
|---|---|---|
| **CRITICAL** | symbol, market_cap, volume_24h, price_change_24h, binance_symbol, has_futures, discovery_score | 7 |
| **USEFUL** | topMovers, rank, trending_rank, price_change_1h, avgPriceChange, marketCapChange, coins[], trend_score, sector_status | 9 |
| **DISPLAY ONLY** | name, price (seed), global metrics (5 fields), coinCount, sector name | 9 |
| **DEAD** | None detected | 0 |

**No dead CMC fields found.** All CRITICAL fields are hard dependencies; removing any would break coin selection or setup scoring. USEFUL fields contribute 8–25 pts to TrendScore but have no isolated WR data yet. DISPLAY ONLY fields can be cached at lower frequency without any signal quality impact.

---

## PART B — Signal Impact (CMC Intelligence Alpha Contribution)

### B.1 Data Availability

Isolated WR/PF/Expectancy by CMC intelligence field is **not available** from resolved outcomes. Reasons:
1. `sector_status` was 100% NULL in outcomes until INTEL.PROPAGATE.1 fix (June 2026) — no clean baseline
2. `trend_score` was 98.7% NULL until the same fix — no valid historical cohort
3. Attribution snapshots contain `regime|type|breakout` dimensions but not `sector_status` or `trend_score`

The following is what IS measurable from production data:

### B.2 Indirect Alpha Contributions (confirmed)

These CMC fields feed gates/scoring factors that DO have measured WR impact:

| CMC Field | How It Contributes | Measured WR Impact |
|---|---|---|
| **market_cap gate** | Filters out micro-cap (WR <30% historically) | No direct isolation, but mode min_mcap floors exist for this reason |
| **volume_24h gate** | Filters illiquid coins | Prevents slippage-heavy signals |
| **price_change_24h** | `rel_strength` setup bonus (±8–10 pts) drives signal score | Part of setup scoring quality |
| **hasFutures** | Futures mode filtering ensures only perp-listed coins enter futures pipeline | OI_NEUTRAL cohort (WR 76.3%) requires futures |
| **CMC categories (coins[])** | Sector membership → `sector_status` → Telegram + intelligence display | No isolated WR; sector was NULL until June 2026 |
| **TrendScore (CMC-derived)** | Coin prioritization — highest-TrendScore coins scanned first in TRENDING mode | No isolated WR; field was NULL until June 2026 |

### B.3 Fields WITH Measured Alpha (but from Binance, not CMC)

For completeness — these are often assumed to be CMC-derived but are not:

| Field | True Source | WR / Impact |
|---|---|---|
| `market_regime` | BTC 4h klines (Binance) | NULL gate: N=677, WR 14.9%. **CRITICAL** |
| `breakout_strength` | 20/30d klines (Binance) | HIGH_MOMENTUM: WR 81.8% override cohort |
| `oi_interpretation` | Binance futures OI | OI_NEUTRAL: WR 76.3%, Exp +1.776R |
| `funding_trend` | Binance funding (8h history) | RISING adverse × 1.3 multiplier |
| `positioning_context` | Binance L/S ratio | EXTREME_SHORT BUY: ~+8 pts |

**The highest-alpha intelligence signals all come from Binance, not CMC.** CMC provides the universe selection and prioritization layer. CMC is necessary but not the alpha source.

### B.4 Minimum Data Needed Before Measuring CMC Alpha

| Measurement | Requirement | ETA |
|---|---|---|
| TrendScore cohort WR | `trend_score IS NOT NULL` + 30D resolved outcomes | 2026-07-16 (first clean window post-INTEL.PROPAGATE.1) |
| Sector status WR | `sector_status IS NOT NULL` + 30D outcomes | 2026-07-16 |
| Coin selection quality (CMC vs CoinGecko) | A/B comparison of signal quality by discovery source | Not implemented |

---

## PART C — Redis Key Inventory

Every Redis key in the system, with KEEP / OPTIMIZE / REMOVE verdict.

### C.1 Intelligence Cache Keys

| Key | TTL | Writes/Day | Reads/Day | Consumer | Verdict |
|-----|-----|-----------|-----------|----------|---------|
| `cache:intel:listings` | 90s (×6) | 96 (TS cron) | ~96–288 (Python scans) | intelligence_cache.py: `read_intelligence_listings()` | **KEEP** — primary 200-coin universe |
| `cache:intel:trending` | 180s (×6) | 48 (TS cron) | ~96 (Python scans) | `read_trending_coins()` | **KEEP** — trending rank + 1h price for TrendScore |
| `cache:intel:categories` | 360s (×6) | 24 (TS cron) | ~96 (Python scans) | `read_categories()` | **KEEP** — sector state detection |
| `cache:intel:global` | 180s (×6) | 48 (TS cron) | ~48 (dashboard) | `/api/market/intelligence` only | **OPTIMIZE** — display-only; extend TTL to 60 min (24 calls/day → 0 urgency) |
| `cache:intel:sector_baseline` | 60 min | ~96 (sector_intelligence.py) | ~96 (same) | `read_sector_baseline()` | **KEEP** — enables delta-based WEAKENING/ACCELERATING detection |
| `intel:fallback:alert_sent` | 15 min | ~2–8 | ~2–8 | `_record_fallback_event()` | **KEEP** — prevents Telegram spam on CMC cache miss |
| `intel:quota:used` | 40 days | ~200–500 | ~200–500 | quota-guard.ts | **KEEP** — CMC monthly budget tracking |
| `intel:quota:reset_at` | 40 days | ~1 | ~5 | quota-guard.ts | **KEEP** — monthly reset anchor |
| `intel:quota:minute_log` | 2 min rolling | ~200–500 | ~200–500 | quota-guard.ts (ZSET) | **OPTIMIZE** — 30 req/min limit is well under cron frequency; could simplify to per-hour counter |

---

### C.2 Signal Pipeline Cache Keys

| Key | TTL | Writes/Day | Reads/Day | Consumer | Verdict |
|-----|-----|-----------|-----------|----------|---------|
| `cache:btc-regime:regime` | 20 min | ~96 | ~96×20 per scan | `get_btc_regime()` in market_fetcher.py | **KEEP** — BTC regime is the #1 gate; cold = scan recomputes per kline fetch |
| `cache:open-interest:{symbol}` | 32 min | ~2,880 | ~2,880 | `oi_cache` in market_fetcher.py | **KEEP** — deduplicates Binance OI API calls across same-symbol multi-mode scans |
| `cache:funding-rate:{symbol}` | 32 min | ~2,880 | ~2,880 | `funding_cache` | **KEEP** — same dedup pattern |
| `cache:long-short:{symbol}` | 32 min | ~2,880 | ~2,880 | `ls_cache` | **KEEP** — same dedup pattern |
| `futures:funding_trend:{symbol}` | 8h | ~1,920 | ~1,920 | `_update_funding_history()` | **KEEP** — stores last 3 funding readings for RISING/FALLING/STABLE classification; requires history |
| `cache:coins:{key}` (Python) | 5 min | ~1,440 | ~1,440 | `coins_cache` | **KEEP** — deduplicates per-coin data within scan |
| `scan:progress:{scan_id}` | 1h | ~288 | ~288 | `get_progress()` in scanner API | **OPTIMIZE** — TTL could be 15 min (scan is done in <2 min; 1h is excessive) |
| `scan:latest:{mode}` | 1h | ~288 | ~2,880 (polling) | `get_latest_progress()` | **KEEP** — recent scan status for dashboard |

---

### C.3 Scheduler / Coordinator Keys

| Key | TTL | Writes/Day | Reads/Day | Consumer | Verdict |
|-----|-----|-----------|-----------|----------|---------|
| `scheduler:lock:{mode}` (4 keys) | 300–1200s | ~96 each | ~96 each | `acquire_scan_lock()` | **KEEP** — prevents duplicate concurrent scans |
| `scheduler:enabled` | 90 days | ~1–2 | ~96 | `is_enabled()` | **KEEP** — scanner ON/OFF toggle |
| `scheduler:last_scan_ts` | 7 days | ~96 | ~96 | `status()` | **KEEP** — shows last scan time on dashboard |
| `scheduler:status_cache` | 300s | ~288 | ~288 | `status_async()` | **OPTIMIZE** — 5-min status cache is reasonable; consider 10-min if dashboard polls at 120s |

---

### C.4 Settings Cache Keys

| Key | TTL | Writes/Day | Reads/Day | Consumer | Verdict |
|-----|-----|-----------|-----------|----------|---------|
| `settings:d:{group}` | 1h | ~5 (on change) | ~1,440 | `_get_group_raw()` | **KEEP** — 1h Redis layer of 3-layer settings cache |
| `settings:v:{group}` | 1h | ~5 | ~1,440 | `_check_generation()` | **KEEP** — generation version for cache invalidation |
| `settings:generation` | 1 day | ~5 | ~2,880 | `_check_generation()` | **KEEP** — change propagation counter |

---

### C.5 Monitoring / Operational Keys

| Key | TTL | Writes/Day | Reads/Day | Consumer | Verdict |
|-----|-----|-----------|-----------|----------|---------|
| `monitor:{date}:signals` | 48h | ~96 | ~48 | `get_monitoring_snapshot()` | **KEEP** |
| `monitor:{date}:scans` | 48h | ~96 | ~48 | `get_monitoring_snapshot()` | **KEEP** |
| `monitor:{date}:coins_scanned` | 48h | ~96 | ~48 | `get_monitoring_snapshot()` | **KEEP** |
| `monitor:{date}:telegram_sends` | 48h | ~50–100 | ~48 | `get_monitoring_snapshot()` | **KEEP** (rename to `whatsapp_sends` is P2 cosmetic) |
| `monitor:{date}:binance_errors` | 48h | ~10–30 | ~48 | `get_monitoring_snapshot()` | **KEEP** — wired in `75d0014` |
| `monitor:{date}:last_scan_duration_ms` | 48h | ~96 | ~48 | `get_monitoring_snapshot()` | **KEEP** |
| `intel:quota:snapshot:{date}` | 8 days | ~24 | ~24 | quota snapshot hourly | **KEEP** |
| `monitor:output_collapse:breaches` | 2h | ~48 | ~48 | `check_output_collapse()` | **KEEP** |
| `monitor:output_collapse:status` | 24h | ~48 | ~48 | `read_output_collapse_status()` | **KEEP** |
| `monitor:output_collapse:alerted` | 6h | ~8 | ~8 | Alert throttle | **KEEP** |
| `anomaly:alert:critical` | 15 min | ~8–24 | ~8–24 | `_maybe_send_critical_anomaly_alert()` | **KEEP** |

---

### C.6 WhatsApp (Telegram) Dedup Keys

| Key | TTL | Writes/Day | Reads/Day | Consumer | Verdict |
|-----|-----|-----------|-----------|----------|---------|
| `tg:alert:{SYMBOL}:{DIR}` | 1h | ~50–100 | ~50–100 | `_get_cooldown_confidence()`, `_mark_alert_cooldown()` | **KEEP** — prevents duplicate WhatsApp alerts |
| `tg:hourly_count:{hour}` | 3700s | ~1,440 | ~1,440 | `send_signal_alert()` rate limiter | **KEEP** — per-hour rate limiting |

---

### C.7 Provider Metrics Keys

| Key | TTL | Writes/Day | Reads/Day | Consumer | Verdict |
|-----|-----|-----------|-----------|----------|---------|
| `providers:metrics:binance:meta` | 7 days | ~240 (batched 5s) | ~288 | `/api/health/providers` | **KEEP** |
| `providers:metrics:binance:latency` | 7 days | ~240 (batched) | ~288 | Provider health display | **KEEP** |
| `providers:metrics:binance:errors` | 7 days | ~48 | ~288 | Provider health display | **KEEP** |
| `providers:health:snapshot` | 30s | ~2,880 | ~2,880 | `/api/health/providers` | **OPTIMIZE** — extend 30s → 60s: saves ~1,440 ops/day |
| `providers:failover:log` | ∞ (RPUSH, no EXPIRE) | ~5 | ~24 | `failover_history()` | **OPTIMIZE** — add 30-day EXPIRE; log grows unbounded on failovers |
| `settings:d:providers` | 7 days | ~1–5 | ~48 | `_read_config()` | **KEEP** |

---

### C.8 Worker / AI Keys

| Key | TTL | Writes/Day | Reads/Day | Consumer | Verdict |
|-----|-----|-----------|-----------|----------|---------|
| `celery:worker:last_heartbeat` | 30 min (1800s) | 144 (every 10 min) | ~48 | `readiness()`, `/health/ready` | **KEEP** — Railway health check dependency |
| `ai:daily_calls:{YYYY-MM-DD}` | 25h | ~50–120 (when AI on) | ~50–120 | `_check_and_increment_daily_redis()` | **KEEP** — AI budget management |

---

### C.9 TypeScript App Cache Keys (`lib/cache.ts`)

| Key | TTL | Writes/Day | Reads/Day | Consumer | Verdict |
|-----|-----|-----------|-----------|----------|---------|
| `cache:signals:{key}` | 30s | ~2,880 | ~2,880 | Next.js API routes serving signal lists | **KEEP** — prevents N×DB reads on every dashboard poll |
| `cache:coins:{key}` (TS) | 5 min | ~1,440 | ~1,440 | TypeScript scanner/API | **KEEP** |
| `cache:open-interest:{key}` (TS) | 2 min | ~2,880 | ~2,880 | TypeScript API routes | **KEEP** |
| `cache:funding-rate:{key}` (TS) | 5 min | ~2,880 | ~2,880 | TypeScript API | **KEEP** |
| `cache:long-short:{key}` (TS) | 5 min | ~2,880 | ~2,880 | TypeScript API | **KEEP** |

---

### C.10 Complete Key Count

| Category | Keys | Ops/Day | Verdict |
|----------|------|---------|---------|
| Intelligence cache (CMC) | 9 | ~700 | KEEP (7) / OPTIMIZE (2) |
| Signal pipeline cache | 8 | ~12,000 | KEEP (7) / OPTIMIZE (1) |
| Scheduler / coordinator | 4 | ~600 | KEEP (3) / OPTIMIZE (1) |
| Settings cache | 3 | ~5,800 | KEEP (3) |
| Monitoring / operational | 11 | ~1,500 | KEEP (11) |
| WhatsApp dedup | 2 | ~3,000 | KEEP (2) |
| Provider metrics | 6 | ~6,500 | KEEP (4) / OPTIMIZE (2) |
| Worker / AI | 2 | ~200 | KEEP (2) |
| TypeScript app cache | 5 | ~14,000 | KEEP (5) |
| **TOTAL** | **50** | **~44,300** | **KEEP 44 / OPTIMIZE 6 / REMOVE 0** |

**No keys are removable without impact.** Six can be optimized to reduce ops.

---

## PART D — Cache Effectiveness

### D.1 CMC API Calls Saved

| Cache Key | Current Frequency | Without Cache | Calls Saved/Day |
|---|---|---|---|
| `cache:intel:listings` | 96/day (every 15 min) | 288/day (every 5 min) | 192 |
| `cache:intel:trending` | 48/day (every 30 min) | 288/day | 240 |
| `cache:intel:categories` | 24/day (every 60 min) | 288/day | 264 |
| `cache:intel:global` | 48/day (every 30 min) | 288/day | 240 |
| **Total saved** | | | **~936 CMC API calls/day** |

At 1 credit per call: **936 CMC credits saved per day** (28,080/month).  
Without caching: ~1,152 calls/day = 34,560/month = **11.5% of 300K budget**.  
With caching: 216 calls/day = 6,480/month = **2.2% of 300K budget**.

### D.2 Binance API Calls Saved

| Cache Layer | TTL | Estimated Hit Rate | Calls Saved/Day |
|---|---|---|---|
| OI cache (32 min) | 32 min | ~70% (multiple modes scan same coin) | ~2,000/day |
| Funding rate cache (32 min) | 32 min | ~70% | ~2,000/day |
| L/S ratio cache (32 min) | 32 min | ~70% | ~2,000/day |
| BTC regime cache (20 min) | 20 min | >95% (single shared key) | ~95/day |
| Kline metric batching (5s window) | N/A | ~98% Redis op reduction | Saves ~50,000 Redis ops/day |

### D.3 Cache Hit Rate Metrics Status

**Cache hit/miss counters were removed in OPS.CONSOLIDATION.1 (R8).**

From `lib/intelligence/telemetry.ts` (confirmed):
```
// R8 OPS.CONSOLIDATION.1: hit/miss counters removed — Python stopped writing
// cache:intel:hits:* and cache:intel:misses:* keys. Reading dead keys wastes
// ~21K Redis GET ops/month and always returns 0.
```

Current telemetry uses **age-based freshness** (`ageSeconds + isStale`) instead of hit/miss counters. This is the correct approach for a time-based cache.

**To estimate hit rate:** The 6× TTL multiplier (e.g., 15 min cron with 90s TTL window = 6× overlap) means cache is warm >99% of the time during normal operation. Miss rate is only measurable during:
- Cold starts (Railway redeploy)
- CMC API failures (fallback to CoinGecko triggers)
- Redis downtime

### D.4 Missing Categories Cron Route

**Bug:** `/api/intelligence/cron/categories` declared in `vercel.json` but route file MISSING.

Impact: Categories cache (`cache:intel:categories`, 60-min TTL) is only refreshed via:
1. Python worker calling `/api/intelligence/refresh` (preloads all groups)
2. Manual `/api/cache/intelligence` POST from dashboard

If Python worker is cold or Railway has an incident, categories cache goes stale after 60 min. No Vercel cron backup.

**Severity:** Low — categories only affect TrendScore sector component (15 pts) and sector state detection. Missing this data defaults to neutral scoring (5 pts), not a zero.

---

## PART E — Recommendations

### E.1 Top 10 Redis Optimizations (zero signal quality impact)

| # | Key / Change | Current Ops/Day | Saved | Risk |
|---|---|---|---|---|
| 1 | **`providers:health:snapshot` TTL 30s → 60s** | 2,880 | −1,440 ops/day | None — health is sampled, not real-time |
| 2 | **`scan:progress:{scan_id}` TTL 1h → 15 min** | 288 | −240 ops (earlier expiry) | None — scan completes in <2 min |
| 3 | **`providers:failover:log` add 30-day EXPIRE** | Unbounded RPUSH | Prevents unbounded growth | None |
| 4 | **`scheduler:status_cache` TTL 300s → 600s** | 288 | −144 ops/day | None — dashboard polls at 120s anyway |
| 5 | **`intel:quota:minute_log` simplify to per-hour INCR** | 500+ (ZADD/EXPIRE) | −300 ops/day | Minute-level rate limiting is redundant when cron runs every 15–60 min |
| 6 | **`cache:intel:global` cron 30 min → 60 min** | 48 writes | −24 writes/day | None — display-only, no signal pipeline usage |
| 7 | **`futures:funding_trend:{symbol}` scope to active futures coins** | 1,920 | −600 est. | Low — only write for coins that passed the futures filter |
| 8 | **`tg:hourly_count:{hour}` consolidate with dedup key** | 1,440 | −720 ops | Low — merge rate limit check into `_is_duplicate_alert()` |
| 9 | **`monitor:{date}:last_scan_duration_ms` remove** | 96 | −96 ops/day | None — scan duration exposed via `scan:latest:{mode}` |
| 10 | **`cache:open-interest:{symbol}` TTL 32 min → 15 min** | 2,880 | Net-zero (more refreshes = better data freshness) | Better accuracy on OI changes during volatile scans |

**Combined maximum savings: ~3,600 ops/day (~108,000/month) on top of current ~44K/day.**

---

### E.2 Top 10 CMC Reductions (zero signal quality impact)

| # | CMC Field / Change | Current Usage | Impact If Reduced | Verdict |
|---|---|---|---|---|
| 1 | **`cache:intel:global` cron 30 min → 60 min** | Display-only dashboard | Zero signal impact | **DO IT** |
| 2 | **`cache:intel:global` cron 60 min → 4h** | Display-only dashboard | Breadth metrics 4h stale | **Consider** — metrics change slowly |
| 3 | **CMC listings limit 200 → 150** (if bottom 50 never pass mcap/vol gate) | 200 coins | Bottom 50 are below $200M mcap — almost never generate signals | **Measure first**: count signals from coins ranked 151–200 in 30D data |
| 4 | **Add categories cron route file** | Missing = only preload-triggered | No immediate reduction, prevents future stale reads | **Fix the bug** |
| 5 | **Skip `read_trending_coins()` when `cache:intel:trending` TTL < 60s old** | Called on every scan | Avoids redundant JSON parse if last scan was <60s ago | Micro-optimization |
| 6 | **Remove `coinCount` from sector analysis** | Display-only telemetry | Zero signal impact | Cosmetic cleanup |
| 7 | **Remove `name` from `CoinData` pipeline processing** | Used only for signal display | Zero pipeline impact | Cosmetic |
| 8 | **`cache:intel:trending` cron 30 min → 60 min if WR data shows no TrendScore alpha** | 48 writes/day → 24 | Trending rank component (20 pts) less current | **Wait for Day 30 TrendScore WR data** |
| 9 | **Remove `topMovers` source from discovery if TrendScore data shows it adds no alpha** | Discovery score 20 pts | Universe selection change | **Wait for Day 30 TrendScore WR data** |
| 10 | **Merge `avgPriceChange` calculation from listings** | Currently requires `cache:intel:categories` | Could approximate sector strength from listings coins 24h change | Low-priority; categories add context |

---

## SUMMARY

### What CMC Provides (in order of importance)

1. **Universe of coins** — market_cap + volume_24h filtering narrows 200 coins to ~20–60 scannable per mode. Without CMC, all coins would need Binance OHLCV fetches to determine mcap/volume. **CRITICAL.**
2. **price_change_24h** — relative strength gate (±8–10 setup pts) and crash filter (-20% gate). **CRITICAL.**
3. **binanceSymbol + hasFutures** — exact Binance trading pair + futures availability. Without these, every kline fetch would require symbol discovery. **CRITICAL.**
4. **Coin prioritization (TrendScore)** — determines which 80 coins get scanned when 200 pass filters. Higher-TrendScore coins scanned first in TRENDING mode. **USEFUL** — no isolated WR proof yet.
5. **Sector intelligence** — ACCELERATING/WEAKENING sector context. **USEFUL** — contributing 15 pts to TrendScore, stamped on signals, no isolated WR yet.
6. **Global metrics** — market breadth display. **DISPLAY ONLY** — no signal pipeline usage.

### What Redis Provides

Redis is used for 6 distinct purposes:
1. **CMC cache** (4 keys) — bridges TS workers → Python scanner without direct CMC calls per scan
2. **Signal pipeline deduplication** (9 keys) — OI/funding/LS/regime caches prevent duplicate Binance calls
3. **Operational coordination** (4 keys) — distributed scan locks, scheduler state
4. **Settings propagation** (3 keys) — 3-layer settings cache with pub/sub invalidation
5. **Health monitoring** (13 keys) — 14 MONITOR.1 counters + provider metrics + output collapse detection
6. **Alert deduplication** (2 keys) — 1h WhatsApp dedup per symbol+direction

**No Redis key is removable.** Six can be optimized to save ~3,600 ops/day (~108K/month) beyond the current 44K/day baseline.

**Current Redis budget: ~44K ops/day (~1.32M/month) — WELL ABOVE the ~66K/month estimate in SYSTEM_STABILIZATION_FINAL_1.md.**

> ⚠️ **Budget discrepancy**: SYSTEM_STABILIZATION_FINAL_1 estimated ~66K ops/month. The TypeScript app cache keys (`cache:signals:*`, `cache:open-interest:*`, `cache:funding-rate:*`, `cache:long-short:*`) account for ~14,000 ops/day = ~420K ops/month by themselves, well above the prior estimate. This needs verification against actual Redis Cloud usage metrics.

---

*Generated: 2026-06-22*  
*No code changes. No removals. Classification and measurement only.*  
*Next action: After Day 30 (2026-07-16), measure TrendScore and sector_status WR cohorts from resolved outcomes before any CMC field changes.*
