"""
Redis-backed rate limiting via slowapi.
Replaces the in-memory Map in middleware.ts (which breaks on multi-instance).
"""
from slowapi import Limiter
from slowapi.util import get_remote_address

from backend.config import get_settings

_settings = get_settings()

limiter = Limiter(
    key_func=get_remote_address,
    storage_uri=_settings.redis_url,
    default_limits=["60/minute"],
)

# Per-endpoint overrides — import and apply as decorator:
#   @limiter.limit("10/minute")
SCAN_LIMIT     = "10/minute"
HEALTH_LIMIT   = "120/minute"
SCHEDULER_LIMIT = "30/minute"
