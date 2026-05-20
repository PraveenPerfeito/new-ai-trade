"""
Admin secret middleware — validates that requests to protected API routes
originate from the authenticated Next.js proxy, not from direct callers.

Protection model:
  1. The Next.js middleware (Supabase Auth) gates access at the edge.
  2. The proxy route (/api/admin/[...path]) adds X-Admin-Secret before forwarding.
  3. This middleware validates the secret on every request, providing a second layer.

If ADMIN_SECRET is unset (local dev), all requests are passed through.
In production, ADMIN_SECRET must be set and match the value in Next.js.
"""
from __future__ import annotations

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

from backend.config import get_settings
from backend.logging.setup import get_logger

log = get_logger(__name__)

# Paths that bypass the secret check
_PUBLIC_PATHS = frozenset({
    "/health",
    "/health/ready",
    "/docs",
    "/redoc",
    "/openapi.json",
    "/metrics",
})


class AdminAuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        path = request.url.path

        # Public paths always pass through
        if path in _PUBLIC_PATHS:
            return await call_next(request)

        # Read secret from pydantic-settings (loads from .env / OS env vars)
        secret = get_settings().admin_secret

        # No secret configured — allow all (local dev without ADMIN_SECRET set)
        if not secret:
            return await call_next(request)

        provided = request.headers.get("X-Admin-Secret", "")
        if provided != secret:
            log.warning(
                "admin_secret_rejected",
                path=path,
                method=request.method,
                ip=request.client.host if request.client else None,
            )
            return JSONResponse(
                {"detail": "Unauthorized — invalid admin secret"},
                status_code=401,
            )

        return await call_next(request)
