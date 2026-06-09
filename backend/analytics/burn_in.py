"""
Burn-in monitoring — orchestrates continuous validation data collection.

Responsibilities:
  - get_burnin_status()        — current data coverage + edge status
  - generate_daily_snapshot()  — compute full report and persist to analytics_snapshots
  - get_snapshot_history()     — retrieve past daily snapshots for trend analysis
  - get_latest_anomalies()     — retrieve recent anomaly records from snapshots
  - run_hourly_anomaly_check() — compute metrics, run checks, persist anomaly snapshot

All snapshots land in the analytics_snapshots table with snapshot_type:
  "daily_edge"         — full edge validation report (window_hours=720)
  "daily_signal"       — 7-day signal quality summary
  "hourly_anomaly"     — anomaly check result (up to 24/day)
"""
from __future__ import annotations

import asyncio
import json
from datetime import datetime, timedelta, timezone

from backend.analytics.anomaly_detector import run_all_checks
from backend.logging.setup import get_logger

log = get_logger(__name__)

# Minimum resolved signals needed to call the edge "measurable"
MIN_SIGNALS_FOR_EDGE   = 30
MIN_SIGNALS_FOR_REPORT = 100


# ── DB helpers ────────────────────────────────────────────────────────────────

async def _pool():
    try:
        from backend.database.session import get_pool
        return await get_pool()
    except RuntimeError:
        return None
    except Exception as exc:
        log.warning("burnin_db_unavailable", error=str(exc))
        return None


async def _save_snapshot(pool, snapshot_type: str, window_hours: int, data: dict) -> None:
    try:
        await pool.execute(
            """
            INSERT INTO analytics_snapshots (snapshot_type, window_hours, data, computed_at)
            VALUES ($1, $2, $3, NOW())
            """,
            snapshot_type,
            window_hours,
            json.dumps(data, default=str),
        )
    except Exception as exc:
        log.warning("save_snapshot_failed", snapshot_type=snapshot_type, error=str(exc))


async def _load_latest_snapshot(pool, snapshot_type: str) -> dict | None:
    try:
        row = await pool.fetchrow(
            """
            SELECT data, computed_at
            FROM analytics_snapshots
            WHERE snapshot_type = $1
            ORDER BY computed_at DESC
            LIMIT 1
            """,
            snapshot_type,
        )
        if row:
            return json.loads(row["data"])
        return None
    except Exception:
        return None


# ── Signal coverage query ─────────────────────────────────────────────────────

async def _get_coverage(pool) -> dict:
    """Return total resolved signals, earliest, latest, days of data."""
    try:
        row = await pool.fetchrow(
            """
            SELECT
                COUNT(*) FILTER (WHERE outcome != 'PENDING')            AS resolved,
                COUNT(*) FILTER (WHERE outcome = 'PENDING')             AS pending,
                MIN(created_at)                                         AS earliest,
                MAX(created_at)                                         AS latest
            FROM signal_outcomes
            """
        )
        if not row or row["resolved"] == 0:
            return {"resolved": 0, "pending": 0, "days": 0.0, "earliest": None, "latest": None}

        resolved = int(row["resolved"])
        pending  = int(row["pending"])
        earliest = row["earliest"]
        latest   = row["latest"]
        days     = 0.0
        if earliest and latest:
            days = (latest - earliest).total_seconds() / 86400

        return {
            "resolved":  resolved,
            "pending":   pending,
            "days":      round(days, 1),
            "earliest":  earliest.isoformat() if earliest else None,
            "latest":    latest.isoformat() if latest else None,
        }
    except Exception as exc:
        log.warning("get_coverage_failed", error=str(exc))
        return {"resolved": 0, "pending": 0, "days": 0.0, "earliest": None, "latest": None}


# ── Burn-in status ────────────────────────────────────────────────────────────

