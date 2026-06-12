"""Post-deploy verification: are the P1 fixes + probability gate live in production data?"""
from __future__ import annotations

import asyncio
import json
import sys

sys.path.insert(0, ".")


async def main() -> None:
    from backend.database.session import get_pool
    pool = await get_pool()

    # Recent signals — new-field coverage
    row = await pool.fetchrow(
        """
        SELECT count(*)                                        AS total,
               count(*) FILTER (WHERE empirical_wr IS NOT NULL) AS with_empirical,
               count(*) FILTER (WHERE sector_status IS NOT NULL) AS with_sector,
               count(*) FILTER (WHERE trend_score IS NOT NULL)   AS with_trend,
               count(*) FILTER (WHERE telegram_sent)             AS sent,
               min(created_at)                                   AS oldest,
               max(created_at)                                   AS newest
        FROM signals
        WHERE created_at > NOW() - INTERVAL '3 hours'
        """
    )
    print("signals (last 3h):", dict(row))

    # Funding trend distribution on recent signals (FUNDING.TREND.FIX.1)
    rows = await pool.fetch(
        """
        SELECT funding_trend, count(*) FROM signals
        WHERE created_at > NOW() - INTERVAL '6 hours' AND funding_trend IS NOT NULL
        GROUP BY 1
        """
    )
    print("funding_trend (6h):", {r["funding_trend"]: r["count"] for r in rows})

    # Probability-gate signature: alert-eligible but unsent low-WR signals
    rows = await pool.fetch(
        """
        SELECT symbol, type AS signal_type, confidence, empirical_wr, empirical_n,
               telegram_sent, market_regime, created_at
        FROM signals
        WHERE created_at > NOW() - INTERVAL '3 hours'
          AND empirical_wr IS NOT NULL
        ORDER BY created_at DESC LIMIT 12
        """
    )
    for r in rows:
        print(f"  {str(r['created_at'])[11:16]} {r['symbol']:8s} {r['signal_type']:4s} "
              f"conf={r['confidence']} ewr={float(r['empirical_wr']):.1f} n={r['empirical_n']} "
              f"sent={r['telegram_sent']} regime={r['market_regime']}")

    # Scan health + new gate keys in recent scans
    rows = await pool.fetch(
        """
        SELECT created_at, mode, coins_scanned, signals_found, duration_ms, gate_rejections
        FROM scan_metrics_log
        WHERE created_at > NOW() - INTERVAL '2 hours'
        ORDER BY created_at DESC LIMIT 8
        """
    )
    print("\nrecent scans:")
    for r in rows:
        gr = r["gate_rejections"]
        gr = json.loads(gr) if isinstance(gr, str) else (gr or {})
        interesting = {k: v for k, v in gr.items()
                       if v and k in ("CONTRA_REGIME_REJECTION", "KLINE_EMPTY", "KLINE_PARTIAL", "REGIME_REJECTION")}
        print(f"  {str(r['created_at'])[11:16]} {r['mode']:16s} coins={r['coins_scanned']:3d} "
              f"signals={r['signals_found']} dur={round(r['duration_ms']/1000)}s {interesting}")


if __name__ == "__main__":
    asyncio.run(main())
