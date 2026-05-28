"""
Async HTTP clients for Binance and CoinGecko.
Mirror of lib/binance.ts + lib/coingecko.ts — uses httpx.AsyncClient.
All external calls are measured via Prometheus and retried with backoff.
"""
from __future__ import annotations

import asyncio
import time
from typing import Any

import httpx

from backend.cache.redis_cache import RedisCache
from backend.config import get_settings
from backend.core.scanner.models import Candle, CoinData
from backend.logging.setup import get_logger
from backend.metrics.prometheus import (
    external_api_duration_seconds,
    external_api_errors_total,
)

log = get_logger(__name__)

# ── Endpoints ─────────────────────────────────────────────────────────────────

SPOT_BASE    = "https://api.binance.com/api/v3"
SPOT_BASE_US = "https://api.binance.us/api/v3"  # fallback for geo-restricted regions (HTTP 451)
FUTURES_BASE = "https://fapi.binance.com/fapi/v1"
FUTURES_DATA = "https://fapi.binance.com/futures/data"
COINGECKO    = "https://api.coingecko.com/api/v3"

# ── Module-level shared client (one per process) ──────────────────────────────

_client: httpx.AsyncClient | None = None


def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(
            timeout=httpx.Timeout(connect=5.0, read=15.0, write=5.0, pool=5.0),
            limits=httpx.Limits(max_connections=50, max_keepalive_connections=20),
            follow_redirects=False,
        )
    return _client


async def close_client() -> None:
    global _client
    if _client and not _client.is_closed:
        await _client.aclose()
        _client = None


# ── Retry helper ──────────────────────────────────────────────────────────────

async def _get(
    url: str,
    params: dict | None = None,
    headers: dict | None = None,
    service: str = "binance",
    retries: int = 3,
) -> Any:
    """GET with exponential backoff. Returns parsed JSON or raises."""
    client = _get_client()
    delay = 0.5
    last_exc: Exception = RuntimeError("no attempts")

    for attempt in range(retries):
        t0 = time.perf_counter()
        try:
            resp = await client.get(url, params=params, headers=headers)
            elapsed = time.perf_counter() - t0
            external_api_duration_seconds.labels(service=service).observe(elapsed)

            if resp.status_code in (400, 404):
                return None  # invalid symbol — don't retry
            resp.raise_for_status()
            return resp.json()
        except httpx.TimeoutException as exc:
            external_api_errors_total.labels(service=service, error_type="timeout").inc()
            last_exc = exc
        except httpx.HTTPStatusError as exc:
            code = exc.response.status_code
            if code == 429:
                external_api_errors_total.labels(service=service, error_type="rate_limit").inc()
            elif code >= 500:
                external_api_errors_total.labels(service=service, error_type="server_error").inc()
            else:
                raise  # 4xx (not 429) — don't retry
            last_exc = exc
        except Exception as exc:
            external_api_errors_total.labels(service=service, error_type="network").inc()
            last_exc = exc

        if attempt < retries - 1:
            await asyncio.sleep(delay * (2 ** attempt))

    raise last_exc


# ── Klines ────────────────────────────────────────────────────────────────────

def _parse_klines(raw: list) -> list[Candle]:
    candles = []
    for k in raw:
        try:
            candles.append(Candle(
                open_time=int(k[0]),
                open=float(k[1]),
                high=float(k[2]),
                low=float(k[3]),
                close=float(k[4]),
                volume=float(k[5]),
                close_time=int(k[6]),
            ))
        except (IndexError, ValueError, TypeError):
            continue
    return candles


async def fetch_spot_klines(symbol: str, interval: str = "1h", limit: int = 100) -> list[Candle]:
    for base in (SPOT_BASE, SPOT_BASE_US):
        try:
            data = await _get(
                f"{base}/klines",
                params={"symbol": symbol, "interval": interval, "limit": limit},
                service="binance",
            )
            return _parse_klines(data) if data else []
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code == 451 and base == SPOT_BASE:
                log.warning("binance_geo_blocked_trying_us", symbol=symbol)
                continue
            log.warning("spot_klines_failed", symbol=symbol, error=str(exc))
            return []
        except Exception as exc:
            log.warning("spot_klines_failed", symbol=symbol, error=str(exc))
            return []
    return []


