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
    FuturesData, FundingBias, OITrend,
)
from backend.logging.setup import get_logger

log = get_logger(__name__)

_PRIORITY = {"BTC", "ETH", "SOL"}


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
    funding_rate: float,
    oi_change_24h: float,
    long_short_ratio: float,
    breakout: BreakoutSignal,
    trend_cont: TrendContinuationData,
    rsi: float,
    trend: TrendDirection,
    signal_type: SignalType,
    base_symbol: str,
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

    if signal_type == SignalType.BUY:
        if   oi_change_24h >  5: score += 10
        elif oi_change_24h >  2: score += 5
        elif oi_change_24h < -5: score -= 8
    else:
        if   oi_change_24h < -5: score += 10
        elif oi_change_24h < -2: score += 5
        elif oi_change_24h >  5: score -= 8

    if signal_type == SignalType.BUY  and long_short_ratio < 0.8: score += 8
    if signal_type == SignalType.SELL and long_short_ratio > 1.5: score += 8

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

    liq_zones  = detect_liquidation_zones(candles_1h, current_price, atr, funding_rate)
    breakout   = detect_breakout(candles_1h, current_price)
    trend_cont = analyze_trend_continuation(candles_1h, ema20, atr, trend)
    momentum   = calc_momentum_score(
        funding_rate, oi_data["change_24h"], ls_data["ratio"],
        breakout, trend_cont, rsi, trend, signal_type, base_symbol,
    )

    return FuturesData(
        funding_rate=funding_rate,
        funding_rate_annualized=round(ann, 2),
        funding_bias=funding_bias,
        open_interest=oi_data["current"],
        oi_change_24h=oi_data["change_24h"],
        oi_trend=oi_trend,
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
