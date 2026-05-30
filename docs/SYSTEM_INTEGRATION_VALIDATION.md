# Phase 7.4A — Final System Integration Validation

**Date:** 2026-05-30
**Branch:** main | **Commit:** 20920a9
**Scope:** End-to-end signal generation pipeline — Phase 7.3A & 7.4A integration audit
**Type:** Validation only. No code changes.

---

## Overall Scanner Score: 6.8 / 10

The intelligence engines are implemented and correctly influencing scores. The primary failure is **downstream propagation** — computed intelligence does not reach the three critical consumers: Claude reasoning, Telegram operator context, and outcome analytics.

---

## Quick Fix Summary (Low effort, high impact)

Before moving to Phase 7.5 / Part 1 Remaining Fixes, apply these four changes:

| # | Fix | File | Impact |
|---|-----|------|--------|
| 1 | Add `oi_interpretation`, `funding_trend`, `positioning_context`, `breakout_type` to `signal_outcomes` table | `database/analytics-schema.sql` + `backend/analytics/signal_metrics.py` | Unblocks all Phase 7.x outcome analytics |
| 2 | Add Phase 7.4A interpretation lines to Claude prompt | `backend/core/scanner/ai_validator.py` | Immediately improves AI reasoning quality |
| 3 | Add `breakout_type: str \| None` + `breakout_strength: str \| None` to Signal model | `backend/core/scanner/models.py` + `signal_pipeline.py` | Enables structured breakout analytics |
| 4 | Add OI interpretation + positioning context to Telegram futures section | `backend/core/scanner/telegram_notifier.py` | Operator sees institutional context |

---

## Section 1 — Architecture Flow

```
CoinMarketCap API
  ↓ TypeScript workers (every 5/10/30 min)
Redis Intelligence Cache
  cache:intel:listings   ← USED   (read_intelligence_listings)
  cache:intel:trending   ← USED   (read_trending_coins)
  cache:intel:categories ← USED   (read_categories)
  cache:intel:global     ← UNUSED ⚠️  (written by TS, never read by Python)
  cache:intel:metadata   ← UNUSED ⚠️  (written by TS, never read by Python)
  ↓
orchestrator.run_scan()
  ↓ TRENDING mode:
  build_trending_universe() → TrendingUniverseResult
    → 5-source fusion (trending, categories, top movers, listings, watchlist)
    → analyze_sectors() → SectorIntelligenceReport
    → compute_trend_score() → coins ordered by trend_score
  ↓
_filter_coins() → list[CoinData]
  ↓
scan_coin() × 5 concurrent
  ↓
  detect_setup()
    → ema_convergence guards ✅
    → detect_breakout_strength() → score applied ✅, breakout_type LOST ⚠️
  analyze_futures_intelligence()
    → classify_oi() → FuturesData.oi_interpretation ✅ (not forwarded downstream ⚠️)
    → classify_funding() + trend → FuturesData.funding_trend ✅ (not forwarded ⚠️)
    → classify_positioning() → FuturesData.positioning_context ✅ (not forwarded ⚠️)
  validate_signal() → Claude
    → raw metrics sent ✅
    → interpretations NOT sent ⚠️
  ↓
Signal → Telegram
  → core fields ✅
  → OI/funding/positioning interpretations NOT sent ⚠️
  ↓
signal_outcomes DB
  → basic fields ✅
  → ALL Phase 7.x intelligence fields MISSING ⚠️
```

---

## Section 2 — CMC Data Source Status

| Source | Redis Key | Status | Used by |
|--------|-----------|--------|---------|
| Listings (top-100 coins) | `cache:intel:listings` | **USED** | All scan modes |
| Trending (top-20 coins) | `cache:intel:trending` | **USED** | TRENDING mode only |
| Categories (sectors) | `cache:intel:categories` | **USED** | TRENDING mode only |
| Global Metrics (BTC dominance, total mcap) | `cache:intel:global` | **UNUSED ⚠️** | No Python reader exists |
| Metadata (coin tags, descriptions) | `cache:intel:metadata` | **UNUSED ⚠️** | No Python reader exists |
| Top Movers | Derived from listings.topMovers | **USED** | TRENDING mode |
| Watchlist | `ScannerSettings.trending_watchlist` | **USED** | TRENDING mode |

