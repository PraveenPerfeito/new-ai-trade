"""
PERFORMANCE.VERIFICATION.1 — analytics-only validation of the Probability
Engine, RiskGrade 2.0, and Edge Matrix.

No scanner changes, no filtering, no gating — this module only measures:
  A. Probability accuracy   — stamped predictions vs realized outcomes, per dimension
  B. Grade validation       — empirical + heuristic grades vs actual WR/exp/PF, inversion detection
  C. Edge stability         — do top cohorts stay top across 7d/30d/90d windows?
  D. Sample quality         — are the n's big enough to trust any of the above?
"""
from __future__ import annotations

from backend.logging.setup import get_logger

log = get_logger(__name__)

MIN_DIM_N    = 10   # per-dimension accuracy cells below this are flagged low-sample
MIN_COHORT_N = 20   # edge-stability cohort floor
GRADE_ORDER  = ["A+", "A", "B+", "B", "C", "D"]


def _stats(rows: list[dict]) -> dict:
    n = len(rows)
    wins = [r for r in rows if r["outcome"] == "TP_HIT"]
    rr = [float(r["rr_achieved"]) for r in rows if r.get("rr_achieved") is not None]
    gp = sum(x for x in rr if x > 0)
    gl = abs(sum(x for x in rr if x < 0))
    return {
        "n": n,
        "wr": round(len(wins) / n * 100, 1) if n else None,
        "exp": round(sum(rr) / len(rr), 3) if rr else None,
        "pf": round(gp / gl, 2) if gl > 0 else None,
    }


def accuracy_by_dimension(rows: list[dict], column: str) -> list[dict]:
    """Predicted (stamped empirical_wr) vs realized WR + drift, per dimension value."""
    groups: dict[str, list[dict]] = {}
    for r in rows:
        key = str(r.get(column)) if r.get(column) is not None else "NULL"
        groups.setdefault(key, []).append(r)

    out = []
    for value, cell in sorted(groups.items()):
        n = len(cell)
        predicted = sum(float(r["empirical_wr"]) for r in cell) / n
        realized = sum(1 for r in cell if r["outcome"] == "TP_HIT") / n * 100
        from backend.analytics.probability import wilson_interval  # noqa: PLC0415
        lo, hi = wilson_interval(realized, n)
        out.append({
            "value": value, "n": n,
            "predicted_wr": round(predicted, 1),
            "actual_wr": round(realized, 1),
            "drift": round(realized - predicted, 1),
            "ci": [lo, hi],
            "calibrated": lo <= predicted <= hi,   # prediction inside realized CI
            "low_sample": n < MIN_DIM_N,
        })
    return out


def grade_table(rows: list[dict], grade_key: str, order: list[str]) -> list[dict]:
    groups: dict[str, list[dict]] = {}
    for r in rows:
        g = r.get(grade_key)
        if g is None:
            continue
        groups.setdefault(str(g), []).append(r)
    return [
        {"grade": g, **_stats(groups[g])}
        for g in order if g in groups
    ]


def detect_inversions(table: list[dict], metric: str = "wr") -> list[str]:
    """
    Grade-inversion detection: a better grade must not UNDERPERFORM a worse
    grade on the metric. Only adjacent populated grades with n ≥ MIN_DIM_N
    are compared. Returns human-readable violation strings.
    """
    violations = []
    usable = [t for t in table if t["n"] >= MIN_DIM_N and t.get(metric) is not None]
    for better, worse in zip(usable, usable[1:]):
        if better[metric] < worse[metric]:
            violations.append(
                f"{better['grade']} {metric}={better[metric]} < {worse['grade']} "
                f"{metric}={worse[metric]} (n={better['n']}/{worse['n']})"
            )
    return violations


def cohort_ranking(rows: list[dict], min_n: int = MIN_COHORT_N, top: int = 10) -> list[dict]:
    """Top regime|type|breakout cohorts by expectancy for one window."""
    groups: dict[str, list[dict]] = {}
    for r in rows:
        key = "|".join(
            str(r.get(c)) if r.get(c) is not None else "NULL"
            for c in ("market_regime", "signal_type", "breakout_strength")
        )
        groups.setdefault(key, []).append(r)
    ranked = [
        {"cohort": k, **_stats(v)}
        for k, v in groups.items() if len(v) >= min_n
    ]
    ranked = [c for c in ranked if c["exp"] is not None]
    ranked.sort(key=lambda c: c["exp"], reverse=True)
    return ranked[:top]


def ranking_overlap(a: list[dict], b: list[dict]) -> dict:
    """Stability of two ranked cohort lists: Jaccard of members + top-3 retention."""
    sa, sb = {c["cohort"] for c in a}, {c["cohort"] for c in b}
    union = sa | sb
    jaccard = round(len(sa & sb) / len(union), 2) if union else None
    top3_a = [c["cohort"] for c in a[:3]]
    top3_b = {c["cohort"] for c in b[:3]}
    top3_retained = sum(1 for c in top3_a if c in top3_b)
    return {"jaccard": jaccard, "top3_retained": top3_retained,
            "a_count": len(a), "b_count": len(b)}


