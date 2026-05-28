"""
Technical indicator calculations.
Implemented in pure pandas/numpy using Wilder's EWM smoothing so results
match TradingView exactly on all Python versions.

TradingView formula references used:
  EMA   → ewm(span=N, adjust=False)
  RSI   → Wilder: ewm(alpha=1/N, adjust=False) on gains/losses
  ATR   → Wilder: ewm(alpha=1/N, adjust=False) on true range
  MACD  → EMA(12) − EMA(26); signal = EMA(9) of MACD line

pandas-ta is not a runtime dependency here; the same math is
expressed directly through pandas so it works on every Python version,
including Python 3.14 where numba (a pandas-ta dep) is not yet available.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from backend.core.scanner.models import (
    Candle,
    MACDResult,
    BollingerBands,
    TechnicalIndicators,
    TrendDirection,
    VolatilityRating,
    MultiTimeframeResult,
    MTFAlignment,
    SignalType,
)


# ── DataFrame helpers ─────────────────────────────────────────────────────────

def _to_series(candles: list[Candle]) -> dict[str, pd.Series]:
    """Convert a Candle list to individual named pandas Series."""
    return {
        "open":   pd.Series([c.open   for c in candles], dtype=float),
        "high":   pd.Series([c.high   for c in candles], dtype=float),
        "low":    pd.Series([c.low    for c in candles], dtype=float),
        "close":  pd.Series([c.close  for c in candles], dtype=float),
        "volume": pd.Series([c.volume for c in candles], dtype=float),
    }


def _last(series: pd.Series, fallback: float = 0.0) -> float:
    """Return the last non-NaN value of a Series, or fallback."""
    valid = series.dropna()
    return float(valid.iloc[-1]) if not valid.empty else fallback


# ── Core calculations ─────────────────────────────────────────────────────────

def calc_rsi(candles: list[Candle], period: int = 14) -> float:
    """
    Wilder-smoothed RSI.  Matches TradingView's RSI indicator.
    Returns 50.0 when there is insufficient history.

    Implementation: seed average gain/loss with a simple mean over the
    first `period` deltas, then apply Wilder's EMA (alpha = 1/period).
    This is identical to the TypeScript version and TradingView.
    """
    closes = pd.Series([c.close for c in candles], dtype=float)
    if len(closes) < period + 1:
        return 50.0

    delta = closes.diff().dropna()
    gain  = delta.clip(lower=0.0)
    loss  = (-delta).clip(lower=0.0)

    # Wilder smoothing: seed with SMA of first `period` values, then EWM
    avg_gain = gain.ewm(alpha=1.0 / period, min_periods=period, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1.0 / period, min_periods=period, adjust=False).mean()

    last_gain = _last(avg_gain, 0.0)
    last_loss = _last(avg_loss, 0.0)

    if last_loss == 0.0:
        return 100.0
    return float(100.0 - 100.0 / (1.0 + last_gain / last_loss))


def calc_macd(candles: list[Candle]) -> MACDResult:
    """
    Standard MACD: EMA(12) − EMA(26), signal = EMA(9) of MACD line.
    Matches TradingView MACD.  Returns zeros when < 35 candles.
    """
    closes = pd.Series([c.close for c in candles], dtype=float)
    if len(closes) < 35:
        return MACDResult(macd=0.0, signal=0.0, histogram=0.0)

    ema12   = closes.ewm(span=12, adjust=False).mean()
    ema26   = closes.ewm(span=26, adjust=False).mean()
    macd    = ema12 - ema26
    sig     = macd.ewm(span=9, adjust=False).mean()
    hist    = macd - sig

    return MACDResult(
        macd      = _last(macd,    0.0),
        signal    = _last(sig,     0.0),
        histogram = _last(hist,    0.0),
    )


def calc_ema(candles: list[Candle], period: int) -> float:
    """Last EMA value. Falls back to current close when insufficient history."""
    closes = pd.Series([c.close for c in candles], dtype=float)
    result = closes.ewm(span=period, adjust=False).mean()
    return _last(result, float(closes.iloc[-1]) if not closes.empty else 0.0)


def calc_atr(candles: list[Candle], period: int = 14) -> float:
    """
    Wilder-smoothed ATR.  Matches TradingView ATR (RMA smoothing).
    Returns 0.0 when insufficient history.
    """
    if len(candles) < period + 1:
        return 0.0

    highs  = pd.Series([c.high  for c in candles], dtype=float)
    lows   = pd.Series([c.low   for c in candles], dtype=float)
    closes = pd.Series([c.close for c in candles], dtype=float)

    prev_close = closes.shift(1)
    tr = pd.concat([
        highs - lows,
        (highs - prev_close).abs(),
        (lows  - prev_close).abs(),
    ], axis=1).max(axis=1)

    atr = tr.ewm(alpha=1.0 / period, min_periods=period, adjust=False).mean()
    return max(0.0, _last(atr, 0.0))


def calc_volume_spike(candles: list[Candle], period: int = 20) -> float:
    """
    Ratio of the latest candle's volume to the rolling mean of the prior
    `period` candles (excluding the current candle to avoid self-reference).
    Capped at 10× to suppress outlier distortion.
    Returns 1.0 when insufficient history.
    """
    if len(candles) < period + 1:
        return 1.0

    volumes = pd.Series([c.volume for c in candles], dtype=float)
    avg_vol = float(volumes.iloc[-(period + 1):-1].mean())
    if avg_vol == 0.0:
        return 1.0

    return float(min(10.0, volumes.iloc[-1] / avg_vol))


# ── EMA crossover freshness ───────────────────────────────────────────────────

def detect_ema_crossover(
    candles: list[Candle],
    fast: int = 20,
    slow: int = 50,
    lookback: int = 5,
) -> str:
    """
    Returns 'GOLDEN_CROSS' if EMA-fast crossed above EMA-slow within the last
    `lookback` candles, 'DEATH_CROSS' if it crossed below, or '' if no recent cross.

    A fresh cross (happened today) is far more powerful than a stale one (happened
    2 weeks ago) — this lets the setup scorer reward fresh momentum.
    """
    closes = pd.Series([c.close for c in candles], dtype=float)
    if len(closes) < slow + lookback + 2:
        return ""

    ema_fast = closes.ewm(span=fast, adjust=False).mean()
    ema_slow = closes.ewm(span=slow, adjust=False).mean()

    for i in range(-(lookback + 1), -1):
        pf, ps = float(ema_fast.iloc[i - 1]), float(ema_slow.iloc[i - 1])
        cf, cs = float(ema_fast.iloc[i]),     float(ema_slow.iloc[i])
        if pf <= ps and cf > cs:
            return "GOLDEN_CROSS"
        if pf >= ps and cf < cs:
            return "DEATH_CROSS"

    return ""


# ── Bollinger Bands ───────────────────────────────────────────────────────────

def calc_bollinger_bands(candles: list[Candle], period: int = 20, std_dev: float = 2.0) -> BollingerBands:
    """
    Standard Bollinger Bands (SMA ± 2σ) with squeeze detection.
    Squeeze = current band width < 80% of 20-period average width (compression before explosion).
    """
    closes = pd.Series([c.close for c in candles], dtype=float)
    if len(closes) < period:
        p = float(closes.iloc[-1]) if not closes.empty else 1.0
        return BollingerBands(upper=p * 1.02, middle=p, lower=p * 0.98, width=0.04, squeeze=False)

    sma    = closes.rolling(period).mean()
    std    = closes.rolling(period).std()
    upper  = sma + std_dev * std
    lower  = sma - std_dev * std
    widths = (upper - lower) / sma.replace(0, np.nan)

    last_mid    = _last(sma,    float(closes.iloc[-1]))
    last_upper  = _last(upper,  last_mid * 1.02)
    last_lower  = _last(lower,  last_mid * 0.98)
    last_width  = (last_upper - last_lower) / last_mid if last_mid > 0 else 0.04
    avg_width   = _last(widths.rolling(20).mean(), last_width)
    squeeze     = last_width < avg_width * 0.8

    return BollingerBands(
        upper   = round(last_upper,  8),
        middle  = round(last_mid,    8),
        lower   = round(last_lower,  8),
        width   = round(last_width,  6),
        squeeze = squeeze,
    )


# ── Candlestick pattern detection ─────────────────────────────────────────────

def detect_candlestick_pattern(candles: list[Candle]) -> str:
    """
    Detect high-probability candlestick reversal / continuation patterns.
    Returns a pattern name or "" if none found.

    Patterns detected:
      Reversal:     HAMMER, INVERTED_HAMMER, SHOOTING_STAR, HANGING_MAN,
                    MORNING_STAR, EVENING_STAR
      Continuation: THREE_WHITE_SOLDIERS, THREE_BLACK_CROWS, BULLISH_MARUBOZU,
                    BEARISH_MARUBOZU
    """
    if len(candles) < 3:
        return ""

    c1, c2, c3 = candles[-3], candles[-2], candles[-1]  # oldest → newest

    def _parts(c: Candle):
        rng = c.high - c.low
        if rng == 0:
            return 0.0, 0.0, 0.0, 0.0
        body        = abs(c.close - c.open)
        upper_wick  = c.high - max(c.open, c.close)
        lower_wick  = min(c.open, c.close) - c.low
        return body / rng, upper_wick / rng, lower_wick / rng, rng

    b3, uw3, lw3, rng3 = _parts(c3)
    b2, uw2, lw2, rng2 = _parts(c2)
    b1, uw1, lw1, rng1 = _parts(c1)

    # ── Single-candle patterns ────────────────────────────────────────────────

    # HAMMER — long lower wick, small body at top, at a low (BUY signal)
    if lw3 >= 0.60 and b3 <= 0.25 and uw3 <= 0.15:
        prev_lows = [c.low for c in candles[-6:-1]]
        if prev_lows and c3.low <= min(prev_lows) * 1.01:
            return "HAMMER"

    # INVERTED_HAMMER — long upper wick, small body at bottom, at a low (BUY signal)
    if uw3 >= 0.55 and b3 <= 0.25 and lw3 <= 0.20:
        prev_lows = [c.low for c in candles[-6:-1]]
        if prev_lows and c3.low <= min(prev_lows) * 1.015:
            return "INVERTED_HAMMER"

    # SHOOTING_STAR — long upper wick, small body at bottom, at a high (SELL signal)
    if uw3 >= 0.60 and b3 <= 0.25 and lw3 <= 0.15:
        prev_highs = [c.high for c in candles[-6:-1]]
        if prev_highs and c3.high >= max(prev_highs) * 0.99:
            return "SHOOTING_STAR"

    # HANGING_MAN — like hammer but at highs (SELL signal)
    if lw3 >= 0.60 and b3 <= 0.25 and uw3 <= 0.15:
        prev_highs = [c.high for c in candles[-6:-1]]
        if prev_highs and c3.high >= max(prev_highs) * 0.99:
            return "HANGING_MAN"

    # BULLISH_MARUBOZU — full-body bullish candle, near-zero wicks (strong BUY)
    if c3.close > c3.open and b3 >= 0.90 and rng3 > 0:
        return "BULLISH_MARUBOZU"

    # BEARISH_MARUBOZU — full-body bearish candle, near-zero wicks (strong SELL)
    if c3.close < c3.open and b3 >= 0.90 and rng3 > 0:
        return "BEARISH_MARUBOZU"

    # ── Three-candle patterns ─────────────────────────────────────────────────

    # MORNING_STAR — bearish large + small indecision + bullish large (BUY reversal)
    if (c1.close < c1.open and b1 >= 0.55           # strong bearish
            and b2 <= 0.30                            # indecision/doji middle
            and c3.close > c3.open and b3 >= 0.45    # strong bullish
            and c3.close > (c1.open + c1.close) / 2):
        return "MORNING_STAR"

    # EVENING_STAR — bullish large + small indecision + bearish large (SELL reversal)
    if (c1.close > c1.open and b1 >= 0.55
            and b2 <= 0.30
            and c3.close < c3.open and b3 >= 0.45
            and c3.close < (c1.open + c1.close) / 2):
        return "EVENING_STAR"

    # THREE_WHITE_SOLDIERS — 3 consecutive bullish candles, each higher close (BUY continuation)
    if (c1.close > c1.open and c2.close > c2.open and c3.close > c3.open
            and c3.close > c2.close > c1.close
            and b1 >= 0.50 and b2 >= 0.50 and b3 >= 0.50):
        return "THREE_WHITE_SOLDIERS"

    # THREE_BLACK_CROWS — 3 consecutive bearish candles, each lower close (SELL continuation)
    if (c1.close < c1.open and c2.close < c2.open and c3.close < c3.open
            and c3.close < c2.close < c1.close
            and b1 >= 0.50 and b2 >= 0.50 and b3 >= 0.50):
        return "THREE_BLACK_CROWS"

    return ""


# ── Full indicator suite ──────────────────────────────────────────────────────

def calculate_all_indicators(candles: list[Candle]) -> TechnicalIndicators:
    """
    Compute the complete indicator set for one timeframe.
    Accepts raw Candle objects; returns a fully-typed TechnicalIndicators model.
    """
    s = _to_series(candles)
    closes = s["close"]

    ema20_series  = closes.ewm(span=20,  adjust=False).mean()
    ema50_series  = closes.ewm(span=50,  adjust=False).mean()
    ema200_series = closes.ewm(span=200, adjust=False).mean()

    current_price = float(closes.iloc[-1])
    ema20  = _last(ema20_series,  current_price)
    ema50  = _last(ema50_series,  current_price)
    ema200 = _last(ema200_series, current_price)

    rsi          = calc_rsi(candles)
    macd         = calc_macd(candles)
    atr          = calc_atr(candles)
    volume_spike = calc_volume_spike(candles)
    bb           = calc_bollinger_bands(candles)
    pattern      = detect_candlestick_pattern(candles)
    ema_cross    = detect_ema_crossover(candles)

    if ema20 > ema50 and current_price > ema20:
        trend = TrendDirection.BULLISH
    elif ema20 < ema50 and current_price < ema20:
        trend = TrendDirection.BEARISH
    else:
        trend = TrendDirection.RANGING

    return TechnicalIndicators(
        rsi            = rsi,
        macd           = macd,
        ema20          = ema20,
        ema50          = ema50,
        ema200         = ema200,
        bb             = bb,
        atr            = atr,
        volume_spike   = volume_spike,
        current_price  = current_price,
        trend          = trend,
        candle_pattern = pattern,
        ema_cross      = ema_cross,
    )


# ── Volatility classification ─────────────────────────────────────────────────

def calc_volatility_rating(atr: float, price: float) -> VolatilityRating:
    """
    ATR as a percentage of price → volatility regime.
    Thresholds calibrated for top-100 crypto assets on 1h candles.
    """
    if price == 0.0 or atr == 0.0:
        return VolatilityRating.EXTREME

    atr_pct = (atr / price) * 100.0
    if atr_pct > 8.0:   return VolatilityRating.EXTREME
    if atr_pct > 5.0:   return VolatilityRating.HIGH
    if atr_pct > 1.5:   return VolatilityRating.NORMAL
    return VolatilityRating.LOW


# ── Trend strength scoring ────────────────────────────────────────────────────

def calc_trend_strength(ind: TechnicalIndicators) -> float:
    """
    0–100 composite score for trend quality.

    EMA separation  (0-30): % gap between EMA20 and EMA50 / price
    RSI momentum    (0-25): |RSI − 50|
    MACD force      (0-25): |histogram| / ATR  (price-normalised)
    Volume support  (0-20): volume spike tier
    """
    price = ind.current_price or 1.0

    ema_sep_pct = abs(ind.ema20 - ind.ema50) / price
    ema_pts     = min(30.0, ema_sep_pct * 2500.0)

    rsi_pts = min(25.0, abs(ind.rsi - 50.0) * 0.7)

    macd_rel = abs(ind.macd.histogram) / ind.atr if ind.atr > 0.0 else 0.0
    macd_pts = min(25.0, macd_rel * 150.0)

    vs = ind.volume_spike
    if   vs >= 2.5: vol_pts = 20.0
    elif vs >= 1.8: vol_pts = 16.0
    elif vs >= 1.4: vol_pts = 10.0
    elif vs >= 1.1: vol_pts = 4.0
    else:           vol_pts = 0.0

    return min(100.0, ema_pts + rsi_pts + macd_pts + vol_pts)


# ── Multi-timeframe confirmation ──────────────────────────────────────────────

def confirm_multi_timeframe(
    ind_1h:      TechnicalIndicators,
    ind_4h:      TechnicalIndicators,
    signal_type: SignalType,
) -> MultiTimeframeResult:
    """
    Confirms the 1h entry signal aligns with the 4h macro trend.
    Mirrors confirmMultiTimeframe() from lib/indicators.ts exactly.
    """
    if signal_type == SignalType.BUY:
        if ind_4h.trend != TrendDirection.BULLISH:
            return MultiTimeframeResult(confirmed=False, reason="4h trend not bullish — macro direction against signal", alignment=MTFAlignment.CONFLICTED)
        if ind_4h.rsi > 72:
            return MultiTimeframeResult(confirmed=False, reason=f"4h RSI overbought at {ind_4h.rsi:.1f} — late entry risk", alignment=MTFAlignment.CONFLICTED)
        if ind_1h.trend != TrendDirection.BULLISH:
            return MultiTimeframeResult(confirmed=False, reason="1h trend not bullish — entry TF diverging from 4h", alignment=MTFAlignment.CONFLICTED)
        if ind_4h.macd.histogram < 0:
            return MultiTimeframeResult(confirmed=False, reason="4h MACD histogram negative — 4h momentum fading", alignment=MTFAlignment.CONFLICTED)
    else:
        if ind_4h.trend != TrendDirection.BEARISH:
            return MultiTimeframeResult(confirmed=False, reason="4h trend not bearish — macro direction against signal", alignment=MTFAlignment.CONFLICTED)
        if ind_4h.rsi < 28:
            return MultiTimeframeResult(confirmed=False, reason=f"4h RSI oversold at {ind_4h.rsi:.1f} — late entry risk", alignment=MTFAlignment.CONFLICTED)
        if ind_1h.trend != TrendDirection.BEARISH:
            return MultiTimeframeResult(confirmed=False, reason="1h trend not bearish — entry TF diverging from 4h", alignment=MTFAlignment.CONFLICTED)
        if ind_4h.macd.histogram > 0:
            return MultiTimeframeResult(confirmed=False, reason="4h MACD histogram positive — 4h momentum fading", alignment=MTFAlignment.CONFLICTED)

    if signal_type == SignalType.BUY:
        is_strong = (ind_4h.rsi >= 55 and ind_1h.rsi >= 52
                     and ind_4h.macd.histogram > 0 and ind_1h.macd.histogram > 0)
    else:
        is_strong = (ind_4h.rsi <= 45 and ind_1h.rsi <= 48
                     and ind_4h.macd.histogram < 0 and ind_1h.macd.histogram < 0)

    direction = "bullish" if signal_type == SignalType.BUY else "bearish"
    return MultiTimeframeResult(
        confirmed = True,
        reason    = f"1h + 4h both {direction} — MTF confirmed",
        alignment = MTFAlignment.STRONG if is_strong else MTFAlignment.WEAK,
    )
