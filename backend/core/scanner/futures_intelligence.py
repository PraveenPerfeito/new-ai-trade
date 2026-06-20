"""
Futures intelligence analysis.
Python port of lib/futures-intelligence.ts.
Caches funding/OI/L-S in the shared Redis caches.
"""
from __future__ import annotations

from backend.cache.redis_cache import funding_cache, oi_cache, ls_cache
from backend.core.scanner.market_fetcher import (
    fetch_funding_rate,
    fetch_oi_history,
    fetch_long_short_ratio,
)
from backend.core.scanner.models import (
    Candle, TrendDirection, SignalType,
    LiquidationZone, BreakoutSignal, TrendContinuationData,
    FuturesData, FundingBias, OITrend, OIInterpretation, FundingTrend,
    PositioningContext,
)
from backend.logging.setup import get_logger

log = get_logger(__name__)

_PRIORITY = {"BTC", "ETH", "SOL"}

# REDIS.REDUCE.1 — in-process dict cache for funding rate history.
# Eliminates ~1,920 Redis GET ops/day (1 GET/symbol/scan × 40 coins × 48 scans).
# SETs retained so history persists across worker restarts.
# GETs only fire once per symbol per worker session (cold-start miss).
_funding_hist_mem: dict[str, list[float]] = {}


# ── Cached data fetchers ──────────────────────────────────────────────────────

async def _get_funding(symbol: str) -> float:
    cached = await funding_cache.get(symbol)
    if cached is not None:
        return float(cached)
    rate = await fetch_funding_rate(symbol)
    await funding_cache.set(symbol, rate)
    return rate


async def _get_oi(symbol: str) -> dict:
    cached = await oi_cache.get(symbol)
    if cached is not None:
        return cached
    history = await fetch_oi_history(symbol, "1h", 25)
    if len(history) < 2:
        result = {"current": 0.0, "change_24h": 0.0}
    else:
        current = history[-1]["sum_open_interest"]
        past24  = history[max(0, len(history) - 25)]["sum_open_interest"]
        change  = ((current - past24) / past24 * 100) if past24 > 0 else 0.0
        result = {"current": current, "change_24h": round(change, 2)}
    await oi_cache.set(symbol, result)
    return result


async def _get_ls(symbol: str) -> dict:
    cached = await ls_cache.get(symbol)
    if cached is not None:
        return cached
    history = await fetch_long_short_ratio(symbol, "1h", 4)
    if not history:
        result = {"ratio": 1.0, "long_pct": 50.0, "short_pct": 50.0}
    else:
        latest = history[-1]
        result = {
            "ratio":     latest["long_short_ratio"],
            "long_pct":  round(latest["long_account"] * 100, 2),
            "short_pct": round(latest["short_account"] * 100, 2),
        }
    await ls_cache.set(symbol, result)
    return result


# ── Funding trend tracking (Phase 7.4A.4) ────────────────────────────────────
# Store last 3 funding readings per symbol in Redis (TTL = 8h = one funding period).
# 3 readings are enough to determine direction: oldest → middle → latest.

FUNDING_HIST_KEY     = "futures:funding_trend:{}"  # format with symbol
FUNDING_HIST_TTL     = 8 * 60 * 60   # 8 hours — matches Binance funding interval
FUNDING_HIST_MAX     = 3             # keep last 3 readings
# FUNDING.TREND.FIX.1 — the original 0.0002 absolute delta was unreachable:
# readings are taken ~30-60 min apart (scan cadence) while typical funding
# LEVELS are only ~0.0001, so the classifier emitted STABLE 100% of the time
# over 30d of audited outcomes. New rule: |delta| must exceed the LARGER of a
# small absolute floor and 25% of the starting magnitude — sensitive at normal
# funding levels, noise-proof when rates are already extreme.
FUNDING_TREND_DELTA_ABS = 0.00003    # absolute floor (0.003%)
FUNDING_TREND_DELTA_REL = 0.25       # 25% of |oldest reading|, whichever is larger


async def _update_funding_history(symbol: str, rate: float) -> list[float]:
    """
    Append the latest funding rate to the symbol's 3-reading history.
    Serves from in-process dict on subsequent calls (REDIS.REDUCE.1);
    falls back to Redis GET only on cold-start (first call per symbol per session).
    Redis SETEX is always written so history survives worker restarts.
    """
    import json  # noqa: PLC0415
    key = FUNDING_HIST_KEY.format(symbol)
    try:
        from backend.cache.redis_cache import get_redis  # noqa: PLC0415
        redis = await get_redis()

        if symbol in _funding_hist_mem:
            hist = _funding_hist_mem[symbol]
        else:
            # Cold-start: load from Redis once, then cache in memory
            raw  = await redis.get(key)
            hist = json.loads(raw) if raw else []
            _funding_hist_mem[symbol] = hist

        hist.append(rate)
        hist = hist[-FUNDING_HIST_MAX:]   # keep last N
        _funding_hist_mem[symbol] = hist
        await redis.setex(key, FUNDING_HIST_TTL, json.dumps(hist))
        return hist
    except Exception as exc:
        log.warning("funding_history_update_failed", symbol=symbol, error=str(exc))
        return [rate]


