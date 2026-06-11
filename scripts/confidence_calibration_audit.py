"""CONFIDENCE.CALIBRATION.2 Phase A — live confidence band analysis (read-only)."""
from __future__ import annotations

import asyncio
import json
import sys

sys.path.insert(0, ".")
from backend.database.session import get_pool  # noqa: E402

BANDS = [(0, 80), (80, 85), (85, 90), (90, 95), (95, 101)]


def band_of(v) -> str:
    if v is None:
        return "NULL"
    v = float(v)
    for lo, hi in BANDS:
        if lo <= v < hi:
            return f"{lo}-{hi-1}" if lo else "<80"
    return "out"


def stats(rows):
    tp = [float(r["rr_achieved"]) for r in rows if r["outcome"] == "TP_HIT" and r["rr_achieved"] is not None]
    sl = [float(r["rr_achieved"]) for r in rows if r["outcome"] == "SL_HIT" and r["rr_achieved"] is not None]
    n = len(rows)
    wr = round(len(tp) / (len(tp) + len(sl)) * 100, 1) if (tp or sl) else None
    rr = tp + sl
    exp = round(sum(rr) / len(rr), 3) if rr else None
    gp, gl = sum(tp), abs(sum(sl))
    pf = round(gp / gl, 2) if gl > 0 else None
    return {
        "n": n, "wr": wr, "exp": exp, "pf": pf,
        "avg_winner": round(sum(tp) / len(tp), 3) if tp else None,
        "avg_loser":  round(sum(sl) / len(sl), 3) if sl else None,
    }


async def main():
    pool = await get_pool()
    rows = [dict(r) for r in await pool.fetch(
        """
        SELECT outcome, rr_achieved, confidence, market_regime, signal_type, scanner_mode
        FROM signal_outcomes
        WHERE outcome IN ('TP_HIT','SL_HIT') AND created_at > NOW() - INTERVAL '30 days'
        """
    )]
    out = {"total": len(rows), "bands": {}, "bands_regime_known": {}, "drift_by_regime": {}, "drift_by_type": {}, "drift_by_mode": {}}

    def group(rs, keyfn):
        g = {}
        for r in rs:
            g.setdefault(keyfn(r), []).append(r)
        return g

    for band, cell in sorted(group(rows, lambda r: band_of(r["confidence"])).items()):
        out["bands"][band] = stats(cell)

    clean = [r for r in rows if r["market_regime"]]
    for band, cell in sorted(group(clean, lambda r: band_of(r["confidence"])).items()):
        out["bands_regime_known"][band] = stats(cell)

    for dim, key in (("drift_by_regime", "market_regime"), ("drift_by_type", "signal_type"), ("drift_by_mode", "scanner_mode")):
        for val, sub in group(rows, lambda r, k=key: str(r[k])).items():
            for band, cell in sorted(group(sub, lambda r: band_of(r["confidence"])).items()):
                if len(cell) >= 10:
                    out[dim][f"{val} × {band}"] = stats(cell)

    print(json.dumps(out, indent=1, default=str))


if __name__ == "__main__":
    asyncio.run(main())
