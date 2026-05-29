"""
Intelligence cache reader — Python side of the CMC intelligence pipeline.

Architecture (new):
  CMC API
    ↓  (TypeScript workers — lib/intelligence/workers.ts — every 5 min)
  Redis  cache:intel:listings
    ↓  (this module)
  Python Scanner
    ↓
  Signals

The TypeScript Next.js process is the sole CMC API caller.
Python reads the pre-populated Redis key; it never calls CMC directly.
This eliminates quota double-spending and centralises credit accounting
in the TypeScript quota guard (lib/intelligence/quota-guard.ts).

Fallback chain on cache miss:
  Redis intelligence cache (cache:intel:listings)
    → CoinGecko public API  (100 coins, rate-limited)
    → empty list            (logged as error, scan proceeds with 0 coins)
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

# Shared hit/miss counters — incremented by both TS reader.ts and this module
INTEL_HITS_KEY   = "cache:intel:hits:listings"
INTEL_MISSES_KEY = "cache:intel:misses:listings"

# Listings freshness threshold (mirrors CACHE_GROUPS.listings.ttlMs / 1000)
INTEL_TTL_SECONDS = 5 * 60   # 5 minutes


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

                # Shared Redis counters (visible to TypeScript admin dashboard)
                try:
                    await redis.incr(INTEL_HITS_KEY)
                except Exception:
                    pass

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

    # ── Cache miss or read error: fall back to CoinGecko ─────────────────────
    return await _fallback_coingecko(limit)


async def _fallback_coingecko(limit: int) -> IntelligenceCacheResult:
    """CoinGecko fallback when the Redis intelligence cache is cold or unreadable."""
    # Lazy import avoids circular dependency at module load time
    # (market_fetcher imports read_intelligence_listings; intelligence_cache
    #  imports _fetch_coingecko from market_fetcher — safe as long as both
    #  imports happen inside functions, not at module level).
    from backend.core.scanner.market_fetcher import _fetch_coingecko  # noqa: PLC0415

    intelligence_cache_misses_total.inc()

    try:
        redis = await get_redis()
        await redis.incr(INTEL_MISSES_KEY)
    except Exception:
        pass

    log.warning("intel_cache_miss_falling_back_to_coingecko")

    try:
        coins = await _fetch_coingecko()
        intelligence_cache_hits_total.labels(source="coingecko_fallback").inc()
        log.info("intel_coingecko_fallback_ok", count=len(coins))
        return IntelligenceCacheResult(
            coins=coins[:limit],
            cache_source="coingecko_fallback",
            cache_hit=False,
            cache_age_seconds=0.0,
            is_fresh=True,   # freshly fetched — age is effectively zero
        )
    except Exception as exc:
        log.error("intel_coingecko_fallback_failed", error=str(exc))
        return IntelligenceCacheResult(
            coins=[],
            cache_source="empty",
            cache_hit=False,
            cache_age_seconds=0.0,
            is_fresh=False,
        )
