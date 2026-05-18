"""
Structured logging via structlog.
JSON output in production, coloured console output in development.
Mirrors the pino logger configuration used on the Next.js side.
"""
import logging
import sys
from typing import Any

import structlog
from structlog.types import EventDict, WrappedLogger

from backend.config import get_settings


def _add_severity(
    logger: WrappedLogger, method_name: str, event_dict: EventDict
) -> EventDict:
    """Map structlog level names to GCP/Datadog severity strings."""
    level_map = {
        "debug":    "DEBUG",
        "info":     "INFO",
        "warning":  "WARNING",
        "error":    "ERROR",
        "critical": "CRITICAL",
    }
    event_dict["severity"] = level_map.get(method_name, "INFO")
    return event_dict


def _redact_sensitive(
    logger: WrappedLogger, method_name: str, event_dict: EventDict
) -> EventDict:
    """Strip tokens, keys, and passwords from log output."""
    SENSITIVE = {"api_key", "secret", "password", "token", "authorization", "cookie"}
    for key in list(event_dict.keys()):
        if any(s in key.lower() for s in SENSITIVE):
            event_dict[key] = "[REDACTED]"
    return event_dict


def configure_logging() -> None:
    settings = get_settings()
    log_level = settings.log_level.upper()

    shared_processors: list[Any] = [
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.add_logger_name,
        structlog.stdlib.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
        _add_severity,
        _redact_sensitive,
        structlog.processors.StackInfoRenderer(),
    ]

    if settings.is_production:
        # JSON output for log aggregators (Datadog, CloudWatch, Loki…)
        structlog.configure(
            processors=[
                *shared_processors,
                structlog.processors.dict_tracebacks,
                structlog.processors.JSONRenderer(),
            ],
            wrapper_class=structlog.make_filtering_bound_logger(
                logging.getLevelName(log_level)
            ),
            context_class=dict,
            logger_factory=structlog.PrintLoggerFactory(file=sys.stdout),
            cache_logger_on_first_use=True,
        )
    else:
        # Pretty console output for development
        structlog.configure(
            processors=[
                *shared_processors,
                structlog.dev.ConsoleRenderer(colors=True),
            ],
            wrapper_class=structlog.make_filtering_bound_logger(
                logging.getLevelName(log_level)
            ),
            context_class=dict,
            logger_factory=structlog.PrintLoggerFactory(),
            cache_logger_on_first_use=True,
        )

    # Route stdlib logging (uvicorn, celery, sqlalchemy) through structlog
    logging.basicConfig(
        format="%(message)s",
        stream=sys.stdout,
        level=logging.getLevelName(log_level),
    )


def get_logger(name: str) -> structlog.BoundLogger:
    """Return a named structlog logger. Usage: log = get_logger(__name__)"""
    return structlog.get_logger(name)
