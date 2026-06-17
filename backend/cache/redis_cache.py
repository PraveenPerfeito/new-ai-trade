"""
Redis-backed TTL cache mirroring the interface of lib/cache.ts.
Falls back to an in-memory dict if Redis is unavailable (dev/test).
"""
from __future__ import annotations

import json
import time
from typing import Any, Callable, Awaitable, Optional

import redis.asyncio as aioredis

from backend.config import get_settings
from backend.logging.setup import get_logger
from backend.metrics.prometheus import cache_hits_total, cache_misses_total

log = get_logger(__name__)

_redis_client: Optional[aioredis.Redis] = None


async def get_redis() -> aioredis.Redis:
    global _redis_client
    if _redis_client is None:
        settings = get_settings()
        kw: dict = {
            "encoding": "utf-8",
            "decode_responses": True,
            "socket_connect_timeout": 2,
            "socket_timeout": 2,
        }
        # Upstash (rediss://) — disable cert verification.
        # Use string "none" not Python None: redis-py only sets RedisSSLContext.cert_reqs
        # when the value is not None and truthy, so None/CERT_NONE(=0) both cause
        # AttributeError in get(). "none" is truthy and maps to ssl.CERT_NONE internally.
        if settings.redis_url.startswith("rediss://"):
            kw["ssl_cert_reqs"] = "none"
        _redis_client = aioredis.from_url(settings.redis_url, **kw)
    return _redis_client


async def close_redis() -> None:
    global _redis_client
    if _redis_client is not None:
        await _redis_client.aclose()
        _redis_client = None


class RedisCache:
    """
    Async TTL cache backed by Redis.
    All values are JSON-serialised so any JSON-serialisable type is supported.
    """

    def __init__(self, name: str, ttl_seconds: int) -> None:
        self.name = name
        self.ttl_seconds = ttl_seconds
        self._fallback: dict[str, tuple[Any, float]] = {}  # key → (value, expires_at)

    def _key(self, key: str) -> str:
        return f"cache:{self.name}:{key}"

    # ── Core operations ───────────────────────────────────────────────────────

    async def get(self, key: str) -> Any | None:
        try:
            redis = await get_redis()
            raw = await redis.get(self._key(key))
            if raw is None:
                cache_misses_total.labels(cache_name=self.name).inc()
                return None
            cache_hits_total.labels(cache_name=self.name).inc()
            return json.loads(raw)
        except Exception:
            return self._fallback_get(key)

    async def set(self, key: str, value: Any, ttl_seconds: int | None = None) -> None:
        ttl = ttl_seconds or self.ttl_seconds
        try:
            redis = await get_redis()
            await redis.setex(self._key(key), ttl, json.dumps(value, default=str))
        except Exception as exc:
            log.warning("redis_cache_set_failed", cache=self.name, key=key, error=str(exc))
            self._fallback[key] = (value, time.monotonic() + ttl)

    async def delete(self, key: str) -> None:
        try:
            redis = await get_redis()
            await redis.delete(self._key(key))
        except Exception:
            self._fallback.pop(key, None)

    async def clear(self) -> None:
        try:
            redis = await get_redis()
            pattern = self._key("*")
            keys = [k async for k in redis.scan_iter(match=pattern, count=100)]
            if keys:
                await redis.delete(*keys)
        except Exception:
            self._fallback.clear()

    async def get_or_set(
        self,
        key: str,
        loader: Callable[[], Awaitable[Any]],
        ttl_seconds: int | None = None,
    ) -> Any:
        cached = await self.get(key)
        if cached is not None:
            return cached
        value = await loader()
        await self.set(key, value, ttl_seconds)
        return value

    # ── Stats (scans Redis keyspace — use sparingly) ──────────────────────────

    async def size(self) -> int:
        try:
            redis = await get_redis()
            count = 0
            async for _ in redis.scan_iter(match=self._key("*"), count=100):
                count += 1
            return count
        except Exception:
            return len(self._fallback)

    # ── In-memory fallback ────────────────────────────────────────────────────

    def _fallback_get(self, key: str) -> Any | None:
        entry = self._fallback.get(key)
        if entry is None:
            cache_misses_total.labels(cache_name=self.name).inc()
            return None
        value, expires_at = entry
        if time.monotonic() > expires_at:
            del self._fallback[key]
            cache_misses_total.labels(cache_name=self.name).inc()
            return None
        cache_hits_total.labels(cache_name=self.name).inc()
        return value


# ── Shared application caches (mirror lib/cache.ts) ──────────────────────────

coins_cache    = RedisCache("coins",         ttl_seconds=5 * 60)
signals_cache  = RedisCache("signals",       ttl_seconds=30)
# OPT-6: TTLs aligned to futures scan cadence (30 min) + 2-min buffer.
# Previous TTLs (2–5 min) always expired before the next scan fired, causing
# 100% cache miss rate and ~300 extra Redis ops per futures scan.
# Funding rate changes every 8h, OI/L/S trend over hours — 32-min data is valid.
oi_cache       = RedisCache("open-interest", ttl_seconds=32 * 60)   # was 2 min
funding_cache  = RedisCache("funding-rate",  ttl_seconds=32 * 60)   # was 5 min
ls_cache       = RedisCache("long-short",    ttl_seconds=32 * 60)   # was 5 min