**Scanner reads cache only:** ✅ Confirmed. No direct CMC API calls from Python.
**Fallback:** Cache cold → CoinGecko → Telegram alert (15-min throttle) → `intel:fallback:status` Redis key ✅

---

## Section 3 — Discovery Engine

| Source | Adds new coins? | Score weight | In candidate queue? |
|--------|----------------|-------------|---------------------|
| CMC Trending API | ✅ +5–10 outside top-100 | 30 pts | ✅ |
| Top Movers | ❌ boosts existing only | 20 pts | ✅ |
| CMC Categories (rising sectors) | ❌ boosts existing only | 15 pts | ✅ |
| Listings Universe | ✅ base 100 coins | 5 pts | ✅ |
| Founder Watchlist | ❌ only if already in pool | 40 pts (highest) | ✅ |

`discovery_score` computed but **NOT used for ordering** — kept for attribution/logging only.
`trend_score` drives final ordering ✅

---

## Section 4 — TrendScore Components

All 7 components connected. Weight sum assertion enforced at import time.

| Component | Weight | Always active? | Notes |
|-----------|--------|---------------|-------|
| CMC Trending Rank | 20 | No (0 if not in trending) | Correct — only trending coins qualify |
| Relative Strength | 25 | Partial | 4h RS for trending coins; 24h proxy for listing-only (rough) |
| Sector Strength | 15 | Yes | Status adjustment: ACCELERATING +5, WEAKENING -5, OVERCROWDED cap 5 |
| Volume Expansion | 20 | Yes | |
| Market Cap Tier | 8 | Yes | |
| Breakout Momentum | 10 | Partial | 0 for listing-only coins (no CMC 1h data). Correct by design. |
| Futures Availability | 2 | Yes | |

---

## Section 5 — Relative Strength

| Mode | RS method | Quality |
|------|-----------|---------|
| TRENDING coins in CMC snapshot | `priceChange1h × 4` (proxy_from_cmc_1h) | Good |
| TRENDING listing-only coins | `priceChange24h / 6` (proxy_from_cmc_24h) | Rough |
| SPOT / FUTURES / HC signal scoring | `coin.price_change_24h - btc_change_24h` | Noisy 24h ⚠️ |

**RS stored on Signal:** ❌ Not stored
**RS in Claude prompt:** ❌ Not structured (only raw 24h change visible)
**RS in signal_outcomes:** ❌ Not stored

---

## Section 6 — Sector Intelligence

| Status | Requires baseline? | TrendScore adj | Visible downstream? |
|--------|--------------------|----------------|---------------------|
| STRONGEST | No | 0 | ❌ |
| ACCELERATING | Yes (30+ min warmup) | +5 | ❌ |
| NEUTRAL | No | 0 | ❌ |
| WEAKENING | Yes | -5 | ❌ |
| OVERCROWDED | No | cap at 5 | ❌ |

Sector status feeds TrendScore correctly ✅
NOT forwarded to signal pipeline (only discovery-time) ⚠️
NOT in Signal, Claude, Telegram, or signal_outcomes ⚠️

---

## Section 7 — Breakout Engine

| Strength | Score bonus | Applied to setup? | In Signal model? | In Claude? | In Telegram? | In signal_outcomes? |
|----------|-------------|-------------------|-----------------|-----------|-------------|---------------------|
| NONE | +0 | N/A | N/A | N/A | N/A | N/A |
| EARLY_BREAKOUT | +5 | ✅ | ❌ | ⚠️ text only | ❌ | ❌ |
| CONFIRMED_BREAKOUT | +8 | ✅ | ❌ | ⚠️ text only | ❌ | ❌ |
| HIGH_MOMENTUM_BREAKOUT | +12 | ✅ | ❌ | ⚠️ text only | ❌ | ❌ |

