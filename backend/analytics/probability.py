"""
PHASE.9.1 — empirical probability lookup (Probability Engine, first production use).

Resolves a signal's historical win probability from the nightly
attribution_snapshots aggregates (ATTRIBUTION.SNAPSHOTS.1), most-specific
context first:

    regime|type|breakout  →  regime|type  →  regime

Every level requires n ≥ MIN_N resolved outcomes.  The lookup table is cached
in-process for an hour (snapshots regenerate nightly, so staleness is bounded
and harmless).  All failure paths return "no data" — the caller treats that as
"do not gate", so a missing table / cold cache can never block delivery.
"""
from __future__ import annotations

import time

from backend.logging.setup import get_logger

log = get_logger(__name__)

MIN_N           = 30
_CACHE_TTL_S    = 3600.0
_EMPTY_RETRY_S  = 300.0   # retry sooner when the last load failed / was empty

# PHASE.9.P1.PROBABILITY.ENGINE.1 — 5-level hierarchy, most-specific first.
LOOKUP_HIERARCHY = ("regime|type|breakout", "regime|type", "regime", "conf_band", "global")

_cache: dict = {"at": 0.0, "lookup": None}


def _label(value) -> str:
    """Match outcome_learning._raw() labeling so keys align with snapshots."""
    return str(value) if value is not None else "NULL"


def wilson_interval(wr_pct: float, n: int, z: float = 1.96) -> "tuple[float, float]":
    """95% Wilson score interval for a win-rate percentage. Pure math, no ML."""
    if n <= 0:
        return (0.0, 100.0)
    p = wr_pct / 100.0
    denom  = 1 + z * z / n
    center = (p + z * z / (2 * n)) / denom
    margin = (z * ((p * (1 - p) / n + z * z / (4 * n * n)) ** 0.5)) / denom
    return (round(max(0.0, center - margin) * 100, 1), round(min(1.0, center + margin) * 100, 1))


class CohortStats:
    """One resolved cohort from attribution_snapshots."""
    __slots__ = ("wr", "exp", "pf", "n", "level", "ci_low", "ci_high")

    def __init__(self, wr: float, exp: float | None, pf: float | None, n: int, level: str):
        self.wr, self.exp, self.pf, self.n, self.level = wr, exp, pf, n, level
        self.ci_low, self.ci_high = wilson_interval(wr, n)

    def as_dict(self) -> dict:
        return {"probability_of_win": self.wr, "expectancy": self.exp,
                "profit_factor": self.pf, "sample_size": self.n,
                "confidence_interval": [self.ci_low, self.ci_high], "level": self.level}


async def get_probability_lookup() -> dict:
    """
    Load the latest snapshot generation (30d window) for the lookup dimension
    keys.  Returns {(dim_key, dim_value): {"wr","exp","pf","n"}}; {} on any
    failure or before the first nightly generation exists.
    """
    now = time.monotonic()
    cached = _cache["lookup"]
    age = now - _cache["at"]
    if cached is not None and age < (_CACHE_TTL_S if cached else _EMPTY_RETRY_S):
        return cached

    lookup: dict = {}
    try:
        from backend.database.session import get_pool
        pool = await get_pool()
        rows = await pool.fetch(
            """
            SELECT DISTINCT ON (dim_key, dim_value) dim_key, dim_value, n, wr, exp, pf
            FROM attribution_snapshots
            WHERE window_days = 30
              AND dim_key = ANY($1::text[])
              AND computed_at > NOW() - INTERVAL '48 hours'
            ORDER BY dim_key, dim_value, computed_at DESC
            """,
            list(LOOKUP_HIERARCHY),
        )
        for r in rows:
            if r["n"] is not None and r["n"] >= MIN_N and r["wr"] is not None:
                lookup[(r["dim_key"], r["dim_value"])] = {
                    "wr": float(r["wr"]), "n": int(r["n"]),
                    "exp": float(r["exp"]) if r["exp"] is not None else None,
                    "pf": float(r["pf"]) if r["pf"] is not None else None,
                }
    except Exception as exc:
        log.debug("probability_lookup_load_failed", error=str(exc))

    _cache["lookup"] = lookup
    _cache["at"] = now
    return lookup


def _conf_band(confidence) -> str:
    from backend.analytics.outcome_learning import conf_band  # noqa: PLC0415
    return conf_band(confidence)


