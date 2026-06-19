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

from backend.cache.redis_cache import RedisCache, get_redis
from backend.config import get_settings
from backend.core.scanner.models import Candle, CoinData
from backend.logging.setup import get_logger
from backend.metrics.prometheus import (
    external_api_duration_seconds,
    external_api_errors_total,
)

log = get_logger(__name__)


def _on_task_done(task: asyncio.Task, label: str) -> None:
    if not task.cancelled() and task.exception() is not None:
        log.warning("background_task_failed", task=label, error=str(task.exception()))


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


def _drop_open_candle(candles: list[Candle], now_ms: int | None = None) -> list[Candle]:
    """Binance klines include the currently open candle; scanner signals need closed candles."""
    if not candles:
        return candles
    current_ms = now_ms if now_ms is not None else int(time.time() * 1000)
    if candles[-1].close_time and candles[-1].close_time >= current_ms:
        return candles[:-1]
    return candles


_BINANCE_META_KEY    = "providers:metrics:binance:meta"
_BINANCE_LATENCY_KEY = "providers:metrics:binance:latency"
_BINANCE_ERRORS_KEY  = "providers:metrics:binance:errors"

# Redis reduction: batch kline metrics into a 5-second window instead of one
# pipeline per kline call.  A full 80-coin × 3-timeframe scan fires ~240 calls;
# this collapses them into a single flush at ~5 ops per scan instead of ~720.
_batch_successes: int   = 0
_batch_latencies: list[int] = []
_batch_errors:    list[str] = []
# KLINE.EMPTY.TELEMETRY.1 — per-exchange kline timeout counters (flushed in same pipeline)
_batch_timeouts: dict[str, int] = {"spot": 0, "futures": 0}
_batch_flush_task: "asyncio.Task | None" = None
_batch_lock = asyncio.Lock()
_BATCH_WINDOW_S = 5.0


async def _record_binance_kline_metric(
    latency_ms: float, success: bool, *, timeout: bool = False, futures: bool = False
) -> None:
    """Accumulate per-kline metrics; a background task flushes them every 5 s."""
    global _batch_successes, _batch_flush_task
    async with _batch_lock:
        if success:
            _batch_successes += 1
            _batch_latencies.append(round(latency_ms))
        else:
            _batch_errors.append(str(int(time.time() * 1000)))
            if timeout:
                _batch_timeouts["futures" if futures else "spot"] += 1
        if _batch_flush_task is None or _batch_flush_task.done():
            _batch_flush_task = asyncio.create_task(_flush_binance_metrics_after_delay())
            _batch_flush_task.add_done_callback(lambda t: _on_task_done(t, "flush_binance_metrics"))


async def _flush_binance_metrics_after_delay() -> None:
    await asyncio.sleep(_BATCH_WINDOW_S)
    await _flush_binance_metrics()


async def _flush_binance_metrics() -> None:
    """Write accumulated Binance kline metrics to Redis in a single pipeline."""
    global _batch_successes, _batch_latencies, _batch_errors
    async with _batch_lock:
        successes = _batch_successes
        latencies = list(_batch_latencies)
        errors    = list(_batch_errors)
        timeouts  = dict(_batch_timeouts)
        _batch_successes = 0
        _batch_latencies.clear()
        _batch_errors.clear()
        _batch_timeouts["spot"] = 0
        _batch_timeouts["futures"] = 0

    if not successes and not errors:
        return
    try:
        redis = await get_redis()
        ts_ms = str(int(time.time() * 1000))
        pipe  = redis.pipeline()
        if successes:
            pipe.hset(_BINANCE_META_KEY, mapping={"lastSuccess": ts_ms})
            pipe.hincrby(_BINANCE_META_KEY, "requestsToday", successes)
            if latencies:
                pipe.rpush(_BINANCE_LATENCY_KEY, *latencies)
                pipe.ltrim(_BINANCE_LATENCY_KEY, -100, -1)
        if errors:
            pipe.hset(_BINANCE_META_KEY, mapping={"lastError": ts_ms})
            pipe.rpush(_BINANCE_ERRORS_KEY, *errors)
            pipe.ltrim(_BINANCE_ERRORS_KEY, -100, -1)
        # KLINE.EMPTY.TELEMETRY.1 — per-exchange timeout counters (provider health hash)
        if timeouts.get("spot"):
            pipe.hincrby(_BINANCE_META_KEY, "klineTimeouts:spot", timeouts["spot"])
        if timeouts.get("futures"):
            pipe.hincrby(_BINANCE_META_KEY, "klineTimeouts:futures", timeouts["futures"])
        _7d = 7 * 24 * 3600
        pipe.expire(_BINANCE_META_KEY, _7d)
        pipe.expire(_BINANCE_LATENCY_KEY, _7d)
        pipe.expire(_BINANCE_ERRORS_KEY, _7d)
        await pipe.execute()
        # Wire Binance error count to monitoring dashboard (record_binance_error was
        # defined but never called — anomaly detector's binance_errors threshold was
        # permanently 0 before this fix).
        if errors:
            from backend.analytics.monitoring import _incr  # noqa: PLC0415
            await _incr("binance_errors", len(errors))
    except Exception:
        pass


