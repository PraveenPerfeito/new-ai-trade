"""
Signal validation analytics — answers "is our filtering actually predictive?"

Three analyses:
  1. confidence_vs_outcome   — TP_HIT rate by AI confidence band (5-point buckets)
  2. setup_score_analysis    — TP_HIT rate by pre_score band (setup quality score)
  3. ai_vs_heuristic         — compare Claude confidence vs heuristic fallback confidence
                               and their respective TP_HIT rates

All queries run against signal_outcomes + ai_call_log joined via signal_id.
Returns empty/zero structures when the DB is unavailable or has no data.
"""
from __future__ import annotations

from backend.logging.setup import get_logger

log = get_logger(__name__)

_CONFIDENCE_BANDS = [(70, 75), (75, 80), (80, 85), (85, 90), (90, 95), (95, 101)]
_SCORE_BANDS      = [(0, 20), (20, 40), (40, 60), (60, 80), (80, 100), (100, 200)]


async def _pool():
    try:
        from backend.database.session import get_pool
        return await get_pool()
    except RuntimeError:
        return None
    except Exception as exc:
        log.warning("signal_validation_db_unavailable", error=str(exc))
        return None


def _band_label(lo: int, hi: int) -> str:
    return f"{lo}-{hi}"


# ── 1. Confidence vs outcome ──────────────────────────────────────────────────

async def confidence_vs_outcome(window_hours: int = 168) -> dict:
    """
    For each 5-point confidence band, return:
      total, tp_hits, sl_hits, timeouts, tp_rate
    Pulls from signal_outcomes joined to trading_signals for confidence.
    """
    pool = await _pool()
    if pool is None:
        return {"bands": [], "summary": "Database unavailable"}

    try:
        rows = await pool.fetch(
            """
            SELECT
                s.confidence,
                o.outcome
            FROM signal_outcomes o
            JOIN trading_signals s ON s.id = o.signal_id
            WHERE o.created_at >= NOW() - ($1 || ' hours')::interval
              AND o.outcome != 'PENDING'
            """,
            str(window_hours),
        )
    except Exception as exc:
        log.warning("confidence_vs_outcome_query_failed", error=str(exc))
        return {"bands": [], "error": str(exc)}

    # Bucket the results
    buckets: dict[str, dict] = {}
    for lo, hi in _CONFIDENCE_BANDS:
        label = _band_label(lo, hi)
        buckets[label] = {"band": label, "total": 0, "tp_hits": 0, "sl_hits": 0, "timeouts": 0}

    for row in rows:
        conf    = int(row["confidence"])
        outcome = row["outcome"]
        for lo, hi in _CONFIDENCE_BANDS:
            if lo <= conf < hi:
                label = _band_label(lo, hi)
                buckets[label]["total"] += 1
                if outcome == "TP_HIT":
                    buckets[label]["tp_hits"] += 1
                elif outcome == "SL_HIT":
                    buckets[label]["sl_hits"] += 1
                elif outcome == "TIMEOUT":
                    buckets[label]["timeouts"] += 1
                break

    bands = []
    for lo, hi in _CONFIDENCE_BANDS:
        b = buckets[_band_label(lo, hi)]
        total = b["total"]
        b["tp_rate"] = round(b["tp_hits"] / total, 4) if total > 0 else None
        bands.append(b)

    # Overall correlation: does higher confidence → higher TP rate?
    ordered = [b for b in bands if b["total"] >= 5]  # need ≥5 samples to be meaningful
    monotone = all(
        ordered[i]["tp_rate"] <= ordered[i + 1]["tp_rate"]
        for i in range(len(ordered) - 1)
        if ordered[i]["tp_rate"] is not None and ordered[i + 1]["tp_rate"] is not None
    )

    return {
        "window_hours": window_hours,
        "bands": bands,
        "total_resolved": len(rows),
        "confidence_is_monotone_predictor": monotone if len(ordered) >= 2 else None,
    }


# ── 2. Setup score threshold analysis ────────────────────────────────────────

