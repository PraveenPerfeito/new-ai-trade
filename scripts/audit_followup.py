"""TELEGRAM.DELIVERY.AUDIT.1 — follow-ups: Claude call outcomes + Redis key census."""
from __future__ import annotations

import asyncio
import sys
from collections import defaultdict

sys.path.insert(0, ".")


async def main() -> None:
    from backend.database.session import get_pool
    pool = await get_pool()

    print("=" * 70)
    print("CLAUDE CALL OUTCOMES (non-fallback rows, 7d)")
    print("=" * 70)
    row = await pool.fetchrow(
        """
        SELECT count(*) AS claude_calls,
               count(*) FILTER (WHERE validated)     AS approved,
               count(*) FILTER (WHERE NOT validated) AS rejected,
               count(*) FILTER (WHERE error IS NOT NULL) AS errors,
               round(avg(confidence)) AS avg_conf,
               count(*) FILTER (WHERE validated AND confidence >= 85) AS approved_85plus
        FROM ai_call_log
        WHERE created_at > NOW() - INTERVAL '7 days' AND NOT used_fallback
        """
    )
    print(dict(row))
    rows = await pool.fetch(
        """
        SELECT error, count(*) FROM ai_call_log
        WHERE created_at > NOW() - INTERVAL '7 days' AND error IS NOT NULL
        GROUP BY 1 ORDER BY 2 DESC
        """
    )
    print("errors:", {r["error"]: r["count"] for r in rows})

    # Did ANY Claude-validated candidate become an accepted signal?
    row = await pool.fetchrow(
        """
        SELECT count(*) AS joined
        FROM ai_call_log a JOIN signals s ON s.id = a.signal_id
        WHERE a.created_at > NOW() - INTERVAL '7 days' AND NOT a.used_fallback
        """
    )
    print(f"claude rows joined to accepted signals: {dict(row)}")

    print("\n" + "=" * 70)
    print("PHASE E — REDIS KEY CENSUS")
    print("=" * 70)
    from backend.cache.redis_cache import get_redis
    redis = await get_redis()
    prefixes: dict[str, int] = defaultdict(int)
    samples: dict[str, tuple[str, int]] = {}
    total = 0
    cursor = 0
    while True:
        cursor, keys = await redis.scan(cursor=cursor, count=200)
        for k in keys:
            total += 1
            key = k if isinstance(k, str) else k.decode()
            parts = key.split(":")
            prefix = ":".join(parts[:2]) if len(parts) > 1 else parts[0]
            prefixes[prefix] += 1
            if prefix not in samples:
                ttl = await redis.ttl(key)
                samples[prefix] = (key, ttl)
        if cursor == 0:
            break
    print(f"total keys: {total}")
    print(f"{'prefix':35s} {'count':>5s}  {'sample (ttl s)'}")
    for p, c in sorted(prefixes.items(), key=lambda kv: -kv[1]):
        s, ttl = samples[p]
        print(f"{p:35s} {c:5d}  {s[:48]} (ttl={ttl})")


if __name__ == "__main__":
    asyncio.run(main())
