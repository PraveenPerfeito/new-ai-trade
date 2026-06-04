from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from backend.analytics import signal_metrics
from backend.core.scanner.models import Candle


def _ms(dt: datetime) -> int:
    return int(dt.timestamp() * 1000)


def _row(signal_type: str = "BUY") -> dict:
    return {
        "symbol": "SOL",
        "signal_type": signal_type,
        "scanner_mode": "spot",
        "entry_price": 100.0,
        "target_price": 110.0 if signal_type == "BUY" else 90.0,
        "stop_loss": 95.0 if signal_type == "BUY" else 105.0,
        "rr_ratio": 2.0,
        "created_at": datetime(2026, 6, 2, 14, 15, tzinfo=timezone.utc),
    }


def _candle(
    open_time: datetime,
    *,
    high: float,
    low: float,
    close: float = 100.0,
) -> Candle:
    close_time = open_time + timedelta(hours=1) - timedelta(milliseconds=1)
    return Candle(
        open_time=_ms(open_time),
        open=100.0,
        high=high,
        low=low,
        close=close,
        volume=1000.0,
        close_time=_ms(close_time),
    )


@pytest.mark.asyncio
async def test_resolves_signal_containing_candle_after_it_closes(monkeypatch):
    row = _row("BUY")
    candle = _candle(
        datetime(2026, 6, 2, 14, tzinfo=timezone.utc),
        high=102.0,
        low=94.0,
    )

    async def fake_fetch_klines(*args, **kwargs):
        return [candle]

    monkeypatch.setattr(signal_metrics, "fetch_klines", fake_fetch_klines)

    result = await signal_metrics._try_resolve(row)

    assert result is not None
    assert result["outcome"] == "SL_HIT"
    assert result["exit_price"] == 95.0
    assert result["exit_time"] == datetime(2026, 6, 2, 14, 59, 59, 999000, tzinfo=timezone.utc)


@pytest.mark.asyncio
async def test_ignores_only_candles_closed_before_signal(monkeypatch):
    row = _row("SELL")
    candle = _candle(
        datetime(2026, 6, 2, 13, tzinfo=timezone.utc),
        high=106.0,
        low=88.0,
    )

    async def fake_fetch_klines(*args, **kwargs):
        return [candle]

    monkeypatch.setattr(signal_metrics, "fetch_klines", fake_fetch_klines)

    result = await signal_metrics._try_resolve(row)

    assert result is None


@pytest.mark.asyncio
async def test_register_signal_outcome_suppresses_recent_duplicate(monkeypatch):
    class FakePool:
        def __init__(self):
            self.fetchrow_called = False

        async def fetchval(self, query, *args):
            return True

        async def fetchrow(self, query, *args):
            self.fetchrow_called = True

    class Value:
        value = "SELL"

    signal = type("SignalStub", (), {
        "id": "signal-id",
        "symbol": "SOL",
        "type": Value(),
        "timeframe": "1h",
    })()
    pool = FakePool()

    async def fake_pool():
        return pool

    monkeypatch.setattr(signal_metrics, "_pool", fake_pool)

    result = await signal_metrics.register_signal_outcome(signal)

    assert result is None
    assert pool.fetchrow_called is False


@pytest.mark.asyncio
async def test_pending_outcome_query_rotates_by_checked_at(monkeypatch):
    class FakePool:
        def __init__(self):
            self.query = ""

        async def fetch(self, query, *args):
            self.query = query
            return []

    pool = FakePool()

    async def fake_pool():
        return pool

    monkeypatch.setattr(signal_metrics, "_pool", fake_pool)

    await signal_metrics.check_pending_outcomes()

    assert "ORDER BY checked_at ASC NULLS FIRST, created_at ASC" in pool.query
