"""
Config propagation — real-time settings distribution to all processes.

Two complementary mechanisms guarantee freshness:

  PropagationListener  (asyncio task — FastAPI / uvicorn workers)
    Subscribes to the "settings_changed" Redis pub/sub channel.
    On every message: evicts the named group from the in-process _mem cache
    and immediately applies the new values to any registered module.
    Reconnects with exponential back-off.  Latency: ~100 ms.

  CeleryConfigWatcher  (daemon thread — Celery workers)
    Same pub/sub subscription via the synchronous redis client.
    Runs for the lifetime of the worker process.
    Also calls apply_group_to_modules() so module-level constants update
    before the next task picks them up.  Latency: ~100 ms.

  Generation-counter fallback  (service._check_generation, all contexts)
    settings:generation in Redis is INCR'd on every write.
    Every settings read checks this counter (at most once every 5 s).
    If the counter changed, the entire in-process cache is flushed.
    This guarantees propagation even when pub/sub messages are missed
    (e.g., after a reconnect, a process restart, or Redis failover).
    Latency: ≤ 5 s.

Together:
  FastAPI processes:  < 2 s  (pub/sub + 1 s poll guard)
  Celery workers:     < 1 s  (watcher thread)
  Fallback (any):     ≤ 5 s  (generation counter)
  Stale config:       impossible beyond 5 s

Poll-guard note:
  get_message(timeout=30.0) blocks for up to 30 s on the asyncio socket,
  so the inner loop is NOT a tight spin under normal conditions.  The 1 s
  sleep in the None branch is a defensive guard for edge cases where the
  method can return None quickly (e.g. subscribe-confirmation filtering,
  health-check PING/PONG cycles if health_check_interval is ever enabled,
  or any future redis-py version change).  Propagation latency stays well
  below the 5 s generation-counter fallback window.
"""
from __future__ import annotations

import asyncio
import json
import threading
import time
from typing import Optional

from backend.logging.setup import get_logger

log = get_logger(__name__)

_listener_task:  Optional[asyncio.Task]     = None
_watcher_thread: Optional[threading.Thread] = None


# ── Module hooks ──────────────────────────────────────────────────────────────

def apply_group_to_modules(group_name: str, data: dict) -> None:
    """
    Push freshly-loaded settings data to modules that maintain their own
    local state (e.g., module-level threshold constants).

    Currently wired:
      "anomaly" → anomaly_detector.configure()

    To add a new module: import and call its configure() here.
    """
    if group_name == 'anomaly':
        try:
            from backend.analytics.anomaly_detector import configure as _cfg
            _cfg(data)
            log.debug("anomaly_detector_thresholds_applied")
        except Exception as exc:
            log.warning("apply_group_anomaly_failed", error=str(exc))


# ── PropagationListener (async, FastAPI) ─────────────────────────────────────

async def _async_listener_loop(service) -> None:
    """
    Subscribes to settings_changed and keeps the in-process cache hot.
    Reconnects with exponential back-off on any failure.
    """
    from backend.cache.redis_cache import get_redis
    backoff = 1.0
    while True:
        try:
            redis = await get_redis()
            pubsub = redis.pubsub()
            await pubsub.subscribe("settings_changed")
            backoff = 1.0
            log.info("settings_propagation_subscribed")

            while True:
                message = await pubsub.get_message(
                    ignore_subscribe_messages=True,
                    timeout=30.0,
                )
                if message is None:
                    # get_message(timeout=30) normally blocks ~30 s via async_timeout.
                    # This sleep guards against edge cases that return None quickly:
                    # subscribe-confirmation filtering, PING/PONG health-check cycles,
                    # or future redis-py behavior changes.
                    await asyncio.sleep(1.0)
                    continue
                if message["type"] != "message":
                    continue
                group_name: str = message["data"]
                if isinstance(group_name, bytes):
                    group_name = group_name.decode()

                # Evict stale in-memory entry
                service._mem.pop(group_name, None)

                # Re-load and apply to registered modules
                try:
                    data, _ = await service._get_group_raw(group_name)
                    apply_group_to_modules(group_name, data)
                except Exception as exc:
                    log.warning("settings_apply_failed", group=group_name, error=str(exc))

                log.debug("settings_propagated_async", group=group_name)

        except asyncio.CancelledError:
            return
        except Exception as exc:
            log.warning("settings_listener_reconnect", error=str(exc), backoff=backoff)
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 60.0)


