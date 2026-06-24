# CMC.REMOVAL.IMPLEMENTATION.1

**Prepared:** June 2026  
**Status:** COMPLETE — all 5 parts implemented and tested  
**Goal:** Prepare SignalEdge to operate after the CMC Startup Plan expires with zero signal-generation changes.

---

## Background

CMC Startup Plan costs ~$79/month. The Free plan (10,000 credits/month) covers `/listings/latest` + `/global-metrics` (≈4,320 credits/month) but blocks `/cryptocurrency/categories` (Trending + sector data). Without intervention, Startup expiry would break sector intelligence and leave the scanner with no coin universe fallback.

**Hard constraints:** No signal logic changes. No probability engine changes. No gate changes.

---

## Architecture Summary

```
BEFORE (Startup):
  CMC Startup API (/categories, /listings, /trending)
    ↓  TypeScript workers → Redis
    ↓  Python scanner reads Redis

AFTER (Free plan):
  CMC Free (/listings, /global) + CoinGecko (/markets, /search/trending, /coins/categories)
    ↓  TypeScript workers → Redis           [ changed: CG fallback for plan-restricted endpoints ]
    ↓  Python scanner reads Redis
    ↓  Postgres (cmc_sectors, coins)        [ NEW: last-resort fallback ]
```

The TypeScript intelligence workers already call CMC — they now fall through to CoinGecko when a CMC endpoint returns 402/403 (plan restriction). The Python scanner's `intelligence_cache.py` already reads Redis — it now has a full fallback chain when Redis is cold:

- **Listings**: Redis → CMC direct (CMC Free `/listings/latest` still works) → CoinGecko → Postgres `coins` table
- **Categories**: Redis → Postgres `cmc_sectors` (full `coins[]` membership preserved from CMC capture)

---

## Part A — Database Schema

**File:** `database/cmc-backup-migration.sql`  
**Run:** In Supabase SQL Editor **before** the Startup plan expires.

### Tables created

| Table | Purpose | Critical field |
|-------|---------|---------------|
| `cmc_sectors` | Full sector/category records from CMC | `coins TEXT[]` — full member list (not CG top-3 image URLs) |
| `coin_sector_assignments` | Normalized coin→sector lookup | O(1) lookup by symbol |
| `symbol_mappings` | Cross-service IDs: CMC ↔ Binance ↔ CoinGecko | Supersedes hardcoded `COINGECKO_TO_BINANCE` map |
| `coin_rankings_history` | Daily rank + mcap tier snapshots (90-day retention) | Source of truth for mcap tiers after CMC expiry |

### RLS policies
- `service_role`: full access (Celery worker uses `SERVICE_ROLE_KEY`)
- `anon`: read-only on `cmc_sectors` + `symbol_mappings` (dashboard telemetry)

### Verify after running:
```sql
SELECT COUNT(*) FROM cmc_sectors;              -- expect ≥150
SELECT COUNT(*) FROM coin_sector_assignments;   -- expect ≥3,000
SELECT COUNT(*) FROM symbol_mappings;           -- expect ≥200
SELECT COUNT(*) FROM coin_rankings_history;     -- expect ≥200
```

---

## Part B — Sync Jobs

### One-time capture (run before plan expiry)

**File:** `backend/core/scanner/cmc_backup.py`

```python
# Via Celery (preferred — handles retries)
from backend.workers.scan_task import capture_cmc_backup
capture_cmc_backup.delay()

# Direct (emergency)
import asyncio
from backend.core.scanner.cmc_backup import capture_full_backup
asyncio.run(capture_full_backup())
```

**Cost:** ~2 CMC Startup credits. Run once.  
**What it captures:** All CMC categories with full `coins[]` lists + top-200 listings with symbol mappings.

### Nightly refresh (automatic after expiry)

**Celery task:** `backend.workers.scan_task.refresh_cmc_backup`  
**Beat schedule:** `01:00 UTC` daily  
**Cost:** 0 CMC credits (reads Redis `cache:intel:listings` already populated by TypeScript workers)

What it does:
1. Reads `cache:intel:listings` Redis key → upserts today's `coin_rankings_history` row
2. Calls CoinGecko `/coins/categories` → updates `market_cap_change_24h` in `cmc_sectors`
3. **Never overwrites `coins[]`** — CoinGecko only returns top-3 image URLs, not symbols

