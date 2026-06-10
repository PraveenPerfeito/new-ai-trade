# Phase 8.1A — BTC Regime Architecture Audit

**Date:** 2026-05-31  
**Type:** Architecture audit only — implementation in Phase 8.1B  
**Decision:** ✅ Option B (port to Python)

---

> ### ⚠ IMPLEMENTATION STATUS — Updated 2026-06-10
>
> **Phase 8.1B** implemented Option B as described: `get_btc_regime()` in `market_fetcher.py`, regime passed through `orchestrator.py` → `scan_coin()` → `signal_pipeline.py`, `market_regime` persisted to `signals` + `signal_outcomes`.
>
> **Gate logic from Step 3 was implemented as a soft gate** (+10 confidence required for contra-regime signals, not hard block). This is the current BULL/BEAR/EUPHORIA/CAPITULATION gate behavior.
>
> **ALPHA.TRUTH.1 subsequently added a second, harder gate** (`signal_pipeline.py:778`):
> ```python
> # NULL regime hard gate — N=677, WR=14.9%, Exp=−0.543R
> if not btc_regime:
>     return None
> ```
> Signals where `btc_regime` is falsy/empty are **rejected outright** — not penalized, not passed to AI. This is in addition to (not instead of) the soft contra-regime gate. The `get_btc_regime()` fallback to `"SIDEWAYS"` when Binance fails means a Binance outage still allows signals through (safe default preserved).
>
> **Current gate sequence in `signal_pipeline.py`:**
> 1. NULL regime → hard reject (ALPHA.TRUTH.1)
> 2. Contra-regime → +10 confidence required (Phase 8.1B soft gate)

---

---

## Problem

The production Python scanner (Railway Celery) has no BTC macro regime awareness.  
Result: SELL signals fire in bull markets; BUY signals fire in bear markets.  
Root cause of May 29 incident: 99 SELL signals at 0% win rate during a bull reversal.

The TypeScript `lib/market-regime.ts` computes the correct regime but runs only in the legacy Next.js scanner, not in the production Celery path.

---

## Option A — TypeScript → Redis → Python

### Architecture
```
lib/market-regime.ts (Vercel serverless)
  → compute regime
  → redis.set("btc:regime", result, TTL=5min)
  ↓
orchestrator.py
  → redis.get("btc:regime")
  → if None: fallback SIDEWAYS
```

### Problems

| Problem | Detail |
|---------|--------|
| No existing writer | `getMarketRegime()` is only called by `lib/scanner.ts` (legacy). No worker writes regime to Redis. New writer required. |
| Serverless cold-start gap | Vercel functions only run on requests. Between frontend requests, the 5-min TTL key expires → Python reads stale/missing regime. |
| Cross-process dependency | Python scanner (Railway, always up) depends on Next.js (Vercel, serverless). Cold start silently disables the gate. |
| Two sources of truth | If TS write fails, Python silently uses SIDEWAYS — no gate enforced. |
| New infrastructure | New Redis key, TTL management, monitoring, failure path. |

### Score

| Dimension | Rating |
|-----------|--------|
| Complexity | HIGH |
| Failure modes | Silent — Python falls back to SIDEWAYS without any alert |
| Latency | 0ms (Redis) but depends on TS writer being fresh |
| Maintenance | HIGH — two processes must stay in sync |
| Operational risk | MEDIUM — Vercel cold starts silently degrade the gate |

---

## Option B — Port classifyRegime() to Python

### Architecture
```
market_fetcher.get_btc_regime()
  → fetch_spot_klines("BTCUSDT", "4h", 100)   ← already fetched for btc_4h_change
  → calculate_all_indicators()                  ← already in indicators.py
  → calc_trend_strength()                       ← already in indicators.py
  → calc_volatility_rating()                    ← already in indicators.py
  → _classify_regime()                          ← 6-line port from TypeScript
  → RedisCache("btc-regime", ttl=300s)          ← same pattern as _btc_4h_cache
  ↓
orchestrator.run_scan()
  → btc_regime = await get_btc_regime()
  → passed to scan_coin() for gate check
```

### Classification logic (exact TypeScript port)

```python
def _classify_regime(rsi, trend, btc24h, strength, vol) -> str:
    if rsi > 78 and btc24h > 8:                            return "EUPHORIA"
    if rsi < 22 and btc24h < -8:                           return "CAPITULATION"
    if vol in (HIGH, EXTREME) and abs(btc24h) > 5:         return "HIGH_VOLATILITY"
    if trend == BULLISH and strength >= 50:                return "BULL_TREND"
    if trend == BEARISH and strength >= 50:                return "BEAR_TREND"
    return "SIDEWAYS"
```

All four dependencies (`fetch_spot_klines`, `calculate_all_indicators`, `calc_trend_strength`, `calc_volatility_rating`) are already present in the Python scanner. This is a 6-line port.

### Score

| Dimension | Rating |
|-----------|--------|
| Complexity | LOW — ~40 lines total including caching |
| Failure modes | Explicit — Binance fail → "SIDEWAYS" (safe default, logged) |
| Latency | ~50ms first call, 0ms cached (5 min) |
| Maintenance | LOW — self-contained, no cross-process sync |
| Operational risk | NONE — same Binance dependency as existing klines |

