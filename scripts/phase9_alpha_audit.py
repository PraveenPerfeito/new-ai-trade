"""
PHASE.9.ALPHA.MAXIMIZATION.1 — outcome data extraction.
Read-only audit queries against signal_outcomes + scan_metrics_log + signals.
Run: python scripts/phase9_alpha_audit.py > phase9-data.json
"""
from __future__ import annotations

import asyncio
import json
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, ".")

from backend.database.session import get_pool  # noqa: E402

CONF_BANDS = [(0, 80), (80, 83), (83, 86), (86, 89), (89, 92), (92, 95), (95, 101)]
QUALITY_BANDS = [(0, 40), (40, 55), (55, 70), (70, 85), (85, 101)]


def tier(score) -> str:
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


def stats(rows: list[dict]) -> dict | None:
    n = len(rows)
    if n == 0:
        return None
    tp = sum(1 for r in rows if r["outcome"] == "TP_HIT")
    sl = sum(1 for r in rows if r["outcome"] == "SL_HIT")
    to = sum(1 for r in rows if r["outcome"] == "TIMEOUT")
    rr = [float(r["rr_achieved"]) for r in rows if r["rr_achieved"] is not None]
    exp = round(sum(rr) / len(rr), 3) if rr else None
    gp = sum(x for x in rr if x > 0)
    gl = abs(sum(x for x in rr if x < 0))
    pf = round(gp / gl, 2) if gl > 0 else None
    wr = round(tp / (tp + sl) * 100, 1) if (tp + sl) > 0 else None
    return {"n": n, "tp": tp, "sl": sl, "timeout": to, "wr": wr, "exp": exp, "pf": pf}


def by_dim(rows: list[dict], key: str, label_fn=None) -> dict:
    groups: dict[str, list] = {}
    for r in rows:
        v = r.get(key)
        label = label_fn(v) if label_fn else (str(v) if v is not None else "NULL")
        groups.setdefault(label, []).append(r)
    return {k: stats(v) for k, v in sorted(groups.items()) if len(v) >= 5}


def band_label(value, bands) -> str:
    if value is None:
        return "NULL"
    v = float(value)
    for lo, hi in bands:
        if lo <= v < hi:
            return f"{lo}-{hi - 1}"
    return "out"


def by_pair(rows: list[dict], k1: str, k2: str, f1=None, f2=None, min_n: int = 10) -> dict:
    groups: dict[str, list] = {}
    for r in rows:
        a = f1(r.get(k1)) if f1 else (str(r.get(k1)) if r.get(k1) is not None else "NULL")
        b = f2(r.get(k2)) if f2 else (str(r.get(k2)) if r.get(k2) is not None else "NULL")
        groups.setdefault(f"{a} × {b}", []).append(r)
    return {k: stats(v) for k, v in sorted(groups.items()) if len(v) >= min_n}


