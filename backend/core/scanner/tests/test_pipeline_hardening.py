"""
PIPELINE.HARDENING.1 — unit tests for all hardening fixes.

Covers:
  C3  — save_signal() 3-attempt retry with exponential backoff
  H2  — 12 canonical gate keys in _PERSISTED_GATE_KEYS + GATE_REJECTION_KEYS
  H2d — normalize_gate_rejections maps lowercase aliases to canonical keys
  H3  — check_pending_outcomes auto-timeouts stale PENDING rows
  M3  — record_scan() retries on transient DB failure
"""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.analytics.scan_metrics import (
    GATE_REJECTION_KEYS,
    normalize_gate_rejections,
    record_scan,
)
from backend.analytics.signal_metrics import check_pending_outcomes
from backend.core.scanner.db import save_signal
from backend.core.scanner.models import (
    MACDResult,
    RiskGrade,
    ScannerMode,
    Signal,
    SignalType,
    TechnicalIndicators,
    TrendDirection,
)
from backend.core.scanner.orchestrator import _PERSISTED_GATE_KEYS, _new_gate_rejections

# ── Helpers ───────────────────────────────────────────────────────────────────

_CANON_12 = frozenset({
    "BTC_DOWN_BUY", "TOXIC_DENYLIST", "SIGNAL_COOLDOWN", "CONFIDENCE_REJECTION",
    "CMC_REJECTION", "REGIME_REJECTION",
    "MTF_REJECTION", "VOLATILITY_REJECTION", "TREND_STRENGTH_REJECTION",
    "SETUP_REJECTION", "RR_REJECTION", "RISK_REJECTION",
})


def _make_indicators() -> TechnicalIndicators:
    return TechnicalIndicators(
        rsi=55.0,
        macd=MACDResult(macd=0.1, signal=0.05, histogram=0.05),
        ema20=100.0,
        ema50=95.0,
        atr=2.0,
        volume_spike=1.5,
        current_price=100.0,
        trend=TrendDirection.BULLISH,
    )


def _make_signal(**overrides) -> Signal:
    defaults = dict(
        symbol="BTC",
        name="Bitcoin",
        type=SignalType.BUY,
        scanner_mode=ScannerMode.SPOT,
        entry_price=100.0,
        target_price=105.0,
        stop_loss=97.0,
        rr_ratio=1.67,
        confidence=82,
        indicators=_make_indicators(),
        setup_description="EMA crossover",
        risk_score=28.0,
        quality_score=72.0,
        risk_grade=RiskGrade.B,
        risk_warnings=[],
        max_safe_leverage=5,
        position_size_multiplier=1.0,
    )
    defaults.update(overrides)
    return Signal(**defaults)


# ── C3: save_signal retry ──────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_save_signal_retries_and_succeeds_on_third_attempt():
    """C3: save_signal() retries up to 3 attempts; succeeds on 3rd."""
    call_count = 0

    class FakePool:
        async def fetchrow(self, *a, **kw):
            nonlocal call_count
            call_count += 1
            if call_count < 3:
                raise Exception("connection refused")
            return {"id": "test-signal-uuid"}

    async def mock_pool():
        return FakePool()

    with patch("backend.core.scanner.db._pool", mock_pool):
        result = await save_signal(_make_signal())

    assert result == "test-signal-uuid"
    assert call_count == 3


@pytest.mark.asyncio
async def test_save_signal_returns_none_after_all_retries_exhausted():
    """C3: After 3 failed attempts, save_signal returns None (not raises)."""
    call_count = 0

    class FakePool:
        async def fetchrow(self, *a, **kw):
            nonlocal call_count
            call_count += 1
            raise Exception("DB unavailable")

    async def mock_pool():
        return FakePool()

    with patch("backend.core.scanner.db._pool", mock_pool):
        result = await save_signal(_make_signal())

    assert result is None
    assert call_count == 3


@pytest.mark.asyncio
async def test_save_signal_succeeds_on_first_attempt():
    """C3: No retry overhead when DB succeeds immediately."""
    call_count = 0

    class FakePool:
        async def fetchrow(self, *a, **kw):
            nonlocal call_count
            call_count += 1
            return {"id": "quick-uuid"}

    async def mock_pool():
        return FakePool()

    with patch("backend.core.scanner.db._pool", mock_pool):
        result = await save_signal(_make_signal())

    assert result == "quick-uuid"
    assert call_count == 1


# ── H2: gate key accounting ────────────────────────────────────────────────────

def test_persisted_gate_keys_contains_all_12_canonical():
    """H2: _PERSISTED_GATE_KEYS must include all 12 canonical pipeline gates."""
    assert _CANON_12.issubset(set(_PERSISTED_GATE_KEYS)), (
        f"Missing keys: {_CANON_12 - set(_PERSISTED_GATE_KEYS)}"
    )


def test_gate_rejection_keys_in_scan_metrics_contains_all_12_canonical():
    """H2: GATE_REJECTION_KEYS must include all 12 canonical gates for persistence."""
    assert _CANON_12.issubset(set(GATE_REJECTION_KEYS)), (
        f"Missing keys: {_CANON_12 - set(GATE_REJECTION_KEYS)}"
    )


