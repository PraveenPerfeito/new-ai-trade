"""
Scheduler control endpoints — compatible with the existing Next.js frontend
that calls /api/scheduler/status, /api/scheduler/start, /api/scheduler/stop.

Mounted at /api/scheduler so the frontend can point to either the Next.js
layer or the FastAPI backend with zero client changes.
"""
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from backend.logging.setup import get_logger
from backend.middleware.rate_limit import limiter, SCHEDULER_LIMIT
from backend.scheduler.coordinator import SchedulerCoordinator

log = get_logger(__name__)
router = APIRouter(prefix="/api/scheduler", tags=["scheduler"])


def _coordinator() -> SchedulerCoordinator:
    return SchedulerCoordinator()


@router.get("/status")
@limiter.limit(SCHEDULER_LIMIT)
async def get_status(request: Request):
    # P0.1: use status_async() — avoids asyncio.run() inside an already-running event loop
    status = await _coordinator().status_async()
    return {"success": True, "data": status}


@router.post("/start")
@limiter.limit(SCHEDULER_LIMIT)
async def start_scheduler(request: Request):
    coord = _coordinator()
    coord.enable()
    log.info("scheduler_start_requested", remote=request.client.host if request.client else "unknown")
    return {"success": True, "message": "Scheduler enabled"}


@router.post("/stop")
@limiter.limit(SCHEDULER_LIMIT)
async def stop_scheduler(request: Request):
    coord = _coordinator()
    coord.disable()
    log.info("scheduler_stop_requested", remote=request.client.host if request.client else "unknown")
    return {"success": True, "message": "Scheduler disabled"}
