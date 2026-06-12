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

LOOKUP_HIERARCHY = ("regime|type|breakout", "regime|type", "regime")

_cache: dict = {"at": 0.0, "lookup": None}


def _label(value) -> str:
    """Match outcome_learning._raw() labeling so keys align with snapshots."""
    return str(value) if value is not None else "NULL"


async def get_probability_lookup() -> dict:
    """
    Load the latest snapshot generation (30d window) for the lookup dimension
    keys.  Returns {(dim_key, dim_value): {"wr": float, "n": int}}; {} on any
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
            SELECT DISTINCT ON (dim_key, dim_value) dim_key, dim_value, n, wr
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
                lookup[(r["dim_key"], r["dim_value"])] = {"wr": float(r["wr"]), "n": int(r["n"])}
    except Exception as exc:
        log.debug("probability_lookup_load_failed", error=str(exc))

    _cache["lookup"] = lookup
    _cache["at"] = now
    return lookup


def lookup_empirical(
    lookup: dict,
    market_regime: str | None,
    signal_type: str | None,
    breakout_strength: str | None,
) -> "tuple[float | None, int]":
    """Most-specific cohort win rate for the signal's context; (None, 0) if no cohort has n ≥ MIN_N."""
    r, t, b = _label(market_regime), _label(signal_type), _label(breakout_strength)
    for dim_key, dim_value in (
        ("regime|type|breakout", f"{r}|{t}|{b}"),
        ("regime|type",          f"{r}|{t}"),
        ("regime",               r),
    ):
        hit = lookup.get((dim_key, dim_value))
        if hit is not None:
            return hit["wr"], hit["n"]
    return None, 0


def should_suppress_send(enabled: bool, empirical_wr: float | None, threshold: float) -> bool:
    """
    Delivery-gate decision (PHASE.9.1).  Suppress ONLY when the gate is enabled
    AND the signal has a known cohort win rate below the threshold.  Unknown
    probability (no cohort with n ≥ MIN_N) always delivers — the gate must
    never punish missing data.
    """
    return bool(enabled and empirical_wr is not None and empirical_wr < threshold)


async def persist_empirical(signal_id: str, empirical_wr: float | None, empirical_n: int | None) -> None:
    """
    Best-effort write of the stamped probability to the signals row.
    Tolerates a missing column (migration not yet run) — failure is debug-logged
    and never affects the signal itself.
    """
    if signal_id is None or empirical_wr is None:
        return
    try:
        from backend.database.session import get_pool
        pool = await get_pool()
        await pool.execute(
            "UPDATE signals SET empirical_wr = $1, empirical_n = $2 WHERE id = $3::uuid",
            empirical_wr, empirical_n, signal_id,
        )
    except Exception as exc:
        log.debug("persist_empirical_failed", signal_id=signal_id, error=str(exc))