def _classify_funding_trend(history: list[float]) -> FundingTrend:
    """
    Classify the direction of funding rate change from a list of readings.

    Requires at least 2 readings (oldest to newest).  FUNDING.TREND.FIX.1:
    threshold = max(FUNDING_TREND_DELTA_ABS, |oldest| × FUNDING_TREND_DELTA_REL)
      delta > +threshold → RISING
      delta < -threshold → FALLING
      else               → STABLE
    """
    if len(history) < 2:
        return FundingTrend.STABLE
    delta = history[-1] - history[0]
    threshold = max(FUNDING_TREND_DELTA_ABS, abs(history[0]) * FUNDING_TREND_DELTA_REL)
    if delta > threshold:
        return FundingTrend.RISING
    if delta < -threshold:
        return FundingTrend.FALLING
    return FundingTrend.STABLE


# ── Liquidation zone detection ────────────────────────────────────────────────

def detect_liquidation_zones(
    candles: list[Candle],
    current_price: float,
    atr: float,
    funding_rate: float,
) -> list[LiquidationZone]:
    if len(candles) < 20:
        return []

    zones: list[LiquidationZone] = []
    window = candles[-50:]
    n = len(window)

    for i in range(2, n - 2):
        h = [c.high for c in window]
        l = [c.low  for c in window]
        age = n - 1 - i
        strength: str = "STRONG" if age < 10 else ("MODERATE" if age < 25 else "WEAK")

        is_swing_high = (
            h[i] > h[i-1] and h[i] > h[i-2] and h[i] > h[i+1] and h[i] > h[i+2]
        )
        if is_swing_high:
            liq_price = window[i].high * 1.005
            dist = (liq_price - current_price) / current_price * 100
            zones.append(LiquidationZone(
                price=liq_price, side="LONG_LIQ",
                strength=strength, distance_pct=round(dist, 2),  # type: ignore[arg-type]
            ))

        is_swing_low = (
            l[i] < l[i-1] and l[i] < l[i-2] and l[i] < l[i+1] and l[i] < l[i+2]
        )
        if is_swing_low:
            liq_price = window[i].low * 0.995
            dist = (liq_price - current_price) / current_price * 100
            zones.append(LiquidationZone(
                price=liq_price, side="SHORT_LIQ",
                strength=strength, distance_pct=round(dist, 2),  # type: ignore[arg-type]
            ))

    # Funding-rate-biased ATR zones
    if atr > 0:
        if funding_rate > 0.0005:
            liq = current_price - 3 * atr
            dist = (liq - current_price) / current_price * 100
            zones.append(LiquidationZone(price=liq, side="SHORT_LIQ", strength="MODERATE", distance_pct=round(dist, 2)))  # type: ignore[arg-type]
        elif funding_rate < -0.0005:
            liq = current_price + 3 * atr
            dist = (liq - current_price) / current_price * 100
            zones.append(LiquidationZone(price=liq, side="LONG_LIQ", strength="MODERATE", distance_pct=round(dist, 2)))  # type: ignore[arg-type]

    return sorted(
        [z for z in zones if abs(z.distance_pct) <= 10],
        key=lambda z: abs(z.distance_pct),
    )[:6]


# ── Breakout detection ────────────────────────────────────────────────────────

def detect_breakout(candles: list[Candle], current_price: float) -> BreakoutSignal:
    base = BreakoutSignal(
        detected=False, direction="UP", breakout_pct=0.0,
        range_high=current_price, range_low=current_price,
        volume_confirmed=False, age_candles=0,
    )
    if len(candles) < 22:
        return base

    range_candles = candles[-22:-2]
    last2 = candles[-2:]
    latest = candles[-1]

    range_high = max(c.high  for c in range_candles)
    range_low  = min(c.low   for c in range_candles)
    range_size = (range_high - range_low) / range_low if range_low > 0 else 999

    if range_size > 0.05:
        return BreakoutSignal(
            detected=False, direction="UP", breakout_pct=0.0,
            range_high=range_high, range_low=range_low,
            volume_confirmed=False, age_candles=0,
        )

    avg_vol = sum(c.volume for c in range_candles) / len(range_candles)
    bk_vol  = sum(c.volume for c in last2) / len(last2)
    vol_confirmed = bk_vol / avg_vol >= 1.5 if avg_vol > 0 else False

    threshold = 0.01
    if latest.close > range_high * (1 + threshold):
        pct = (latest.close - range_high) / range_high * 100
        return BreakoutSignal(
            detected=True, direction="UP", breakout_pct=round(pct, 2),
            range_high=range_high, range_low=range_low,
            volume_confirmed=vol_confirmed, age_candles=1,
        )
    if latest.close < range_low * (1 - threshold):
        pct = (range_low - latest.close) / range_low * 100
        return BreakoutSignal(
            detected=True, direction="DOWN", breakout_pct=round(pct, 2),
            range_high=range_high, range_low=range_low,
            volume_confirmed=vol_confirmed, age_candles=1,
        )

    return BreakoutSignal(
        detected=False, direction="UP", breakout_pct=0.0,
        range_high=range_high, range_low=range_low,
        volume_confirmed=False, age_candles=0,
    )


