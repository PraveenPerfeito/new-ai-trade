# Redis Optimization Audit Log

---

## Phase REDIS.OPTIMIZE.1 — Current Phase (June 2026)

**Baseline:** ~430K ops/month (after Phase 7.2B.10 reductions)  
**Target:** <250K ops/month  
**Required reduction:** ~42%  
**Projected savings:** ~175–190K ops/month across 7 fixes

### Hotspot Summary

| Rank | Key / Endpoint | Ops/Month | Root Cause |
|------|---------------|-----------|------------|
| 1 | `/health/ready` (Railway polls ~60s) | ~86,400 | PING + GET heartbeat on every health check |
| 2 | `intel:quota:snapshot:{date}` write | ~42,480 | SET on every `/api/analytics/monitor` call (should be hourly) |
| 3 | `worker-heartbeat` beat task | ~43,200 | SETEX every 60s; 300s threshold means 120s is fine |
| 4 | `settings:generation` GET | ~43,200 | Gen check every 60s per worker; 120s is safe |
| 5 | CMC worker quota `consume()` pipeline | ~56,160 | 3 ops per tick × 624 ticks/day (correct — see note) |
| 6 | `cache:intel:hits/misses:*` INCRs + GETs | ~31,680 | Cosmetic dashboard counters; Prometheus already records this |
| 7 | `monitor:scan_durations` lpush+ltrim | ~14,400 | List written every scan; never read anywhere |
| 8 | Monitoring `_incr()` EXPIRE on every call | ~15,780 | EXPIRE runs on each INCR even after TTL is set |

> **Note on CMC workers (rank 5):** The 624 ticks/day and 3-op pipelines are correct behaviour — CMC worker architecture requires this. No change needed; listed for visibility.

### Fix Tracking

| ID | Status | Savings/Month | File | Change |
|----|--------|---------------|------|--------|
| O1 | ⬜ PENDING | ~43,200 | `backend/api/health.py` | Add 90s in-process cache for `/health/ready` result |
| O2 | ⬜ PENDING | ~15,780 | `backend/analytics/monitoring.py` | Skip EXPIRE in `_incr()` after first call per day per metric key |
| O3 | ⬜ PENDING | ~21,600 | `backend/workers/beat_schedule.py` | Heartbeat schedule `60.0 → 120.0` seconds |
| O4 | ⬜ PENDING | ~21,600 | `backend/system_settings/service.py` | `_GEN_CHECK_INTERVAL = 60.0 → 120.0` |
| O5 | ⬜ PENDING | ~42,480 | `backend/analytics/monitoring.py` | Quota snapshot write: once per hour, not per monitoring call |
| O6 | ⬜ PENDING | ~14,400 | `backend/analytics/monitoring.py` | Remove `monitor:scan_durations` lpush+ltrim (key never read) |
| O7 | ⬜ PENDING | ~31,680 | `intelligence_cache.py`, `telemetry.ts` | Remove hit/miss Redis INCRs; cache page shows age instead of hit rate |

**P0 (no UX impact):** O3, O4, O5, O6 → saves ~99,480 ops/month → 430K → ~330K  
**P1 (tiny code change):** + O1, O2 → saves ~58,980 more → 330K → ~271K  
**P2 (UI update):** + O7 → saves ~31,680 more → 271K → **~239K ✅ under 250K**

### Fix Details

#### O1 — Health check in-process cache (`backend/api/health.py`)
`/health/ready` is called every ~60s by Railway. Each call: `redis.ping()` + `redis.get("celery:worker:last_heartbeat")` = 2 Redis ops. With a 90s in-process module-level cache, Railway calls (every 60s) alternate: miss → hit → miss → hit → 50% reduction.
- Add module-level `_readiness_cache: dict = {"result": None, "expires_at": 0.0}`
- Cache TTL: 90s (heartbeat threshold is 300s; 90s is safe)
- Skip Redis checks and return cached result if `time.time() < expires_at`

#### O2 — Skip EXPIRE after first `_incr()` per day (`backend/analytics/monitoring.py`)
`_incr()` runs `INCRBY + EXPIRE` on every call. The TTL only needs to be set once per day per metric key. After that, re-running EXPIRE is wasted ops.
- Add module-level `_initialized_keys: set[str] = set()`
- In `_incr()`: include `pipe.expire()` only if `key not in _initialized_keys`, then add to set
- Key includes today's date so the set naturally becomes stale at midnight; clear on date change

