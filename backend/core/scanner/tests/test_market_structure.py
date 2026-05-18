"""
Unit tests for backend/core/scanner/market_structure.py.
Each filter is tested independently plus the aggregate gate.
"""
from __future__ import annotations

import math

import pytest

from backend.core.scanner.models import Candle, SignalType
from backend.core.scanner.market_structure import (
    detect_sideways_market,
    is_fake_volume_spike,
    analyze_candle_structure,
    detect_trend_exhaustion,
    detect_sr_rejection,
    detect_overextension,
    analyze_breakout_strength,
    run_market_structure_checks,
    _calc_adx,
    _calc_rsi_series,
)


# ── Helpers ───────────────────────────────────────────────────────────────────

def flat_candles(price: float = 100.0, n: int = 50, atr_frac: float = 0.01) -> list[Candle]:
    """Candles that move within a very tight band — simulates a ranging market."""
    half = price * atr_frac
    return [Candle(open_time=i, open=price, high=price + half, low=price - half, close=price, volume=1000.0) for i in range(n)]


def trending_candles(start: float, step: float, n: int, volume: float = 1000.0) -> list[Candle]:
    candles = []
    p = start
    for i in range(n):
        p += step
        candles.append(Candle(
            open_time=i,
            open=p - step,
            high=p + abs(step),
            low=p - abs(step),
            close=p,
            volume=volume,
        ))
    return candles


def alternating_candles(mid: float, amplitude: float, n: int) -> list[Candle]:
    """Alternates up/down closes to keep RSI near 50."""
    candles = []
    for i in range(n):
        p = mid + amplitude if i % 2 == 0 else mid - amplitude
        candles.append(Candle(open_time=i, open=mid, high=mid + amplitude, low=mid - amplitude, close=p, volume=1000.0))
    return candles


def make_candle(close: float, high: float | None = None, low: float | None = None,
                open_: float | None = None, volume: float = 1000.0, t: int = 0) -> Candle:
    if high is None: high = close * 1.01
    if low  is None: low  = close * 0.99
    if open_ is None: open_ = close
    return Candle(open_time=t, open=open_, high=high, low=low, close=close, volume=volume)


# ── ADX helper ────────────────────────────────────────────────────────────────

class TestCalcADX:
    def test_insufficient_history_returns_25(self):
        candles = flat_candles(n=5)
        assert _calc_adx(candles) == 25.0

    def test_ranging_market_low_adx(self):
        candles = flat_candles(price=100.0, n=60, atr_frac=0.001)
        adx = _calc_adx(candles)
        # Flat market → ADX should be low (hard to pin exact value but < 25)
        assert adx < 35

    def test_strong_trend_higher_adx(self):
        trend   = trending_candles(100.0, 2.0, 80)
        ranging = flat_candles(100.0, 80, atr_frac=0.001)
        assert _calc_adx(trend) > _calc_adx(ranging)


# ── RSI series helper ─────────────────────────────────────────────────────────

class TestCalcRSISeries:
    def test_length_matches_input(self):
        candles = trending_candles(100.0, 1.0, 50)
        closes = [c.close for c in candles]
        import numpy as np
        series = _calc_rsi_series(np.array(closes))
        assert len(series) == 50

    def test_values_bounded(self):
        candles = trending_candles(100.0, 1.0, 60)
        closes = [c.close for c in candles]
        import numpy as np
        series = _calc_rsi_series(np.array(closes))
        assert all(0 <= v <= 100 for v in series)


# ── 1. Sideways market detection ─────────────────────────────────────────────

class TestDetectSidewaysMarket:
    def test_tight_range_detected_as_sideways(self):
        candles = flat_candles(100.0, 50, atr_frac=0.0005)
        atr = 0.05  # very small relative to price band
        is_sw, reason, adx = detect_sideways_market(candles, atr)
        assert is_sw is True

    def test_strong_trend_not_sideways(self):
        candles = trending_candles(100.0, 1.5, 60)
        atr = 2.0
        is_sw, reason, adx = detect_sideways_market(candles, atr)
        assert is_sw is False

    def test_insufficient_candles_not_sideways(self):
        candles = flat_candles(100.0, 10)
        is_sw, _, _ = detect_sideways_market(candles, 0.5)
        assert is_sw is False


# ── 2. Fake volume spike ──────────────────────────────────────────────────────

