"""
Celery tasks for scanner and paper trading.
Phase 2 will fill in the full scanner logic; stubs here keep the architecture wired.
"""
from __future__ import annotations

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

        # ── Phase 2: invoke full scanner pipeline here ────────────────────────
        # result = asyncio.run(run_full_scan(mode))
        # For now, return a placeholder so the Beat schedule is wired correctly.
        result: dict = {"signals": [], "mode": mode, "coins_scanned": 0}
        # ─────────────────────────────────────────────────────────────────────

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
        # Phase 2: call paper trading engine
        closed = 0
        elapsed = time.monotonic() - start
        celery_task_duration_seconds.labels(task_name="paper_monitor").observe(elapsed)
        celery_tasks_total.labels(task_name="paper_monitor", status="success").inc()
        return {"closed_positions": closed}
    except Exception as exc:
        celery_tasks_total.labels(task_name="paper_monitor", status="failure").inc()
        logger.error("paper_monitor_failed", error=str(exc))
        raise