async def main() -> None:
    pool = await get_pool()

    rows = [dict(r) for r in await pool.fetch(
        """
        SELECT outcome, rr_achieved, pnl_pct, duration_hours, confidence, risk_grade,
               market_regime, breakout_type, breakout_strength, oi_interpretation,
               funding_trend, positioning_context, trend_score, sector_status,
               scanner_mode, signal_type, timeframe, quality_score, risk_score,
               ai_validated, volatility_regime, created_at
        FROM signal_outcomes
        WHERE outcome != 'PENDING'
          AND created_at > NOW() - INTERVAL '60 days'
        """
    )]

    now = datetime.now(timezone.utc)

    def window(days: int) -> list[dict]:
        cut = now - timedelta(days=days)
        out = []
        for r in rows:
            ts = r["created_at"]
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=timezone.utc)
            if ts > cut:
                out.append(r)
        return out

    r7, r14, r30, r60 = window(7), window(14), window(30), window(60)

    result: dict = {
        "generated_at": now.isoformat(),
        "overall": {"7d": stats(r7), "14d": stats(r14), "30d": stats(r30), "60d": stats(r60)},
    }

    # Single dimensions on 30d
    result["by_dim_30d"] = {
        "market_regime":       by_dim(r30, "market_regime"),
        "risk_grade":          by_dim(r30, "risk_grade"),
        "breakout_strength":   by_dim(r30, "breakout_strength"),
        "breakout_type":       by_dim(r30, "breakout_type"),
        "oi_interpretation":   by_dim(r30, "oi_interpretation"),
        "funding_trend":       by_dim(r30, "funding_trend"),
        "positioning_context": by_dim(r30, "positioning_context"),
        "sector_status":       by_dim(r30, "sector_status"),
        "trend_score_tier":    by_dim(r30, "trend_score", tier),
        "scanner_mode":        by_dim(r30, "scanner_mode"),
        "signal_type":         by_dim(r30, "signal_type"),
        "timeframe":           by_dim(r30, "timeframe"),
        "volatility_regime":   by_dim(r30, "volatility_regime"),
        "confidence_band":     by_dim(r30, "confidence", lambda v: band_label(v, CONF_BANDS)),
        "quality_band":        by_dim(r30, "quality_score", lambda v: band_label(v, QUALITY_BANDS)),
        "ai_validated":        by_dim(r30, "ai_validated"),
    }
    # Same on 7d (post-ALPHA.TRUTH.1 era) for drift detection
    result["by_dim_7d"] = {
        "market_regime":     by_dim(r7, "market_regime"),
        "risk_grade":        by_dim(r7, "risk_grade"),
        "confidence_band":   by_dim(r7, "confidence", lambda v: band_label(v, CONF_BANDS)),
        "breakout_strength": by_dim(r7, "breakout_strength"),
        "scanner_mode":      by_dim(r7, "scanner_mode"),
    }

    # Pair combinations on 30d (min n=10)
    cb = lambda v: band_label(v, CONF_BANDS)  # noqa: E731
    result["pairs_30d"] = {
        "regime_x_grade":        by_pair(r30, "market_regime", "risk_grade"),
        "regime_x_confband":     by_pair(r30, "market_regime", "confidence", f2=cb),
        "grade_x_breakout":      by_pair(r30, "risk_grade", "breakout_strength"),
        "trendtier_x_breakout":  by_pair(r30, "trend_score", "breakout_strength", f1=tier),
        "oi_x_positioning":      by_pair(r30, "oi_interpretation", "positioning_context"),
        "funding_x_positioning": by_pair(r30, "funding_trend", "positioning_context"),
        "sector_x_funding":      by_pair(r30, "sector_status", "funding_trend"),
        "mode_x_regime":         by_pair(r30, "scanner_mode", "market_regime"),
        "type_x_regime":         by_pair(r30, "signal_type", "market_regime"),
        "breakout_x_oi":         by_pair(r30, "breakout_strength", "oi_interpretation"),
        "confband_x_breakout":   by_pair(r30, "confidence", "breakout_strength", f1=cb),
        "grade_x_oi":            by_pair(r30, "risk_grade", "oi_interpretation"),
    }

    # Scan health — quantify the empty-universe window
    scan_rows = await pool.fetch(
        """
        SELECT date_trunc('day', created_at) AS day,
               count(*)                                  AS scans,
               round(avg(coins_scanned), 1)              AS avg_coins,
               sum((coins_scanned = 0)::int)             AS zero_coin_scans,
               sum((coins_scanned BETWEEN 1 AND 10)::int) AS low_coin_scans,
               sum(signals_found)                        AS signals,
               round(avg(duration_ms) / 1000.0, 1)       AS avg_dur_s
        FROM scan_metrics_log
        WHERE created_at > NOW() - INTERVAL '14 days'
        GROUP BY 1 ORDER BY 1
        """
    )
    result["scan_health_14d"] = [
        {"day": str(r["day"].date()), "scans": r["scans"], "avg_coins": float(r["avg_coins"] or 0),
         "zero_coin_scans": r["zero_coin_scans"], "low_coin_scans": r["low_coin_scans"],
         "signals": r["signals"], "avg_dur_s": float(r["avg_dur_s"] or 0)}
        for r in scan_rows
    ]

    # Signal generation rate + pending backlog
    gen = await pool.fetchrow(
        """
        SELECT
          (SELECT count(*) FROM signals WHERE created_at > NOW() - INTERVAL '24 hours') AS signals_24h,
          (SELECT count(*) FROM signals WHERE created_at > NOW() - INTERVAL '7 days')   AS signals_7d,
          (SELECT count(*) FROM signal_outcomes WHERE outcome = 'PENDING')              AS pending,
          (SELECT count(*) FROM signal_outcomes WHERE outcome = 'PENDING'
             AND created_at < NOW() - INTERVAL '3 days')                                AS pending_stale
        """
    )
    result["generation"] = dict(gen)

    print(json.dumps(result, indent=1, default=str))


if __name__ == "__main__":
    asyncio.run(main())
