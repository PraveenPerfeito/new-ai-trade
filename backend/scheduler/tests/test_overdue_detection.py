"""
Tests for SCAN.SCHEDULER.TRUTH.1 — is_overdue detection in coordinator.status().

Root cause: _next_beat_fire() returns a valid future timestamp even when Celery
Beat is dead, so the dashboard showed a counting-down "Next Scan" timer while
no scans were actually firing.  The fix adds is_overdue=True when enabled and
last_scan_at is older than _OVERDUE_THRESHOLD_S (30 min = 2× the 15-min standard
interval), which causes the UI to show an amber "Overdue" badge instead.
"""
from __future__ import annotations

import time
from unittest.mock import MagicMock, patch

import pytest

from backend.scheduler.coordinator import SchedulerCoordinator, _OVERDUE_THRESHOLD_S


# ── Helpers ───────────────────────────────────────────────────────────────────


def _make_coordinator() -> SchedulerCoordinator:
    """Return a coordinator whose Redis client is a fresh MagicMock."""
    with patch("backend.config.get_settings") as mock_s:
        mock_s.return_value.redis_url = "redis://localhost"
        with patch("redis.from_url"):
            c = SchedulerCoordinator()
    c._redis = MagicMock()
    return c


def _stub_redis(coordinator: SchedulerCoordinator, *, enabled: str = "1",
                last_scan_ts: str | None = None) -> None:
    """Configure the mocked Redis to return specific values."""
    store: dict[str, str | None] = {
        "scheduler:status_cache": None,      # cache always cold in tests
        "scheduler:enabled":      enabled,
        "scheduler:last_scan_ts": last_scan_ts,
        "scheduler:lock:standard":        None,
        "scheduler:lock:high_confidence": None,
        "scheduler:lock:futures":         None,
    }
    coordinator._redis.get.side_effect  = lambda key: store.get(key)
    coordinator._redis.exists.return_value = 0      # no running locks
    coordinator._redis.setex.return_value  = True   # cache write always ok


# ── Tests ─────────────────────────────────────────────────────────────────────


class TestOverdueDetection:

    def test_overdue_when_last_scan_older_than_threshold(self):
        """is_overdue=True when enabled and last scan > _OVERDUE_THRESHOLD_S ago."""
        c = _make_coordinator()
        stale_ts = str(time.time() - _OVERDUE_THRESHOLD_S - 60)  # 1 min past threshold
        _stub_redis(c, enabled="1", last_scan_ts=stale_ts)

        with patch.object(c, "_last_scan_from_db", return_value=None):
            result = c.status()

        assert result["is_overdue"] is True
        assert result["last_scan_age_seconds"] is not None
        assert result["last_scan_age_seconds"] > _OVERDUE_THRESHOLD_S

    def test_not_overdue_when_last_scan_recent(self):
        """is_overdue=False when last scan within the 30-minute window."""
        c = _make_coordinator()
        recent_ts = str(time.time() - 10 * 60)   # 10 min ago — well within threshold
        _stub_redis(c, enabled="1", last_scan_ts=recent_ts)

        result = c.status()

        assert result["is_overdue"] is False
        assert result["last_scan_age_seconds"] is not None
        assert result["last_scan_age_seconds"] < _OVERDUE_THRESHOLD_S

    def test_overdue_when_no_scan_ever_recorded(self):
        """is_overdue=True when enabled but scheduler:last_scan_ts is absent and DB is empty."""
        c = _make_coordinator()
        _stub_redis(c, enabled="1", last_scan_ts=None)

        with patch.object(c, "_last_scan_from_db", return_value=None):
            result = c.status()

        assert result["is_overdue"] is True
        # No known timestamp → age is None
        assert result["last_scan_age_seconds"] is None

    def test_not_overdue_when_scheduler_disabled(self):
        """is_overdue=False when scheduler is disabled regardless of last_scan_at age."""
        c = _make_coordinator()
        old_ts = str(time.time() - 2 * 3600)   # 2 hours ago
        _stub_redis(c, enabled="0", last_scan_ts=old_ts)

        with patch.object(c, "_last_scan_from_db", return_value=None):
            result = c.status()

        # Disabled → no scans expected → not "overdue"
        assert result["is_overdue"] is False

    def test_overdue_uses_db_fallback_when_redis_stale(self):
        """When Redis ts is >30 min stale, DB is queried; DB recent ts clears overdue."""
        c = _make_coordinator()
        # Redis has a very old timestamp (>30 min) — triggers DB fallback
        old_redis_ts = str(time.time() - 60 * 60)   # 1 hour ago
        _stub_redis(c, enabled="1", last_scan_ts=old_redis_ts)

        recent_db_ts = time.time() - 5 * 60   # DB shows scan 5 min ago
        with patch.object(c, "_last_scan_from_db", return_value=recent_db_ts):
            result = c.status()

        # DB says recent → not overdue
        assert result["is_overdue"] is False
        assert result["last_scan_age_seconds"] is not None
        assert result["last_scan_age_seconds"] < _OVERDUE_THRESHOLD_S

    def test_result_keys_always_present(self):
        """is_overdue and last_scan_age_seconds are always in the result dict."""
        c = _make_coordinator()
        _stub_redis(c, enabled="1", last_scan_ts=str(time.time() - 5 * 60))

        result = c.status()

        assert "is_overdue" in result
        assert "last_scan_age_seconds" in result
