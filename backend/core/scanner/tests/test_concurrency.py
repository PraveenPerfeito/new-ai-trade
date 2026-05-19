"""
Validation tests for backend/core/scanner/concurrency.py.
Tests: timeout isolation, semaphore bounds, partial failure recovery,
       and that one failing item never blocks others.

Uses asyncio.run() directly (no pytest-asyncio required).
"""
from __future__ import annotations

import asyncio
import time

import pytest

from backend.core.scanner.concurrency import gather_with_concurrency, run_with_timeout


def run(coro):
    """Helper: run a coroutine synchronously for use in sync test functions."""
    return asyncio.run(coro)


# ── run_with_timeout ──────────────────────────────────────────────────────────

def test_run_with_timeout_success():
    async def fast():
        return 42

    result, err = run(run_with_timeout(fast(), timeout=5.0))
    assert result == 42
    assert err is None


def test_run_with_timeout_times_out():
    async def slow():
        await asyncio.sleep(10)

    result, err = run(run_with_timeout(slow(), timeout=0.05))
    assert result is None
    assert isinstance(err, asyncio.TimeoutError)


def test_run_with_timeout_captures_exception():
    async def boom():
        raise ValueError("oops")

    result, err = run(run_with_timeout(boom(), timeout=5.0))
    assert result is None
    assert isinstance(err, ValueError)


def test_run_with_timeout_label_does_not_affect_result():
    async def ok():
        return "hello"

    result, err = run(run_with_timeout(ok(), timeout=1.0, label="test-label"))
    assert result == "hello"
    assert err is None


# ── gather_with_concurrency ───────────────────────────────────────────────────

def test_gather_preserves_order():
    items = list(range(10))

    async def worker(x):
        await asyncio.sleep(0.01)
        return x * 2

    async def _run():
        return await gather_with_concurrency(items, worker, max_concurrent=5)

    results = run(_run())
    for i, (item, result, err) in enumerate(results):
        assert item == i
        assert result == i * 2
        assert err is None


def test_gather_partial_failure_isolated():
    items = list(range(5))

    async def worker(x):
        if x == 2:
            raise RuntimeError("item 2 failed")
        return x

    async def _run():
        return await gather_with_concurrency(items, worker, max_concurrent=5)

    results = run(_run())
    assert len(results) == 5
    ok_results   = [(item, r, e) for item, r, e in results if e is None]
    fail_results = [(item, r, e) for item, r, e in results if e is not None]
    assert len(ok_results) == 4
    assert len(fail_results) == 1
    assert fail_results[0][0] == 2


def test_gather_all_fail():
    items = [1, 2, 3]

    async def worker(x):
        raise ValueError(f"always fails: {x}")

    async def _run():
        return await gather_with_concurrency(items, worker, max_concurrent=3)

    results = run(_run())
    assert all(err is not None for _, _, err in results)
    assert all(result is None for _, result, _ in results)


def test_gather_timeout_isolates_slow_item():
    items = [0, 1, 2]

    async def worker(x):
        if x == 1:
            await asyncio.sleep(10)
        return x * 10

    async def _run():
        return await gather_with_concurrency(items, worker, max_concurrent=3, timeout_per_item=0.1)

    results = run(_run())
    assert len(results) == 3
    _, r0, e0 = results[0]
    _, r1, e1 = results[1]
    _, r2, e2 = results[2]
    assert r0 == 0 and e0 is None
    assert r1 is None and isinstance(e1, asyncio.TimeoutError)
    assert r2 == 20 and e2 is None


def test_semaphore_limits_concurrency():
    """Verify no more than max_concurrent tasks run simultaneously."""
    max_concurrent = 3
    active         = 0
    max_observed   = 0
    items          = list(range(10))

    async def _run():
        nonlocal active, max_observed
        lock = asyncio.Lock()

        async def worker(x):
            nonlocal active, max_observed
            async with lock:
                active += 1
                max_observed = max(max_observed, active)
            await asyncio.sleep(0.05)
            async with lock:
                active -= 1
            return x

        return await gather_with_concurrency(items, worker, max_concurrent=max_concurrent)

    run(_run())
    assert max_observed <= max_concurrent


def test_gather_empty_items():
    async def _run():
        return await gather_with_concurrency([], lambda x: asyncio.sleep(0), max_concurrent=5)

    results = run(_run())
    assert results == []


def test_gather_single_item():
    async def worker(x):
        return x * 3

    async def _run():
        return await gather_with_concurrency([7], worker, max_concurrent=5)

    results = run(_run())
    assert len(results) == 1
    assert results[0] == (7, 21, None)


def test_gather_wall_time_bounded_by_timeout():
    """Total time << n * timeout because semaphore allows parallel execution."""
    n        = 20
    timeout  = 0.05
    max_conc = 5
    items    = list(range(n))

    async def slow(_):
        await asyncio.sleep(10)

    async def _run():
        return await gather_with_concurrency(items, slow, max_concurrent=max_conc, timeout_per_item=timeout)

    t0      = time.perf_counter()
    results = run(_run())
    elapsed = time.perf_counter() - t0

    assert all(e is not None for _, _, e in results)
    # ceil(n/max_conc) batches * timeout each = 0.2 s — allow 3× margin
    assert elapsed < (n / max_conc + 1) * timeout * 3