#### O3 — Heartbeat interval 60s → 120s (`backend/workers/beat_schedule.py`)
`"schedule": 60.0` → `"schedule": 120.0`. The `/health/ready` threshold is 300s — a 120s heartbeat gives 2.5× safety margin before the worker is considered dead.

#### O4 — Settings gen check 60s → 120s (`backend/system_settings/service.py`)
`_GEN_CHECK_INTERVAL = 60.0` → `_GEN_CHECK_INTERVAL = 120.0`. Settings change at most a few times per day (admin patches). 120s propagation window is undetectable in practice.

#### O5 — Quota snapshot write: once per hour (`backend/analytics/monitoring.py`)
`get_monitoring_snapshot()` line 189 runs `await redis.set("intel:quota:snapshot:{today}", ...)` on **every call**. This is the write path for the rolling CMC credit history. It needs to be written at most once per hour (the rolling average is computed over days).
- Add module-level `_last_snapshot_hour: int = -1`
- Only write if `datetime.now().hour != _last_snapshot_hour`, then update `_last_snapshot_hour`

#### O6 — Remove `monitor:scan_durations` list (`backend/analytics/monitoring.py`)
`record_scan()` lines 87–88: `await redis.lpush(...)` + `await redis.ltrim(...)`. Grep confirms nothing reads `monitor:scan_durations` anywhere. The dashboard reads `monitor:last_scan_duration_ms` (a separate key). Delete both lines.

#### O7 — Remove intelligence hit/miss counters (`intelligence_cache.py` + `telemetry.ts`)
**Python side:** Remove `await redis.incr(INTEL_HITS_KEY)` from `read_intelligence_listings()`, `read_trending_coins()`, `read_categories()`. Prometheus counters (`intelligence_cache_hits_total`) already record this.  
**TypeScript side (`telemetry.ts`):** Remove `redis.get(groupHitsKey(name))` and `redis.get(groupMissesKey(name))` from the `Promise.all`. Update return object: set `hitCount: 0, missCount: 0, hitRate: 0`.  
**Cache page:** Replace "Hit Rate: X%" display with "Age: Xm Ys / Fresh|Stale" (already computed from `ageSeconds` and `isStale`).  
**`cache-groups.ts`:** Remove `groupHitsKey()` and `groupMissesKey()` exports if they become unused.

---

## Phase 7.2B.10 — Completed (May 2026)

**Date:** 2026-05-31  
**Baseline:** 615K commands/month (Upstash dashboard)  
**Target:** < 300K commands/month  
**Required reduction:** > 51%

---

## Verdict

**6 single-line/two-line changes across 5 files achieve >51% reduction.**  
Expected outcome after QUICK WINs: **615K → ~250K/month**.

---

## Top 20 Redis Consumers

| Rank | Consumer | File | Daily (est.) | Monthly (est.) | % of 615K |
|------|---------|------|-------------|----------------|-----------|
| 1 | Scan progress per-coin (2 setex × every coin) | `orchestrator.py:341` | ~9,700 | ~291,000 | 47.3% |
| 2 | infra_collector.py scrape every 30s (3 ops) | `infra_collector.py:25` | 8,640 | 259,200 | 42.1% |
| 3 | Cache page polling every 10s (18 ops/call) | `cache/page.tsx:128` | ~3,240 | ~97,200 | 15.8% |
| 4 | Scanner page status poll every 8s (5 ops/call) | `scanner/page.tsx:165` | ~2,250 | ~67,500 | 11.0% |
| 5 | Settings gen check every 5s during scans | `service.py:42` | ~2,000 | ~60,000 | 9.8% |
| 6 | Intelligence workers TS write cycle | `workers.ts` | 2,896 | 86,880 | 14.1% |
| 7 | Futures data cache (always-miss, TTL < cadence) | `redis_cache.py` | ~4,800 | ~144,000 | 23.4% |
| 8 | Overview fetchAll every 15s (50 ops/call) | `overview/page.tsx:102` | ~1,500 | ~45,000 | 7.3% |
| 9 | Hit/miss INCR counters per scan | `intelligence_cache.py` | ~900 | ~27,000 | 4.4% |
| 10 | Scheduler lock acquire/release/check | `coordinator.py` | 768 | 23,040 | 3.7% |
| 11 | Sector baseline cache (get + setex) | `sector_intelligence.py` | 96 | 2,880 | 0.5% |
| 12 | BTC 4h change cache reads | `market_fetcher.py` | 192 | 5,760 | 0.9% |
| 13 | Futures symbols cache reads | `market_fetcher.py` | 192 | 5,760 | 0.9% |
| 14 | Telegram dedup keys (exists + setex) | `telegram_notifier.py` | ~288 | ~8,640 | 1.4% |
| 15 | Settings invalidation on writes | `service.py:166` | ~25 | ~750 | 0.1% |
| 16 | Provider config key reads | `providers.py:61` | ~50 | ~1,500 | 0.2% |
| 17 | Quota minute-log sorted set ops | `quota-guard.ts` | ~600 | ~18,000 | 2.9% |
| 18 | Failover log lpush/ltrim | `manager.ts` | ~10 | ~300 | 0.1% |
| 19 | Fallback counter/alert throttle | `intelligence_cache.py` | ~10 | ~300 | 0.1% |
| 20 | Provider config write on control changes | `providers.py:67` | ~5 | ~150 | 0.0% |

