"""
Scan performance recording and querying.
Each completed scan writes a row to scan_metrics_log for trend analysis.
"""
from __future__ import annotations

import json
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
        log.warning("scan_metrics_db_unavailable", error=str(exc))
        return None


async def record_scan(
    *,
    scan_id: str,
    mode: str,
    coins_scanned: int,
    signals_found: int,
    duration_ms: int,
    errors: int = 0,
    gate_rejections: dict | None = None,
) -> None:
    """Persist one scan's metrics row. Fire-and-forget — never raises."""
    pool = await _pool()
    if pool is None:
        return
    try:
        await pool.execute(
            """
            INSERT INTO scan_metrics_log (
                scan_id, mode, coins_scanned, signals_found,
                duration_ms, errors, gate_rejections
            ) VALUES ($1,$2,$3,$4,$5,$6,$7)
            """,
            scan_id, mode, coins_scanned, signals_found,
            duration_ms, errors,
            json.dumps(gate_rejections or {}),
        )
    except Exception as exc:
        log.warning("record_scan_failed", scan_id=scan_id, error=str(exc))


async def get_scan_summary(window_hours: int = 24) -> dict:
    pool = await _pool()
    if pool is None:
        return _empty_scan_summary(window_hours)

    cutoff = datetime.now(timezone.utc) - timedelta(hours=window_hours)
    try:
        rows = await pool.fetch(
            """
            SELECT mode, coins_scanned, signals_found, duration_ms, errors
            FROM scan_metrics_log
            WHERE created_at > $1
            ORDER BY created_at DESC
            """,
            cutoff,
        )
    except Exception as exc:
        log.warning("get_scan_summary_failed", error=str(exc))
        return _empty_scan_summary(window_hours)

    if not rows:
        return _empty_scan_summary(window_hours)

    total       = len(rows)
    durations   = [r["duration_ms"] for r in rows]
    coins       = [r["coins_scanned"] for r in rows]
    signals     = [r["signals_found"] for r in rows]
    error_scans = sum(1 for r in rows if r["errors"] > 0)

    by_mode: dict[str, dict] = {}
    for r in rows:
        m = r["mode"]
        entry = by_mode.setdefault(m, {"count": 0, "total_signals": 0, "total_ms": 0})
        entry["count"]         += 1
        entry["total_signals"] += r["signals_found"]
        entry["total_ms"]      += r["duration_ms"]

    mode_summary = {
        m: {
            "scans":          v["count"],
            "avg_signals":    round(v["total_signals"] / v["count"], 2),
            "avg_duration_s": round(v["total_ms"] / v["count"] / 1000, 2),
        }
        for m, v in sorted(by_mode.items())
    }

    return {
        "window_hours":      window_hours,
        "total_scans":       total,
        "failure_rate":      round(error_scans / total, 4),
        "avg_duration_s":    round(sum(durations) / total / 1000, 2),
        "avg_coins_scanned": round(sum(coins) / total, 1),
        "avg_signals_found": round(sum(signals) / total, 2),
        "by_mode":           mode_summary,
    }


def _empty_scan_summary(window_hours: int = 24) -> dict:
    return {
        "window_hours": window_hours, "total_scans": 0, "failure_rate": 0.0,
        "avg_duration_s": 0.0, "avg_coins_scanned": 0.0, "avg_signals_found": 0.0,
        "by_mode": {},
    }
