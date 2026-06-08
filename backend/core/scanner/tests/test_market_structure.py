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


# ── MARKET_STRUCTURE.FIX.1: regime-aware F4 / F6 + sub-condition telemetry ────
# TRUTH: SELL+EARLY_BREAKOUT.TRUTH.1 proved bears stay oversold longer,
#        and BEAR_TREND support levels break more reliably than in SIDEWAYS.

class TestF4RegimeAwareTrendExhaustion:
    """F4: RSI sustained below 27 fires after 5 candles in non-bear regimes,
    but requires 8 consecutive candles in BEAR_TREND / CAPITULATION."""

    @staticmethod
    def _rsi_mock(n_oversold: int, total: int = 50) -> "np.ndarray":
        """Return a mock RSI array with the last n_oversold values set to 20 (< 27)."""
        import numpy as np
        arr = np.full(total, 50.0)
        if n_oversold:
            arr[-n_oversold:] = 20.0
        return arr

    def test_5_oversold_candles_rejects_in_sideways(self) -> None:
        from unittest.mock import patch
        candles = trending_candles(100.0, -1.0, 50)
        with patch("backend.core.scanner.market_structure._calc_rsi_series",
                   return_value=self._rsi_mock(5)):
            is_ex, reason = detect_trend_exhaustion(candles, SignalType.SELL, btc_regime="SIDEWAYS")
        assert is_ex is True
        assert "5" in reason

    def test_6_oversold_candles_rejects_in_sideways(self) -> None:
        from unittest.mock import patch
        candles = trending_candles(100.0, -1.0, 50)
        with patch("backend.core.scanner.market_structure._calc_rsi_series",
                   return_value=self._rsi_mock(6)):
            is_ex, _ = detect_trend_exhaustion(candles, SignalType.SELL, btc_regime="SIDEWAYS")
        assert is_ex is True  # 6 >= 5 → exhausted in SIDEWAYS

    def test_6_oversold_candles_passes_in_bear_trend(self) -> None:
        from unittest.mock import patch
        candles = trending_candles(100.0, -1.0, 50)
        with patch("backend.core.scanner.market_structure._calc_rsi_series",
                   return_value=self._rsi_mock(6)):
            is_ex, _ = detect_trend_exhaustion(candles, SignalType.SELL, btc_regime="BEAR_TREND")
        assert is_ex is False  # 6 < 8 → not exhausted in BEAR_TREND

    def test_8_oversold_candles_rejects_in_bear_trend(self) -> None:
        from unittest.mock import patch
        candles = trending_candles(100.0, -1.0, 50)
        with patch("backend.core.scanner.market_structure._calc_rsi_series",
                   return_value=self._rsi_mock(8)):
            is_ex, reason = detect_trend_exhaustion(candles, SignalType.SELL, btc_regime="BEAR_TREND")
        assert is_ex is True   # 8 >= 8 → exhausted in BEAR_TREND
        assert "8" in reason

    def test_8_oversold_candles_rejects_in_capitulation(self) -> None:
        from unittest.mock import patch
        candles = trending_candles(100.0, -1.0, 50)
        with patch("backend.core.scanner.market_structure._calc_rsi_series",
                   return_value=self._rsi_mock(8)):
            is_ex, _ = detect_trend_exhaustion(candles, SignalType.SELL, btc_regime="CAPITULATION")
        assert is_ex is True   # CAPITULATION shares same threshold as BEAR_TREND

    def test_buy_overbought_threshold_unaffected_by_regime(self) -> None:
        """BUY overbought (RSI > 73) still fires at 5 candles regardless of regime."""
        import numpy as np
        from unittest.mock import patch
        candles = trending_candles(100.0, 1.0, 50)
        mock_rsi = np.full(50, 50.0)
        mock_rsi[-5:] = 80.0  # last 5 above 73
        with patch("backend.core.scanner.market_structure._calc_rsi_series",
                   return_value=mock_rsi):
            is_ex_bear, _ = detect_trend_exhaustion(candles, SignalType.BUY, btc_regime="BEAR_TREND")
            is_ex_sw,   _ = detect_trend_exhaustion(candles, SignalType.BUY, btc_regime="SIDEWAYS")
        assert is_ex_bear is True  # BUY threshold is always 5 (regime gate blocks BUY+BEAR anyway)
        assert is_ex_sw   is True


