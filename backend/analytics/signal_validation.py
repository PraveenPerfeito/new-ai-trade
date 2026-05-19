"""
Signal validation analytics — answers "is our filtering actually predictive?"

Three focused analyses that query signal_outcomes directly (all context is
denormalized there — no JOIN to signals required):

  1. confidence_vs_outcome   — TP_HIT rate by 5-point AI confidence band
  2. setup_score_analysis    — TP_HIT rate by quality_score band
  3. ai_vs_heuristic         — Claude-validated vs heuristic-fallback outcomes

NOTE: These are lightweight "first look" analyses.  Full statistical depth
(Wilson CI, ECE, z-tests) is in backend/analytics/edge_validation.py.
"""
from __future__ import annotations

from backend.logging.setup import get_logger

log = get_logger(__name__)

_CONFIDENCE_BANDS = [(70, 75), (75, 80), (80, 85), (85, 90), (90, 95), (95, 101)]
_QUALITY_BANDS    = [(0, 50), (50, 65), (65, 80), (80, 101)]


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
    return f"{lo}-{hi if hi < 200 else '+'}"


# ── 1. Confidence vs outcome ──────────────────────────────────────────────────

async def confidence_vs_outcome(window_hours: int = 168) -> dict:
    """
    For each 5-point confidence band, return total, tp_hits, sl_hits, timeouts, tp_rate.
    All columns are pulled from signal_outcomes (no JOIN needed).
    """
    pool = await _pool()
    if pool is None:
        return {"bands": [], "error": "Database unavailable"}

    try:
        rows = await pool.fetch(
            """
            SELECT confidence, outcome
            FROM signal_outcomes
            WHERE outcome != 'PENDING'
              AND created_at >= NOW() - ($1 || ' hours')::interval
            """,
            str(window_hours),
        )
    except Exception as exc:
        log.warning("confidence_vs_outcome_query_failed", error=str(exc))
        return {"bands": [], "error": str(exc)}

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
        b     = buckets[_band_label(lo, hi)]
        total = b["total"]
        b["tp_rate"] = round(b["tp_hits"] / total, 4) if total > 0 else None
        bands.append(b)

    non_empty = [b for b in bands if b["total"] >= 5]
    monotone  = None
    if len(non_empty) >= 2:
        monotone = all(
            non_empty[i]["tp_rate"] <= non_empty[i + 1]["tp_rate"]
            for i in range(len(non_empty) - 1)
            if non_empty[i]["tp_rate"] is not None and non_empty[i + 1]["tp_rate"] is not None
        )

    return {
        "window_hours": window_hours,
        "bands": bands,
        "total_resolved": len(rows),
        "confidence_is_monotone_predictor": monotone,
    }


# ── 2. Setup score (quality_score) analysis ────────────────────────────────────

async def setup_score_analysis(window_hours: int = 168) -> dict:
    """
    TP_HIT rate by quality_score band.
    quality_score is the pre-AI risk engine score (0-100) stored in signal_outcomes.
    """
    pool = await _pool()
    if pool is None:
        return {"bands": [], "error": "Database unavailable"}

    try:
        rows = await pool.fetch(
            """
            SELECT quality_score, outcome
            FROM signal_outcomes
            WHERE outcome != 'PENDING'
              AND created_at >= NOW() - ($1 || ' hours')::interval
              AND quality_score IS NOT NULL
            """,
            str(window_hours),
        )
    except Exception as exc:
        log.warning("setup_score_analysis_query_failed", error=str(exc))
        return {"bands": [], "error": str(exc)}

    buckets: dict[str, dict] = {}
    for lo, hi in _QUALITY_BANDS:
        label = _band_label(lo, hi)
        buckets[label] = {"band": label, "score_range": [lo, hi], "total": 0, "tp_hits": 0}

    for row in rows:
        score   = float(row["quality_score"] or 0)
        outcome = row["outcome"]
        for lo, hi in _QUALITY_BANDS:
            if lo <= score < hi:
                label = _band_label(lo, hi)
                buckets[label]["total"] += 1
                if outcome == "TP_HIT":
                    buckets[label]["tp_hits"] += 1
                break

    bands = []
    for lo, hi in _QUALITY_BANDS:
        b     = buckets[_band_label(lo, hi)]
        total = b["total"]
        b["tp_rate"] = round(b["tp_hits"] / total, 4) if total > 0 else None
        bands.append(b)

    return {"window_hours": window_hours, "bands": bands, "total_resolved": len(rows)}


# ── 3. AI vs heuristic comparison ────────────────────────────────────────────

async def ai_vs_heuristic(window_hours: int = 168) -> dict:
    """
    Compare Claude-validated signals vs heuristic-fallback signals via ai_call_log JOIN.
    """
    pool = await _pool()
    if pool is None:
        return {"ai": {}, "heuristic": {}, "error": "Database unavailable"}

    try:
        rows = await pool.fetch(
            """
            SELECT a.used_fallback, a.confidence, o.outcome
            FROM signal_outcomes o
            JOIN ai_call_log a ON a.signal_id = o.signal_id
            WHERE o.outcome != 'PENDING'
              AND o.created_at >= NOW() - ($1 || ' hours')::interval
            """,
            str(window_hours),
        )
    except Exception as exc:
        log.warning("ai_vs_heuristic_query_failed", error=str(exc))
        return {"ai": {}, "heuristic": {}, "error": str(exc)}

    ai_g  = {"total": 0, "tp_hits": 0, "confidences": []}
    her_g = {"total": 0, "tp_hits": 0, "confidences": []}

    for row in rows:
        g = her_g if row["used_fallback"] else ai_g
        g["total"] += 1
        if row["outcome"] == "TP_HIT":
            g["tp_hits"] += 1
        if row["confidence"] is not None:
            g["confidences"].append(float(row["confidence"]))

    def _summarise(g: dict) -> dict:
        n     = g["total"]
        confs = g["confidences"]
        return {
            "total":          n,
            "tp_hits":        g["tp_hits"],
            "tp_rate":        round(g["tp_hits"] / n, 4) if n > 0 else None,
            "avg_confidence": round(sum(confs) / len(confs), 1) if confs else None,
        }

    ai_s  = _summarise(ai_g)
    her_s = _summarise(her_g)
    better = None
    if ai_s["tp_rate"] is not None and her_s["tp_rate"] is not None:
        better = "ai" if ai_s["tp_rate"] >= her_s["tp_rate"] else "heuristic"

    return {
        "window_hours":    window_hours,
        "ai":              ai_s,
        "heuristic":       her_s,
        "better_performer": better,
    }


# ── Combined ──────────────────────────────────────────────────────────────────

async def get_signal_validation_report(window_hours: int = 168) -> dict:
    import asyncio
    results = await asyncio.gather(
        confidence_vs_outcome(window_hours),
        setup_score_analysis(window_hours),
        ai_vs_heuristic(window_hours),
        return_exceptions=True,
    )
    conf_task, score_task, ai_task = results
    return {
        "window_hours": window_hours,
        "confidence_vs_outcome": conf_task if not isinstance(conf_task, Exception) else {"error": str(conf_task)},
        "setup_score_analysis":  score_task if not isinstance(score_task, Exception) else {"error": str(score_task)},
        "ai_vs_heuristic":       ai_task if not isinstance(ai_task, Exception) else {"error": str(ai_task)},
    }
