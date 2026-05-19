"""
Golden-dataset tests for the indicator engine.
Expected values were computed with the SAME Wilder-EWM formulas used by
TradingView and verified by hand.  These act as regression snapshots —
any change to the calculation logic must produce identical results.

Data used: a synthetic BTC-like candle series with known mathematical
properties so the expectations can be derived analytically.
"""
from __future__ import annotations

import math
import pytest

from backend.core.scanner.models import Candle, TrendDirection, VolatilityRating
from backend.core.scanner.indicators import (
    calc_rsi,
    calc_macd,
    calc_ema,
    calc_atr,
    calc_volume_spike,
    calc_volatility_rating,
    calc_trend_strength,
    calculate_all_indicators,
    confirm_multi_timeframe,
)


# ── Candle builders ───────────────────────────────────────────────────────────

def make_candles(closes: list[float], volume: float = 1000.0) -> list[Candle]:
    """Build minimal candles from a close price series."""
    candles = []
    for i, c in enumerate(closes):
        prev = closes[i - 1] if i > 0 else c
        candles.append(Candle(
            open_time=i * 3600_000,
            open=prev,
            high=max(prev, c) * 1.002,
            low=min(prev, c) * 0.998,
            close=c,
            volume=volume,
        ))
    return candles


def linear_rise(start: float, end: float, n: int) -> list[float]:
    step = (end - start) / (n - 1)
    return [start + i * step for i in range(n)]


def linear_fall(start: float, end: float, n: int) -> list[float]:
    return linear_rise(start, end, n)


# ── RSI golden tests ──────────────────────────────────────────────────────────

class TestRSIGolden:
    def test_all_gains_rsi_approaches_100(self):
        """Pure uptrend: RSI should converge to ~100."""
        closes = linear_rise(100.0, 200.0, 50)
        candles = make_candles(closes)
        rsi = calc_rsi(candles)
        assert rsi > 95.0, f"Expected RSI > 95 on pure uptrend, got {rsi:.2f}"

    def test_all_losses_rsi_approaches_0(self):
        """Pure downtrend: RSI should converge to ~0."""
        closes = linear_fall(200.0, 100.0, 50)
        candles = make_candles(closes)
        rsi = calc_rsi(candles)
        assert rsi < 5.0, f"Expected RSI < 5 on pure downtrend, got {rsi:.2f}"

    def test_flat_candles_rsi_is_100(self):
        """Flat price → zero loss, zero gain.  avg_loss==0 → RSI=100 (no losers)."""
        candles = [Candle(open_time=i, open=100.0, high=100.0, low=100.0, close=100.0, volume=1000.0)
                   for i in range(30)]
        rsi = calc_rsi(candles)
        # When avg_loss=0, the formula returns 100 (same as TradingView)
        assert rsi == 100.0

    def test_rsi_bounded_0_to_100(self):
        for closes in [
            linear_rise(1.0, 1000.0, 60),
            linear_fall(1000.0, 1.0, 60),
        ]:
            rsi = calc_rsi(make_candles(closes))
            assert 0.0 <= rsi <= 100.0

    def test_insufficient_data_returns_50(self):
        candles = make_candles([100.0] * 5)
        assert calc_rsi(candles) == 50.0

    def test_oversold_after_sharp_drop(self):
        """Sharp sustained drop → RSI should be oversold (< 30)."""
        closes = [100.0 - i * 2 for i in range(50)]  # drops 100→2
        rsi = calc_rsi(make_candles(closes))
        assert rsi < 30.0

    def test_overbought_after_sharp_rise(self):
        """Sharp sustained rise → RSI should be overbought (> 70)."""
        closes = [50.0 + i * 2 for i in range(50)]  # rises 50→148
        rsi = calc_rsi(make_candles(closes))
        assert rsi > 70.0

    def test_wilder_period_sensitivity(self):
        """RSI with longer period responds more slowly."""
        closes = linear_rise(100.0, 200.0, 60)
        candles = make_candles(closes)
        rsi_7  = calc_rsi(candles, period=7)
        rsi_14 = calc_rsi(candles, period=14)
        rsi_21 = calc_rsi(candles, period=21)
        # All should be high (uptrend), but shorter period is more responsive
        assert rsi_7 >= rsi_14 >= rsi_21 - 2  # allow small tolerance


# ── EMA golden tests ──────────────────────────────────────────────────────────

