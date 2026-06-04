from __future__ import annotations

from backend.core.scanner.breakout_intelligence import (
    BreakoutStrength,
    detect_breakout_strength,
)
from backend.core.scanner.models import Candle, SignalType


def _candle(close: float, volume: float = 100.0) -> Candle:
    return Candle(
        open_time=0,
        open=close,
        high=close,
        low=close,
        close=close,
        volume=volume,
        close_time=1,
    )


def test_pure_bb_expansion_is_not_a_signal(monkeypatch):
    import backend.core.scanner.breakout_intelligence as mod

    monkeypatch.setattr(mod, "_detect_bb_expansion", lambda candles: (True, True))
    candles_1d = [_candle(100.0) for _ in range(31)]
    candles_1h = [_candle(100.0) for _ in range(40)]

    result = detect_breakout_strength(candles_1d, candles_1h, SignalType.BUY)

    assert result.strength == BreakoutStrength.NONE
    assert result.breakout_type == "none"


def test_structure_break_can_still_emit_early_breakout(monkeypatch):
    import backend.core.scanner.breakout_intelligence as mod

    monkeypatch.setattr(mod, "_detect_bb_expansion", lambda candles: (False, False))
    candles_1d = (
        [_candle(102.0) for _ in range(10)]
        + [_candle(100.0) for _ in range(20)]
        + [_candle(101.0, volume=100.0)]
    )
    candles_1h = [_candle(100.0) for _ in range(40)]

    result = detect_breakout_strength(candles_1d, candles_1h, SignalType.BUY)

    assert result.strength == BreakoutStrength.EARLY_BREAKOUT
    assert result.breakout_type == "20d_high"