def evaluate(
    lookup: dict,
    *,
    market_regime: str | None,
    signal_type: str | None,
    breakout_strength: str | None,
    confidence: int | None = None,
) -> "CohortStats | None":
    """
    PHASE.9.P1 ProbabilityEngine core — resolve the most specific cohort with
    n ≥ MIN_N for a signal's context.  Hierarchy:
      regime|type|breakout → regime|type → regime → conf_band → global
    Returns None when no level has enough data (caller must never gate then).
    """
    r, t, b = _label(market_regime), _label(signal_type), _label(breakout_strength)
    candidates = [
        ("regime|type|breakout", f"{r}|{t}|{b}"),
        ("regime|type",          f"{r}|{t}"),
        ("regime",               r),
    ]
    if confidence is not None:
        candidates.append(("conf_band", _conf_band(confidence)))
    candidates.append(("global", "ALL"))

    for dim_key, dim_value in candidates:
        hit = lookup.get((dim_key, dim_value))
        if hit is not None:
            return CohortStats(hit["wr"], hit.get("exp"), hit.get("pf"), hit["n"], dim_key)
    return None


def lookup_empirical(
    lookup: dict,
    market_regime: str | None,
    signal_type: str | None,
    breakout_strength: str | None,
) -> "tuple[float | None, int]":
    """Backward-compatible (wr, n) wrapper over evaluate()."""
    stats = evaluate(lookup, market_regime=market_regime, signal_type=signal_type,
                     breakout_strength=breakout_strength)
    return (stats.wr, stats.n) if stats else (None, 0)


# ── RiskGrade 2.0 (PHASE.9.P1 Phase C) — outcome-derived grade bins ──────────
# Bins on cohort EXPECTANCY (mean realized R), per PHASE.9 §8 design.
EMPIRICAL_GRADE_BINS: "list[tuple[float, str]]" = [
    (1.00, "A+"), (0.60, "A"), (0.35, "B+"), (0.15, "B"), (0.00, "C"),
]


def empirical_grade(expectancy: float | None, n: int) -> str | None:
    """Grade from outcome history. None when the cohort is too thin to grade."""
    if expectancy is None or n < MIN_N:
        return None
    for floor, grade in EMPIRICAL_GRADE_BINS:
        if expectancy >= floor:
            return grade
    return "D"


def should_suppress_send(
    enabled: bool,
    empirical_wr: float | None,
    threshold: float,
    *,
    expectancy_filter: bool = False,
    empirical_exp: float | None = None,
    min_expectancy: float = 0.0,
) -> bool:
    """
    Delivery-gate decision (PHASE.9.1).  Suppress ONLY when the gate is enabled
    AND the signal has a known cohort win rate below the threshold — OR, when
    the probability_gate_v1 expectancy filter is on, a known cohort expectancy
    below min_expectancy.  Unknown probability/expectancy (no cohort with
    n ≥ MIN_N) always delivers — the gate must never punish missing data.
    """
    if not enabled:
        return False
    if empirical_wr is not None and empirical_wr < threshold:
        return True
    if expectancy_filter and empirical_exp is not None and empirical_exp < min_expectancy:
        return True
    return False


async def persist_empirical(
    signal_id: str,
    empirical_wr: float | None,
    empirical_n: int | None,
    empirical_grade_value: str | None = None,
) -> None:
    """
    Best-effort write of the stamped probability (+ RiskGrade 2.0 shadow grade)
    to the signals row.  Tolerates missing columns (migrations not yet run) —
    failure is debug-logged and never affects the signal itself.
    """
    if signal_id is None or empirical_wr is None:
        return
    try:
        from backend.database.session import get_pool
        pool = await get_pool()
        try:
            await pool.execute(
                """UPDATE signals SET empirical_wr = $1, empirical_n = $2,
                          empirical_grade = $3 WHERE id = $4::uuid""",
                empirical_wr, empirical_n, empirical_grade_value, signal_id,
            )
        except Exception as col_exc:
            if "empirical_grade" not in str(col_exc):
                raise
            await pool.execute(
                "UPDATE signals SET empirical_wr = $1, empirical_n = $2 WHERE id = $3::uuid",
                empirical_wr, empirical_n, signal_id,
            )
    except Exception as exc:
        log.debug("persist_empirical_failed", signal_id=signal_id, error=str(exc))
