"""
Production readiness scoring — answers "is this system ready to trade live?"

Scores five components 0-100 and combines them into an overall score.
Each component has explicit thresholds so the verdict is reproducible
and auditable, not a black box.

Scoring matrix:
  operational_stability (25%) — scan failure rate, AI error rate, anomaly count
  signal_edge           (30%) — win rate, expectancy, sample adequacy
  calibration           (20%) — ECE, monotonicity
  ai_effectiveness      (15%) — Claude lift verdict, fallback rate
  data_coverage         (10%) — resolved signals, days of data

Verdict:
  >= 80: production_ready         (Go)
  >= 65: ready_with_monitoring    (Go with enhanced monitoring)
  >= 50: needs_more_data          (Continue burn-in)
  <  50: not_ready                (Significant issues to resolve)
"""
from __future__ import annotations

from datetime import datetime, timezone


# ── Scoring helpers ───────────────────────────────────────────────────────────

def _score(value: float | None, thresholds: list[tuple[float, int]]) -> int:
    """
    Map a metric value to a 0-100 score using a step-function.
    thresholds: [(cutoff, score), ...] sorted so the BEST condition is first.
    Returns the score of the first matching condition, or 0.
    """
    if value is None:
        return 0
    for cutoff, score in thresholds:
        if value >= cutoff:
            return score
    return 0


def _avg(*scores: int | float, weights: list[float] | None = None) -> int:
    if not scores:
        return 0
    if weights:
        total_w = sum(weights)
        return round(sum(s * w for s, w in zip(scores, weights)) / total_w)
    return round(sum(scores) / len(scores))


# ── Component scorers ─────────────────────────────────────────────────────────

def score_operational_stability(
    scan_summary: dict,
    ai_summary: dict,
    anomaly_result: dict,
) -> dict:
    """
    25% of overall score.
    Penalises high failure rates and unresolved critical anomalies.
    """
    # Scan failure rate: lower is better
    scan_fail = scan_summary.get("failure_rate", 0.0)
    scan_score = _score(1 - scan_fail, [
        (0.95, 100),  # < 5% failure
        (0.85, 70),   # 5-15% failure
        (0.70, 40),   # 15-30% failure
    ])

    # AI error rate: lower is better
    ai_error = ai_summary.get("error_rate", 0.0)
    ai_score = _score(1 - ai_error, [
        (0.95, 100),  # < 5% error
        (0.90, 70),   # 5-10% error
        (0.80, 40),   # 10-20% error
    ])

    # Critical anomalies in last check: none = 100, any = 0
    critical = anomaly_result.get("critical_count", 0)
    anomaly_score = 100 if critical == 0 else (40 if critical == 1 else 0)

    overall = _avg(scan_score, ai_score, anomaly_score, weights=[0.35, 0.30, 0.35])
    return {
        "score":         overall,
        "scan_score":    scan_score,
        "ai_score":      ai_score,
        "anomaly_score": anomaly_score,
        "inputs": {
            "scan_failure_rate": scan_fail,
            "ai_error_rate":     ai_error,
            "critical_anomalies": critical,
        },
    }


def score_signal_edge(overall_stats: dict) -> dict:
    """
    30% of overall score.
    Penalises low win rates, negative expectancy, and thin sample sizes.
    """
    win_rate  = overall_stats.get("win_rate")
    expectancy = overall_stats.get("expectancy")
    total     = overall_stats.get("total", 0)

    wr_score = _score(win_rate or 0, [
        (0.62, 100),  # > 62%
        (0.57, 80),   # 57-62%
        (0.52, 50),   # 52-57%
        (0.48, 20),   # 48-52% (barely profitable)
    ])

    exp_score = _score(expectancy or -99, [
        (0.50, 100),  # > 0.5R expectancy
        (0.20, 80),   # 0.2-0.5R
        (0.05, 50),   # marginally positive
        (0.00, 20),   # exactly 0
    ])

    sample_score = _score(total, [
        (200, 100),
        (100, 80),
        (50,  60),
        (30,  40),
        (10,  20),
    ])

    overall = _avg(wr_score, exp_score, sample_score, weights=[0.40, 0.40, 0.20])
    return {
        "score":        overall,
        "wr_score":     wr_score,
        "exp_score":    exp_score,
        "sample_score": sample_score,
        "inputs": {
            "win_rate":   win_rate,
            "expectancy": expectancy,
            "total":      total,
        },
    }


def score_calibration(calibration: dict) -> dict:
    """
    20% of overall score.
    Directly uses ECE and monotonicity from confidence_calibration().
    """
    cal     = calibration.get("calibration", {})
    ece     = cal.get("ece")
    monotone = cal.get("is_monotone")

    ece_score = _score(1 - (ece or 1), [
        (0.95, 100),  # ECE < 0.05
        (0.90, 70),   # ECE 0.05-0.10
        (0.85, 40),   # ECE 0.10-0.15
    ])

    # is_monotone: True=100, None=50 (not enough data), False=0
    if monotone is True:
        mono_score = 100
    elif monotone is None:
        mono_score = 50
    else:
        mono_score = 0

    overall = _avg(ece_score, mono_score, weights=[0.70, 0.30])
    return {
        "score":      overall,
        "ece_score":  ece_score,
        "mono_score": mono_score,
        "inputs": {"ece": ece, "is_monotone": monotone},
    }


