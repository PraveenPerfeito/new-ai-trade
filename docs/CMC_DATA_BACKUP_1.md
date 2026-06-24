# CMC.DATA.BACKUP.1 — CoinMarketCap Data Backup: Schema & Nightly Strategy

**Date:** 2026-06-24  
**Objective:** Capture all low-changing CMC datasets before Startup plan expires; store locally with nightly refresh strategy.  
**Sources:** `database/schema.sql` · `backend/core/scanner/intelligence_cache.py` · `backend/core/scanner/trend_score.py` · `backend/workers/beat_schedule.py`

---

## Executive Summary

**The critical gap is sector membership.** CMC's `/cryptocurrency/categories` returns the full list of coins per sector. CoinGecko's equivalent returns only the top 3 per category. The Python scanner's `sector_status` field — which feeds TrendScore (+5–15 pts) and the WhatsApp sector line — requires this full membership to correctly assign coins to sectors. Once the Startup plan expires this data is no longer refreshable from CMC; capture it now and fall back to the Postgres snapshot thereafter.

Four new tables extend the existing `coins` table without modifying it:

| Table | What it stores | Priority |
|-------|---------------|----------|
| `cmc_sectors` | Full category metadata + complete `coins[]` | P0 critical |
| `coin_sector_assignments` | Normalized coin → sector rows | P0 critical |
| `symbol_mappings` | CMC ID ↔ Binance pair ↔ CoinGecko ID | P1 |
| `coin_rankings_history` | Daily rank + mcap tier snapshots (90-day) | P1 |

---

## Data Inventory

| Dataset | CMC Endpoint | Change Frequency | On CMC Free? | CoinGecko Substitute | Backup Table | Priority |
|---------|-------------|-----------------|--------------|----------------------|-------------|----------|
| Full sector coin lists | `/cryptocurrency/categories` | Monthly (membership) | No — CG top-3 only | `/coins/categories` → top_3_coins | `cmc_sectors.coins[]` | **P0** |
| Sector performance | `/cryptocurrency/categories` | Hourly | No | `market_cap_change_24h` proxy | `cmc_sectors` | **P0** |
| Coin → sector assignments | `/cryptocurrency/categories` | Monthly | No | Partial (top-3) | `coin_sector_assignments` | **P0** |
| Symbol mappings (CMC ↔ Binance ↔ CG) | `/cryptocurrency/listings/latest` | Rarely | Yes | Binance exchangeInfo + CG | `symbol_mappings` | P1 |
| CMC rank + mcap tier snapshots | `/cryptocurrency/listings/latest` | Daily | Yes | `/coins/markets` | `coin_rankings_history` | P1 |
| Futures availability | Not CMC — Binance `/fapi/v1/exchangeInfo` | Weekly | N/A | Already Binance-sourced | Already in `coins.has_futures` | No action |
| Coin metadata (name, description, logo) | `/cryptocurrency/info` | Rarely | No | `/coins/{id}` per-coin | Already in `coins.name` (partial) | P2 optional |

**Time-sensitive:** Once CMC Startup plan expires, `/cryptocurrency/categories` is blocked on Free plan. The full `coins[]` array per sector is only available now. Run the one-time capture task before the plan rolls over.

---

## Database Schema

Migration file: `database/cmc-backup-migration.sql`

### Table 1: `cmc_sectors`

Full sector/category records. `coins[]` is the critical backup column.

```sql
CREATE TABLE IF NOT EXISTS cmc_sectors (
    id                     SERIAL PRIMARY KEY,
    category_id            TEXT    NOT NULL UNIQUE,   -- CMC ID or CG slug
    name                   TEXT    NOT NULL,           -- "DeFi", "Layer 1", etc.
    title                  TEXT,                       -- CMC full title (optional)
    market_cap             NUMERIC(22, 2),
    market_cap_change_24h  NUMERIC(10, 4),             -- CG proxy for avg_price_change after cutover
    avg_price_change       NUMERIC(10, 4),             -- direct from CMC; NULL after Free-plan cutover
    coin_count             INT     NOT NULL DEFAULT 0,
    coins                  TEXT[]  NOT NULL DEFAULT '{}',  -- ALL symbols — the critical backup field
    refreshed_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    source                 TEXT    NOT NULL DEFAULT 'cmc'  -- 'cmc' | 'coingecko' | 'manual'
);

CREATE INDEX IF NOT EXISTS idx_cmc_sectors_refreshed ON cmc_sectors (refreshed_at DESC);
```

### Table 2: `coin_sector_assignments`

Normalized coin → sector rows. Scanner reads this when `cache:intel:categories` is cold.

