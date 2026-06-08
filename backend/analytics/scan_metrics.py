"""
Scan performance recording and querying.
Each completed scan writes a row to scan_metrics_log for trend analysis.
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

from backend.logging.setup import get_logger

log = get_logger(__name__)

GATE_REJECTION_KEYS: tuple[str, ...] = (
    "BTC_DOWN_BUY",
    "TOXIC_DENYLIST",
    "SIGNAL_COOLDOWN",   # Phase SIGNAL.COOLDOWN.1: was DUPLICATE_SIGNAL (60min/timeframe)
    "CONFIDENCE_REJECTION",
    "CMC_REJECTION",
    "REGIME_REJECTION",
    # MARKET_STRUCTURE.FIX.1 — sub-condition telemetry (7 market structure filters)
    "ms_sideways",
    "ms_overextension",
    "ms_candle_rejection",
    "ms_trend_exhaustion",
    "ms_fake_volume",
    "ms_sr_rejection",
    "ms_weak_breakout",
)

_GATE_ALIASES = {
    "btc_context": "BTC_DOWN_BUY",
    "btc_down_buy": "BTC_DOWN_BUY",
    "toxic_setup": "TOXIC_DENYLIST",
    "toxic_denylist": "TOXIC_DENYLIST",
    # Legacy aliases for rows written before Phase SIGNAL.COOLDOWN.1
    "duplicate": "SIGNAL_COOLDOWN",
    "duplicate_signal": "SIGNAL_COOLDOWN",
    "signal_cooldown": "SIGNAL_COOLDOWN",
    "ai": "CONFIDENCE_REJECTION",
    "confidence": "CONFIDENCE_REJECTION",
    "confidence_rejection": "CONFIDENCE_REJECTION",
    "cmc": "CMC_REJECTION",
    "cmc_rejection": "CMC_REJECTION",
    "regime": "REGIME_REJECTION",
    "regime_rejection": "REGIME_REJECTION",
}


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
    normalized_rejections = normalize_gate_rejections(gate_rejections)
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
            json.dumps(normalized_rejections),
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
            SELECT mode, coins_scanned, signals_found, duration_ms, errors, gate_rejections
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
    gate_totals = normalize_gate_rejections(None)

    by_mode: dict[str, dict] = {}
    for r in rows:
        m = r["mode"]
        entry = by_mode.setdefault(
            m,
            {
                "count": 0,
                "total_signals": 0,
                "total_ms": 0,
                "gate_rejections": normalize_gate_rejections(None),
            },
        )
        entry["count"]         += 1
        entry["total_signals"] += r["signals_found"]
        entry["total_ms"]      += r["duration_ms"]
        row_rejections = parse_gate_rejections(r["gate_rejections"])
        for gate, count in row_rejections.items():
            gate_totals[gate] = gate_totals.get(gate, 0) + count
            entry["gate_rejections"][gate] = entry["gate_rejections"].get(gate, 0) + count

    mode_summary = {
        m: {
            "scans":          v["count"],
            "avg_signals":    round(v["total_signals"] / v["count"], 2),
            "avg_duration_s": round(v["total_ms"] / v["count"] / 1000, 2),
            "gate_rejections": v["gate_rejections"],
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
        "gate_rejections":    gate_totals,
        "by_mode":           mode_summary,
    }


def normalize_gate_rejections(gate_rejections: dict | None) -> dict[str, int]:
    counts = {key: 0 for key in GATE_REJECTION_KEYS}
    if not gate_rejections:
        return counts

    for raw_key, raw_count in gate_rejections.items():
        key = str(raw_key).strip()
        canonical = _GATE_ALIASES.get(key.lower(), key)
        try:
            count = int(raw_count or 0)
        except (TypeError, ValueError):
            continue
        counts[canonical] = counts.get(canonical, 0) + count
    return counts


def parse_gate_rejections(raw) -> dict[str, int]:
    if raw is None:
        return normalize_gate_rejections(None)
    if isinstance(raw, str):
        try:
            return normalize_gate_rejections(json.loads(raw))
        except json.JSONDecodeError:
            return normalize_gate_rejections(None)
    if isinstance(raw, dict):
        return normalize_gate_rejections(raw)
    return normalize_gate_rejections(None)


def _empty_scan_summary(window_hours: int = 24) -> dict:
    return {
        "window_hours": window_hours, "total_scans": 0, "failure_rate": 0.0,
        "avg_duration_s": 0.0, "avg_coins_scanned": 0.0, "avg_signals_found": 0.0,
        "gate_rejections": normalize_gate_rejections(None),
        "by_mode": {},
    }