async def get_burnin_status() -> dict:
    """
    Current burn-in progress and live edge verdict.
    Fast endpoint — reads from DB but doesn't recompute heavy reports.
    """
    pool = await _pool()
    if pool is None:
        return {"error": "Database unavailable"}

    coverage = await _get_coverage(pool)
    resolved = coverage["resolved"]

    # Progress toward meaningful statistics
    progress_pct = min(100, round(resolved / MIN_SIGNALS_FOR_REPORT * 100, 1))
    status = (
        "insufficient_data" if resolved < MIN_SIGNALS_FOR_EDGE
        else "early_data" if resolved < MIN_SIGNALS_FOR_REPORT
        else "sufficient_data"
    )

    # Light win rate from recent 7d data
    win_rate_7d = None
    expectancy_7d = None
    try:
        row = await pool.fetchrow(
            """
            SELECT
                COUNT(*) FILTER (WHERE outcome = 'TP_HIT')           AS tp,
                COUNT(*) FILTER (WHERE outcome != 'PENDING')          AS total,
                AVG(CASE WHEN outcome != 'PENDING' THEN rr_achieved END) AS avg_rr
            FROM signal_outcomes
            WHERE created_at >= NOW() - INTERVAL '7 days'
            """
        )
        if row and row["total"] and row["total"] > 0:
            win_rate_7d  = round(row["tp"] / row["total"], 4)
            expectancy_7d = round(float(row["avg_rr"]), 4) if row["avg_rr"] is not None else None
    except Exception:
        pass

    # Last anomaly check
    last_anomaly_snapshot = await _load_latest_snapshot(pool, "hourly_anomaly")
    anomaly_summary = None
    if last_anomaly_snapshot:
        anomalies = last_anomaly_snapshot.get("anomalies", [])
        critical_count = sum(1 for a in anomalies if a.get("severity") == "critical")
        warning_count  = sum(1 for a in anomalies if a.get("severity") == "warning")
        anomaly_summary = {
            "checked_at": last_anomaly_snapshot.get("checked_at"),
            "total":      len(anomalies),
            "critical":   critical_count,
            "warning":    warning_count,
            "ok":         len(anomalies) == 0,
        }

    return {
        "status":         status,
        "progress_pct":   progress_pct,
        "data_coverage":  coverage,
        "min_for_edge":   MIN_SIGNALS_FOR_EDGE,
        "min_for_report": MIN_SIGNALS_FOR_REPORT,
        "live_metrics": {
            "win_rate_7d":    win_rate_7d,
            "expectancy_7d":  expectancy_7d,
        },
        "anomaly_summary": anomaly_summary,
        "checked_at":     datetime.now(timezone.utc).isoformat(),
    }


# ── Daily snapshot ────────────────────────────────────────────────────────────