```sql
CREATE TABLE IF NOT EXISTS coin_sector_assignments (
    symbol       TEXT        NOT NULL,
    category_id  TEXT        NOT NULL,  -- FK → cmc_sectors.category_id
    sector_name  TEXT        NOT NULL,  -- denormalized for fast lookup
    assigned_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    source       TEXT        NOT NULL DEFAULT 'cmc',
    PRIMARY KEY (symbol, category_id)
);

CREATE INDEX IF NOT EXISTS idx_csa_symbol ON coin_sector_assignments (symbol);
CREATE INDEX IF NOT EXISTS idx_csa_cat    ON coin_sector_assignments (category_id);
```

### Table 3: `symbol_mappings`

Canonical cross-service translation. Supersedes the hardcoded `COINGECKO_TO_BINANCE` map in `lib/market-data/binance-symbols.ts`.

```sql
CREATE TABLE IF NOT EXISTS symbol_mappings (
    symbol             TEXT PRIMARY KEY,         -- uppercase: BTC, ETH, SOL
    cmc_id             INT,                       -- CMC numeric ID
    cmc_slug           TEXT,                      -- bitcoin, ethereum
    binance_spot       TEXT,                      -- BTCUSDT
    binance_futures    TEXT,                      -- BTCUSDT (perp; may differ)
    coingecko_id       TEXT,                      -- bitcoin, ethereum
    is_stablecoin      BOOLEAN NOT NULL DEFAULT false,
    is_active          BOOLEAN NOT NULL DEFAULT true,
    last_verified_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sm_cmc_id      ON symbol_mappings (cmc_id);
CREATE INDEX IF NOT EXISTS idx_sm_cg_id       ON symbol_mappings (coingecko_id);
CREATE INDEX IF NOT EXISTS idx_sm_active      ON symbol_mappings (is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_sm_binance_spot ON symbol_mappings (binance_spot);
```

### Table 4: `coin_rankings_history`

Daily rank + mcap tier snapshots. 90-day retention.

```sql
CREATE TABLE IF NOT EXISTS coin_rankings_history (
    id               BIGSERIAL PRIMARY KEY,
    symbol           TEXT    NOT NULL,
    cmc_rank         INT,
    market_cap       NUMERIC(22, 2),
    volume_24h       NUMERIC(22, 2),
    price_change_24h NUMERIC(8, 4),
    mcap_tier        TEXT,              -- MEGA | LARGE | MID | SMALL | MICRO
    snapshot_date    DATE NOT NULL DEFAULT CURRENT_DATE,
    source           TEXT NOT NULL DEFAULT 'cmc'
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_crh_uq     ON coin_rankings_history (symbol, snapshot_date);
CREATE INDEX        IF NOT EXISTS idx_crh_date   ON coin_rankings_history (snapshot_date DESC);
CREATE INDEX        IF NOT EXISTS idx_crh_symbol ON coin_rankings_history (symbol);

-- Retention enforced in nightly Celery task:
-- DELETE FROM coin_rankings_history WHERE snapshot_date < CURRENT_DATE - 90;
```

### Market Cap Tier Constants

Thresholds mirror `backend/core/scanner/trend_score.py` `_score_market_cap_tier()`:

| Tier | Market Cap Range | TrendScore Pts |
|------|-----------------|---------------|
| MEGA | ≥ $100B | 5.0 |
| LARGE | $10B – $100B | **8.0** (highest) |
| MID | $1B – $10B | 6.0 |
| SMALL | $200M – $1B | 4.0 |
| MICRO | < $200M | 1.0 |

---

## One-Time Capture

### New file: `backend/core/scanner/cmc_backup.py`

