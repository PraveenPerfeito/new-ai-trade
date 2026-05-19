"""
Scan orchestrator — Python port of lib/scanner.ts runScan().

run_scan() drives the full scan lifecycle:
  1. Fetch top-100 from CoinGecko
  2. Filter + prioritize coins per mode
  3. Create scan run in DB
  4. Concurrent scan with asyncio.gather + semaphore
  5. Persist each signal as it arrives
  6. Send Telegram alerts for high-confidence signals
  7. Update scan run status

Progress is stored in Redis (ScanProgress JSON) so the status API
can be polled without touching the DB.
"""
from __future__ import annotations

import asyncio
import time
import uuid
from datetime import datetime, timezone

from backend.cache.redis_cache import get_redis
from backend.core.scanner.concurrency import gather_with_concurrency
from backend.core.scanner.db import (
    create_scan_run,
    update_scan_run,
    save_signal,
    upsert_coins,
)
from backend.core.scanner.market_fetcher import fetch_top100, fetch_futures_symbols
from backend.core.scanner.models import (
    CoinData, Signal, ScannerMode, ScannerConfig,
    ScanProgress, ScanResult,
)
from backend.core.scanner.signal_pipeline import scan_coin, CONFIGS
from backend.core.scanner.telegram_notifier import send_signal_alert, send_scan_summary
from backend.config import get_settings
from backend.logging.setup import get_logger
from backend.metrics.prometheus import (
    scan_runs_total,
    scan_duration_seconds,
    coins_scanned_total,
)

log = get_logger(__name__)

# Configurable concurrency (coins scanned in parallel)
MAX_CONCURRENT = 5
COIN_TIMEOUT   = 45.0  # seconds per coin (includes 2 kline fetches + 1 AI call)
PROGRESS_TTL   = 3600  # Redis key TTL for progress tracking

_PRIORITY = ["BTC", "ETH", "SOL", "BNB", "XRP", "DOGE", "ADA", "AVAX", "LINK", "SUI"]


# ── Progress helpers ──────────────────────────────────────────────────────────

async def _set_progress(progress: ScanProgress) -> None:
    try:
        redis = await get_redis()
        await redis.setex(
            f"scan:progress:{progress.scan_id}",
            PROGRESS_TTL,
            progress.model_dump_json(),
        )
        await redis.setex("scan:latest", PROGRESS_TTL, progress.model_dump_json())
    except Exception as exc:
        log.warning("progress_update_failed", error=str(exc))


async def get_progress(scan_id: str) -> ScanProgress | None:
    try:
        redis = await get_redis()
        raw = await redis.get(f"scan:progress:{scan_id}")
        return ScanProgress.model_validate_json(raw) if raw else None
    except Exception:
        return None


async def get_latest_progress() -> ScanProgress | None:
    try:
        redis = await get_redis()
        raw = await redis.get("scan:latest")
        return ScanProgress.model_validate_json(raw) if raw else None
    except Exception:
        return None


# ── Coin filtering ────────────────────────────────────────────────────────────

def _filter_coins(
    coins: list[CoinData],
    config: ScannerConfig,
    futures_symbols: set[str],
    mode: ScannerMode,
) -> list[CoinData]:
    result = [
        c for c in coins
        if (
            c.volume_24h >= config.min_volume_24h
            and c.market_cap >= config.min_market_cap
            and c.market_cap > 0
            and (c.volume_24h / c.market_cap) >= 0.005
            and c.price_change_24h > -50
        )
    ]

    if mode == ScannerMode.FUTURES:
        result = [c for c in result if c.binance_symbol in futures_symbols]
        result = [
            CoinData(**{**c.model_dump(), "has_futures": True}) for c in result
        ]

    if mode == ScannerMode.TRENDING:
        result = [
            c for c in result
            if c.price_change_24h > 2 or (c.volume_24h / (c.market_cap or 1)) > 0.08
        ]
        result.sort(key=lambda c: c.volume_24h / (c.market_cap or 1), reverse=True)
    else:
        result = _prioritize(result)

    return result[:config.max_coins_to_scan]


def _prioritize(coins: list[CoinData]) -> list[CoinData]:
    def key(c: CoinData) -> tuple[int, float]:
        pi = _PRIORITY.index(c.symbol) if c.symbol in _PRIORITY else len(_PRIORITY)
        score = c.volume_24h / 1e9 * 0.6 + c.market_cap / 1e12 * 0.4
        return (pi, -score)
    return sorted(coins, key=key)


# ── Main orchestrator ─────────────────────────────────────────────────────────

