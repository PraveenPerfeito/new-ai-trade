from __future__ import annotations

from datetime import datetime

import pytest


@pytest.mark.asyncio
async def test_ai_summary_handles_null_token_columns(monkeypatch):
    from backend.analytics import ai_metrics

    class FakePool:
        def __init__(self):
            self.query = ""

        async def fetch(self, query, *args):
            self.query = query
            return [
                {
                    "validated": True,
                    "confidence": 91,
                    "latency_ms": 1200,
                    "used_fallback": False,
                    "error": None,
                    "prompt_tokens": None,
                    "completion_tokens": None,
                },
                {
                    "validated": False,
                    "confidence": 74,
                    "latency_ms": 0,
                    "used_fallback": True,
                    "error": None,
                    "prompt_tokens": None,
                    "completion_tokens": None,
                },
            ]

    pool = FakePool()

    async def fake_pool():
        return pool

    monkeypatch.setattr(ai_metrics, "_pool", fake_pool)

    summary = await ai_metrics.get_ai_summary(24)

    assert "prompt_tokens" in pool.query
    assert "completion_tokens" in pool.query
    assert summary["estimated_cost_usd"] == 0.0
    assert summary["claude_calls"] == 1
    assert summary["heuristic_calls"] == 1
    assert summary["success_rate"] == 1.0


@pytest.mark.asyncio
async def test_monitoring_signals_per_day_uses_database_truth(monkeypatch):
    from backend.analytics import ai_metrics, monitoring

    async def fake_read(metric: str, day: str | None = None) -> int:
        return 0

    async def fake_db_signals(now: datetime) -> int:
        assert now.tzinfo is not None
        return 42

    async def fake_ai_summary(window_hours: int = 24) -> dict:
        return {
            "claude_calls": 0,
            "heuristic_calls": 0,
            "fallback_rate": 0,
            "estimated_cost_usd": 0,
        }

    monkeypatch.setattr(monitoring, "_read", fake_read)
    monkeypatch.setattr(monitoring, "_read_db_generated_signals_24h", fake_db_signals)
    monkeypatch.setattr(ai_metrics, "get_ai_summary", fake_ai_summary)

    snapshot = await monitoring.get_monitoring_snapshot()
    metric = snapshot["metrics"]["signals_per_day"]

    assert metric["value"] == 42
    assert metric["source"] == "database"
    assert metric["window_hours"] == 24
    assert snapshot["data_windows"]["signals_per_day"] == "rolling_24h_database_truth"


def test_gate_rejection_normalization_keeps_required_keys():
    from backend.analytics.scan_metrics import normalize_gate_rejections

    counts = normalize_gate_rejections(
        {
            "btc_context": 2,
            "toxic_setup": 1,
            "duplicate": 3,
            "ai": 4,
            "cmc": 5,
            "regime": 6,
            "market_structure": 7,
        }
    )

    assert counts["BTC_DOWN_BUY"] == 2
    assert counts["TOXIC_DENYLIST"] == 1
    assert counts["DUPLICATE_SIGNAL"] == 3
    assert counts["CONFIDENCE_REJECTION"] == 4
    assert counts["CMC_REJECTION"] == 5
    assert counts["REGIME_REJECTION"] == 6
    assert counts["market_structure"] == 7


@pytest.mark.asyncio
async def test_scan_summary_aggregates_gate_rejections(monkeypatch):
    from backend.analytics import scan_metrics

    class FakePool:
        async def fetch(self, query, *args):
            return [
                {
                    "mode": "spot",
                    "coins_scanned": 10,
                    "signals_found": 1,
                    "duration_ms": 1000,
                    "errors": 0,
                    "gate_rejections": '{"BTC_DOWN_BUY": 2, "DUPLICATE_SIGNAL": 1}',
                },
                {
                    "mode": "spot",
                    "coins_scanned": 20,
                    "signals_found": 2,
                    "duration_ms": 3000,
                    "errors": 0,
                    "gate_rejections": {"ai": 3, "regime": 4},
                },
            ]

    async def fake_pool():
        return FakePool()

    monkeypatch.setattr(scan_metrics, "_pool", fake_pool)

    summary = await scan_metrics.get_scan_summary(24)

    assert summary["gate_rejections"]["BTC_DOWN_BUY"] == 2
    assert summary["gate_rejections"]["DUPLICATE_SIGNAL"] == 1
    assert summary["gate_rejections"]["CONFIDENCE_REJECTION"] == 3
    assert summary["gate_rejections"]["REGIME_REJECTION"] == 4
    assert summary["by_mode"]["spot"]["gate_rejections"]["CONFIDENCE_REJECTION"] == 3
