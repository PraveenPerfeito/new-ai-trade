"""
Intelligence cache reader — Python side of the CMC intelligence pipeline.

Architecture:
  CMC API (Free plan: /listings/latest + /global-metrics)
    ↓  (TypeScript workers — lib/intelligence/workers.ts)
  Redis  cache:intel:listings  /  cache:intel:categories  /  cache:intel:trending
    ↓  (this module)
  Python Scanner → Signals

CMC plan priority: CMC Free → CoinGecko Free → Postgres snapshot.
The TypeScript quota guard is updated to 10,000 credits/month (Free plan).

Fallback chain — listings:
  Redis cache:intel:listings
    → CMC direct (Python, if key set — available on Free)
    → CoinGecko /coins/markets
    → Postgres coins table  (snapshot from last successful scan)
    → empty list

Fallback chain — categories / sectors:
  Redis cache:intel:categories
    → Postgres cmc_sectors  (CMC backup — preserves full coins[] membership)
    → empty list
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timezone

from backend.cache.redis_cache import get_redis
from backend.core.scanner.models import CoinData
from backend.logging.setup import get_logger
from backend.metrics.prometheus import (
    intelligence_cache_age_seconds,
    intelligence_cache_hits_total,
    intelligence_cache_misses_total,
)

log = get_logger(__name__)

# Redis key written by lib/intelligence/workers.ts  tickListings()
INTEL_LISTINGS_KEY = "cache:intel:listings"

# Listings freshness threshold (mirrors CACHE_GROUPS.listings.ttlMs / 1000)
INTEL_TTL_SECONDS = 5 * 60   # 5 minutes

# INTEL.PERSIST.1: enabled — TypeScript workers populate Redis keys every 5 min.
# Fallback to CoinGecko when cache is cold (graceful, no signal loss).
CMC_INTELLIGENCE_ENABLED = True


@dataclass
class IntelligenceCacheResult:
    coins:             list[CoinData]
    cache_source:      str    # "redis_intelligence" | "coingecko_fallback" | "empty"
    cache_hit:         bool
    cache_age_seconds: float  # seconds since refreshedAt timestamp in the snapshot
    is_fresh:          bool   # True when age < INTEL_TTL_SECONDS


# ── Internal helpers ──────────────────────────────────────────────────────────

def _parse_ts_coin(raw: dict, index: int) -> CoinData:
    """Convert a TypeScript camelCase ListingsSnapshot coin to Python CoinData."""
    symbol = str(raw.get("symbol", "")).upper()
    return CoinData(
        id=str(raw.get("id", "")),
        symbol=symbol,
        name=str(raw.get("name", "")),
        rank=int(raw.get("rank") or index + 1),
        price=float(raw.get("price") or 0),
        market_cap=float(raw.get("marketCap") or 0),
        volume_24h=float(raw.get("volume24h") or 0),
        price_change_24h=float(raw.get("priceChange24h") or 0),
        binance_symbol=str(raw.get("binanceSymbol") or f"{symbol}USDT"),
        has_futures=bool(raw.get("hasFutures") or False),
        image="",
    )


def _compute_age_seconds(refreshed_at: str) -> float:
    """Seconds elapsed since the ISO-8601 refreshedAt field in the snapshot."""
    try:
        ts = datetime.fromisoformat(refreshed_at.replace("Z", "+00:00"))
        return max(0.0, (datetime.now(timezone.utc) - ts).total_seconds())
    except Exception:
        return 0.0


# ── Public API ────────────────────────────────────────────────────────────────

async def read_intelligence_listings(limit: int = 200) -> IntelligenceCacheResult:
    """
    Read the CMC coin list from the Redis intelligence cache.

    On a cache hit  → converts snapshot coins to Python CoinData, records
                       cache age & freshness, increments hit counters.
    On a cache miss → falls back to CoinGecko, increments miss counters.

    Always returns an IntelligenceCacheResult; never raises.
    """
    if not CMC_INTELLIGENCE_ENABLED:
        return await _fallback_coingecko(limit, reason="cmc_disabled_unmeasurable")

    try:
        redis = await get_redis()
        raw   = await redis.get(INTEL_LISTINGS_KEY)

        if raw:
            snapshot  = json.loads(raw)
            coins_raw = snapshot.get("coins", [])

            if coins_raw:
                cache_age = _compute_age_seconds(snapshot.get("refreshedAt", ""))
                is_fresh  = cache_age < INTEL_TTL_SECONDS
                coins     = [_parse_ts_coin(c, i) for i, c in enumerate(coins_raw[:limit])]

                # Prometheus
                intelligence_cache_hits_total.labels(source="redis_intelligence").inc()
                intelligence_cache_age_seconds.observe(cache_age)

                log.info(
                    "intel_cache_hit",
                    count=len(coins),
                    cache_age_s=round(cache_age, 1),
                    is_fresh=is_fresh,
                )
                return IntelligenceCacheResult(
                    coins=coins,
                    cache_source="redis_intelligence",
                    cache_hit=True,
                    cache_age_seconds=cache_age,
                    is_fresh=is_fresh,
                )

    except Exception as exc:
        log.warning("intel_cache_read_error", error=str(exc))

    # ── Cache miss or read error: CMC direct → CoinGecko → Postgres ─────────
    from backend.config import get_settings as _get_settings  # noqa: PLC0415
    if _get_settings().coinmarketcap_api_key:
        result = await _fallback_cmc_direct(limit)
        if result.coins:
            return result
    cg_result = await _fallback_coingecko(limit)
    if cg_result.coins:
        return cg_result
    # Last resort: Postgres coins table (snapshot from last successful scan)
    return await _fallback_db_listings(limit)


# ── Additional intelligence readers ──────────────────────────────────────────
# These expose the other cache:intel:* keys written by the TypeScript workers
# to Python consumers (primarily trending_universe.py).

INTEL_TRENDING_KEY   = "cache:intel:trending"
INTEL_CATEGORIES_KEY = "cache:intel:categories"


async def read_trending_coins() -> list[dict]:
    """
    Return the raw TrendingCoin list from cache:intel:trending.
    Each dict has: id, symbol, name, rank, priceChange1h, priceChange24h,
    volume24h, marketCap.
    Returns [] on cache miss or error.
    """
    try:
        redis  = await get_redis()
        raw    = await redis.get(INTEL_TRENDING_KEY)
        if raw:
            snapshot = json.loads(raw)
            coins = snapshot.get("trending", [])
            return coins
    except Exception as exc:
        log.warning("intel_trending_read_error", error=str(exc))
    return []


async def read_categories() -> tuple[list[dict], str]:
    """
    Return (all_categories, refreshed_at) from cache:intel:categories.
    Each category dict has: id, name, title, coinCount, avgPriceChange,
    volume24h, marketCap, marketCapChange, coins (list[str]).
    refreshed_at is the ISO-8601 timestamp of the snapshot — used by
    sector_intelligence.analyze_sectors() for baseline change detection.

    Fallback chain:
      1. Redis cache:intel:categories
      2. Postgres cmc_sectors (CMC backup with full coins[] membership)
      3. ([], "")
    """
    try:
        redis = await get_redis()
        raw   = await redis.get(INTEL_CATEGORIES_KEY)
        if raw:
            snapshot     = json.loads(raw)
            categories   = snapshot.get("categories", [])
            refreshed_at = snapshot.get("refreshedAt", "")
            return categories, refreshed_at
    except Exception as exc:
        log.warning("intel_categories_read_error", error=str(exc))

    # Postgres fallback — preserves full coin membership from CMC backup
    return await _fallback_db_sectors()


async def _fallback_db_sectors() -> tuple[list[dict], str]:
    """
    Query cmc_sectors when cache:intel:categories is cold or Redis is unavailable.
    Returns camelCase dicts matching the TypeScript snapshot format consumed by
    sector_intelligence.analyze_sectors() and trending_universe._parse_rising_sectors().

    Critical: cmc_sectors.coins[] contains the full CMC sector membership
    (thousands of coins per sector), unlike CoinGecko which returns top_3_coins only.
    """
    try:
        from backend.database.session import get_pool  # noqa: PLC0415
        pool = await get_pool()
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT category_id, name, avg_price_change, market_cap_change_24h,
                       market_cap, coin_count, coins, refreshed_at
                FROM cmc_sectors
                WHERE coin_count > 0
                ORDER BY refreshed_at DESC
                LIMIT 200
                """
            )

        if not rows:
            log.warning("categories_db_fallback_empty")
            return [], ""

        refreshed_at = rows[0]["refreshed_at"].isoformat() if rows[0]["refreshed_at"] else ""
        age_s = max(0.0, (
            datetime.now(timezone.utc) - rows[0]["refreshed_at"]
        ).total_seconds()) if rows[0]["refreshed_at"] else 0.0

        # Map to camelCase format matching TypeScript CategoryData / CategoriesSnapshot
        categories = [
            {
                "id":              r["category_id"],
                "name":            r["name"],
                "title":           r["name"],
                "coinCount":       r["coin_count"] or 0,
                # avg_price_change from CMC; fall back to market_cap_change_24h (CoinGecko proxy)
                "avgPriceChange":  float(r["avg_price_change"] or r["market_cap_change_24h"] or 0),
                "marketCapChange": float(r["market_cap_change_24h"] or 0),
                "marketCap":       float(r["market_cap"] or 0),
                "volume24h":       0.0,
                "coins":           list(r["coins"] or []),
            }
            for r in rows
        ]

        log.info("categories_db_fallback_ok",
                 count=len(categories), age_s=round(age_s))
        return categories, refreshed_at

    except Exception as exc:
        log.warning("categories_db_fallback_failed", error=str(exc))
        return [], ""


