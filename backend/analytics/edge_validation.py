"""
Phase 4.7 — Signal Edge Validation and Quantitative Analysis.

Produces seven analyses from signal_outcomes + ai_call_log:

  1. confidence_calibration   — actual win rate vs expected (confidence) per 5-pt band
  2. claude_effectiveness     — Claude vs heuristic-fallback signal outcomes
  3. setup_score_analysis     — quality_score bands: TP rate, expectancy, Sharpe
  4. market_regime_analysis   — breakdown by volatility_regime
  5. scanner_mode_analysis    — breakdown by scanner_mode
  6. coin_performance         — per-symbol breakdown (top-N by volume)
  7. threshold_recommendations — data-driven suggestions for filter tightening

All functions return a dict with: data, meta, warnings, insufficient_data.
Statistical methods: Wilson CI, ECE, two-proportion z-test.
Minimum sample threshold: 10 — below this, results are flagged as unreliable.
"""
from __future__ import annotations

import asyncio
import math
from datetime import datetime, timezone

from backend.analytics.stats_utils import (
    wilson_ci,
    two_prop_z,
    expected_calibration_error,
    calibration_label,
    reliability_score,
    group_stats,
    sample_warning,
    has_data,
    safe_mean,
    MIN_SAMPLES,
)
from backend.logging.setup import get_logger

log = get_logger(__name__)

# ── Band definitions ──────────────────────────────────────────────────────────

_CONF_BANDS    = [(70, 75), (75, 80), (80, 85), (85, 90), (90, 95), (95, 101)]
_QUALITY_BANDS = [(0, 50), (50, 65), (65, 80), (80, 101)]
_TOP_COINS     = ["BTC", "ETH", "SOL", "BNB", "XRP", "DOGE", "ADA", "AVAX", "LINK", "SUI",
                  "DOT", "MATIC", "UNI", "LTC", "ATOM", "NEAR", "FIL", "APT", "ARB", "OP"]


# ── DB helpers ────────────────────────────────────────────────────────────────

async def _pool():
    try:
        from backend.database.session import get_pool
        return await get_pool()
    except RuntimeError:
        return None
    except Exception as exc:
        log.warning("edge_validation_db_unavailable", error=str(exc))
        return None


async def _fetch_outcomes(pool, window_hours: int) -> list[dict]:
    """Fetch all resolved signal_outcomes within the window."""
    try:
        rows = await pool.fetch(
            """
            SELECT
                outcome, rr_achieved, duration_hours, confidence,
                scanner_mode, signal_type, volatility_regime,
                risk_grade, quality_score, symbol, ai_validated,
                trend_score, sector_status, breakout_type, breakout_strength,
                oi_interpretation, funding_trend, positioning_context,
                market_regime
            FROM signal_outcomes
            WHERE outcome != 'PENDING'
              AND created_at >= NOW() - ($1 || ' hours')::interval
            ORDER BY created_at ASC
            """,
            str(window_hours),
        )
        return [dict(r) for r in rows]
    except Exception as exc:
        log.warning("fetch_outcomes_failed", error=str(exc))
        return []


async def _fetch_ai_join(pool, window_hours: int) -> list[dict]:
    """Fetch outcomes joined to ai_call_log for Claude vs heuristic split."""
    try:
        rows = await pool.fetch(
            """
            SELECT
                o.outcome, o.rr_achieved, o.duration_hours,
                a.used_fallback, a.validated, a.confidence AS ai_confidence,
                a.latency_ms
            FROM signal_outcomes o
            JOIN ai_call_log a ON a.signal_id = o.signal_id
            WHERE o.outcome != 'PENDING'
              AND o.created_at >= NOW() - ($1 || ' hours')::interval
            """,
            str(window_hours),
        )
        return [dict(r) for r in rows]
    except Exception as exc:
        log.warning("fetch_ai_join_failed", error=str(exc))
        return []


# ── 1. Confidence Calibration ─────────────────────────────────────────────────

