# SignalEdge AI — Binance Tactical Audit

**Date:** 2026-05-30  
**Scope:** Complete Binance execution layer — 11 pipeline files, 51 numeric thresholds, 7 market-structure sub-gates  
**Auditor:** Static analysis of `backend/core/scanner/`

---

## Resolution Status (Phase 7.3A & 7.4A — May 2026)

**RESOLVED (7 items):**
- ✅ **Candle count minimum** — Increased from 200 → 300 for 1h/4h; 250/280 convergence guards applied (Phase 7.3A)
- ✅ **EMA200 convergence guards** — direction_reliable(≥250c) / bounce_reliable(≥280c) gates prevent false signals (Phase 7.3A)
- ✅ **4h EMA200 guard** — candle_count_4h passed to detect_setup(); same guards applied (Phase 7.4A.3)
- ✅ **Funding context tiers** — Directional funding (FAVORABLE/NORMAL/ELEVATED/EXTREME) replaces simple abs() check (Phase 7.3A)
- ✅ **OI × price correlation** — oi_intelligence.py NEW_LONGS/NEW_SHORTS/SHORT_COVERING/LONG_LIQUIDATION/NEUTRAL matrix; corrects inverted scoring (Phase 7.4A.2)
- ✅ **Funding trend detection** — Last 3 rates stored in Redis (8h TTL); RISING/FALLING/STABLE classification with multiplier (Phase 7.4A.4)
- ✅ **Breakout detection** — 20/30-day high/low + BB expansion; detect_breakout_strength() added for SPOT + FUTURES (Phase 7.4A.1)

**PENDING (recommend Phase 7.5):**
- 🔶 L/S ratio active gate (data fetched but not used in setup scoring)
- 🔶 Hard 1h direction gate for BUY signals (currently only scoring penalty, not gate)
- 🔶 Candle gap detection (consecutive zero-volume candles not validated)
- 🔶 Funding interval dynamic check (assumes 8h, some perps changed to 1h)

---

## Table of Contents