**Partial mitigation:** `br.details` text appears in `Signal.setup_description` → visible in Claude prompt as unstructured text. Not queryable.

**FIX NEEDED:** Add `breakout_type: str | None` and `breakout_strength: str | None` to `Signal` model and populate in `scan_coin()`.

---

## Section 8 — OI Intelligence

All 5 classifications computed, stored in `FuturesData.oi_interpretation`.  
Score adjustment applied via `oi_score_adj` parameter to `calc_momentum_score()` ✅

| Classification | In FuturesData | In Claude | In Telegram | In signal_outcomes |
|---------------|---------------|-----------|-------------|-------------------|
| NEW_LONGS | ✅ | ❌ | ❌ | ❌ |
| NEW_SHORTS | ✅ | ❌ | ❌ | ❌ |
| SHORT_COVERING | ✅ | ❌ | ❌ | ❌ |
| LONG_LIQUIDATION | ✅ | ❌ | ❌ | ❌ |
| NEUTRAL | ✅ | ❌ | ❌ | ❌ |

Claude sees: raw `oi_change_24h` + `oi_trend` enum. Not the institutional interpretation.

---

## Section 9 — Funding Intelligence

Directional logic: ✅ Correct
Funding trend multiplier: RISING ×1.3, FALLING ×0.7 ✅
Redis history: `futures:funding_trend:{symbol}` (TTL 8h, last 3 readings) ✅

| Field | In FuturesData | In Claude | In Telegram | In signal_outcomes |
|-------|---------------|-----------|-------------|-------------------|
| funding_rate | ✅ | ✅ (raw %) | ✅ | ❌ |
| funding_trend (RISING/FALLING/STABLE) | ✅ | ❌ | ❌ | ❌ |
| funding_bias (LONG_HEAVY/SHORT_HEAVY/NEUTRAL) | ✅ | ✅ (enum) | ✅ (icon) | ❌ |

**Remaining weakness:** Funding interval assumed 8h. Some Binance perps changed to 1h — annualised rate would be 8× understated.

---

## Section 10 — EMA Convergence

| Guard | Threshold | 1h active? | 4h active? | Protects |
|-------|-----------|-----------|-----------|----------|
| `direction_reliable()` | ≥ 250 candles | ✅ Phase 7.3A.7 | ✅ Phase 7.4A.3 | EMA200 direction bias (+5/+3 pts) |
| `bounce_reliable()` | ≥ 280 candles | ✅ Phase 7.3A.7 | ✅ Phase 7.4A.3 | EMA200 proximity (+15/+8 pts) |
| Default when count=0 | Conservative | ✅ Fixed (was bug) | ✅ | Disabled (was incorrectly enabled) |

EMA20/50 have no guard but converge adequately at 300 candles (~97%+ accuracy).

---

## Section 11 — AI Prompt Completeness

**Reaches Claude:**
- 1h/4h indicators (RSI, MACD, EMA, ATR, volume) ✅
- Trade levels (entry/target/stop/RR) ✅
- Setup description text (includes breakout details as plain text) ✅
- Futures: raw funding_rate, OI 24h change, OI trend, L/S ratio, momentum_score ✅
- Futures: breakout signal from futures_intelligence (if detected) ✅
- Trend strength, volatility rating ✅

**Does NOT reach Claude:**
- `oi_interpretation` (NEW_LONGS / SHORT_COVERING etc.) ❌
- `funding_trend` (RISING / FALLING / STABLE) ❌
- `positioning_context` (EXTREME_LONG / SHORT_HEAVY etc.) ❌
- `breakout_type` / `breakout_strength` from Phase 7.4A.1 (structured) ❌
- `sector_status` (ACCELERATING / WEAKENING) ❌
- `trend_score` value ❌

**AI input completeness: ~62% of Phase 7.x intelligence reaches Claude.**

---

## Section 12 — Telegram Payload