async def generate_daily_snapshot() -> dict:
    """
    Compute and persist:
      - full 30-day edge validation report  → 'daily_edge' snapshot
      - 7-day signal quality summary        → 'daily_signal' snapshot
    Returns a brief status dict.
    """
    pool = await _pool()
    if pool is None:
        return {"error": "Database unavailable", "saved": False}

    from backend.analytics.edge_validation import generate_edge_validation_report
    from backend.analytics.stats_utils import group_stats

    edge_report, coverage = await asyncio.gather(
        generate_edge_validation_report(720),
        _get_coverage(pool),
        return_exceptions=True,
    )

    saved_edge = False
    if not isinstance(edge_report, Exception):
        await _save_snapshot(pool, "daily_edge", 720, edge_report)
        saved_edge = True
        log.info("daily_edge_snapshot_saved")
    else:
        log.warning("daily_edge_snapshot_failed", error=str(edge_report))

    # 7-day summary
    try:
        rows = await pool.fetch(
            """
            SELECT outcome, rr_achieved, duration_hours
            FROM signal_outcomes
            WHERE outcome != 'PENDING'
              AND created_at >= NOW() - INTERVAL '7 days'
            """
        )
        signal_7d = group_stats([dict(r) for r in rows], label="7d")
        await _save_snapshot(pool, "daily_signal", 168, signal_7d)
        log.info("daily_signal_snapshot_saved", total=signal_7d["total"])
    except Exception as exc:
        log.warning("daily_signal_snapshot_failed", error=str(exc))
        signal_7d = {}

    return {
        "saved_edge_report": saved_edge,
        "edge_report_total": edge_report.get("overall", {}).get("total") if not isinstance(edge_report, Exception) else None,
        "signal_7d_total": signal_7d.get("total"),
        "coverage": coverage if not isinstance(coverage, Exception) else {},
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


# ── Hourly anomaly check ──────────────────────────────────────────────────────

async def run_hourly_anomaly_check() -> dict:
    """
    Gather live metrics, run all anomaly checks, persist 'hourly_anomaly' snapshot.
    Returns the check result including anomalies list.
    """
    pool = await _pool()
    if pool is None:
        return {"error": "Database unavailable", "anomalies": []}

    from backend.analytics.stats_utils import group_stats
    from backend.analytics.ai_metrics import get_ai_summary
    from backend.analytics.scan_metrics import get_scan_summary

    # Fetch parallel
    rows_7d_task  = pool.fetch(
        "SELECT outcome, rr_achieved, duration_hours FROM signal_outcomes "
        "WHERE outcome!='PENDING' AND created_at >= NOW() - INTERVAL '7 days'"
    )
    rows_30d_task = pool.fetch(
        "SELECT outcome, rr_achieved, duration_hours FROM signal_outcomes "
        "WHERE outcome!='PENDING' AND created_at >= NOW() - INTERVAL '30 days'"
    )

    rows_7d, rows_30d, ai_sum, scan_sum = await asyncio.gather(
        rows_7d_task, rows_30d_task,
        get_ai_summary(24),
        get_scan_summary(24),
        return_exceptions=True,
    )

    if isinstance(rows_7d, Exception):  rows_7d = []
    if isinstance(rows_30d, Exception): rows_30d = []
    if isinstance(ai_sum, Exception):   ai_sum = {}
    if isinstance(scan_sum, Exception): scan_sum = {}

    stats_7d  = group_stats([dict(r) for r in rows_7d],  label="7d")
    stats_30d = group_stats([dict(r) for r in rows_30d], label="30d")

    # Previous calibration for drift detection
    prev_cal = await _load_latest_snapshot(pool, "daily_edge")
    prev_cal_sub = (prev_cal or {}).get("confidence_calibration", {})

    # Current calibration (cheap: ECE from latest daily edge snapshot)
    current_cal_snapshot = await _load_latest_snapshot(pool, "daily_edge")
    current_cal = (current_cal_snapshot or {}).get("confidence_calibration", {})

    # Queue depths from Redis — only "celery" queue; "scanner" queue was retired
    # in beat_schedule.py (all tasks now route to "celery").
    queue_depths: dict[str, int] = {}
    try:
        from backend.cache.redis_cache import get_redis
        redis = await get_redis()
        queue_depths["celery"] = await redis.llen("celery")
    except Exception:
        pass

    anomalies = run_all_checks(
        stats_7d=stats_7d,
        stats_30d=stats_30d,
        calibration=current_cal,
        scan_summary=scan_sum,
        ai_summary=ai_sum,
        queue_depths=queue_depths,
        previous_calibration=prev_cal_sub,
    )

    result = {
        "checked_at":   datetime.now(timezone.utc).isoformat(),
        "stats_7d":     stats_7d,
        "anomalies":    [a.to_dict() for a in anomalies],
        "anomaly_count": len(anomalies),
        "critical_count": sum(1 for a in anomalies if a.severity == "critical"),
        "warning_count":  sum(1 for a in anomalies if a.severity == "warning"),
    }

    await _save_snapshot(pool, "hourly_anomaly", 24, result)
    log.info(
        "anomaly_check_complete",
        anomalies=len(anomalies),
        critical=result["critical_count"],
    )

    # P0.2: Alert via Telegram when any critical anomaly is present.
    # Throttled to once per 15 minutes to prevent spam.
    if result["critical_count"] > 0:
        await _maybe_send_critical_anomaly_alert(anomalies)

    return result


# P0.2: Critical anomaly alerting ─────────────────────────────────────────────
_ANOMALY_ALERT_THROTTLE_KEY = "anomaly:alert:critical"
_ANOMALY_ALERT_THROTTLE_TTL = 15 * 60   # 15 minutes


async def _maybe_send_critical_anomaly_alert(anomalies: list) -> None:
    """Send one Telegram alert per 15-min window when critical anomalies exist."""
    criticals = [a for a in anomalies if getattr(a, "severity", None) == "critical"
                 or (isinstance(a, dict) and a.get("severity") == "critical")]
    if not criticals:
        return

    try:
        from backend.cache.redis_cache import get_redis
        redis = await get_redis()
        # Check throttle — skip if an alert was already sent in the last 15 min
        if await redis.get(_ANOMALY_ALERT_THROTTLE_KEY):
            log.debug("critical_anomaly_alert_throttled")
            return
        # Set throttle BEFORE sending to prevent parallel workers racing
        await redis.setex(_ANOMALY_ALERT_THROTTLE_KEY, _ANOMALY_ALERT_THROTTLE_TTL, "1")
    except Exception as exc:
        log.warning("anomaly_alert_throttle_check_failed", error=str(exc))
        # Don't send if we can't check throttle — prevents spam on Redis failure

    try:
        from backend.config import get_settings
        settings = get_settings()
        token   = settings.telegram_bot_token
        chat_id = settings.telegram_chat_id
        if not token or not chat_id:
            return

        lines = [f"🚨 <b>Critical Anomaly Detected</b>"]
        for a in criticals[:3]:  # cap at 3 to keep message compact
            # Anomaly dataclass uses anomaly_type + description (not type/message)
            if isinstance(a, dict):
                msg   = a.get("description", "unknown")
                atype = a.get("anomaly_type", "unknown")
            else:
                msg   = a.description
                atype = a.anomaly_type
            lines.append(f"• <b>{atype}</b>: {msg}")
        if len(criticals) > 3:
            lines.append(f"  …and {len(criticals) - 3} more")
        lines.append("\n<i>Check SignalEdge Admin → Anomalies</i>")

        import httpx
        async with httpx.AsyncClient(timeout=5.0) as client:
            await client.post(
                f"https://api.telegram.org/bot{token}/sendMessage",
                json={"chat_id": chat_id, "text": "\n".join(lines), "parse_mode": "HTML"},
            )
        log.info("critical_anomaly_alert_sent", count=len(criticals))
    except Exception as exc:
        log.warning("critical_anomaly_alert_failed", error=str(exc))


# ── History queries ───────────────────────────────────────────────────────────

async def get_snapshot_history(snapshot_type: str, limit: int = 30) -> list[dict]:
    """Return the last `limit` snapshots of a given type, newest first."""
    pool = await _pool()
    if pool is None:
        return []
    try:
        rows = await pool.fetch(
            """
            SELECT data, computed_at
            FROM analytics_snapshots
            WHERE snapshot_type = $1
            ORDER BY computed_at DESC
            LIMIT $2
            """,
            snapshot_type, limit,
        )
        return [
            {**json.loads(r["data"]), "_snapshot_at": r["computed_at"].isoformat()}
            for r in rows
        ]
    except Exception as exc:
        log.warning("get_snapshot_history_failed", error=str(exc))
        return []


async def get_latest_anomalies(limit: int = 48) -> list[dict]:
    """
    Return anomaly records from the last `limit` hourly_anomaly snapshots,
    flattened into a single list with timestamp.
    """
    snapshots = await get_snapshot_history("hourly_anomaly", limit)
    anomalies = []
    for snap in snapshots:
        ts = snap.get("checked_at") or snap.get("_snapshot_at", "")
        for a in snap.get("anomalies", []):
            anomalies.append({**a, "snapshot_at": ts})
    return anomalies
