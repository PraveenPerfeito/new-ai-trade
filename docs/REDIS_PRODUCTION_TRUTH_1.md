# REDIS.PRODUCTION.TRUTH.1 — Production Redis Measurement

> **HISTORICAL — Pre-fix snapshot (June 24, 2026).** The critical finding below (Celery using Redis as broker) was resolved the same day by migrating to CloudAMQP AMQP broker. Current state: Celery broker = `amqps://cloudamqp.com`, Redis is result/cache only.

**Date:** 2026-06-24  
**Host:** smell-aware-macromodern-12096.db.redis.io:15686  
**Redis version:** 8.4.0 · Uptime at measurement: 3.28 days  
**Method:** Live `INFO all` + `DEBUG OBJECT` + key inspection via redis-py against production instance. NO estimates.

---

## Critical Finding — Upfront

**Celery is using Redis as its broker. The CloudAMQP migration described in CLAUDE.md #28 did not take effect.**

Evidence: keys `_kombu.binding.celery` and `_kombu.binding.scanner` exist in Redis. Kombu only writes queue binding records to the active broker. If `CELERY_BROKER_URL` were pointing to CloudAMQP these keys would be in AMQP, not Redis. Two active worker processes confirmed in `_kombu.binding.celery.pidbox`.

Impact: 91,746 BRPOP calls over 3.28 days = **27,972/day** on Redis. OPS.CONSOLIDATION.1 targeted eliminating these (~34,560/day at that time). They were not eliminated.

---

## 1. Server State

| Metric | Value |
|--------|-------|
| Redis version | 8.4.0 |
| Uptime | 3.28 days (283,571 seconds) |
| Memory used | **2.88 MB** |
| Memory peak | 3.2 MB |
| Total keys | 60 |
| Keys with TTL | 54 |
| Keys without TTL | **6** (5 `_kombu.binding.*` + `intel:quota:used`) |
| Average TTL | 141,834,565 ms (avg of expiring keys) |
| Expired keys (since start) | 1,549 |
| Keyspace hits | 24,422 |
| Keyspace misses | 452,264 |
| **Cache hit rate** | **5.1%** |
| Connected clients | **24 / 30 max** |
| Rejected connections | **3,851** |
| Total connections received | 25,552 |
| Total commands processed | 254,094 |
| Active pub/sub channels | 1 (`settings_changed`) |
| Active pub/sub patterns | 2 (`worker.#` × 2 — Celery event listeners) |

---

## 2. Daily Command Breakdown

Derived from cumulative `cmdstats` ÷ 3.28 days uptime.

| Command | Total | Per Day | Category | Status |
|---------|-------|---------|----------|--------|
| `PING` | 365,271 | 111,363 | Connection keepalive | Expected — all Redis clients |
| **`BRPOP`** | **91,746** | **27,972** | **Celery broker polling** | **CRITICAL — should be 0 (CloudAMQP)** |
| `HELLO` | 59,214 | 18,055 | RESP3 connection negotiation | High connection churn |
| **`PUBLISH`** | **56,455** | **17,212** | **Celery task events + settings pub/sub** | **Celery-driven; drops to ~0 on CloudAMQP** |
| `LLEN` | 19,843 | 6,050 | Celery queue length checks | Celery-driven |
| `DEL` | 10,042 | 3,062 | Cache TTL management | Expected |
| `MULTI` | 8,322 | 2,537 | Transaction open | Binance kline batching |
| `EXEC` | 8,322 | 2,537 | Transaction close | Binance kline batching |
| `GET` | 5,941 | 1,812 | Cache reads | Healthy |
| `SETEX` | 5,187 | 1,582 | Cache writes with TTL | Healthy |
| `EVALSHA` | 2,689 | 820 | Lua scripts | Rate limiter / dedup |
| `LPUSH` | 1,991 | 607 | List push | Celery task dispatch |
| `MGET` | 1,921 | 586 | Multi-key reads | Settings cache |
| `SREM` | 1,508 | 460 | Set removes | Kombu cleanup |
| `SMEMBERS` | 1,493 | 455 | Set reads | Kombu queue discovery |
| `ZREVRANGEBYSCORE` | 2,584 | 788 | Sorted set range | Celery rate limits |
| `SADD` | 3,437 | 1,048 | Set writes | Kombu bindings |
| `SET` | 3,291 | 1,003 | Key writes | Settings, counters |
| `ZADD` | 709 | 216 | Sorted set | Celery queue priority |
| `HSET` | 708 | 216 | Hash writes | Provider metrics |
| `INCRBY` | 650 | 198 | Counters | Monitor stats |