**Included:**
- Symbol, direction, mode, confidence, grade, R:R ✅
- Entry/target/stop + % moves ✅
- Leverage recommendation ✅
- RSI, volume spike, EMA200 position ✅
- Setup description (breakout details as text) ✅
- Futures: funding rate + bias icon, OI trend, L/S ratio, momentum_score ✅

**Missing:**
- OI interpretation label (NEW_LONGS / SHORT_COVERING) ❌
- Funding trend direction (RISING / FALLING) ❌
- Positioning context (EXTREME_LONG / SHORT_HEAVY) ❌

---

## Section 13 — Admin Dashboard

All admin pages were built before Phase 7.3A/7.4A. New intelligence fields exist in the data model but are not surfaced in the UI.

| Page | Phase 7.x intelligence visible? |
|------|----------------------------------|
| `/admin/overview` | ❌ None |
| `/admin/market` | ⚠️ CMC listings data only |
| `/admin/scanner` | ❌ None |
| `/admin/signals` | ⚠️ FuturesData in DB but not displayed |
| `/admin/sectors` | ⚠️ Categories shown, sector status not surfaced |
| `/admin/calibration` | ❌ None |
| `/admin/analytics` | ❌ Limited by missing signal_outcomes columns |
| `/admin/cache` | ✅ Cache hit/miss counters visible |

---

## Section 14 — Outcome Tracking Gaps

**Can future analysis answer these questions?**

| Question | Answerable now? | Missing field |
|----------|----------------|---------------|
| Breakout win rate (HIGH_MOMENTUM vs CONFIRMED) | ❌ | `breakout_type` |
| OI interpretation win rate (NEW_LONGS vs SHORT_COVERING) | ❌ | `oi_interpretation` |
| Funding trend win rate (RISING vs FALLING) | ❌ | `funding_trend` |
| Sector status win rate (ACCELERATING vs WEAKENING) | ❌ | `sector_status` |
| Positioning context win rate (EXTREME_SHORT vs BALANCED) | ❌ | `positioning_context` |
| Momentum score correlation with win rate | ❌ | `momentum_score` |
| TrendScore correlation with win rate | ❌ | `trend_score` |
| Win rate by scanner mode | ✅ | Already stored |
| Win rate by risk grade / confidence | ✅ | Already stored |

**All Phase 7.x intelligence absent from `signal_outcomes` table.**

---

## Section 15 — Final Scorecard

| System | Score | Status |
|--------|-------|--------|
| CMC Integration | 7.5/10 | 2 cache groups never read (global, metadata) |
| Discovery Engine | 8.5/10 | All 5 sources work; meta not forwarded downstream |
| TrendScore | 9.0/10 | All 7 components wired; breakout momentum 0 for ~80% universe |
| Relative Strength | 7.0/10 | 4h RS for TRENDING only; SPOT uses noisy 24h |
| Sector Intelligence | 7.0/10 | TrendScore adj correct; invisible downstream |
| Breakout Engine | 6.0/10 | Score applied; type not structured on Signal |
| OI Intelligence | 6.5/10 | In FuturesData; not in Claude/Telegram/DB |
| Funding Intelligence | 7.5/10 | Trend multiplier working; not in Claude/DB |
| EMA Protection | 9.0/10 | 1h + 4h guards active |
| AI Context | 6.0/10 | Raw metrics only; interpretations missing |
| Telegram | 5.5/10 | Core fields correct; institutional context missing |
| Dashboard | 4.0/10 | Pre-7.3A UI; new fields in model but not surfaced |
| Outcome Tracking | 3.0/10 | 7 Phase 7.x fields absent from signal_outcomes |

**Overall: 6.8 / 10**

---

## Section 16 — Critical Findings

### HIGH PRIORITY

**H1 — signal_outcomes missing all Phase 7.x intelligence fields**
- Fields missing: `oi_interpretation`, `funding_trend`, `positioning_context`, `breakout_type`, `breakout_strength`, `momentum_score`, `trend_score`
- **Impact:** Cannot measure whether Phase 7.x improves outcomes. Primary calibration feedback loop is broken.
- **Fix:** Alter `signal_outcomes` table + update `register_signal_outcome()` in `signal_metrics.py`