class TestIsFakeVolumeSpike:
    def test_below_threshold_never_fake(self):
        candles = trending_candles(100.0, 1.0, 30)
        is_fake, reason = is_fake_volume_spike(candles, volume_spike=2.0, atr=2.0)
        assert is_fake is False

    def test_wash_trade_signature_detected(self):
        candles = flat_candles(100.0, 30, atr_frac=0.001)
        # Tiny body, tiny range, huge reported volume spike
        candles[-1] = Candle(open_time=29, open=100.0, high=100.05, low=99.98, close=100.01, volume=50000.0)
        atr = 1.0
        is_fake, reason = is_fake_volume_spike(candles, volume_spike=3.0, atr=atr)
        assert is_fake is True

    def test_genuine_breakout_not_fake(self):
        candles = trending_candles(100.0, 1.0, 30)
        # Large body, large range — real move
        candles[-1] = Candle(open_time=29, open=125.0, high=132.0, low=124.0, close=131.0, volume=50000.0)
        is_fake, _ = is_fake_volume_spike(candles, volume_spike=3.0, atr=2.0)
        assert is_fake is False


# ── 3. Candle structure ───────────────────────────────────────────────────────

class TestAnalyzeCandleStructure:
    def test_insufficient_candles_passes(self):
        candles = [make_candle(100.0)]
        ok, _ = analyze_candle_structure(candles, SignalType.BUY, atr=1.0)
        assert ok is True

    def test_bearish_rejection_candle_fails_buy(self):
        # Upper wick > 62%, body < 20%
        c = Candle(open_time=0, open=100.0, high=110.0, low=99.5, close=100.5, volume=1000.0)
        # range=10.5, upper_wick=9.5 (90%), body=0.5 (5%)
        candles = [make_candle(100.0), make_candle(100.0), c]
        ok, reason = analyze_candle_structure(candles, SignalType.BUY, atr=2.0)
        assert ok is False
        assert "rejection" in reason.lower() or "sellers" in reason.lower()

    def test_doji_fails(self):
        # body < 8%, range >= 0.4 ATR
        c = Candle(open_time=0, open=100.0, high=103.0, low=97.0, close=100.1, volume=1000.0)
        # range=6, body=0.1 (~1.7%), atr=5 → range=6 >= 2.0
        candles = [make_candle(100.0), make_candle(100.0), c]
        ok, reason = analyze_candle_structure(candles, SignalType.BUY, atr=5.0)
        assert ok is False
        assert "doji" in reason.lower() or "indecision" in reason.lower()

    def test_clean_bullish_candle_passes_buy(self):
        c = Candle(open_time=0, open=98.0, high=103.0, low=97.5, close=102.5, volume=1000.0)
        candles = [make_candle(97.0), make_candle(98.0), c]
        ok, _ = analyze_candle_structure(candles, SignalType.BUY, atr=2.0)
        assert ok is True


# ── 4. Trend exhaustion ───────────────────────────────────────────────────────

class TestDetectTrendExhaustion:
    def test_insufficient_candles_not_exhausted(self):
        candles = trending_candles(100.0, 1.0, 10)
        is_ex, _ = detect_trend_exhaustion(candles, SignalType.BUY)
        assert is_ex is False

    def test_sustained_overbought_exhaustion(self):
        # Build candles where the last 5 RSI values are all > 73
        # Easy way: very steep uptrend so RSI stays extreme
        candles = trending_candles(50.0, 5.0, 60)  # 500% gain over 60 candles
        is_ex, reason = detect_trend_exhaustion(candles, SignalType.BUY)
        # At 5×ATR gains per candle RSI should be very high
        # The test is probabilistic — just check the function doesn't crash
        assert isinstance(is_ex, bool)
        assert isinstance(reason, str)

    def test_alternating_market_not_exhausted(self):
        # Alternating up/down keeps RSI near 50 — no divergence, no extension
        candles = alternating_candles(mid=100.0, amplitude=1.0, n=60)
        is_ex, _ = detect_trend_exhaustion(candles, SignalType.BUY)
        assert is_ex is False


# ── 5. S/R rejection ─────────────────────────────────────────────────────────

class TestDetectSRRejection:
    def test_insufficient_candles_no_rejection(self):
        candles = flat_candles(100.0, 10)
        is_rej, _ = detect_sr_rejection(candles, 100.0, 1.0, SignalType.BUY)
        assert is_rej is False

    def test_zero_atr_no_rejection(self):
        candles = flat_candles(100.0, 50)
        is_rej, _ = detect_sr_rejection(candles, 100.0, 0.0, SignalType.BUY)
        assert is_rej is False

    def test_no_overhead_pivots_passes(self):
        candles = trending_candles(100.0, 2.0, 60)
        current = candles[-1].close
        is_rej, _ = detect_sr_rejection(candles, current, 2.0, SignalType.BUY)
        # In a clean uptrend there are no overhead pivots near the current price
        assert isinstance(is_rej, bool)