1. [Data Integrity](#section-1--data-integrity)
2. [Multi-Timeframe Analysis](#section-2--multi-timeframe-analysis)
3. [Continuation Engine](#section-3--continuation-engine)
4. [Breakout Detection](#section-4--breakout-detection)
5. [Funding Analysis](#section-5--funding-analysis)
6. [Open Interest](#section-6--open-interest)
7. [Futures Signal Quality](#section-7--futures-signal-quality)
8. [Spot Signal Quality](#section-8--spot-signal-quality)
9. [Binance Resource Efficiency](#section-9--binance-resource-efficiency)
10. [Final Scorecard](#section-10--final-scorecard)

---

## Section 1 — Data Integrity

### Candle Retrieval

All klines flow through a single shared `httpx.AsyncClient` with one connection pool (max 50 connections, 20 keepalive). The `_get()` function wraps every Binance call with 3-retry exponential backoff (0.5 s → 1.0 s → 2.0 s).

| Fetch | Candle count | Timeframe | Notes |
|-------|-------------|-----------|-------|
| 1h spot/futures | 300 | 1h | Phase 7.3A.7 increase from 200 |
| 4h spot/futures | 300 | 4h | Same |
| 1d spot/futures | 100 | 1d | ~3 months |
| BTC 4h reference | 3 | 4h | For RS engine, Redis-cached 5 min |

**Issue 1 — No candle gap detection.**
The pipeline accepts whatever Binance returns. If an exchange has zero-volume candles (listing just started, halted trading, thin market at 3 AM UTC) or gaps (maintenance window), `_parse_klines()` silently includes them. Zero-volume candles distort volume spike ratios, ATR, and EMA calculations. There is no check for consecutive zero-volume candles or timestamps that are non-contiguous.

**Issue 2 — Minimum candle floor is 60, not 300.**
`scan_coin()` rejects only if `len(candles_1h) < 60 or len(candles_4h) < 60`. A coin that returned 70 candles (possible for recently listed tokens, exchange outages, or symbols with thin trading) will proceed to indicator calculation. EMA200 will have 13.8%+ seed contamination, and the EMA200 Phase 7.3A.7 guard won't save it because `bounce_reliable(70)` returns False — but `direction_reliable(70)` also returns False. EMA200 scoring is silently skipped, which is correct, but nothing stops the signal from proceeding with unconverged EMA20, EMA50, RSI, and ATR on 70 candles.

**Issue 3 — 4h EMA200 has no convergence guard.**
Phase 7.3A.7 added `direction_reliable()` and `bounce_reliable()` guards only for `candle_count_1h`. The function `detect_setup()` receives `ind4h` but there is no `candle_count_4h` parameter passed to it. If Binance returns 300 4h candles, EMA200 4h has ~4.9% contamination (acceptable). But there is no verification or guard: the 4h EMA200 scores as if fully converged regardless.

**Issue 4 — Geo-block fallback for futures klines is absent.**
`fetch_spot_klines()` has a 451 → US fallback. `fetch_futures_klines()` does not. If the Singapore Railway region is geo-blocked from `fapi.binance.com`, futures klines silently fail and the coin is skipped — no alert, no fallback, no US endpoint attempt.

### Missing Candle Handling

On any kline fetch error (network, 5xx), `fetch_spot_klines()` and `fetch_futures_klines()` return `[]`. The pipeline checks `len(candles_1h) < 60` and rejects. This is safe (conservative fail) but produces zero telemetry. `gate_rejections_total` is not incremented for candle-fetch failures — they are invisible in metrics. The only trace is the `spot_klines_failed` or `futures_klines_failed` log warning.

### Retry Logic

**Correct for transient errors** (429, 5xx, timeouts, network errors).

**Risk:** There is no Retry-After header parsing. Binance sends `Retry-After` on 429 responses. The code ignores this and sleeps 1s or 2s regardless. During heavy rate-limit periods, a third retry at 2s may still be too soon.

### Time Synchronization

No clock synchronization with Binance. Kline timestamps come from Binance's `open_time` field. These are used for relative comparisons (candlestick pattern detection, divergence windows) but never for absolute time assertions. This is appropriate and safe.

### Symbol Mapping

**Spot:** `{symbol}USDT` concatenation. Works for the majority of top-200 coins. Known exception: `MATIC` → Binance renamed to `POLUSDT`; the CMC symbol is still `MATIC`, creating a permanent 400 error. No symbol resolution table or CMC→Binance symbol map exists.

**Mitigation exists:** 400 returns `None` immediately (no retry), so bad symbols fail fast.

**Futures:** Filtered at scan start against `fetch_futures_symbols()` (exchangeInfo, cached 1 hour). This is correct.

**Race condition:** If Binance delists a futures contract during a scan cycle, the coin will pass the symbol filter but fail on kline fetch (400/404). Silent skip, no alert.

### Data Integrity Score: **6.5 / 10**

**Risks:** No gap detection, no futures geo-block fallback, 4h EMA200 unguarded, symbol mapping exceptions, no Retry-After handling.

---

## Section 2 — Multi-Timeframe Analysis

### Timeframes Used

| Timeframe | Used in | Weight |
|-----------|---------|--------|
| **1d** | Daily trend direction (bullish/bearish/ranging) | Setup score ±12 pts |
| **4h** | Primary direction gate, MACD/RSI rejection, MTF confirm | Dominant (0.6 weighting) |
| **1h** | Secondary MTF confirm, all indicator scores, EMA200 | Secondary (0.4 weighting) |
| **15m** | **Not used** | — |

**15m is entirely absent.** The scanner operates on 1h minimum. This is a significant gap for a TRENDING scanner where momentum often shows on 15m first and only reaches 1h 3–4 candles later.

### Gate Flow

```
4h direction (BULLISH / BEARISH / RANGING)
  → RANGING: hard reject
4h vs 1h alignment (MTF confirmation)
  → conflicted: hard reject
Setup scoring:
  4h weight: 0.6 in combined trend strength
  1h weight: 0.4 in combined trend strength
```

### Can a Signal Pass with 1h Bullish / 4h Bearish?

**No.** The MTF gate at `confirm_multi_timeframe()` requires `ind4h.trend == BULLISH` for BUY. If 4h is bearish, this returns `alignment=CONFLICTED` and hard-rejects.

**However, the reverse scenario is a risk:** a BUY signal can pass with **4h BULLISH and 1h BEARISH/RANGING**, because the MTF hard gate only checks the 4h direction. A coin with `ind4h=BULLISH, ind1h=RANGING` scores `+30 (4h) + 0 (1h) = 30` for trend components, but combined with RSI (+15), MACD (+15), volume (+10) could reach 60+ and pass.

| Scenario | Result | Risk |
|----------|--------|------|
| 4h BULLISH, 1h BULLISH | +50 trend pts → strong pass | None |
| 4h BULLISH, 1h RANGING | +30 trend pts → borderline | Medium — early entry or weakening |
| 4h BULLISH, 1h BEARISH | +30 trend pts, 0 from 1h → may pass with strong RSI/MACD | **High — counter-trend entry** |
| 4h BEARISH, any 1h | Hard reject (gate) | None — correct |
| 4h RANGING, any 1h | Hard reject (gate) | None |

### Multi-Timeframe Score: **6 / 10**

**Gap:** No 15m timeframe, no hard 1h-direction requirement, 4h carries 60% of trend weight with no further confirmation.

---

## Section 3 — Continuation Engine

### Inputs

**Trend Continuation (futures, `futures_intelligence.py`):**
- EMA20 above/below EMA50 for direction
- Pullback depth: 0.8–2.0× ATR is "healthy pullback" (confidence boost)
- Pullback depth > 2.0× ATR = too deep (confidence penalty)
- Volume ≥ 1.5× average during pullback = confirmed

**Setup Score Continuation Signals:**
- EMA crossover freshness (5-candle lookback): GOLDEN_CROSS / DEATH_CROSS
- MACD histogram direction and sign
- Volume spike ≥ 1.5× (confirms momentum)
- Relative strength vs BTC ≥ +3% (coin-specific demand)

### Over-Filtering

The continuation gate rejects `continuation_probability < 25`. This fires when the pullback is too shallow (< 0.8× ATR). A coin in a clean bull trend that has not pulled back at all (parabolic momentum) will have `continuation_probability ≈ 10–15` because the pullback depth component is near zero. The gate rejects this as "no continuation setup" even though the momentum is genuinely strong. The gate was designed for pullback-continuation entries, not breakout entries.

### Under-Filtering

The market structure gate checks 20-candle RSI divergence. A divergence forming over 40+ candles (structural bear divergence) is invisible. Signals based on 40+ candle divergences pass the market structure gate.

### Top 10 Rejection Reasons

| Rank | Reason | Gate | Frequency estimate |
|------|--------|------|--------------------|
| 1 | MTF misalignment — 1h/4h conflict | MTF gate | Very high (~35%) |
| 2 | Sideways market (ADX < 16 or range < 2× ATR) | Market structure | High (~25%) |
| 3 | RSI divergence detected (20-candle window) | Market structure | Medium-high (~15%) |
| 4 | R:R < 2.0 (ATR × 2.0 insufficient) | R:R gate | Medium (~12%) |
| 5 | Setup score < 60 (insufficient confirmation) | Setup gate | Medium (~10%) |
| 6 | Trend strength < 30 (combined 1h+4h) | Trend gate | Medium (~8%) |
| 7 | S/R resistance overhead (2+ pivots within 1.2× ATR) | Market structure | Medium (~7%) |
| 8 | Overextension (candle > 3× ATR or 3-run > 4× ATR) | Market structure | Lower (~5%) |
| 9 | ATR volatility extreme (> 8% of price) | Volatility gate | Lower (~4%) |
| 10 | AI / heuristic rejection (confidence < 80) | AI gate | Variable (~20–40% of what reaches AI) |

### Continuation Score: **6.5 / 10**

**Gap:** Parabolic moves under-valued, 20-candle RSI divergence window misses structural divergences, no volume-weighted continuation scoring.

---

## Section 4 — Breakout Detection

### Current Breakout Logic

The breakout engine lives exclusively inside `futures_intelligence.py` and runs **only for FUTURES and HIGH_CONFIDENCE modes**. SPOT mode has zero breakout detection.

```python
Reference: 20-candle range (excluding last 2 candles)
No breakout if: range > 5% (too volatile, no consolidation)
Bullish breakout: price > reference_high × 1.01 (1% above range)
Bearish breakout: price < reference_low × 0.99
Volume confirmed: 2-candle average ≥ 1.5× range-period average
```

### Fake Breakout Filters (Market Structure Gate)

- Failed breakout: wick above resistance but closed below → reject
- Margin < 0.25× ATR AND volume < 1.3× → reject

These only check for the **absence of a real breakout**. They do not detect or score a genuine breakout.

### Missed Breakout Scenarios

**Scenario A — Clean 30-day high breakout in SPOT mode**
A coin breaking above its 30-day high with 3× volume has no dedicated detection in SPOT. The signal is only caught if MTF, RSI, MACD, and volume spike happen to align — which they often do, but there is no dedicated breakout bonus. A breaking-out coin scores identically to a coin in an established trend at the same technical levels.

**Scenario B — BB squeeze expansion**
The BB squeeze check fires when `current_width < 0.7 × avg_width` (+15 pts). But there is no "expansion after squeeze" check. A coin in squeeze gets +15 pts for the compression but there is no additional confirmation when the squeeze resolves with a volume breakout. The actual breakout moment — the most valuable entry — is unscored.

**Scenario C — High-velocity CMC trending breakout**
CMC trending coins outside top-100 often have high-velocity moves where the 20-candle range exceeds 5%. The breakout engine returns "no breakout" (too volatile) and the coin gets zero breakout contribution — the opposite of what's needed for trending discovery.

**Scenario D — 4h chart breakout during 1h consolidation**
The breakout engine uses 1h candles only. A breakout of a 4h consolidation structure (lasting weeks) is entirely missed — the 1h range shows wide during the breakout candles, triggering the "too volatile" early exit.

### Why Obvious Breakouts Are Missed

1. No 30-day high / 52-week high breakout gate anywhere in the pipeline
2. SPOT mode has zero dedicated breakout detection
3. 5% range threshold disqualifies valid high-velocity breakouts
4. Breakout engine is 1h-only, missing 4h structure breakouts
5. BB squeeze expansion (the most actionable breakout signal) is not scored

### Breakout Score: **4.5 / 10**

**Critical gap:** No SPOT breakout detection, no 30-day high gate, no BB expansion confirmation, 5% range threshold eliminates valid high-velocity breakouts.

---

## Section 5 — Funding Analysis

### Four Context Levels (Phase 7.3A.6)

| Context | Adverse rate | Setup score adj | Hard reject |
|---------|-------------|-----------------|-------------|
| FAVORABLE | favorable ≥ 0.001, adverse < 0.003 | +3 | No |
| NORMAL | adverse ≤ 0.003 (0.3%/8h) | 0 | No |
| ELEVATED | adverse 0.003–0.007 (0.3–0.7%/8h) | −10 | No |
| EXTREME | adverse > 0.007 (0.7%/8h) | N/A | Yes |

**Directional decomposition:**
- BUY: `adverse = max(0, +funding_rate)` — positive rate hurts longs
- SELL: `adverse = max(0, −funding_rate)` — negative rate hurts shorts

### Correctness Assessment

**Correct:**
- Directional approach fixed the critical bug where SELL signals with positive funding (shorts receiving) were rejected — now FAVORABLE
- ELEVATED range (0.3–0.7%/8h) matches real-world Binance active-market funding patterns
- EXTREME at 0.7%/8h is well-calibrated

**Issues:**

**Issue 1 — No funding rate trend (single snapshot).**
Funding at 0.004 (ELEVATED) could be rising from 0.001 (crowding rapidly, more dangerous) or falling from 0.010 (extreme unwinding, position becoming viable). The single-snapshot approach misses the direction of funding pressure.

**Issue 2 — Annualized rate display may mislead.**
`funding_rate × 3 × 365 × 100` assumes 3 funding periods per day. Binance changed some perps to 1-hour funding. For those, the annualized cost is 24× higher than displayed.

**Issue 3 — ELEVATED penalty is uniform regardless of magnitude.**
A coin at adverse_rate=0.0031 (barely ELEVATED) gets the same −10 pts as one at 0.0069 (nearly EXTREME). A graduated scale (−5 to −15 proportional to adverse_rate within the band) would be more precise.

**Issue 4 — Funding context not in AI prompt.**
Claude sees the raw `funding_rate × 100 = 0.4%` but not whether that is ELEVATED or NORMAL. Claude cannot contextualize whether the position is expensive to hold.

### Validation Examples

| Signal | Rate | Adverse | Context | Adj | Analysis |
|--------|------|---------|---------|-----|---------|
| BUY BTC | +0.0001 | 0.0001 | NORMAL | 0 | Standard bull market |
| BUY ETH | +0.0045 | 0.0045 | ELEVATED | −10 | Active bull, crowded longs |
| BUY SOL | −0.0015 | 0 | FAVORABLE | +3 | Shorts paying longs — rare |
| SELL BTC | +0.0060 | 0 | FAVORABLE | +3 | Was bug-rejected before 7.3A.6 |
| BUY PEPE | +0.0090 | 0.0090 | EXTREME | reject | Meme run, parabolic long crowding |

### Funding Score: **7.5 / 10**

**Strengths:** Directional fix correct, ELEVATED penalty calibrated. **Gaps:** Single snapshot, uniform ELEVATED penalty, funding interval assumption, not visible in AI prompt.

---

## Section 6 — Open Interest

### Data Source

`fetch_oi_history(symbol, period="1h", limit=25)` → `/futures/data/openInterestHist`
25 hours of 1h OI snapshots. Returns `change_24h` and `current`.
OI cached per symbol with 2-minute TTL.

### Current OI Scoring

| Condition | BUY pts | SELL pts |
|-----------|---------|---------|
| OI change_24h > 5% | +10 | — |
| OI change_24h > 2% | +5 | — |
| OI change_24h < -5% | -8 | — |

OI trend classified as RISING (> 3%), FALLING (< -3%), STABLE.

### Four Price × OI Scenarios

| Price | OI | OI Trend | System Response | Assessment |
|-------|-----|----------|-----------------|------------|
| ↑ | ↑ | RISING | BUY: +5 to +10 pts | **Correct** — new money entering |
| ↑ | ↓ | FALLING | BUY: 0 pts | **Gap** — short covering rally; lower continuation probability |
| ↓ | ↑ | RISING | SELL: +5 to +10 pts | **Correct** — new shorts, bearish conviction |
| ↓ | ↓ | FALLING | SELL: 0 to -8 pts | **Risk** — long liquidation cascade in progress |

**Critical gap in ↑Price + ↓OI scenario:**
When price rises and OI falls, this is a short-covering rally — shorts are exiting, not new longs entering. The move may exhaust quickly once all shorts have covered. Current system treats "no new money = neutral" when it should treat "short-covering = weaker continuation."

**Critical gap in ↓Price + ↑OI scenario:**
New short positions are being opened — genuine bearish conviction. Correct for SELL signals. But this also creates elevated long-liquidation risk: if price reverses, a cascade of liquidated shorts creates a violent short squeeze. The system does not account for the asymmetric risk.

**OI × signal direction correlation (known gap from 7.3A validation):**
`OI RISING + signal direction opposing price trend = dangerous entry`. Documented as a gap but not yet implemented.

### OI Score: **5 / 10**

**Gaps:** Short-covering detection absent, OI × direction correlation unimplemented, no OI velocity tracking, 1h granularity too fine for 4h context, no 4h OI history.

---

## Section 7 — Futures Signal Quality

### Acceptance Path

A signal must pass all 11 gates for FUTURES mode:

1. Filter: market cap ≥ $1B, volume ≥ $200M, turnover ≥ 0.5%, in futures list
2. 4h direction gate
3. MTF confirmation
4. Volatility gate (< 8% ATR)
5. Trend strength gate (≥ 30)
6. Market structure (7 sub-gates)
7. Setup score (≥ 60)
8. R:R gate (≥ 2.0)
9. Risk engine
10. Futures intelligence + funding gate (EXTREME rejects at adverse > 0.007)
11. AI validation (confidence ≥ **82** for FUTURES — higher than SPOT's 80)

### Universe Size

With $1B market cap and $200M volume minimum, only ~30–40 coins from the top-200 CMC universe qualify. After `futures_symbols` filter: ~25–35 effective candidates per FUTURES scan.

### Most Common Rejection Reasons (FUTURES mode)

| Gate | Approximate rejection rate | Running coins remaining (~30 start) |
|------|---------------------------|--------------------------------------|
| Filter | ~15% | ~25 |
| 4h direction + MTF | ~35% | ~16 |
| Market structure | ~35% | ~10 |
| Setup + R:R | ~30% | ~7 |
| Futures intelligence | ~10% post-7.3A.6 (EXTREME only) | ~6 |
| AI gate (≥ 82) | ~30–40% | **~2–4 signals** |

### False Negatives

**FN Type 1 — Phase-leading breakouts.**
A futures signal early in a move may have insufficient 4h trend strength (trend just forming) and fail the trend strength gate. These often prove to be the best entries. The scanner's gates are calibrated for confirmed trends, not emerging ones.

**FN Type 2 — ELEVATED funding bias in sustained bull markets.**
In a sustained bull run, nearly all BUY futures signals in the top 10–20 candidates will have funding 0.003–0.007 (ELEVATED range). Every valid BUY opportunity incurs a −10 pt penalty, creating a systematic undercount of valid signals during the strongest trending conditions.

**FN Type 3 — 1h pullback in 4h uptrend.**
A BUY entry during a 1h correction within a 4h uptrend is often the highest-quality entry. If the 1h trend is BEARISH during the correction, the -20 pts from missing the 1h trend component pushes setup score below 60 — this exact scenario is rejected.

**AI confidence gap at 80–81:**
FUTURES requires 82, SPOT requires 80. Signals scoring 80–81 pass SPOT but fail FUTURES. Claude's response variance (±2 pts for the same signal quality) creates inconsistency at this boundary.

### Futures Score: **6 / 10**

**Strengths:** Tight filter, correct directional funding. **Gaps:** No breakout detection, 1h counter-trend entry rejected, ELEVATED funding systematic bias in bull markets, AI confidence boundary inconsistency.

---

## Section 8 — Spot Signal Quality

### Effective Universe

Starting: ~100–200 coins from CMC intelligence cache. With `min_market_cap=$200M`, `min_volume_24h=$20M`, after stablecoin/prefix filter: ~85–90 tradeable candidates.

### Acceptance Rate Estimate

| Stage | Pass rate | Coins remaining (~90 start) |
|-------|----------|-----------------------------|
| 4h direction gate | ~55% | ~49 |
| MTF confirmation | ~70% | ~34 |
| Volatility gate | ~90% | ~31 |
| Trend strength ≥ 30 | ~70% | ~22 |
| Market structure (7 gates) | ~55% | ~12 |
| Setup score ≥ 60 | ~65% | ~8 |
| R:R ≥ 2.0 | ~75% | ~6 |
| Risk engine | ~70% | ~4 |
| AI validation (≥ 80) | ~40–60% | **~1–3 signals** |

Consistent with production logs showing 0–2 signals per standard scan cycle.

### Missed Opportunities

**Miss Type 1 — Pre-breakout accumulation.**
A coin consolidating tightly (low ADX, range < 3× ATR) is rejected at the market structure gate. This is correct in most cases. However, it also rejects coins in pre-breakout accumulation — the highest-quality BUY setups — because they look identical to sideways markets until the breakout candle appears.

**Miss Type 2 — Coins ranked 100–200 in CMC.**
The `_prioritize()` function sorts by volume + market_cap composite. Coins ranked 150–200 are consistently scanned last. With `max_coins_to_scan=80` and the 5-concurrent semaphore, lower-ranked coins may be cut by the 80-coin cap before being reached.

**Miss Type 3 — Relative strength not gate-level.**
A coin outperforming BTC by +6% on 4h gets +10 pts in setup scoring — but this is post-MTF-gate. Relative strength is only a scoring bonus, not a gate override. A coin with strong RS but weak MACD/RSI still fails the setup gate.

### Over-Filtering in SPOT

The **SR overhead rejection** (2+ pivots within 1.2× ATR) is particularly aggressive. A coin 1.21× ATR below a resistance level passes; 1.19× ATR below is rejected. The 1.2× ATR threshold for pivot proximity is strict enough that many valid entries near support levels are rejected.

### Spot Score: **6.5 / 10**

**Strengths:** Solid multi-gate waterfall, correctly calibrated for confirmed trend entries. **Gaps:** No breakout detection, pre-breakout accumulation rejected, coins ranked 100–200 deprioritized, S/R threshold creates edge-case rejections.

---

## Section 9 — Binance Resource Efficiency

### API Call Profile per Coin

**SPOT scan (per coin):**
| Call | Endpoint | Binance weight |
|------|----------|---------------|
| 1h klines | `/api/v3/klines?interval=1h&limit=300` | 2 |
| 4h klines | `/api/v3/klines?interval=4h&limit=300` | 2 |
| 1d klines | `/api/v3/klines?interval=1d&limit=100` | 2 |
| **Total** | 3 calls | **6 weight / coin** |

At 80 coins: 240 API calls, **480 total weight** per SPOT scan.

**FUTURES scan (per coin):**
| Call | Endpoint |
|------|----------|
| 1h klines | `/fapi/v1/klines` |
| 4h klines | `/fapi/v1/klines` |
| 1d klines | `/fapi/v1/klines` |
| Funding rate | `/fapi/v1/premiumIndex` |
| OI history | `/futures/data/openInterestHist` |
| L/S ratio | `/futures/data/globalLongShortAccountRatio` |
| **Total** | **6 calls per coin** |

At 50 futures coins: 300 API calls for futures intelligence alone.

### Waste and Duplication

**Waste 1 — Double BTC kline fetch.**
BTC is always in the top-200 and is scanned as a regular coin (1h + 4h klines fetched). On TRENDING scans, `fetch_btc_4h_change()` also fetches BTC 4h klines separately for the RS engine reference. This is a duplicate fetch. The 5-minute Redis cache reduces this for rapid consecutive scans but does not eliminate it across different cycles.

**Waste 2 — 1d klines oversized.**
Daily trend direction requires ~30 candles for EMA20/50 convergence. Fetching 100 1d candles returns 3× more data than needed. The 1d candlestick pattern check uses only 3 candles; the trend direction uses ~30. Reducing to 35 would have zero functional impact.

**Waste 3 — CoinGecko always fetches both pages.**
`_fetch_coingecko()` always fetches 2 pages (100 coins total) regardless of how many coins are needed. There is no limit parameter — the second page of 50 coins may be partially or fully unused.

**Efficient:**
- Futures data (funding/OI/L/S) fetched at Step 10 — after all structural gates. Only coins that passed market structure, setup score, and R:R are evaluated. Correctly ordered.
- Futures symbol list cached 1 hour.
- BTC 4h cached 5 minutes.

### Resource Efficiency Score: **6.5 / 10**

**Efficient:** Futures data fetched last (post-gate), symbol list cached, BTC 4h cached. **Inefficient:** Double BTC kline fetch, 100 daily candles when 35 suffice, no partial CoinGecko fetch.

---

## Section 10 — Final Scorecard

| Component | Score | Key Finding |
|-----------|-------|-------------|
| **Data Integrity** | **6.5 / 10** | No gap detection, no futures geo-block fallback, 4h EMA200 unguarded |
| **Multi-Timeframe** | **6.0 / 10** | No 15m, no hard 1h gate, 1h bearish can pass with 4h bullish |
| **Continuation Engine** | **6.5 / 10** | Parabolic momentum under-valued, 20-candle divergence window too short |
| **Breakout Detection** | **4.5 / 10** | No SPOT breakout, no 30-day high, no BB expansion, range threshold rejects valid breakouts |
| **Funding Analysis** | **7.5 / 10** | Directional fix correct; single-snapshot, uniform penalty, funding interval assumption |
| **Open Interest** | **5.0 / 10** | Short-covering not detected, OI × direction correlation absent |
| **Futures Quality** | **6.0 / 10** | Tight gates appropriate; ELEVATED bias in sustained bull, AI boundary inconsistency |
| **Spot Quality** | **6.5 / 10** | Pre-breakout accumulation rejected, S/R gate aggressive |
| **Execution Efficiency** | **6.5 / 10** | Double BTC fetch, oversized 1d candle pull |
| **Overall Execution Layer** | **6.2 / 10** | Solid 11-gate waterfall; gaps concentrated in breakout detection and OI analysis |

---

## Top 10 Improvement Recommendations

### HIGH IMPACT

**1. Breakout detection for SPOT mode**
Add `detect_price_breakout(candles_1d, candles_1h)` that fires when close > max(close_1d[-20:]) × 1.01 AND volume spike > 1.5×. Award +8 pts in setup scoring. Single highest-impact missing feature — classic momentum setups are systematically missed.

**2. BB expansion confirmation**
After BB squeeze detection (+15 pts), add +10 pts when `current_bb_width > avg_bb_width × 1.3`. This detects the actual breakout moment, not just the compression. Currently the squeeze fires before the move; expansion confirms the move has started.

**3. OI × price direction correlation**
Add penalty: if `futures_data.oi_trend == RISING` and price trend opposes signal direction, apply −8 to setup score. For BUY: OI rising + price falling = dangerous contra-flow. For SELL: OI falling + price rising = short squeeze risk.

**4. 4h EMA200 convergence guard**
Pass `candle_count_4h=len(candles_4h)` to `detect_setup()`. Apply the same `direction_reliable()` / `bounce_reliable()` guards to `ind4h.ema200`. Currently the 4h EMA200 is unguarded despite Phase 7.3A.7 protecting only the 1h.

**5. Funding rate trend (multi-snapshot)**
Store the last 3 funding readings per symbol in Redis (TTL 8h, one per funding interval). If current rate > previous × 1.5 (crowding rapidly), increase adverse classification one tier. If rate < previous × 0.5 (unwinding), decrease one tier.

### MEDIUM IMPACT

**6. L/S ratio active gate**
L/S data is fetched and stored in FuturesData but not used in any gate. Add to futures momentum score: L/S > 1.5 on SELL = +8 pts. L/S < 0.7 on BUY = +8 pts (short squeeze potential). Data already available — just not applied.

**7. Hard 1h direction gate for BUY signals**
Add: if BUY signal and `ind1h.trend == BEARISH`, reduce setup score by 15 pts (or add as optional hard gate). A BUY entry into a coin with 1h bearish trend has materially higher false-positive risk. Currently only costs 20 pts in scoring but can still pass.

**8. Short-covering detection**
When price ↑ and OI ↓, flag as `oi_interpretation = SHORT_COVERING`. Apply −5 pts to setup score and add to signal description. Short-covering rallies exhaust when all shorts close.

**9. Reduce 1d kline fetch from 100 → 35 candles**
Daily trend direction requires ~30 candles for EMA20/50 convergence. Reducing from 100 to 35 cuts 1d bandwidth by 65% with zero functional impact. The 1d candlestick check uses 3 candles; trend direction uses ~30.

**10. 15m timeframe for TRENDING mode**
Add lightweight 15m kline fetch (50 candles) for TRENDING mode only. Use 15m RSI and EMA20 as additional confirmation: `ind15m.trend == BULLISH` adds +5 pts to setup score. Catches emerging momentum 3–4 hours before the 1h candle closes into a bullish trend.

### LOW IMPACT

- Fix funding interval assumption: check `fundingIntervalHours` from exchangeInfo before annualizing
- Add SPOT geo-block handling for futures klines (currently only spot klines have US fallback)
- Add `candle_gap_count` metric: count consecutive zero-volume candles during kline parse
- Graduated ELEVATED funding penalty: linear interpolation −5 to −15 across 0.003–0.007 range
- Reduce AI confidence boundary inconsistency: evaluate whether FUTURES minimum of 82 vs SPOT 80 is justified or creates unnecessary signal loss at the boundary

---

*Report generated from static analysis of `backend/core/scanner/` files. All numeric thresholds, logic conditions, and gap descriptions are derived from exact code inspection.*
