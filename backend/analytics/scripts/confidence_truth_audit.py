"""
CONFIDENCE.TRUTH.1 — Confidence calibration audit.

Queries resolved signal_outcomes (last 30 days) and reports:
  1. WR / avg_rr / expectancy per confidence bucket (80-84, 85-89, 90-94, 95-100)
  2. Same buckets broken down by market_regime, breakout_strength,
     oi_interpretation, signal_type
  3. For 90+ signals: component scoring frequency breakdown
  4. Calibration verdict
"""
from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv
load_dotenv(ROOT / ".env.local")

import asyncpg


DSN = os.environ.get("DATABASE_URL", "")
if not DSN:
    sys.exit("DATABASE_URL not set in .env.local")


# ── helpers ───────────────────────────────────────────────────────────────────

def _bucket(conf: int) -> str | None:
    if conf < 80:
        return None
    if conf <= 84:
        return "80-84"
    if conf <= 89:
        return "85-89"
    if conf <= 94:
        return "90-94"
    return "95-100"


def _stats(rows: list[dict]) -> dict:
    if not rows:
        return {"n": 0, "tp": 0, "sl": 0, "wr": None, "avg_rr": None, "exp": None}
    n   = len(rows)
    tp  = sum(1 for r in rows if r["outcome"] in ("TP", "TP_HIT"))
    sl  = sum(1 for r in rows if r["outcome"] in ("SL", "SL_HIT"))
    wr  = tp / n if n else None
    rrs = [float(r["rr_achieved"]) for r in rows if r.get("rr_achieved") is not None]
    avg_rr = sum(rrs) / len(rrs) if rrs else None
    exp = (wr * avg_rr) + ((1 - wr) * -1) if (wr is not None and avg_rr is not None) else None
    return {"n": n, "tp": tp, "sl": sl, "wr": wr, "avg_rr": avg_rr, "exp": exp}


def _fmt_row(label: str, s: dict) -> str:
    wr  = f"{s['wr']*100:.1f}%" if s["wr"] is not None else "N/A"
    rr  = f"{s['avg_rr']:.3f}"  if s["avg_rr"] is not None else "N/A"
    exp = f"{s['exp']:.3f}"     if s["exp"] is not None else "N/A"
    return f"{label:<12}  {s['n']:>5}  {s['tp']:>4}  {s['sl']:>4}  {wr:>6}  {rr:>7}  {exp:>8}"


def _print_section(title: str) -> None:
    print(f"\n{'='*74}")
    print(f"  {title}")
    print('='*74)


def _group_stats(rows: list[dict], key: str) -> dict[str, dict]:
    groups: dict[str, list] = {}
    for r in rows:
        v = str(r.get(key) or "NULL")
        groups.setdefault(v, []).append(r)
    return {k: _stats(v) for k, v in sorted(groups.items())}


# ── main audit ────────────────────────────────────────────────────────────────

async def run() -> None:
    dsn = DSN.replace("postgresql+asyncpg://", "postgresql://", 1)
    conn = await asyncpg.connect(dsn, statement_cache_size=0)
    try:
        await _audit(conn)
    finally:
        await conn.close()