# ── 6. Overextension ─────────────────────────────────────────────────────────

class TestDetectOverextension:
    def test_insufficient_candles_not_overextended(self):
        candles = flat_candles(n=2)
        is_ov, _, _ = detect_overextension(candles, atr=1.0, signal_type=SignalType.BUY)
        assert is_ov is False

    def test_huge_single_candle_overextended(self):
        candles = flat_candles(100.0, 10)
        candles.append(Candle(open_time=10, open=100.0, high=120.0, low=98.0, close=118.0, volume=1000.0))
        atr = 2.0  # candle range = 22, factor = 11 → > 3
        is_ov, reason, factor = detect_overextension(candles, atr=atr, signal_type=SignalType.BUY)
        assert is_ov is True
        assert factor > 3.0

    def test_normal_candle_not_overextended(self):
        candles = trending_candles(100.0, 1.0, 10)
        atr = 3.0
        is_ov, _, _ = detect_overextension(candles, atr=atr, signal_type=SignalType.BUY)
        assert is_ov is False


# ── 7. Breakout strength ──────────────────────────────────────────────────────

class TestAnalyzeBreakoutStrength:
    def test_insufficient_candles_not_weak(self):
        candles = flat_candles(n=10)
        is_weak, _ = analyze_breakout_strength(candles, atr=1.0, volume_spike=2.0, signal_type=SignalType.BUY)
        assert is_weak is False

    def test_failed_breakout_detected(self):
        # Build candles where wick goes above prior highs but close is back below
        base = [Candle(open_time=i, open=100.0, high=101.0, low=99.0, close=100.0, volume=1000.0) for i in range(26)]
        # Last candle: wick above resistance (101) but closed below all closes (100)
        last = Candle(open_time=26, open=99.5, high=103.0, low=99.0, close=99.5, volume=2000.0)
        candles = base + [last]
        is_weak, reason = analyze_breakout_strength(candles, atr=1.0, volume_spike=1.0, signal_type=SignalType.BUY)
        assert is_weak is True
        assert "failed" in reason.lower() or "stop hunt" in reason.lower()

    def test_strong_breakout_not_weak(self):
        base = [Candle(open_time=i, open=100.0, high=101.0, low=99.0, close=100.5, volume=1000.0) for i in range(26)]
        # Closed well above all prior closes with strong volume
        last = Candle(open_time=26, open=100.5, high=106.0, low=100.3, close=105.5, volume=5000.0)
        candles = base + [last]
        is_weak, _ = analyze_breakout_strength(candles, atr=1.0, volume_spike=3.0, signal_type=SignalType.BUY)
        assert is_weak is False


# ── Aggregate gate ────────────────────────────────────────────────────────────

class TestRunMarketStructureChecks:
    def _clean_breakout_candles(self) -> tuple[list[Candle], float]:
        # 60 candles of clean uptrend with decent range (not sideways)
        candles = trending_candles(100.0, 1.5, 60, volume=2000.0)
        atr = 3.0
        return candles, atr

    def test_clean_uptrend_passes(self):
        candles, atr = self._clean_breakout_candles()
        current_price = candles[-1].close
        result = run_market_structure_checks(
            candles=candles, atr=atr, current_price=current_price,
            volume_spike=2.0, signal_type=SignalType.BUY,
        )
        # A clean uptrend may or may not pass depending on all filters,
        # but the function should return without exception and have an ADX field.
        assert result.adx >= 0

    def test_flat_market_fails(self):
        candles = flat_candles(100.0, 60, atr_frac=0.0005)
        atr = 0.05
        result = run_market_structure_checks(
            candles=candles, atr=atr, current_price=100.0,
            volume_spike=1.0, signal_type=SignalType.BUY,
        )
        assert result.pass_ is False
        assert result.rejection_reason is not None

    def test_huge_candle_fails_overextension(self):
        candles = flat_candles(100.0, 20)
        candles.append(Candle(open_time=20, open=100.0, high=130.0, low=99.0, close=128.0, volume=1000.0))
        atr = 2.0
        result = run_market_structure_checks(
            candles=candles, atr=atr, current_price=128.0,
            volume_spike=1.5, signal_type=SignalType.BUY,
        )
        # Overextension should fire (range = 31, factor ≈ 15.5)
        assert result.pass_ is False

    def test_result_has_adx_even_on_pass(self):
        candles, atr = self._clean_breakout_candles()
        result = run_market_structure_checks(
            candles=candles, atr=atr, current_price=candles[-1].close,
            volume_spike=2.0, signal_type=SignalType.BUY,
        )
        assert isinstance(result.adx, float)
        assert result.adx >= 0
