"""TELEGRAM.DELIVERY.AUDIT.1 — read-only production data extraction (Phases A, C, D, G)."""
from __future__ import annotations

import asyncio
import json
import sys

sys.path.insert(0, ".")


def band(v) -> str:
    if v is None:
        return "NULL"
    v = float(v)
    if v < 80: return "<80"
    if v < 85: return "80-84"
    if v < 90: return "85-89"
    if v < 95: return "90-94"
    return "95-100"


async def main() -> None:
    from backend.database.session import get_pool
    pool = await get_pool()

    print("=" * 70)
    print("PHASE A — SIGNAL FLOW FUNNEL (7 days)")
    print("=" * 70)
    row = await pool.fetchrow(
        """
        SELECT count(*)                                                    AS generated,
               count(*) FILTER (WHERE ai_validated)                        AS validated,
               count(*) FILTER (WHERE validation_source = 'CLAUDE')        AS claude_approved,
               count(*) FILTER (WHERE validation_source = 'HEURISTIC')     AS heuristic_approved,
               count(*) FILTER (WHERE validation_source IS NULL)           AS source_null,
               count(*) FILTER (WHERE confidence >= 85)                    AS alert_eligible_85,
               count(*) FILTER (WHERE telegram_sent)                       AS telegram_sent,
               count(*) FILTER (WHERE telegram_sent AND confidence >= 85)  AS sent_and_eligible,
               count(*) FILTER (WHERE NOT telegram_sent AND confidence >= 85) AS eligible_not_sent
        FROM signals WHERE created_at > NOW() - INTERVAL '7 days'
        """
    )
    print(dict(row))

    active = await pool.fetchval(
        """
        SELECT count(*) FROM signals s
        WHERE s.created_at > NOW() - INTERVAL '7 days'
          AND NOT EXISTS (SELECT 1 FROM signal_outcomes o
                          WHERE o.signal_id = s.id AND o.outcome != 'PENDING')
        """
    )
    print(f"active_signals (7d, unresolved): {active}")

    print("\nper-day funnel:")
    rows = await pool.fetch(
        """
        SELECT date_trunc('day', created_at)::date AS day,
               count(*) AS gen,
               count(*) FILTER (WHERE confidence >= 85) AS elig,
               count(*) FILTER (WHERE telegram_sent)    AS sent,
               count(*) FILTER (WHERE validation_source = 'CLAUDE') AS claude
        FROM signals WHERE created_at > NOW() - INTERVAL '7 days'
        GROUP BY 1 ORDER BY 1
        """
    )
    for r in rows:
        print(f"  {r['day']}  gen={r['gen']:4d}  conf>=85={r['elig']:4d}  sent={r['sent']:4d}  claude={r['claude']}")

    print("\n" + "=" * 70)
    print("PHASE C — AI VALIDATION (7 days)")
    print("=" * 70)
    cols = await pool.fetch(
        "SELECT column_name FROM information_schema.columns WHERE table_name = 'ai_call_log'"
    )
    colnames = [c["column_name"] for c in cols]
    print(f"ai_call_log columns: {colnames}")
    if colnames:
        row = await pool.fetchrow(
            """
            SELECT count(*) AS rows_total,
                   count(*) FILTER (WHERE NOT used_fallback) AS claude_calls,
                   count(*) FILTER (WHERE used_fallback)     AS heuristic_fallbacks,
                   count(*) FILTER (WHERE error IS NOT NULL) AS errors,
                   count(*) FILTER (WHERE validated)         AS validated_true,
                   round(avg(latency_ms)) AS avg_latency_ms,
                   sum(prompt_tokens)     AS prompt_tokens,
                   sum(completion_tokens) AS completion_tokens
            FROM ai_call_log WHERE created_at > NOW() - INTERVAL '7 days'
            """
        )
        print(f"ai_call_log 7d: {dict(row)}")
        rows = await pool.fetch(
            """
            SELECT date_trunc('day', created_at)::date AS day,
                   count(*) AS rows_total,
                   count(*) FILTER (WHERE NOT used_fallback) AS claude,
                   count(*) FILTER (WHERE error IS NOT NULL) AS errors
            FROM ai_call_log WHERE created_at > NOW() - INTERVAL '30 days'
            GROUP BY 1 ORDER BY 1 DESC LIMIT 10
            """
        )
        print("recent days (rows/claude/errors):")
        for r in rows:
            print(f"  {r['day']}  rows={r['rows_total']:4d}  claude={r['claude']:4d}  errors={r['errors']}")
        last_err = await pool.fetchrow(
            "SELECT created_at, error FROM ai_call_log WHERE error IS NOT NULL ORDER BY created_at DESC LIMIT 1"
        )
        print(f"latest error: {dict(last_err) if last_err else None}")

    print("\n" + "=" * 70)
    print("PHASE D — SIGNAL LOSS (validated but not sent, 7 days)")
    print("=" * 70)
    rows = await pool.fetch(
        """
        SELECT scanner_mode, type AS signal_type, confidence, telegram_sent, created_at, symbol
        FROM signals
        WHERE created_at > NOW() - INTERVAL '7 days' AND ai_validated AND NOT telegram_sent
        """
    )
    print(f"validated_not_sent total: {len(rows)}")
    by_mode: dict = {}
    by_band: dict = {}
    below85 = atleast85 = 0
    for r in rows:
        by_mode[r["scanner_mode"]] = by_mode.get(r["scanner_mode"], 0) + 1
        by_band[band(r["confidence"])] = by_band.get(band(r["confidence"]), 0) + 1
        if r["confidence"] >= 85:
            atleast85 += 1
        else:
            below85 += 1
    print(f"  below alert threshold (<85): {below85}  |  eligible (>=85) but unsent: {atleast85}")
    print(f"  by mode: {by_mode}")
    print(f"  by conf band: {by_band}")

    # The interesting cohort: eligible but unsent — sample with timestamps to
    # distinguish dedup (same symbol within 1h of a sent one) vs other loss
    rows = await pool.fetch(
        """
        SELECT s.symbol, s.type, s.confidence, s.scanner_mode, s.created_at,
               EXISTS (
                 SELECT 1 FROM signals p
                 WHERE p.symbol = s.symbol AND p.type = s.type AND p.telegram_sent
                   AND p.created_at BETWEEN s.created_at - INTERVAL '60 minutes' AND s.created_at
                   AND p.id != s.id
               ) AS dedup_shadow
        FROM signals s
        WHERE s.created_at > NOW() - INTERVAL '7 days'
          AND s.confidence >= 85 AND NOT s.telegram_sent
        ORDER BY s.created_at DESC
        """
    )
    shadow = sum(1 for r in rows if r["dedup_shadow"])
    print(f"  eligible-unsent breakdown: dedup_shadow={shadow}  unexplained={len(rows) - shadow}")
    for r in rows[:15]:
        print(f"    {str(r['created_at'])[5:16]} {r['symbol']:8s} {r['type']:4s} conf={r['confidence']} "
              f"mode={r['scanner_mode']:8s} dedup={r['dedup_shadow']}")

    print("\n" + "=" * 70)
    print("PHASE G — GATE REJECTIONS (7 days)")
    print("=" * 70)
    rows = await pool.fetch(
        """
        SELECT gate_rejections, coins_scanned FROM scan_metrics_log
        WHERE created_at > NOW() - INTERVAL '7 days'
        """
    )
    totals: dict = {}
    scans = len(rows)
    coins = 0
    for r in rows:
        coins += r["coins_scanned"] or 0
        gr = r["gate_rejections"]
        gr = json.loads(gr) if isinstance(gr, str) else (gr or {})
        for k, v in gr.items():
            if isinstance(v, (int, float)) and v:
                totals[k] = totals.get(k, 0) + int(v)
    total_rej = sum(v for k, v in totals.items() if not k.startswith("ms_"))
    print(f"scans={scans} coins_scanned_total={coins}")
    for k, v in sorted(totals.items(), key=lambda kv: -kv[1]):
        pct = round(v / total_rej * 100, 1) if total_rej else 0
        print(f"  {k:28s} {v:6d}  ({pct}%)")


if __name__ == "__main__":
    asyncio.run(main())
