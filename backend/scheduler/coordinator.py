"""
Distributed scheduler coordinator backed by Redis.
Uses SET NX EX (atomic) for distributed locks so only one worker runs
a scan at a time — replaces the globalThis singleton in lib/scheduler.ts.
"""
from __future__ import annotations

import json
import time
from typing import Literal

import redis as sync_redis

from backend.config import get_settings
from backend.logging.setup import get_logger
from backend.metrics.prometheus import scheduler_active, scheduler_scanning

log = get_logger(__name__)

ScanMode = Literal["standard", "high_confidence", "futures"]

_SCHEDULER_STATE_KEY = "scheduler:state"
_LOCK_KEY_PREFIX     = "scheduler:lock:"
_ENABLED_KEY         = "scheduler:enabled"
_STATUS_CACHE_KEY    = "scheduler:status_cache"
_STATUS_CACHE_TTL    = 5   # OPT-7: cache status for 5s — reduces 5 ops/call → 1 GET on hits


class SchedulerCoordinator:
    """
    Thin wrapper around Redis for distributed scheduler state.
    All methods are synchronous (called from Celery task context).
    """

    def __init__(self) -> None:
        settings = get_settings()
        ssl_opts: dict = {}
        if settings.redis_url.startswith("rediss://"):
            # Use string "none" not ssl.CERT_NONE (=0): redis-py only sets
            # RedisSSLContext.cert_reqs when the value is truthy, so the integer
            # 0 is silently skipped leaving cert verification enabled.
            ssl_opts["ssl_cert_reqs"] = "none"
        self._redis = sync_redis.from_url(
            settings.redis_url,
            decode_responses=True,
            socket_connect_timeout=2,
            socket_timeout=2,
            **ssl_opts,
        )

    # ── Scan lock ─────────────────────────────────────────────────────────────

    def acquire_scan_lock(self, mode: ScanMode, ttl_seconds: int = 660) -> bool:
        """
        Attempt to acquire the distributed scan lock for `mode`.
        Returns True if the lock was acquired, False if another worker holds it.
        Fails open (returns True) if Redis is unavailable — duplicate-scan risk is
        acceptable vs. complete scan outage when Redis is down or quota-exceeded.
        """
        try:
            key = f"{_LOCK_KEY_PREFIX}{mode}"
            acquired = self._redis.set(key, "1", nx=True, ex=ttl_seconds)
            if acquired:
                scheduler_scanning.set(1)
                self._redis.delete(_STATUS_CACHE_KEY)   # OPT-7: scanning state changed
                log.debug("scan_lock_acquired", mode=mode)
            return bool(acquired)
        except Exception as exc:
            log.warning("acquire_scan_lock_redis_error", error=str(exc))
            return True  # fail-open: Redis unavailable → allow scan (no duplicate guard)

    def release_scan_lock(self, mode: ScanMode) -> None:
        key = f"{_LOCK_KEY_PREFIX}{mode}"
        self._redis.delete(key)
        self._redis.delete(_STATUS_CACHE_KEY)   # OPT-7: scanning state changed
        scheduler_scanning.set(0)
        log.debug("scan_lock_released", mode=mode)

    def is_scan_running(self, mode: ScanMode) -> bool:
        key = f"{_LOCK_KEY_PREFIX}{mode}"
        return self._redis.exists(key) == 1

    # ── Scheduler enable / disable ────────────────────────────────────────────

    def enable(self) -> None:
        self._redis.set(_ENABLED_KEY, "1")
        self._redis.delete(_STATUS_CACHE_KEY)   # OPT-7: invalidate status cache
        scheduler_active.set(1)
        log.info("scheduler_enabled")

    def disable(self) -> None:
        self._redis.set(_ENABLED_KEY, "0")
        self._redis.delete(_STATUS_CACHE_KEY)   # OPT-7: invalidate status cache
        scheduler_active.set(0)
        log.info("scheduler_disabled")

    def is_enabled(self) -> bool:
        try:
            val = self._redis.get(_ENABLED_KEY)
            return val != "0"   # enabled by default if key doesn't exist
        except Exception as exc:
            log.warning("coordinator_is_enabled_redis_error", error=str(exc))
            return True  # fail-open: Redis unavailable → assume enabled

    # ── Status snapshot ───────────────────────────────────────────────────────

    def status(self) -> dict:
        # OPT-7: serve from 5s cache — reduces 5 Redis ops to 1 GET on dashboard polls
        try:
            cached = self._redis.get(_STATUS_CACHE_KEY)
            if cached:
                return json.loads(cached)
        except Exception:
            pass

        enabled = self.is_enabled()
        running_modes = [
            m for m in ("standard", "high_confidence", "futures")
            if self.is_scan_running(m)  # type: ignore[arg-type]
        ]
        last_ts_raw = self._redis.get("scheduler:last_scan_ts")
        result = {
            "enabled":       enabled,
            "scanning":      bool(running_modes),
            "running_modes": running_modes,
            "last_scan_at":  float(last_ts_raw) if last_ts_raw else None,
        }
        try:
            self._redis.setex(_STATUS_CACHE_KEY, _STATUS_CACHE_TTL, json.dumps(result))
        except Exception:
            pass
        return result

    def record_scan_complete(self) -> None:
        self._redis.set("scheduler:last_scan_ts", str(time.time()))
        try:
            self._redis.delete(_STATUS_CACHE_KEY)   # OPT-7: force fresh status on next poll
        except Exception:
            pass
