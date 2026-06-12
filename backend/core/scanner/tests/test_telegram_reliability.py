"""
TELEGRAM.RELIABILITY.1 — unit tests.

WS1: per-loop queue recreation + flush_queue drains before loop exit
WS2: delivery receipts recorded with queue item signal_id
WS3: dedup is check-only; cooldown marked only after confirmed delivery
WS4: validator semaphore / rate limiter are per-event-loop
"""
from __future__ import annotations

import asyncio

import pytest

from backend.core.scanner import telegram_notifier as tn


@pytest.fixture(autouse=True)
def _reset_queue_state():
    """Each test starts with a fresh queue singleton."""
    tn._queue = None
    tn._queue_loop = None
    tn._worker_task = None
    yield
    tn._queue = None
    tn._queue_loop = None
    tn._worker_task = None


# ── WS4: per-loop concurrency primitives ──────────────────────────────────────

class TestPerLoopPrimitives:
    def test_semaphore_recreated_across_loops(self):
        from backend.core.scanner import ai_validator as av

        async def grab():
            return av._get_semaphore()

        sem_a = asyncio.run(grab())
        sem_b = asyncio.run(grab())
        # The audited bug: same object reused across loops → 'bound to a
        # different event loop'. Fixed = a fresh semaphore per loop.
        assert sem_a is not sem_b

    def test_rate_limiter_recreated_across_loops(self):
        from backend.core.scanner import ai_validator as av

        async def grab():
            return av._get_rate_limiter()

        rl_a = asyncio.run(grab())
        rl_b = asyncio.run(grab())
        assert rl_a is not rl_b

    def test_same_loop_reuses_instances(self):
        from backend.core.scanner import ai_validator as av

        async def grab_twice():
            return av._get_semaphore(), av._get_semaphore()

        a, b = asyncio.run(grab_twice())
        assert a is b


# ── WS1: queue lifecycle ──────────────────────────────────────────────────────

class TestQueueLifecycle:
    def test_queue_recreated_across_loops(self):
        async def get_q():
            return tn._get_queue()

        q_a = asyncio.run(get_q())
        q_b = asyncio.run(get_q())
        assert q_a is not q_b

    def test_flush_drains_all_items(self, monkeypatch):
        sent: list[str] = []

        async def fake_send(text: str) -> bool:
            sent.append(text)
            return True

        monkeypatch.setattr(tn, "_send_with_retry", fake_send)
        monkeypatch.setattr(tn, "_MIN_INTERVAL", 0.0)

        async def scenario():
            tn._enqueue("alert-1")
            tn._enqueue("alert-2")
            tn._enqueue("alert-3")
            return await tn.flush_queue(timeout_s=5.0)

        drained = asyncio.run(scenario())
        assert drained is True
        assert sent == ["alert-1", "alert-2", "alert-3"]

    def test_flush_noop_when_empty(self):
        async def scenario():
            return await tn.flush_queue(timeout_s=1.0)
        assert asyncio.run(scenario()) is True


# ── WS2 + WS3: receipts and dedup-after-delivery ─────────────────────────────

class _FakeRedis:
    def __init__(self):
        self.store: dict[str, str] = {}
        self.setex_calls: list[tuple] = []

    async def exists(self, key):
        return 1 if key in self.store else 0

    async def setex(self, key, ttl, value):
        self.store[key] = value
        self.setex_calls.append((key, ttl, value))


class TestDeliveryAndDedup:
    def test_dedup_check_does_not_write(self, monkeypatch):
        fake = _FakeRedis()

        async def fake_get_redis():
            return fake

        import backend.cache.redis_cache as rc
        monkeypatch.setattr(rc, "get_redis", fake_get_redis)

        async def scenario():
            return await tn._is_duplicate_alert("BTC", "LONG")

        assert asyncio.run(scenario()) is False
        # WS3: the check must NOT set the cooldown key any more
        assert fake.setex_calls == []
        assert fake.store == {}

    def test_cooldown_marked_only_after_delivery(self, monkeypatch):
        fake = _FakeRedis()

        async def fake_get_redis():
            return fake

        import backend.cache.redis_cache as rc
        monkeypatch.setattr(rc, "get_redis", fake_get_redis)

        receipts: list[tuple] = []

        async def fake_record(signal_id, delivered, error=None):
            receipts.append((signal_id, delivered, error))

        async def fake_send_ok(text: str) -> bool:
            return True

        monkeypatch.setattr(tn, "_record_delivery", fake_record)
        monkeypatch.setattr(tn, "_send_with_retry", fake_send_ok)
        monkeypatch.setattr(tn, "_MIN_INTERVAL", 0.0)

        async def scenario():
            tn._enqueue("msg", signal_id="sig-1", dedup_key="tg:alert:BTC:LONG")
            await tn.flush_queue(timeout_s=5.0)

        asyncio.run(scenario())
        assert ("tg:alert:BTC:LONG", tn.ALERT_COOLDOWN_HOURS * 3600, "1") in fake.setex_calls
        assert receipts == [("sig-1", True, None)]

    def test_failed_delivery_no_cooldown_and_failure_receipt(self, monkeypatch):
        fake = _FakeRedis()

        async def fake_get_redis():
            return fake

        import backend.cache.redis_cache as rc
        monkeypatch.setattr(rc, "get_redis", fake_get_redis)

        receipts: list[tuple] = []

        async def fake_record(signal_id, delivered, error=None):
            receipts.append((signal_id, delivered))

        async def fake_send_fail(text: str) -> bool:
            return False

        monkeypatch.setattr(tn, "_record_delivery", fake_record)
        monkeypatch.setattr(tn, "_send_with_retry", fake_send_fail)
        monkeypatch.setattr(tn, "_MIN_INTERVAL", 0.0)

        async def scenario():
            tn._enqueue("msg", signal_id="sig-2", dedup_key="tg:alert:ETH:SHORT")
            await tn.flush_queue(timeout_s=5.0)

        asyncio.run(scenario())
        # WS3 guarantee: failed delivery must NOT suppress future signals
        assert fake.setex_calls == []
        assert receipts == [("sig-2", False)]

    def test_ops_alert_enqueue_backward_compatible(self, monkeypatch):
        sent: list[str] = []

        async def fake_send(text: str) -> bool:
            sent.append(text)
            return True

        monkeypatch.setattr(tn, "_send_with_retry", fake_send)
        monkeypatch.setattr(tn, "_MIN_INTERVAL", 0.0)

        async def scenario():
            tn._enqueue("plain ops alert")   # no signal_id / dedup_key
            await tn.flush_queue(timeout_s=5.0)

        asyncio.run(scenario())
        assert sent == ["plain ops alert"]
