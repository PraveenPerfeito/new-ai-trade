"""
PHASE.9.P1 Phase H — 30d simulation: current system vs probability gate.

1. Re-seeds attribution snapshots (so the new global/pair dims exist now).
2. Builds cohort stats from the last 30d of resolved outcomes.
3. Simulates delivery under: baseline / WR>=45 gate / WR>=45 AND exp>=0 gate.
In-sample caveat: cohorts are derived from the same window they filter —
treat deltas as upper bounds; live shadow data (stamped empirical_wr) is the
out-of-sample validator over the coming weeks.
"""
from __future__ import annotations

import asyncio
import sys
from collections import defaultdict

sys.path.insert(0, ".")

MIN_N = 30


def stats(rows):
    n = len(rows)
    if n == 0:
        return {"n": 0, "wr": None, "exp": None, "pf": None}
    wins = [r for r in rows if r["outcome"] == "TP_HIT"]
    rr = [float(r["rr_achieved"]) for r in rows if r["rr_achieved"] is not None]
    gp = sum(x for x in rr if x > 0)
    gl = abs(sum(x for x in rr if x < 0))
    return {
        "n": n,
        "wr": round(len(wins) / n * 100, 1),
        "exp": round(sum(rr) / len(rr), 3) if rr else None,
        "pf": round(gp / gl, 2) if gl > 0 else None,
    }


async def main() -> None:
    from backend.analytics.outcome_learning import compute_snapshots
    from backend.database.session import get_pool

    seeded = await compute_snapshots()
    print(f"snapshot re-seed (new dims live): {seeded}")

    pool = await get_pool()
    rows = [dict(r) for r in await pool.fetch(
        """
        SELECT outcome, rr_achieved, market_regime, signal_type, breakout_strength
        FROM signal_outcomes
        WHERE outcome IN ('TP_HIT','SL_HIT') AND created_at > NOW() - INTERVAL '30 days'
        """
    )]

    def lab(v):
        return str(v) if v is not None else "NULL"

    # Build hierarchical cohorts from the same outcome set (in-sample)
    cohorts: dict[tuple, list] = defaultdict(list)
    for r in rows:
        key3 = ("3", lab(r["market_regime"]), lab(r["signal_type"]), lab(r["breakout_strength"]))
        key2 = ("2", lab(r["market_regime"]), lab(r["signal_type"]))
        key1 = ("1", lab(r["market_regime"]))
        cohorts[key3].append(r)
        cohorts[key2].append(r)
        cohorts[key1].append(r)

    cohort_stats = {k: stats(v) for k, v in cohorts.items() if len(v) >= MIN_N}

    def resolve(r):
        for key in (
            ("3", lab(r["market_regime"]), lab(r["signal_type"]), lab(r["breakout_strength"])),
            ("2", lab(r["market_regime"]), lab(r["signal_type"])),
            ("1", lab(r["market_regime"])),
        ):
            if key in cohort_stats:
                return cohort_stats[key]
        return None

    baseline = stats(rows)
    kept_wr, kept_both = [], []
    for r in rows:
        c = resolve(r)
        if c is None or c["wr"] is None or c["wr"] >= 45.0:
            kept_wr.append(r)
        if c is None or (
            (c["wr"] is None or c["wr"] >= 45.0)
            and (c["exp"] is None or c["exp"] >= 0.0)
        ):
            kept_both.append(r)

    g_wr  = stats(kept_wr)
    g_all = stats(kept_both)

    def show(label, s, base):
        vol = round(s["n"] / base["n"] * 100, 1) if base["n"] else 0
        print(f"{label:28s} n={s['n']:5d} ({vol:5.1f}% vol)  WR={s['wr']}%  exp={s['exp']}R  pf={s['pf']}")

    print("\n30d SIMULATION (in-sample upper bound):")
    show("baseline (current system)", baseline, baseline)
    show("gate WR>=45", g_wr, baseline)
    show("gate WR>=45 AND exp>=0", g_all, baseline)
    print("\ndeltas (WR>=45 AND exp>=0 vs baseline):")
    print(f"  WR  {baseline['wr']}% -> {g_all['wr']}%  ({round(g_all['wr'] - baseline['wr'], 1):+}pp)")
    print(f"  exp {baseline['exp']}R -> {g_all['exp']}R")
    print(f"  pf  {baseline['pf']} -> {g_all['pf']}")
    print(f"  volume reduction: {baseline['n']} -> {g_all['n']} ({round((1 - g_all['n']/baseline['n'])*100, 1)}% fewer)")


if __name__ == "__main__":
    asyncio.run(main())
