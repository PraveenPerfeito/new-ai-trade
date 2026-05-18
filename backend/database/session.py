"""
asyncpg connection pool for direct Postgres access.
Use get_pool() to obtain the shared pool; it is initialised on first call.
"""
from __future__ import annotations

from typing import Optional

import asyncpg

from backend.config import get_settings
from backend.logging.setup import get_logger

log = get_logger(__name__)

_pool: Optional[asyncpg.Pool] = None


async def get_pool() -> asyncpg.Pool:
    global _pool
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
        log.info("asyncpg_pool_created", min_size=2, max_size=10)
    return _pool


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None
        log.info("asyncpg_pool_closed")
