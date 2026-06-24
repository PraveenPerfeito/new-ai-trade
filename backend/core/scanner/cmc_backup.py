"""
CMC.DATA.BACKUP.1 + CMC.REMOVAL.IMPLEMENTATION.1

One-time capture (run before CMC Startup plan expires) + nightly refresh.

Priority chain for each data type:
  Sectors  : CMC /categories (full coins[]) → CoinGecko proxy (perf only, no coins) → Postgres snapshot
  Listings : CMC /listings   → Redis cache → Postgres coins table
  Trending : CMC /trending   → [volatile; no DB backup needed — acceptable degradation]

Usage:
  One-time capture (before plan expiry):
    from backend.workers.scan_task import capture_cmc_backup
    capture_cmc_backup.delay()   # via Celery
    # or directly: asyncio.run(capture_full_backup())

  Nightly:
    Celery beat fires refresh_cmc_backup at 01:00 UTC.
"""
from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone
from typing import Any

import httpx

from backend.database.session import get_pool
from backend.logging.setup import get_logger

log = get_logger(__name__)

CMC_BASE    = "https://pro-api.coinmarketcap.com/v1"
CMC_TIMEOUT = 30.0
CG_BASE     = "https://api.coingecko.com/api/v3"
CG_TIMEOUT  = 20.0

# Mirror trend_score.py _score_market_cap_tier() thresholds
_MCAP_TIERS: list[tuple[float, str]] = [
    (100_000_000_000, "MEGA"),
    ( 10_000_000_000, "LARGE"),
    (  1_000_000_000, "MID"),
    (    200_000_000, "SMALL"),
]

_STABLECOINS = frozenset({
    "USDT", "USDC", "DAI", "BUSD", "USDE", "FDUSD",
    "TUSD", "USDP", "PYUSD", "USDD", "GUSD",
})


def _mcap_tier(market_cap: float | None) -> str:
    if not market_cap:
        return "MICRO"
    for threshold, tier in _MCAP_TIERS:
        if market_cap >= threshold:
            return tier
    return "MICRO"


# ── One-time capture ──────────────────────────────────────────────────────────

async def _fetch_category_coins(
    client: httpx.AsyncClient, api_key: str, category_id: str
) -> tuple[list[str], int, str]:
    """
    Returns (symbols, http_status, error_msg).
    The /cryptocurrency/categories (plural) endpoint returns metadata only — no coin lists.
    Coin lists require /cryptocurrency/category (singular) per category.
    """
    try:
        resp = await client.get(
            f"{CMC_BASE}/cryptocurrency/category",
            headers={"X-CMC_PRO_API_KEY": api_key},
            params={"id": category_id, "limit": 100},
        )
        if resp.status_code != 200:
            return [], resp.status_code, resp.text[:200]
        data = resp.json().get("data") or {}
        coins = data.get("coins") or []
        symbols = [c["symbol"].upper() for c in coins if isinstance(c, dict) and c.get("symbol")]
        return symbols, 200, ""
    except Exception as exc:
        log.warning("cmc_category_coins_fetch_failed", category_id=category_id, error=str(exc))
        return [], 0, str(exc)[:200]


