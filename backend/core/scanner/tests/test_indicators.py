"""
Unit tests for backend/core/scanner/indicators.py.
All tests use synthetic data with known mathematical properties
so the expected outputs are deterministic.
"""
from __future__ import annotations

import math

import pytest

from backend.core.scanner.models import (
    Candle,
    MACDResult,
    TrendDirection,
    VolatilityRating,
    SignalType,
)
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


# ── Candle factories ──────────────────────────────────────────────────────────

def flat_candles(price: float, n: int, volume: float = 1000.0) -> list[Candle]:
    return [Candle(open_time=i, open=price, high=price, low=price, close=price, volume=volume) for i in range(n)]


def trending_candles(start: float, step: float, n: int, volume: float = 1000.0) -> list[Candle]:
    candles = []
    p = start
    for i in range(n):
        p += step
        candles.append(Candle(open_time=i, open=p - step, high=p + abs(step), low=p - abs(step), close=p, volume=volume))
    return candles


def alternating_candles(mid: float, amplitude: float, n: int) -> list[Candle]:
    candles = []
    for i in range(n):
        p = mid + amplitude if i % 2 == 0 else mid - amplitude
        candles.append(Candle(open_time=i, open=mid, high=mid + amplitude, low=mid - amplitude, close=p, volume=1000.0))
    return candles


# ── RSI tests ─────────────────────────────────────────────────────────────────

class TestCalcRSI:
    def test_insufficient_history_returns_50(self):
        candles = flat_candles(100.0, 5)
        assert calc_rsi(candles) == 50.0

    def test_constant_price_rsi_not_well_defined(self):
        candles = flat_candles(100.0, 50)
        # Flat price → zero changes → RSI implementation-dependent (often 50 or 100)
        rsi = calc_rsi(candles)
        assert 0 <= rsi <= 100

    def test_rising_prices_rsi_above_50(self):
        candles = trending_candles(100.0, 1.0, 60)
        rsi = calc_rsi(candles)
        assert rsi > 50

    def test_falling_prices_rsi_below_50(self):
        candles = trending_candles(200.0, -1.0, 60)
        rsi = calc_rsi(candles)
        assert rsi < 50

    def test_strongly_rising_prices_rsi_above_70(self):
        candles = trending_candles(100.0, 2.0, 80)
        rsi = calc_rsi(candles)
        assert rsi > 70

    def test_rsi_bounded(self):
        for n in [10, 20, 60]:
            candles = trending_candles(50.0, 3.0, n)
            rsi = calc_rsi(candles)
            assert 0 <= rsi <= 100


# ── MACD tests ────────────────────────────────────────────────────────────────

class TestCalcMACD:
    def test_insufficient_history_returns_zeros(self):
        candles = flat_candles(100.0, 20)
        result = calc_macd(candles)
        assert result.macd == 0.0
        assert result.signal == 0.0
        assert result.histogram == 0.0

    def test_histogram_is_macd_minus_signal(self):
        candles = trending_candles(100.0, 0.5, 100)
        result = calc_macd(candles)
        assert abs(result.histogram - (result.macd - result.signal)) < 1e-6

    def test_rising_trend_positive_histogram(self):
        candles = trending_candles(100.0, 1.0, 80)
        result = calc_macd(candles)
        assert result.histogram > 0

    def test_falling_trend_negative_histogram(self):
        candles = trending_candles(300.0, -1.0, 80)
        result = calc_macd(candles)
        assert result.histogram < 0


# ── EMA tests ─────────────────────────────────────────────────────────────────

class TestCalcEMA:
    def test_constant_price_ema_equals_price(self):
        candles = flat_candles(100.0, 60)
        ema = calc_ema(candles, period=20)
        assert abs(ema - 100.0) < 0.01

    def test_rising_ema20_below_current_price(self):
        candles = trending_candles(100.0, 1.0, 80)
        ema20 = calc_ema(candles, period=20)
        current = candles[-1].close
        assert ema20 < current

    def test_ema20_closer_to_current_than_ema50(self):
        candles = trending_candles(100.0, 1.0, 80)
        ema20 = calc_ema(candles, period=20)
        ema50 = calc_ema(candles, period=50)
        current = candles[-1].close
        assert abs(current - ema20) < abs(current - ema50)


# ── ATR tests ─────────────────────────────────────────────────────────────────

class TestCalcATR:
    def test_zero_range_candles_near_zero_atr(self):
        candles = flat_candles(100.0, 50)
        atr = calc_atr(candles)
        assert atr >= 0

    def test_wide_range_candles_higher_atr(self):
        narrow = [Candle(open_time=i, open=100, high=100.5, low=99.5, close=100, volume=1000) for i in range(50)]
        wide   = [Candle(open_time=i, open=100, high=105.0, low=95.0, close=100, volume=1000) for i in range(50)]
        atr_narrow = calc_atr(narrow)
        atr_wide   = calc_atr(wide)
        assert atr_wide > atr_narrow

    def test_atr_is_non_negative(self):
        candles = trending_candles(100.0, 2.0, 60)
        assert calc_atr(candles) >= 0