async def fetch_spot_klines(symbol: str, interval: str = "1h", limit: int = 100) -> list[Candle]:
    for base in (SPOT_BASE, SPOT_BASE_US):
        t0 = time.perf_counter()
        try:
            data = await _get(
                f"{base}/klines",
                params={"symbol": symbol, "interval": interval, "limit": limit},
                service="binance",
            )
            latency_ms = (time.perf_counter() - t0) * 1000
            asyncio.create_task(_record_binance_kline_metric(latency_ms, success=True))
            return _drop_open_candle(_parse_klines(data)) if data else []
        except httpx.HTTPStatusError as exc:
            asyncio.create_task(_record_binance_kline_metric(0, success=False))
            if exc.response.status_code == 451 and base == SPOT_BASE:
                log.warning("binance_geo_blocked_trying_us", symbol=symbol)
                continue
            log.warning("spot_klines_failed", symbol=symbol, error=str(exc))
            return []
        except httpx.TimeoutException as exc:
            # KLINE.EMPTY.TELEMETRY.1 — timeouts counted separately per exchange
            asyncio.create_task(_record_binance_kline_metric(0, success=False, timeout=True))
            log.warning("spot_klines_timeout", symbol=symbol, error=str(exc))
            return []
        except Exception as exc:
            asyncio.create_task(_record_binance_kline_metric(0, success=False))
            log.warning("spot_klines_failed", symbol=symbol, error=str(exc))
            return []
    return []


# P1.5: Track consecutive futures failures for geo-block detection
_futures_consecutive_failures = 0
_futures_alert_sent_at: float = 0.0
_FUTURES_ALERT_THROTTLE_S = 3600  # alert at most once per hour


async def fetch_futures_klines(symbol: str, interval: str = "1h", limit: int = 100) -> list[Candle]:
    global _futures_consecutive_failures, _futures_alert_sent_at
    t0 = time.perf_counter()
    try:
        data = await _get(
            f"{FUTURES_BASE}/klines",
            params={"symbol": symbol, "interval": interval, "limit": limit},
            service="binance",
        )
        latency_ms = (time.perf_counter() - t0) * 1000
        asyncio.create_task(_record_binance_kline_metric(latency_ms, success=True))
        _futures_consecutive_failures = 0  # reset on success
        return _drop_open_candle(_parse_klines(data)) if data else []
    except httpx.HTTPStatusError as exc:
        asyncio.create_task(_record_binance_kline_metric(0, success=False))
        _futures_consecutive_failures += 1
        status = exc.response.status_code
        log.warning("futures_klines_failed", symbol=symbol, status=status,
                    consecutive=_futures_consecutive_failures, error=str(exc))
        if status == 451:
            t = asyncio.create_task(_maybe_send_futures_geo_alert(status))
            t.add_done_callback(lambda t: _on_task_done(t, "futures_geo_alert"))
        elif _futures_consecutive_failures >= 5:
            t = asyncio.create_task(_maybe_send_futures_geo_alert(status))
            t.add_done_callback(lambda t: _on_task_done(t, "futures_geo_alert"))
        return []
    except httpx.TimeoutException as exc:
        # KLINE.EMPTY.TELEMETRY.1 — timeouts counted separately per exchange
        asyncio.create_task(_record_binance_kline_metric(0, success=False, timeout=True, futures=True))
        _futures_consecutive_failures += 1
        log.warning("futures_klines_timeout", symbol=symbol,
                    consecutive=_futures_consecutive_failures, error=str(exc))
        if _futures_consecutive_failures >= 5:
            t = asyncio.create_task(_maybe_send_futures_geo_alert(None))
            t.add_done_callback(lambda t: _on_task_done(t, "futures_geo_alert"))
        return []
    except Exception as exc:
        asyncio.create_task(_record_binance_kline_metric(0, success=False))
        _futures_consecutive_failures += 1
        log.warning("futures_klines_failed", symbol=symbol,
                    consecutive=_futures_consecutive_failures, error=str(exc))
        if _futures_consecutive_failures >= 5:
            t = asyncio.create_task(_maybe_send_futures_geo_alert(None))
            t.add_done_callback(lambda t: _on_task_done(t, "futures_geo_alert"))
        return []