# ── Trend continuation ────────────────────────────────────────────────────────

def analyze_trend_continuation(
    candles: list[Candle],
    ema20: float,
    atr: float,
    trend: TrendDirection,
) -> TrendContinuationData:
    neutral = TrendContinuationData(
        is_pullback=False, pullback_depth=0.0,
        holding_key_level=False, key_level=0.0, continuation_confidence=0,
    )
    if len(candles) < 10 or trend == TrendDirection.RANGING or atr == 0:
        return neutral

    current = candles[-1].close
    dist = abs(current - ema20)
    depth = dist / atr

    prev_prices = [c.close for c in candles[-6:-1]]
    was_farther = any(
        (p > ema20 + 1.5 * atr if trend == TrendDirection.BULLISH else p < ema20 - 1.5 * atr)
        for p in prev_prices
    )
    is_near  = dist < 1.5 * atr
    pullback = was_farther and is_near
    holding  = current >= ema20 if trend == TrendDirection.BULLISH else current <= ema20

    confidence = 0
    if pullback and holding:
        confidence = 60
        if depth < 0.8:  confidence += 15
        if depth > 2.0:  confidence -= 20

    return TrendContinuationData(
        is_pullback=pullback,
        pullback_depth=round(depth, 1),
        holding_key_level=holding,
        key_level=ema20,
        continuation_confidence=max(0, min(100, confidence)),
    )


# ── Momentum score ────────────────────────────────────────────────────────────

def calc_momentum_score(
    funding_rate:        float,
    oi_change_24h:       float,
    long_short_ratio:    float,
    breakout:            BreakoutSignal,
    trend_cont:          TrendContinuationData,
    rsi:                 float,
    trend:               TrendDirection,
    signal_type:         SignalType,
    base_symbol:         str,
    oi_score_adj:        int = 0,   # Phase 7.4A.2: from OIAnalysisResult.score_adjustment
    positioning_score_adj: int = 0, # Phase 7.4A.5: from PositioningResult.score_adjustment
) -> int:
    score = 50

    if base_symbol.upper() in _PRIORITY:
        score += 5

    if signal_type == SignalType.BUY:
        if   funding_rate < -0.0001: score += 12
        elif funding_rate <  0.0001: score += 6
        elif funding_rate >  0.0003: score -= 8
        elif funding_rate >  0.0006: score -= 15
    else:
        if   funding_rate >  0.0003: score += 12
        elif funding_rate >  0.0001: score += 6
        elif funding_rate < -0.0003: score -= 8
        elif funding_rate < -0.0006: score -= 15

    # Phase 7.4A.2: OI interpretation replaces raw oi_change_24h scoring.
    # Directional adj is +10 (confirmation), -5 (warning), or -10 (contra-flow).
    score += oi_score_adj

    # Phase 7.4A.5: positioning intelligence replaces old two-case L/S check.
    # Covers 5 levels: EXTREME_LONG / LONG_HEAVY / BALANCED / SHORT_HEAVY / EXTREME_SHORT
    score += positioning_score_adj

    if breakout.detected:
        aligned = (
            (signal_type == SignalType.BUY  and breakout.direction == "UP")
            or (signal_type == SignalType.SELL and breakout.direction == "DOWN")
        )
        score += (15 if breakout.volume_confirmed else 8) if aligned else -10

    if trend_cont.is_pullback and trend_cont.holding_key_level:
        score += round(trend_cont.continuation_confidence * 0.15)

    if signal_type == SignalType.BUY  and trend == TrendDirection.BULLISH: score += 8
    elif signal_type == SignalType.SELL and trend == TrendDirection.BEARISH: score += 8
    elif trend != TrendDirection.RANGING: score -= 5

    if signal_type == SignalType.BUY  and rsi < 45: score += 5
    elif signal_type == SignalType.SELL and rsi > 55: score += 5

    return max(0, min(100, round(score)))


# ── Main entry point ──────────────────────────────────────────────────────────

