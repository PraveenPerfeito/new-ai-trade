"""
AI effectiveness tracking.
Records each Claude API call to ai_call_log and exposes summary queries
for approval rates, latency, fallback usage, and confidence distribution.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from backend.logging.setup import get_logger

log = get_logger(__name__)


async def _pool():
    try:
        from backend.database.session import get_pool
        return await get_pool()
    except RuntimeError:
        return None
    except Exception as exc:
        log.warning("ai_metrics_db_unavailable", error=str(exc))
        return None


async def record_ai_call(
    *,
    signal_id: str | None,
    model: str,
    latency_ms: int,
    prompt_tokens: int | None = None,
    completion_tokens: int | None = None,
    validated: bool,
    confidence: int,
    used_fallback: bool = False,
    error: str | None = None,
) -> None:
    """Persist one AI validation call. Fire-and-forget — never raises."""
    pool = await _pool()
    if pool is None:
        return
    try:
        await pool.execute(
            """
            INSERT INTO ai_call_log (
                signal_id, model, latency_ms, prompt_tokens, completion_tokens,
                validated, confidence, used_fallback, error
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
            """,
            signal_id, model, latency_ms, prompt_tokens, completion_tokens,
            validated, confidence, used_fallback, error,
        )
    except Exception as exc:
        log.warning("record_ai_call_failed", error=str(exc))


async def get_ai_summary(window_hours: int = 24) -> dict:
    pool = await _pool()
    if pool is None:
        return _empty_ai_summary(window_hours)

    cutoff = datetime.now(timezone.utc) - timedelta(hours=window_hours)
    try:
        rows = await pool.fetch(
            """
            SELECT validated, confidence, latency_ms, used_fallback, error
            FROM ai_call_log
            WHERE created_at > $1
            ORDER BY created_at DESC
            """,
            cutoff,
        )
    except Exception as exc:
        log.warning("get_ai_summary_failed", error=str(exc))
        return _empty_ai_summary(window_hours)

    if not rows:
        return _empty_ai_summary(window_hours)

    total     = len(rows)
    approved  = sum(1 for r in rows if r["validated"])
    fallbacks = sum(1 for r in rows if r["used_fallback"])
    errors    = sum(1 for r in rows if r["error"])

    # Exclude fallback calls from latency (they don't hit the API)
    real_latencies = [r["latency_ms"] for r in rows if not r["used_fallback"] and r["latency_ms"] > 0]
    confidences    = [r["confidence"] for r in rows if r["confidence"] > 0]

    return {
        "window_hours":    window_hours,
        "total_calls":     total,
        "approved":        approved,
        "rejected":        total - approved - fallbacks,
        "approval_rate":   round(approved / total, 4),
        "rejection_rate":  round(max(0, total - approved - fallbacks) / total, 4),
        "fallback_rate":   round(fallbacks / total, 4),
        "error_rate":      round(errors / total, 4),
        "avg_latency_ms":  round(sum(real_latencies) / len(real_latencies), 1) if real_latencies else 0,
        "p95_latency_ms":  _percentile(real_latencies, 95) if real_latencies else 0,
        "avg_confidence":  round(sum(confidences) / len(confidences), 1) if confidences else 0.0,
    }


def _percentile(values: list[int], p: int) -> int:
    if not values:
        return 0
    sorted_vals = sorted(values)
    idx = int(len(sorted_vals) * p / 100)
    return sorted_vals[min(idx, len(sorted_vals) - 1)]


def _empty_ai_summary(window_hours: int = 24) -> dict:
    return {
        "window_hours": window_hours, "total_calls": 0, "approved": 0, "rejected": 0,
        "approval_rate": 0.0, "rejection_rate": 0.0, "fallback_rate": 0.0,
        "error_rate": 0.0, "avg_latency_ms": 0, "p95_latency_ms": 0, "avg_confidence": 0.0,
    }
