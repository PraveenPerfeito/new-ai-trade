"""
Background coroutine that periodically scrapes infrastructure state and
updates the Prometheus gauges that can't be derived from request-path counters:

  - Redis memory (INFO memory → redis_memory_used_bytes)
  - Celery queue depth (LLEN → celery_queue_depth{queue=...})
  - asyncpg pool stats (get_pool().get_size() → asyncpg_pool_size / asyncpg_pool_free)

Call start_infra_collector() once during app startup.
"""
from __future__ import annotations

import asyncio

from backend.logging.setup import get_logger
from backend.metrics.prometheus import (
    asyncpg_pool_free,
    asyncpg_pool_size,
    celery_queue_depth,
    redis_memory_used_bytes,
)

log = get_logger(__name__)

_INTERVAL = 30       # seconds between scrapes
_QUEUES   = ("scanner", "paper_trading", "celery")


async def _collect_once() -> None:
    # ── Redis ─────────────────────────────────────────────────────────────────
    try:
        from backend.cache.redis_cache import get_redis
        redis = await get_redis()

        # Memory
        info = await redis.info("memory")
        used = info.get("used_memory", 0)
        redis_memory_used_bytes.set(used)

        # Celery queue depths (each queue is a Redis list)
        for q in _QUEUES:
            depth = await redis.llen(q)
            celery_queue_depth.labels(queue=q).set(depth)

    except Exception as exc:
        log.warning("infra_collector_redis_error", error=str(exc))

    # ── asyncpg pool ──────────────────────────────────────────────────────────
    try:
        from backend.database.session import get_pool
        pool = await get_pool()
        if pool is not None:
            asyncpg_pool_size.set(pool.get_size())
            asyncpg_pool_free.set(pool.get_idle_size())
    except Exception as exc:
        log.warning("infra_collector_pool_error", error=str(exc))


async def _run_loop() -> None:
    while True:
        await _collect_once()
        await asyncio.sleep(_INTERVAL)


_collector_task: asyncio.Task | None = None


def start_infra_collector() -> None:
    """Start the background collector in the current running event loop."""
    global _collector_task
    try:
        loop = asyncio.get_running_loop()
        if _collector_task is None or _collector_task.done():
            _collector_task = loop.create_task(_run_loop())
            log.info("infra_collector_started", interval_s=_INTERVAL)
    except RuntimeError:
        log.warning("infra_collector_no_event_loop")
