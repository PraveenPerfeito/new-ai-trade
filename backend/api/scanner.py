"""
FastAPI scanner endpoints.
Provides scan trigger, live progress, status, and recent-results endpoints.
All on-demand scans run directly in the FastAPI asyncio event loop via
asyncio.create_task() — no Celery round-trip needed for manual triggers.
Scheduled scans still execute through Celery Beat → scan_task.py.
"""
from __future__ import annotations

import asyncio
import uuid

from typing import Annotated, Any

from fastapi import APIRouter, Body, HTTPException, Request
from pydantic import BaseModel

from backend.core.scanner.models import ScannerMode, ScanProgress
from backend.core.scanner.orchestrator import (
    run_scan,
    get_progress,
    get_latest_progress,
)
from backend.logging.setup import get_logger
from backend.scheduler.coordinator import SchedulerCoordinator
from backend.system_settings.service import get_settings_service
from backend.system_settings.groups import FeatureFlags

log = get_logger(__name__)

router = APIRouter(prefix="/api/scanner", tags=["scanner"])

# Track background scan tasks so we can report "busy" state
_active_tasks: dict[str, asyncio.Task] = {}


# ── Request / response models ─────────────────────────────────────────────────

class TriggerRequest(BaseModel):
    mode: str = "spot"


class TriggerResponse(BaseModel):
    scan_id: str
    mode: str
    status: str
    message: str


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/trigger", response_model=TriggerResponse)
async def trigger_scan(request: Request, body: Annotated[TriggerRequest, Body()]):
    """
    Trigger an on-demand scan. Returns immediately with a scan_id.
    Poll GET /api/scanner/progress/{scan_id} for live updates.
    """
    try:
        mode = ScannerMode(body.mode)
    except ValueError:
        valid = [m.value for m in ScannerMode]
        raise HTTPException(status_code=422, detail=f"Invalid mode. Choose from: {valid}")

    # ── Operational gate: honour scheduler toggle and emergency/maintenance flags ──
    coord = SchedulerCoordinator()
    if not coord.is_enabled():
        raise HTTPException(status_code=503, detail="Scanner is disabled. Enable it from the Operations dashboard first.")

    try:
        flags = await get_settings_service().get_group(FeatureFlags)
        if flags.emergency_stop:
            raise HTTPException(status_code=503, detail="Emergency stop is active. All scans are blocked.")
        if flags.maintenance_mode:
            raise HTTPException(status_code=503, detail="System is in maintenance mode. Scans are read-only blocked.")
    except HTTPException:
        raise
    except Exception as exc:
        log.warning("operational_flag_check_failed", error=str(exc))

    # Check if a scan for this mode is already running
    for task_key, task in list(_active_tasks.items()):
        if task_key.startswith(mode.value) and not task.done():
            raise HTTPException(
                status_code=409,
                detail=f"A {mode.value} scan is already in progress. Poll /api/scanner/status for progress.",
            )

    # Purge completed tasks to prevent unbounded dict growth
    for k in [k for k, t in _active_tasks.items() if t.done()]:
        _active_tasks.pop(k, None)

    # Launch scan as a background asyncio task
    task = asyncio.create_task(_run_scan_task(mode))
    scan_id = str(uuid.uuid4())
    _active_tasks[f"{mode.value}:{scan_id}"] = task

    log.info("scan_triggered", mode=mode.value, scan_id=scan_id)

    return TriggerResponse(
        scan_id=scan_id,
        mode=mode.value,
        status="queued",
        message=f"Scan queued. Poll /api/scanner/progress/{scan_id} for updates.",
    )


async def _run_scan_task(mode: ScannerMode) -> None:
    try:
        result = await run_scan(mode)
        # Record metrics for on-demand scans (scheduled scans record via scan_task.py)
        try:
            from backend.analytics.scan_metrics import record_scan
            await record_scan(
                scan_id=str(result.scan_run_id or ""),
                mode=mode.value,
                coins_scanned=result.coins_scanned,
                signals_found=result.signals_found,
                duration_ms=result.duration_ms,
                errors=result.errors,
                gate_rejections=result.gate_rejections,
            )
        except Exception as exc:
            log.warning("record_scan_failed", mode=mode.value, error=str(exc))
    except Exception as exc:
        log.error("background_scan_failed", mode=mode.value, error=str(exc))
    finally:
        # Drain any queued WhatsApp alerts before this task exits — the FastAPI
        # event loop persists but the drain worker may not get scheduled before
        # the next scan starts, causing message ordering issues.
        try:
            from backend.core.scanner.telegram_notifier import flush_queue
            await flush_queue(timeout_s=30.0)
        except Exception as exc:
            log.warning("whatsapp_flush_failed", mode=mode.value, error=str(exc))


@router.get("/status")
async def scan_status() -> dict[str, Any]:
    """
    Returns the latest scan progress from Redis (most recent scan regardless of mode).
    """
    progress = await get_latest_progress()
    active_count = sum(1 for t in _active_tasks.values() if not t.done())

    if not progress:
        return {
            "status": "idle",
            "active_scans": active_count,
            "message": "No recent scan found",
        }

    return {
        "status": progress.status,
        "active_scans": active_count,
        **progress.model_dump(),
    }


@router.get("/progress/{scan_id}")
async def scan_progress(scan_id: str) -> dict[str, Any]:
    """
    Returns progress for a specific scan by scan_id.
    """
    progress = await get_progress(scan_id)
    if not progress:
        # Also check latest in case the scan_id was from the trigger endpoint
        latest = await get_latest_progress()
        if latest:
            return latest.model_dump()
        raise HTTPException(status_code=404, detail=f"No scan found with id {scan_id}")

    return progress.model_dump()


@router.get("/metrics/summary")
async def scan_metrics_summary() -> dict[str, Any]:
    """
    Returns a lightweight metrics snapshot: active tasks, latest scan stats.
    For full Prometheus metrics use GET /metrics on the FastAPI app.
    """
    active = [k for k, t in _active_tasks.items() if not t.done()]
    done   = [k for k, t in _active_tasks.items() if t.done()]

    # Clean up completed tasks
    for k in done:
        _active_tasks.pop(k, None)

    latest = await get_latest_progress()

    return {
        "active_scans":  len(active),
        "active_modes":  [k.split(":")[0] for k in active],
        "latest_scan":   latest.model_dump() if latest else None,
    }


@router.post("/test-whatsapp")
async def test_whatsapp() -> dict[str, Any]:
    """
    Send a test WhatsApp message to verify UltraMsg configuration.
    Protected by AdminAuthMiddleware (X-Admin-Secret header required).
    """
    from backend.core.scanner.telegram_notifier import _is_configured, _send_with_retry
    from backend.config import get_settings

    s = get_settings()
    configured = _is_configured()

    if not configured:
        missing = [
            k for k, v in {
                "WHATSAPP_API_URL": s.whatsapp_api_url,
                "WHATSAPP_TOKEN":   s.whatsapp_token,
                "WHATSAPP_PHONE":   s.whatsapp_phone,
            }.items() if not v
        ]
        return {
            "configured": False,
            "sent":       False,
            "error":      f"Missing Railway env vars: {', '.join(missing)}",
        }

    text = (
        "🧪 *SignalEdge AI — Test Message*\n\n"
        "WhatsApp alerts are configured and working correctly.\n"
        "You will receive signal notifications at this number."
    )
    try:
        sent = await _send_with_retry(text)
        return {"configured": True, "sent": sent,
                "error": None if sent else "UltraMsg returned sent=false — check token/phone"}
    except Exception as exc:
        return {"configured": True, "sent": False, "error": str(exc)}