async def run_scan(mode: ScannerMode | str = ScannerMode.SPOT) -> ScanResult:
    if isinstance(mode, str):
        mode = ScannerMode(mode)

    config     = CONFIGS[mode]
    settings   = get_settings()
    alert_thr  = settings.scanner_min_confidence_alert
    scan_id    = str(uuid.uuid4())
    t0         = time.monotonic()
    t0_wall    = datetime.now(timezone.utc)

    log.info("scan_start", mode=mode.value, scan_id=scan_id)

    progress = ScanProgress(
        scan_id=scan_id,
        mode=mode,
        status="running",
        started_at=t0_wall.isoformat(),
    )
    await _set_progress(progress)

    scan_run_id = await create_scan_run(mode.value)

    try:
        # 1. Fetch top-100 + futures symbols
        all_coins, futures_syms = await asyncio.gather(
            fetch_top100(),
            fetch_futures_symbols() if mode in (ScannerMode.FUTURES, ScannerMode.HIGH_CONFIDENCE) else asyncio.sleep(0),
        )
        if not isinstance(futures_syms, set):
            futures_syms = set()

        log.info("coins_fetched", count=len(all_coins), mode=mode.value)

        # 2. Filter + prioritize
        filtered = _filter_coins(all_coins, config, futures_syms, mode)
        log.info("coins_filtered", count=len(filtered), mode=mode.value)

        # 3. Cache coin list in DB (non-blocking, best-effort)
        asyncio.create_task(upsert_coins(all_coins))

        progress.total = len(filtered)
        await _set_progress(progress)

        # 4. Concurrent scan
        signals: list[Signal] = []
        errors = 0

        async def _scan_one(coin: CoinData) -> Signal | None:
            return await scan_coin(coin, mode, config)

        results = await gather_with_concurrency(
            filtered,
            _scan_one,
            max_concurrent=MAX_CONCURRENT,
            timeout_per_item=COIN_TIMEOUT,
        )

        # 5. Process results
        for coin, signal, err in results:
            progress.scanned += 1
            coins_scanned_total.labels(mode=mode.value).inc()

            if err is not None:
                errors += 1
            elif signal is not None:
                signal.scan_run_id = scan_run_id
                sig_id = await save_signal(signal)
                if sig_id:
                    signal.id = sig_id

                if signal.confidence >= alert_thr:
                    sent = await send_signal_alert(signal)
                    signal.telegram_sent = sent

                signals.append(signal)
                progress.signals_found += 1
                log.info(
                    "signal_accepted",
                    symbol=coin.symbol,
                    type=signal.type.value,
                    confidence=signal.confidence,
                    rr=signal.rr_ratio,
                )

            await _set_progress(progress)

        # 6. Finalise
        duration_ms = int((time.monotonic() - t0) * 1000)
        high_conf = sum(1 for s in signals if s.confidence >= alert_thr)

        progress.status = "completed"
        progress.completed_at = datetime.now(timezone.utc).isoformat()
        progress.duration_ms = duration_ms
        progress.errors = errors
        await _set_progress(progress)

        if scan_run_id:
            await update_scan_run(
                scan_run_id,
                coins_scanned=progress.scanned,
                signals_found=len(signals),
                status="completed",
                completed_at=datetime.now(timezone.utc).isoformat(),
            )

        asyncio.create_task(
            send_scan_summary(progress.scanned, len(signals), high_conf, duration_ms, mode.value)
        )

        scan_runs_total.labels(mode=mode.value, status="completed").inc()
        scan_duration_seconds.labels(mode=mode.value).observe(duration_ms / 1000)
        log.info(
            "scan_complete",
            mode=mode.value,
            scanned=progress.scanned,
            signals=len(signals),
            errors=errors,
            duration_ms=duration_ms,
        )

        return ScanResult(
            scan_run_id=scan_run_id,
            mode=mode,
            signals=signals,
            coins_scanned=progress.scanned,
            duration_ms=duration_ms,
            signals_found=len(signals),
            errors=errors,
        )

    except Exception as exc:
        duration_ms = int((time.monotonic() - t0) * 1000)
        log.error("scan_failed", mode=mode.value, error=str(exc))

        progress.status = "failed"
        progress.completed_at = datetime.now(timezone.utc).isoformat()
        progress.duration_ms = duration_ms
        await _set_progress(progress)

        if scan_run_id:
            await update_scan_run(
                scan_run_id,
                status="failed",
                error=str(exc),
                completed_at=datetime.now(timezone.utc).isoformat(),
            )

        scan_runs_total.labels(mode=mode.value, status="failed").inc()
        raise
