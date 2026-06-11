"""
CONFIDENCE.CALIBRATION.2 — read-only empirical confidence measurement.

Converts heuristic confidence into MEASURED historical probability without
touching production scoring: every function here reads signal_outcomes /
attribution_snapshots and computes; nothing writes to the signal path.

Audit basis (30d, n=1,809): stated 95-100 delivers 35.5% WR (44.2% in the
regime-known cohort) while stated 85-89 delivers 42.1% (57.6% clean) —
confidence behaves as a ranking score, not a probability.

Phase G foundation: build_empirical_lookup() / empirical_confidence_for()
are the reusable hierarchical-probability structures for the Probability
Engine, RiskGrade 2.0, Edge Matrix, and Outcome Learning (Phase 9.1+).
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from backend.logging.setup import get_logger

log = get_logger(__name__)

# Spec bands (CONFIDENCE.CALIBRATION.2): <80 catch-all + four canonical bands.
BANDS: list[tuple[int, int, str]] = [
    (0, 80, "<80"),
    (80, 85, "80-84"),
    (85, 90, "85-89"),
    (90, 95, "90-94"),
    (95, 101, "95-100"),
]

MIN_RELIABLE_N = 30    # bands/cells below this are flagged low-confidence
MIN_CELL_N     = 10    # cells below this are suppressed entirely


def band_of(confidence) -> str:
    if confidence is None:
        return "NULL"
    v = float(confidence)
    for lo, hi, label in BANDS:
        if lo <= v < hi:
            return label
    return "out"


def band_stats(rows: list[dict]) -> dict:
    """n / wr / exp / pf / avg winner / avg loser / mean stated confidence."""
    wins   = [float(r["rr_achieved"]) for r in rows
              if r["outcome"] == "TP_HIT" and r["rr_achieved"] is not None]
    losses = [float(r["rr_achieved"]) for r in rows
              if r["outcome"] == "SL_HIT" and r["rr_achieved"] is not None]
    confs  = [float(r["confidence"]) for r in rows if r["confidence"] is not None]
    rr = wins + losses
    gp, gl = sum(wins), abs(sum(losses))
    resolved = len(wins) + len(losses)
    return {
        "n":           len(rows),
        "wr":          round(len(wins) / resolved * 100, 1) if resolved else None,
        "exp":         round(sum(rr) / len(rr), 3) if rr else None,
        "pf":          round(gp / gl, 2) if gl > 0 else None,
        "avg_winner":  round(sum(wins) / len(wins), 3) if wins else None,
        "avg_loser":   round(sum(losses) / len(losses), 3) if losses else None,
        "mean_stated": round(sum(confs) / len(confs), 1) if confs else None,
        "low_sample":  len(rows) < MIN_RELIABLE_N,
    }


def _group(rows: list[dict], keyfn) -> dict[str, list[dict]]:
    g: dict[str, list[dict]] = {}
    for r in rows:
        g.setdefault(keyfn(r), []).append(r)
    return g


def compute_band_table(rows: list[dict]) -> dict[str, dict]:
    """Per-band stats + calibration drift (empirical WR − mean stated confidence)."""
    table: dict[str, dict] = {}
    for band, cell in sorted(_group(rows, lambda r: band_of(r.get("confidence"))).items()):
        s = band_stats(cell)
        s["empirical_confidence"] = round(s["wr"]) if s["wr"] is not None else None
        s["drift"] = (
            round(s["wr"] - s["mean_stated"], 1)
            if s["wr"] is not None and s["mean_stated"] is not None else None
        )
        table[band] = s
    return table


def compute_dimension_drift(rows: list[dict], column: str) -> dict[str, dict]:
    """band table per dimension value (regime / signal_type / scanner_mode)."""
    out: dict[str, dict] = {}
    for value, sub in sorted(_group(rows, lambda r: str(r.get(column))).items()):
        bands = {
            b: s for b, s in compute_band_table(sub).items()
            if s["n"] >= MIN_CELL_N
        }
        if bands:
            out[value] = bands
    return out


def compute_insights(band_table: dict[str, dict]) -> dict:
    """Founder insights — only bands with reliable samples participate."""
    reliable = {
        b: s for b, s in band_table.items()
        if not s["low_sample"] and s["wr"] is not None and s["drift"] is not None
        and b != "NULL"
    }
    if not reliable:
        return {"insufficient_data": True}
    most_overrated  = min(reliable.items(), key=lambda kv: kv[1]["drift"])
    most_underrated = max(reliable.items(), key=lambda kv: kv[1]["drift"])
    best_actual     = max(reliable.items(), key=lambda kv: kv[1]["wr"])
    worst_actual    = min(reliable.items(), key=lambda kv: kv[1]["wr"])
    return {
        "insufficient_data": False,
        "most_overrated":  {"band": most_overrated[0],  **most_overrated[1]},
        "most_underrated": {"band": most_underrated[0], **most_underrated[1]},
        "best_actual":     {"band": best_actual[0],     **best_actual[1]},
        "worst_actual":    {"band": worst_actual[0],    **worst_actual[1]},
    }


# ── Phase G — hierarchical empirical lookup (Probability Engine foundation) ──

def build_empirical_lookup(rows: list[dict]) -> dict[str, dict]:
    """
    Hierarchical win-probability lookup keyed by progressively coarser context:
      L1  band|regime|type   (most specific)
      L2  band|regime
      L3  band
      L4  __global__
    Each level keeps only cells with n ≥ MIN_RELIABLE_N.  Reused by the future
    Probability Engine / RiskGrade 2.0 / Edge Matrix — read-only here.
    """
    levels: dict[str, dict[str, list[dict]]] = {"L1": {}, "L2": {}, "L3": {}}
    for r in rows:
        b  = band_of(r.get("confidence"))
        rg = str(r.get("market_regime"))
        ty = str(r.get("signal_type"))
        levels["L1"].setdefault(f"{b}|{rg}|{ty}", []).append(r)
        levels["L2"].setdefault(f"{b}|{rg}", []).append(r)
        levels["L3"].setdefault(b, []).append(r)

    lookup: dict[str, dict] = {}
    for level, groups in levels.items():
        lookup[level] = {
            key: {"wr": s["wr"], "n": s["n"]}
            for key, cell in groups.items()
            if (s := band_stats(cell))["n"] >= MIN_RELIABLE_N and s["wr"] is not None
        }
    g = band_stats(rows)
    lookup["L4"] = {"__global__": {"wr": g["wr"], "n": g["n"]}}
    return lookup


def empirical_confidence_for(
    confidence,
    market_regime: str | None,
    signal_type: str | None,
    lookup: dict[str, dict],
) -> dict:
    """Resolve empirical confidence via the most specific level with data."""
    b = band_of(confidence)
    candidates = [
        ("L1", f"{b}|{market_regime}|{signal_type}"),
        ("L2", f"{b}|{market_regime}"),
        ("L3", b),
        ("L4", "__global__"),
    ]
    for level, key in candidates:
        hit = lookup.get(level, {}).get(key)
        if hit and hit.get("wr") is not None:
            return {
                "empirical_confidence": round(hit["wr"]),
                "level": level,
                "n": hit["n"],
                "stated": confidence,
            }
    return {"empirical_confidence": None, "level": None, "n": 0, "stated": confidence}


# ── Data quality (Phase H) ────────────────────────────────────────────────────

async def _data_quality(pool, rows: list[dict], now: datetime) -> dict:
    pending = stale_pending = snapshot_gens = 0
    try:
        pending = await pool.fetchval(
            "SELECT COUNT(*) FROM signal_outcomes WHERE outcome = 'PENDING'") or 0
        stale_pending = await pool.fetchval(
            """SELECT COUNT(*) FROM signal_outcomes
               WHERE outcome = 'PENDING' AND created_at < NOW() - INTERVAL '3 days'""") or 0
    except Exception as exc:
        log.warning("calibration_pending_check_failed", error=str(exc))
    try:
        snapshot_gens = await pool.fetchval(
            """SELECT COUNT(DISTINCT date_trunc('day', computed_at))
               FROM attribution_snapshots WHERE dim_key = 'conf_band'""") or 0
    except Exception:
        snapshot_gens = 0   # table may not exist yet (migration pending)

    null_regime = sum(1 for r in rows if not r.get("market_regime"))
    regimes     = {str(r.get("market_regime")) for r in rows if r.get("market_regime")}
    warnings: list[str] = []
    if rows and null_regime / len(rows) > 0.2:
        warnings.append(
            f"{round(null_regime / len(rows) * 100)}% of outcomes have NULL market_regime "
            "(pre-ALPHA.TRUTH.1 era) — global stats are contaminated; prefer the regime-known cohort."
        )
    if len(regimes) <= 1:
        warnings.append(
            f"Outcome window covers a single regime ({next(iter(regimes), 'none')}) — "
            "calibration is regime-conditional, not universal. Re-validate after a regime change."
        )
    if snapshot_gens < 7:
        warnings.append(
            f"Only {snapshot_gens} nightly snapshot generation(s) — trend history needs ≥7 days."
        )
    return {
        "total_resolved":     len(rows),
        "pending_outcomes":   int(pending),
        "stale_pending":      int(stale_pending),
        "null_regime_count":  null_regime,
        "null_regime_pct":    round(null_regime / len(rows) * 100, 1) if rows else 0.0,
        "regimes_observed":   sorted(regimes),
        "snapshot_generations": int(snapshot_gens),
        "min_reliable_n":     MIN_RELIABLE_N,
        "warnings":           warnings,
        "low_sample_bands":   [],   # filled by compute_confidence_calibration
    }


# ── Trend history (from attribution_snapshots) ───────────────────────────────

async def _trend_history(pool, days: int = 30) -> list[dict]:
    """Per-day, per-band WR generations from the nightly snapshot task."""
    try:
        rows = await pool.fetch(
            """
            SELECT date_trunc('day', computed_at) AS day, dim_value AS band,
                   n, wr, exp, pf
            FROM attribution_snapshots
            WHERE dim_key = 'conf_band' AND window_days = 7
              AND computed_at > NOW() - make_interval(days => $1)
            ORDER BY day ASC
            """,
            days,
        )
        return [
            {"day": str(r["day"].date()), "band": r["band"], "n": r["n"],
             "wr": float(r["wr"]) if r["wr"] is not None else None,
             "exp": float(r["exp"]) if r["exp"] is not None else None}
            for r in rows
        ]
    except Exception:
        return []   # table absent or empty — trend simply unavailable yet


# ── Main entry ────────────────────────────────────────────────────────────────

async def compute_confidence_calibration(window_hours: int = 720) -> dict:
    """Full read-only calibration report consumed by the analytics API."""
    from backend.database.session import get_pool
    pool = await get_pool()
    now = datetime.now(timezone.utc)

    rows = [dict(r) for r in await pool.fetch(
        """
        SELECT outcome, rr_achieved, confidence, market_regime, signal_type, scanner_mode
        FROM signal_outcomes
        WHERE outcome IN ('TP_HIT', 'SL_HIT')
          AND created_at > $1
        """,
        now - timedelta(hours=window_hours),
    )]

    clean = [r for r in rows if r.get("market_regime")]
    band_table       = compute_band_table(rows)
    band_table_clean = compute_band_table(clean)

    quality = await _data_quality(pool, rows, now)
    quality["low_sample_bands"] = [b for b, s in band_table.items() if s["low_sample"]]

    return {
        "enabled":              True,
        "window_hours":         window_hours,
        "generated_at":         now.isoformat(),
        "bands":                band_table,
        "bands_regime_known":   band_table_clean,
        "drift_by_regime":      compute_dimension_drift(rows, "market_regime"),
        "drift_by_type":        compute_dimension_drift(rows, "signal_type"),
        "drift_by_mode":        compute_dimension_drift(rows, "scanner_mode"),
        "insights":             compute_insights(band_table_clean if clean else band_table),
        "trend_history":        await _trend_history(pool),
        "empirical_lookup_levels": {
            level: len(cells) for level, cells in build_empirical_lookup(rows).items()
        },
        "data_quality":         quality,
        "note": (
            "READ-ONLY analytics. Production confidence, scoring, gating and "
            "delivery are unchanged. Empirical confidence = measured historical "
            "win probability for the signal's band/context."
        ),
    }
