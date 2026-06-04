from __future__ import annotations

import pytest

from backend.analytics import signal_validation


@pytest.mark.asyncio
async def test_ai_vs_heuristic_uses_signal_validation_source(monkeypatch):
    class FakePool:
        async def fetch(self, query, *args):
            return [
                {"validation_source": "CLAUDE", "confidence": 90, "outcome": "TP_HIT"},
                {"validation_source": "HEURISTIC", "confidence": 85, "outcome": "SL_HIT"},
                {"validation_source": None, "confidence": 80, "outcome": "TP_HIT"},
            ]

    async def fake_pool():
        return FakePool()

    monkeypatch.setattr(signal_validation, "_pool", fake_pool)

    result = await signal_validation.ai_vs_heuristic()

    assert result["ai"]["total"] == 1
    assert result["ai"]["tp_hits"] == 1
    assert result["heuristic"]["total"] == 2
    assert result["heuristic"]["tp_hits"] == 1