---

## Top 10 Optimization Opportunities

### OPT-1 — Scan Progress: Per-coin → Milestone-based (QUICK WIN)

**File:** `backend/core/scanner/orchestrator.py:341`

**Problem:** `_set_progress(progress)` is called once per coin in the results loop — 2 setex commands per coin. A standard scan with 80 coins generates 166 Redis ops just for progress tracking. The dashboard only needs ~5 data points to animate a progress bar.

**Current:** 80 coins × 2 setex + 3 overhead = **166 ops/scan**  
**After:** update every 10 coins → 8 updates + 3 overhead = **22 ops/scan** (89% reduction)

```python
# backend/core/scanner/orchestrator.py — inside results loop
if progress.scanned % 10 == 0 or progress.scanned == progress.total:
    await _set_progress(progress)
```

| | Before | After |
|--|--------|-------|
| Ops/standard scan | 166 | 22 |
| Monthly savings | | **~259,200** |

**Risk:** Progress bar updates in 10-coin steps instead of 1-coin steps.  
**Complexity:** 2-line change.

---

### OPT-2 — infra_collector Interval 30s → 5 min (QUICK WIN)

**File:** `backend/metrics/infra_collector.py:25`

**Problem:** `_INTERVAL = 30` means Redis memory + 2 queue depth reads fire 2,880 times/day, 24/7. Redis memory and Celery queue depth are slow-moving metrics — 5-minute granularity is sufficient.

```python
_INTERVAL = 300    # was 30
```

| | Before | After |
|--|--------|-------|
| Ticks/day | 2,880 | 288 |
| Ops/day | 8,640 | 864 |
| Monthly savings | | **~234,720** |

**Risk:** Prometheus gauges update every 5 min instead of 30s. No operational impact.  
**Complexity:** 1-line change.

---

### OPT-3 — Settings Gen Check 5s → 30s (QUICK WIN)

**File:** `backend/system_settings/service.py:42`

**Problem:** `_GEN_CHECK_INTERVAL = 5.0` means the service fires `GET settings:generation` up to once every 5 seconds during scans. With 80 AI validations over a 5-min scan, this generates ~60 Redis GETs per scan just to check whether settings changed (they almost never do).

```python
_GEN_CHECK_INTERVAL = 30.0    # was 5.0
```

| | Before | After |
|--|--------|-------|
| Gen check GETs per scan | ~60 | ~10 |
| Monthly savings | | **~50,000** |

**Risk:** Settings changes propagate within 30s instead of 5s. Acceptable — in-memory TTL is also 30s.  
**Complexity:** 1-line change.

---

### OPT-4 — Scanner Status Poll 8s → 30s (QUICK WIN)

**File:** `app/admin/scanner/page.tsx:165`

**Problem:** `setInterval(fetchStatus, 8_000)` polls `/api/scheduler/status` at 8-second intervals. Each call triggers `SchedulerCoordinator.status()` = 5 Redis ops (GET enabled + 3 EXISTS locks + GET last_ts). The scheduler runs on 15-30 minute cycles — 8s granularity adds no value.

```typescript
const t1 = setInterval(fetchStatus, 30_000)   // was 8_000
```

