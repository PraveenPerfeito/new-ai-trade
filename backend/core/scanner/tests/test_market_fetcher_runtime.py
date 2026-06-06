from __future__ import annotations

import pytest

from backend.core.scanner.market_fetcher import _classify_regime, _drop_open_candle
from backend.core.scanner.models import Candle


def _candle(close_time: int) -> Candle:
    return Candle(
        open_time=close_time - 3_599_999,
        open=100.0,
        high=101.0,
        low=99.0,
        close=100.5,
        volume=1_000.0,
        close_time=close_time,
    )


# ── _classify_regime ─────────────────────────────────────────────────────────
# args: (rsi, trend_value, btc24h, strength, vol_value)

class TestClassifyRegime:
    # ── Priority 1-2: extreme conditions ─────────────────────────────────────
    def test_euphoria(self):
        assert _classify_regime(79, "BULLISH", 9, 70, "NORMAL") == "EUPHORIA"

    def test_euphoria_boundary_rsi_at_78_not_triggered(self):
        assert _classify_regime(78, "BULLISH", 9, 70, "NORMAL") != "EUPHORIA"

    def test_capitulation(self):
        assert _classify_regime(21, "BEARISH", -9, 70, "NORMAL") == "CAPITULATION"

    def test_capitulation_boundary_rsi_at_22_not_triggered(self):
        assert _classify_regime(22, "BEARISH", -9, 70, "NORMAL") != "CAPITULATION"

    # ── Priority 3: high volatility ───────────────────────────────────────────
    def test_high_volatility_upward(self):
        assert _classify_regime(60, "RANGING", 6, 40, "HIGH") == "HIGH_VOLATILITY"

    def test_high_volatility_downward(self):
        assert _classify_regime(40, "RANGING", -6, 40, "EXTREME") == "HIGH_VOLATILITY"

    def test_high_vol_but_small_move_not_triggered(self):
        # abs(btc24h)=4 is NOT >5 so should not be HIGH_VOLATILITY
        result = _classify_regime(55, "RANGING", 4, 30, "HIGH")
        assert result != "HIGH_VOLATILITY"

    def test_large_move_normal_vol_not_high_volatility(self):
        # HIGH_VOLATILITY requires vol in HIGH/EXTREME
        result = _classify_regime(55, "RANGING", 6, 40, "NORMAL")
        assert result != "HIGH_VOLATILITY"

    # ── Priority 4: EMA-confirmed BULL_TREND ─────────────────────────────────
    def test_bull_trend_ema_confirmed(self):
        assert _classify_regime(60, "BULLISH", 3, 55, "NORMAL") == "BULL_TREND"

    def test_bull_trend_ema_confirmed_min_strength(self):
        assert _classify_regime(60, "BULLISH", 3, 50, "NORMAL") == "BULL_TREND"

    def test_bull_trend_ema_low_strength_not_triggered(self):
        # strength=49 just below EMA threshold — falls to momentum fallback check
        result = _classify_regime(60, "BULLISH", 3, 49, "NORMAL")
        # btc24h=3 is not >3.5 so momentum fallback also misses → SIDEWAYS
        assert result == "SIDEWAYS"

    # ── Priority 5: EMA-confirmed BEAR_TREND ─────────────────────────────────
    def test_bear_trend_ema_confirmed(self):
        assert _classify_regime(40, "BEARISH", -3, 55, "NORMAL") == "BEAR_TREND"

    def test_bear_trend_low_strength_not_triggered(self):
        assert _classify_regime(40, "BEARISH", -3, 49, "NORMAL") == "SIDEWAYS"

    # ── Priority 6: momentum fallback BULL_TREND (Phase REGIME.FIX.1) ────────
    def test_bull_trend_momentum_fallback_ranging(self):
        # V-shaped recovery: price up 4% in 28h, RSI 62, some trend strength
        assert _classify_regime(62, "RANGING", 4.0, 25, "NORMAL") == "BULL_TREND"

    def test_bull_trend_momentum_fallback_bullish_low_ema_strength(self):
        # EMA crossed bullish but strength < 50, momentum fills the gap
        assert _classify_regime(60, "BULLISH", 4.0, 25, "NORMAL") == "BULL_TREND"

    def test_bull_trend_momentum_exact_thresholds(self):
        # btc24h just above 3.5, rsi just above 55, strength just above 20
        assert _classify_regime(55.1, "RANGING", 3.6, 20, "NORMAL") == "BULL_TREND"

    def test_bull_trend_momentum_btc24h_too_low(self):
        # btc24h = 3.5 is NOT >3.5 — boundary: should NOT trigger
        assert _classify_regime(60, "RANGING", 3.5, 25, "NORMAL") == "SIDEWAYS"

    def test_bull_trend_momentum_rsi_too_low(self):
        # rsi = 55 is NOT >55 — boundary: should NOT trigger
        assert _classify_regime(55, "RANGING", 4.0, 25, "NORMAL") == "SIDEWAYS"

    def test_bull_trend_momentum_strength_too_low(self):
        assert _classify_regime(60, "RANGING", 4.0, 19, "NORMAL") == "SIDEWAYS"

    def test_bull_trend_momentum_bearish_ema_not_triggered(self):
        # Even with momentum, BEARISH trend with strength>=50 takes priority as BEAR
        assert _classify_regime(60, "BEARISH", 4.0, 55, "NORMAL") == "BEAR_TREND"

    # ── Priority 7: default SIDEWAYS ─────────────────────────────────────────
    def test_sideways_ranging_no_momentum(self):
        assert _classify_regime(50, "RANGING", 1.0, 20, "NORMAL") == "SIDEWAYS"

    def test_sideways_bearish_low_strength(self):
        assert _classify_regime(45, "BEARISH", -2, 40, "NORMAL") == "SIDEWAYS"

    def test_sideways_bullish_low_strength_low_momentum(self):
        assert _classify_regime(52, "BULLISH", 1.0, 40, "NORMAL") == "SIDEWAYS"

    # ── Regression: NULL should never be returned ─────────────────────────────
    @pytest.mark.parametrize("rsi,trend,btc24h,strength,vol", [
        (50, "RANGING", 0.0, 0.0, "NORMAL"),
        (50, "RANGING", 0.0, 0.0, "LOW"),
        (65, "RANGING", 6.0, 55, "HIGH"),    # HIGH_VOLATILITY path
        (65, "RANGING", 3.0, 55, "HIGH"),    # below HIGH_VOLATILITY abs threshold
        (30, "BEARISH", -3.0, 30, "NORMAL"),
        (70, "BULLISH", 3.0, 30, "NORMAL"),
    ])
    def test_never_returns_none(self, rsi, trend, btc24h, strength, vol):
        result = _classify_regime(rsi, trend, btc24h, strength, vol)
        assert result is not None
        assert isinstance(result, str)
        assert result in {"BULL_TREND", "BEAR_TREND", "SIDEWAYS",
                          "HIGH_VOLATILITY", "EUPHORIA", "CAPITULATION"}


# ── _drop_open_candle ─────────────────────────────────────────────────────────

def test_drop_open_candle_removes_current_binance_candle():
    now_ms = 1_000_000
    candles = [_candle(now_ms - 1), _candle(now_ms + 30_000)]

    result = _drop_open_candle(candles, now_ms=now_ms)

    assert result == candles[:1]


def test_drop_open_candle_keeps_fully_closed_tail():
    now_ms = 1_000_000
    candles = [_candle(now_ms - 60_000), _candle(now_ms - 1)]

    result = _drop_open_candle(candles, now_ms=now_ms)

    assert result == candles
