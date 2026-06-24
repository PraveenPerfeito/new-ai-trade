"""
CMC.REMOVAL.IMPLEMENTATION.1 — Part D: Simulation tests.

Verifies that the platform degrades gracefully (not crashes) when:
  - Redis is unavailable (all cache misses)
  - CMC API is unavailable
  - CoinGecko is unavailable

Postgres fallback paths are tested by mocking asyncpg pool responses
so no live DB connection is required.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.core.scanner.intelligence_cache import (
    IntelligenceCacheResult,
    _fallback_db_sectors,
    read_categories,
    read_intelligence_listings,
)
from backend.core.scanner.models import CoinData


# ── helpers ───────────────────────────────────────────────────────────────────

def _make_coin(symbol: str, rank: int = 1) -> dict[str, Any]:
    """Return a camelCase intelligence snapshot coin dict (TypeScript format)."""
    return {
        "symbol": symbol,
        "name": symbol,
        "rank": rank,
        "price": 1.0,
        "marketCap": 1_000_000_000,
        "volume24h": 50_000_000,
        "priceChange24h": 1.5,
        "binanceSymbol": f"{symbol}USDT",
        "hasFutures": False,
    }


def _redis_snapshot(coins: list[dict]) -> str:
    return json.dumps({
        "coins": coins,
        "refreshedAt": datetime.now(timezone.utc).isoformat(),
    })


def _make_asyncpg_row(**kwargs):
    """Create a minimal asyncpg-like row that supports dict-key access."""
    row = MagicMock()
    row.__getitem__ = lambda self, k: kwargs[k]
    for k, v in kwargs.items():
        setattr(row, k, v)
    return row


# ── 1. Redis available — happy path ──────────────────────────────────────────

@pytest.mark.asyncio
async def test_listings_redis_cache_hit():
    """When Redis has data, return it without touching Postgres or external APIs."""
    coins = [_make_coin("BTC", 1), _make_coin("ETH", 2)]
    snap  = _redis_snapshot(coins)

    mock_redis = AsyncMock()
    mock_redis.get = AsyncMock(return_value=snap)

    with patch("backend.core.scanner.intelligence_cache.get_redis", return_value=mock_redis):
        result = await read_intelligence_listings(limit=10)

    assert result.cache_hit is True
    assert result.cache_source == "redis_intelligence"
    assert len(result.coins) == 2
    assert result.coins[0].symbol == "BTC"


# ── 2. Redis miss → CoinGecko fallback ───────────────────────────────────────

@pytest.mark.asyncio
async def test_listings_falls_back_to_coingecko_on_redis_miss():
    """When Redis returns None and CMC direct is unavailable, CoinGecko is used.

    The actual chain is Redis → CMC direct → CoinGecko → Postgres.
    Both Redis and CMC direct must be mocked empty to reach CoinGecko.
    """
    mock_redis = AsyncMock()
    mock_redis.get = AsyncMock(return_value=None)

    _empty = IntelligenceCacheResult(
        coins=[], cache_source="empty", cache_hit=False,
        cache_age_seconds=0.0, is_fresh=False,
    )

    with (
        patch("backend.core.scanner.intelligence_cache.get_redis", return_value=mock_redis),
        patch("backend.core.scanner.intelligence_cache._fallback_cmc_direct", return_value=_empty),
        patch("backend.core.scanner.intelligence_cache._fallback_coingecko") as mock_cg,
    ):
        mock_cg.return_value = IntelligenceCacheResult(
            coins=[CoinData(id="BTC", symbol="BTC", name="Bitcoin", rank=1,
                            price=50000.0, market_cap=1e12, volume_24h=5e10,
                            price_change_24h=2.0, binance_symbol="BTCUSDT",
                            has_futures=False, image="")],
            cache_source="coingecko_fallback",
            cache_hit=False,
            cache_age_seconds=30.0,
            is_fresh=True,
        )
        result = await read_intelligence_listings(limit=10)

    assert result.cache_source == "coingecko_fallback"
    assert len(result.coins) >= 1


# ── 3. Redis miss + CoinGecko down → Postgres fallback ───────────────────────

@pytest.mark.asyncio
async def test_listings_falls_back_to_postgres_when_coingecko_fails():
    """
    When Redis, CMC direct, and CoinGecko all fail, Postgres coins table is used.
    Full outage scenario: all three external sources return empty; Postgres saves the scan.

    Actual chain: Redis → CMC direct → CoinGecko → Postgres.
    All three must be mocked empty to reach the Postgres path.
    """
    mock_redis = AsyncMock()
    mock_redis.get = AsyncMock(return_value=None)

    _empty = IntelligenceCacheResult(
        coins=[], cache_source="empty", cache_hit=False,
        cache_age_seconds=0.0, is_fresh=False,
    )

    with (
        patch("backend.core.scanner.intelligence_cache.get_redis", return_value=mock_redis),
        patch("backend.core.scanner.intelligence_cache._fallback_cmc_direct", return_value=_empty),
        patch("backend.core.scanner.intelligence_cache._fallback_coingecko", return_value=_empty),
        patch("backend.core.scanner.intelligence_cache._fallback_db_listings") as mock_db,
    ):
        mock_db.return_value = IntelligenceCacheResult(
            coins=[
                CoinData(id="BTC", symbol="BTC", name="Bitcoin", rank=1,
                         price=50000.0, market_cap=1e12, volume_24h=5e10,
                         price_change_24h=2.0, binance_symbol="BTCUSDT",
                         has_futures=True, image=""),
                CoinData(id="ETH", symbol="ETH", name="Ethereum", rank=2,
                         price=3000.0, market_cap=5e11, volume_24h=2e10,
                         price_change_24h=1.5, binance_symbol="ETHUSDT",
                         has_futures=True, image=""),
            ],
            cache_source="db_fallback",
            cache_hit=False,
            cache_age_seconds=120.0,
            is_fresh=True,
        )
        result = await read_intelligence_listings(limit=10)

    assert result.cache_source == "db_fallback"
    assert len(result.coins) == 2
    assert result.coins[0].symbol == "BTC"


# ── 4. Categories: Redis miss → Postgres cmc_sectors fallback ────────────────

@pytest.mark.asyncio
async def test_categories_falls_back_to_postgres():
    """
    When Redis categories cache is cold, Python reads cmc_sectors Postgres table.
    This is the primary sector data source once CMC Startup expires.
    """
    mock_redis = AsyncMock()
    mock_redis.get = AsyncMock(return_value=None)

    pg_rows = [
        _make_asyncpg_row(
            category_id="defi", name="DeFi",
            avg_price_change=3.5, market_cap_change_24h=2.1,
            market_cap=5e10, coin_count=45,
            coins=["UNI", "AAVE", "COMP", "MKR"],
            refreshed_at=datetime.now(timezone.utc),
        ),
    ]

    mock_conn  = AsyncMock()
    mock_conn.fetch = AsyncMock(return_value=pg_rows)
    mock_pool  = AsyncMock()
    mock_pool.acquire = MagicMock(return_value=AsyncMock(
        __aenter__=AsyncMock(return_value=mock_conn),
        __aexit__=AsyncMock(return_value=False),
    ))

    with (
        patch("backend.core.scanner.intelligence_cache.get_redis", return_value=mock_redis),
        patch("backend.core.scanner.intelligence_cache._fallback_db_sectors") as mock_db,
    ):
        mock_db.return_value = (
            [{"id": "defi", "name": "DeFi", "title": "DeFi",
              "coinCount": 45, "avgPriceChange": 3.5, "marketCapChange": 2.1,
              "marketCap": 5e10, "volume24h": 0.0,
              "coins": ["UNI", "AAVE", "COMP", "MKR"]}],
            "db_fallback",
        )
        cats, source = await read_categories()

    assert source in ("db_fallback", "postgres")
    assert len(cats) >= 1
    assert "coins" in cats[0]
    assert "UNI" in cats[0]["coins"]


# ── 5. Categories Postgres rows preserve coins[] ─────────────────────────────

@pytest.mark.asyncio
async def test_fallback_db_sectors_returns_full_coin_list():
    """
    _fallback_db_sectors() must return the full coins[] array, not just top-3.
    This is the critical difference vs CoinGecko (which gives image URLs only).
    """
    pg_rows = [
        _make_asyncpg_row(
            category_id="layer-1", name="Layer 1",
            avg_price_change=1.0, market_cap_change_24h=0.8,
            market_cap=2e12, coin_count=12,
            coins=["BTC", "ETH", "SOL", "ADA", "AVAX", "DOT", "ATOM", "NEAR", "APT", "SUI", "ICP", "ALGO"],
            refreshed_at=datetime.now(timezone.utc),
        ),
    ]

    mock_conn  = AsyncMock()
    mock_conn.fetch = AsyncMock(return_value=pg_rows)
    mock_pool  = AsyncMock()
    mock_pool.acquire = MagicMock(return_value=AsyncMock(
        __aenter__=AsyncMock(return_value=mock_conn),
        __aexit__=AsyncMock(return_value=False),
    ))

    # get_pool is imported inside _fallback_db_sectors — patch at the source module
    with patch("backend.database.session.get_pool", return_value=mock_pool):
        cats, source = await _fallback_db_sectors()

    assert len(cats) == 1
    cat = cats[0]
    assert len(cat["coins"]) == 12  # all 12 coins returned, not just top-3
    assert "BTC" in cat["coins"]
    assert "ALGO" in cat["coins"]


# ── 6. All sources down → empty result, no crash ─────────────────────────────

@pytest.mark.asyncio
async def test_full_outage_returns_empty_not_crash():
    """
    When Redis, CMC, CoinGecko, AND Postgres all fail, the scanner must receive
    an empty result (not raise an exception). Scans degrade to 0 coins scanned
    rather than crashing the Celery task.
    """
    mock_redis = AsyncMock()
    mock_redis.get = AsyncMock(return_value=None)

    _empty = IntelligenceCacheResult(
        coins=[], cache_source="empty", cache_hit=False,
        cache_age_seconds=0.0, is_fresh=False,
    )
    with (
        patch("backend.core.scanner.intelligence_cache.get_redis", return_value=mock_redis),
        patch("backend.core.scanner.intelligence_cache._fallback_cmc_direct", return_value=_empty),
        patch("backend.core.scanner.intelligence_cache._fallback_coingecko", return_value=_empty),
        patch(
            "backend.core.scanner.intelligence_cache._fallback_db_listings",
            return_value=_empty,
        ),
    ):
        result = await read_intelligence_listings(limit=10)

    assert isinstance(result, IntelligenceCacheResult)
    assert result.coins == []
    assert result.cache_source == "empty"


# ── 7. Partial Postgres data → partial scan (not zero) ───────────────────────

@pytest.mark.asyncio
async def test_partial_postgres_data_still_allows_scan():
    """
    Even if Postgres only has 20 coins (stale from a week ago), the scan runs.
    A partial scan is better than no scan — signals may still be generated.
    """
    mock_redis = AsyncMock()
    mock_redis.get = AsyncMock(return_value=None)

    partial_coins = [
        CoinData(id=sym, symbol=sym, name=sym, rank=i + 1,
                 price=100.0, market_cap=1e10, volume_24h=1e9,
                 price_change_24h=0.5, binance_symbol=f"{sym}USDT",
                 has_futures=False, image="")
        for i, sym in enumerate(["BTC", "ETH", "SOL", "BNB", "XRP",
                                  "ADA", "AVAX", "DOT", "LINK", "MATIC"])
    ]

    _empty = IntelligenceCacheResult(
        coins=[], cache_source="empty", cache_hit=False,
        cache_age_seconds=0.0, is_fresh=False,
    )
    with (
        patch("backend.core.scanner.intelligence_cache.get_redis", return_value=mock_redis),
        patch("backend.core.scanner.intelligence_cache._fallback_cmc_direct", return_value=_empty),
        patch("backend.core.scanner.intelligence_cache._fallback_coingecko", return_value=_empty),
        patch("backend.core.scanner.intelligence_cache._fallback_db_listings") as mock_db,
    ):
        mock_db.return_value = IntelligenceCacheResult(
            coins=partial_coins,
            cache_source="db_fallback",
            cache_hit=False,
            cache_age_seconds=7 * 24 * 3600,  # 7 days stale
            is_fresh=False,
        )
        result = await read_intelligence_listings(limit=50)

    assert len(result.coins) == 10  # 10 coins available — scan proceeds
    assert result.is_fresh is False  # correctly marked as stale
