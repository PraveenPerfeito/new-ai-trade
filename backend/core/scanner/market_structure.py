"""
Market structure filters — 7 gates that run before AI validation.
Direct port of lib/market-structure.ts.

All functions are pure (no I/O, no side effects), accept Candle lists,
and return typed result objects.  This makes them trivially unit-testable
and safe to call concurrently from asyncio.gather batches.

RSI series and ADX are implemented in NumPy rather than pandas-ta because
we need the full historical array (for divergence detection) and an exact
behavioural match with the TypeScript version.
"""
from __future__ import annotations

import numpy as np

from backend.core.scanner.models import Candle, MarketStructureResult, SignalType


# ── Internal math helpers ─────────────────────────────────────────────────────

def _calc_rsi_series(closes: np.ndarray, period: int = 14) -> np.ndarray:
    """
    Wilder-smoothed RSI series.  Fills the initial `period + 1` positions
    with 50.0 (neutral) — same as the TypeScript implementation so divergence
    detection windows are always fully populated.
    """
    n = len(closes)
    if n < period + 2:
        return np.full(n, 50.0)

    changes = np.diff(closes)
    gains   = np.maximum(changes, 0.0)
    losses  = np.maximum(-changes, 0.0)

    result  = np.full(n, 50.0)

    avg_gain = float(gains[:period].mean())
    avg_loss = float(losses[:period].mean())
    rsi0 = 100.0 if avg_loss == 0 else 100.0 - 100.0 / (1.0 + avg_gain / avg_loss)
    result[period + 1] = rsi0

    for i in range(period, len(changes)):
        avg_gain = (avg_gain * (period - 1) + gains[i]) / period
        avg_loss = (avg_loss * (period - 1) + losses[i]) / period
        result[i + 1] = 100.0 if avg_loss == 0 else 100.0 - 100.0 / (1.0 + avg_gain / avg_loss)

    return result


def _calc_adx(candles: list[Candle], period: int = 14) -> float:
    """
    Wilder's ADX.  Returns 25.0 (neutral) when insufficient history.
    Values < 20 indicate a ranging/directionless market.
    """
    if len(candles) < period * 2 + 2:
        return 25.0

    highs  = np.array([c.high  for c in candles], dtype=float)
    lows   = np.array([c.low   for c in candles], dtype=float)
    closes = np.array([c.close for c in candles], dtype=float)

    n    = len(candles) - 1
    trs  = np.maximum.reduce([
        highs[1:] - lows[1:],
        np.abs(highs[1:] - closes[:-1]),
        np.abs(lows[1:]  - closes[:-1]),
    ])

    up   = highs[1:] - highs[:-1]
    down = lows[:-1] - lows[1:]
    dm_p = np.where((up > down) & (up > 0), up, 0.0)
    dm_m = np.where((down > up) & (down > 0), down, 0.0)

    # Wilder seed (simple sum for first `period` values)
    atr14  = float(trs[:period].sum())
    dm14p  = float(dm_p[:period].sum())
    dm14m  = float(dm_m[:period].sum())

    dx_values: list[float] = []
    for i in range(period, n):
        atr14 = atr14 - atr14 / period + trs[i]
        dm14p = dm14p - dm14p / period + dm_p[i]
        dm14m = dm14m - dm14m / period + dm_m[i]

        di_p = (dm14p / atr14 * 100) if atr14 > 0 else 0.0
        di_m = (dm14m / atr14 * 100) if atr14 > 0 else 0.0
        total = di_p + di_m
        dx_values.append(abs(di_p - di_m) / total * 100 if total > 0 else 0.0)

    if len(dx_values) < period:
        return 25.0
    return float(np.mean(dx_values[-period:]))


# ── 1. Sideways market detection ─────────────────────────────────────────────