async def confidence_calibration(window_hours: int = 720) -> dict:
    """
    For each 5-point confidence band:
      - actual win_rate with 95% Wilson CI
      - expected win_rate (band midpoint / 100)
      - calibration error (|actual - expected|)
      - expectancy, max_drawdown_r, avg_rr_achieved

    Also computed:
      - ECE (Expected Calibration Error) — overall calibration quality
      - reliability score 0-100
      - rolling 7-day and 30-day breakdown for temporal stability
    """
    pool = await _pool()
    if pool is None:
        return {"error": "Database unavailable", "insufficient_data": True}

    all_rows, rows_7d, rows_30d = await asyncio.gather(
        _fetch_outcomes(pool, window_hours),
        _fetch_outcomes(pool, 168),
        _fetch_outcomes(pool, 720),
    )

    def _build_bands(rows: list[dict]) -> list[dict]:
        band_rows: dict[str, list[dict]] = {f"{lo}-{hi}": [] for lo, hi in _CONF_BANDS}
        for r in rows:
            conf = int(r.get("confidence") or 0)
            for lo, hi in _CONF_BANDS:
                if lo <= conf < hi:
                    band_rows[f"{lo}-{hi}"].append(r)
                    break

        bands = []
        for lo, hi in _CONF_BANDS:
            key      = f"{lo}-{hi}"
            brows    = band_rows[key]
            stats    = group_stats(brows, label=key)
            midpoint = (lo + min(hi, 100)) / 2 / 100   # expected win_rate
            stats["expected_win_rate"] = round(midpoint, 4)
            if stats.get("win_rate") is not None:
                stats["calibration_error"] = round(abs(stats["win_rate"] - midpoint), 4)
            else:
                stats["calibration_error"] = None
            bands.append(stats)
        return bands

    bands      = _build_bands(all_rows)
    bands_7d   = _build_bands(rows_7d)
    bands_30d  = _build_bands(rows_30d)

    # ECE on the requested window
    ece   = expected_calibration_error(bands)
    label = calibration_label(ece)
    rel   = reliability_score(ece)

    # Monotonicity check: does higher confidence → higher win rate?
    non_empty = [b for b in bands if not b.get("insufficient_data") and b.get("win_rate") is not None]
    monotone = None
    if len(non_empty) >= 2:
        monotone = all(
            non_empty[i]["win_rate"] <= non_empty[i + 1]["win_rate"]
            for i in range(len(non_empty) - 1)
        )

    total   = len(all_rows)
    warning = sample_warning(total)

    return {
        "window_hours": window_hours,
        "total_resolved": total,
        "bands": bands,
        "rolling": {
            "7d":  {"bands": bands_7d,  "total": len(rows_7d)},
            "30d": {"bands": bands_30d, "total": len(rows_30d)},
        },
        "calibration": {
            "ece":               ece,
            "label":             label,
            "reliability_score": rel,
            "is_monotone":       monotone,
            "interpretation": (
                "Confidence scores are predictive of win rate" if monotone
                else "Confidence is NOT monotonically predictive — recalibration recommended"
                if monotone is False else "Insufficient data to assess"
            ),
        },
        "insufficient_data": not has_data(total),
        "warning": warning,
    }


# ── 2. Claude Effectiveness ───────────────────────────────────────────────────