**H2 — Claude prompt missing institutional interpretations**
- Claude sees raw numbers (OI +6.8%, L/S 1.8) but not what they mean (NEW_LONGS, LONG_HEAVY)
- **Impact:** AI reasoning cannot reference "short covering rally," "crowd too long," "extreme short position"
- **Fix:** Add formatted interpretation lines to `futures_section` in `ai_validator._build_prompt()`

**H3 — Breakout type not structured on Signal**
- `BreakoutResult.breakout_type` scored and logged but never attached to Signal model
- Appears only as unstructured text in `setup_description`
- **Impact:** Cannot query "win rate of 30d_high breakout signals"
- **Fix:** Add `breakout_type: str | None` + `breakout_strength: str | None` to `Signal` model

### MEDIUM PRIORITY

**M1 — cache:intel:global never consumed**
- BTC dominance, total market cap, `marketCapChangePercent24h` — in Redis, never read
- **Fix:** Add `read_intelligence_global()` to `intelligence_cache.py`; use in regime/trending scoring

**M2 — Sector intelligence not forwarded to scan_coin()**
- `sector_report` from `build_trending_universe()` discarded before `scan_coin()`
- Coins in ACCELERATING sectors treated identically to WEAKENING sectors at signal time
- **Fix:** Pass sector_report to `scan_coin()` as optional context

**M3 — SPOT/FUTURES modes still use 24h RS**
- Phase 7.3A.4 fixed RS to 4h for TRENDING mode only
- SPOT and FUTURES use `coin.price_change_24h - btc_change_24h` (noisy)
- **Fix:** Compute `btc_4h_change` for all modes; apply in setup scoring

### LOW PRIORITY

**L1 — Telegram missing institutional context**
- OI interpretation, funding trend, positioning context absent from Telegram alerts
- **Fix:** Add 2–3 lines to futures section in `telegram_notifier.send_signal_alert()`

**L2 — cache:intel:metadata never consumed**
- Coin tags, categories, descriptions fetched every 6h, never read by Python
- Could improve stablecoin filtering, sector labelling, symbol validation

**L3 — TrendingMeta not forwarded past orchestrator**
- Rich per-coin metadata (`discovery_sources`, `sector`, `rs_classification`, `trend_score`) discarded after logging

---

## Section 17 — GO / NO GO

### CONDITIONAL GO ✅

The core intelligence engines are working and influencing signal scores correctly. The platform generates enhanced signals with Phase 7.x contributing to `momentum_score` and `setup_score`.

**The platform can proceed to Phase 7.5 / Part 1 Remaining Fixes.**

**Strongly recommended before Phase 7.5:**
Apply the four Quick Fixes listed at the top of this document. Without them, Phase 7.5 outcome analysis will be blind to all Phase 7.3A/7.4A improvements — no ability to measure whether the work had any effect.

**No mandatory blockers** — scanner is generating signals correctly.

---

## Fix Tracking

| Fix | Phase | Status |
|-----|-------|--------|
| Add breakout_type to Signal model + signal_outcomes | 7.5 | 🔶 Pending |
| Add Phase 7.4A interpretations to Claude prompt | 7.5 | 🔶 Pending |
| Add OI/funding/positioning to signal_outcomes columns | 7.5 | 🔶 Pending |
| Add interpretations to Telegram futures section | 7.5 | 🔶 Pending |
| Read cache:intel:global in Python (BTC dominance) | 7.5 | 🔶 Pending |
| Pass sector_report to scan_coin() | 7.5 | 🔶 Pending |
| 4h RS for SPOT/FUTURES modes | 7.5 | 🔶 Pending |
| L/S ratio hard gate (audit PENDING item) | 7.5 | 🔶 Pending |
| Hard 1h direction gate for BUY signals | 7.5 | 🔶 Pending |
| Candle gap detection | 7.5 | 🔶 Pending |
| Funding interval dynamic check | 7.5 | 🔶 Pending |

*Last updated: 2026-05-30*
