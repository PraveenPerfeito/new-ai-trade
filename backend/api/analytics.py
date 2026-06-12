"""
Analytics API — performance breakdowns, AI effectiveness, scan metrics,
and a realtime SSE metrics stream.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Query
from fastapi.responses import StreamingResponse

from backend.analytics.ai_metrics import get_ai_summary
from backend.analytics.edge_validation import (
    confidence_calibration,
    claude_effectiveness,
    setup_score_analysis as edge_setup_score,
    market_regime_analysis,
    scanner_mode_analysis,
    coin_performance,
    generate_edge_validation_report,
)
from backend.analytics.performance_engine import get_dashboard_summary
from backend.analytics.realtime_metrics import sse_metrics_stream
from backend.analytics.monitoring import get_monitoring_snapshot
from backend.analytics.scan_metrics import get_scan_summary
from backend.analytics.signal_metrics import get_analytics, get_intelligence_summary
from backend.analytics.signal_validation import (
    confidence_vs_outcome,
    setup_score_analysis,
    ai_vs_heuristic,
    get_signal_validation_report,
)
from backend.logging.setup import get_logger

log = get_logger(__name__)

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


@router.get("/summary")
async def dashboard_summary(
    window_hours: int = Query(default=168, ge=1, le=720),
) -> dict[str, Any]:
    """All analytics in one call — signal performance, AI, scans, paper trading."""
    return await get_dashboard_summary(window_hours)


@router.get("/monitor")
async def operational_monitor() -> dict[str, Any]:
    """Daily operational monitoring snapshot: metrics, thresholds, anomalies."""
    return await get_monitoring_snapshot()


@router.get("/performance")
async def signal_performance(
    window_hours: int = Query(default=168, ge=1, le=720),
) -> dict[str, Any]:
    """Signal outcome analytics with breakdowns by mode, grade, volatility, confidence."""
    return await get_analytics(window_hours)


@router.get("/intelligence")
async def intelligence_breakdown(
    window_hours: int = Query(default=720, ge=1, le=2160),
) -> dict[str, Any]:
    """Best-performing intelligence tier per dimension (TrendScore, Sector, Breakout, OI, Funding, Positioning)."""
    return await get_intelligence_summary(window_hours)


@router.get("/ai")
async def ai_effectiveness(
    window_hours: int = Query(default=24, ge=1, le=168),
) -> dict[str, Any]:
    """Claude API approval rates, latency distribution, and fallback usage."""
    return await get_ai_summary(window_hours)


@router.get("/edge-matrix")
async def edge_matrix(
    min_n: int = Query(default=20, ge=5, le=200),
    limit: int = Query(default=50, ge=5, le=200),
) -> dict[str, Any]:
    """
    PHASE.9.P1 Edge Matrix — top combinations from the latest attribution
    snapshot generation (30d window), ranked by expectancy.  Includes Wilson
    95% CI per cell.  Pure SQL aggregation over signal_outcomes — no ML.
    """
    from backend.analytics.probability import wilson_interval
    from backend.database.session import get_pool
    pool = await get_pool()

    pair_keys = [
        "regime|type", "regime|grade", "regime|conf_band", "grade|breakout",
        "breakout|oi", "regime|breakout", "mode|conf_band", "type|conf_band",
        "regime|type|breakout", "trend_tier|breakout", "sector|funding", "oi|positioning",
    ]
    rows = await pool.fetch(
        """
        SELECT DISTINCT ON (dim_key, dim_value) dim_key, dim_value, n, tp, sl, wr, exp, pf
        FROM attribution_snapshots
        WHERE window_days = 30 AND dim_key = ANY($1::text[])
          AND computed_at > NOW() - INTERVAL '48 hours'
        ORDER BY dim_key, dim_value, computed_at DESC
        """,
        pair_keys,
    )
    cells = []
    for r in rows:
        if r["n"] is None or r["n"] < min_n or r["wr"] is None:
            continue
        lo, hi = wilson_interval(float(r["wr"]), int(r["n"]))
        cells.append({
            "dim_key": r["dim_key"], "dim_value": r["dim_value"],
            "n": int(r["n"]), "wr": float(r["wr"]),
            "exp": float(r["exp"]) if r["exp"] is not None else None,
            "pf": float(r["pf"]) if r["pf"] is not None else None,
            "ci": [lo, hi],
        })
    cells.sort(key=lambda c: (c["exp"] if c["exp"] is not None else -99), reverse=True)
    return {
        "min_n": min_n,
        "total_cells": len(cells),
        "top": cells[:limit],
        "bottom": sorted(cells, key=lambda c: (c["exp"] if c["exp"] is not None else 99))[:10],
    }


@router.get("/track-record")
async def track_record() -> dict[str, Any]:
    """
    PHASE.9.P1 Phase G — monetization foundation: verifiable track record
    derived ENTIRELY from signal_outcomes (no manual claims).  Includes
    probability accuracy: stamped cohort WR vs realized outcomes.
    Admin-proxied only — no public UI yet.
    """
    from backend.database.session import get_pool
    pool = await get_pool()

    async def _window(days: int) -> dict:
        row = await pool.fetchrow(
            """
            SELECT count(*)                                  AS resolved,
                   count(*) FILTER (WHERE outcome='TP_HIT')  AS wins,
                   count(*) FILTER (WHERE outcome='SL_HIT')  AS losses,
                   round(avg(rr_achieved)::numeric, 4)       AS expectancy,
                   round((sum(rr_achieved) FILTER (WHERE rr_achieved > 0)
                     / NULLIF(abs(sum(rr_achieved) FILTER (WHERE rr_achieved < 0)), 0))::numeric, 4) AS pf
            FROM signal_outcomes
            WHERE outcome IN ('TP_HIT','SL_HIT')
              AND created_at > NOW() - make_interval(days => $1)
            """,
            days,
        )
        d = dict(row)
        total = (d["wins"] or 0) + (d["losses"] or 0)
        d["win_rate"] = round((d["wins"] or 0) / total * 100, 2) if total else None
        return d

    by_mode = await pool.fetch(
        """
        SELECT scanner_mode, count(*) AS n,
               round(count(*) FILTER (WHERE outcome='TP_HIT')::numeric
                 / NULLIF(count(*), 0) * 100, 1) AS wr,
               round(avg(rr_achieved)::numeric, 3) AS exp
        FROM signal_outcomes
        WHERE outcome IN ('TP_HIT','SL_HIT') AND created_at > NOW() - INTERVAL '30 days'
        GROUP BY 1 ORDER BY 2 DESC
        """
    )

    # Probability accuracy — stamped prediction vs realized outcome (signals
    # carrying empirical_wr that have since resolved)
    acc = await pool.fetchrow(
        """
        SELECT count(*) AS n,
               round(avg(s.empirical_wr)::numeric, 1) AS avg_predicted_wr,
               round(count(*) FILTER (WHERE o.outcome='TP_HIT')::numeric
                 / NULLIF(count(*), 0) * 100, 1)      AS realized_wr,
               round(avg(abs(s.empirical_wr / 100.0
                 - (o.outcome='TP_HIT')::int))::numeric, 4) AS mean_abs_error
        FROM signals s JOIN signal_outcomes o ON o.signal_id = s.id
        WHERE s.empirical_wr IS NOT NULL AND o.outcome IN ('TP_HIT','SL_HIT')
        """
    )

    return {
        "windows": {"d7": await _window(7), "d30": await _window(30), "d90": await _window(90)},
        "by_mode_30d": [dict(r) for r in by_mode],
        "probability_accuracy": dict(acc) if acc else None,
        "source": "signal_outcomes (database-derived; no manual adjustments)",
    }


@router.get("/telegram-delivery")
async def telegram_delivery() -> dict[str, Any]:
    """
    TELEGRAM.RELIABILITY.1 WS5 — delivery funnel ground truth (24h + 7d).
    generated → eligible (conf ≥ 85) → queued (telegram_sent) → delivered /
    failed / unresolved, plus suppression visibility: shadowed (dedup within
    1h of a sent twin) and other (rate-cap / gates / tail-loss era).
    """
    from backend.database.session import get_pool
    pool = await get_pool()

    async def _window(hours: int) -> dict:
        row = await pool.fetchrow(
            """
            SELECT count(*)                                              AS generated,
                   count(*) FILTER (WHERE confidence >= 85)              AS eligible,
                   count(*) FILTER (WHERE telegram_sent)                 AS queued,
                   count(*) FILTER (WHERE telegram_delivered IS TRUE)    AS delivered,
                   count(*) FILTER (WHERE telegram_delivered IS FALSE)   AS failed,
                   count(*) FILTER (WHERE telegram_sent
                                    AND telegram_delivered IS NULL)      AS unresolved,
                   count(*) FILTER (WHERE confidence >= 85 AND NOT telegram_sent
                     AND EXISTS (
                       SELECT 1 FROM signals p
                       WHERE p.symbol = signals.symbol AND p.type = signals.type
                         AND p.telegram_sent AND p.id != signals.id
                         AND p.created_at BETWEEN signals.created_at - INTERVAL '60 minutes'
                                              AND signals.created_at
                     ))                                                  AS shadowed
            FROM signals
            WHERE created_at > NOW() - make_interval(hours => $1)
            """,
            hours,
        )
        d = dict(row)
        d["suppressed_other"] = max(0, (d["eligible"] - d["queued"]) - d["shadowed"])
        return d

    return {"h24": await _window(24), "d7": await _window(168)}


@router.get("/confidence-calibration")
async def confidence_calibration_v2(
    window_hours: int = Query(default=720, ge=24, le=2160),
) -> dict[str, Any]:
    """
    CONFIDENCE.CALIBRATION.2 — READ-ONLY empirical confidence analytics.
    Band stats, calibration drift (per regime/type/mode), founder insights,
    trend history, data quality.  Gated by FeatureFlags.confidence_calibration_v2
    (default OFF → returns {"enabled": false} and the UI section stays hidden).
    Production confidence/scoring/gating are NEVER affected by this endpoint.
    """
    try:
        from backend.system_settings.service import get_settings_service
        from backend.system_settings.groups import FeatureFlags
        flags = await get_settings_service().get_group(FeatureFlags)
        if not flags.confidence_calibration_v2:
            return {"enabled": False}
    except Exception as exc:
        log.warning("confidence_calibration_flag_read_failed", error=str(exc))
        return {"enabled": False}

    from backend.analytics.confidence_calibration import compute_confidence_calibration
    return await compute_confidence_calibration(window_hours)


@router.get("/scans")
async def scan_performance(
    window_hours: int = Query(default=24, ge=1, le=168),
) -> dict[str, Any]:
    """Scan throughput, duration trends, and per-mode breakdown."""
    return await get_scan_summary(window_hours)


@router.get("/signal-validation")
async def signal_validation(
    window_hours: int = Query(default=168, ge=1, le=720),
) -> dict[str, Any]:
    """
    Combined signal validation report:
    - confidence_vs_outcome: TP_HIT rate per 5-point confidence band
    - setup_score_analysis:  TP_HIT rate per pre_score bucket
    - ai_vs_heuristic:       Claude vs fallback outcome comparison
    """
    return await get_signal_validation_report(window_hours)


@router.get("/signal-validation/confidence")
async def signal_validation_confidence(
    window_hours: int = Query(default=168, ge=1, le=720),
) -> dict[str, Any]:
    """TP_HIT rate by AI confidence band — shows whether confidence is a real predictor."""
    return await confidence_vs_outcome(window_hours)


@router.get("/signal-validation/setup-score")
async def signal_validation_setup_score(
    window_hours: int = Query(default=168, ge=1, le=720),
) -> dict[str, Any]:
    """TP_HIT rate by setup quality (pre_score) — shows whether scoring gates are effective."""
    return await setup_score_analysis(window_hours)


@router.get("/signal-validation/ai-vs-heuristic")
async def signal_validation_ai_vs_heuristic(
    window_hours: int = Query(default=168, ge=1, le=720),
) -> dict[str, Any]:
    """Compare Claude-validated vs heuristic-fallback signal outcomes."""
    return await ai_vs_heuristic(window_hours)


@router.get("/edge/report")
async def edge_validation_report(
    window_hours: int = Query(default=720, ge=24, le=2160),
) -> dict[str, Any]:
    """
    Full Phase 4.7 edge validation report — all 7 analyses in one call.
    Includes: edge verdict, calibration, Claude effectiveness, setup score,
    market regime, scanner mode, coin performance, and threshold recommendations.
    window_hours default = 720 (30 days).
    """
    return await generate_edge_validation_report(window_hours)


@router.get("/edge/calibration")
async def edge_calibration(
    window_hours: int = Query(default=720, ge=24, le=2160),
) -> dict[str, Any]:
    """
    Confidence calibration analysis.
    Returns actual win rate vs expected win rate per 5-point confidence band,
    ECE (Expected Calibration Error), reliability score, and 7/30-day rolling trends.
    """
    return await confidence_calibration(window_hours)


@router.get("/edge/claude")
async def edge_claude(
    window_hours: int = Query(default=720, ge=24, le=2160),
) -> dict[str, Any]:
    """
    Claude AI effectiveness report.
    Compares Claude-validated vs heuristic-fallback signal outcomes.
    Includes win rate lift and two-proportion z-test for statistical significance.
    """
    return await claude_effectiveness(window_hours)


@router.get("/edge/setup-score")
async def edge_setup_score_view(
    window_hours: int = Query(default=720, ge=24, le=2160),
) -> dict[str, Any]:
    """
    Setup score (quality_score) analysis by band.
    Determines the optimal quality_score threshold for maximum profitability.
    """
    return await edge_setup_score(window_hours)


@router.get("/edge/regime")
async def edge_regime(
    window_hours: int = Query(default=720, ge=24, le=2160),
) -> dict[str, Any]:
    """
    Market regime analysis by volatility_regime (LOW/NORMAL/HIGH/EXTREME).
    Determines which regimes produce profitable signals and which to avoid.
    """
    return await market_regime_analysis(window_hours)


@router.get("/edge/modes")
async def edge_modes(
    window_hours: int = Query(default=720, ge=24, le=2160),
) -> dict[str, Any]:
    """
    Scanner mode comparison: spot, futures, high_confidence, trending.
    Ranked by expectancy with per-mode signal frequency and drawdown.
    """
    return await scanner_mode_analysis(window_hours)


@router.get("/edge/coins")
async def edge_coins(
    window_hours: int = Query(default=720, ge=24, le=2160),
    top_n:        int = Query(default=20, ge=5, le=50),
) -> dict[str, Any]:
    """
    Per-coin performance analysis.
    Best and worst performers by win rate, expectancy, and drawdown.
    """
    return await coin_performance(window_hours, top_n)


@router.get("/stream")
async def metrics_stream(
    timeout: int = Query(default=300, ge=30, le=600),
) -> StreamingResponse:
    """
    Server-Sent Events stream of realtime scanner and signal events.
    Connect with EventSource('/api/analytics/stream') from the frontend.
    """
    return StreamingResponse(
        sse_metrics_stream(timeout),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection":    "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
