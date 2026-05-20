"""
Production startup validation.

Called from main.py lifespan() before the app begins accepting requests.
In production (ENVIRONMENT=production), missing critical variables raise
immediately so the process fails loudly with a clear error message rather
than silently misbehaving on the first API call.

In development, missing vars emit warnings but do NOT raise.
"""
from __future__ import annotations

import os

from backend.config import get_settings
from backend.logging.setup import get_logger

log = get_logger(__name__)

# ── Required in production ────────────────────────────────────────────────────
# (key, reason why it is critical)
_PRODUCTION_REQUIRED = [
    (
        "ADMIN_SECRET",
        "Without ADMIN_SECRET the Python FastAPI backend accepts all requests "
        "from the Next.js proxy — anyone can call admin endpoints.",
    ),
    (
        "DATABASE_URL",
        "Without DATABASE_URL asyncpg cannot connect to Postgres. "
        "All settings reads and writes will fail at runtime.",
    ),
    (
        "NEXT_PUBLIC_SUPABASE_URL",
        "Required for all Supabase SDK operations.",
    ),
    (
        "NEXT_PUBLIC_SUPABASE_ANON_KEY",
        "Required for Supabase authentication flows.",
    ),
]

# ── Recommended ───────────────────────────────────────────────────────────────
_RECOMMENDED = [
    ("REDIS_URL",           "Provider metrics and settings cache will degrade without Redis."),
    ("TELEGRAM_BOT_TOKEN",  "Scan failure alerts and signal notifications are disabled."),
    ("TELEGRAM_CHAT_ID",    "Scan failure alerts and signal notifications are disabled."),
    ("ANTHROPIC_API_KEY",   "AI validation will use heuristic fallback for all signals."),
    ("COINGECKO_API_KEY",   "CoinGecko free tier has low rate limits; provider may hit quota."),
]


def run_startup_check() -> None:
    """
    Validate the environment.  Raises RuntimeError in production if any
    required variable is missing.  In development, logs warnings only.
    """
    settings = get_settings()
    is_production = settings.is_production
    errors: list[str] = []
    warnings: list[str] = []

    for key, reason in _PRODUCTION_REQUIRED:
        value = os.environ.get(key, "").strip()
        # Also check the pydantic settings object for keys it knows about
        if not value:
            # Some keys map to pydantic field names (snake_case) — check both
            pydantic_key = key.lower()
            value = str(getattr(settings, pydantic_key, "") or "").strip()

        if not value:
            if is_production:
                errors.append(f"{key}: {reason}")
            else:
                warnings.append(f"{key} not set (dev-mode warning): {reason}")

    for key, reason in _RECOMMENDED:
        value = os.environ.get(key, "").strip()
        if not value:
            pydantic_key = key.lower()
            value = str(getattr(settings, pydantic_key, "") or "").strip()
        if not value:
            warnings.append(f"{key} not set: {reason}")

    for w in warnings:
        log.warning("startup_warning", detail=w)

    if errors:
        for e in errors:
            log.error("startup_error", detail=e)
        raise RuntimeError(
            "\n\nSTARTUP FAILED — Missing required environment variables:\n"
            + "\n".join(f"  • {e}" for e in errors)
            + "\n\nSet these in your .env.local or deployment environment.\n"
        )

    log.info("startup_check_passed", warnings=len(warnings))