async def start_propagation_listener(service) -> None:
    """Start the async pub/sub listener.  Call once from FastAPI lifespan."""
    global _listener_task
    if _listener_task and not _listener_task.done():
        return
    _listener_task = asyncio.create_task(
        _async_listener_loop(service),
        name="settings_propagation",
    )
    log.info("settings_propagation_listener_started")


async def stop_propagation_listener() -> None:
    """Cancel the listener task.  Call from FastAPI lifespan shutdown."""
    global _listener_task
    if _listener_task and not _listener_task.done():
        _listener_task.cancel()
        try:
            await _listener_task
        except asyncio.CancelledError:
            pass
    _listener_task = None
    log.info("settings_propagation_listener_stopped")


# ── CeleryConfigWatcher (sync daemon thread, Celery workers) ─────────────────

def _sync_watcher_loop(service) -> None:
    """
    Daemon thread body.  Subscribes via sync redis and invalidates the
    per-process in-memory cache whenever settings change.
    """
    import redis as sync_redis
    from backend.config import get_settings
    from backend.system_settings.groups import GROUP_REGISTRY

    settings = get_settings()
    backoff   = 1.0

    while True:
        try:
            kw: dict = {
                "decode_responses": True,
                "socket_timeout": 30,
                "socket_connect_timeout": 5,
            }
            # Upstash (rediss://) — use string "none" not Python None (see redis_cache.py).
            if settings.redis_url.startswith("rediss://"):
                kw["ssl_cert_reqs"] = "none"
            client = sync_redis.Redis.from_url(settings.redis_url, **kw)
            pubsub = client.pubsub()
            pubsub.subscribe("settings_changed")
            backoff = 1.0
            log.info("celery_settings_watcher_subscribed")

            while True:
                # WATCHER.IDLE.FIX: poll with a bounded timeout instead of the
                # blocking listen() — a quiet channel previously hit the client's
                # socket_timeout, raising "Timeout reading from socket" and forcing
                # a warn+reconnect cycle every 60s (log spam + missed-message gaps).
                # get_message timeout (25s) < socket_timeout (30s) → idle returns
                # None cleanly; real connection failures still raise to the outer
                # reconnect handler.
                try:
                    message = pubsub.get_message(ignore_subscribe_messages=True, timeout=25.0)
                except sync_redis.exceptions.TimeoutError:
                    continue   # idle socket, not a failure — keep listening
                if message is None or message["type"] != "message":
                    continue
                group_name: str = message["data"]

                # Evict in-process cache
                service._mem.pop(group_name, None)

                # Load from Redis so module hooks fire immediately (no DB round-trip)
                try:
                    raw = client.get(f"settings:d:{group_name}")
                    if raw:
                        from_redis = json.loads(raw)
                        model_class = GROUP_REGISTRY.get(group_name)
                        defaults = model_class.defaults_dict() if model_class else {}
                        data = {**defaults, **from_redis}
                        apply_group_to_modules(group_name, data)
                except Exception as exc:
                    log.warning("celery_watcher_apply_failed",
                                group=group_name, error=str(exc))

                log.debug("settings_propagated_sync", group=group_name)

        except Exception as exc:
            log.warning("celery_settings_watcher_reconnect",
                        error=str(exc), backoff=backoff)
            time.sleep(backoff)
            backoff = min(backoff * 2, 60.0)


def start_celery_config_watcher(service) -> None:
    """
    Start the daemon watcher thread.  Call once per worker process
    (e.g., from the worker_init Celery signal).  Idempotent.
    """
    global _watcher_thread
    if _watcher_thread and _watcher_thread.is_alive():
        return
    _watcher_thread = threading.Thread(
        target=_sync_watcher_loop,
        args=(service,),
        daemon=True,
        name="settings-watcher",
    )
    _watcher_thread.start()
    log.info("celery_settings_watcher_started")
