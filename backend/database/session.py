"""
asyncpg connection pool for direct Postgres access.
Use get_pool() to obtain the shared pool; it is initialised on first call.

Pool is scoped to the running event loop.  Celery workers call asyncio.run()
which creates a fresh event loop each invocation — get_pool() detects this
and recreates the pool so the same module-global is safe across contexts.
"""
from __future__ import annotations

import asyncio
from typing import Optional

import asyncpg

from backend.config import get_settings
from backend.logging.setup import get_logger

log = get_logger(__name__)

_pool: Optional[asyncpg.Pool] = None
_pool_loop: Optional[asyncio.AbstractEventLoop] = None


async def get_pool() -> asyncpg.Pool:
    global _pool, _pool_loop

    try:
        current_loop = asyncio.get_running_loop()
    except RuntimeError:
        raise RuntimeError("get_pool() must be called from an async context")

    # Recreate pool when event loop changed (common in Celery asyncio.run() context)
    if _pool is not None and _pool_loop is not current_loop:
        log.debug("asyncpg_pool_loop_changed_recreating")
        try:
            await _pool.close()
        except Exception:
            pass
        _pool = None
        _pool_loop = None

    if _pool is None:
        settings = get_settings()
        if not settings.database_url:
            raise RuntimeError(
                "DATABASE_URL is not set — cannot create asyncpg pool. "
                "Set it in .env.local (postgres://user:pass@host:5432/db)."
            )
        _pool = await asyncpg.create_pool(
            dsn=settings.database_url,
            min_size=2,
            max_size=10,
            command_timeout=30,
            statement_cache_size=0,  # required when using PgBouncer in transaction mode
        )
        _pool_loop = current_loop
        log.info("asyncpg_pool_created", min_size=2, max_size=10)

    return _pool


async def close_pool() -> None:
    global _pool, _pool_loop
    if _pool is not None:
        await _pool.close()
        _pool = None
        _pool_loop = None
        log.info("asyncpg_pool_closed")