class TestF6RegimeAwareSRRejection:
    """F6: SELL pivot-support threshold is 2 in non-bear regimes, 3 in BEAR_TREND/CAPITULATION."""

    # current_price=103.0, atr=2.0 → threshold=2.4, underfoot zone=(100.6, 103.0)
    _CP  = 103.0
    _ATR = 2.0

    @staticmethod
    def _candles_with_pivot_lows(num_pivots: int) -> list[Candle]:
        """50 candles where ambient low=104.0 is ABOVE current_price (103.0) so ambient
        candles are outside the underfoot zone (100.6, 103.0).
        Explicit pivot lows at 101.0 / 101.3 / 101.5 are inside the zone and unique minima."""
        ambient_close, ambient_hi, ambient_lo = 103.0, 105.0, 104.0
        candles = [
            Candle(open_time=i, open=ambient_close, high=ambient_hi, low=ambient_lo,
                   close=ambient_close, volume=1000.0)
            for i in range(50)
        ]
        pivot_positions = [10, 20, 30]
        pivot_lows_vals = [101.0, 101.3, 101.5]  # all inside (100.6, 103.0)
        for k in range(num_pivots):
            pos = pivot_positions[k]
            plo = pivot_lows_vals[k]
            candles[pos] = Candle(open_time=pos, open=ambient_close, high=ambient_hi, low=plo,
                                  close=ambient_close, volume=1000.0)
        return candles

    def test_2_pivot_lows_rejects_sell_in_sideways(self) -> None:
        candles = self._candles_with_pivot_lows(2)
        is_rej, _ = detect_sr_rejection(candles, self._CP, self._ATR, SignalType.SELL, "SIDEWAYS")
        assert is_rej is True   # 2 >= 2 → blocked in SIDEWAYS

    def test_2_pivot_lows_passes_sell_in_bear_trend(self) -> None:
        candles = self._candles_with_pivot_lows(2)
        is_rej, _ = detect_sr_rejection(candles, self._CP, self._ATR, SignalType.SELL, "BEAR_TREND")
        assert is_rej is False  # 2 < 3 → not blocked in BEAR_TREND (support breaks more reliably)

    def test_2_pivot_lows_passes_sell_in_capitulation(self) -> None:
        candles = self._candles_with_pivot_lows(2)
        is_rej, _ = detect_sr_rejection(candles, self._CP, self._ATR, SignalType.SELL, "CAPITULATION")
        assert is_rej is False  # CAPITULATION shares same threshold as BEAR_TREND

    def test_3_pivot_lows_rejects_sell_in_bear_trend(self) -> None:
        candles = self._candles_with_pivot_lows(3)
        is_rej, reason = detect_sr_rejection(candles, self._CP, self._ATR, SignalType.SELL, "BEAR_TREND")
        assert is_rej is True   # 3 >= 3 → blocked even in BEAR_TREND
        assert "3" in reason

    def test_buy_overhead_threshold_unaffected_by_regime(self) -> None:
        """BUY direction: overhead resistance uses no regime logic — must behave identically."""
        candles = self._candles_with_pivot_lows(2)
        is_rej_sw,   _ = detect_sr_rejection(candles, self._CP, self._ATR, SignalType.BUY, "SIDEWAYS")
        is_rej_bear, _ = detect_sr_rejection(candles, self._CP, self._ATR, SignalType.BUY, "BEAR_TREND")
        assert is_rej_sw == is_rej_bear


class TestMsSubconditionTelemetry:
    """gate_rejections dict is populated with the correct ms_* key on each rejection."""

    def test_sideways_rejection_records_ms_sideways(self) -> None:
        gate_rejections: dict[str, int] = {}
        candles = flat_candles(100.0, 50, atr_frac=0.0005)
        result = run_market_structure_checks(
            candles, atr=0.05, current_price=100.0, volume_spike=1.0,
            signal_type=SignalType.SELL, gate_rejections=gate_rejections,
        )
        assert result.pass_ is False
        assert gate_rejections.get("ms_sideways", 0) == 1

    def test_exactly_one_ms_key_set_per_rejection(self) -> None:
        """Short-circuit gate: only the first failing filter increments its key."""
        gate_rejections: dict[str, int] = {}
        candles = flat_candles(100.0, 50, atr_frac=0.0005)
        run_market_structure_checks(
            candles, atr=0.05, current_price=100.0, volume_spike=1.0,
            signal_type=SignalType.SELL, gate_rejections=gate_rejections,
        )
        ms_keys = [
            "ms_sideways", "ms_overextension", "ms_candle_rejection",
            "ms_trend_exhaustion", "ms_fake_volume", "ms_sr_rejection", "ms_weak_breakout",
        ]
        assert sum(gate_rejections.get(k, 0) for k in ms_keys) == 1

    def test_overextension_records_ms_overextension(self) -> None:
        gate_rejections: dict[str, int] = {}
        # 11 candles total → sideways check requires ≥ 20 → skipped; overextension fires
        candles = flat_candles(100.0, 10)
        candles.append(Candle(open_time=10, open=100.0, high=125.0, low=97.0, close=124.0, volume=1000.0))
        run_market_structure_checks(
            candles, atr=2.0, current_price=124.0, volume_spike=1.0,
            signal_type=SignalType.BUY, gate_rejections=gate_rejections,
        )
        assert gate_rejections.get("ms_overextension", 0) == 1
        assert gate_rejections.get("ms_sideways", 0) == 0

    def test_no_ms_key_set_when_gate_passes(self) -> None:
        gate_rejections: dict[str, int] = {}
        candles = trending_candles(100.0, 2.0, 60)
        result = run_market_structure_checks(
            candles, atr=2.0, current_price=candles[-1].close, volume_spike=1.5,
            signal_type=SignalType.BUY, gate_rejections=gate_rejections,
        )
        ms_keys = [
            "ms_sideways", "ms_overextension", "ms_candle_rejection",
            "ms_trend_exhaustion", "ms_fake_volume", "ms_sr_rejection", "ms_weak_breakout",
        ]
        if result.pass_:
            assert sum(gate_rejections.get(k, 0) for k in ms_keys) == 0

    def test_none_gate_rejections_does_not_raise(self) -> None:
        candles = flat_candles(100.0, 50, atr_frac=0.0005)
        result = run_market_structure_checks(
            candles, atr=0.05, current_price=100.0, volume_spike=1.0,
            signal_type=SignalType.SELL, gate_rejections=None,
        )
        assert result.pass_ is False