def detect_sideways_market(
    candles: list[Candle],
    atr: float,
) -> tuple[bool, str, float]:
    """
    Returns (is_sideways, reason, adx).
    Two independent checks must agree (ADX weak AND range compressed) to
    avoid false positives during brand-new trend impulses.
    """
    adx = _calc_adx(candles)

    if len(candles) < 20:
        return False, "", adx

    recent = candles[-20:]
    range_high = max(c.high for c in recent)
    range_low  = min(c.low  for c in recent)
    range_to_atr = (range_high - range_low) / atr if atr > 0 else 99.0

    if adx < 20 and range_to_atr < 3.0:
        return True, f"ADX {adx:.1f} + 20-candle range only {range_to_atr:.1f}× ATR — ranging market, no directional edge", adx

    if adx < 16:
        return True, f"ADX {adx:.1f} < 16 — flat market, trend entry has no edge", adx

    if range_to_atr < 2.0:
        return True, f"20-candle range {range_to_atr:.1f}× ATR — price tightly compressed, likely consolidation", adx

    return False, "", adx


# ── 2. Fake volume spike detection ────────────────────────────────────────────

def is_fake_volume_spike(
    candles: list[Candle],
    volume_spike: float,
    atr: float,
) -> tuple[bool, str]:
    """Returns (is_fake, reason)."""
    if volume_spike < 2.5 or len(candles) < 8:
        return False, ""

    last  = candles[-1]
    rng   = last.high - last.low
    body  = abs(last.close - last.open)

    # Wash-trade signature: huge volume, tiny body relative to range and ATR
    if rng > 0 and body / rng < 0.15 and atr > 0 and rng < atr * 0.35:
        pct = body / rng * 100
        return True, f"Volume {volume_spike:.1f}× but candle body only {pct:.0f}% of range and range < 0.35 ATR — wash trade signature"

    # Isolated spike: ≥ 4 of the 5 prior candles were below average
    if volume_spike >= 3.0 and len(candles) >= 22:
        avg_vol  = sum(c.volume for c in candles[-21:-1]) / 20
        prior_5  = [c.volume for c in candles[-6:-1]]
        low_cnt  = sum(1 for v in prior_5 if v < avg_vol * 0.75)
        if low_cnt >= 4:
            return True, f"Volume spike {volume_spike:.1f}× is isolated — {low_cnt}/5 prior candles below 75% avg, not sustained buying"

    return False, ""


# ── 3. Candle structure analysis ─────────────────────────────────────────────

def analyze_candle_structure(
    candles: list[Candle],
    signal_type: SignalType,
    atr: float,
) -> tuple[bool, str]:
    """Returns (pass, rejection_reason)."""
    if len(candles) < 3:
        return True, ""

    last = candles[-1]
    prev = candles[-2]
    rng  = last.high - last.low
    if rng == 0:
        return True, ""

    body         = abs(last.close - last.open)
    upper_wick   = last.high - max(last.open, last.close)
    lower_wick   = min(last.open, last.close) - last.low
    body_ratio   = body / rng
    upper_ratio  = upper_wick / rng
    lower_ratio  = lower_wick / rng

    if signal_type == SignalType.BUY:
        if upper_ratio > 0.62 and body_ratio < 0.20:
            return False, f"Bearish rejection candle: upper wick {upper_ratio*100:.0f}% of range, body {body_ratio*100:.0f}% — sellers rejected the high"
        prev_body = abs(prev.close - prev.open)
        if last.close < last.open and prev.close > prev.open and body > prev_body * 1.1:
            return False, "Bearish engulfing: momentum reversal — avoid BUY entry"
    else:
        if lower_ratio > 0.62 and body_ratio < 0.20:
            return False, f"Bullish bounce candle: lower wick {lower_ratio*100:.0f}% of range, body {body_ratio*100:.0f}% — buyers absorbed the dip"
        prev_body = abs(prev.close - prev.open)
        if last.close > last.open and prev.close < prev.open and body > prev_body * 1.1:
            return False, "Bullish engulfing: momentum reversal — avoid SELL entry"

    if body_ratio < 0.08 and rng >= atr * 0.4:
        return False, f"Doji: body only {body_ratio*100:.0f}% of range on a {rng/atr:.1f}× ATR candle — market indecision at this level"

    return True, ""


# ── 4. Trend exhaustion detection ─────────────────────────────────────────────