async def _maybe_send_futures_geo_alert(status_code: int | None) -> None:
    """Alert once per hour when futures API is repeatedly failing (geo-block or outage)."""
    global _futures_alert_sent_at
    now = time.monotonic()
    if now - _futures_alert_sent_at < _FUTURES_ALERT_THROTTLE_S:
        return
    _futures_alert_sent_at = now
    try:
        from backend.core.scanner.telegram_notifier import _is_configured, _enqueue, _ops_alerts_enabled
        if not _is_configured():
            return
        if not await _ops_alerts_enabled():
            return
        if status_code == 451:
            reason = "HTTP <b>451 Unavailable For Legal Reasons</b> — Binance geo-block detected."
            action = "Railway region may be restricted by Binance. Consider switching deployment region or using a proxy."
        else:
            reason = f"<b>{_futures_consecutive_failures} consecutive failures</b> fetching futures klines."
            action = "Check Binance futures API connectivity and Railway network egress."
        text = (
            f"⚡ <b>Binance Futures API Down</b>\n\n"
            f"{reason}\n\n"
            f"Impact: Futures/High-Confidence signals degraded.\n"
            f"{action}\n\n"
            f"<i>Admin → Providers for details.</i>"
        )
        _enqueue(text)
        log.warning("futures_geo_alert_sent", status_code=status_code,
                    consecutive=_futures_consecutive_failures)
    except Exception as exc:
        log.warning("futures_geo_alert_failed", error=str(exc))


async def fetch_klines(
    symbol: str, interval: str, limit: int, is_futures: bool
) -> list[Candle]:
    return (
        await fetch_futures_klines(symbol, interval, limit)
        if is_futures
        else await fetch_spot_klines(symbol, interval, limit)
    )


# ── Futures symbols ───────────────────────────────────────────────────────────

_futures_symbols_cache = RedisCache("futures-symbols", ttl_seconds=60 * 60)  # 1h (was 30 min)

_FALLBACK_FUTURES = {
    "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT",
    "DOGEUSDT", "ADAUSDT", "AVAXUSDT", "LINKUSDT", "SUIUSDT",
}


_btc_4h_cache    = RedisCache("btc-4h-change", ttl_seconds=5 * 60)
_btc_regime_cache = RedisCache("btc-regime",    ttl_seconds=20 * 60)   # OPT-6: was 5 min; 20 min > 15-min standard scan cadence → alternating hit