async def read_top_movers() -> list[str]:
    """
    Return top-mover symbols (by absolute 24h change) from listings.topMovers.
    Returns up to 10 symbols; [] on cache miss.
    """
    try:
        redis = await get_redis()
        raw   = await redis.get(INTEL_LISTINGS_KEY)
        if raw:
            snapshot = json.loads(raw)
            return [m["symbol"].upper() for m in snapshot.get("topMovers", [])]
    except Exception as exc:
        log.warning("intel_top_movers_read_error", error=str(exc))
    return []


# Redis key for Telegram alert throttle (Phase 7.3A.8)
FALLBACK_ALERT_TTL_KEY = "intel:fallback:alert_sent"  # throttle key — 15-min TTL
FALLBACK_ALERT_TTL     = 15 * 60   # 15 min — minimum gap between Telegram alerts


async def _record_fallback_event(coin_count: int, reason: str = "cache_cold") -> bool:
    """
    Determine whether a CMC-cold Telegram alert should be sent (throttled to
    once per 15 minutes).

    Returns True if a Telegram alert should be fired, False if throttled.
    """
    should_alert = False
    try:
        redis = await get_redis()
        already_alerted = await redis.exists(FALLBACK_ALERT_TTL_KEY)
        if not already_alerted:
            await redis.setex(FALLBACK_ALERT_TTL_KEY, FALLBACK_ALERT_TTL, "1")
            should_alert = True
    except Exception as exc:
        log.warning("fallback_event_record_failed", error=str(exc))
    return should_alert