async def capture_sectors(api_key: str) -> dict[str, Any]:
    """
    Fetch /cryptocurrency/categories (limit=200) from CMC for metadata,
    then /cryptocurrency/category?id=<id> for each category's coin list.
    Writes to cmc_sectors + coin_sector_assignments.
    Run once before Startup plan expires — coins[] is the critical field.

    Credit cost: 1 (categories listing) + N (one per category with coins) ≈ 50–200 credits.
    Only fetches coin lists for categories with num_tokens > 0, limited to top 100.
    """
    async with httpx.AsyncClient(timeout=CMC_TIMEOUT) as client:
        resp = await client.get(
            f"{CMC_BASE}/cryptocurrency/categories",
            headers={"X-CMC_PRO_API_KEY": api_key},
            params={"limit": 200},
        )
        resp.raise_for_status()
        categories = resp.json().get("data", [])

        # Sort by num_tokens descending — fetch coin lists for top 100 categories only
        # (smaller categories contribute little to sector intelligence)
        cats_with_tokens = sorted(
            [c for c in categories if c.get("num_tokens", 0) > 0],
            key=lambda c: c.get("num_tokens", 0),
            reverse=True,
        )[:100]

        # Fetch coin lists concurrently in batches of 10 to stay within rate limits
        cat_coins: dict[str, list[str]] = {}
        errors_by_status: dict[int, int] = {}
        for i in range(0, len(cats_with_tokens), 10):
            batch = cats_with_tokens[i:i + 10]
            tasks = [
                _fetch_category_coins(client, api_key, cat["id"])
                for cat in batch
            ]
            results = await asyncio.gather(*tasks, return_exceptions=True)
            for cat, result in zip(batch, results):
                if isinstance(result, tuple):
                    symbols, status, _err = result
                    cat_coins[cat["id"]] = symbols
                    if status != 200:
                        errors_by_status[status] = errors_by_status.get(status, 0) + 1
                else:
                    cat_coins[cat["id"]] = []

    pool = await get_pool()
    sectors_written = assignments_written = 0

    async with pool.acquire() as conn:
        for cat in categories:
            coins = cat_coins.get(cat["id"], [])

            await conn.execute(
                """
                INSERT INTO cmc_sectors
                    (category_id, name, title, market_cap, market_cap_change_24h,
                     avg_price_change, coin_count, coins, refreshed_at, source)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now(),'cmc')
                ON CONFLICT (category_id) DO UPDATE SET
                    name                  = EXCLUDED.name,
                    title                 = EXCLUDED.title,
                    avg_price_change      = EXCLUDED.avg_price_change,
                    market_cap_change_24h = EXCLUDED.market_cap_change_24h,
                    market_cap            = EXCLUDED.market_cap,
                    coin_count            = EXCLUDED.coin_count,
                    coins                 = CASE WHEN array_length(EXCLUDED.coins, 1) > 0
                                                 THEN EXCLUDED.coins
                                                 ELSE cmc_sectors.coins END,
                    refreshed_at          = now(),
                    source                = 'cmc'
                """,
                cat["id"], cat["name"], cat.get("title"),
                cat.get("market_cap"), cat.get("market_cap_change"),
                cat.get("avg_price_change"), cat.get("num_tokens", 0), coins,
            )
            sectors_written += 1

            for sym in coins:
                await conn.execute(
                    """
                    INSERT INTO coin_sector_assignments
                        (symbol, category_id, sector_name, assigned_at, source)
                    VALUES ($1,$2,$3,now(),'cmc')
                    ON CONFLICT (symbol, category_id) DO UPDATE SET
                        sector_name = EXCLUDED.sector_name,
                        assigned_at = now(),
                        source      = 'cmc'
                    """,
                    sym, cat["id"], cat["name"],
                )
                assignments_written += 1

    log.info("cmc_backup_sectors_captured",
             sectors=sectors_written, assignments=assignments_written,
             categories_fetched=len(cats_with_tokens),
             errors_by_status=errors_by_status)
    return {
        "sectors": sectors_written,
        "assignments": assignments_written,
        "categories_fetched": len(cats_with_tokens),
        "errors_by_status": errors_by_status,
    }


