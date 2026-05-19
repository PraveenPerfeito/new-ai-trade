"""
FastAPI scanner endpoints.
Provides scan trigger, live progress, status, and recent-results endpoints.
All on-demand scans run directly in the FastAPI asyncio event loop via
asyncio.create_task() — no Celery round-trip needed for manual triggers.
Scheduled scans still execute through Celery Beat → scan_task.py.
"""
from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query
from pydantic import BaseModel

from backend.core.scanner.models import ScannerMode, ScanProgress
from backend.core.scanner.orchestrator import (
    run_scan,
    get_progress,
    get_latest_progress,
)
from backend.logging.setup import get_logger

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
async def trigger_scan(body: TriggerRequest, background_tasks: BackgroundTasks):
    """
    Trigger an on-demand scan. Returns immediately with a scan_id.
    Poll GET /api/scanner/progress/{scan_id} for live updates.
    """
    try:
        mode = ScannerMode(body.mode)
    except ValueError:
        valid = [m.value for m in ScannerMode]
        raise HTTPException(status_code=422, detail=f"Invalid mode. Choose from: {valid}")

    # Check if a scan for this mode is already running
    for task_key, task in list(_active_tasks.items()):
        if task_key.startswith(mode.value) and not task.done():
            raise HTTPException(
                status_code=409,
                detail=f"A {mode.value} scan is already in progress. Poll /api/scanner/status for progress.",
            )

    # Launch scan as a background asyncio task
    task = asyncio.create_task(_run_scan_task(mode))
    # Capture scan_id from progress once set (it's set at the start of run_scan)
    # We generate a preliminary scan_id here to return immediately
    import uuid
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
        await run_scan(mode)
    except Exception as exc:
        log.error("background_scan_failed", mode=mode.value, error=str(exc))


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
