"""
Tests for PropagationListener tight-loop guard (REDIS.FIX.1).

Verifies:
  1. asyncio.sleep(1.0) is called when get_message() returns None
  2. Real messages are processed without sleeping
  3. Emergency stop / maintenance mode (FeatureFlags, group="features") propagate
  4. Reconnect back-off fires after connection error

Key design note: _StopLoop inherits from BaseException, NOT Exception.
The outer reconnect loop catches `Exception` — so only BaseException subclasses
can escape it cleanly during tests.
"""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, patch


class _StopLoop(BaseException):
    """
    Sentinel raised to terminate the infinite listener loop in tests.
    Must be BaseException so it bypasses `except Exception` in the outer
    reconnect loop and propagates cleanly to the test.
    """


def _msg(group: str) -> dict:
    return {"type": "message", "data": group, "channel": "settings_changed"}


class _Svc:
    """Minimal settings-service stub."""
    def __init__(self):
        self._mem: dict = {}

    async def _get_group_raw(self, group_name: str):
        return {}, {}


# ─── Test 1: None branch calls asyncio.sleep(1.0) ────────────────────────────

import pytest


@pytest.mark.asyncio
async def test_none_message_calls_sleep():
    """
    When get_message() returns None, asyncio.sleep(1.0) must be called.
    After 2 None returns the fake_sleep raises _StopLoop to end the test.
    """
    sleep_calls: list[float] = []

    async def fake_sleep(secs: float) -> None:
        sleep_calls.append(secs)
        if len(sleep_calls) >= 2:
            raise _StopLoop()  # BaseException — escapes outer except Exception

    class _PS:
        subscribed = False
        _q: list = [None, None, None]  # extra None in case sleep doesn't raise

        async def subscribe(self, *_): self.subscribed = True
        async def get_message(self, **_):
            return self._q.pop(0) if self._q else None

    class _R:
        def pubsub(self): return _PS()

    from backend.system_settings.propagation import _async_listener_loop

    with (
        patch("backend.cache.redis_cache.get_redis", new=AsyncMock(return_value=_R())),
        patch("backend.system_settings.propagation.asyncio.sleep", side_effect=fake_sleep),
    ):
        try:
            await _async_listener_loop(_Svc())
        except _StopLoop:
            pass

    assert len(sleep_calls) >= 2, f"Expected ≥2 sleep(1.0) calls, got {sleep_calls}"
    assert all(s == 1.0 for s in sleep_calls), f"Expected sleep(1.0), got {sleep_calls}"


# ─── Test 2: Real message bypasses sleep ─────────────────────────────────────

@pytest.mark.asyncio
async def test_real_message_no_sleep():
    """
    When get_message() returns a real message, asyncio.sleep must NOT be called.
    After both messages are consumed the loop raises _StopLoop via get_message.
    """
    sleep_calls: list[float] = []
    processed: list[str] = []

    async def fake_sleep(secs: float) -> None:
        sleep_calls.append(secs)

    class _PS:
        subscribed = False
        _q: list = [_msg("features"), _msg("ai")]

        async def subscribe(self, *_): self.subscribed = True
        async def get_message(self, **_):
            if self._q:
                return self._q.pop(0)
            raise _StopLoop()

    class _R:
        def pubsub(self): return _PS()

    class _TrackSvc(_Svc):
        async def _get_group_raw(self, group_name: str):
            processed.append(group_name)
            return {}, {}

    from backend.system_settings.propagation import _async_listener_loop

    with (
        patch("backend.cache.redis_cache.get_redis", new=AsyncMock(return_value=_R())),
        patch("backend.system_settings.propagation.asyncio.sleep", side_effect=fake_sleep),
    ):
        try:
            await _async_listener_loop(_TrackSvc())
        except _StopLoop:
            pass

    assert sleep_calls == [], f"sleep() must not fire on real messages, got {sleep_calls}"
    assert "features" in processed
    assert "ai" in processed


# ─── Test 3: Emergency stop / maintenance mode cache eviction ─────────────────

@pytest.mark.asyncio
async def test_emergency_stop_evicts_cache():
    """
    emergency_stop and maintenance_mode live in FeatureFlags (group='features').
    On a 'features' pub/sub message, the stale cache entry must be evicted so
    the next read reloads the updated flag from Redis/DB.
    """
    class _PS:
        subscribed = False
        _q: list = [_msg("features")]

        async def subscribe(self, *_): self.subscribed = True
        async def get_message(self, **_):
            if self._q:
                return self._q.pop(0)
            raise _StopLoop()

    class _R:
        def pubsub(self): return _PS()

    svc = _Svc()
    svc._mem["features"] = {"emergency_stop": False, "maintenance_mode": False}

    from backend.system_settings.propagation import _async_listener_loop

    with (
        patch("backend.cache.redis_cache.get_redis", new=AsyncMock(return_value=_R())),
        patch("backend.system_settings.propagation.asyncio.sleep"),
    ):
        try:
            await _async_listener_loop(svc)
        except _StopLoop:
            pass

    assert "features" not in svc._mem, (
        "Stale 'features' cache entry must be evicted on pub/sub message "
        "so emergency_stop/maintenance_mode reload from the source of truth"
    )


# ─── Test 4: FeatureFlags group key and field existence ───────────────────────

def test_feature_flags_fields():
    """
    Documents the settings model structure used by Tests 2 and 3.
    FeatureFlags must have emergency_stop, maintenance_mode, and be registered
    under the 'features' group key (the key the listener evicts on message).
    """
    from backend.system_settings.groups import FeatureFlags, GROUP_REGISTRY

    fields = FeatureFlags.model_fields
    assert "emergency_stop" in fields, "FeatureFlags must have emergency_stop"
    assert "maintenance_mode" in fields, "FeatureFlags must have maintenance_mode"

    registered_key = next(
        (k for k, cls in GROUP_REGISTRY.items() if cls is FeatureFlags), None
    )
    assert registered_key == "features", (
        f"FeatureFlags must be registered as 'features', found {registered_key!r}"
    )


# ─── Test 5: Reconnect back-off fires after connection error ──────────────────

@pytest.mark.asyncio
async def test_reconnect_backoff_fires():
    """
    When get_message() raises ConnectionError, the outer loop catches it,
    calls asyncio.sleep(backoff), and retries the connection.
    """
    sleep_calls: list[float] = []
    connect_count = [0]

    async def fake_sleep(secs: float) -> None:
        sleep_calls.append(secs)
        if len(sleep_calls) >= 2:
            raise _StopLoop()

    class _BrokenPS:
        subscribed = False
        async def subscribe(self, *_): self.subscribed = True
        async def get_message(self, **_):
            raise ConnectionError("simulated disconnect")

    class _R:
        def pubsub(self): return _BrokenPS()

    async def fake_get_redis():
        connect_count[0] += 1
        return _R()

    from backend.system_settings.propagation import _async_listener_loop

    with (
        patch("backend.cache.redis_cache.get_redis", side_effect=fake_get_redis),
        patch("backend.system_settings.propagation.asyncio.sleep", side_effect=fake_sleep),
    ):
        try:
            await _async_listener_loop(_Svc())
        except _StopLoop:
            pass

    assert connect_count[0] >= 2, (
        f"Worker must retry connection after error, got {connect_count[0]} attempts"
    )
    assert len(sleep_calls) >= 1, "Back-off sleep must fire after ConnectionError"
    # First back-off is 1.0 s (initial backoff value in the outer loop)
    assert sleep_calls[0] == 1.0, f"First back-off must be 1.0 s, got {sleep_calls[0]}"