async def setup_score_analysis(window_hours: int = 168) -> dict:
    """
    TP_HIT rate at each pre_score band.
    Higher pre_score should predict better outcomes if the scoring is effective.
    """
    pool = await _pool()
    if pool is None:
        return {"bands": [], "summary": "Database unavailable"}

    try:
        rows = await pool.fetch(
            """
            SELECT
                s.pre_score,
                o.outcome
            FROM signal_outcomes o
            JOIN trading_signals s ON s.id = o.signal_id
            WHERE o.created_at >= NOW() - ($1 || ' hours')::interval
              AND o.outcome != 'PENDING'
              AND s.pre_score IS NOT NULL
            """,
            str(window_hours),
        )
    except Exception as exc:
        log.warning("setup_score_analysis_query_failed", error=str(exc))
        return {"bands": [], "error": str(exc)}

    buckets: dict[str, dict] = {}
    for lo, hi in _SCORE_BANDS:
        label = _band_label(lo, hi)
        buckets[label] = {"band": label, "score_range": [lo, hi], "total": 0, "tp_hits": 0}

    for row in rows:
        pre_score = float(row["pre_score"] or 0)
        outcome   = row["outcome"]
        for lo, hi in _SCORE_BANDS:
            if lo <= pre_score < hi:
                label = _band_label(lo, hi)
                buckets[label]["total"] += 1
                if outcome == "TP_HIT":
                    buckets[label]["tp_hits"] += 1
                break

    bands = []
    for lo, hi in _SCORE_BANDS:
        b = buckets[_band_label(lo, hi)]
        total = b["total"]
        b["tp_rate"] = round(b["tp_hits"] / total, 4) if total > 0 else None
        bands.append(b)

    return {
        "window_hours": window_hours,
        "bands": bands,
        "total_resolved": len(rows),
    }


# ── 3. AI vs heuristic comparison ────────────────────────────────────────────

async def ai_vs_heuristic(window_hours: int = 168) -> dict:
    """
    Compare Claude-validated signals vs heuristic-fallback signals:
      - approval rate, avg confidence, TP_HIT rate for each path
    """
    pool = await _pool()
    if pool is None:
        return {"ai": {}, "heuristic": {}, "summary": "Database unavailable"}

    try:
        rows = await pool.fetch(
            """
            SELECT
                a.used_fallback,
                a.confidence,
                o.outcome
            FROM signal_outcomes o
            JOIN ai_call_log a ON a.signal_id = o.signal_id
            WHERE o.created_at >= NOW() - ($1 || ' hours')::interval
              AND o.outcome != 'PENDING'
            """,
            str(window_hours),
        )
    except Exception as exc:
        log.warning("ai_vs_heuristic_query_failed", error=str(exc))
        return {"ai": {}, "heuristic": {}, "error": str(exc)}

    ai_group  = {"total": 0, "tp_hits": 0, "confidences": []}
    her_group = {"total": 0, "tp_hits": 0, "confidences": []}

    for row in rows:
        group = her_group if row["used_fallback"] else ai_group
        group["total"] += 1
        if row["outcome"] == "TP_HIT":
            group["tp_hits"] += 1
        if row["confidence"] is not None:
            group["confidences"].append(float(row["confidence"]))

    def _summarise(g: dict) -> dict:
        total = g["total"]
        confs = g["confidences"]
        return {
            "total": total,
            "tp_hits": g["tp_hits"],
            "tp_rate": round(g["tp_hits"] / total, 4) if total > 0 else None,
            "avg_confidence": round(sum(confs) / len(confs), 1) if confs else None,
        }

    ai_s  = _summarise(ai_group)
    her_s = _summarise(her_group)

    # Which path delivers better outcomes?
    if ai_s["tp_rate"] is not None and her_s["tp_rate"] is not None:
        better = "ai" if ai_s["tp_rate"] >= her_s["tp_rate"] else "heuristic"
    else:
        better = None

    return {
        "window_hours": window_hours,
        "ai": ai_s,
        "heuristic": her_s,
        "better_performer": better,
    }


# ── Combined ──────────────────────────────────────────────────────────────────

async def get_signal_validation_report(window_hours: int = 168) -> dict:
    import asyncio
    conf_task, score_task, ai_task = await asyncio.gather(
        confidence_vs_outcome(window_hours),
        setup_score_analysis(window_hours),
        ai_vs_heuristic(window_hours),
        return_exceptions=True,
    )
    return {
        "window_hours": window_hours,
        "confidence_vs_outcome": conf_task if not isinstance(conf_task, Exception) else {"error": str(conf_task)},
        "setup_score_analysis":  score_task if not isinstance(score_task, Exception) else {"error": str(score_task)},
        "ai_vs_heuristic":       ai_task if not isinstance(ai_task, Exception) else {"error": str(ai_task)},
    }