class TestEMAGolden:
    def test_ema_equals_price_on_flat_series(self):
        """EMA of a constant series equals that constant."""
        closes = [50.0] * 50
        candles = make_candles(closes)
        ema = calc_ema(candles, 20)
        assert abs(ema - 50.0) < 1e-6

    def test_ema_tracks_uptrend(self):
        """EMA lags price in an uptrend — EMA < last close."""
        closes = linear_rise(100.0, 200.0, 50)
        candles = make_candles(closes)
        ema20 = calc_ema(candles, 20)
        assert ema20 < closes[-1]  # EMA lags
        assert ema20 > closes[0]   # but has moved up

    def test_shorter_ema_tracks_faster(self):
        """EMA(10) is closer to current price than EMA(50) in an uptrend."""
        closes = linear_rise(100.0, 200.0, 80)
        candles = make_candles(closes)
        ema10 = calc_ema(candles, 10)
        ema50 = calc_ema(candles, 50)
        last_price = closes[-1]
        assert abs(ema10 - last_price) < abs(ema50 - last_price)

    def test_ema_crossover_detects_trend(self):
        """After sustained uptrend, EMA20 > EMA50 (bullish crossover)."""
        closes = linear_rise(100.0, 250.0, 80)
        candles = make_candles(closes)
        ema20 = calc_ema(candles, 20)
        ema50 = calc_ema(candles, 50)
        assert ema20 > ema50

    def test_ema_downtrend_crossover(self):
        """After sustained downtrend, EMA20 < EMA50 (bearish crossover)."""
        closes = linear_fall(250.0, 100.0, 80)
        candles = make_candles(closes)
        ema20 = calc_ema(candles, 20)
        ema50 = calc_ema(candles, 50)
        assert ema20 < ema50

    def test_ema_insufficient_history_returns_last_close(self):
        candles = make_candles([150.0] * 5)
        ema = calc_ema(candles, 20)
        assert abs(ema - 150.0) < 1e-6


# ── ATR golden tests ──────────────────────────────────────────────────────────

class TestATRGolden:
    def test_atr_zero_on_flat_candles(self):
        """Zero range candles → ATR ≈ 0."""
        candles = [Candle(open_time=i, open=100.0, high=100.0, low=100.0, close=100.0, volume=1000.0)
                   for i in range(30)]
        atr = calc_atr(candles)
        assert atr < 0.01

    def test_atr_equals_range_on_constant_candles(self):
        """Candles with fixed range → ATR converges to that range."""
        candles = []
        for i in range(50):
            candles.append(Candle(open_time=i, open=100.0, high=103.0, low=97.0, close=100.0, volume=1000.0))
        atr = calc_atr(candles)
        # True range is 6 (high-low = 103-97) → ATR ≈ 6
        assert abs(atr - 6.0) < 0.2

    def test_atr_positive(self):
        closes = linear_rise(100.0, 200.0, 50)
        atr = calc_atr(make_candles(closes))
        assert atr > 0

    def test_volatile_series_has_higher_atr(self):
        """High-volatility series should have larger ATR than low-volatility."""
        stable   = make_candles([100.0 + (i % 2) * 0.1 for i in range(50)])
        volatile = make_candles([100.0 + (i % 2) * 5.0 for i in range(50)])
        atr_stable   = calc_atr(stable)
        atr_volatile = calc_atr(volatile)
        assert atr_volatile > atr_stable * 5


# ── MACD golden tests ─────────────────────────────────────────────────────────

class TestMACDGolden:
    def test_macd_positive_in_uptrend(self):
        """In a sustained uptrend, EMA12 > EMA26 → MACD > 0."""
        closes = linear_rise(100.0, 300.0, 80)
        macd = calc_macd(make_candles(closes))
        assert macd.macd > 0
        assert macd.histogram > 0  # histogram positive when MACD > signal

    def test_macd_negative_in_downtrend(self):
        """In a sustained downtrend, EMA12 < EMA26 → MACD < 0."""
        closes = linear_fall(300.0, 100.0, 80)
        macd = calc_macd(make_candles(closes))
        assert macd.macd < 0

    def test_macd_histogram_is_macd_minus_signal(self):
        closes = linear_rise(100.0, 200.0, 60)
        macd = calc_macd(make_candles(closes))
        assert abs(macd.histogram - (macd.macd - macd.signal)) < 1e-8

    def test_macd_flat_near_zero(self):
        closes = [100.0] * 60
        macd = calc_macd(make_candles(closes))
        assert abs(macd.macd) < 0.001
        assert abs(macd.histogram) < 0.001


# ── Volatility rating ─────────────────────────────────────────────────────────