# ── Volume spike tests ────────────────────────────────────────────────────────

class TestCalcVolumeSpike:
    def test_insufficient_history_returns_one(self):
        candles = flat_candles(100.0, 10)
        assert calc_volume_spike(candles) == 1.0

    def test_uniform_volume_returns_one(self):
        candles = flat_candles(100.0, 40, volume=1000.0)
        spike = calc_volume_spike(candles)
        assert abs(spike - 1.0) < 0.05

    def test_high_last_volume_returns_high_spike(self):
        candles = flat_candles(100.0, 25, volume=1000.0)
        candles[-1] = Candle(open_time=24, open=100, high=100, low=100, close=100, volume=5000.0)
        spike = calc_volume_spike(candles)
        assert spike > 1.5

    def test_capped_at_ten(self):
        candles = flat_candles(100.0, 25, volume=1.0)
        candles[-1] = Candle(open_time=24, open=100, high=100, low=100, close=100, volume=1_000_000.0)
        assert calc_volume_spike(candles) == 10.0


# ── Volatility rating tests ───────────────────────────────────────────────────

class TestCalcVolatilityRating:
    def test_zero_price_returns_extreme(self):
        assert calc_volatility_rating(1.0, 0.0) == VolatilityRating.EXTREME

    def test_extreme(self):
        assert calc_volatility_rating(9.0, 100.0) == VolatilityRating.EXTREME  # 9%

    def test_high(self):
        assert calc_volatility_rating(6.0, 100.0) == VolatilityRating.HIGH     # 6%

    def test_normal(self):
        assert calc_volatility_rating(3.0, 100.0) == VolatilityRating.NORMAL   # 3%

    def test_low(self):
        assert calc_volatility_rating(1.0, 100.0) == VolatilityRating.LOW      # 1%

    def test_boundary_5pct_is_high(self):
        # 5.0% is just above threshold (>5 → EXTREME, >5 not satisfied, >5 == 5 is not >5)
        assert calc_volatility_rating(5.1, 100.0) == VolatilityRating.HIGH


# ── calculate_all_indicators integration test ─────────────────────────────────

class TestCalculateAllIndicators:
    def test_rising_trend_is_bullish(self):
        candles = trending_candles(100.0, 1.5, 100)
        ind = calculate_all_indicators(candles)
        assert ind.trend == TrendDirection.BULLISH

    def test_falling_trend_is_bearish(self):
        candles = trending_candles(500.0, -1.5, 100)
        ind = calculate_all_indicators(candles)
        assert ind.trend == TrendDirection.BEARISH

    def test_current_price_matches_last_close(self):
        candles = trending_candles(100.0, 1.0, 80)
        ind = calculate_all_indicators(candles)
        assert abs(ind.current_price - candles[-1].close) < 1e-6

    def test_rsi_in_range(self):
        candles = trending_candles(100.0, 1.0, 80)
        ind = calculate_all_indicators(candles)
        assert 0 <= ind.rsi <= 100


# ── MTF confirmation tests ────────────────────────────────────────────────────

class TestConfirmMultiTimeframe:
    def _bullish_ind(self, rsi=60.0, hist=0.5) -> object:
        from backend.core.scanner.models import TechnicalIndicators, MACDResult, TrendDirection
        return TechnicalIndicators(
            rsi=rsi, macd=MACDResult(macd=1.0, signal=0.5, histogram=hist),
            ema20=110.0, ema50=100.0, atr=2.0, volume_spike=1.5,
            current_price=115.0, trend=TrendDirection.BULLISH,
        )

    def _bearish_ind(self, rsi=40.0, hist=-0.5) -> object:
        from backend.core.scanner.models import TechnicalIndicators, MACDResult, TrendDirection
        return TechnicalIndicators(
            rsi=rsi, macd=MACDResult(macd=-1.0, signal=-0.5, histogram=hist),
            ema20=90.0, ema50=100.0, atr=2.0, volume_spike=1.5,
            current_price=85.0, trend=TrendDirection.BEARISH,
        )

    def test_aligned_buy_confirms(self):
        result = confirm_multi_timeframe(self._bullish_ind(), self._bullish_ind(), SignalType.BUY)
        assert result.confirmed is True

    def test_aligned_sell_confirms(self):
        result = confirm_multi_timeframe(self._bearish_ind(), self._bearish_ind(), SignalType.SELL)
        assert result.confirmed is True

    def test_4h_not_bullish_rejects_buy(self):
        result = confirm_multi_timeframe(self._bullish_ind(), self._bearish_ind(), SignalType.BUY)
        assert result.confirmed is False

    def test_4h_overbought_rejects_buy(self):
        result = confirm_multi_timeframe(self._bullish_ind(), self._bullish_ind(rsi=75.0), SignalType.BUY)
        assert result.confirmed is False

    def test_strong_alignment_flag(self):
        result = confirm_multi_timeframe(self._bullish_ind(rsi=60.0, hist=0.5), self._bullish_ind(rsi=58.0, hist=0.3), SignalType.BUY)
        assert result.confirmed is True
        from backend.core.scanner.models import MTFAlignment
        assert result.alignment == MTFAlignment.STRONG