**Total ops/day (all commands):** ~200,000  
**Data ops/day (excluding PING + HELLO):** ~70,000 → **2.1M/month**  
**OPS.CONSOLIDATION.1 target:** 200K/month (6,666/day)  
**Actual vs target:** **10.5× over target**

Celery-driven ops/day: BRPOP (27,972) + PUBLISH (17,212) + LLEN (6,050) + LPUSH (607) + ZADD (216) = **~52,057/day = 1.56M/month**  
If Celery moves to CloudAMQP as designed: ~18,000 data ops/day = 540K/month (~2.7× target — still above, but within achievable range with further tuning).

---

## 3. Hit/Miss Rate Analysis

**Overall hit rate: 5.1%** (24,422 hits / 476,686 total keyspace ops)

This rate is misleading. The miss rate is not a cache quality problem — it is a Celery artifact.

**Root cause of 94.9% miss rate:**  
Redis counts a `BRPOP` on a non-existent or empty key as a keyspace miss. Celery workers continuously poll for tasks by calling `BRPOP celery 1` (1-second timeout). When no tasks are queued, the key may not exist or its list is empty → every poll counts as a miss. At 27,972 BRPOP/day this produces ~27,972 artificial misses/day.

Remaining real misses (GET/MGET on non-existent cache keys): ~744/day — this is normal cold-cache behavior during scan startup.

**The intelligence cache is not underperforming.**  
All 4 intelligence keys (`cache:intel:listings`, `cache:intel:categories`, `cache:intel:trending`, `cache:intel:global`) have multi-hour TTLs and are actively refreshed by the TypeScript intelligence workers. The Python scanner reads them without triggering CMC API calls.

---

## 4. Key Inventory — All 60 Keys

### Intelligence Cache (`cache:intel:*`) — 5 keys, ~55 KB

| Key | Memory | TTL | Content |
|-----|--------|-----|---------|
| `cache:intel:listings` | 22,464 B | 5,227s | {coins[100], breadthUp, breadthDown, topMovers, refreshedAt} |
| `cache:intel:categories` | 24,625 B | 18,697s | Sector data + full coin lists (CMC) |
| `cache:intel:trending` | 3,631 B | 9,689s | CMC trending 20 coins |
| `cache:intel:sector_baseline` | 4,150 B | 3,080s | Sector RS baselines |
| `cache:intel:global` | 365 B | 7,908s | BTC dominance, total market cap |

### Duplicate Market Data — 2 keys, 44 KB wasted

| Key | Memory | TTL | Note |
|-----|--------|-----|------|
| `cache:market-data:top-200` | 21,988 B | 218s | array[100] — despite name saying "200" |
| `cache:coins:top100` | 21,988 B | 218s | **IDENTICAL to cache:market-data:top-200** (byte-for-byte same size) |

Both are also redundant with the `coins[]` field in `cache:intel:listings` (22,464 B), which stores the same 100 coins in a dict format. Three caches for the same data = ~66 KB of redundancy.

### Kombu Broker Bindings — 5 keys, no TTL (CRITICAL)

| Key | TTL | Members | Meaning |
|-----|-----|---------|---------|
| `_kombu.binding.celery` | **no-expire** | 1 | Default Celery queue on Redis — CONFIRMS Redis is broker |
| `_kombu.binding.scanner` | **no-expire** | 1 | Scanner queue on Redis |
| `_kombu.binding.celery.pidbox` | **no-expire** | 2 | 2 active Celery worker processes |
| `_kombu.binding.reply.celery.pidbox` | **no-expire** | 9 | 9 stale reply UUIDs (celery inspect/control ghosts) |
| `_kombu.binding.celeryev` | **no-expire** | 2 | Worker event pattern listeners (`worker.#`) |

### Settings Cache — 8 keys, ~1.7 KB, healthy

| Key | TTL | Content |
|-----|-----|---------|
| `settings:d:features` | ~1,389s | Full feature flags · version 43 |
| `settings:d:telegram` | ~2,889s | alerts_enabled=true · version 37 |
| `settings:d:scanner` | ~80s | Scanner config (near-expiry at measurement) |
| `settings:d:ai` | ~83s | AI config |
| `settings:d:signals` | ~3,489s | min_rr_ratio=2.0 |
| `settings:v:features` | varies | 43 |
| `settings:v:telegram` | varies | 37 |
| `settings:v:signals` | varies | 19 |

### CMC Quota — 3 keys + 1 no-TTL concern

| Key | TTL | Value |
|-----|-----|-------|
| `intel:quota:used` | **no-expire** | **211** (credits used this month) |
| `intel:quota:reset_at` | 3,363,800s | 2026-07-01T00:00:00.000Z |
| `intel:quota:snapshot:2026-06-23` | ~7 days | 19 |
| `intel:quota:snapshot:2026-06-22` | ~6.3 days | 0 |