| | Before (1h/day open) | After |
|--|---------------------|-------|
| Calls/min | 7.5 | 2 |
| Ops/day | 2,250 | 600 |
| Monthly savings | | **~99,000** |

**Risk:** Status dot on scanner page updates every 30s. Countdown timer (1s interval using `last_scan_at`) is unaffected.  
**Complexity:** 1-line change.

---

### OPT-5 — Cache Page Poll 10s → 60s (QUICK WIN)

**File:** `app/admin/cache/page.tsx:128`

**Problem:** `useAutoRefresh(fetchTelemetry, 10_000)` polls cache intelligence every 10s. Each call reads 5 group keys + 10 hit/miss counters + 3 quota keys = 18 Redis ops. Cache group TTLs range from 5 min to 6 hours — nothing changes in 10 seconds.

```typescript
useAutoRefresh(fetchTelemetry, 60_000)    // was 10_000
```

| | Before (1h/day open) | After |
|--|---------------------|-------|
| Calls/min | 6 | 1 |
| Monthly savings | | **~162,000** |

**Risk:** Cache freshness indicators on the cache page update every 60s. Purely cosmetic.  
**Complexity:** 1-line change.

---

### OPT-6 — Futures Cache TTL Alignment (MEDIUM EFFORT)

**File:** `backend/cache/redis_cache.py`

**Problem:** `oi_cache` TTL = 2 min, `funding_cache` = 5 min, `ls_cache` = 5 min. Futures scan cadence = 30 min. Result: **every futures scan is a 100% cache miss** for all 50 coins (previous data expired 25 min ago). Each miss = 2 Redis ops (GET miss + SET).

**Fix:** Set TTLs slightly above scan cadence so the next scan reuses the previous scan's data:

```python
# backend/cache/redis_cache.py
oi_cache       = RedisCache("open-interest", ttl_seconds=32 * 60)   # was 2 min
funding_cache  = RedisCache("funding-rate",  ttl_seconds=32 * 60)   # was 5 min
ls_cache       = RedisCache("long-short",    ttl_seconds=32 * 60)   # was 5 min
```

| | Before | After |
|--|--------|-------|
| Ops/futures scan | ~400 (all miss) | ~155 (1 miss scan/day + hits) |
| Monthly savings | | **~99,000** |

**Risk:** Signal analysis uses 30-min-old funding/OI/LS data. These metrics change on hour-scale (funding rate cycle = 8h). 32-min data is valid for signal scoring.  
**Complexity:** 3-line change.

---

### OPT-7 — Scheduler Status Caching (MEDIUM EFFORT)

**File:** `backend/scheduler/coordinator.py`

**Problem:** `status()` makes 5 independent Redis reads every call. Multiple pages poll this endpoint. Cache the assembled dict in Redis for 5s, returning it with 1 GET on subsequent calls.

```python
def status(self) -> dict:
    cached = self._redis.get("scheduler:status_cache")
    if cached:
        return json.loads(cached)
    result = { ... }  # existing logic
    self._redis.setex("scheduler:status_cache", 5, json.dumps(result))
    return result
```

Invalidate on `enable()`, `disable()`, `acquire_scan_lock()`, `release_scan_lock()`.

| | Before | After |
|--|--------|-------|
| Ops/call (steady state) | 5 | ~1.05 |
| Monthly savings | | **~158,000** |

**Risk:** Status max 5s stale. State-change events invalidate immediately.  
**Complexity:** Medium — requires invalidation on every state change.

---

### OPT-8 — Remove Provider Health from Overview fetchAll (LOW-MEDIUM)

**File:** `app/admin/overview/page.tsx`

**Problem:** Overview page's `fetchAll` (15s) calls `/api/health/providers` which runs `_get_metrics()` pipeline × 6 providers = 24 Redis commands per call. Provider health belongs on the providers page (polled at 30s), not the overview.

Remove `fetch('/api/health/providers')` from the overview's `fetchAll` callback.

| | Before (0.5h/day) | After |
|--|------------------|-------|
| Redis ops removed | 24/call × 4/min × 30min = 2,880 | 0 |
| Monthly savings | | **~86,400** |

**Risk:** Overview page loses provider health strip. Providers page still shows full health at 30s.  
**Complexity:** Low for removal; medium to replace with a lighter summary.

---