### Weekly sector heartbeat (automatic)

**Celery task:** `backend.workers.scan_task.refresh_sector_membership`  
**Beat schedule:** `Sunday 02:00 UTC`  
**Cost:** 0 CMC credits (CoinGecko only)

Updates `cmc_sectors.refreshed_at` timestamps. CoinGecko can't expand `coins[]` (image URLs only) — this task is primarily a liveness check.

---

## Part C — Scanner Fallback Chain

### Listings (coin universe)

```
Redis cache:intel:listings          (TypeScript workers, refreshed every 15 min)
  ↓ miss
CMC direct Python call              (if COINMARKETCAP_API_KEY set — Free plan allows /listings)
  ↓ fail
CoinGecko /coins/markets            (free, returns 250 coins per call)
  ↓ fail / empty
Postgres coins table                (snapshot from last successful scan — NEW)
  ↓ empty
Return []                           (scan proceeds with 0 coins — logged)
```

**Changed files:**
- `backend/core/scanner/intelligence_cache.py` — added `_fallback_db_listings()` function; wired as last-resort after CoinGecko in `read_intelligence_listings()`

### Categories (sector data)

```
Redis cache:intel:categories        (TypeScript workers)
  ↓ miss / error
Postgres cmc_sectors table          (CMC backup — preserves full coins[] — NEW)
  ↓ empty
Return ([], "")                     (scan continues with no sector data)
```

**Changed files:**
- `backend/core/scanner/intelligence_cache.py` — added `_fallback_db_sectors()` function; replaces the previous `return [], ""` dead-end

### TypeScript intelligence workers

**Changed files:**
- `lib/intelligence/workers.ts` — added `_cgFetchTrending()`, `_cgFetchCategories()`, `_cgFetchGlobal()` CoinGecko fallbacks; each tick function tries CMC first then falls back to CoinGecko on failure
- `lib/intelligence/quota-guard.ts` — `MONTHLY_BUDGET` updated from 300,000 → 10,000 (CMC Free plan limit)

**Important:** `tickCategories()` CoinGecko fallback writes `coins: []` to Redis (CoinGecko only returns image URLs). When Redis categories have `coins: []`, the Python scanner falls through to `_fallback_db_sectors()` which returns the full `coins[]` from Postgres. This is by design — Redis holds performance metrics; Postgres holds membership.

---

## Part D — Simulation Tests

**File:** `backend/core/scanner/tests/test_cmc_removal_simulation.py`  
**Tests:** 7 scenarios

| Test | Scenario | Expected |
|------|---------|---------|
| `test_listings_redis_cache_hit` | Redis has data | Returns from Redis, no external calls |
| `test_listings_falls_back_to_coingecko_on_redis_miss` | Redis miss | CoinGecko fallback called |
| `test_listings_falls_back_to_postgres_when_coingecko_fails` | Redis + CG fail | Postgres fallback returns coins |
| `test_categories_falls_back_to_postgres` | Redis categories cold | Postgres `cmc_sectors` used |
| `test_fallback_db_sectors_returns_full_coin_list` | Postgres categories | Full `coins[]` returned (not top-3) |
| `test_full_outage_returns_empty_not_crash` | All sources down | Returns empty list, no exception raised |
| `test_partial_postgres_data_still_allows_scan` | 10 stale Postgres coins | Scan proceeds with 10 coins |

Run:
```bash
cd d:/simulation-engine/new-ai-trade
python -m pytest backend/core/scanner/tests/test_cmc_removal_simulation.py -v
```

---

## Part E — Migration Checklist

### Step 1: Before plan expiry (do this now)

- [x] Run `database/cmc-backup-migration.sql` in Supabase SQL Editor *(done June 24, 2026)*
- [ ] Verify table creation: `SELECT COUNT(*) FROM cmc_sectors;` → expect ≥150
- [ ] **Trigger one-time CMC backup** (ONLY REMAINING ACTION): `capture_cmc_backup.delay()` from Railway shell
- [ ] Verify backup: `SELECT COUNT(*), MAX(refreshed_at) FROM coin_sector_assignments;`
- [ ] Confirm `cmc_sectors.coins` has data: `SELECT name, array_length(coins, 1) FROM cmc_sectors LIMIT 5;`

