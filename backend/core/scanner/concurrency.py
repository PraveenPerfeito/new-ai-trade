"""
Async concurrency utilities for concurrent coin scanning.
Provides semaphore-bounded gather and per-item timeout isolation.
"""
from __future__ import annotations

import asyncio
from typing import TypeVar, Callable, Awaitable, Any

from backend.logging.setup import get_logger

log = get_logger(__name__)

T = TypeVar("T")


async def run_with_timeout(
    coro: Awaitable[T],
    timeout: float,
    label: str = "",
) -> tuple[T | None, Exception | None]:
    """
    Await coro with a wall-clock timeout.
    Returns (result, None) on success, (None, exc) on timeout or error.
    One failed coin never propagates to the whole gather.
    """
    try:
        return await asyncio.wait_for(coro, timeout=timeout), None
    except asyncio.TimeoutError as exc:
        log.warning("scan_timeout", label=label, timeout_s=timeout)
        return None, exc
    except Exception as exc:
        log.warning("scan_error", label=label, error=str(exc))
        return None, exc


async def gather_with_concurrency(
    items: list[Any],
    worker: Callable[[Any], Awaitable[T]],
    max_concurrent: int = 5,
    timeout_per_item: float = 30.0,
) -> list[tuple[Any, T | None, Exception | None]]:
    """
    Fan-out worker(item) over all items with at most max_concurrent running
    simultaneously. Each item is independently timeout-guarded.

    Returns a list of (item, result, error) preserving input order.
    """
    semaphore = asyncio.Semaphore(max_concurrent)

    async def bounded(item: Any) -> tuple[Any, T | None, Exception | None]:
        async with semaphore:
            result, err = await run_with_timeout(
                worker(item), timeout_per_item, label=str(item)
            )
            return item, result, err

    return list(await asyncio.gather(*[bounded(item) for item in items]))
