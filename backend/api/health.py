"""
Health check endpoints — mirrors /api/health in the Next.js layer.
GET /health        → liveness probe (always 200 if process is alive)
GET /health/ready  → readiness probe (checks Redis + DB connectivity)
"""
from fastapi import APIRouter
from fastapi.responses import JSONResponse

from backend.logging.setup import get_logger

log = get_logger(__name__)
router = APIRouter(tags=["health"])


@router.get("/health")
async def liveness():
    return {"status": "ok"}


@router.get("/health/ready")
async def readiness():
    checks: dict[str, str] = {}
    ok = True

    # Redis check
    try:
        from backend.cache.redis_cache import get_redis
        redis = await get_redis()
        await redis.ping()
        checks["redis"] = "ok"
    except Exception as exc:
        checks["redis"] = f"error: {exc}"
        ok = False

    # Postgres check (optional — DATABASE_URL may not be set in Phase 1)
    try:
        from backend.database.session import get_pool
        pool = await get_pool()
        await pool.fetchval("SELECT 1")
        checks["postgres"] = "ok"
    except RuntimeError:
        checks["postgres"] = "not_configured"
    except Exception as exc:
        checks["postgres"] = f"error: {exc}"
        ok = False

    # P3.1: Celery worker liveness — inspect active queues via Redis
    try:
        from backend.cache.redis_cache import get_redis
        import time
        redis = await get_redis()
        # Workers publish heartbeats to celery:workers:<hostname> every ~2s
        # as heartbeat events. A simpler proxy: check if the Celery control
        # key exists. If Redis is up (checked above) and a worker registered
        # within the last 5 min, it's alive.
        worker_ts = await redis.get("celery:worker:last_heartbeat")
        if worker_ts and (time.time() - float(worker_ts)) < 300:
            checks["celery_worker"] = "ok"
        else:
            checks["celery_worker"] = "unknown"  # no heartbeat — may still be alive
    except Exception as exc:
        checks["celery_worker"] = f"error: {exc}"

    # P3.1: Binance spot connectivity — lightweight ping via /api/v3/ping
    try:
        import httpx
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get("https://api.binance.com/api/v3/ping")
            checks["binance"] = "ok" if resp.status_code == 200 else f"http_{resp.status_code}"
    except Exception as exc:
        checks["binance"] = f"error: {type(exc).__name__}"

    status_code = 200 if ok else 503
    return JSONResponse(
        content={"status": "ready" if ok else "degraded", "checks": checks},
        status_code=status_code,
    )