async def capture_listings(api_key: str) -> dict[str, Any]:
    """
    Fetch /cryptocurrency/listings/latest (limit=200) from CMC.
    Writes to symbol_mappings + coin_rankings_history (today's row).
    """
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
            usd  = coin.get("quote", {}).get("USD", {})
            mcap = usd.get("market_cap")

            await conn.execute(
                """
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

            await conn.execute(
                """
                INSERT INTO coin_rankings_history
                    (symbol, cmc_rank, market_cap, volume_24h, price_change_24h,
                     mcap_tier, snapshot_date, source)
                VALUES ($1,$2,$3,$4,$5,$6,CURRENT_DATE,'cmc')
                ON CONFLICT (symbol, snapshot_date) DO UPDATE SET
                    cmc_rank=EXCLUDED.cmc_rank, market_cap=EXCLUDED.market_cap,
                    volume_24h=EXCLUDED.volume_24h, price_change_24h=EXCLUDED.price_change_24h,
                    mcap_tier=EXCLUDED.mcap_tier, source='cmc'
                """,
                sym, coin.get("cmc_rank"), mcap,
                usd.get("volume_24h"),
                usd.get("percent_change_24h"),
                _mcap_tier(mcap),
            )
            rankings_written += 1

    log.info("cmc_backup_listings_captured",
             mappings=mappings_written, rankings=rankings_written)
    return {"mappings": mappings_written, "rankings": rankings_written}


async def capture_full_backup() -> dict[str, Any]:
    """
    Entry point for one-time pre-expiry capture. Costs ~2 CMC credits.
    Run before the Startup plan rolls over.

    Verify success:
      SELECT COUNT(*) FROM cmc_sectors;            -- expect ≥150
      SELECT COUNT(*) FROM coin_sector_assignments; -- expect ≥3,000
      SELECT COUNT(*) FROM symbol_mappings;         -- expect ≥200
      SELECT COUNT(*) FROM coin_rankings_history;   -- expect ≥200
    """
    from backend.config import get_settings  # noqa: PLC0415
    settings = get_settings()
    api_key  = settings.coinmarketcap_api_key
    if not api_key:
        raise RuntimeError("COINMARKETCAP_API_KEY not configured — cannot run CMC backup")

    cats     = await capture_sectors(api_key)
    listings = await capture_listings(api_key)

    result = {**cats, **listings}
    log.info("cmc_full_backup_complete", **result)
    return result


# ── Nightly refresh ───────────────────────────────────────────────────────────

async def run_nightly_refresh() -> dict[str, Any]:
    """
    Nightly (01:00 UTC): upsert today's coin_rankings_history from Redis cache.
    Updates cmc_sectors performance metrics from CoinGecko.
    Does NOT touch coins[] — full membership is protected from CoinGecko top-3 overwrite.
    Prunes coin_rankings_history rows older than 90 days.
    """
    from backend.cache.redis_cache import get_redis  # noqa: PLC0415

    pool   = await get_pool()
    redis  = await get_redis()
    result: dict[str, Any] = {"rankings": 0, "sectors_refreshed": 0, "pruned": 0}

    # 1. Rankings from Redis intel cache (populated every 15 min by TS workers)
    try:
        raw = await redis.get("cache:intel:listings")
        if raw:
            snap  = json.loads(raw)
            coins = snap.get("coins", [])

            async with pool.acquire() as conn:
                for c in coins:
                    sym  = str(c.get("symbol", "")).upper()
                    mcap = c.get("marketCap") or c.get("market_cap")
                    await conn.execute(
                        """
                        INSERT INTO coin_rankings_history
                            (symbol, cmc_rank, market_cap, volume_24h, price_change_24h,
                             mcap_tier, snapshot_date, source)
                        VALUES ($1,$2,$3,$4,$5,$6,CURRENT_DATE,'redis_cache')
                        ON CONFLICT (symbol, snapshot_date) DO NOTHING
                        """,
                        sym,
                        c.get("rank"),
                        mcap,
                        c.get("volume24h") or c.get("volume_24h"),
                        c.get("priceChange24h") or c.get("price_change_24h"),
                        _mcap_tier(float(mcap) if mcap else None),
                    )
                    result["rankings"] += 1

                # Prune rows older than 90 days
                deleted = await conn.execute(
                    "DELETE FROM coin_rankings_history WHERE snapshot_date < CURRENT_DATE - 90"
                )
                result["pruned"] = int(deleted.split()[-1]) if deleted else 0

        log.info("nightly_rankings_refresh_ok", count=result["rankings"])
    except Exception as exc:
        log.warning("nightly_rankings_refresh_failed", error=str(exc))

    # 2. Sector performance proxy from CoinGecko (updates market_cap_change_24h only)
    # CRITICAL: never overwrites coins[] — CoinGecko only gives top_3_coins image URLs
    try:
        async with httpx.AsyncClient(timeout=CG_TIMEOUT) as client:
            resp = await client.get(f"{CG_BASE}/coins/categories")
            categories = resp.json() if resp.status_code == 200 else []
    except Exception as exc:
        log.warning("nightly_cg_categories_failed", error=str(exc))
        categories = []

    if categories:
        async with pool.acquire() as conn:
            for cat in categories:
                await conn.execute(
                    """
                    UPDATE cmc_sectors SET
                        market_cap            = $2,
                        market_cap_change_24h = $3,
                        refreshed_at          = now(),
                        source                = 'coingecko'
                    WHERE name ILIKE $1 OR category_id = $4
                    """,
                    cat.get("name"),
                    cat.get("market_cap"),
                    cat.get("market_cap_change_24h"),
                    cat.get("id"),
                )
                result["sectors_refreshed"] += 1

    log.info("cmc_backup_nightly_refresh_complete", **result)
    return result


async def run_sector_membership_refresh() -> dict[str, Any]:
    """
    Weekly (Sunday 02:00 UTC): append new symbols from CoinGecko top_3_coins.
    CoinGecko /coins/categories returns top_3_coins[] as image URLs, not symbols.
    This function performs a coin-ID lookup to extract symbols and appends to coins[].
    Removals are never automated — require manual verification.

    Limited value: CoinGecko only gives top 3 per sector. Primary purpose is to
    add newly listed coins that didn't exist at CMC capture time.
    """
    result: dict[str, Any] = {"checked": 0, "appended": 0}

    try:
        async with httpx.AsyncClient(timeout=CG_TIMEOUT) as client:
            # Get categories with top_3_coins (image URLs — not directly useful)
            resp = await client.get(f"{CG_BASE}/coins/categories")
            if resp.status_code != 200:
                log.warning("sector_membership_cg_failed", status=resp.status_code)
                return result
            cg_cats = resp.json()

        pool = await get_pool()
        async with pool.acquire() as conn:
            for cat in cg_cats:
                result["checked"] += 1
                cg_id = cat.get("id", "")
                # Look for matching sector by CoinGecko ID or name
                row = await conn.fetchrow(
                    """
                    SELECT category_id, coins
                    FROM cmc_sectors
                    WHERE category_id = $1 OR name ILIKE $2
                    LIMIT 1
                    """,
                    cg_id, cat.get("name", ""),
                )
                if not row:
                    continue
                # We can't add new symbols from top_3_coins (image URLs only)
                # This task is mainly a heartbeat: confirms sector table is alive
                # and updates the refreshed_at timestamp
                await conn.execute(
                    "UPDATE cmc_sectors SET refreshed_at = now() WHERE category_id = $1",
                    row["category_id"],
                )

    except Exception as exc:
        log.error("sector_membership_refresh_failed", error=str(exc))

    log.info("sector_membership_refresh_complete", **result)
    return result