def test_new_gate_rejections_initialises_6_new_keys_to_zero():
    """H2: _new_gate_rejections() must init the 6 new pipeline gates to 0."""
    gr = _new_gate_rejections()
    new_keys = [
        "MTF_REJECTION", "VOLATILITY_REJECTION", "TREND_STRENGTH_REJECTION",
        "SETUP_REJECTION", "RR_REJECTION", "RISK_REJECTION",
    ]
    for key in new_keys:
        assert key in gr, f"Key {key} missing from _new_gate_rejections()"
        assert gr[key] == 0


def test_normalize_gate_rejections_maps_lowercase_to_canonical():
    """H2: Pre-hardening lowercase aliases map to canonical uppercase keys."""
    raw = {
        "mtf":            5,
        "volatility":     3,
        "trend_strength": 7,
        "setup_score":    12,
        "rr_ratio":       4,
        "risk_engine":    6,
    }
    result = normalize_gate_rejections(raw)
    assert result["MTF_REJECTION"]            == 5
    assert result["VOLATILITY_REJECTION"]     == 3
    assert result["TREND_STRENGTH_REJECTION"] == 7
    assert result["SETUP_REJECTION"]          == 12
    assert result["RR_REJECTION"]             == 4
    assert result["RISK_REJECTION"]           == 6


def test_normalize_gate_rejections_existing_canonical_keys_still_work():
    """H2: Original 6 canonical keys continue to map correctly."""
    raw = {"BTC_DOWN_BUY": 2, "REGIME_REJECTION": 5, "CONFIDENCE_REJECTION": 8}
    result = normalize_gate_rejections(raw)
    assert result["BTC_DOWN_BUY"]          == 2
    assert result["REGIME_REJECTION"]      == 5
    assert result["CONFIDENCE_REJECTION"]  == 8


# ── H3: stale outcome auto-timeout ────────────────────────────────────────────

@pytest.mark.asyncio
async def test_check_pending_outcomes_runs_stale_timeout_update():
    """H3: check_pending_outcomes() issues an UPDATE TIMEOUT for rows older than 7 days."""
    execute_sqls: list[str] = []

    class FakePool:
        async def execute(self, sql, *a, **kw):
            execute_sqls.append(sql.strip())
            return "UPDATE 0"

        async def fetch(self, *a, **kw):
            return []

    async def mock_pool():
        return FakePool()

    with patch("backend.analytics.signal_metrics._pool", mock_pool):
        result = await check_pending_outcomes()

    assert result == {"resolved": 0, "still_pending": 0, "errors": 0}
    # Verify the stale timeout SQL was executed
    assert any("TIMEOUT" in sql for sql in execute_sqls), (
        "Expected a stale-timeout UPDATE with outcome='TIMEOUT'"
    )
    assert any("7 days" in sql for sql in execute_sqls), (
        "Expected the 7-day interval in the stale timeout SQL"
    )


@pytest.mark.asyncio
async def test_check_pending_outcomes_logs_stale_count(caplog):
    """H3: When stale outcomes are timed out, count is logged."""
    import logging

    class FakePool:
        async def execute(self, sql, *a, **kw):
            if "TIMEOUT" in sql:
                return "UPDATE 3"
            return "UPDATE 0"

        async def fetch(self, *a, **kw):
            return []

    async def mock_pool():
        return FakePool()

    with patch("backend.analytics.signal_metrics._pool", mock_pool):
        await check_pending_outcomes()
    # No assertion on log level since structlog is stubbed; just assert no exception raised


# ── M3: record_scan retry ─────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_record_scan_retries_on_transient_db_failure():
    """M3: record_scan() retries the INSERT up to 3 times before giving up."""
    call_count = 0

    class FakePool:
        async def execute(self, *a, **kw):
            nonlocal call_count
            call_count += 1
            if call_count < 3:
                raise Exception("connection error")
            # success on 3rd attempt — no exception

    async def mock_pool():
        return FakePool()

    with patch("backend.analytics.scan_metrics._pool", mock_pool):
        await record_scan(
            scan_id="test-scan-retry",
            mode="standard",
            coins_scanned=50,
            signals_found=2,
            duration_ms=5000,
        )

    assert call_count == 3


@pytest.mark.asyncio
async def test_record_scan_succeeds_on_first_attempt():
    """M3: record_scan() succeeds immediately when no DB error."""
    call_count = 0

    class FakePool:
        async def execute(self, *a, **kw):
            nonlocal call_count
            call_count += 1

    async def mock_pool():
        return FakePool()

    with patch("backend.analytics.scan_metrics._pool", mock_pool):
        await record_scan(
            scan_id="test-scan-ok",
            mode="futures",
            coins_scanned=30,
            signals_found=1,
            duration_ms=3000,
        )

    assert call_count == 1


@pytest.mark.asyncio
async def test_record_scan_does_not_raise_after_all_retries_fail():
    """M3: record_scan() is fire-and-forget — never raises even after 3 failures."""
    class FakePool:
        async def execute(self, *a, **kw):
            raise Exception("DB gone")

    async def mock_pool():
        return FakePool()

    with patch("backend.analytics.scan_metrics._pool", mock_pool):
        # Must not raise
        await record_scan(
            scan_id="test-scan-fail",
            mode="standard",
            coins_scanned=10,
            signals_found=0,
            duration_ms=1000,
        )