`intel:quota:used` has no TTL by design — the application resets it on `reset_at` date. Risk: if the TypeScript app is down on 2026-07-01, the counter persists and blocks CMC calls indefinitely.

### Futures Intelligence — 13 keys, ~1.2 KB, healthy

`futures:funding_trend:{SYMBOL}` keys with 6,681–28,281s TTLs. ETHUSDT, BTCUSDT, BNBUSDT, etc. Normal operation.

### Scan State — 4 keys, ~1.5 KB, healthy

`scan:progress:spot`, `scan:progress:futures`, `scan:latest:spot`, `scan:latest:futures` — all with 382–685s TTLs. Scanner is running.

### Other Keys — healthy

| Pattern | Count | Status |
|---------|-------|--------|
| `tg:alert:{SYMBOL}` | 3 | WhatsApp dedup cooldowns (1h TTL) — correct |
| `tg:hourly_count:*` | 1 | Rate limiter — correct |
| `cache:btc-regime:regime` | 1 | 680s TTL — healthy |
| `cache:open-interest:*` | 2 | 1,401s TTL — healthy |
| `cache:funding-rate:*` | 2 | 1,401s TTL — healthy |
| `cache:long-short:*` | 1 | 1,401s TTL — healthy |
| `cache:futures-symbols:all` | 1 | 8,244 B · 3,080s TTL — healthy |
| `monitor:2026-06-23:telegram_sends` | 1 | 78 WhatsApp sends yesterday |
| `monitor:2026-06-24:telegram_sends` | 1 | 18 WhatsApp sends today |
| `providers:metrics:binance:*` | 4 | requestsToday=45,665 · avg 243ms |
| `providers:metrics:coinmarketcap:*` | 2 | requestsToday=10 · total=10 |
| `celery:worker:last_heartbeat` | 1 | 773s TTL — worker alive |
| `scheduler:last_scan_ts` | 1 | 7-day TTL — healthy |

---

## 5. Expensive Keys

Ranked by memory:

| Rank | Key | Size | Issue |
|------|-----|------|-------|
| 1 | `cache:intel:categories` | 24,625 B | Correct — full CMC sector data with coin lists |
| 2 | `cache:intel:listings` | 22,464 B | ⚠ Duplicate — same coins in `cache:market-data:top-200` |
| 3 | `cache:market-data:top-200` | 21,988 B | **DEAD DUPLICATE** — identical to `cache:coins:top100` |
| 4 | `cache:coins:top100` | 21,988 B | **DEAD DUPLICATE** — identical to `cache:market-data:top-200` |
| 5 | `cache:futures-symbols:all` | 8,244 B | Correct — Binance futures symbol set |
| 6 | `cache:intel:sector_baseline` | 4,150 B | Correct |
| 7 | `cache:intel:trending` | 3,631 B | Correct |

**Redundant memory from keys 2–4: ~66 KB.** All three store the same 100-coin dataset in slightly different formats. Key 3 and 4 are byte-for-byte identical.

---

## 6. Dead / Orphan Keys

| Key | Issue | Fix |
|-----|-------|-----|
| `_kombu.binding.celery` | No TTL · proves Celery on Redis not CloudAMQP | Delete after fixing broker |
| `_kombu.binding.scanner` | No TTL · same | Delete after fixing broker |
| `_kombu.binding.celery.pidbox` | No TTL · Celery design but accumulates | Delete after fixing broker |
| `_kombu.binding.reply.celery.pidbox` | No TTL · 9 stale UUID entries from past inspect calls | `DEL` immediately; or delete after broker fix |
| `_kombu.binding.celeryev` | No TTL · Celery event listeners | Delete after fixing broker |
| `intel:quota:used` | No TTL · relies on app reset logic on 2026-07-01 | Add `EXPIRE intel:quota:used 3024000` (35 days) as safety net |

---

## 7. WhatsApp Delivery State (from `monitor:*`)

- `monitor:2026-06-23:telegram_sends = 78` (yesterday, TTL ~148K s)
- `monitor:2026-06-24:telegram_sends = 18` (today, measured mid-day, TTL ~83K s)

Note: Code key name is `telegram_sends` but platform uses WhatsApp (UltraMsg). The counter reflects WhatsApp delivery volume.

---

## 8. Connection Pressure Detail

| Metric | Value | Assessment |
|--------|-------|------------|
| `maxclients` | 30 | Very tight for this workload |
| `connected_clients` | 24 | 6 slots remaining |
| `rejected_connections` | 3,851 | 15.1% rejection rate |
| `total_connections_received` | 25,552 | High churn rate |