async def claude_effectiveness(window_hours: int = 720) -> dict:
    """
    Compare Claude-validated signals vs heuristic-fallback signals.

    Statistical test: two-proportion z-test on win rates.
    Returns:
      - per-group stats (win_rate, expectancy, profit_factor, max_drawdown, Sharpe)
      - lift = claude_win_rate − heuristic_win_rate
      - z-test: is the lift statistically significant at p < 0.05?
      - verdict: whether Claude materially improves outcomes
    """
    pool = await _pool()
    if pool is None:
        return {"error": "Database unavailable", "insufficient_data": True}

    rows = await _fetch_ai_join(pool, window_hours)

    claude_rows    = [r for r in rows if not r.get("used_fallback")]
    heuristic_rows = [r for r in rows if r.get("used_fallback")]

    claude_stats    = group_stats(claude_rows,    label="claude")
    heuristic_stats = group_stats(heuristic_rows, label="heuristic")

    # Statistical test
    z_score, significant = two_prop_z(
        claude_stats.get("tp_hits", 0), claude_stats["total"],
        heuristic_stats.get("tp_hits", 0), heuristic_stats["total"],
    )

    # Lift
    c_wr = claude_stats.get("win_rate")
    h_wr = heuristic_stats.get("win_rate")
    lift = round(c_wr - h_wr, 4) if (c_wr is not None and h_wr is not None) else None

    # Verdict
    if claude_stats["total"] < MIN_SAMPLES or heuristic_stats["total"] < MIN_SAMPLES:
        verdict = "insufficient_data"
    elif lift is None:
        verdict = "insufficient_data"
    elif significant and lift > 0:
        verdict = "claude_adds_value"
    elif significant and lift < 0:
        verdict = "heuristic_outperforms"
    elif not significant:
        verdict = "no_significant_difference"
    else:
        verdict = "unclear"

    # Average AI latency
    latencies = [r["latency_ms"] for r in claude_rows if r.get("latency_ms") is not None]
    avg_latency = round(sum(latencies) / len(latencies)) if latencies else None

    total = len(rows)
    return {
        "window_hours":    window_hours,
        "total_with_ai_log": total,
        "claude":          claude_stats,
        "heuristic":       heuristic_stats,
        "lift":            lift,
        "z_score":         z_score,
        "statistically_significant": significant,
        "verdict":         verdict,
        "avg_claude_latency_ms": avg_latency,
        "interpretation": {
            "claude_adds_value": "Claude validation measurably improves signal quality",
            "heuristic_outperforms": "Heuristic fallback is performing better — review Claude prompts",
            "no_significant_difference": "No statistically significant difference between Claude and heuristic paths",
            "insufficient_data": "Not enough resolved signals to draw conclusions",
            "unclear": "Results are inconclusive",
        }.get(verdict, ""),
        "insufficient_data": not has_data(total),
        "warning": sample_warning(total),
    }


# ── 3. Setup Score Analysis ───────────────────────────────────────────────────

async def setup_score_analysis(window_hours: int = 720) -> dict:
    """
    Analyze signal quality by quality_score band (0-100 from the risk engine).
    quality_score is the pre-AI setup quality score stored in signal_outcomes.

    Bands: 0-50, 50-65, 65-80, 80+
    Metrics: TP rate + Wilson CI, expectancy, Sharpe, max_drawdown, profit_factor
    """
    pool = await _pool()
    if pool is None:
        return {"error": "Database unavailable", "insufficient_data": True}

    all_rows = await _fetch_outcomes(pool, window_hours)
    rows_with_score = [r for r in all_rows if r.get("quality_score") is not None]

    band_rows: dict[str, list[dict]] = {}
    for lo, hi in _QUALITY_BANDS:
        key = f"{lo}-{min(hi-1, 100)}"
        band_rows[key] = []

    for r in rows_with_score:
        score = float(r.get("quality_score") or 0)
        for lo, hi in _QUALITY_BANDS:
            if lo <= score < hi:
                key = f"{lo}-{min(hi-1, 100)}"
                band_rows[key].append(r)
                break

    bands = []
    best_band = None
    best_expectancy = float("-inf")
    for lo, hi in _QUALITY_BANDS:
        key   = f"{lo}-{min(hi-1, 100)}"
        stats = group_stats(band_rows[key], label=key)
        bands.append(stats)
        if stats.get("expectancy") is not None and stats["total"] >= MIN_SAMPLES:
            if stats["expectancy"] > best_expectancy:
                best_expectancy = stats["expectancy"]
                best_band = key

    # Optimal threshold: find the minimum quality_score where TP rate >= 55%
    optimal_threshold = None
    for lo, hi in _QUALITY_BANDS:
        key   = f"{lo}-{min(hi-1, 100)}"
        brows = band_rows[key]
        if len(brows) >= MIN_SAMPLES:
            tp = sum(1 for r in brows if r["outcome"] == "TP_HIT")
            wr = tp / len(brows)
            if wr >= 0.55 and optimal_threshold is None:
                optimal_threshold = lo

    total = len(rows_with_score)
    return {
        "window_hours":       window_hours,
        "total_with_quality_score": total,
        "bands":              bands,
        "optimal_threshold":  optimal_threshold,
        "best_band":          best_band,
        "note": (
            "quality_score is the pre-AI risk engine score (0-100). "
            "Higher scores indicate stronger setup quality before AI validation."
        ),
        "insufficient_data":  not has_data(total),
        "warning":            sample_warning(total),
    }


# ── 4. Market Regime Analysis ─────────────────────────────────────────────────

