"""
FastAPI application factory.
Run with:  uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
"""
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from prometheus_fastapi_instrumentator import Instrumentator
from slowapi.errors import RateLimitExceeded

from backend.cache.redis_cache import close_redis
from backend.config import get_settings
from backend.database.session import close_pool
from backend.logging.setup import configure_logging, get_logger
from backend.middleware.rate_limit import limiter
from backend.middleware.request_id import RequestIdMiddleware

# Import routers
from backend.api.analytics import router as analytics_router
from backend.api.health import router as health_router
from backend.api.scanner import router as scanner_router
from backend.api.scheduler import router as scheduler_router

# Initialise logging before anything else
configure_logging()
log = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("startup_begin")
    yield
    # ── Graceful shutdown ─────────────────────────────────────────────────────
    log.info("shutdown_begin")
    await close_redis()
    await close_pool()
    log.info("shutdown_complete")


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(
        title="Crypto Scanner API",
        version="1.0.0",
        docs_url="/docs" if not settings.is_production else None,
        redoc_url=None,
        lifespan=lifespan,
    )

    # ── Middleware ────────────────────────────────────────────────────────────
    app.add_middleware(RequestIdMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:3000"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # ── Rate limiting ─────────────────────────────────────────────────────────
    app.state.limiter = limiter

    @app.exception_handler(RateLimitExceeded)
    async def rate_limit_handler(request: Request, exc: RateLimitExceeded):
        return JSONResponse(
            status_code=429,
            content={"success": False, "error": "Rate limit exceeded"},
            headers={"Retry-After": "60"},
        )

    # ── Prometheus metrics ────────────────────────────────────────────────────
    Instrumentator(
        should_group_status_codes=False,
        excluded_handlers=["/health", "/metrics"],
    ).instrument(app).expose(app, endpoint="/metrics")

    # ── Routers ───────────────────────────────────────────────────────────────
    app.include_router(health_router)
    app.include_router(scanner_router)
    app.include_router(scheduler_router)
    app.include_router(analytics_router)

    return app


app = create_app()
