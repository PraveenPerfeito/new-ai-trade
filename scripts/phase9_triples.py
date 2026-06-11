"""PHASE.9 follow-up: dimension slices WITHIN BEAR_TREND (clean regime-known cohort)."""
from __future__ import annotations

import asyncio
import json
import sys

sys.path.insert(0, ".")
from backend.database.session import get_pool  # noqa: E402

CONF_BANDS = [(0, 80), (80, 83), (83, 86), (86, 89), (89, 92), (92, 95), (95, 101)]
QUALITY_BANDS = [(0, 55), (55, 70), (70, 85), (85, 101)]


def stats(rows):
    n = len(rows)
    if n == 0:
        return None
    tp = sum(1 for r in rows if r["outcome"] == "TP_HIT")
    sl = sum(1 for r in rows if r["outcome"] == "SL_HIT")
    rr = [float(r["rr_achieved"]) for r in rows if r["rr_achieved"] is not None]
    exp = round(sum(rr) / len(rr), 3) if rr else None
    gp = sum(x for x in rr if x > 0)
    gl = abs(sum(x for x in rr if x < 0))
    pf = round(gp / gl, 2) if gl > 0 else None
    wr = round(tp / (tp + sl) * 100, 1) if (tp + sl) else None
    return {"n": n, "wr": wr, "exp": exp, "pf": pf}


def band(v, bands):
    if v is None:
        return "NULL"
    v = float(v)
    for lo, hi in bands:
        if lo <= v < hi:
            return f"{lo}-{hi-1}"
    return "out"


def by_dim(rows, key, fn=None, min_n=8):
    g = {}
    for r in rows:
        v = r.get(key)
        label = fn(v) if fn else (str(v) if v is not None else "NULL")
        g.setdefault(label, []).append(r)
    return {k: stats(v) for k, v in sorted(g.items()) if len(v) >= min_n}


async def main():
    pool = await get_pool()
    rows = [dict(r) for r in await pool.fetch(
        """
        SELECT outcome, rr_achieved, confidence, risk_grade, breakout_strength,
               oi_interpretation, funding_trend, positioning_context,
               scanner_mode, signal_type, quality_score, risk_score
        FROM signal_outcomes
        WHERE outcome IN ('TP_HIT','SL_HIT')
          AND market_regime = 'BEAR_TREND'
          AND created_at > NOW() - INTERVAL '30 days'
        """
    )]
    out = {
        "cohort": f"BEAR_TREND only, 30d, n={len(rows)}",
        "breakout_strength": by_dim(rows, "breakout_strength"),
        "oi_interpretation": by_dim(rows, "oi_interpretation"),
        "funding_trend":     by_dim(rows, "funding_trend"),
        "positioning":       by_dim(rows, "positioning_context"),
        "confidence_band":   by_dim(rows, "confidence", lambda v: band(v, CONF_BANDS)),
        "quality_band":      by_dim(rows, "quality_score", lambda v: band(v, QUALITY_BANDS)),
        "risk_score_band":   by_dim(rows, "risk_score", lambda v: band(v, [(0,25),(25,35),(35,45),(45,101)])),
        "grade":             by_dim(rows, "risk_grade"),
        "mode":              by_dim(rows, "scanner_mode"),
        "type":              by_dim(rows, "signal_type"),
    }
    # The decisive triple: SELL-only within BEAR_TREND by breakout
    sells = [r for r in rows if r["signal_type"] == "SELL"]
    out["SELL_only_breakout"] = by_dim(sells, "breakout_strength")
    out["SELL_only_confband"] = by_dim(sells, "confidence", lambda v: band(v, CONF_BANDS))
    print(json.dumps(out, indent=1, default=str))


if __name__ == "__main__":
    asyncio.run(main())
