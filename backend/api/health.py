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

    status_code = 200 if ok else 503
    return JSONResponse(
        content={"status": "ready" if ok else "degraded", "checks": checks},
        status_code=status_code,
    )
