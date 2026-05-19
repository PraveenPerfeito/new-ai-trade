"""
Realtime metrics streaming via Redis pub/sub.
publish_event() writes scanner/signal events to the channel;
sse_metrics_stream() is an AsyncGenerator consumed by the SSE endpoint.
"""
from __future__ import annotations

import asyncio
import json
from typing import AsyncGenerator

from backend.cache.redis_cache import get_redis
from backend.logging.setup import get_logger

log = get_logger(__name__)

CHANNEL = "scanner:realtime"


async def publish_event(event_type: str, data: dict) -> None:
    """Publish a named event to the Redis realtime channel. Never raises."""
    try:
        redis = await get_redis()
        payload = json.dumps({"type": event_type, "data": data})
        await redis.publish(CHANNEL, payload)
    except Exception as exc:
        log.warning("publish_event_failed", event_type=event_type, error=str(exc))


async def sse_metrics_stream(timeout_seconds: int = 300) -> AsyncGenerator[str, None]:
    """
    Yield SSE-formatted strings from the Redis realtime channel.
    Closes after `timeout_seconds` with no activity or if cancelled.
    """
    try:
        redis  = await get_redis()
        pubsub = redis.pubsub()
        await pubsub.subscribe(CHANNEL)

        loop     = asyncio.get_running_loop()
        deadline = loop.time() + timeout_seconds

        async for message in pubsub.listen():
            if loop.time() > deadline:
                break
            if message["type"] != "message":
                continue
            raw = message["data"]
            if isinstance(raw, bytes):
                raw = raw.decode()
            yield f"data: {raw}\n\n"

    except asyncio.CancelledError:
        pass
    except Exception as exc:
        log.warning("sse_stream_error", error=str(exc))
    finally:
        try:
            await pubsub.unsubscribe(CHANNEL)
        except Exception:
            pass