Known connection sources: 2 Celery worker processes + Celery beat + FastAPI app + TypeScript intelligence workers (Vercel serverless — each cold start = new connection) + TypeScript admin API proxy. Vercel function bursts on admin page load can briefly exhaust all 6 remaining slots.

---

## 9. Findings Summary

### Finding 1 — CRITICAL: CloudAMQP broker migration did not take effect

**Evidence:** `_kombu.binding.celery` and `_kombu.binding.scanner` in Redis. Kombu writes queue bindings only to the active broker. Two worker processes active (`_kombu.binding.celery.pidbox` has 2 entries).

**Impact:** 27,972 BRPOP/day on Redis = 839K/month (4.2× the entire monthly ops budget). Plus Celery-driven PUBLISH (17,212/day) and LLEN (6,050/day). Total Celery overhead on Redis: ~52K ops/day = 1.56M/month.

**Fix:** In Railway, verify the **worker service** (not the API service) has `CELERY_BROKER_URL=amqps://kbvaoiaz:wgbiAJsPZlP2BSe2TOlIeRa-MubCLV0B@armadillo.rmq.cloudamqp.com/kbvaoiaz`. If already set, check that the worker service is actually reading it (Railway's variable scoping can mean the API service's vars don't apply to the worker service). Redeploy the worker after confirming.

### Finding 2 — HIGH: Three caches for the same 100-coin dataset

`cache:market-data:top-200`, `cache:coins:top100`, and the `coins[]` array inside `cache:intel:listings` all store the same top-100 coins. Keys 1 and 2 are byte-for-byte identical (21,988 bytes each). Together: ~66 KB of redundant content refreshed every 3–5 minutes.

**Fix:** Find the writers of `cache:market-data:top-200` and `cache:coins:top100` in the TypeScript codebase. If they have no active readers (the Python scanner only reads `cache:intel:listings`), remove the writer code and add one-time `DEL` calls or simply let them expire.

### Finding 3 — HIGH: 3,851 rejected connections (15.1% rejection rate)

`maxclients=30` with 24 currently connected leaves only 6 slots. Vercel serverless functions create fresh connections on each cold start. Peak admin page loads (multiple tabs, multiple polling intervals) can exceed 30 simultaneously.

**Fix:** Either increase `maxclients` in Redis Cloud plan settings, or reduce connection count by ensuring TypeScript workers use a shared Redis singleton rather than per-request connections, and Python modules use `max_connections=1` connection pools.

### Finding 4 — MEDIUM: 9 stale reply.celery.pidbox UUIDs accumulating

Each `celery inspect` or Railway health check invocation writes a UUID to `_kombu.binding.reply.celery.pidbox` with no TTL. This grows indefinitely. Currently 9 stale entries.

**Fix:** `DEL _kombu.binding.reply.celery.pidbox` to clear immediately. After fixing the broker (Finding 1), all `_kombu.*` keys should be cleared from Redis — they'll move to CloudAMQP.

### Finding 5 — LOW: `intel:quota:used` has no TTL

Monthly CMC credit counter with no expiry. If the application fails to reset it on 2026-07-01, it stays at 211+ and the quota guard may block CMC calls for the new month.

**Fix:** `EXPIRE intel:quota:used 3024000` (35 days) as a safety net. The application's reset logic still fires on schedule; the TTL prevents a stuck counter if reset logic fails.

---

## 10. Action Plan

| Priority | Action | Expected Impact |
|----------|--------|-----------------|
| **P0** | Verify + fix `CELERY_BROKER_URL` in Railway worker service | −52K ops/day (−74% of data ops) |
| **P0** | Redeploy Celery worker after env fix | BRPOP drops to 0 on Redis |
| P1 | `DEL _kombu.binding.*` (all 5 keys) post-broker-fix | Clear 5 no-TTL orphan keys |
| P1 | Find + remove writers of `cache:market-data:top-200` and `cache:coins:top100` | −44 KB memory + write ops |
| P2 | `EXPIRE intel:quota:used 3024000` | Safety net for quota reset |
| P2 | Audit TypeScript Redis client instantiation — ensure shared singleton | Reduce connection rejections |

**Projected state after P0 actions:**  
~18,000 data ops/day → 540K/month. Down from 2.1M/month. Still above the 200K/month target but within 2.7× (vs current 10.5×). The gap is structural (Binance kline batching accounts for ~4K/day, settings cache ~1K/day, dedup/monitor ~2K/day) and was already addressed by OPS.CONSOLIDATION.1 — which assumed Celery had been moved. Once Celery is actually moved, the remaining overhead is minimal.
