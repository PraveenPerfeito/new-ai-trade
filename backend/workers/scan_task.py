"""
Celery tasks for scanner and paper trading.
run_scheduled_scan delegates to orchestrator.run_scan() via asyncio.run().
"""
from __future__ import annotations

import asyncio
import time
from typing import Literal

from celery import shared_task
from celery.utils.log import get_task_logger

from backend.metrics.prometheus import (
    celery_tasks_total,
    celery_task_duration_seconds,
    scheduler_scanning,
    scheduler_last_scan_timestamp,
)
from backend.scheduler.coordinator import SchedulerCoordinator

logger = get_task_logger(__name__)

ScanMode = Literal["standard", "high_confidence", "futures"]


@shared_task(
    bind=True,
    name="backend.workers.scan_task.run_scheduled_scan",
    max_retries=0,          # don't retry a failed scan — wait for next cycle
    queue="scanner",
    soft_time_limit=10 * 60,  # 10-minute soft kill
    time_limit=12 * 60,       # 12-minute hard kill
)
def run_scheduled_scan(self, mode: ScanMode = "standard") -> dict:
    """
    Scheduled scan entry-point.  Uses a distributed Redis lock so only one
    worker executes a scan for a given mode at a time.
    """
    start = time.monotonic()
    task_label = f"scan_{mode}"

    coordinator = SchedulerCoordinator()
    lock_acquired = coordinator.acquire_scan_lock(mode, ttl_seconds=11 * 60)

    if not lock_acquired:
        logger.info("scan_lock_held_skipping", mode=mode)
        celery_tasks_total.labels(task_name=task_label, status="skipped").inc()
        return {"skipped": True, "reason": "lock_held", "mode": mode}

    scheduler_scanning.set(1)
    try:
        logger.info("scan_started", mode=mode)

        # Map Celery mode names → ScannerMode enum values
        from backend.core.scanner.models import ScannerMode
        from backend.core.scanner.orchestrator import run_scan

        mode_map: dict[str, ScannerMode] = {
            "standard":        ScannerMode.SPOT,
            "high_confidence": ScannerMode.HIGH_CONFIDENCE,
            "futures":         ScannerMode.FUTURES,
        }
        scanner_mode = mode_map.get(mode, ScannerMode.SPOT)

        async def _run_and_record():
            result = await run_scan(scanner_mode)
            try:
                from backend.analytics.scan_metrics import record_scan
                await record_scan(
                    scan_id=result.scan_run_id or mode,
                    mode=mode,
                    coins_scanned=result.coins_scanned,
                    signals_found=result.signals_found,
                    duration_ms=result.duration_ms,
                    errors=result.errors,
                )
            except Exception:
                pass
            return result

        scan_result = asyncio.run(_run_and_record())
        result: dict = {
            "signals":       scan_result.signals_found,
            "mode":          scan_result.mode.value,
            "coins_scanned": scan_result.coins_scanned,
            "duration_ms":   scan_result.duration_ms,
            "errors":        scan_result.errors,
        }

        elapsed = time.monotonic() - start
        scheduler_last_scan_timestamp.set(time.time())
        celery_task_duration_seconds.labels(task_name=task_label).observe(elapsed)
        celery_tasks_total.labels(task_name=task_label, status="success").inc()

        logger.info("scan_completed", mode=mode, elapsed_s=round(elapsed, 2))
        return result

    except Exception as exc:
        elapsed = time.monotonic() - start
        celery_task_duration_seconds.labels(task_name=task_label).observe(elapsed)
        celery_tasks_total.labels(task_name=task_label, status="failure").inc()
        logger.error("scan_failed", mode=mode, error=str(exc), elapsed_s=round(elapsed, 2))
        raise

    finally:
        scheduler_scanning.set(0)
        coordinator.release_scan_lock(mode)


@shared_task(
    bind=True,
    name="backend.workers.scan_task.monitor_paper_positions",
    max_retries=0,
    queue="paper_trading",
    soft_time_limit=45,
    time_limit=55,
)
def monitor_paper_positions(self) -> dict:
    """Check open paper-trading positions against current prices."""
    start = time.monotonic()
    try:
        from backend.analytics.paper_trading import monitor_open_positions
        result = asyncio.run(monitor_open_positions())
        closed = result.get("closed", 0)

        elapsed = time.monotonic() - start
        celery_task_duration_seconds.labels(task_name="paper_monitor").observe(elapsed)
        celery_tasks_total.labels(task_name="paper_monitor", status="success").inc()
        return {"closed_positions": closed, **result}
    except Exception as exc:
        celery_tasks_total.labels(task_name="paper_monitor", status="failure").inc()
        logger.error("paper_monitor_failed", error=str(exc))
        raise


@shared_task(
    bind=True,
    name="backend.workers.scan_task.check_signal_outcomes",
    max_retries=0,
    queue="paper_trading",
    soft_time_limit=5 * 60,
    time_limit=6 * 60,
)
def check_signal_outcomes(self) -> dict:
    """Resolve PENDING signal outcomes by checking Binance klines."""
    start = time.monotonic()
    try:
        from backend.analytics.signal_metrics import check_pending_outcomes
        result = asyncio.run(check_pending_outcomes())

        elapsed = time.monotonic() - start
        celery_task_duration_seconds.labels(task_name="outcome_tracker").observe(elapsed)
        celery_tasks_total.labels(task_name="outcome_tracker", status="success").inc()
        logger.info("outcome_check_complete", **result)
        return result
    except Exception as exc:
        celery_tasks_total.labels(task_name="outcome_tracker", status="failure").inc()
        logger.error("outcome_check_failed", error=str(exc))
        raise