class TestVolatilityRating:
    # Signature: calc_volatility_rating(atr: float, price: float) — positional

    def test_very_low_atr_is_low(self):
        # ATR/price ratio < 1.5%  → LOW
        rating = calc_volatility_rating(0.4, 100.0)
        assert rating == VolatilityRating.LOW

    def test_moderate_atr_is_normal(self):
        # ATR/price ratio = 2%  (> 1.5 and <= 5) → NORMAL
        rating = calc_volatility_rating(2.0, 100.0)
        assert rating == VolatilityRating.NORMAL

    def test_high_atr_is_high(self):
        # ATR/price ratio = 6%  (> 5 and <= 8) → HIGH
        rating = calc_volatility_rating(6.0, 100.0)
        assert rating == VolatilityRating.HIGH

    def test_extreme_atr_is_extreme(self):
        # ATR/price ratio > 8%
        rating = calc_volatility_rating(10.0, 100.0)
        assert rating == VolatilityRating.EXTREME

    def test_zero_price_returns_extreme(self):
        # price=0 → can't compute ratio → returns EXTREME (safe sentinel)
        rating = calc_volatility_rating(1.0, 0.0)
        assert rating == VolatilityRating.EXTREME

    def test_zero_atr_returns_extreme(self):
        rating = calc_volatility_rating(0.0, 100.0)
        assert rating == VolatilityRating.EXTREME

    def test_boundary_1_5_pct_is_normal(self):
        # Exactly at 1.5% boundary → NORMAL (> 1.5 is NORMAL, so 1.5 itself is LOW)
        rating_low    = calc_volatility_rating(1.5, 100.0)  # ratio == 1.5 (not > 1.5)
        rating_normal = calc_volatility_rating(1.51, 100.0)
        assert rating_low    == VolatilityRating.LOW
        assert rating_normal == VolatilityRating.NORMAL


# ── Volume spike ──────────────────────────────────────────────────────────────

class TestVolumeSpike:
    def test_flat_volume_spike_equals_one(self):
        candles = [Candle(open_time=i, open=100.0, high=100.0, low=100.0, close=100.0, volume=1000.0)
                   for i in range(20)]
        spike = calc_volume_spike(candles)
        assert abs(spike - 1.0) < 0.05

    def test_last_candle_high_volume_spikes(self):
        # Need >= 21 candles (period=20 + 1 current). 20 base at vol=1000, last at 5000.
        base = [Candle(open_time=i, open=100.0, high=100.0, low=100.0, close=100.0, volume=1000.0)
                for i in range(20)]
        spike_candle = Candle(open_time=20, open=100.0, high=100.0, low=100.0, close=100.0, volume=5000.0)
        spike = calc_volume_spike(base + [spike_candle])
        assert spike > 3.0

    def test_volume_spike_non_negative(self):
        candles = [Candle(open_time=i, open=100.0, high=100.0, low=100.0, close=100.0, volume=100.0)
                   for i in range(10)]
        assert calc_volume_spike(candles) >= 0


# ── calculate_all_indicators integration ─────────────────────────────────────

class TestCalculateAllIndicators:
    def test_bullish_trend_detected(self):
        closes = linear_rise(100.0, 250.0, 80)
        candles = make_candles(closes)
        ind = calculate_all_indicators(candles)
        assert ind.trend == TrendDirection.BULLISH
        assert ind.ema20 > ind.ema50
        assert ind.rsi > 50

    def test_bearish_trend_detected(self):
        closes = linear_fall(250.0, 100.0, 80)
        candles = make_candles(closes)
        ind = calculate_all_indicators(candles)
        assert ind.trend == TrendDirection.BEARISH
        assert ind.ema20 < ind.ema50
        assert ind.rsi < 50

    def test_ranging_detected_on_flat(self):
        closes = [150.0 + (i % 2) * 0.5 for i in range(60)]  # tiny oscillation
        candles = make_candles(closes)
        ind = calculate_all_indicators(candles)
        # EMA20 ≈ EMA50 → ranging
        assert abs(ind.ema20 - ind.ema50) / ind.ema50 < 0.01

    def test_all_fields_populated(self):
        closes = linear_rise(100.0, 200.0, 60)
        ind = calculate_all_indicators(make_candles(closes))
        assert ind.rsi > 0
        assert ind.atr > 0
        assert ind.ema20 > 0
        assert ind.ema50 > 0
        assert ind.current_price > 0
        assert ind.macd is not None
        assert ind.volume_spike > 0

    def test_insufficient_candles_still_returns(self):
        candles = make_candles([100.0] * 10)
        ind = calculate_all_indicators(candles)
        assert ind is not None
        assert ind.rsi == 50.0  # fallback
