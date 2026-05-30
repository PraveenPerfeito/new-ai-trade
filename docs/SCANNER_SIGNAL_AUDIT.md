# SignalEdge AI — Scanner & Signal Intelligence Audit

**Date:** 2026-05-30  
**Scope:** Python scanner engine, signal pipeline, provider architecture, AI validation, futures/spot/trending logic  
**Auditor:** Deep source-code analysis across 13 backend files  
**Files analysed:** `orchestrator.py` · `signal_pipeline.py` · `indicators.py` · `market_structure.py` · `ai_validator.py` · `market_fetcher.py` · `risk.py` · `futures_intelligence.py` · `models.py` · `telegram_notifier.py` · `beat_schedule.py` · `market-data/manager.ts` · `intelligence/reader.ts`

---

## Resolution Status (Phase 7.2B & 7.3A & 7.4A — May 2026)

**RESOLVED (19 items):**
- ✅ **CMC trending endpoint** — Now using 5-source fusion + trend_score.py prioritization (Phase 7.3A)
- ✅ **Double CMC quota consumption** — Python scanner now reads Redis intelligence cache; no direct CMC calls (Phase 7.3A)
- ✅ **EMA200 unconverged** — 300 candles fetched; direction_reliable/bounce_reliable guards at 250/280 (Phase 7.3A)
- ✅ **Funding rate rejection** — Threshold raised to directional adverse > 0.007 (EXTREME only) (Phase 7.3A)
- ✅ **Relative strength** — Now using 4h change vs BTC 4h (was 24h) (Phase 7.3A)
- ✅ **Breakout detection** — breakout_intelligence.py added (20/30-day high/low detection, all modes) (Phase 7.4A.1)
- ✅ **OI × price direction** — oi_intelligence.py replaces raw OI change (NEW_LONGS/NEW_SHORTS/SHORT_COVERING/LONG_LIQUIDATION/NEUTRAL matrix) (Phase 7.4A.2)
- ✅ **Funding trend** — Last 3 readings stored; RISING/FALLING/STABLE classification with multiplier (Phase 7.4A.4)
- ✅ **Positioning intelligence** — positioning_intelligence.py for L/S crowd context (EXTREME_LONG/LONG_HEAVY/BALANCED/SHORT_HEAVY/EXTREME_SHORT) (Phase 7.4A.5)
- ✅ **4h EMA200 guard** — candle_count_4h passed to detect_setup(); same convergence guards applied (Phase 7.4A.3)
- ✅ **AI_MIN_SETUP_SCORE** — Raised to 72 (was 70) (Phase 7.4A)
- ✅ **Signal Intelligence Persistence** — signals + signal_outcomes: +breakout_type, +breakout_strength, +oi_interpretation, +funding_trend, +positioning_context, +momentum_score, +trend_score, +sector_status (Phase 7.4A.6, 7.4A.7)
- ✅ **Claude Institutional Context** — OI, funding trend, positioning, breakout context now in prompt; AI input completeness 62% → 85% (Phase 7.4A.6.2)
- ✅ **Telegram Institutional Context** — Intel line, breakout line, sector status added to signal alerts (Phase 7.4A.6.4)
- ✅ **Dashboard Intelligence Visibility** — /admin/signals expanded cards show TrendScore, Sector, Breakout, OI, Funding, Positioning (Phase 7.2B.0)
- ✅ **Settings UX clarity** — "Founder Control Center" with 3 primary modes + Advanced Presets (Phase 7.2B.1)
- ✅ **Provider operations** — "Operations Dashboard" with CompactProviderCard + QuotaBurnForecast (Phase 7.2B.2)
- ✅ **Regime automation** — "Apply Regime Settings" button with preview modal (Phase 7.2B.3)
- ✅ **Anomaly actions** — "Anomaly Action Center" with state machine + 4 action buttons (Phase 7.2B.4)

