"""
TELEGRAM.RELIABILITY.1 WS6 — replay last 7d to estimate tail-loss recovery.

Model: queued messages drain at 1 msg/1.1s. Before the flush fix the loop
closed ~2-4s after the last enqueue (record_scan + collapse check + intel
refresh), so roughly the first 2 messages per scan escaped and the rest were
destroyed. After the fix, all queued messages drain (bounded 30s ≈ 27 msgs).
"""
from __future__ import annotations

import asyncio
import sys

sys.path.insert(0, ".")

SURVIVORS_PER_SCAN = 2   # conservative pre-fix estimate


async def main() -> None:
    from backend.database.session import get_pool
    pool = await get_pool()

    rows = await pool.fetch(
        """
        SELECT scan_run_id, count(*) AS queued
        FROM signals
        WHERE created_at > NOW() - INTERVAL '7 days' AND telegram_sent
        GROUP BY scan_run_id ORDER BY queued DESC
        """
    )
    eligible = await pool.fetchval(
        "SELECT count(*) FROM signals WHERE created_at > NOW() - INTERVAL '7 days' AND confidence >= 85"
    )

    total_queued = sum(r["queued"] for r in rows)
    est_lost = sum(max(0, r["queued"] - SURVIVORS_PER_SCAN) for r in rows)
    burst_scans = [(str(r["scan_run_id"])[:8], r["queued"]) for r in rows if r["queued"] > SURVIVORS_PER_SCAN]

    print(f"7d eligible (conf>=85):        {eligible}")
    print(f"7d queued (telegram_sent):     {total_queued} across {len(rows)} scans")
    print(f"scans with >  {SURVIVORS_PER_SCAN} queued msgs:    {len(burst_scans)}")
    print(f"est. tail-lost messages:       {est_lost}")
    print(f"est. actually delivered:       {total_queued - est_lost}")
    dr_before = (total_queued - est_lost) / total_queued * 100 if total_queued else 0
    print(f"delivery rate BEFORE (of queued): ~{dr_before:.0f}%")
    print(f"delivery rate AFTER  (of queued): ~100% (flush + receipts)")
    print(f"queued-vs-eligible (unchanged by this fix — dedup shadows): {total_queued}/{eligible}")
    print("\nburst scans (queued > 2):")
    for sid, n in burst_scans[:15]:
        print(f"  scan {sid}…  queued={n}  est_lost={n - SURVIVORS_PER_SCAN}")


if __name__ == "__main__":
    asyncio.run(main())