async def _fallback_cmc_direct(limit: int) -> IntelligenceCacheResult:
    """
    Last-resort fallback: call CMC listings API directly from Python when both
    the Redis intelligence cache AND CoinGecko are unavailable.

    Uses the same COINMARKETCAP_API_KEY env var available to the Python backend.
    Returns empty result (not raising) so the scan can decide how to handle it.
    """
    from backend.config import get_settings  # noqa: PLC0415
    import httpx as _httpx  # noqa: PLC0415

    settings = get_settings()
    api_key  = settings.coinmarketcap_api_key
    if not api_key:
        log.error("cmc_direct_fallback_skipped_no_api_key")
        return IntelligenceCacheResult(
            coins=[], cache_source="empty", cache_hit=False,
            cache_age_seconds=0.0, is_fresh=False,
        )

    log.warning("cmc_direct_fallback_attempting", reason="coingecko_also_failed")
    try:
        async with _httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(
                "https://pro-api.coinmarketcap.com/v1/cryptocurrency/listings/latest",
                params={"start": 1, "limit": min(limit, 200), "convert": "USD"},
                headers={"X-CMC_PRO_API_KEY": api_key, "Accept": "application/json"},
            )
            resp.raise_for_status()
            data = resp.json()

        coins_raw = data.get("data", [])
        coins: list[CoinData] = []
        for item in coins_raw:
            try:
                symbol = str(item.get("symbol", "")).upper()
                quote  = (item.get("quote") or {}).get("USD", {})
                coins.append(CoinData(
                    id=str(item.get("id", "")),
                    symbol=symbol,
                    name=str(item.get("name", "")),
                    rank=int(item.get("cmc_rank") or len(coins) + 1),
                    price=float(quote.get("price") or 0),
                    market_cap=float(quote.get("market_cap") or 0),
                    volume_24h=float(quote.get("volume_24h") or 0),
                    price_change_24h=float(quote.get("percent_change_24h") or 0),
                    binance_symbol=f"{symbol}USDT",
                    has_futures=False,
                    image="",
                ))
            except Exception:
                continue

        log.info("cmc_direct_fallback_ok", count=len(coins))
        intelligence_cache_hits_total.labels(source="cmc_direct").inc()
        return IntelligenceCacheResult(
            coins=coins,
            cache_source="cmc_direct",
            cache_hit=False,
            cache_age_seconds=0.0,
            is_fresh=True,
        )
    except Exception as exc:
        log.error("cmc_direct_fallback_failed", error=str(exc))
        return IntelligenceCacheResult(
            coins=[], cache_source="empty", cache_hit=False,
            cache_age_seconds=0.0, is_fresh=False,
        )


