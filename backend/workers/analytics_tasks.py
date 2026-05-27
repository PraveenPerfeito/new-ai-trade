"""
Celery tasks for analytics burn-in monitoring.

  daily_analytics_snapshot    — 30-day edge report + 7-day signal summary
  hourly_anomaly_check        — operational + signal anomaly detection
  refresh_daily_view          — REFRESH MATERIALIZED VIEW mv_daily_outcome_summary
"""
from __future__ import annotations

import asyncio
import time

from celery import shared_task

from backend.logging.setup import get_logger
from backend.metrics.prometheus import celery_tasks_total, celery_task_duration_seconds

logger = get_logger(__name__)


@shared_task(
    bind=True,
    name="backend.workers.analytics_tasks.daily_analytics_snapshot",
    max_retries=1,
    default_retry_delay=5 * 60,   # retry after 5 minutes on failure
    queue="celery",
    soft_time_limit=10 * 60,
    time_limit=12 * 60,
)
def daily_analytics_snapshot(self) -> dict:
    """
    Compute and persist the daily edge validation + signal summary snapshots.
    Should run once per day (beat schedule: 23:59 UTC).
    """
    start = time.monotonic()
    try:
        from backend.analytics.burn_in import generate_daily_snapshot
        result = asyncio.run(generate_daily_snapshot())

        elapsed = time.monotonic() - start
        celery_task_duration_seconds.labels(task_name="daily_analytics_snapshot").observe(elapsed)
        celery_tasks_total.labels(task_name="daily_analytics_snapshot", status="success").inc()
        logger.info(
            "daily_analytics_snapshot_complete",
            saved_edge=result.get("saved_edge_report"),
            edge_total=result.get("edge_report_total"),
            signal_7d_total=result.get("signal_7d_total"),
            elapsed_s=round(elapsed, 2),
        )
        return result

    except Exception as exc:
        elapsed = time.monotonic() - start
        celery_task_duration_seconds.labels(task_name="daily_analytics_snapshot").observe(elapsed)
        celery_tasks_total.labels(task_name="daily_analytics_snapshot", status="failure").inc()
        logger.error("daily_analytics_snapshot_failed", error=str(exc), elapsed_s=round(elapsed, 2))
        raise self.retry(exc=exc)


@shared_task(
    bind=True,
    name="backend.workers.analytics_tasks.hourly_anomaly_check",
    max_retries=0,        # anomaly checks are time-sensitive; skip rather than retry
    queue="celery",
    soft_time_limit=3 * 60,
    time_limit=4 * 60,
)
def hourly_anomaly_check(self) -> dict:
    """
    Gather live metrics, run all anomaly checks, and persist the result.
    Should run every hour (beat schedule: minute=0).
    Returns anomaly count and severity breakdown.
    """
    start = time.monotonic()
    try:
        from backend.analytics.burn_in import run_hourly_anomaly_check
        result = asyncio.run(run_hourly_anomaly_check())

        elapsed = time.monotonic() - start
        celery_task_duration_seconds.labels(task_name="hourly_anomaly_check").observe(elapsed)
        celery_tasks_total.labels(task_name="hourly_anomaly_check", status="success").inc()
        logger.info(
            "hourly_anomaly_check_complete",
            anomalies=result.get("anomaly_count", 0),
            critical=result.get("critical_count", 0),
            elapsed_s=round(elapsed, 2),
        )
        return {
            "anomaly_count":  result.get("anomaly_count", 0),
            "critical_count": result.get("critical_count", 0),
            "warning_count":  result.get("warning_count", 0),
        }

    except Exception as exc:
        elapsed = time.monotonic() - start
        celery_task_duration_seconds.labels(task_name="hourly_anomaly_check").observe(elapsed)
        celery_tasks_total.labels(task_name="hourly_anomaly_check", status="failure").inc()
        logger.error("hourly_anomaly_check_failed", error=str(exc), elapsed_s=round(elapsed, 2))
        raise


@shared_task(
    bind=True,
    name="backend.workers.analytics_tasks.refresh_daily_view",
    max_retries=2,
    default_retry_delay=2 * 60,
    queue="celery",
    soft_time_limit=5 * 60,
    time_limit=6 * 60,
)
def refresh_daily_view(self) -> dict:
    """
    REFRESH MATERIALIZED VIEW mv_daily_outcome_summary.
    Should run once per day shortly after midnight UTC (beat: 00:05).
    """
    start = time.monotonic()
    try:
        result = asyncio.run(_do_refresh())

        elapsed = time.monotonic() - start
        celery_task_duration_seconds.labels(task_name="refresh_daily_view").observe(elapsed)
        celery_tasks_total.labels(task_name="refresh_daily_view", status="success").inc()
        logger.info("refresh_daily_view_complete", elapsed_s=round(elapsed, 2))
        return result

    except Exception as exc:
        elapsed = time.monotonic() - start
        celery_task_duration_seconds.labels(task_name="refresh_daily_view").observe(elapsed)
        celery_tasks_total.labels(task_name="refresh_daily_view", status="failure").inc()
        logger.error("refresh_daily_view_failed", error=str(exc), elapsed_s=round(elapsed, 2))
        raise self.retry(exc=exc)


async def _do_refresh() -> dict:
    from backend.database.session import get_pool
    try:
        pool = await get_pool()
    except RuntimeError:
        return {"error": "Database unavailable", "refreshed": False}

    await pool.execute("REFRESH MATERIALIZED VIEW CONCURRENTLY mv_daily_outcome_summary")
    return {"refreshed": True}
