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
    try:
        data = await _get(
            f"{SPOT_BASE}/klines",
            params={"symbol": symbol, "interval": interval, "limit": limit},
            service="binance",
        )
        return _parse_klines(data) if data else []
    except Exception as exc:
        log.warning("spot_klines_failed", symbol=symbol, error=str(exc))
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


# ── CoinGecko top-100 ─────────────────────────────────────────────────────────

BINANCE_SYMBOL_MAP: dict[str, str] = {
    "bitcoin": "BTCUSDT", "ethereum": "ETHUSDT", "solana": "SOLUSDT",
    "binancecoin": "BNBUSDT", "ripple": "XRPUSDT", "dogecoin": "DOGEUSDT",
    "cardano": "ADAUSDT", "avalanche-2": "AVAXUSDT", "chainlink": "LINKUSDT",
    "sui": "SUIUSDT", "polkadot": "DOTUSDT", "shiba-inu": "SHIBUSDT",
    "tron": "TRXUSDT", "litecoin": "LTCUSDT", "matic-network": "MATICUSDT",
    "internet-computer": "ICPUSDT", "bitcoin-cash": "BCHUSDT", "near": "NEARUSDT",
    "uniswap": "UNIUSDT", "aptos": "APTUSDT", "stellar": "XLMUSDT",
    "monero": "XMRUSDT", "ethereum-classic": "ETCUSDT", "cosmos": "ATOMUSDT",
    "filecoin": "FILUSDT", "hedera-hashgraph": "HBARUSDT", "arbitrum": "ARBUSDT",
    "optimism": "OPUSDT", "injective-protocol": "INJUSDT", "sei-network": "SEIUSDT",
    "the-graph": "GRTUSDT", "fetch-ai": "FETUSDT", "render-token": "RENDERUSDT",
    "algorand": "ALGOUSDT", "sandbox": "SANDUSDT", "decentraland": "MANAUSDT",
    "axie-infinity": "AXSUSDT", "flow": "FLOWUSDT", "immutable-x": "IMXUSDT",
    "pepe": "PEPEUSDT", "floki": "FLOKIUSDT", "dogwifcoin": "WIFUSDT",
    "kaspa": "KASUSDT", "thorchain": "RUNEUSDT", "pendle": "PENDLEUSDT",
    "toncoin": "TONUSDT", "notcoin": "NOTUSDT", "ethena": "ENAUSDT",
    "starknet": "STRKUSDT", "dydx-chain": "DYDXUSDT", "aave": "AAVEUSDT",
    "maker": "MKRUSDT", "curve-dao-token": "CRVUSDT", "fantom": "FTMUSDT",
    "eos": "EOSUSDT", "vechain": "VETUSDT", "theta-token": "THETAUSDT",
    "gala": "GALAUSDT", "worldcoin-wld": "WLDUSDT", "celestia": "TIAUSDT",
    "pyth-network": "PYTHUSDT", "jupiter-exchange-solana": "JUPUSDT",
    "bonk": "BONKUSDT", "ondo-finance": "ONDOUSDT", "eigenlayer": "EIGENUSDT",
}


def _parse_coin(raw: dict, index: int) -> CoinData:
    cg_id = str(raw.get("id", "")).lower()
    symbol = str(raw.get("symbol", "")).upper()
    binance_symbol = BINANCE_SYMBOL_MAP.get(cg_id, f"{symbol}USDT")
    return CoinData(
        id=cg_id,
        symbol=symbol,
        name=str(raw.get("name", "")),
        rank=int(raw.get("market_cap_rank") or index + 1),
        price=float(raw.get("current_price") or 0),
        market_cap=float(raw.get("market_cap") or 0),
        volume_24h=float(raw.get("total_volume") or 0),
        price_change_24h=float(raw.get("price_change_percentage_24h") or 0),
        binance_symbol=binance_symbol,
        has_futures=False,
        image=str(raw.get("image") or ""),
    )


async def fetch_top100() -> list[CoinData]:
    """Fetch top-100 coins from CoinGecko (two pages of 50)."""
    settings = get_settings()
    headers: dict[str, str] = {"Accept": "application/json"}
    if settings.coingecko_api_key:
        headers["x-cg-demo-api-key"] = settings.coingecko_api_key

    def page_params(page: int) -> dict:
        return {
            "vs_currency": "usd",
            "order": "market_cap_desc",
            "per_page": 50,
            "page": page,
            "sparkline": "false",
            "price_change_percentage": "24h",
        }

    async def _fetch_page(page: int) -> list[dict]:
        if page == 2:
            await asyncio.sleep(0.4)  # stagger to avoid rate limit
        try:
            data = await _get(
                f"{COINGECKO}/coins/markets",
                params=page_params(page),
                headers=headers,
                service="coingecko",
                retries=3,
            )
            return data or []
        except Exception as exc:
            log.warning("coingecko_page_failed", page=page, error=str(exc))
            return []

    page1, page2 = await asyncio.gather(_fetch_page(1), _fetch_page(2))
    raw = page1 + page2
    return [_parse_coin(c, i) for i, c in enumerate(raw)]