async def fetch_futures_klines(symbol: str, interval: str = "1h", limit: int = 100) -> list[Candle]:
    try:
        data = await _get(
            f"{FUTURES_BASE}/klines",
            params={"symbol": symbol, "interval": interval, "limit": limit},
            service="binance",
        )
        return _parse_klines(data) if data else []
    except Exception as exc:
        log.warning("futures_klines_failed", symbol=symbol, error=str(exc))
        return []


async def fetch_klines(
    symbol: str, interval: str, limit: int, is_futures: bool
) -> list[Candle]:
    return (
        await fetch_futures_klines(symbol, interval, limit)
        if is_futures
        else await fetch_spot_klines(symbol, interval, limit)
    )


# ── Futures symbols ───────────────────────────────────────────────────────────

_futures_symbols_cache = RedisCache("futures-symbols", ttl_seconds=30 * 60)

_FALLBACK_FUTURES = {
    "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT",
    "DOGEUSDT", "ADAUSDT", "AVAXUSDT", "LINKUSDT", "SUIUSDT",
}


async def fetch_futures_symbols() -> set[str]:
    cached: list[str] | None = await _futures_symbols_cache.get("all")
    if cached:
        return set(cached)

    try:
        data = await _get(f"{FUTURES_BASE}/exchangeInfo", service="binance")
        if not data:
            return _FALLBACK_FUTURES
        symbols = [
            s["symbol"]
            for s in data.get("symbols", [])
            if s.get("quoteAsset") == "USDT" and s.get("status") == "TRADING"
        ]
        await _futures_symbols_cache.set("all", symbols)
        return set(symbols)
    except Exception as exc:
        log.warning("futures_symbols_failed", error=str(exc))
        return _FALLBACK_FUTURES


# ── Funding rate ──────────────────────────────────────────────────────────────

async def fetch_funding_rate(symbol: str) -> float:
    try:
        data = await _get(
            f"{FUTURES_BASE}/premiumIndex",
            params={"symbol": symbol},
            service="binance",
        )
        if not data:
            return 0.0
        return float(data.get("lastFundingRate") or data.get("fundingRate") or 0)
    except Exception:
        return 0.0


# ── Open interest history ─────────────────────────────────────────────────────

async def fetch_oi_history(symbol: str, period: str = "1h", limit: int = 25) -> list[dict]:
    try:
        data = await _get(
            f"{FUTURES_DATA}/openInterestHist",
            params={"symbol": symbol, "period": period, "limit": limit},
            service="binance",
        )
        if not data:
            return []
        return [
            {
                "symbol": d.get("symbol", symbol),
                "sum_open_interest": float(d["sumOpenInterest"]),
                "timestamp": int(d["timestamp"]),
            }
            for d in data
        ]
    except Exception:
        return []


# ── Long/short ratio ──────────────────────────────────────────────────────────

async def fetch_long_short_ratio(symbol: str, period: str = "1h", limit: int = 4) -> list[dict]:
    try:
        data = await _get(
            f"{FUTURES_DATA}/globalLongShortAccountRatio",
            params={"symbol": symbol, "period": period, "limit": limit},
            service="binance",
        )
        if not data:
            return []
        return [
            {
                "symbol": d.get("symbol", symbol),
                "long_short_ratio": float(d["longShortRatio"]),
                "long_account": float(d["longAccount"]),
                "short_account": float(d["shortAccount"]),
                "timestamp": int(d["timestamp"]),
            }
            for d in data
        ]
    except Exception:
        return []


# ── CoinMarketCap — primary coin source ───────────────────────────────────────

CMC_BASE = "https://pro-api.coinmarketcap.com/v1"