async def _audit(conn: asyncpg.Connection) -> None:
    raw = await conn.fetch("""
        SELECT
            so.outcome,
            so.rr_achieved,
            so.confidence,
            so.signal_type,
            so.market_regime,
            so.breakout_strength,
            so.breakout_type,
            so.oi_interpretation,
            so.positioning_context,
            so.funding_trend,
            so.scanner_mode,
            so.risk_grade,
            so.trend_score,
            so.sector_status,
            so.ai_validated,
            so.pre_score
        FROM signal_outcomes so
        WHERE so.outcome IN ('TP', 'TP_HIT', 'SL', 'SL_HIT')
          AND so.resolved_at >= NOW() - INTERVAL '30 days'
          AND so.confidence >= 80
        ORDER BY so.confidence DESC
    """)

    if not raw:
        print("No resolved outcomes in the last 30 days at confidence >= 80.")
        return

    rows = [dict(r) for r in raw]
    print(f"\nTotal resolved outcomes (80+, last 30d): {len(rows)}")

    # ── 1. Bucket overview ────────────────────────────────────────────────────
    _print_section("1. CONFIDENCE BUCKET OVERVIEW")

    bucket_order = ["80-84", "85-89", "90-94", "95-100"]
    buckets: dict[str, list] = {b: [] for b in bucket_order}
    for r in rows:
        b = _bucket(r["confidence"])
        if b:
            buckets[b].append(r)

    print(f"\n{'Bucket':<12}  {'n':>5}  {'TP':>4}  {'SL':>4}  {'WR':>6}  {'avgRR':>7}  {'Exp':>8}")
    print('-'*62)
    for b in bucket_order:
        print(_fmt_row(b, _stats(buckets[b])))

    # ── 2. Breakdown within each bucket ──────────────────────────────────────
    above90 = buckets["90-94"] + buckets["95-100"]
    mid     = buckets["85-89"]
    low     = buckets["80-84"]

    _print_section("2. 90+ BREAKDOWN BY DIMENSION")

    dimensions = [
        ("market_regime",      "Market Regime"),
        ("signal_type",        "Signal Type"),
        ("breakout_strength",  "Breakout Strength"),
        ("breakout_type",      "Breakout Type"),
        ("oi_interpretation",  "OI Interpretation"),
        ("positioning_context","Positioning Context"),
        ("funding_trend",      "Funding Trend"),
        ("scanner_mode",       "Scanner Mode"),
        ("risk_grade",         "Risk Grade"),
    ]

    for key, label in dimensions:
        gs = _group_stats(above90, key)
        if not gs:
            continue
        print(f"\n  [{label}]")
        print(f"  {'Value':<28} {'n':>5}  {'TP':>4}  {'SL':>4}  {'WR':>6}  {'avgRR':>7}  {'Exp':>8}")
        print('  ' + '-'*62)
        for val, s in sorted(gs.items(), key=lambda x: -x[1]["n"]):
            wr  = f"{s['wr']*100:.1f}%" if s["wr"] is not None else "N/A"
            rr  = f"{s['avg_rr']:.3f}"  if s["avg_rr"] is not None else "N/A"
            exp = f"{s['exp']:.3f}"     if s["exp"] is not None else "N/A"
            print(f"  {val:<28} {s['n']:>5}  {s['tp']:>4}  {s['sl']:>4}  {wr:>6}  {rr:>7}  {exp:>8}")

    # ── 3. Score component frequency for 90+ ─────────────────────────────────
    _print_section("3. SCORE COMPONENT FREQUENCY — 90+ signals")

    total_90plus = len(above90)
    component_checks = [
        # Breakout
        ("HIGH_MOMENTUM_BREAKOUT", lambda r: r.get("breakout_strength") == "HIGH_MOMENTUM_BREAKOUT"),
        ("CONFIRMED_BREAKOUT",     lambda r: r.get("breakout_strength") == "CONFIRMED_BREAKOUT"),
        ("EARLY_BREAKOUT",         lambda r: r.get("breakout_strength") == "EARLY_BREAKOUT"),
        ("breakout_NONE",          lambda r: not r.get("breakout_strength") or r.get("breakout_strength") == "NONE"),
        ("20d_high",               lambda r: "20d_high" in (r.get("breakout_type") or "")),
        ("30d_high",               lambda r: "30d_high" in (r.get("breakout_type") or "")),
        ("20d_low",                lambda r: "20d_low" in (r.get("breakout_type") or "")),
        ("30d_low",                lambda r: "30d_low" in (r.get("breakout_type") or "")),
        ("bb_expansion_combo",     lambda r: "bb_expansion" in (r.get("breakout_type") or "")),
        # OI
        ("OI_NEUTRAL",             lambda r: r.get("oi_interpretation") == "NEUTRAL"),
        ("OI_NEW_LONGS",           lambda r: r.get("oi_interpretation") == "NEW_LONGS"),
        ("OI_NEW_SHORTS",          lambda r: r.get("oi_interpretation") == "NEW_SHORTS"),
        ("OI_SHORT_COVERING",      lambda r: r.get("oi_interpretation") == "SHORT_COVERING"),
        ("OI_LONG_LIQUIDATION",    lambda r: r.get("oi_interpretation") == "LONG_LIQUIDATION"),
        ("OI_NULL",                lambda r: not r.get("oi_interpretation")),
        # Funding
        ("FUNDING_STABLE",         lambda r: r.get("funding_trend") == "STABLE"),
        ("FUNDING_RISING",         lambda r: r.get("funding_trend") == "RISING"),
        ("FUNDING_FALLING",        lambda r: r.get("funding_trend") == "FALLING"),
        ("FUNDING_NULL",           lambda r: not r.get("funding_trend")),
        # Positioning
        ("POS_EXTREME_LONG",       lambda r: r.get("positioning_context") == "EXTREME_LONG"),
        ("POS_EXTREME_SHORT",      lambda r: r.get("positioning_context") == "EXTREME_SHORT"),
        ("POS_BALANCED",           lambda r: r.get("positioning_context") == "BALANCED"),
        ("POS_LONG_HEAVY",         lambda r: r.get("positioning_context") == "LONG_HEAVY"),
        ("POS_SHORT_HEAVY",        lambda r: r.get("positioning_context") == "SHORT_HEAVY"),
        ("POS_NULL",               lambda r: not r.get("positioning_context")),
        # Regime
        ("REGIME_BULL_TREND",      lambda r: r.get("market_regime") == "BULL_TREND"),
        ("REGIME_EUPHORIA",        lambda r: r.get("market_regime") == "EUPHORIA"),
        ("REGIME_SIDEWAYS",        lambda r: r.get("market_regime") == "SIDEWAYS"),
        ("REGIME_HIGH_VOL",        lambda r: r.get("market_regime") == "HIGH_VOLATILITY"),
        ("REGIME_BEAR_TREND",      lambda r: r.get("market_regime") == "BEAR_TREND"),
        ("REGIME_CAPITULATION",    lambda r: r.get("market_regime") == "CAPITULATION"),
        ("REGIME_NULL",            lambda r: not r.get("market_regime")),
        # Signal direction
        ("BUY",                    lambda r: r.get("signal_type") == "BUY"),
        ("SELL",                   lambda r: r.get("signal_type") == "SELL"),
        # AI
        ("ai_validated_true",      lambda r: r.get("ai_validated") is True),
        ("ai_validated_false",     lambda r: r.get("ai_validated") is False),
        # Grade
        ("grade_A",                lambda r: r.get("risk_grade") == "A"),
        ("grade_B",                lambda r: r.get("risk_grade") == "B"),
        ("grade_C",                lambda r: r.get("risk_grade") == "C"),
        ("grade_D",                lambda r: r.get("risk_grade") == "D"),
    ]

    print(f"\n  Total 90+ signals: {total_90plus}")
    print(f"\n  {'Component':<30} {'Count':>6} {'%':>6}  {'WR':>6}  {'avgRR':>7}  {'Exp':>8}")
    print('  ' + '-'*72)

    for name, check_fn in component_checks:
        matching = [r for r in above90 if check_fn(r)]
        n = len(matching)
        if n == 0:
            continue
        pct = n / total_90plus * 100 if total_90plus else 0
        s = _stats(matching)
        wr  = f"{s['wr']*100:.1f}%" if s["wr"] is not None else "N/A"
        rr  = f"{s['avg_rr']:.3f}"  if s["avg_rr"] is not None else "N/A"
        exp = f"{s['exp']:.3f}"     if s["exp"] is not None else "N/A"
        print(f"  {name:<30} {n:>6} {pct:>5.1f}%  {wr:>6}  {rr:>7}  {exp:>8}")

    # ── 4. Head-to-head: 90+ vs 85-89 by regime × signal_type ───────────────
    _print_section("4. HEAD-TO-HEAD: 90+ vs 85-89 (regime × signal_type)")

    regimes = sorted({str(r.get("market_regime") or "NULL") for r in rows})
    stypes  = ["BUY", "SELL"]

    print(f"\n  {'Segment':<26}  {'--- 85-89 ---':>22}  {'--- 90+ ---':>22}")
    print('  ' + '-'*74)

    def _short(s: dict) -> str:
        wr  = f"{s['wr']*100:.0f}%" if s["wr"] is not None else "N/A"
        exp = f"{s['exp']:.2f}"      if s["exp"] is not None else "N/A"
        return f"n={s['n']:3d} WR={wr:>4} Exp={exp:>6}"

    for regime in regimes:
        for stype in stypes:
            def _filter(bkt: list[dict], reg=regime, st=stype) -> list[dict]:
                return [r for r in bkt
                        if str(r.get("market_regime") or "NULL") == reg
                        and str(r.get("signal_type") or "") == st]

            m = _filter(mid)
            h = _filter(above90)
            if not m and not h:
                continue
            seg = f"{regime[:14]}/{stype}"
            print(f"  {seg:<26}  {_short(_stats(m)):>22}  {_short(_stats(h)):>22}")

    # ── 5. Pre-score distribution for 90+ winners vs losers ──────────────────
    _print_section("5. PRE-SCORE DISTRIBUTION — 90+ winners vs losers")

    winners_90 = [r for r in above90 if r["outcome"] in ("TP", "TP_HIT")]
    losers_90  = [r for r in above90 if r["outcome"] in ("SL", "SL_HIT")]
    print(f"\n  90+ total: {len(above90)}  TP: {len(winners_90)}  SL: {len(losers_90)}")

    def _score_dist(label: str, rws: list[dict]) -> None:
        vals = [r["pre_score"] for r in rws if r.get("pre_score") is not None]
        if not vals:
            print(f"  {label}: no pre_score data")
            return
        avg = sum(vals) / len(vals)
        print(f"  {label}: n={len(vals)}  min={min(vals)}  avg={avg:.1f}  max={max(vals)}")

    _score_dist("Winners", winners_90)
    _score_dist("Losers ", losers_90)

    if losers_90:
        print(f"\n  Losers by regime:")
        for k, s in sorted(_group_stats(losers_90, "market_regime").items(), key=lambda x: -x[1]["n"]):
            print(f"    {k:<28} n={s['n']:3d}")
        print(f"\n  Losers by breakout_strength:")
        for k, s in sorted(_group_stats(losers_90, "breakout_strength").items(), key=lambda x: -x[1]["n"]):
            pct = s["n"] / len(losers_90) * 100
            print(f"    {k:<28} n={s['n']:3d}  ({pct:.1f}% of losers)")

    # ── 6. Calibration verdict ────────────────────────────────────────────────
    _print_section("6. CALIBRATION VERDICT")

    s_all = _stats(rows)
    s80   = _stats(low)
    s85   = _stats(mid)
    s90   = _stats(above90)
    s90_94 = _stats(buckets["90-94"])
    s95   = _stats(buckets["95-100"])

    print(f"\n  {'Overall (80+)':<14}  {_fmt_row('', s_all)[14:]}")
    print(f"  {'80-84':<14}  {_fmt_row('', s80)[14:]}")
    print(f"  {'85-89':<14}  {_fmt_row('', s85)[14:]}")
    print(f"  {'90-94':<14}  {_fmt_row('', s90_94)[14:]}")
    print(f"  {'95-100':<14}  {_fmt_row('', s95)[14:]}")

    if s85["wr"] is not None and s90["wr"] is not None:
        wr_delta  = s90["wr"]  - s85["wr"]
        exp_delta = (s90["exp"] or 0) - (s85["exp"] or 0)
        pct_above = len(above90) / len(rows) * 100 if rows else 0

        print(f"\n  WR delta (90+ minus 85-89):   {wr_delta*100:+.1f}pp")
        print(f"  Exp delta (90+ minus 85-89):  {exp_delta:+.3f}")
        print(f"  % of signals at 90+:           {pct_above:.1f}%")

        if wr_delta < -0.03:
            verdict = "OVERSCORED"
            reason  = ("90+ WR is >3pp WORSE than 85-89. Confidence formula pushes signals "
                       "into the 90+ band that do not outperform. Top tier is meaningless or harmful.")
        elif wr_delta > 0.05:
            verdict = "CALIBRATED"
            reason  = "90+ WR meaningfully exceeds 85-89. Score tiers discriminate correctly."
        else:
            verdict = "OVERSCORED (marginal)"
            reason  = ("90+ WR matches or slightly trails 85-89. Score tiers provide no "
                       "discrimination at the top end.")

        print(f"\n  Verdict: *** {verdict} ***")
        print(f"  Reason:  {reason}")

        # ── Recommendations ──────────────────────────────────────────────────
        print(f"\n  RECOMMENDATIONS:")

        recs = []

        if pct_above > 65:
            recs.append(
                f"[SCORE CAP]        {pct_above:.0f}% of 80+ signals score 90+ — apply a hard cap "
                f"at 92 or reduce AI baseline output by ~{(pct_above-50)/10:.0f} pts."
            )

        if s90["wr"] is not None and s90["wr"] < 0.40:
            recs.append(
                f"[SCORE REDUCTION]  90+ WR={s90['wr']*100:.1f}% < 40% — reduce Claude base "
                "confidence output, or add +5 penalty for any signal lacking breakout confirmation."
            )

        null_90 = [r for r in above90 if not r.get("market_regime")]
        if null_90:
            sn = _stats(null_90)
            if sn["wr"] is not None and sn["wr"] < 0.35:
                recs.append(
                    f"[NULL REGIME]      {len(null_90)} 90+ signals with NULL regime "
                    f"(WR={sn['wr']*100:.1f}%) — apply −15 penalty or hard block."
                )

        hv_90 = [r for r in above90 if r.get("market_regime") == "HIGH_VOLATILITY"]
        if hv_90:
            sh = _stats(hv_90)
            if sh["wr"] is not None and sh["wr"] < 0.38:
                recs.append(
                    f"[HIGH_VOLATILITY]  {len(hv_90)} 90+ in HIGH_VOLATILITY "
                    f"(WR={sh['wr']*100:.1f}%) — increase confidence hurdle from +5 to +12."
                )

        sc_buy = [r for r in above90 if r.get("oi_interpretation") == "SHORT_COVERING"
                  and r.get("signal_type") == "BUY"]
        if sc_buy:
            ss = _stats(sc_buy)
            if ss["wr"] is not None and ss["wr"] < 0.40:
                recs.append(
                    f"[SHORT_COVERING+BUY] {len(sc_buy)} signals "
                    f"(WR={ss['wr']*100:.1f}%) — apply −5 confidence penalty for SHORT_COVERING on BUY."
                )

        ll_buy = [r for r in above90 if r.get("oi_interpretation") == "LONG_LIQUIDATION"
                  and r.get("signal_type") == "BUY"]
        if ll_buy:
            sl2 = _stats(ll_buy)
            if sl2["wr"] is not None and sl2["wr"] < 0.35:
                recs.append(
                    f"[LONG_LIQUIDATION+BUY] {len(ll_buy)} signals "
                    f"(WR={sl2['wr']*100:.1f}%) — apply −8 confidence penalty for LONG_LIQUIDATION on BUY."
                )

        bull_sell_90 = [r for r in above90 if r.get("signal_type") == "SELL"
                        and r.get("market_regime") in ("BULL_TREND","EUPHORIA")]
        if bull_sell_90:
            bss = _stats(bull_sell_90)
            if bss["wr"] is not None and bss["wr"] < 0.35:
                recs.append(
                    f"[BULL+SELL]        {len(bull_sell_90)} SELL signals in BULL regime still reaching 90+ "
                    f"(WR={bss['wr']*100:.1f}%) — increase soft gate from +10 to +15."
                )

        if not recs:
            recs.append("No specific high-priority recommendations — monitor as data accumulates.")

        for rec in recs:
            print(f"    {rec}")

    else:
        print("\n  INSUFFICIENT DATA — cannot compute verdict.")

    print(f"\n{'='*74}\n")


if __name__ == "__main__":
    asyncio.run(run())