```python
"""
CMC.DATA.BACKUP.1 — one-time capture + nightly refresh.
Run capture_full_backup() once before Startup plan expires.
"""
import asyncio
from typing import Any
import httpx
from backend.config import get_settings
from backend.database.session import get_pool
from backend.logging.setup import get_logger

log = get_logger(__name__)

CMC_BASE    = "https://pro-api.coinmarketcap.com/v1"
CMC_TIMEOUT = 30

# Thresholds mirror trend_score.py _score_market_cap_tier()
_MCAP_TIERS = [
    (100_000_000_000, "MEGA"),
    ( 10_000_000_000, "LARGE"),
    (  1_000_000_000, "MID"),
    (    200_000_000, "SMALL"),
]

_STABLECOINS = {"USDT", "USDC", "DAI", "BUSD", "USDE",
                "FDUSD", "TUSD", "USDP", "PYUSD", "USDD"}

def _mcap_tier(market_cap: float | None) -> str:
    if not market_cap:
        return "MICRO"
    for threshold, tier in _MCAP_TIERS:
        if market_cap >= threshold:
            return tier
    return "MICRO"


async def capture_sectors(api_key: str) -> dict[str, Any]:
    """Fetch /cryptocurrency/categories → cmc_sectors + coin_sector_assignments."""
    async with httpx.AsyncClient(timeout=CMC_TIMEOUT) as client:
        resp = await client.get(
            f"{CMC_BASE}/cryptocurrency/categories",
            headers={"X-CMC_PRO_API_KEY": api_key},
            params={"limit": 200, "convert": "USD"},
        )
        resp.raise_for_status()
        categories = resp.json().get("data", [])

    pool = await get_pool()
    sectors_written = assignments_written = 0

    async with pool.acquire() as conn:
        for cat in categories:
            coins = [c["symbol"].upper() for c in (cat.get("coins") or [])]
            await conn.execute("""
                INSERT INTO cmc_sectors
                    (category_id, name, title, market_cap, market_cap_change_24h,
                     avg_price_change, coin_count, coins, refreshed_at, source)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now(),'cmc')
                ON CONFLICT (category_id) DO UPDATE SET
                    avg_price_change      = EXCLUDED.avg_price_change,
                    market_cap_change_24h = EXCLUDED.market_cap_change_24h,
                    market_cap            = EXCLUDED.market_cap,
                    coin_count            = EXCLUDED.coin_count,
                    coins                 = EXCLUDED.coins,
                    refreshed_at          = now(),
                    source                = 'cmc'
            """,
                cat["id"], cat["name"], cat.get("title"),
                cat.get("market_cap"), cat.get("market_cap_change"),
                cat.get("avg_price_change"), len(coins), coins,
            )
            sectors_written += 1

            for sym in coins:
                await conn.execute("""
                    INSERT INTO coin_sector_assignments
                        (symbol, category_id, sector_name, assigned_at, source)
                    VALUES ($1,$2,$3,now(),'cmc')
                    ON CONFLICT (symbol, category_id) DO UPDATE SET
                        sector_name = EXCLUDED.sector_name,
                        assigned_at = now(), source = 'cmc'
                """, sym, cat["id"], cat["name"])
                assignments_written += 1

    log.info("cmc_backup_sectors_captured",
             sectors=sectors_written, assignments=assignments_written)
    return {"sectors": sectors_written, "assignments": assignments_written}


async def capture_listings(api_key: str) -> dict[str, Any]:
    """Fetch /cryptocurrency/listings/latest → symbol_mappings + coin_rankings_history."""
    async with httpx.AsyncClient(timeout=CMC_TIMEOUT) as client:
        resp = await client.get(
            f"{CMC_BASE}/cryptocurrency/listings/latest",
            headers={"X-CMC_PRO_API_KEY": api_key},
            params={"limit": 200, "convert": "USD"},
        )
        resp.raise_for_status()
        listings = resp.json().get("data", [])

    pool = await get_pool()
    mappings_written = rankings_written = 0

    async with pool.acquire() as conn:
        for coin in listings:
            sym  = coin["symbol"].upper()
            usd  = coin["quote"]["USD"]
            mcap = usd.get("market_cap")

            await conn.execute("""
                INSERT INTO symbol_mappings
                    (symbol, cmc_id, cmc_slug, binance_spot, is_stablecoin, last_verified_at)
                VALUES ($1,$2,$3,$4,$5,now())
                ON CONFLICT (symbol) DO UPDATE SET
                    cmc_id           = EXCLUDED.cmc_id,
                    cmc_slug         = EXCLUDED.cmc_slug,
                    binance_spot     = COALESCE(symbol_mappings.binance_spot, EXCLUDED.binance_spot),
                    last_verified_at = now()
            """,
                sym, coin["id"], coin.get("slug"),
                f"{sym}USDT", sym in _STABLECOINS,
            )
            mappings_written += 1

            await conn.execute("""
                INSERT INTO coin_rankings_history
                    (symbol, cmc_rank, market_cap, volume_24h, price_change_24h,
                     mcap_tier, snapshot_date, source)
                VALUES ($1,$2,$3,$4,$5,$6,CURRENT_DATE,'cmc')
                ON CONFLICT (symbol, snapshot_date) DO UPDATE SET
                    cmc_rank=EXCLUDED.cmc_rank, market_cap=EXCLUDED.market_cap,
                    volume_24h=EXCLUDED.volume_24h, price_change_24h=EXCLUDED.price_change_24h,
                    mcap_tier=EXCLUDED.mcap_tier, source='cmc'
            """,
                sym, coin["cmc_rank"], mcap,
                usd.get("volume_24h"),
                usd.get("percent_change_24h"),
                _mcap_tier(mcap),
            )
            rankings_written += 1

    log.info("cmc_backup_listings_captured",
             mappings=mappings_written, rankings=rankings_written)
    return {"mappings": mappings_written, "rankings": rankings_written}


async def capture_full_backup() -> dict[str, Any]:
    """Entry point for one-time pre-expiry capture. ~2 CMC credits."""
    settings = get_settings()
    api_key  = settings.coinmarketcap_api_key
    if not api_key:
        raise RuntimeError("COINMARKETCAP_API_KEY not configured")

    cats     = await capture_sectors(api_key)
    listings = await capture_listings(api_key)
    log.info("cmc_full_backup_complete", **cats, **listings)
    return {**cats, **listings}
```