async def market_regime_analysis(window_hours: int = 720) -> dict:
    """
    Breakdown by volatility_regime: LOW, NORMAL, HIGH, EXTREME.
    Determines which regimes are profitable and which should be avoided.
    """
    pool = await _pool()
    if pool is None:
        return {"error": "Database unavailable", "insufficient_data": True}

    all_rows = await _fetch_outcomes(pool, window_hours)

    regimes   = ["LOW", "NORMAL", "HIGH", "EXTREME"]
    by_regime: dict[str, list[dict]] = {r: [] for r in regimes}
    unknown   = []

    for row in all_rows:
        reg = (row.get("volatility_regime") or "").upper()
        if reg in by_regime:
            by_regime[reg].append(row)
        else:
            unknown.append(row)

    results = {}
    for reg in regimes:
        results[reg.lower()] = group_stats(by_regime[reg], label=reg)

    # Rank regimes by expectancy (only those with sufficient data)
    ranked = sorted(
        [
            (reg.lower(), results[reg.lower()].get("expectancy") or float("-inf"))
            for reg in regimes
            if results[reg.lower()]["total"] >= MIN_SAMPLES
        ],
        key=lambda x: x[1],
        reverse=True,
    )

    # Recommend avoiding regimes with negative expectancy
    avoid = [reg for reg, exp in ranked if exp < 0]
    prefer = [reg for reg, exp in ranked if exp >= 0]

    total = len(all_rows)
    return {
        "window_hours": window_hours,
        "total_resolved": total,
        "regimes": results,
        "ranked_by_expectancy": [r for r, _ in ranked],
        "recommended_avoid": avoid,
        "recommended_prefer": prefer,
        "unknown_regime_count": len(unknown),
        "insufficient_data": not has_data(total),
        "warning": sample_warning(total),
    }


# ── 5. Scanner Mode Analysis ──────────────────────────────────────────────────

async def scanner_mode_analysis(window_hours: int = 720) -> dict:
    """
    Breakdown by scanner_mode: spot, futures, high_confidence, trending.
    Measures: win_rate, expectancy, profit_factor, signal frequency, drawdown.
    """
    pool = await _pool()
    if pool is None:
        return {"error": "Database unavailable", "insufficient_data": True}

    all_rows = await _fetch_outcomes(pool, window_hours)
    modes = ["spot", "futures", "high_confidence", "trending"]
    by_mode: dict[str, list[dict]] = {m: [] for m in modes}
    other = []

    for row in all_rows:
        mode = (row.get("scanner_mode") or "").lower()
        if mode in by_mode:
            by_mode[mode].append(row)
        else:
            other.append(row)

    # Signal frequency: signals per day = total / (window_hours / 24)
    days = window_hours / 24

    results = {}
    for mode in modes:
        stats = group_stats(by_mode[mode], label=mode)
        stats["signals_per_day"] = round(stats["total"] / days, 2) if days > 0 else None
        results[mode] = stats

    # Rank by expectancy
    ranked = sorted(
        [
            (mode, results[mode].get("expectancy") or float("-inf"))
            for mode in modes
            if results[mode]["total"] >= MIN_SAMPLES
        ],
        key=lambda x: x[1],
        reverse=True,
    )

    total = len(all_rows)
    return {
        "window_hours":       window_hours,
        "total_resolved":     total,
        "modes":              results,
        "ranked_by_expectancy": [m for m, _ in ranked],
        "other_mode_count":   len(other),
        "insufficient_data":  not has_data(total),
        "warning":            sample_warning(total),
    }


# ── 6. Coin Performance Analysis ─────────────────────────────────────────────

