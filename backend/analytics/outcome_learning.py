"""
ATTRIBUTION.SNAPSHOTS.1 — outcome-based intelligence foundation.

Nightly aggregation of resolved signal_outcomes into attribution_snapshots:
per-dimension (and combination) win rate / expectancy / profit factor over
7d and 30d windows.  Downstream consumers (Phase 9.1+): probability lookup,
confidence calibration, empirical grades, Edge Matrix dashboard.

Pure SQL + Python aggregation.  No ML, no model training, no vector stores.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from backend.logging.setup import get_logger

log = get_logger(__name__)

WINDOWS_DAYS = (7, 30)
MIN_CELL_N   = 10      # cells below this sample size are statistically useless
RETENTION_DAYS = 90    # snapshot rows older than this are pruned nightly

# Confidence bands — unified with CONFIDENCE.CALIBRATION.2 spec banding so
# snapshot trend history keys match the calibration API forever.
_CONF_BANDS = [(0, 80, "<80"), (80, 85, "80-84"), (85, 90, "85-89"), (90, 95, "90-94"), (95, 101, "95-100")]


def conf_band(value) -> str:
    if value is None:
        return "NULL"
    v = float(value)
    for lo, hi, label in _CONF_BANDS:
        if lo <= v < hi:
            return label
    return "out"


def trend_tier(score) -> str:
    if score is None:
        return "NULL"
    s = float(score)
    if s >= 85:
        return "ELITE"
    if s >= 70:
        return "STRONG"
    if s >= 50:
        return "GOOD"
    return "WEAK"


def _raw(value) -> str:
    return str(value) if value is not None else "NULL"


# Dimension sets: dim_key → list of (column, transform) tuples.
# Keys are stable identifiers — downstream lookups depend on them.
DIMENSION_SETS: dict[str, list[tuple[str, object]]] = {
    # Singles
    "regime":      [("market_regime", _raw)],
    "grade":       [("risk_grade", _raw)],
    "breakout":    [("breakout_strength", _raw)],
    "oi":          [("oi_interpretation", _raw)],
    "funding":     [("funding_trend", _raw)],
    "positioning": [("positioning_context", _raw)],
    "trend_tier":  [("trend_score", trend_tier)],
    "conf_band":   [("confidence", conf_band)],
    "mode":        [("scanner_mode", _raw)],
    "type":        [("signal_type", _raw)],
    # Pairs
    "regime|type":     [("market_regime", _raw), ("signal_type", _raw)],
    "regime|grade":    [("market_regime", _raw), ("risk_grade", _raw)],
    "regime|conf_band": [("market_regime", _raw), ("confidence", conf_band)],
    "grade|breakout":  [("risk_grade", _raw), ("breakout_strength", _raw)],
    "breakout|oi":     [("breakout_strength", _raw), ("oi_interpretation", _raw)],
    "regime|breakout": [("market_regime", _raw), ("breakout_strength", _raw)],
    # CONFIDENCE.CALIBRATION.2 — per-mode / per-type drift trend history
    "mode|conf_band":  [("scanner_mode", _raw), ("confidence", conf_band)],
    "type|conf_band":  [("signal_type", _raw), ("confidence", conf_band)],
    # Triple — the probability-lookup primary key
    "regime|type|breakout": [("market_regime", _raw), ("signal_type", _raw), ("breakout_strength", _raw)],
    # PHASE.9.P1.PROBABILITY.ENGINE.1 — global fallback level + Edge Matrix pairs
    "global":              [("outcome", lambda v: "ALL")],
    "trend_tier|breakout": [("trend_score", trend_tier), ("breakout_strength", _raw)],
    "sector|funding":      [("sector_status", _raw), ("funding_trend", _raw)],
    "oi|positioning":      [("oi_interpretation", _raw), ("positioning_context", _raw)],
}


def _cell_stats(rows: list[dict]) -> dict:
    tp = sum(1 for r in rows if r["outcome"] == "TP_HIT")
    sl = sum(1 for r in rows if r["outcome"] == "SL_HIT")
    rr = [float(r["rr_achieved"]) for r in rows if r["rr_achieved"] is not None]
    exp = round(sum(rr) / len(rr), 4) if rr else None
    gp = sum(x for x in rr if x > 0)
    gl = abs(sum(x for x in rr if x < 0))
    pf = round(gp / gl, 4) if gl > 0 else None
    wr = round(tp / (tp + sl) * 100, 2) if (tp + sl) else None
    return {"n": len(rows), "tp": tp, "sl": sl, "wr": wr, "exp": exp, "pf": pf}


def aggregate_rows(rows: list[dict], window_days: int) -> list[tuple]:
    """
    Pure aggregation: outcome rows → snapshot tuples
    (window_days, dim_key, dim_value, n, tp, sl, wr, exp, pf).
    Cells with n < MIN_CELL_N are dropped.
    """
    out: list[tuple] = []
    for dim_key, spec in DIMENSION_SETS.items():
        groups: dict[str, list[dict]] = {}
        for r in rows:
            parts = [fn(r.get(col)) for col, fn in spec]  # type: ignore[operator]
            groups.setdefault("|".join(parts), []).append(r)
        for dim_value, cell in groups.items():
            if len(cell) < MIN_CELL_N:
                continue
            s = _cell_stats(cell)
            out.append((window_days, dim_key, dim_value,
                        s["n"], s["tp"], s["sl"], s["wr"], s["exp"], s["pf"]))
    return out


async def compute_snapshots() -> dict:
    """
    Fetch resolved outcomes for each window, aggregate all dimension sets,
    insert one snapshot generation, prune old generations.
    Feature-flagged: FeatureFlags.attribution_snapshots.
    """
    try:
        from backend.system_settings.service import get_settings_service
        from backend.system_settings.groups import FeatureFlags
        flags = await get_settings_service().get_group(FeatureFlags)
        if not flags.attribution_snapshots:
            return {"skipped": True, "reason": "flag_disabled"}
    except Exception as exc:
        log.warning("snapshot_flag_read_failed", error=str(exc))

    from backend.database.session import get_pool
    pool = await get_pool()

    now = datetime.now(timezone.utc)
    inserted_total = 0

    for window in WINDOWS_DAYS:
        rows = [dict(r) for r in await pool.fetch(
            """
            SELECT outcome, rr_achieved, confidence, risk_grade, market_regime,
                   breakout_strength, oi_interpretation, funding_trend,
                   positioning_context, trend_score, scanner_mode, signal_type
            FROM signal_outcomes
            WHERE outcome IN ('TP_HIT', 'SL_HIT')
              AND created_at > $1
            """,
            now - timedelta(days=window),
        )]
        tuples = aggregate_rows(rows, window)
        if tuples:
            try:
                await pool.executemany(
                    """
                    INSERT INTO attribution_snapshots
                        (window_days, dim_key, dim_value, n, tp, sl, wr, exp, pf)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                    """,
                    tuples,
                )
            except Exception as exc:
                log.warning("snapshot_insert_failed", window_days=window, error=str(exc))
                tuples = []
        inserted_total += len(tuples)
        log.info("attribution_snapshot_window_done", window_days=window,
                 outcomes=len(rows), cells=len(tuples))

    # Retention pruning
    try:
        await pool.execute(
            "DELETE FROM attribution_snapshots WHERE computed_at < NOW() - INTERVAL '90 days'"
        )
    except Exception as exc:
        log.warning("snapshot_prune_failed", error=str(exc))

    return {"skipped": False, "cells_inserted": inserted_total, "windows": list(WINDOWS_DAYS)}