### Trigger via Celery task

Add to `backend/workers/scan_task.py`:

```python
@shared_task(name="backend.workers.scan_task.capture_cmc_backup")
def capture_cmc_backup():
    """One-time capture. Run before CMC Startup plan expires."""
    from backend.core.scanner.cmc_backup import capture_full_backup
    return asyncio.run(capture_full_backup())
```

**Trigger command (Railway):**
```
celery -A backend.workers.celery_app call backend.workers.scan_task.capture_cmc_backup
```

**Verify success:**
```sql
SELECT COUNT(*) FROM cmc_sectors;           -- expect ~150–200
SELECT COUNT(*) FROM coin_sector_assignments; -- expect ~3,000–8,000
SELECT COUNT(*) FROM symbol_mappings;        -- expect ~200
SELECT COUNT(*) FROM coin_rankings_history;  -- expect ~200
```

---

## Nightly Refresh Strategy

### Schedule (add to `backend/workers/beat_schedule.py`)

```python
# CMC.DATA.BACKUP.1 — nightly rankings snapshot + sector performance
"refresh-cmc-backup-nightly": {
    "task": "backend.workers.scan_task.refresh_cmc_backup",
    "schedule": crontab(hour="1", minute="0"),   # 01:00 UTC (after attribution-snapshots at 00:15)
    "options": {"expires": 3600},
},
# CMC.DATA.BACKUP.1 — weekly sector membership partial update from CoinGecko
"refresh-sector-membership-weekly": {
    "task": "backend.workers.scan_task.refresh_sector_membership",
    "schedule": crontab(day_of_week="0", hour="2", minute="0"),  # Sunday 02:00 UTC
    "options": {"expires": 7200},
},
```

### What each schedule does