def _classify_regime(
    rsi: float, trend_value: str, btc24h: float, strength: float, vol_value: str,
) -> str:
    """
    BTC 4h regime classifier. 7-condition decision tree.

    Priority order:
      1. EUPHORIA        — overbought RSI + extreme up-move
      2. CAPITULATION    — oversold RSI + extreme down-move
      3. HIGH_VOLATILITY — high ATR-vol AND abs price swing > 5%
      4. BULL_TREND      — EMA20 > EMA50 confirmed (lagging but high confidence)
      5. BEAR_TREND      — EMA20 < EMA50 confirmed
      6. BULL_TREND      — momentum fallback: early recovery before EMA crossover
                           btc28h > 3.5%, RSI > 55, some trend coherence
      7. SIDEWAYS        — default

    Phase REGIME.FIX.1: Added rule 6 so RANGING markets during a genuine
    bull recovery are labelled BULL_TREND instead of SIDEWAYS. This prevents
    NULL_SELL misclassification once signals table is regime-tagged.
    """
    if rsi > 78 and btc24h > 8:                               return "EUPHORIA"
    if rsi < 22 and btc24h < -8:                              return "CAPITULATION"
    if vol_value in ("HIGH", "EXTREME") and abs(btc24h) > 5:  return "HIGH_VOLATILITY"
    if trend_value == "BULLISH" and strength >= 50:           return "BULL_TREND"
    if trend_value == "BEARISH" and strength >= 50:           return "BEAR_TREND"
    # Momentum fallback — catches V-shaped recoveries before EMA crossover.
    # btc24h covers last 28h; >3.5% + RSI>55 + minimal coherence = genuine bull move.
    if btc24h > 3.5 and rsi > 55 and strength >= 20:          return "BULL_TREND"
    return "SIDEWAYS"


async def get_btc_regime() -> str:
    """
    BTC 4h market regime (Phase 8.1B).
    Returns: BULL_TREND | BEAR_TREND | SIDEWAYS | HIGH_VOLATILITY | EUPHORIA | CAPITULATION
    Cached 5 min. Falls back to SIDEWAYS on any error.
    Python port of lib/market-regime.ts:classifyRegime().
    """
    cached = await _btc_regime_cache.get("regime")
    if cached is not None:
        return str(cached)
    try:
        from backend.core.scanner.indicators import (   # noqa: PLC0415
            calculate_all_indicators, calc_trend_strength, calc_volatility_rating,
        )
        candles = await fetch_spot_klines("BTCUSDT", "4h", 100)
        if len(candles) < 60:
            return "SIDEWAYS"
        ind      = calculate_all_indicators(candles)
        strength = calc_trend_strength(ind)
        vol      = calc_volatility_rating(ind.atr, ind.current_price)
        tail     = candles[-7:]
        btc24h   = ((tail[-1].close - tail[0].open) / tail[0].open * 100) if len(tail) >= 7 else 0.0
        regime   = _classify_regime(ind.rsi, ind.trend.value, btc24h, strength, vol.value)
        await _btc_regime_cache.set("regime", regime)
        log.info("btc_regime_computed", regime=regime, rsi=round(ind.rsi, 1), btc24h=round(btc24h, 2))
        return regime
    except Exception as exc:
        log.warning("btc_regime_failed_defaulting_sideways", error=str(exc))
        return "SIDEWAYS"


async def fetch_btc_4h_change() -> float:
    """
    Return BTC's most recent 4h price change (%) vs the previous 4h close.

    Cached in Redis for 5 minutes — safe to call once per scan without
    hitting Binance rate limits.  Returns 0.0 on any error.
    """
    cached = await _btc_4h_cache.get("btc")
    if cached is not None:
        return float(cached)
    try:
        candles = await fetch_spot_klines("BTCUSDT", "4h", 3)
        if len(candles) >= 2:
            change = (candles[-1].close - candles[-2].close) / candles[-2].close * 100
            await _btc_4h_cache.set("btc", change)
            return round(change, 4)
    except Exception as exc:
        log.warning("btc_4h_change_fetch_failed", error=str(exc))
    return 0.0


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
    except Exception as exc:
        log.debug("fetch_funding_rate_failed", symbol=symbol, error=str(exc))
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


# ── CoinGecko — fallback only (primary path: Redis intelligence cache) ────────

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


async def fetch_top100() -> "IntelligenceCacheResult":
    """
    Return top coins via the Redis intelligence cache.

    The TypeScript intelligence workers (lib/intelligence/workers.ts) are the
    sole CMC callers. Python reads the pre-populated cache:intel:listings key —
    no direct CMC calls, no quota double-spending.

    Falls back to CoinGecko when the cache is cold.
    Returns an IntelligenceCacheResult (not bare list[CoinData]).
    """
    from backend.core.scanner.intelligence_cache import (  # noqa: PLC0415
        IntelligenceCacheResult,
        read_intelligence_listings,
    )
    return await read_intelligence_listings(limit=200)