async def coin_performance(window_hours: int = 720, top_n: int = 20) -> dict:
    """
    Per-symbol breakdown.
    Returns stats for the top_n coins by signal count, plus priority coins.
    """
    pool = await _pool()
    if pool is None:
        return {"error": "Database unavailable", "insufficient_data": True}

    all_rows = await _fetch_outcomes(pool, window_hours)

    # Group by symbol
    by_symbol: dict[str, list[dict]] = {}
    for row in all_rows:
        sym = row.get("symbol") or "UNKNOWN"
        by_symbol.setdefault(sym, []).append(row)

    # Sort by signal count, take top_n plus any priority coins not already included
    priority = set(_TOP_COINS[:top_n])
    by_count = sorted(by_symbol.items(), key=lambda x: len(x[1]), reverse=True)
    included_syms = {s for s, _ in by_count[:top_n]} | priority
    target_rows   = {s: by_symbol[s] for s in included_syms if s in by_symbol}

    coin_stats = {}
    for sym, rows in sorted(target_rows.items(), key=lambda x: len(x[1]), reverse=True):
        stats = group_stats(rows, label=sym)
        coin_stats[sym] = stats

    # Rankings
    def _rank(key: str, reverse: bool = True) -> list[str]:
        return [
            sym for sym, _ in sorted(
                [(s, coin_stats[s].get(key) or float("-inf")) for s in coin_stats
                 if coin_stats[s].get(key) is not None and coin_stats[s]["total"] >= MIN_SAMPLES],
                key=lambda x: x[1],
                reverse=reverse,
            )
        ]

    best_by_winrate     = _rank("win_rate")
    best_by_expectancy  = _rank("expectancy")
    worst_by_drawdown   = _rank("max_drawdown_r")  # highest drawdown = worst

    total = len(all_rows)
    return {
        "window_hours":        window_hours,
        "total_resolved":      total,
        "coins":               coin_stats,
        "best_by_win_rate":    best_by_winrate[:5],
        "best_by_expectancy":  best_by_expectancy[:5],
        "worst_by_drawdown":   worst_by_drawdown[:5],
        "total_symbols_seen":  len(by_symbol),
        "insufficient_data":   not has_data(total),
        "warning":             sample_warning(total),
    }


# ── 7. Threshold Recommendations ─────────────────────────────────────────────

async def threshold_recommendations(
    calibration: dict,
    setup: dict,
    modes: dict,
    regimes: dict,
) -> dict:
    """
    Data-driven threshold recommendations derived from the other analyses.
    """
    recs = {}
    warnings = []

    # ── Confidence threshold ──────────────────────────────────────────────────
    bands = calibration.get("bands", [])
    conf_recs = []
    for b in bands:
        if b.get("total", 0) < MIN_SAMPLES:
            continue
        wr = b.get("win_rate")
        exp = b.get("expectancy")
        if wr is not None and wr >= 0.55 and exp is not None and exp > 0:
            label = b.get("label", "")
            try:
                lo = int(label.split("-")[0])
                conf_recs.append(lo)
            except Exception:
                pass

    if conf_recs:
        recs["min_confidence"] = min(conf_recs)
    else:
        recs["min_confidence"] = None
        warnings.append("Insufficient data to recommend a confidence threshold")

    # ── Quality score threshold ───────────────────────────────────────────────
    recs["min_quality_score"] = setup.get("optimal_threshold")
    if recs["min_quality_score"] is None:
        warnings.append("Insufficient data to recommend a quality_score threshold")

    # ── Mode ranking ──────────────────────────────────────────────────────────
    mode_ranked = modes.get("ranked_by_expectancy", [])
    recs["recommended_modes"] = mode_ranked[:2] if mode_ranked else []
    recs["avoid_modes"] = [
        m for m in (modes.get("modes") or {})
        if (modes.get("modes") or {}).get(m, {}).get("expectancy") is not None
        and (modes.get("modes") or {}).get(m, {}).get("expectancy") < 0
        and (modes.get("modes") or {}).get(m, {}).get("total", 0) >= MIN_SAMPLES
    ]

    # ── Regime avoidance ──────────────────────────────────────────────────────
    recs["avoid_regimes"] = regimes.get("recommended_avoid", [])
    recs["prefer_regimes"] = regimes.get("recommended_prefer", [])

    # ── Calibration verdict ───────────────────────────────────────────────────
    cal = calibration.get("calibration", {})
    ece = cal.get("ece")
    recs["recalibrate_confidence"] = (
        ece is not None and ece >= 0.12
    )
    if recs["recalibrate_confidence"]:
        warnings.append(
            f"Confidence calibration is poor (ECE={ece:.3f}). "
            "Consider tightening the AI prompt or adjusting confidence thresholds."
        )

    return {
        "recommendations": recs,
        "warnings": warnings,
        "note": (
            "Recommendations require ≥10 resolved signals per bucket to be reliable. "
            "Increase your window_hours or let the system accumulate more trades."
        ),
    }