def score_ai_effectiveness(claude_result: dict) -> dict:
    """
    15% of overall score.
    Based on Claude verdict and fallback rate.
    """
    verdict       = claude_result.get("verdict", "insufficient_data")
    fallback_rate = claude_result.get("heuristic", {}).get("total", 0)
    total_with_ai = claude_result.get("total_with_ai_log", 0)

    fb_rate = (
        fallback_rate / total_with_ai if total_with_ai > 0 else 0.0
    )

    verdict_score = {
        "claude_adds_value":         100,
        "no_significant_difference":  60,
        "insufficient_data":          40,
        "heuristic_outperforms":      10,
        "unclear":                    30,
    }.get(verdict, 30)

    fb_score = _score(1 - fb_rate, [
        (0.90, 100),  # < 10% fallback
        (0.70, 70),   # 10-30% fallback
        (0.50, 40),   # 30-50% fallback
    ])

    overall = _avg(verdict_score, fb_score, weights=[0.60, 0.40])
    return {
        "score":          overall,
        "verdict_score":  verdict_score,
        "fallback_score": fb_score,
        "inputs": {
            "verdict":       verdict,
            "fallback_rate": round(fb_rate, 4),
        },
    }


def score_data_coverage(coverage: dict) -> dict:
    """
    10% of overall score.
    Penalises thin data (few signals, short window).
    """
    resolved = coverage.get("resolved", 0)
    days     = coverage.get("days", 0.0)

    signal_score = _score(resolved, [
        (200, 100),
        (100, 80),
        (50,  60),
        (30,  40),
        (10,  20),
    ])

    days_score = _score(days, [
        (30, 100),
        (14, 70),
        (7,  40),
        (2,  20),
    ])

    overall = _avg(signal_score, days_score, weights=[0.50, 0.50])
    return {
        "score":         overall,
        "signal_score":  signal_score,
        "days_score":    days_score,
        "inputs": {"resolved": resolved, "days": days},
    }


# ── Verdict ───────────────────────────────────────────────────────────────────

def _verdict(overall: int, components: dict) -> dict:
    """Generate a human-readable verdict and go/no-go recommendation."""
    edge_s  = components["signal_edge"]["score"]
    cal_s   = components["calibration"]["score"]
    ops_s   = components["operational_stability"]["score"]

    if overall >= 80:
        label     = "production_ready"
        go        = True
        rationale = (
            f"Overall score {overall}/100. All critical metrics are within acceptable bounds. "
            "System is ready for live paper trading with normal monitoring."
        )
    elif overall >= 65:
        label     = "ready_with_monitoring"
        go        = True
        weakest   = min(components, key=lambda k: components[k]["score"])
        rationale = (
            f"Overall score {overall}/100. System is functional but '{weakest}' "
            f"(score {components[weakest]['score']}/100) needs attention. "
            "Go — but increase monitoring frequency."
        )
    elif overall >= 50:
        label     = "needs_more_data"
        go        = False
        rationale = (
            f"Overall score {overall}/100. "
            f"Edge score {edge_s}/100, calibration {cal_s}/100. "
            "Insufficient resolved signals or marginal performance. "
            "Continue burn-in for at least another 7 days."
        )
    else:
        label     = "not_ready"
        go        = False
        rationale = (
            f"Overall score {overall}/100. Multiple components are failing. "
            f"Edge={edge_s}/100, Ops={ops_s}/100, Cal={cal_s}/100. "
            "Resolve critical issues before proceeding."
        )

    return {
        "label":     label,
        "go":        go,
        "rationale": rationale,
        "score":     overall,
    }


# ── Main entry ────────────────────────────────────────────────────────────────

async def compute_production_readiness() -> dict:
    """
    Fetch all necessary metrics and compute the full readiness score.
    Reads from DB, Redis, and existing snapshot history.
    """
    from backend.analytics.burn_in import (
        _pool, _get_coverage, _load_latest_snapshot,
    )
    from backend.analytics.ai_metrics import get_ai_summary
    from backend.analytics.scan_metrics import get_scan_summary

    pool = await _pool()
    if pool is None:
        return {"error": "Database unavailable"}

    edge_snapshot, coverage, ai_sum, scan_sum = await __import__("asyncio").gather(
        _load_latest_snapshot(pool, "daily_edge"),
        _get_coverage(pool),
        get_ai_summary(24),
        get_scan_summary(24),
        return_exceptions=True,
    )

    if isinstance(edge_snapshot, Exception): edge_snapshot = None
    if isinstance(coverage, Exception):       coverage = {}
    if isinstance(ai_sum, Exception):         ai_sum = {}
    if isinstance(scan_sum, Exception):       scan_sum = {}

    edge_report     = edge_snapshot or {}
    overall_stats   = edge_report.get("overall", {})
    calibration     = edge_report.get("confidence_calibration", {})
    claude_result   = edge_report.get("claude_effectiveness", {})
    anomaly_snap    = await _load_latest_snapshot(pool, "hourly_anomaly") or {}

    # Score each component
    ops_component  = score_operational_stability(scan_sum, ai_sum, anomaly_snap)
    edge_component = score_signal_edge(overall_stats)
    cal_component  = score_calibration(calibration)
    ai_component   = score_ai_effectiveness(claude_result)
    cov_component  = score_data_coverage(coverage)

    components = {
        "operational_stability": ops_component,
        "signal_edge":           edge_component,
        "calibration":           cal_component,
        "ai_effectiveness":      ai_component,
        "data_coverage":         cov_component,
    }

    weights = {
        "operational_stability": 0.25,
        "signal_edge":           0.30,
        "calibration":           0.20,
        "ai_effectiveness":      0.15,
        "data_coverage":         0.10,
    }

    overall = round(sum(
        components[k]["score"] * weights[k] for k in components
    ))

    verdict = _verdict(overall, components)

    return {
        "overall_score": overall,
        "verdict":       verdict,
        "components":    components,
        "weights":       weights,
        "computed_at":   datetime.now(timezone.utc).isoformat(),
        "data_source":   "latest daily_edge snapshot + live 24h scan/AI metrics",
    }
