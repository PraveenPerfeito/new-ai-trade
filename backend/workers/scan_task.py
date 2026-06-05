"""
Celery tasks: run_scheduled_scan and check_signal_outcomes.
run_scheduled_scan delegates to orchestrator.run_scan() via asyncio.run().
"""
from __future__ import annotations

import asyncio
import time
from typing import Literal

import requests
from celery import shared_task
from celery.utils.log import get_task_logger

from backend.config import get_settings
from backend.metrics.prometheus import (
    celery_tasks_total,
    celery_task_duration_seconds,
    scheduler_scanning,
    scheduler_last_scan_timestamp,
)
from backend.scheduler.coordinator import SchedulerCoordinator

logger = get_task_logger(__name__)

ScanMode = Literal["standard", "high_confidence", "futures"]

# ── Transient error classification ───────────────────────────────────────────
# These error substrings indicate connectivity / resource issues that are safe
# to retry.  Logic errors and scanner assertion failures are NOT retried.
_TRANSIENT_PATTERNS = (
    "connection",
    "timeout",
    "timed out",
    "temporarily unavailable",
    "redis",
    "network",
    "rate limit",
    "429",
    "503",
    "502",
)


def _is_transient(exc: BaseException) -> bool:
    msg = str(exc).lower()
    return any(p in msg for p in _TRANSIENT_PATTERNS)


def _send_failure_alert(mode: str, error: str, attempt: int) -> None:
    """Fire-and-forget Telegram alert when a scan permanently fails."""
    settings = get_settings()
    token = settings.telegram_bot_token
    chat_id = settings.telegram_chat_id
    if not token or not chat_id:
        return
    text = (
        f"🚨 <b>Scan Failed — {mode.upper()}</b>\n"
        f"Attempts: {attempt}\n"
        f"Error: {error[:200]}"
    )
    try:
        requests.post(
            f"https://api.telegram.org/bot{token}/sendMessage",
            json={"chat_id": chat_id, "text": text, "parse_mode": "HTML"},
            timeout=5,
        )
    except Exception as exc:
        logger.warning(f"telegram_failure_alert_failed error={exc}")


def _check_operational_flags() -> str | None:
    """
    Synchronously check emergency_stop and maintenance_mode feature flags.
    Returns a non-empty reason string if the scan should be blocked, else None.
    Called before acquiring the scan lock so queued tasks respect operator toggles.
    """
    try:
        import asyncio as _asyncio
        from backend.system_settings.service import get_settings_service
        from backend.system_settings.groups import FeatureFlags
        flags = _asyncio.run(get_settings_service().get_group(FeatureFlags))
        if flags.emergency_stop:
            return "emergency_stop"
        if flags.maintenance_mode:
            return "maintenance_mode"
    except Exception as exc:
        logger.warning(f"operational_flag_check_failed error={exc} — proceeding")
    return None


@shared_task(
    bind=True,
    name="backend.workers.scan_task.run_scheduled_scan",
    max_retries=2,           # retry transient failures up to 2 times
    queue="scanner",
    soft_time_limit=17 * 60,  # 17-minute soft kill; worst-case 80 coins ÷ 5 concurrent × 45s = 720s + overhead ≈ 840s; 1020s gives 180s buffer
    time_limit=19 * 60,       # 19-minute hard kill; 2-minute gap above soft limit for graceful SoftTimeLimitExceeded handler
)
def run_scheduled_scan(self, mode: ScanMode = "standard") -> dict:
    """
    Scheduled scan entry-point.  Uses a distributed Redis lock so only one
    worker executes a scan for a given mode at a time.
    """
    start = time.monotonic()
    task_label = f"scan_{mode}"

    coordinator = SchedulerCoordinator()

    # ── Operational gate: check enable flag and emergency stop BEFORE acquiring lock ──
    # This prevents queued tasks from executing after the operator disables the scheduler.
    if not coordinator.is_enabled():
        logger.info(f"scan_skipped_scheduler_disabled mode={mode}")
        celery_tasks_total.labels(task_name=task_label, status="skipped").inc()
        return {"skipped": True, "reason": "scheduler_disabled", "mode": mode}

    block_reason = _check_operational_flags()
    if block_reason:
        logger.warning(f"scan_blocked reason={block_reason} mode={mode}")
        celery_tasks_total.labels(task_name=task_label, status="skipped").inc()
        return {"skipped": True, "reason": block_reason, "mode": mode}

    try:
        lock_acquired = coordinator.acquire_scan_lock(mode, ttl_seconds=20 * 60)  # Fix 1: 20 min > soft_time_limit (17 min) prevents overlap
    except Exception as lock_exc:
        logger.warning(f"acquire_scan_lock_failed mode={mode} error={lock_exc} — proceeding without lock")
        lock_acquired = True

    if not lock_acquired:
        logger.info(f"scan_lock_held_skipping mode={mode}")
        celery_tasks_total.labels(task_name=task_label, status="skipped").inc()
        return {"skipped": True, "reason": "lock_held", "mode": mode}

    scheduler_scanning.set(1)
    try:
        logger.info(f"scan_started mode={mode}")

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
                    gate_rejections=result.gate_rejections,
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
        try:
            coordinator.record_scan_complete()   # writes scheduler:last_scan_ts → dashboard "Last scan" timestamp
        except Exception as ts_exc:
            # Fix 2: never fail a successful scan due to Redis timestamp write
            logger.warning(f"record_scan_complete_failed error={ts_exc} — scan succeeded, timestamp not updated")
        celery_task_duration_seconds.labels(task_name=task_label).observe(elapsed)
        celery_tasks_total.labels(task_name=task_label, status="success").inc()

        logger.info(f"scan_completed mode={mode} elapsed_s={round(elapsed, 2)}")
        return result

    except Exception as exc:
        elapsed = time.monotonic() - start
        celery_task_duration_seconds.labels(task_name=task_label).observe(elapsed)
        celery_tasks_total.labels(task_name=task_label, status="failure").inc()
        logger.error(f"scan_failed mode={mode} error={str(exc)} elapsed_s={round(elapsed, 2)}")

        # Retry transient errors with exponential backoff (60s, 120s).
        # The distributed lock is released in `finally` before the retry fires.
        if _is_transient(exc) and self.request.retries < self.max_retries:
            countdown = 60 * (2 ** self.request.retries)
            logger.warning(
                f"scan_retry_scheduled mode={mode} attempt={self.request.retries + 1} countdown_s={countdown}"
            )
            raise self.retry(exc=exc, countdown=countdown)

        # All retries exhausted (or non-transient error) — send Telegram alert.
        _send_failure_alert(
            mode=mode,
            error=str(exc),
            attempt=self.request.retries + 1,
        )
        raise

    finally:
        scheduler_scanning.set(0)
        try:
            coordinator.release_scan_lock(mode)
        except Exception as lock_exc:
            # Fix 3: never let lock release failure mask the original scan exception
            logger.warning(f"release_scan_lock_failed mode={mode} error={lock_exc} — lock will expire via Redis TTL")


@shared_task(
    bind=True,
    name="backend.workers.scan_task.check_signal_outcomes",
    max_retries=0,
    queue="celery",
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
        logger.info(f"outcome_check_complete {result}")
        return result
    except Exception as exc:
        celery_tasks_total.labels(task_name="outcome_tracker", status="failure").inc()
        logger.error(f"outcome_check_failed error={str(exc)}")
        raise