def detect_trend_exhaustion(
    candles: list[Candle],
    signal_type: SignalType,
) -> tuple[bool, str]:
    """
    Returns (is_exhausted, reason).
    Detects RSI divergence over a 20-candle window and sustained
    overbought/oversold RSI extension (5+ consecutive candles).
    """
    if len(candles) < 30:
        return False, ""

    closes = np.array([c.close for c in candles], dtype=float)
    highs  = np.array([c.high  for c in candles], dtype=float)
    lows   = np.array([c.low   for c in candles], dtype=float)
    rsi_arr = _calc_rsi_series(closes)

    n   = 20
    mid = n // 2
    rsi_win = rsi_arr[-n:]
    hi_win  = highs[-n:]
    lo_win  = lows[-n:]

    if signal_type == SignalType.BUY:
        ph_old = hi_win[:mid].max()
        ph_new = hi_win[mid:].max()
        rh_old = rsi_win[:mid].max()
        rh_new = rsi_win[mid:].max()

        if ph_new > ph_old * 1.008 and rh_new < rh_old - 4:
            pct = (ph_new / ph_old - 1) * 100
            return True, f"Bearish RSI divergence: price high +{pct:.1f}% but RSI high fell {rh_old - rh_new:.1f}pts — momentum fading"

        if all(r > 73 for r in rsi_win[-5:]):
            return True, "RSI sustained above 73 for 5 consecutive candles — overbought extension, reversal risk high"
    else:
        pl_old = lo_win[:mid].min()
        pl_new = lo_win[mid:].min()
        rl_old = rsi_win[:mid].min()
        rl_new = rsi_win[mid:].min()

        if pl_new < pl_old * 0.992 and rl_new > rl_old + 4:
            pct = (1 - pl_new / pl_old) * 100
            return True, f"Bullish RSI divergence: price low -{pct:.1f}% but RSI low rose {rl_new - rl_old:.1f}pts — downtrend losing steam"

        if all(r < 27 for r in rsi_win[-5:]):
            return True, "RSI sustained below 27 for 5 consecutive candles — oversold extension, bounce risk high"

    return False, ""


# ── 5. Support / resistance rejection zone detection ──────────────────────────

def detect_sr_rejection(
    candles: list[Candle],
    current_price: float,
    atr: float,
    signal_type: SignalType,
) -> tuple[bool, str]:
    """
    Returns (is_near_rejection, reason).
    Pivot highs/lows use a ±3 candle window on the last 50 candles.
    Two or more pivots within 1.2× ATR overhead/below triggers a rejection.
    """
    if len(candles) < 30 or atr == 0:
        return False, ""

    lookback = candles[-50:]
    pw = 3
    pivot_highs: list[float] = []
    pivot_lows:  list[float] = []

    for i in range(pw, len(lookback) - pw):
        h = lookback[i].high
        l = lookback[i].low
        band = lookback[i - pw : i + pw + 1]
        if all(c.high <= h for c in band):
            pivot_highs.append(h)
        if all(c.low >= l for c in band):
            pivot_lows.append(l)

    threshold = atr * 1.2

    if signal_type == SignalType.BUY:
        overhead = [h for h in pivot_highs if current_price < h < current_price + threshold]
        if len(overhead) >= 2:
            return True, f"{len(overhead)} resistance pivots within 1.2× ATR overhead — price entering a tested rejection zone"
    else:
        underfoot = [l for l in pivot_lows if current_price - threshold < l < current_price]
        if len(underfoot) >= 2:
            return True, f"{len(underfoot)} support pivots within 1.2× ATR below — price entering a tested bounce zone"

    return False, ""


# ── 6. Overextended candle detection ──────────────────────────────────────────