async def analyze_futures_intelligence(
    symbol: str,
    base_symbol: str,
    candles_1h: list[Candle],
    ema20: float,
    atr: float,
    rsi: float,
    trend: TrendDirection,
    signal_type: SignalType,
) -> FuturesData:
    funding_rate, oi_data, ls_data = await _gather_market_data(symbol)

    current_price = candles_1h[-1].close if candles_1h else 0.0
    ann = funding_rate * 3 * 365 * 100

    # Phase 7.4A.4: update funding history and classify trend
    funding_history  = await _update_funding_history(symbol, funding_rate)
    funding_trend    = _classify_funding_trend(funding_history)

    # Telemetry
    try:
        from backend.metrics.prometheus import funding_trend_distribution  # noqa: PLC0415
        funding_trend_distribution.labels(
            trend=funding_trend.value,
            signal_type=signal_type.value,
        ).inc()
    except Exception:
        pass

    log.info(
        "funding_trend_classified",
        symbol=base_symbol,
        trend=funding_trend.value,
        history=[round(r, 6) for r in funding_history],
    )

    funding_bias = (
        FundingBias.LONG_HEAVY  if funding_rate >  0.0002 else
        FundingBias.SHORT_HEAVY if funding_rate < -0.0002 else
        FundingBias.NEUTRAL
    )
    oi_trend = (
        OITrend.RISING  if oi_data["change_24h"] >  3 else
        OITrend.FALLING if oi_data["change_24h"] < -3 else
        OITrend.STABLE
    )

    # Phase 7.4A.2: Classify OI vs price direction for institutional interpretation
    price_change_24h = 0.0
    if len(candles_1h) >= 25:
        past_close    = candles_1h[-25].close
        price_change_24h = (
            (current_price - past_close) / past_close * 100 if past_close > 0 else 0.0
        )

    from backend.core.scanner.oi_intelligence import classify_oi  # noqa: PLC0415
    oi_analysis = classify_oi(price_change_24h, oi_data["change_24h"], signal_type)

    # Telemetry
    try:
        from backend.metrics.prometheus import oi_interpretation_distribution  # noqa: PLC0415
        oi_interpretation_distribution.labels(
            interpretation=oi_analysis.interpretation.value,
            signal_type=signal_type.value,
        ).inc()
    except Exception:
        pass

    log.info(
        "oi_interpretation",
        symbol=base_symbol,
        interpretation=oi_analysis.interpretation.value,
        price_change_24h=round(price_change_24h, 2),
        oi_change_24h=round(oi_data["change_24h"], 2),
        score_adj=oi_analysis.score_adjustment,
    )

    # Phase 7.4A.5: positioning intelligence
    from backend.core.scanner.positioning_intelligence import classify_positioning  # noqa: PLC0415
    pos_analysis = classify_positioning(
        long_short_ratio = ls_data["ratio"],
        long_pct         = ls_data["long_pct"],
        signal_type      = signal_type,
    )

    try:
        from backend.metrics.prometheus import positioning_distribution  # noqa: PLC0415
        positioning_distribution.labels(
            context=pos_analysis.context.value,
            signal_type=signal_type.value,
        ).inc()
    except Exception:
        pass

    log.info(
        "positioning_classified",
        symbol=base_symbol,
        context=pos_analysis.context.value,
        long_short_ratio=round(ls_data["ratio"], 3),
        long_pct=ls_data["long_pct"],
        score_adj=pos_analysis.score_adjustment,
    )

    liq_zones  = detect_liquidation_zones(candles_1h, current_price, atr, funding_rate)
    breakout   = detect_breakout(candles_1h, current_price)
    trend_cont = analyze_trend_continuation(candles_1h, ema20, atr, trend)
    momentum   = calc_momentum_score(
        funding_rate, oi_data["change_24h"], ls_data["ratio"],
        breakout, trend_cont, rsi, trend, signal_type, base_symbol,
        oi_score_adj=oi_analysis.score_adjustment,
        positioning_score_adj=pos_analysis.score_adjustment,
    )

    return FuturesData(
        funding_rate=funding_rate,
        funding_rate_annualized=round(ann, 2),
        funding_bias=funding_bias,
        funding_trend=funding_trend,
        open_interest=oi_data["current"],
        positioning_context=pos_analysis.context,
        oi_change_24h=oi_data["change_24h"],
        oi_trend=oi_trend,
        oi_interpretation=oi_analysis.interpretation,
        long_short_ratio=ls_data["ratio"],
        long_account_percent=ls_data["long_pct"],
        short_account_percent=ls_data["short_pct"],
        liquidation_zones=liq_zones,
        momentum_score=momentum,
        breakout=breakout if breakout.detected else None,
        trend_continuation=trend_cont,
    )


async def _gather_market_data(symbol: str) -> tuple[float, dict, dict]:
    import asyncio
    return await asyncio.gather(
        _get_funding(symbol),
        _get_oi(symbol),
        _get_ls(symbol),
    )