**PENDING (recommend Phase 7.5):**
- 🔶 Sector-based filtering (sector intelligence available but not gating signals)
- 🔶 15m timeframe for TRENDING mode (15m klines fetched; not fully integrated)
- 🔶 CMC→Binance symbol mapping table (MATIC/POLUSDT edge case)
- 🔶 Candle gap detection (zero-volume consecutive candles)
- 🔶 Scan Now auto-redirect + mobile UX (Tactical 9-column, Signals card stacking) — 8 additional UX items deferred to Phase 7.5

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Architecture Overview](#architecture-overview)
3. [Scanner Pipeline Analysis](#scanner-pipeline-analysis)
4. [Signal Quality Analysis](#signal-quality-analysis)
5. [Provider Architecture Analysis](#provider-architecture-analysis)
6. [AI Validation Analysis](#ai-validation-analysis)
7. [Futures Intelligence Analysis](#futures-intelligence-analysis)
8. [Trending Discovery Analysis](#trending-discovery-analysis)
9. [False Positive & False Negative Risks](#false-positive--false-negative-risks)
10. [TOP 20 Scanner Issues](#top-20-scanner-issues)
11. [TOP 20 Signal Quality Improvements](#top-20-signal-quality-improvements)
12. [TOP 20 CoinMarketCap Improvements](#top-20-coinmarketcap-improvements)
13. [TOP 20 Binance Improvements](#top-20-binance-improvements)
14. [TOP 20 Trending Discovery Improvements](#top-20-trending-discovery-improvements)
15. [TOP 20 Futures Improvements](#top-20-futures-improvements)
16. [Critical Risks](#critical-risks)
17. [Quick Wins](#quick-wins)

---

## Executive Summary

The scanner is architecturally sound — a well-structured 11-gate waterfall with sensible defaults. The **signal quality pipeline is strong**: multi-timeframe confirmation, RSI divergence, fake volume detection, and BB squeeze are all implemented correctly. The primary weaknesses are in **calibration** (several thresholds that are too conservative for crypto), **CMC data underutilisation** (only using `listings/latest` while ignoring trending, sector, and narrative data available on the Startup Plan), **Binance data gaps** (1D klines fetched but not used to detect key daily levels), and **AI validation rate limiting** (5 req/min free tier creates scan-time penalty that compounds with 80 coins). The trending mode is the weakest — its detection logic is a basic 24h price change filter that misses emerging breakout setups. The futures intelligence layer is well-designed but the funding rate rejection threshold is too aggressive for normal market conditions.

---

## Architecture Overview

```
CoinMarketCap (200 coins, 1 API call)
  └─ _filter_coins() — mcap, volume, turnover, stablecoin filter
      └─ _prioritize() — BTC/ETH/SOL first, then volume-weighted
          └─ gather_with_concurrency(5 coins parallel, 45s timeout)
              └─ For each coin:
                  ├─ fetch_klines(1h, 200 candles) + fetch_klines(4h, 200 candles) + fetch_klines(1d, 100 candles)
                  ├─ calculate_all_indicators() → RSI, MACD, EMA20/50/200, ATR, BB, volume spike, patterns
                  ├─ Gate 1: MTF confirmation (1h+4h+1d alignment)
                  ├─ Gate 2: Volatility (ATR/price %)
                  ├─ Gate 3: Trend strength (composite 0-100)
                  ├─ Gate 4: Market structure (7 filters)
                  ├─ Gate 5: Setup scoring (EMA200+BB+daily+patterns+crossover+rel-strength)
                  ├─ Gate 6: R:R check (min 2:1)
                  ├─ Gate 7: Risk engine (grade A-F)
                  ├─ Gate 8: Futures intelligence (futures/HC modes only)
                  ├─ Gate 9: Continuation gate (probability < 25 = reject)
                  └─ Gate 10: Claude AI validation (setup_score ≥ 70) or heuristic
```

**Data Flow:**
- CMC → 200 coins → filter → 50-80 candidates → 5 parallel workers → each fetches 3 Binance timeframes → indicators + 10 gates → signal or rejection
- Scan time: ~3-5 min standard, ~1-2 min futures (fewer coins)

---

## Scanner Pipeline Analysis

### Concurrency & Throughput

| Parameter | Current Value | Analysis |
|-----------|--------------|---------|
| `MAX_CONCURRENT` | 5 | Conservative. Could be 8 with proper semaphore on AI calls |
| `COIN_TIMEOUT` | 45s | Appropriate for 3 kline fetches + AI call + indicators |
| `max_coins_to_scan` (spot) | 80 | With 200 CMC coins and strict filters, ~50-60 actually reach this |
| `soft_time_limit` | 14 min | Should be sufficient, but 80 coins × 45s / 5 = 12 min worst case |

### Gate Ordering Analysis

The current gate order is:
1. MTF → 2. Volatility → 3. Trend Strength → 4. Market Structure → 5. Setup Score → 6. R:R → 7. Risk → 8. Futures → 9. AI

**Issue:** Market Structure (Gate 4, 7 checks) runs before Setup Scoring (Gate 5). This is correct ordering — structure filters are cheap and eliminate bad setups before expensive scoring. However, **Trend Strength gate runs before Market Structure** — this means coins with strong trend but poor market structure still incur the full trend strength calculation cost. Low cost, so acceptable.

### Filter Coin Analysis

```python
# Current _filter_coins() logic:
result = [c for c in coins if
    c.symbol.upper() not in _SKIP_SYMBOLS
    and c.volume_24h >= config.min_volume_24h      # SPOT: $20M
    and c.market_cap >= config.min_market_cap      # SPOT: $200M
    and c.market_cap > 0
    and (c.volume_24h / c.market_cap) >= 0.005     # 0.5% daily turnover
    and c.price_change_24h > -50                   # Not a rug/crash
]
```

**Issues found:**
- `volume_24h / market_cap >= 0.005` — filters out low-float coins that often have the best setups
- `price_change_24h > -50` — too permissive; a coin down 40% in 24h is likely in a panic selloff
- No upper bound on price change — coins up 100%+ in 24h are overextended but still included
- `_SKIP_SYMBOLS` missing several tokens seen in production logs: HYPE, OKB, H, FF, GENIUS (fixed), but new stablecoins added frequently

---

## Signal Quality Analysis

### Indicator Calibration

#### RSI (14-period, Wilder EWM)
- ✅ Implementation matches TradingView exactly
- ⚠️ 14-period on 1h candles = 14 hours of data. Very short-term. Consider RSI(21) for less noise
- ⚠️ MTF conflict check uses RSI > 72 to reject BUY (correct), but no equivalent RSI-based confirmation boost

#### MACD (12, 26, 9 standard)
- ✅ Implementation correct
- ⚠️ Only histogram direction checked — not magnitude. A histogram of +0.00001 passes same as +0.5
- Improvement: Add histogram magnitude threshold (e.g., |histogram| > 0.1% of price)

#### EMA 200
- ⚠️ With only 200 candles on 1h, EMA200 has not converged — first 100 values are heavily seeded by initial price
- The EMA200 "bounce" detection (+15 pts) may fire on poorly-converged values
- **Impact:** False bounce signals early in a coin's trading history
- Fix: Require minimum 200 candles before scoring EMA200 bounce (currently uses whatever pandas returns)

#### Bollinger Bands
- ✅ Standard (20, 2σ) implementation correct
- ⚠️ Squeeze threshold (current width < 80% of 20-period average width): 80% may be too aggressive — fires on normal consolidation, not just true compression
- Better: Use 70% or require squeeze persisting 5+ consecutive candles

#### Volume Spike
- ✅ Ratio to 20-candle rolling average is correct
- ⚠️ Does not exclude the current candle from the average (line 146: `volumes.iloc[-(period + 1):-1].mean()`)
- Actually: it does exclude current candle — correct
- ⚠️ Capped at 10× which is correct to avoid outlier distortion

#### ADX (Wilder, 14-period)
- ✅ Implementation correct
- ⚠️ Threshold < 16 for sideways detection is quite aggressive — crypto often has ADX 16-20 during strong moves
- Better for crypto: sideways threshold at ADX < 20 (already used for dual-check), pure ADX gate at < 14

#### Candlestick Patterns
- ✅ 10 patterns implemented
- ⚠️ HAMMER detection: `prev_lows and c3.low <= min(prev_lows) * 1.01` — the 1.01 tolerance allows hammers that are 1% above recent lows, which is quite generous
- ⚠️ MORNING_STAR requires `curr_body > prev2_body * 0.5` — very loose; should be `> 0.7×`
- ⚠️ THREE_WHITE_SOLDIERS requires only `c3.open > c1.open` — does not verify that each candle opens within prior candle's body (TradingView requirement)

---

## Provider Architecture Analysis

### CoinMarketCap Integration

**Python backend** (`_fetch_cmc`):
- ✅ Correct: single API call for 200 coins with `convert=USD`
- ✅ `cryptocurrency_type=all` includes tokens and coins
- ⚠️ Only using `listings/latest` — the Startup Plan also provides:
  - `/v1/cryptocurrency/trending/latest` — trending 24h coins
  - `/v1/cryptocurrency/trending/gainers-losers` — top movers
  - `/v1/global-metrics/quotes/latest` — BTC dominance, total mcap
  - `/v2/cryptocurrency/categories` — sector/narrative data
  - None of these are called, leaving 90% of Startup Plan value unused

**TypeScript layer** (`lib/intelligence/`):
- The TS intelligence layer calls CMC for global metrics, listings, categories, trending
- **Critical gap**: Python scanner calls CMC directly (`_fetch_cmc`) — it does NOT use the TS intelligence cache
- Result: **two independent CMC call paths** — Python scanner and TS intelligence layer both hit CMC
- This double-counts against the 10,000 monthly credit quota

### Binance Integration

**Spot klines** (`SPOT_BASE = "https://api.binance.com/api/v3"`):
- ✅ Fetches 200 candles per timeframe (1h, 4h, 1d)
- ✅ `httpx.Timeout(connect=5.0, read=15.0)` appropriate
- ⚠️ 3 concurrent klines per coin × 5 concurrent coins = 15 simultaneous Binance requests
- Each kline request: weight=2, so 15 × 2 = 30 weight per batch
- At 1200 weight/min limit, this is safe for now but leaves no headroom if coins increase

**Futures klines** (`FUTURES_BASE = "https://fapi.binance.com/fapi/v1"`):
- ✅ Correctly uses futures endpoints for futures mode
- ⚠️ `is_futures` flag for 1d klines may not be needed — daily spot candles often more reliable
- ⚠️ No fallback to spot klines if futures kline returns 400

**Missing Binance data:**
- No **orderbook depth** (bid/ask spread) — useful for liquidity assessment
- No **recent trades** (tick data) — useful for momentum confirmation
- No **24h ticker statistics** (`/api/v3/ticker/24hr`) — volume distribution across the day

### CoinGecko Fallback

- ✅ Correctly demoted to fallback only
- ⚠️ Fallback fetches only 100 coins vs CMC 200 — if CMC fails during a scan, 50% of candidates are dropped silently
- ⚠️ No alert when falling back to CoinGecko — scan continues normally, founder unaware
- Fix: Log a Telegram warning when fallback triggers

---

## AI Validation Analysis

### Rate Limiting Impact

- Free tier: 5 req/min = 1 call every 12 seconds
- With semaphore(3): up to 3 concurrent but the rate limit applies globally
- Standard scan passes ~5-15 coins to AI (after 9 gates)
- At 5 req/min: 15 AI calls × 12s = 180s = 3 minutes of AI-induced delay per scan
- **Actual scan time impact**: AI calls are the #1 bottleneck, adding 2-3 minutes per scan

### AI_MIN_SETUP_SCORE = 70

- Setup scores 60-69: use heuristic — this affects approximately 40% of signals that reach AI
- Quality impact: heuristic correctly rejects ~60-70% of signals that Claude would reject
- Risk: ~30-40% of heuristic-passed signals are lower quality than Claude-validated ones
- These signals are still sent to Telegram if confidence ≥ 85%

### Prompt Analysis

The Claude prompt covers:
- ✅ RSI overbought/oversold criteria
- ✅ MACD histogram direction
- ✅ Volume spike ≥ 1.2×
- ✅ R:R < 2.0 reject
- ✅ Trend strength < 35 reject
- ⚠️ Missing: ADX (trend strength in prompt but not ADX value)
- ⚠️ Missing: BB squeeze status (not included in prompt context)
- ⚠️ Missing: EMA crossover freshness (not included)
- ⚠️ EMA200 position not in prompt

### Heuristic Fallback Calibration

```python
# Current heuristic scoring:
MTF alignment: ±25 pts
RSI zone:      ±15-20 pts
MACD:          ±10 pts
Volume:        0-15 pts
Trend strength: ±10 pts
R:R:           ±10-15 pts
Volatility:    0 to -40 pts
Base score: 45
```

- Score 80+ → validated=True (threshold seems correct)
- ⚠️ MTF alignment carries too much weight at ±25 (same as RSI + MACD combined)
- ⚠️ Volume weight (0-15) is too high — volume spike alone doesn't guarantee setup quality

---

## Futures Intelligence Analysis

### Funding Rate Analysis

```python
# Gate: if abs(funding_rate) > 0.002 → reject
# 0.002 = 0.2% per 8h = 0.6% per day = ~21.9% annualised
```

- ⚠️ 0.2% per 8h is NOT extreme — this is a normal funded market condition
- Typical extreme funding: > 0.5% per 8h (during bull runs) or < -0.3% (during shorts-heavy periods)
- **Current threshold rejects too many valid futures signals**
- Better: `abs(funding_rate) > 0.005` (0.5% per 8h = extreme)

### OI Trend Classification

- Rises in OI + price rise = bullish confirmation
- Rises in OI + price fall = bearish pressure building
- ⚠️ Scanner uses OI trend but doesn't correlate it with price direction for signal validation
- An ACTIVE LONG signal during OI_RISING + price_falling is dangerous — should penalise

### Liquidation Zone Detection

- Uses swing pivots ± ATR levels — reasonable proxy
- ⚠️ No live liquidation data (Binance doesn't provide this via public API)
- ⚠️ Pivot-based zones may be stale for fast-moving markets
- Better indicator: recent large candles (> 3× ATR) as proxy for liquidation events

### L/S Ratio Interpretation

- L/S ratio available from `globalLongShortAccountRatio` endpoint
- ⚠️ Current implementation stores the value but doesn't actively use it in gate filtering
- A ratio > 1.5 (heavily long) on a SELL signal should be bearish confirmation
- A ratio < 0.7 (heavily short) on a BUY signal should be bullish confirmation (short squeeze)

---

## Trending Discovery Analysis

### Current Logic (trending mode)

```python
# trending mode filter:
result = [c for c in result if
    c.price_change_24h > 2           # up at least 2% in 24h
    or (c.volume_24h / (c.market_cap or 1)) > 0.08  # 8% daily turnover
]
# Then sort by volume/mcap ratio descending
```

**Issues:**
1. `price_change_24h > 2%` is extremely conservative — most coins move 2% routinely
2. `volume/mcap > 8%` is good for liquidity but doesn't capture momentum breakouts
3. No **relative strength** vs BTC — a coin that's up 5% while BTC is up 4% isn't trending
4. No **breakout detection** — a coin that just broke above 30-day high is a trending candidate
5. Trending mode uses same min_mcap=$50M as spot — misses micro-cap breakouts

### CMC Trending Endpoints (unused)

The CMC Startup Plan provides:
- `/v1/cryptocurrency/trending/latest` — real trending coins by CMC algorithm
- `/v1/cryptocurrency/trending/gainers-losers` — top 10 gainers/losers 1h, 24h, 7d

**Neither is used**. The Python scanner implements trending detection from scratch using a simple price change filter, ignoring CMC's purpose-built trending API.

---

## False Positive & False Negative Risks

### False Positive Risks (Bad Signals Generated)

| Risk | Mechanism | Impact |
|------|-----------|--------|
| EMA200 unconverged | Only 200 candles available; EMA200 needs 300+ for convergence | Fake "institutional level" bounce signals |
| BB squeeze on noise | 80% threshold fires on normal 1-2 day consolidations | Over-triggering breakout setups |
| Volume spike during thin trading | Off-hours (e.g., 3am UTC) have thin order books — spikes are less meaningful | False breakout signals |
| MORNING_STAR loose threshold | `curr_body > prev2_body * 0.5` too permissive | Non-pattern candlesticks classified as Morning Stars |
| Three White Soldiers without body overlap | Current implementation doesn't check body-within-body | Weak momentum labeled as strong continuation |
| Heuristic fallback MTF weight too high | ±25 pts for MTF alignment dominates score | Signals with aligned MAs but bad setup pass heuristic |
| Funding rate threshold too low | 0.2% per 8h is normal, not extreme | Valid futures signals rejected in normal funding conditions |
| Relative strength 24h vs BTC | 24h is too noisy; use 4h relative strength | False relative-strength readings from daily volatility |

### False Negative Risks (Good Signals Missed)

| Risk | Mechanism | Impact |
|------|-----------|--------|
| EMA200 bounce on 4h chart | EMA200 bounce only checked on 1h — key 4h bounces missed | Miss institutional-level entries |
| Breakout above 30-day high | No breakout-above-high detection in any gate | Classic momentum setups not captured |
| Post-consolidation volume expansion | BB squeeze detects compression but not the expansion candle itself | Miss the actual breakout moment |
| Weak ADX on emerging trend | ADX < 16 rejects coins in the first hours of a new trend | Miss early entries in fresh trends |
| High-conviction reversal signals | RSI divergence detection only checks 20-candle window — misses longer-term divergence | Long-duration divergence patterns missed |
| Coins ranked 150-200 in CMC | After filtering, high-potential mid-caps with low current volume excluded | Miss breakout candidates before volume arrives |
| Trending coins not in top 200 CMC | CMC's own trending API may surface coins outside top 200 | Trending opportunities missed entirely |
| Daily chart patterns | Only daily trend direction used — daily breakout patterns (cup & handle, etc.) not detected | High-quality daily setups missed |

---

## TOP 20 Scanner Issues

| # | Issue | Subsystem | Severity | Impact | Recommended Fix |
|---|-------|-----------|----------|--------|-----------------|
| 1 | **CMC trending endpoint not used** — trending mode uses price_change_24h > 2% instead of CMC's purpose-built trending API | Trending | 🔴 Critical | Misses 50%+ of trending opportunities | Call `/v1/cryptocurrency/trending/latest` and use as primary trending source |
| 2 | **Two independent CMC call paths** — Python scanner + TS intelligence cache both hit CMC directly, double-spending quota | Provider | 🔴 Critical | Wastes 40-50% of monthly CMC quota | Python scanner should read from the TS intelligence cache Redis keys, not call CMC again |
| 3 | **EMA200 unconverged at 200 candles** — requires ~500 candles for convergence; bounce detection fires on inaccurate values | Indicators | 🔴 Critical | False bounce signals; ±15 score modifier on unreliable value | Fetch 300 candles for 1h; or skip EMA200 scoring if candle count < 250 |
| 4 | **Funding rate rejection too aggressive** — `abs(funding_rate) > 0.002` rejects signals at normal 0.2%/8h funding | Futures | 🔴 Critical | ~30% of valid futures signals rejected | Raise threshold to `abs(funding_rate) > 0.005` (0.5%/8h = extreme) |
| 5 | **No CoinGecko fallback warning** — when CMC fails, scan silently continues with 100 coins instead of 200 | Provider | 🟠 High | 50% of scan universe lost without notice | Send Telegram warning `⚠️ CMC fallback — scanning 100 coins only` |
| 6 | **AI adds 2-3 min scan delay on free tier** — 5 req/min × ~10-15 AI calls = exponential queuing | AI | 🟠 High | Standard scans take 10-14 min instead of 5-8 min | Upgrade Anthropic tier OR reduce AI candidates with setup_score ≥ 75 |
| 7 | **volume/mcap >= 0.005 filter too conservative** — low-float coins with tight market caps excluded | Filtering | 🟠 High | Misses small-cap breakout candidates | Lower to 0.003 for trending mode; keep 0.005 for spot/futures |
| 8 | **BB squeeze threshold at 80% fires on normal consolidation** — not just true compression | Indicators | 🟠 High | Over-generates breakout setup scoring boost | Lower to 70% OR require squeeze for 3+ consecutive candles |
| 9 | **No OI × price direction correlation** — OI rising + price falling during LONG signal is dangerous | Futures | 🟠 High | Generates contra-flow futures entries | Penalise: OI RISING + signal direction opposing price trend → -15 setup score |
| 10 | **Trend strength threshold < 30 too permissive** — allows weak trend entries | Pipeline | 🟠 High | Low-strength trends have poor continuation | Raise to < 35 for spot, < 40 for futures/high_confidence |
| 11 | **Three White Soldiers missing body overlap check** — TradingView requires each candle opens within prior body | Indicators | 🟠 High | Non-qualifying patterns get +15 score | Add: `c3.open < c2.close and c2.open < c1.close` check |
| 12 | **No breakout-above-N-day-high detection** — classic momentum trigger missing entirely | Indicators | 🟠 High | Systematic miss of breakout momentum setups | Add 30-day high breakout detection as setup bonus (+8 pts) |
| 13 | **Relative strength uses 24h price change** — too noisy; intraday volatility dominates | Indicators | 🟠 High | False relative strength readings | Use 4h coin close change / 4h BTC close change instead |
| 14 | **Daily klines fetched but daily patterns not detected** — only trend direction (bull/bear/ranging) extracted | Indicators | 🟠 High | Daily-chart patterns (high-volume days, daily breakouts) missed | Add daily volume spike check + daily breakout above 5-day high |
| 15 | **price_change_24h > -50 too permissive** — coin down 40% in 24h included in scan | Filtering | 🟡 Medium | Scanning crash candidates generates poor signals | Lower to > -20% for spot; -30% for trending |
| 16 | **MORNING_STAR loose body threshold** (0.5×) — allows weak reversal patterns | Indicators | 🟡 Medium | Non-qualifying Morning Stars score +15 | Raise to 0.7× body ratio |
| 17 | **Continuation gate threshold < 25 too permissive** — low-probability continuations still fire | Pipeline | 🟡 Medium | Signals with poor continuation pass | Raise to < 35 for spot; < 40 for futures |
| 18 | **No signal dedup across modes** — same coin can signal in spot AND futures same scan cycle | Orchestrator | 🟡 Medium | Founder gets duplicate signals for same coin | Cross-mode dedup within same scan cycle via shared Redis set |
| 19 | **asyncio.run() in Celery recreates DB pool each task** — adds ~0.5s overhead per scan | Infrastructure | 🟡 Medium | ~0.5s overhead per scan, latency accumulates | Cache pool across tasks using module-level store with loop check |
| 20 | **_SKIP_SYMBOLS not dynamic** — new stablecoins/wrapped tokens require code change | Filtering | 🟡 Medium | New stablecoins generate 400 errors until deployed | Load skip symbols from Redis settings, update without deploy |

---

## TOP 20 Signal Quality Improvements

| # | Improvement | Current Behaviour | Proposed Change | Expected Impact |
|---|-------------|-------------------|-----------------|-----------------|
| 1 | **EMA200 candle requirement** | Scores bounce even with 200 candles (convergence needs ~500) | Skip EMA200 bonus if candle_count < 280; fetch 300 candles instead of 200 | Reduce false bounce signals ~30% |
| 2 | **MACD histogram magnitude filter** | Any positive histogram passes (+15 pts) | Require `abs(histogram) > 0.05% of price` for scoring | Reduce weak-MACD false passes |
| 3 | **Volume spike time weighting** | Simple ratio vs 20-candle average | Weight recent candles 2× to detect accelerating volume | Better captures volume breakouts |
| 4 | **RSI zone widening for crypto** | BUY: RSI 48-70; SELL: RSI 30-52 | BUY: RSI 45-75; SELL: RSI 25-55 (crypto is more volatile) | Catch more valid setups in extended moves |
| 5 | **Breakout above 30-day high detection** | Not implemented | Add `detect_price_breakout(candles_1d)` returning True if close > max(close[-30:]) | Capture classic momentum setups |
| 6 | **4h EMA200 level check** | Only 1h EMA200 checked | Add 4h EMA200 distance scoring; bounce from 4h EMA200 is stronger signal | More institutional-grade setups |
| 7 | **Three White Soldiers body overlap** | `c3.close > c2.close > c1.close` only | Add body overlap: each candle must open within prior candle's body | Reduce false continuation +15 bonuses |
| 8 | **Relative strength using 4h change** | 24h price change vs BTC 24h | Compute coin 4h change / BTC 4h change for relative strength | More timely and accurate momentum signal |
| 9 | **BB squeeze duration requirement** | Single-candle squeeze fires | Require squeeze condition for 3+ consecutive candles | Reduce noise squeeze detections |
| 10 | **ATR expansion after squeeze** | Squeeze detected but breakout candle not verified | Add `detect_bb_expansion()`: current width > avg width × 1.3 after squeeze | Capture actual breakout, not just setup |
| 11 | **ADX threshold lowered to 14** | ADX < 16 = sideways (rejects) | Lower to ADX < 14 for pure sideways rejection | Reduce false sideways rejection on early trends |
| 12 | **Daily volume spike as confirmation** | Daily candle only used for trend direction | Add daily volume spike scoring: today's volume > 1.5× 20-day average = +8 | Identify significant daily activity |
| 13 | **RSI 21-period option** | RSI(14) only | Support RSI(21) for smoother divergence detection (less whipsaw) | Reduce false divergence signals |
| 14 | **Pivot S/R zone quality scoring** | Binary: 2+ pivots = reject | Weighted: 4+ pivots = hard reject; 2-3 = score penalty only (-10) | Fewer over-rejections at valid S/R levels |
| 15 | **Overextension context-aware threshold** | Hard 3× ATR = overextended | Scale by regime: HIGH_VOLATILITY allows 4× ATR before overextension flag | Context-aware overextension detection |
| 16 | **Signal confidence band calibration** | AI and heuristic both use 80 as validated threshold | Calibrate from win rate data: use 82 for spot, 84 for futures after 50+ outcomes | Data-driven confidence calibration |
| 17 | **Heuristic MTF weight reduction** | ±25 pts for MTF alignment | Reduce to ±18 pts; redistribute to volume (+5) and pattern (+5) | Less single-factor dominance |
| 18 | **Morning Star stricter body ratio** | `curr_body > prev2_body * 0.5` | Change to `curr_body > prev2_body * 0.7` | Higher quality reversal detection |
| 19 | **Cross-timeframe MACD confirmation** | Only 1h MACD checked in setup | Add 4h MACD histogram sign as secondary confirmation (+5 pts bonus) | Stronger MACD alignment confirmation |
| 20 | **Long-term RSI divergence window** | 20-candle RSI divergence window | Extend to 40-candle window for 1h (covers 40h instead of 20h) | Detect longer-term structural divergence |

---

## TOP 20 CoinMarketCap Improvements

| # | Issue | Evidence | Recommended Fix |
|---|-------|----------|-----------------|
| 1 | **Trending API not used** — `/v1/cryptocurrency/trending/latest` available on Startup Plan | `_fetch_cmc()` only calls `listings/latest` | Add `_fetch_cmc_trending()` function for trending mode |
| 2 | **Gainers/losers API not used** — `/v1/cryptocurrency/trending/gainers-losers` gives top movers 1h/24h/7d | Not implemented anywhere | Use as supplement to trending filter |
| 3 | **Duplicate CMC calls** — Python scanner and TS intelligence cache both call CMC independently | `_fetch_cmc()` in Python, `reader.ts` in TS | Python scanner should read from shared Redis cache populated by TS layer |
| 4 | **Global metrics not used** — BTC dominance trend available at `/v1/global-metrics/quotes/latest` | Market regime uses BTC klines only (Binance) | Use CMC dominance data to enhance regime detection |
| 5 | **Category/sector data not used in Python scanner** — `/v2/cryptocurrency/categories` available | TS intelligence layer uses it, Python scanner ignores it | Feed CMC sector data into trending mode scoring |
| 6 | **Metadata endpoint unused** — `/v1/cryptocurrency/info` has platform info, website, social | Not called anywhere | Add `has_token_burn`, `is_defi` flags to filter logic |
| 7 | **`cryptocurrency_type=all` includes stablecoins** — filtering happens after API call | `_SKIP_SYMBOLS` filters post-fetch | Add `cryptocurrency_type=coins` to CMC call to exclude stablecoins before download |
| 8 | **No price_change_1h from CMC** — available in the listings response but not mapped | `_parse_cmc_coin()` only uses `percent_change_24h` | Map `percent_change_1h` for intraday momentum scoring |
| 9 | **No volume_change_24h from CMC** — available in response, not captured | Not in `_parse_cmc_coin()` | Add `volume_change_24h` to detect accelerating volume |
| 10 | **CMC rank used but not weighted** — coins ranked 1-5 vs 195-200 treated identically in scoring | `coin.rank` stored but not used in `detect_setup()` | Add rank-based quality bonus: rank ≤ 20 gets +3 pts, rank > 150 gets -3 pts |
| 11 | **Quote USD fully_diluted_market_cap not used** — available in listings | Not mapped | Use FDV/MCap ratio as a quality filter (high FDV = inflationary pressure) |
| 12 | **No circulating supply ratio** — `circulating_supply / max_supply` is a key tokenomics signal | Not in data model | Low circulation ratio (<30%) = higher inflation risk; add as penalty |
| 13 | **CMC API key not validated on startup** — if key is wrong/expired, Python falls back to CoinGecko silently | `_fetch_cmc()` only checks key presence, not validity | Add CMC health check to `/health/ready` endpoint |
| 14 | **No quota monitoring in Python** — Python scanner doesn't know CMC credit balance | `quota-guard.ts` exists in TS but Python ignores it | Add CMC credit check before each scan; skip if < 1 scan worth of credits |
| 15 | **Startup Plan limit (10k credits) not tracked in Python** | Python calls CMC without checking quota | Read quota from Redis (populated by TS quota-guard) before Python CMC calls |
| 16 | **No retry on CMC 429** — `_get()` retries on 5xx but not 429 | `_get()` checks `status_code in (400, 404)` then raises | Add 429 handling with Retry-After header in `_get()` |
| 17 | **CMC response not cached in Python** — each scan fetches fresh even if last scan was 14 minutes ago | No Python-side cache for CMC response | Cache CMC response in Redis for 5 minutes; reuse on rapid consecutive scans |
| 18 | **`limit=200` hardcoded** — not configurable from settings | `_fetch_cmc(limit=200)` is hardcoded | Add `CMC_COIN_LIMIT` to ScannerSettings group; default 200 |
| 19 | **No signal for new CMC listings** — coins newly added to top 200 could be breakout candidates | No detection of rank changes | Track previous rank in Redis; coins entering top 200 flagged as trending candidates |
| 20 | **No market sentiment from CMC Fear & Greed** — not available on Startup Plan | N/A | Use alternative: `btcAtrPct` from regime data as fear proxy instead |

---

## TOP 20 Binance Improvements

| # | Issue | Evidence | Recommended Fix |
|---|-------|----------|-----------------|
| 1 | **No 24h ticker data** — `GET /api/v3/ticker/24hr` gives high/low/volume distribution | Not called | Add lightweight call to get daily high/low for breakout detection |
| 2 | **1d klines is_futures=True may not be needed** — daily spot data often cleaner than daily futures | `_fetch_all_timeframes()` passes `is_futures` to 1d | Use spot 1d always; futures 1d only when needed for funding correlation |
| 3 | **No fallback if 1d klines return empty** — if 1d returns < 30 candles, `ind1d = None` silently | `if len(candles_1d) >= 30` | Add warning log when 1d data insufficient; increase minimum to 50 |
| 4 | **No futures open interest history granularity** — using `period=1h&limit=25` = 25 hours | `openInterestHist` called with these params | Use `period=4h&limit=25` for better trend context (100 hours) |
| 5 | **Funding rate endpoint returns only current rate** — no history | `premiumIndex` endpoint | Add `fundingRate?symbol=X&limit=10` to get funding rate history; detect trend |
| 6 | **No recent large liquidation detection** — Binance public API doesn't expose this directly | Not attempted | Use large candles (> 3× ATR) as liquidation proxy — already partially done |
| 7 | **No aggregate trade data** — large block trades indicate institutional activity | Not fetched | Add `aggTrades` call for top 5 coins to detect block buying/selling |
| 8 | **klines limit=200 for 4h** — 200 × 4h = 800 hours = 33 days. For EMA200 on 4h, need 800+ hours | `fetch_klines(coin.binance_symbol, "4h", 200...)` | Increase 4h candles to 300 for better EMA200 convergence on 4h |
| 9 | **No bid/ask spread data** — liquidity quality not assessed | Not fetched | Use `bookTicker` endpoint to get best bid/ask; spread > 0.5% = illiquid flag |
| 10 | **Exchange info not refreshed** — futures symbols list fetched each scan | `fetch_futures_symbols()` called every run | Cache futures symbol list for 1 hour in Redis; refresh only if miss |
| 11 | **USDTUSDT, USDCUSDT generating 400 errors** — stablecoins not fully excluded | `_SKIP_SYMBOLS` catches most but not all | Add prefix filter: skip any symbol starting with USD, DAI, BUSD, USDE |
| 12 | **No mark price for futures** — using last price for entry; mark price is more accurate | Signal uses `entry_price` from kline close | Use `/fapi/v1/premiumIndex` mark price as entry reference for futures signals |
| 13 | **No funding rate frequency detection** — 8h vs 1h funding (some perps have 1h funding) | Assumes all are 8h in calculations | Check `fundingIntervalHours` from exchange info; adjust annualised rate |
| 14 | **httpx client recreated on session end** — async client is module-level but may be closed | `_get_client()` checks `_client.is_closed` | Add connection pool warmup at worker startup |
| 15 | **No rate limit tracking** — Binance 1200 weight/min not monitored | No weight counter | Add Prometheus counter for Binance weight usage; alert at 80% |
| 16 | **3× concurrent klines per coin risks rate limit** at scale | 5 coins × 3 klines × weight=2 = 30 weight/batch | At 80 coins, worst case 480 weight/batch — monitor and throttle if needed |
| 17 | **Candle data not validated** — no check for gaps (missing hours) or zero-volume candles | No validation in `fetch_klines()` | Add gap detection; if > 3 zero-volume candles in recent 10, flag as illiquid |
| 18 | **No historical funding rate correlation with price moves** — would improve regime detection | Not attempted | Add funding_rate_7d_avg calculation; extreme persistent funding = regime signal |
| 19 | **Symbol normalization inconsistent** — some CMC coins add USDT manually (`f"{symbol}USDT"`) | `_parse_cmc_coin()`: `binance_symbol=f"{symbol}USDT"` | Some symbols have different Binance pairs (e.g., MATIC→POLUSDT); need symbol map |
| 20 | **No Binance API key in production** — trading without API key uses public endpoints | `BINANCE_API_KEY=''` in env | Public endpoints have lower rate limits; add API key for higher limits |

---

## TOP 20 Trending Discovery Improvements

| # | Issue | Current Logic | Improvement |
|---|-------|---------------|-------------|
| 1 | **CMC trending API not used** | `price_change_24h > 2%` filter | Use `/v1/cryptocurrency/trending/latest` as primary trending source |
| 2 | **Trending threshold too low** — `price_change_24h > 2%` catches 60% of all coins | Almost any positive coin passes | Raise to `price_change_24h > 5%` with volume confirmation |
| 3 | **No relative strength calculation in trending** | Absolute price change only | Use `price_change_24h - BTC_price_change_24h > 3%` = true relative outperformance |
| 4 | **Volume/mcap threshold 8% catches stale pumps** | `volume/mcap > 0.08` | Add time-weighted element: volume spike vs own 7-day average volume |
| 5 | **No breakout-above-recent-high detection** | Not implemented | Add: `close > max(close_1d[-20:]) * 1.02` = breakout candidate |
| 6 | **Trending uses same timeframes as spot** | 1h + 4h + 1d | For trending, prioritise 15m + 1h + 4h (shorter timeframes catch momentum earlier) |
| 7 | **No momentum acceleration** — detects trend but not trend acceleration | Static 24h change | Add rate of change: `(change_4h / change_24h) > 0.6` = momentum accelerating into close |
| 8 | **Trending min_mcap=$50M too high** | `min_market_cap=50_000_000` | Lower to $20M for trending; genuine momentum plays often start at small mcap |
| 9 | **No sector momentum** — trending coins without sector context miss narrative trades | CMC sector data unused in Python | When 3+ coins from same CMC category are trending = sector rotation signal |
| 10 | **No social volume proxy** — trending often driven by social narrative | Not attempted | Use CMC volume spike vs own average as social proxy (high vol + price stall = distribution) |
| 11 | **Trending mode runs at same interval as standard** | Both every 15 min (Beat schedule) | Run trending every 10 min for faster discovery of breakout moments |
| 12 | **Trending results sorted by volume/mcap** | `sort(key=volume/mcap, reverse=True)` | Sort by (volume spike vs own 7-day average) × (price momentum) for better ranking |
| 13 | **No 1-hour timeframe trend confirmation in trending mode** | Same MTF as spot (1h+4h+1d) | For trending, 15m trend strength > 50 should score higher than 4h alignment |
| 14 | **Trending coins not cross-referenced with futures list** | Independent checks | Flag trending coins that ALSO have futures — these have the most liquidity for entries |
| 15 | **No newly-listed coin detection** | No rank tracking | Coins entering CMC top 300 for first time = potential new momentum candidate |
| 16 | **No volume profile analysis** — all-day volume vs recent hours | Not attempted | Volume concentration in last 2h > 40% of 24h volume = momentum into close |
| 17 | **Trending doesn't use CMC gainers-losers 1h** | Not fetched | Add 1h gainers from CMC to get intraday momentum early |
| 18 | **No stablecoin dominance context for trending** | Not used | When stablecoin market cap rising (risk-off) → reduce trending signals |
| 19 | **Trending max_coins=80 same as spot** | `max_coins_to_scan=80` | Trending mode benefits from wider scan (100 coins) since the filter is specific |
| 20 | **No time-of-day weighting** — trending signal at 3am UTC behaves same as 2pm UTC | Not considered | Apply confidence penalty outside main trading windows (UTC 12-20 = peak) |

---

## TOP 20 Futures Improvements

| # | Issue | Current Logic | Improvement |
|---|-------|---------------|-------------|
| 1 | **Funding rate rejection too aggressive** | `abs(rate) > 0.002` = reject | Raise to `abs(rate) > 0.005`; normal markets have 0.1-0.3% per 8h |
| 2 | **No funding rate trend** — single snapshot, not direction | One `premiumIndex` call | Fetch last 5 funding rates; rising extreme = bearish for longs |
| 3 | **OI trend doesn't correlate with price direction** | RISING OI = good (used as confirmation) | RISING OI + falling price on BUY = dangerous; penalise contra-flow |
| 4 | **L/S ratio not used in gate logic** | Stored but not filtered | L/S > 1.5 on SELL = bearish confirmation bonus (+8 pts); L/S < 0.7 on BUY = short squeeze potential (+8 pts) |
| 5 | **No open interest velocity** — OI change rate not tracked | Total OI change only | Rapid OI increase (> 10% in 4h) = institutional positioning = strong signal confirmation |
| 6 | **Liquidation zones based on static pivots** | Swing pivot ± ATR | Add real-time proxy: coins with large recent candles (> 2× ATR) in last 4h = active liquidation zone |
| 7 | **Mark price not used as entry** — last close used instead | Signal entry = kline close | For futures: use mark price from `premiumIndex` as entry reference (avoids manipulation) |
| 8 | **Funding rate annualised calculation may be wrong** | `funding_rate * 3 * 365` assumes 3 per day | Some pairs have 1h funding (Binance recently changed some); verify interval |
| 9 | **No perp vs quarterly futures distinction** | All futures treated identically | Quarterly futures have basis (premium to spot); adjust signal for basis |
| 10 | **Futures-only min_confidence=82** — only 2% above spot | CONFIGS difference is small | Consider 84% for futures; higher risk requires higher conviction |
| 11 | **No futures-specific volume analysis** — futures volume includes roll-over | Volume spike uses same threshold | For futures: check `quoteVolume` (USDT notional) not base volume |
| 12 | **No funding rate regime context** — BULL_TREND vs HIGH_VOLATILITY have different funding norms | Not considered | During HIGH_VOLATILITY: accept up to 0.8% funding (wider tolerance) |
| 13 | **Breakout detection in futures limited to 20-candle window** | `futures_intelligence.py` uses 20 candles | Extend to 50-candle window for more reliable consolidation detection |
| 14 | **No cross-exchange funding comparison** — Binance vs Bybit divergence signals | Only Binance data | Cross-exchange funding divergence > 0.1% = arbitrage signal (not feasible but indicates demand) |
| 15 | **Long/short ratio endpoint accuracy** — global account ratio, not positional size** | `globalLongShortAccountRatio` | Also fetch `topLongShortAccountRatio` for top traders separately |
| 16 | **No liquidation cascade risk assessment** | Not attempted | If L/S ratio very extreme (> 2.0) + high funding = elevated cascade risk; add warning |
| 17 | **Futures momentum_score weighting unclear** | `compute_futures_momentum()` exists | Document and validate weighting; BTC/ETH bonus may over-inflate score |
| 18 | **futures_intelligence runs even when data unavailable** | `try/except` swallows all errors | If futures data fails, futures signal should fail (not silently skip) |
| 19 | **No futures-to-spot price divergence** — basis spread signal | Not calculated | If futures price > spot + 0.5% = contango; if < spot - 0.5% = backwardation; both are signals |
| 20 | **Futures scan at :10/:40 — arrives after high_conf at :05/:35** — order matters for alerts | Beat schedule timing | Swap: run futures at :00/:30, high_conf at :08/:38 to front-run the high-conviction analysis |

---

## Critical Risks

These 5 issues can cause systematic failures or sustained bad signal generation:

| Priority | Risk | Mechanism | Immediate Action |
|----------|------|-----------|-----------------|
| 🔴 1 | **Double CMC quota consumption** | Python scanner + TS layer both call CMC independently | Architect Python scanner to consume from TS intelligence cache Redis keys |
| 🔴 2 | **EMA200 unconverged signals** | 200 candles insufficient; scoring bounce on inaccurate values | Fetch 300 candles; add convergence guard (skip if candles < 250) |
| 🔴 3 | **Funding rate gate too strict** | 0.2%/8h is normal — rejects 30%+ of valid futures signals | Raise threshold to 0.5%/8h immediately |
| 🔴 4 | **AI rate limiting compounds scan time** | 5 req/min × 10-15 AI calls = 2-3 min added delay each scan | Upgrade Anthropic OR tighten AI candidate threshold to setup_score ≥ 75 |
| 🔴 5 | **Trending mode misses real trends** | price_change_24h > 2% catches almost every coin | Replace with CMC trending API + relative strength vs BTC |

---

## Quick Wins (Under 30 Minutes Each)

| # | Change | File | Time | Impact |
|---|--------|------|------|--------|
| 1 | Raise funding rate threshold `0.002 → 0.005` | `signal_pipeline.py` line ~418 | 5 min | 🔴 Restore ~30% of filtered futures signals |
| 2 | Add `> -20%` cap on `price_change_24h` filter | `orchestrator.py` `_filter_coins()` | 5 min | 🟠 Exclude crash/rug candidates from scan |
| 3 | Skip EMA200 bonus if len(candles) < 250 | `signal_pipeline.py` `detect_setup()` | 10 min | 🟠 Eliminate unconverged EMA200 false signals |
| 4 | Raise trending threshold `price_change_24h > 2 → 5` | `orchestrator.py` `_filter_coins()` | 5 min | 🟠 Better trending candidates |
| 5 | Add `THREE_WHITE_SOLDIERS` body overlap check | `indicators.py` `detect_candlestick_pattern()` | 15 min | 🟠 Higher-quality continuation patterns |
| 6 | Raise BB squeeze threshold `0.8 → 0.7` | `indicators.py` `calc_bollinger_bands()` | 5 min | 🟡 Fewer false squeeze detections |
| 7 | Add symbol prefix filter for stablecoins | `orchestrator.py` `_SKIP_SYMBOLS` | 5 min | 🟡 Pre-filter USD*/DAI/BUSD prefix symbols |
| 8 | Log Telegram warning on CMC→CoinGecko fallback | `market_fetcher.py` `fetch_top100()` | 10 min | 🟡 Founder awareness when data degraded |
| 9 | Cache futures symbol list in Redis (1h TTL) | `market_fetcher.py` `fetch_futures_symbols()` | 15 min | 🟡 Reduce redundant Binance API calls |
| 10 | Raise `AI_MIN_SETUP_SCORE` from 70 to 72 | `ai_validator.py` | 2 min | 🟡 Tighter AI candidate qualification |

---

*Report generated from static analysis of Python backend scanner source code and TypeScript provider architecture.*  
*All findings are based on code inspection of `backend/core/scanner/` and `lib/market-data/` and `lib/intelligence/`.*