async def _fallback_coingecko(limit: int, reason: str = "cache_cold") -> IntelligenceCacheResult:
    """
    CoinGecko fallback when the Redis intelligence cache is cold or unreadable.
    Sends a Telegram ops alert throttled to once per 15 min and increments the
    Prometheus intelligence_fallback_total counter.
    """
    from backend.core.scanner.market_fetcher import _fetch_coingecko  # noqa: PLC0415

    intelligence_cache_misses_total.inc()

    log.warning(
        "intel_cache_miss_falling_back_to_coingecko",
        primary="coinmarketcap",
        fallback="coingecko",
        reason=reason,
    )

    try:
        coins = await _fetch_coingecko()
        coin_count = len(coins[:limit])

        # Prometheus counter for fallback events
        try:
            from backend.metrics.prometheus import intelligence_fallback_total  # noqa: PLC0415
            intelligence_fallback_total.labels(
                primary="coinmarketcap",
                fallback="coingecko",
                reason=reason,
            ).inc()
        except Exception:
            pass

        # Redis status + alert throttle check
        should_alert = await _record_fallback_event(coin_count, reason=reason)

        # Fire-and-forget Telegram operational alert (throttled)
        if should_alert:
            import asyncio as _asyncio  # noqa: PLC0415
            from backend.core.scanner.telegram_notifier import (  # noqa: PLC0415
                send_provider_fallback_alert,
            )
            t = _asyncio.create_task(
                send_provider_fallback_alert(
                    primary    = "CoinMarketCap",
                    fallback   = "CoinGecko",
                    coin_count = coin_count,
                    reason     = reason,
                )
            )
            t.add_done_callback(
                lambda t: log.warning("ops_alert_task_failed", error=str(t.exception()))
                if not t.cancelled() and t.exception() else None
            )

        intelligence_cache_hits_total.labels(source="coingecko_fallback").inc()
        log.info(
            "intel_coingecko_fallback_ok",
            count=coin_count,
            alert_sent=should_alert,
        )
        return IntelligenceCacheResult(
            coins=coins[:limit],
            cache_source="coingecko_fallback",
            cache_hit=False,
            cache_age_seconds=0.0,
            is_fresh=True,
        )
    except Exception as exc:
        log.error("intel_coingecko_fallback_failed", error=str(exc))
        return IntelligenceCacheResult(
            coins=[], cache_source="empty", cache_hit=False,
            cache_age_seconds=0.0, is_fresh=False,
        )


async def _fallback_db_listings(limit: int) -> IntelligenceCacheResult:
    """
    Postgres fallback when Redis AND CoinGecko are both unavailable.
    Reads the existing `coins` table populated by db.upsert_coins() at scan end.
    Staleness: data is as fresh as the last successful scan — acceptable last resort.
    """
    try:
        from backend.database.session import get_pool  # noqa: PLC0415
        pool = await get_pool()
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT symbol, name, rank, market_cap, volume_24h,
                       price, price_change_24h, binance_symbol,
                       has_futures, last_updated
                FROM coins
                WHERE symbol IS NOT NULL
                ORDER BY rank ASC NULLS LAST
                LIMIT $1
                """,
                limit,
            )

        if not rows:
            log.warning("db_listings_fallback_empty")
            return IntelligenceCacheResult(
                coins=[], cache_source="empty", cache_hit=False,
                cache_age_seconds=0.0, is_fresh=False,
            )

        # Compute age from the most recently updated row
        latest_ts = rows[0]["last_updated"]
        age_s = max(0.0, (
            datetime.now(timezone.utc) - latest_ts.replace(tzinfo=timezone.utc)
        ).total_seconds()) if latest_ts else 0.0

        coins: list[CoinData] = []
        for i, r in enumerate(rows):
            sym = str(r["symbol"]).upper()
            coins.append(CoinData(
                id=sym,
                symbol=sym,
                name=str(r["name"] or sym),
                rank=int(r["rank"] or i + 1),
                price=float(r["price"] or 0),
                market_cap=float(r["market_cap"] or 0),
                volume_24h=float(r["volume_24h"] or 0),
                price_change_24h=float(r["price_change_24h"] or 0),
                binance_symbol=str(r["binance_symbol"] or f"{sym}USDT"),
                has_futures=bool(r["has_futures"] or False),
                image="",
            ))

        log.warning(
            "intel_db_listings_fallback_ok",
            count=len(coins),
            age_s=round(age_s),
        )
        intelligence_cache_hits_total.labels(source="db_fallback").inc()
        return IntelligenceCacheResult(
            coins=coins,
            cache_source="db_fallback",
            cache_hit=False,
            cache_age_seconds=age_s,
            is_fresh=age_s < 3600,  # consider fresh if last scan < 1h ago
        )

    except Exception as exc:
        log.error("db_listings_fallback_failed", error=str(exc))
        return IntelligenceCacheResult(
            coins=[], cache_source="empty", cache_hit=False,
            cache_age_seconds=0.0, is_fresh=False,
        )