async def compute_performance_verification() -> dict:
    from backend.database.session import get_pool
    from backend.analytics.probability import empirical_grade, evaluate, get_probability_lookup
    pool = await get_pool()

    # ── A. Probability accuracy (stamped predictions joined to outcomes) ─────
    acc_rows = [dict(r) for r in await pool.fetch(
        """
        SELECT s.empirical_wr, s.empirical_grade, s.market_regime, s.risk_grade,
               s.breakout_strength, s.type AS signal_type, s.scanner_mode, o.outcome
        FROM signals s JOIN signal_outcomes o ON o.signal_id = s.id
        WHERE s.empirical_wr IS NOT NULL AND o.outcome IN ('TP_HIT','SL_HIT')
        """
    )]
    n_acc = len(acc_rows)
    overall = None
    if n_acc:
        predicted = sum(float(r["empirical_wr"]) for r in acc_rows) / n_acc
        realized = sum(1 for r in acc_rows if r["outcome"] == "TP_HIT") / n_acc * 100
        mae = sum(abs(float(r["empirical_wr"]) / 100 - (1 if r["outcome"] == "TP_HIT" else 0))
                  for r in acc_rows) / n_acc
        overall = {"n": n_acc, "predicted_wr": round(predicted, 1),
                   "actual_wr": round(realized, 1), "drift": round(realized - predicted, 1),
                   "mean_abs_error": round(mae, 3)}

    accuracy = {
        "overall": overall,
        "by_regime":   accuracy_by_dimension(acc_rows, "market_regime"),
        "by_grade":    accuracy_by_dimension(acc_rows, "risk_grade"),
        "by_breakout": accuracy_by_dimension(acc_rows, "breakout_strength"),
        "by_type":     accuracy_by_dimension(acc_rows, "signal_type"),
        "by_mode":     accuracy_by_dimension(acc_rows, "scanner_mode"),
    }

    # ── B. Grade validation ───────────────────────────────────────────────────
    # Stamped empirical grades resolve slowly (stamping just began) — derive the
    # grade each historical outcome WOULD receive from the current engine so the
    # validation has sample size today.  Stamped-grade table shown alongside.
    out_rows = [dict(r) for r in await pool.fetch(
        """
        SELECT outcome, rr_achieved, market_regime, signal_type, breakout_strength, risk_grade
        FROM signal_outcomes
        WHERE outcome IN ('TP_HIT','SL_HIT') AND created_at > NOW() - INTERVAL '30 days'
        """
    )]
    lookup = await get_probability_lookup()
    for r in out_rows:
        cohort = evaluate(lookup, market_regime=r["market_regime"],
                          signal_type=r["signal_type"],
                          breakout_strength=r["breakout_strength"]) if lookup else None
        r["derived_grade"] = empirical_grade(cohort.exp, cohort.n) if cohort else None

    empirical_table = grade_table(out_rows, "derived_grade", GRADE_ORDER)
    heuristic_table = grade_table(out_rows, "risk_grade", ["A", "B", "C", "D", "F"])

    grades = {
        "empirical": empirical_table,
        "empirical_inversions_wr":  detect_inversions(empirical_table, "wr"),
        "empirical_inversions_exp": detect_inversions(empirical_table, "exp"),
        "heuristic": heuristic_table,
        "heuristic_inversions_wr":  detect_inversions(heuristic_table, "wr"),
        "note": "empirical = grade each outcome's cohort would receive from the current engine (in-sample); stamped grades accumulate live",
    }

    # ── C. Edge stability across windows ─────────────────────────────────────
    windows: dict[str, list[dict]] = {}
    for label, days in (("d7", 7), ("d30", 30), ("d90", 90)):
        w_rows = [dict(r) for r in await pool.fetch(
            """
            SELECT outcome, rr_achieved, market_regime, signal_type, breakout_strength
            FROM signal_outcomes
            WHERE outcome IN ('TP_HIT','SL_HIT')
              AND created_at > NOW() - make_interval(days => $1)
            """, days,
        )]
        windows[label] = w_rows

    rank7, rank30, rank90 = (cohort_ranking(windows[k]) for k in ("d7", "d30", "d90"))

    def regime_dist(rows: list[dict]) -> dict:
        d: dict[str, int] = {}
        for r in rows:
            k = str(r.get("market_regime")) if r.get("market_regime") is not None else "NULL"
            d[k] = d.get(k, 0) + 1
        return d

    stability = {
        "top_cohorts": {"d7": rank7, "d30": rank30, "d90": rank90},
        "overlap_7v30":  ranking_overlap(rank7, rank30),
        "overlap_30v90": ranking_overlap(rank30, rank90),
        "regime_distribution": {k: regime_dist(v) for k, v in windows.items()},
    }

    # ── D. Sample quality ─────────────────────────────────────────────────────
    sq = await pool.fetchrow(
        """
        SELECT
          (SELECT count(*) FROM signals WHERE empirical_wr IS NOT NULL)     AS stamped_total,
          (SELECT count(*) FROM signals s JOIN signal_outcomes o ON o.signal_id = s.id
            WHERE s.empirical_wr IS NOT NULL AND o.outcome != 'PENDING')    AS stamped_resolved,
          (SELECT count(*) FROM signals WHERE empirical_grade IS NOT NULL)  AS graded_total
        """
    )
    sample_quality = {
        **dict(sq),
        "resolved_target_for_gate_promotion": 200,
        "per_grade_target_for_riskgrade_promotion": 30,
        "warnings": [],
    }
    if n_acc < 50:
        sample_quality["warnings"].append(
            f"Only {n_acc} resolved stamped signals — accuracy metrics are early; re-verify at 200+."
        )
    regimes_30d = set(regime_dist(windows["d30"]).keys()) - {"NULL", "None"}
    if len(regimes_30d) <= 1:
        sample_quality["warnings"].append(
            f"30d window covers a single regime ({', '.join(regimes_30d) or 'none'}) — all validations are regime-conditional."
        )

    return {
        "accuracy": accuracy,
        "grades": grades,
        "stability": stability,
        "sample_quality": sample_quality,
        "note": "READ-ONLY verification — no scanner changes, no filtering, no gating.",
    }