def detect_overextension(
    candles: list[Candle],
    atr: float,
    signal_type: SignalType,
) -> tuple[bool, str, float]:
    """Returns (is_overextended, reason, factor)."""
    if len(candles) < 4 or atr == 0:
        return False, "", 1.0

    last          = candles[-1]
    single_range  = last.high - last.low
    single_factor = single_range / atr

    if single_factor > 3.0:
        return True, f"Last candle range {single_factor:.1f}× ATR — abnormally large, likely news-driven move", single_factor

    last3 = candles[-3:]
    if signal_type == SignalType.BUY:
        move3 = last3[2].close - last3[0].open
    else:
        move3 = last3[0].open - last3[2].close
    run3 = move3 / atr

    if run3 > 4.0:
        return True, f"3-candle run of {run3:.1f}× ATR — overextended, mean reversion likely before continuation", run3

    return False, "", max(single_factor, run3)


# ── 7. Weak breakout detection ─────────────────────────────────────────────────

def analyze_breakout_strength(
    candles: list[Candle],
    atr: float,
    volume_spike: float,
    signal_type: SignalType,
) -> tuple[bool, str]:
    """Returns (is_weak, reason)."""
    if len(candles) < 27 or atr == 0:
        return False, ""

    reference = candles[-26:-1]   # 25 prior candles
    last      = candles[-1]

    if signal_type == SignalType.BUY:
        res_close = max(c.close for c in reference)
        res_high  = max(c.high  for c in reference)

        if last.high > res_high and last.close < res_close:
            return True, f"Failed breakout: wick above {res_high:.4f} resistance but closed below — stop hunt / rejection"

        margin = last.close - res_close
        if margin > 0 and margin < atr * 0.25 and volume_spike < 1.3:
            return True, f"Weak breakout: only {margin/atr*100:.0f}% ATR above resistance with {volume_spike:.1f}× volume — no conviction"
    else:
        sup_close = min(c.close for c in reference)
        sup_low   = min(c.low   for c in reference)

        if last.low < sup_low and last.close > sup_close:
            return True, f"Failed breakdown: wick below {sup_low:.4f} support but closed above — stop hunt / bounce"

        margin = sup_close - last.close
        if margin > 0 and margin < atr * 0.25 and volume_spike < 1.3:
            return True, f"Weak breakdown: only {margin/atr*100:.0f}% ATR below support with {volume_spike:.1f}× volume — no conviction"

    return False, ""


# ── Aggregate gate ─────────────────────────────────────────────────────────────

def run_market_structure_checks(
    candles:       list[Candle],
    atr:           float,
    current_price: float,
    volume_spike:  float,
    signal_type:   SignalType,
) -> MarketStructureResult:
    """
    Runs all 7 filters cheapest-to-most-expensive and short-circuits on
    the first hard reject.  Mirrors runMarketStructureChecks() from
    lib/market-structure.ts.
    """
    is_sideways, sideways_reason, adx = detect_sideways_market(candles, atr)
    if is_sideways:
        return MarketStructureResult(**{"pass": False, "rejection_reason": sideways_reason, "adx": adx})

    is_overext, overext_reason, _ = detect_overextension(candles, atr, signal_type)
    if is_overext:
        return MarketStructureResult(**{"pass": False, "rejection_reason": overext_reason, "adx": adx})

    candle_ok, candle_reason = analyze_candle_structure(candles, signal_type, atr)
    if not candle_ok:
        return MarketStructureResult(**{"pass": False, "rejection_reason": candle_reason, "adx": adx})

    is_exhausted, exhaustion_reason = detect_trend_exhaustion(candles, signal_type)
    if is_exhausted:
        return MarketStructureResult(**{"pass": False, "rejection_reason": exhaustion_reason, "adx": adx})

    is_fake, fake_reason = is_fake_volume_spike(candles, volume_spike, atr)
    if is_fake:
        return MarketStructureResult(**{"pass": False, "rejection_reason": fake_reason, "adx": adx})

    is_sr, sr_reason = detect_sr_rejection(candles, current_price, atr, signal_type)
    if is_sr:
        return MarketStructureResult(**{"pass": False, "rejection_reason": sr_reason, "adx": adx})

    is_weak, weak_reason = analyze_breakout_strength(candles, atr, volume_spike, signal_type)
    if is_weak:
        return MarketStructureResult(**{"pass": False, "rejection_reason": weak_reason, "adx": adx})

    return MarketStructureResult(**{"pass": True, "rejection_reason": None, "adx": adx})