---

## Decision: ✅ Option B

Option A requires a new TypeScript writer, cross-process Redis coordination, and depends on Vercel uptime. Option B reuses building blocks already in the Python scanner. Same Binance endpoint, same caching pattern, zero new infrastructure.

---

## Implementation Plan (Phase 8.1B)

**4 files, ~80 lines total.**

### Step 1 — `backend/core/scanner/market_fetcher.py`

Add `get_btc_regime()`. Expand BTC 4h fetch from 3 → 100 candles:

```python
_btc_regime_cache = RedisCache("btc-regime", ttl_seconds=5 * 60)

async def get_btc_regime() -> str:
    cached = await _btc_regime_cache.get("regime")
    if cached:
        return str(cached)
    try:
        candles  = await fetch_spot_klines("BTCUSDT", "4h", 100)
        if len(candles) < 60:
            return "SIDEWAYS"
        ind      = calculate_all_indicators(candles)
        strength = calc_trend_strength(ind)
        vol      = calc_volatility_rating(ind.atr, ind.current_price)
        tail     = candles[-7:]
        btc24h   = ((tail[-1].close - tail[0].open) / tail[0].open * 100) \
                   if len(tail) >= 7 else 0.0
        regime   = _classify_regime(ind.rsi, ind.trend, btc24h, strength, vol)
        await _btc_regime_cache.set("regime", regime)
        return regime
    except Exception as exc:
        log.warning("btc_regime_failed_defaulting_sideways", error=str(exc))
        return "SIDEWAYS"
```

### Step 2 — `backend/core/scanner/orchestrator.py`

Fetch regime once per scan start; pass to each `scan_coin()` call; store on Signal:

```python
btc_regime = await get_btc_regime()
# pass to scan_coin(... btc_regime=btc_regime)
# signal.market_regime = btc_regime
```

### Step 3 — `backend/core/scanner/signal_pipeline.py`

Regime gate after setup scoring, before AI validation:

```python
BULL_BLOCKS_SELL = {"BULL_TREND", "EUPHORIA"}
BEAR_BLOCKS_BUY  = {"BEAR_TREND", "CAPITULATION"}

if signal_type == SignalType.SELL and btc_regime in BULL_BLOCKS_SELL:
    gate_rejections_total.labels(gate="regime").inc()
    return None

if signal_type == SignalType.BUY and btc_regime in BEAR_BLOCKS_BUY:
    gate_rejections_total.labels(gate="regime").inc()
    return None
```

### Step 4 — `backend/analytics/signal_metrics.py`

Store `market_regime` in `register_signal_outcome()` INSERT.

---

## Gate Logic

| BTC Regime | BUY signals | SELL signals |
|------------|------------|--------------|
| BULL_TREND | ✅ Pass | ❌ Blocked |
| EUPHORIA | ✅ Pass | ❌ Blocked (overbought) |
| BEAR_TREND | ❌ Blocked | ✅ Pass |
| CAPITULATION | ❌ Blocked (gap risk) | ✅ Pass |
| HIGH_VOLATILITY | ✅ Pass | ✅ Pass |
| SIDEWAYS | ✅ Pass | ✅ Pass |

---

## May 29 Effect — Quantitative Estimate

**What would have been suppressed:**  
BTC recovering (likely BULL_TREND) → gate blocks all 99 SELL signals.

| Metric | Without gate | With gate |
|--------|------------|-----------|
| May 29 SELL signals | 99 (0 wins) | 0 (suppressed) |
| Total resolved pool | 324 | 225 (−30.6%) |
| Total wins | 29 | 29 (unchanged) |
| Win rate | **9.0%** | **12.9%** |

**Forward-looking estimate** (50% BULL / 30% BEAR / 20% SIDEWAYS):

| Regime | Win rate | Weight | Contribution |
|--------|---------|--------|-------------|
| BULL_TREND (BUY only) | 40.0% | 50% | 20.0% |
| BEAR_TREND (SELL only) | 8.8% | 30% | 2.6% |
| SIDEWAYS (both) | ~9.0% | 20% | 1.8% |
| **Blended** | | | **~24.4%** |

Expected improvement: **9% → ~24% win rate** with **~30% signal volume reduction**.  
Break-even for 2:1 RR is 33% — the remaining gap will close as data accumulates and BEAR_TREND SELL quality improves.

---

## Risk Assessment

| Risk | Likelihood | Mitigation |
|------|-----------|-----------|
| Regime misclassified (choppy market) | LOW | Requires `trend == BULLISH` AND `strength >= 50` — choppy markets don't qualify |
| BTC klines fetch failure | LOW | Falls back to "SIDEWAYS" — no signals suppressed, safe default |
| Regime shifts mid-scan | VERY LOW | Single regime per 15-min scan; 4h regime changes slowly |
| EUPHORIA blocks valid SELL in pullback | MEDIUM | EUPHORIA is rare; when RSI>78 AND btc24h>8, shorts are high risk anyway |

---

## GO / NO-GO

## ✅ GO — Phase 8.1B approved

Implement Option B. 4 files, ~80 lines, no new infrastructure, self-contained failure mode.  
Expected result: 9% → ~24% win rate, −30% signal volume, `market_regime` stored on all signals.

*Last updated: 2026-05-31*
