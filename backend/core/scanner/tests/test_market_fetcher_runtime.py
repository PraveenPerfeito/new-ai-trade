from __future__ import annotations

from backend.core.scanner.market_fetcher import _drop_open_candle
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