### OPT-9 — Batch hit/miss INCR Counters (MEDIUM)

**File:** `backend/core/scanner/intelligence_cache.py`

**Problem:** `redis.incr()` fires on every cache read in the hot scan path. Accumulate counts locally and flush via `INCRBY` pipeline once per scan.

```python
_hit_counts = defaultdict(int)
_miss_counts = defaultdict(int)

async def _flush_counters(redis) -> None:
    pipe = redis.pipeline()
    for group, n in _hit_counts.items():
        if n: pipe.incrby(f"cache:intel:hits:{group}", n)
    for group, n in _miss_counts.items():
        if n: pipe.incrby(f"cache:intel:misses:{group}", n)
    _hit_counts.clear(); _miss_counts.clear()
    await pipe.execute()
```

Monthly savings: **~10,000** (small but removes incr from hot path).  
**Complexity:** Medium.

---

### OPT-10 — Overview Poll 15s → 30s (QUICK WIN)

**File:** `app/admin/overview/page.tsx:102`

```typescript
const t = setInterval(fetchAll, 30_000)    // was 15_000
```

| | Before (0.5h/day) | After |
|--|------------------|-------|
| Calls/min | 4 | 2 |
| Monthly savings | | **~90,000** |

**Risk:** Overview data refreshes every 30s. All displayed data (market context, cache status, scanner state) changes on minute-to-hour scales.  
**Complexity:** 1-line change.

---

## Implementation Plan

### Phase A — QUICK WINs (implement now, <30 min total)

| File | Change | Savings/month |
|------|--------|--------------|
| `backend/core/scanner/orchestrator.py` | OPT-1: progress every 10 coins | ~259,200 |
| `backend/metrics/infra_collector.py` | OPT-2: `_INTERVAL = 300` | ~234,720 |
| `backend/system_settings/service.py` | OPT-3: `_GEN_CHECK_INTERVAL = 30.0` | ~50,000 |
| `app/admin/scanner/page.tsx` | OPT-4: `8_000 → 30_000` | ~99,000 |
| `app/admin/cache/page.tsx` | OPT-5: `10_000 → 60_000` | ~162,000 |
| `app/admin/overview/page.tsx` | OPT-10: `15_000 → 30_000` | ~90,000 |

**Total Phase A savings: ~894,920/month**  
**Expected result: 615K → ~240K/month** ✅

### Phase B — Medium effort (Phase 8)

| Change | Savings/month |
|--------|--------------|
| OPT-6: Futures cache TTL 2-5min → 32min | ~99,000 |
| OPT-7: Scheduler status cached response | ~158,000 |
| OPT-8: Remove providers from overview fetchAll | ~86,400 |

**Total Phase B additional savings: ~343,400/month**

---

## Safe vs Unsafe

### Safe (implement)

| Optimization | Why safe |
|-------------|---------|
| OPT-1 Progress milestones | Progress bar still works; scan correctness unchanged |
| OPT-2 infra_collector 5 min | Prometheus gauges are advisory |
| OPT-3 Gen check 30s | Emergency stop propagates within 30s (same as in-memory TTL) |
| OPT-4 Scanner poll 30s | Countdown uses local timestamp; scan data unaffected |
| OPT-5 Cache page 60s | Cache TTLs are 5-360 min; 60s refresh is adequate |
| OPT-6 Futures TTL 32min | Funding/OI/LS change on hour-scale |
| OPT-10 Overview 30s | All data changes on minute+ cycles |

### Unsafe (do NOT implement)

| What | Why not |
|------|---------|
| Remove `scan:progress:{id}` writes entirely | Breaks `/api/scanner/progress/{id}` endpoint |
| Extend scheduler lock TTL beyond 11 min | Scan overlap risk if worker restarts mid-scan |
| Cache `AISettings` without write invalidation | Emergency stop must propagate immediately |
| Set `oi_cache` TTL > 60 min | OI can shift 20-30% in an hour; stale data degrades signal quality |
| Remove Telegram dedup Redis keys | Correctness guarantee — removing causes spam |
| Disable intelligence workers | CMC cache cold = 100-coin CoinGecko fallback universe |

---

*Generated: Phase 7.2B.10 audit — 2026-05-31*  
*See also: [PROVIDER_ARCHITECTURE_AUDIT.md](PROVIDER_ARCHITECTURE_AUDIT.md)*
