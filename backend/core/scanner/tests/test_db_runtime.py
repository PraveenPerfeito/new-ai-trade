from __future__ import annotations

import pytest

from backend.core.scanner import db


class FakePool:
    def __init__(self, value):
        self.value = value
        self.args = None

    async def fetchval(self, query, *args):
        self.args = args
        return self.value


@pytest.mark.asyncio
async def test_has_recent_signal_queries_symbol_direction_and_timeframe(monkeypatch):
    pool = FakePool(True)

    async def fake_pool():
        return pool

    monkeypatch.setattr(db, "_pool", fake_pool)

    result = await db.has_recent_signal("sol", "SELL", "1h", cooldown_minutes=45)

    assert result is True
    assert pool.args == ("sol", "SELL", "1h", 45)


@pytest.mark.asyncio
async def test_has_recent_signal_fails_open_when_db_unavailable(monkeypatch):
    async def fake_pool():
        return None

    monkeypatch.setattr(db, "_pool", fake_pool)

    assert await db.has_recent_signal("SOL", "SELL", "1h") is False