| Schedule | What runs | Source | Updates |
|----------|-----------|--------|---------|
| **Nightly 01:00 UTC** | `run_nightly_refresh()` | Redis `cache:intel:listings` + CoinGecko `/coins/categories` | `coin_rankings_history` (today's row) + `cmc_sectors.market_cap_change_24h` (performance proxy); prunes rows >90d |
| **Weekly Sunday 02:00 UTC** | `run_sector_membership_refresh()` | CoinGecko `/coins/categories` | Appends new coins from `top_3_coins[]` to `cmc_sectors.coins[]` — never removes (removals require manual verification) |
| **One-time (before expiry)** | `capture_full_backup()` | CMC Startup `/categories` + `/listings/latest` | All 4 tables — full coin lists, sector assignments, symbol mappings, initial rankings |
| **Static — no refresh** | Symbol mappings | CMC capture | CMC IDs and slugs don't change for existing coins |

### Nightly refresh implementation (add to `cmc_backup.py`)

```python
async def run_nightly_refresh() -> dict[str, Any]:
    """
    Nightly: upsert today's coin_rankings_history from Redis listings cache.
    Refreshes cmc_sectors performance from CoinGecko /coins/categories.
    Does NOT touch coins[] — full membership protected from CG top-3 overwrite.
    """
    import json
    from backend.core.scanner.market_fetcher import get_redis_client

    pool   = await get_pool()
    redis  = get_redis_client()
    result = {"rankings": 0, "sectors_refreshed": 0}

    # 1. Rankings from Redis intel cache (populated every 15 min by TS worker)
    raw = await redis.get("cache:intel:listings")
    if raw:
        snap  = json.loads(raw)
        coins = snap.get("coins", [])
        async with pool.acquire() as conn:
            for c in coins:
                sym  = c.get("symbol", "").upper()
                mcap = c.get("marketCap") or c.get("market_cap")
                await conn.execute("""
                    INSERT INTO coin_rankings_history
                        (symbol, cmc_rank, market_cap, volume_24h, price_change_24h,
                         mcap_tier, snapshot_date, source)
                    VALUES ($1,$2,$3,$4,$5,$6,CURRENT_DATE,'redis_cache')
                    ON CONFLICT (symbol, snapshot_date) DO NOTHING
                """,
                    sym, c.get("rank"), mcap,
                    c.get("volume24h") or c.get("volume_24h"),
                    c.get("priceChange24h") or c.get("price_change_24h"),
                    _mcap_tier(mcap),
                )
                result["rankings"] += 1
            # Prune old rows
            await conn.execute("""
                DELETE FROM coin_rankings_history
                WHERE snapshot_date < CURRENT_DATE - 90
            """)

    # 2. Sector performance proxy from CoinGecko (updates market_cap_change_24h only)
    async with httpx.AsyncClient(timeout=20) as client:
        try:
            resp = await client.get(
                "https://api.coingecko.com/api/v3/coins/categories",
                timeout=15,
            )
            categories = resp.json() if resp.status_code == 200 else []
        except Exception as exc:
            log.warning("cmc_backup_cg_categories_failed", error=str(exc))
            categories = []

    if categories:
        async with pool.acquire() as conn:
            for cat in categories:
                # Update performance metrics only — never overwrite coins[] from CG
                await conn.execute("""
                    UPDATE cmc_sectors SET
                        market_cap            = $2,
                        market_cap_change_24h = $3,
                        refreshed_at          = now(),
                        source                = 'coingecko'
                    WHERE name ILIKE $1 OR category_id = $4
                """,
                    cat.get("name"), cat.get("market_cap"),
                    cat.get("market_cap_change_24h"), cat.get("id"),
                )
                result["sectors_refreshed"] += 1

    log.info("cmc_backup_nightly_refresh_complete", **result)
    return result
```

---

## Scanner Integration

### P0: `backend/core/scanner/intelligence_cache.py` — `read_categories()` DB fallback

`read_categories()` currently returns `([], "")` on cache miss. Add DB fallback:

```python
async def _fallback_db_sectors() -> tuple[list, str]:
    """Query cmc_sectors when cache:intel:categories is cold."""
    try:
        from backend.database.session import get_pool
        pool = await get_pool()
        async with pool.acquire() as conn:
            rows = await conn.fetch("""
                SELECT category_id, name, avg_price_change,
                       market_cap_change_24h, coins, refreshed_at
                FROM cmc_sectors
                WHERE coin_count > 0
                ORDER BY refreshed_at DESC
            """)
        if not rows:
            return [], ""
        categories = [
            {
                "id": r["category_id"], "name": r["name"],
                "avg_price_change": r["avg_price_change"]
                    or r["market_cap_change_24h"],  # CG proxy fallback
                "market_cap_change": r["market_cap_change_24h"],
                "coins": [{"symbol": s} for s in (r["coins"] or [])],
            }
            for r in rows
        ]
        age_s = (0 if not rows else
            (datetime.now(timezone.utc) - rows[0]["refreshed_at"]).total_seconds())
        log.info("categories_db_fallback", count=len(categories), age_s=round(age_s))
        return categories, "db_backup"
    except Exception as exc:
        log.warning("categories_db_fallback_failed", error=str(exc))
        return [], ""
```

In `read_categories()`, change the cache-miss return:
```python
# Before:
return [], ""
# After:
return await _fallback_db_sectors()
```

---

## Implementation Checklist

### Before Startup plan expires (P0 — do now)

- [ ] Run `database/cmc-backup-migration.sql` in Supabase SQL Editor
- [ ] Create `backend/core/scanner/cmc_backup.py`
- [ ] Add `capture_cmc_backup` Celery task to `scan_task.py`
- [ ] Trigger capture on Railway before plan rollover
- [ ] Verify: `SELECT COUNT(*) FROM cmc_sectors` ≥ 150; `coin_sector_assignments` ≥ 3,000

### After capture (P0 — scanner integration)

- [ ] Patch `read_categories()` in `intelligence_cache.py` with DB fallback
- [ ] Add `refresh_cmc_backup` + `refresh_sector_membership` Celery tasks to `scan_task.py`
- [ ] Add nightly + weekly beat entries to `beat_schedule.py`

### After plan expiry (P1 — verify)

- [ ] Confirm `tickTrending()` and `tickCategories()` catch blocks active (CMC_FREE_PLAN_READINESS_1 Stage 1)
- [ ] Verify `cmc_sectors.refreshed_at` updates nightly
- [ ] Verify `sector_status` appears on WhatsApp alerts

---

*See also: `docs/CMC_FREE_PLAN_READINESS_1.md` — plan migration strategy*  
*See also: `docs/archive/CMC_REDIS_TRUTH_1.md` — historical Redis optimization*