def _parse_cmc_coin(raw: dict, index: int) -> CoinData:
    symbol = str(raw.get("symbol", "")).upper()
    usd    = raw.get("quote", {}).get("USD", {})
    return CoinData(
        id=str(raw.get("id", "")),
        symbol=symbol,
        name=str(raw.get("name", "")),
        rank=int(raw.get("cmc_rank") or index + 1),
        price=float(usd.get("price") or 0),
        market_cap=float(usd.get("market_cap") or 0),
        volume_24h=float(usd.get("volume_24h") or 0),
        price_change_24h=float(usd.get("percent_change_24h") or 0),
        binance_symbol=f"{symbol}USDT",
        has_futures=False,
        image="",
    )


async def _fetch_cmc(limit: int = 200) -> list[CoinData]:
    """Fetch top coins by market cap from CoinMarketCap (single API call)."""
    settings = get_settings()
    if not settings.coinmarketcap_api_key:
        raise RuntimeError("COINMARKETCAP_API_KEY not configured")

    data = await _get(
        f"{CMC_BASE}/cryptocurrency/listings/latest",
        params={
            "limit": limit,
            "convert": "USD",
            "sort": "market_cap",
            "sort_dir": "desc",
            "cryptocurrency_type": "all",
        },
        headers={
            "X-CMC_PRO_API_KEY": settings.coinmarketcap_api_key,
            "Accept": "application/json",
        },
        service="coinmarketcap",
        retries=3,
    )
    if not data or "data" not in data:
        raise RuntimeError(f"CMC unexpected response: {str(data)[:200]}")
    return [_parse_cmc_coin(c, i) for i, c in enumerate(data["data"])]


# ── CoinGecko — fallback only ─────────────────────────────────────────────────

def _parse_cg_coin(raw: dict, index: int) -> CoinData:
    symbol = str(raw.get("symbol", "")).upper()
    return CoinData(
        id=str(raw.get("id", "")).lower(),
        symbol=symbol,
        name=str(raw.get("name", "")),
        rank=int(raw.get("market_cap_rank") or index + 1),
        price=float(raw.get("current_price") or 0),
        market_cap=float(raw.get("market_cap") or 0),
        volume_24h=float(raw.get("total_volume") or 0),
        price_change_24h=float(raw.get("price_change_percentage_24h") or 0),
        binance_symbol=f"{symbol}USDT",
        has_futures=False,
        image=str(raw.get("image") or ""),
    )


async def _fetch_coingecko() -> list[CoinData]:
    """Fetch top-100 coins from CoinGecko (fallback only)."""
    settings = get_settings()
    headers: dict[str, str] = {"Accept": "application/json"}
    if settings.coingecko_api_key:
        headers["x-cg-demo-api-key"] = settings.coingecko_api_key

    async def _page(page: int) -> list[dict]:
        if page == 2:
            await asyncio.sleep(0.4)
        try:
            data = await _get(
                f"{COINGECKO}/coins/markets",
                params={
                    "vs_currency": "usd",
                    "order": "market_cap_desc",
                    "per_page": 50,
                    "page": page,
                    "sparkline": "false",
                    "price_change_percentage": "24h",
                },
                headers=headers,
                service="coingecko",
                retries=3,
            )
            return data or []
        except Exception as exc:
            log.warning("coingecko_page_failed", page=page, error=str(exc))
            return []

    p1, p2 = await asyncio.gather(_page(1), _page(2))
    return [_parse_cg_coin(c, i) for i, c in enumerate(p1 + p2)]


async def fetch_top100() -> list[CoinData]:
    """
    Fetch top coins — CoinMarketCap primary (200 coins, 1 API call),
    CoinGecko fallback (100 coins) if CMC key missing or request fails.
    """
    try:
        coins = await _fetch_cmc(limit=200)
        log.info("coins_fetched_cmc", count=len(coins))
        return coins
    except Exception as exc:
        log.warning("cmc_fetch_failed_using_coingecko", error=str(exc))
        coins = await _fetch_coingecko()
        log.info("coins_fetched_coingecko_fallback", count=len(coins))
        return coins