# ── Edge verdict ─────────────────────────────────────────────────────────────

def _edge_verdict(total: int, overall_wr: float | None, overall_exp: float | None) -> dict:
    """Generate an honest top-line edge verdict."""
    if total < 30:
        return {
            "has_edge": None,
            "confidence_level": "insufficient_data",
            "summary": (
                f"Only {total} resolved signals. Need at least 30 to assess edge. "
                "Let the system run longer before drawing conclusions."
            ),
        }

    if overall_wr is None or overall_exp is None:
        return {"has_edge": None, "confidence_level": "insufficient_data", "summary": "Cannot compute."}

    if overall_wr >= 0.55 and overall_exp > 0.3:
        level = "strong" if overall_wr >= 0.62 and overall_exp > 0.5 else "moderate"
        return {
            "has_edge": True,
            "confidence_level": level,
            "summary": (
                f"Win rate {overall_wr:.1%}, expectancy {overall_exp:+.2f}R across {total} signals. "
                f"Edge appears {level}. Continue monitoring for regime changes."
            ),
        }
    elif overall_wr >= 0.50 and overall_exp > 0:
        return {
            "has_edge": True,
            "confidence_level": "weak",
            "summary": (
                f"Win rate {overall_wr:.1%}, expectancy {overall_exp:+.2f}R. "
                "Edge is marginal. Filter tightening (confidence, quality_score) is strongly recommended."
            ),
        }
    else:
        return {
            "has_edge": False,
            "confidence_level": "none",
            "summary": (
                f"Win rate {overall_wr:.1%}, expectancy {overall_exp:+.2f}R. "
                "No detectable edge. Review signal generation logic, thresholds, and market conditions."
            ),
        }


# ── Full report ───────────────────────────────────────────────────────────────

async def generate_edge_validation_report(window_hours: int = 720) -> dict:
    """
    Generate the complete edge validation report from all 7 analyses.
    Runs all async analyses concurrently.
    """
    pool = await _pool()
    if pool is None:
        return {
            "error":             "Database unavailable",
            "insufficient_data": True,
            "window_hours":      window_hours,
        }

    (
        cal_result,
        claude_result,
        setup_result,
        regime_result,
        mode_result,
        coin_result,
        all_rows,
    ) = await asyncio.gather(
        confidence_calibration(window_hours),
        claude_effectiveness(window_hours),
        setup_score_analysis(window_hours),
        market_regime_analysis(window_hours),
        scanner_mode_analysis(window_hours),
        coin_performance(window_hours),
        _fetch_outcomes(pool, window_hours),
        return_exceptions=True,
    )

    # Handle exceptions from any gather branch
    def _safe(v, fallback: dict) -> dict:
        return v if not isinstance(v, Exception) else {**fallback, "error": str(v)}

    cal_result    = _safe(cal_result,    {"insufficient_data": True})
    claude_result = _safe(claude_result, {"insufficient_data": True})
    setup_result  = _safe(setup_result,  {"insufficient_data": True})
    regime_result = _safe(regime_result, {"insufficient_data": True})
    mode_result   = _safe(mode_result,   {"insufficient_data": True})
    coin_result   = _safe(coin_result,   {"insufficient_data": True})
    all_rows      = all_rows if not isinstance(all_rows, Exception) else []

    # Overall stats across all resolved signals
    overall = group_stats(all_rows, label="overall")
    overall_wr  = overall.get("win_rate")
    overall_exp = overall.get("expectancy")

    # Threshold recommendations
    thresh = await threshold_recommendations(cal_result, setup_result, mode_result, regime_result)

    # Edge verdict
    total = len(all_rows)
    verdict = _edge_verdict(total, overall_wr, overall_exp)

    return {
        "report_date":     datetime.now(timezone.utc).isoformat(),
        "window_hours":    window_hours,
        "overall":         overall,
        "edge_verdict":    verdict,
        "confidence_calibration":   cal_result,
        "claude_effectiveness":     claude_result,
        "setup_score_analysis":     setup_result,
        "market_regime_analysis":   regime_result,
        "scanner_mode_analysis":    mode_result,
        "coin_performance":         coin_result,
        "threshold_recommendations": thresh,
    }