### Step 2: Deploy code changes

Files changed in this implementation:

| File | Change | Status |
|------|--------|--------|
| `database/cmc-backup-migration.sql` | NEW — 4 tables + RLS policies | ✓ deployed |
| `backend/core/scanner/cmc_backup.py` | NEW — capture + refresh functions | ✓ deployed |
| `backend/core/scanner/intelligence_cache.py` | Added `_fallback_db_listings()` + `_fallback_db_sectors()` | ✓ deployed |
| `backend/workers/scan_task.py` | Added 3 Celery tasks | ✓ deployed |
| `backend/workers/beat_schedule.py` | Added 2 beat schedule entries | ✓ deployed |
| `lib/intelligence/workers.ts` | Added CoinGecko fallback functions + updated tick handlers | ✓ deployed |
| `lib/intelligence/quota-guard.ts` | Updated `MONTHLY_BUDGET` 300K → 10K | ✓ deployed |
| `backend/core/scanner/tests/test_cmc_removal_simulation.py` | NEW — 7 simulation tests (7/7 pass) | ✓ deployed |

- [x] Deploy Railway backend (Python changes) *(commit `ecd8b1a`, June 24, 2026)*
- [x] Deploy Vercel (TypeScript changes) *(commit `b90b8b3`, June 24, 2026)*
- [ ] Monitor Railway logs for `cmc_categories_plan_restricted_falling_back_to_coingecko` — confirms fallback is active
- [ ] Monitor for `intel_db_listings_fallback_ok` — confirms Postgres fallback reachable (should NOT appear in normal operation)

### Step 3: After plan expiry / downgrade

- [ ] Set Railway env var `COINMARKETCAP_PLAN=free` (optional, for monitoring clarity)
- [ ] Watch for `quota_seeded_from_cmc_key_info` in logs — confirms Free quota (10,000) is seeded correctly
- [ ] Run 1 full scan cycle and verify `KLINE_EMPTY` gate rejection count does not spike
- [ ] Check Signals dashboard — signal count should be within normal range (within 20% of 7-day average)
- [ ] Monitor `cache_source` in scan logs:
  - `redis_intelligence` = normal
  - `coingecko_fallback` = CMC endpoint blocked (expected)
  - `db_fallback` = Redis AND CoinGecko both failed (investigate)
  - `empty` = all sources failed (alert)

---

## Rollback Plan

### If Postgres tables cause issues

The Postgres fallback only activates when Redis + CoinGecko are both unavailable — a rare state. In normal operation, the fallback functions are never reached.

To disable without reverting code: the fallback functions are self-contained — they fail open (return empty list) if Postgres is unavailable. No toggle needed.

### If TypeScript CoinGecko fallback causes quota issues

CoinGecko Free plan: 10–30 requests/minute. The intelligence workers tick every 5 minutes (4 workers). At ~12 CG calls/hour this is well within limits.

If CoinGecko rate-limits: the fallback functions will raise → the tick handler catches and logs → Redis key retains its last value (TTL 6× normal = 30 minutes) → scanner reads stale but valid data.

### If CMC Free quota is exceeded

The TypeScript `QuotaGuard` (updated to 10,000/month) will stop consuming credits when the budget is reached. Workers fall through to CoinGecko automatically — no manual intervention.

Emergency: temporarily set `MONTHLY_BUDGET = 0` in `lib/intelligence/quota-guard.ts` and redeploy → all workers switch to CoinGecko immediately.

### Reverting to Startup plan

To revert: update `MONTHLY_BUDGET` back to 300,000 in `quota-guard.ts`. All CMC endpoints will be re-enabled automatically (workers prefer CMC when `canConsume()` returns true). No database changes needed.

---

## Ops Budget Impact

| Source | Ops before | Ops after | Change |
|--------|-----------|-----------|--------|
| CMC credits/month | 300,000 (Startup) | ≤4,320 (Free: listings+global) | −98.6% |
| CoinGecko API calls/day | ~0 | ~48 (fallback only) | negligible |
| Postgres queries/day | 0 | ~1 (nightly ranking upsert) | negligible |
| Redis ops | unchanged | unchanged | — |
| CloudAMQP messages/month | unchanged | +30 (2 new beat tasks) | negligible |

**Net savings:** ~$79/month CMC Startup plan cancellation.
