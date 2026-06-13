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
    has_recent_signal,
    mark_signal_telegram_sent,
    upsert_coins,
)
from backend.core.scanner.market_fetcher import fetch_top100, fetch_futures_symbols, fetch_btc_4h_change, get_btc_regime
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
    gate_rejections_total,
)

log = get_logger(__name__)


def _on_task_done(task: asyncio.Task, label: str) -> None:
    if not task.cancelled() and task.exception() is not None:
        log.warning("background_task_failed", task=label, error=str(task.exception()))


# Configurable concurrency (coins scanned in parallel)
MAX_CONCURRENT = 5
COIN_TIMEOUT   = 45.0  # seconds per coin (includes 2 kline fetches + 1 AI call)
PROGRESS_TTL   = 3600  # Redis key TTL for progress tracking

_PRIORITY = ["BTC", "ETH", "SOL", "BNB", "XRP", "DOGE", "ADA", "AVAX", "LINK", "SUI"]

# Stablecoins and pegged tokens — CoinGecko top-100 includes these but Binance
# returns 400 for USDTUSDT etc. and they have no tradeable signal anyway.
_SKIP_SYMBOLS = frozenset({
    # Stablecoins — no tradeable signal, Binance returns 400 for *USDT pairs
    "USDT", "USDC", "DAI", "BUSD", "TUSD", "USDP", "GUSD", "FRAX",
    "USDD", "FDUSD", "PYUSD", "USDG", "RLSD", "USDE", "USD1", "RLUSD",
    # Wrapped / synthetic tokens not on Binance spot
    "WBT", "WBTC",
    # Tokens not listed on Binance spot (400 Bad Request confirmed in logs)
    "VVV", "MNT", "HYPE", "OKB", "H", "HUSDT",
    # Other known non-Binance-spot tokens
    "FF", "GENIUS",
})

_PERSISTED_GATE_KEYS = (
    "BTC_DOWN_BUY",
    "TOXIC_DENYLIST",
    "SIGNAL_COOLDOWN",   # Phase SIGNAL.COOLDOWN.1: replaces DUPLICATE_SIGNAL; 4h window, keyed by mode
    "CONFIDENCE_REJECTION",
    "CMC_REJECTION",
    "REGIME_REJECTION",
    "CONTRA_REGIME_REJECTION",   # REGIME.HARD.GATE.V2 — contra-regime reject (flag-gated)
    "KLINE_EMPTY",     # KLINE.EMPTY.TELEMETRY.1 — all timeframes empty (API failure signature)
    "KLINE_PARTIAL",   # KLINE.EMPTY.TELEMETRY.1 — insufficient candles (thin/new listing)
    # PIPELINE.HARDENING.1 — full pipeline accounting (6 additional inner-pipeline gates)
    "MTF_REJECTION",
    "VOLATILITY_REJECTION",
    "TREND_STRENGTH_REJECTION",
    "SETUP_REJECTION",
    "RR_REJECTION",
    "RISK_REJECTION",
)


def _new_gate_rejections() -> dict[str, int]:
    return {key: 0 for key in _PERSISTED_GATE_KEYS}


def _record_persisted_gate(gate_rejections: dict[str, int], gate: str) -> None:
    gate_rejections[gate] = int(gate_rejections.get(gate, 0)) + 1


# ── Progress helpers ──────────────────────────────────────────────────────────

async def _set_progress(progress: ScanProgress) -> None:
    try:
        redis = await get_redis()
        await redis.setex(
            f"scan:progress:{progress.scan_id}",
            PROGRESS_TTL,
            progress.model_dump_json(),
        )
        await redis.setex(
            f"scan:latest:{progress.mode.value}", PROGRESS_TTL, progress.model_dump_json()
        )
    except Exception as exc:
        log.warning("progress_update_failed", error=str(exc))


async def get_progress(scan_id: str) -> ScanProgress | None:
    try:
        redis = await get_redis()
        raw = await redis.get(f"scan:progress:{scan_id}")
        return ScanProgress.model_validate_json(raw) if raw else None
    except Exception:
        return None


async def get_latest_progress(mode: str | None = None) -> ScanProgress | None:
    """Return the most recent ScanProgress for a given mode, or the newest across all modes."""
    try:
        redis = await get_redis()
        if mode:
            raw = await redis.get(f"scan:latest:{mode}")
            return ScanProgress.model_validate_json(raw) if raw else None
        # No mode specified — find the most recently completed across all modes
        candidates: list[ScanProgress] = []
        for m in ("spot", "futures", "trending", "high_confidence"):
            raw = await redis.get(f"scan:latest:{m}")
            if raw:
                try:
                    candidates.append(ScanProgress.model_validate_json(raw))
                except Exception:
                    pass
        if not candidates:
            return None
        return max(candidates, key=lambda p: p.started_at or "")
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
            c.symbol.upper() not in _SKIP_SYMBOLS
            # Exclude tokens whose symbol starts with known stablecoin prefixes
            and not any(c.symbol.upper().startswith(p) for p in ("USD", "DAI", "BUSD", "USDE"))
            and c.volume_24h >= config.min_volume_24h
            and c.market_cap >= config.min_market_cap
            and c.market_cap > 0
            and (c.volume_24h / c.market_cap) >= 0.005
            and c.price_change_24h > -20    # exclude crash / rug candidates (was -50)
        )
    ]

    if mode == ScannerMode.FUTURES:
        result = [c for c in result if c.binance_symbol in futures_symbols]
        result = [
            CoinData(**{**c.model_dump(), "has_futures": True}) for c in result
        ]

    if mode == ScannerMode.TRENDING:
        # Universe is pre-ranked by discovery_score from build_trending_universe().
        # Preserve that order — only apply a minimal volume-turnover sanity check.
        result = [c for c in result if (c.volume_24h / (c.market_cap or 1)) > 0.02]
    else:
        result = _prioritize(result)

    return result[:config.max_coins_to_scan]


def _prioritize(coins: list[CoinData]) -> list[CoinData]:
    def key(c: CoinData) -> tuple[int, float]:
        pi = _PRIORITY.index(c.symbol) if c.symbol in _PRIORITY else len(_PRIORITY)
        score = c.volume_24h / 1e9 * 0.6 + c.market_cap / 1e12 * 0.4
        return (pi, -score)
    return sorted(coins, key=key)


# ── Founder threshold floors (SETTINGS.WIRE.1) ───────────────────────────────

def apply_founder_floors(
    config: ScannerConfig,
    alert_thr: int,
    *,
    min_confidence: int,
    alert_confidence: int,
    min_rr_ratio: float,
    max_coins: int,
) -> "tuple[ScannerConfig, int]":
    """
    Apply founder Quick Controls as FLOORS on the audited per-mode config.
    Floors can only tighten: confidence/RR use max(), coin coverage uses min().
    They can never loosen below the ALPHA.TRUTH.1-tuned per-mode minimums —
    e.g. an 'Aggressive' preset writing min_confidence=72 still scans at the
    mode's audited 85 for spot.
    """
    floored = config.model_copy(update={
        "min_confidence":    max(config.min_confidence, min_confidence),
        "min_rr_ratio":      max(config.min_rr_ratio, min_rr_ratio),
        "max_coins_to_scan": min(config.max_coins_to_scan, max_coins),
    })
    return floored, max(alert_thr, alert_confidence)


async def _maybe_apply_founder_floors(
    config: ScannerConfig, alert_thr: int, mode: ScannerMode
) -> "tuple[ScannerConfig, int]":
    """Read flags + founder settings once per scan; no-op when flag OFF or on error."""
    try:
        from backend.system_settings.service import get_settings_service  # noqa: PLC0415
        from backend.system_settings.groups import (  # noqa: PLC0415
            FeatureFlags, ScannerSettings, SignalThresholdSettings,
        )
        svc = get_settings_service()
        flags = await svc.get_group(FeatureFlags)
        if not flags.apply_founder_thresholds:
            return config, alert_thr
        scanner_cfg = await svc.get_group(ScannerSettings)
        signal_cfg  = await svc.get_group(SignalThresholdSettings)
        floored, floored_alert = apply_founder_floors(
            config, alert_thr,
            min_confidence=scanner_cfg.min_confidence,
            alert_confidence=scanner_cfg.alert_confidence,
            min_rr_ratio=signal_cfg.min_rr_ratio,
            max_coins=scanner_cfg.max_coins_per_run,
        )
        if (floored.min_confidence != config.min_confidence
                or floored.min_rr_ratio != config.min_rr_ratio
                or floored.max_coins_to_scan != config.max_coins_to_scan
                or floored_alert != alert_thr):
            log.info(
                "founder_floors_applied",
                mode=mode.value,
                min_confidence=floored.min_confidence,
                min_rr=floored.min_rr_ratio,
                max_coins=floored.max_coins_to_scan,
                alert_thr=floored_alert,
            )
        return floored, floored_alert
    except Exception as exc:
        log.warning("founder_floors_read_failed", error=str(exc))
        return config, alert_thr


# ── Main orchestrator ─────────────────────────────────────────────────────────

async def run_scan(mode: ScannerMode | str = ScannerMode.SPOT) -> ScanResult:
    if isinstance(mode, str):
        mode = ScannerMode(mode)

    config     = CONFIGS[mode]
    settings   = get_settings()
    alert_thr  = settings.scanner_min_confidence_alert
    # SETTINGS.WIRE.1 — founder Quick Controls as floors (flag-gated, default OFF)
    config, alert_thr = await _maybe_apply_founder_floors(config, alert_thr, mode)

    # PHASE.9.1 — probability delivery gate config (flag default OFF)
    prob_gate_enabled, min_empirical_wr = False, 45.0
    exp_filter_enabled, min_empirical_exp = False, 0.0
    try:
        from backend.system_settings.service import get_settings_service  # noqa: PLC0415
        from backend.system_settings.groups import FeatureFlags, ScannerSettings  # noqa: PLC0415
        _svc = get_settings_service()
        _ff  = await _svc.get_group(FeatureFlags)
        _sc  = await _svc.get_group(ScannerSettings)
        prob_gate_enabled  = bool(_ff.probability_gate_enabled)
        exp_filter_enabled = bool(getattr(_ff, "probability_gate_v1", False))
        min_empirical_wr   = float(_sc.min_empirical_wr)
        min_empirical_exp  = float(getattr(_sc, "min_empirical_exp", 0.0))
    except Exception as exc:
        log.warning("probability_gate_config_read_failed", error=str(exc))
    scan_id    = str(uuid.uuid4())
    t0         = time.monotonic()
    t0_wall    = datetime.now(timezone.utc)

    log.info("scan_start", mode=mode.value, scan_id=scan_id)
    btc_regime = "SIDEWAYS"   # resolved after fetches; placeholder for pre-fetch log

    progress = ScanProgress(
        scan_id=scan_id,
        mode=mode,
        status="running",
        started_at=t0_wall.isoformat(),
    )
    await _set_progress(progress)

    scan_run_id = await create_scan_run(mode.value)

    try:
        # 1. Fetch top-100 + futures symbols + BTC 4h change (TRENDING mode only)
        async def _no_futures() -> set[str]:
            return set()

        async def _btc_4h() -> float:
            return await fetch_btc_4h_change() if mode == ScannerMode.TRENDING else 0.0

        async def _regime() -> str:
            return await get_btc_regime()

        coin_result, futures_syms, btc_4h_change, btc_regime = await asyncio.gather(
            fetch_top100(),
            fetch_futures_symbols() if mode in (ScannerMode.FUTURES, ScannerMode.HIGH_CONFIDENCE) else _no_futures(),
            _btc_4h(),
            _regime(),
        )
        # NULL_REGIME.ROOTCAUSE.1 — get_btc_regime() can return "" on kline failure;
        # the hard gate in signal_pipeline.py rejects None/empty correctly, but a
        # falsy string here would skip the soft regime adjustment in orchestrator
        # logging and scan_coin() kwargs. Normalise once, at the source.
        btc_regime = btc_regime or "SIDEWAYS"
        all_coins = coin_result.coins

        log.info(
            "coins_fetched",
            count=len(all_coins),
            mode=mode.value,
            cache_source=coin_result.cache_source,
            cache_age_s=round(coin_result.cache_age_seconds, 1),
            cache_is_fresh=coin_result.is_fresh,
            cache_hit=coin_result.cache_hit,
        )

        # Phase 7.3A.8 — operational visibility when CMC intelligence is degraded
        if coin_result.cache_source in ("coingecko_fallback", "empty"):
            cmc_count  = 200   # normal CMC universe size
            actual     = len(all_coins)
            log.warning(
                "intel_provider_degraded",
                primary="coinmarketcap",
                fallback=coin_result.cache_source,
                normal_universe=cmc_count,
                actual_universe=actual,
                universe_reduction_pct=round((cmc_count - actual) / cmc_count * 100, 1),
                mode=mode.value,
                impact="scan_universe_reduced",
            )

        # Extract BTC 24h change for relative-strength scoring
        btc_change_24h = next(
            (c.price_change_24h for c in all_coins if c.symbol == "BTC"), 0.0
        )

        # Phase 7.4A.7.1/7.4A.7.2: per-coin intelligence maps for TRENDING mode.
        # Empty for all other modes → NULL on Signal (correct).
        trend_score_map:   dict[str, float] = {}
        sector_status_map: dict[str, str]   = {}

        # 1b. TRENDING mode: expand universe with multi-source CMC intelligence
        if mode == ScannerMode.TRENDING:
            from backend.core.scanner.intelligence_cache import CMC_INTELLIGENCE_ENABLED  # noqa: PLC0415
            if not CMC_INTELLIGENCE_ENABLED:
                log.warning(
                    "cmc_trending_intelligence_disabled",
                    reason="trend_score_sector_not_measurable",
                    mode=mode.value,
                )
            else:
                from backend.core.scanner.trending_universe import build_trending_universe  # noqa: PLC0415
                tr = await build_trending_universe(
                    base_coins=all_coins,
                    btc_change_24h=btc_change_24h,
                    btc_4h_change=btc_4h_change,      # Phase 7.3A.4: precise 4h RS reference
                )
                all_coins = tr.coins
                # Build per-symbol lookups for Signal propagation (Phase 7.4A.7.1 / 7.4A.7.2)
                trend_score_map = {
                    sym: round(meta.trend_score, 2)
                    for sym, meta in tr.meta.items()
                    if meta.trend_score is not None
                }
                if tr.sector_report:
                    for sym, meta in tr.meta.items():
                        if meta.sector:
                            analysis = tr.sector_report.get(meta.sector)
                            if analysis:
                                sector_status_map[sym] = analysis.status.value
                if not all_coins:
                    log.warning(
                        "trending_universe_empty_using_standard_fallback",
                        original_count=len(coin_result.coins),
                        reason="build_trending_universe_returned_no_candidates",
                    )
                    all_coins = coin_result.coins

                log.info(
                    "trending_universe_applied",
                    total_candidates=len(tr.coins),
                    new_from_cmc_trending=tr.new_from_trending,
                    rising_sectors=tr.rising_sectors,
                    source_counts=tr.source_counts,
                    btc_4h_change=round(btc_4h_change, 2),
                )

        # 2. Filter + prioritize
        filtered = _filter_coins(all_coins, config, futures_syms, mode)
        log.info("coins_filtered", count=len(filtered), mode=mode.value)

        # 2b. INTEL.PROPAGATE.1 — sector/trend maps for non-TRENDING modes.
        # Cache-only (no API calls); TRENDING already built richer maps above.
        # Audit basis: sector_status was NULL on 100% and trend_score on 98.7%
        # of outcomes because these were TRENDING-only.
        if mode != ScannerMode.TRENDING and not trend_score_map:
            try:
                from backend.core.scanner.trending_universe import build_intelligence_maps  # noqa: PLC0415
                trend_score_map, sector_status_map = await build_intelligence_maps(
                    filtered, btc_change_24h,
                )
                log.info(
                    "intelligence_maps_built",
                    mode=mode.value,
                    trend_scores=len(trend_score_map),
                    sector_statuses=len(sector_status_map),
                )
            except Exception as exc:
                log.warning("intelligence_maps_failed", mode=mode.value, error=str(exc))

        # 3. Cache coin list in DB (non-blocking, best-effort)
        t = asyncio.create_task(upsert_coins(all_coins))
        t.add_done_callback(lambda t: _on_task_done(t, "upsert_coins"))

        progress.total = len(filtered)
        await _set_progress(progress)

        # 4. Concurrent scan
        signals: list[Signal] = []
        errors = 0
        gate_rejections = _new_gate_rejections()

        log.info("btc_regime_for_scan", regime=btc_regime, mode=mode.value)

        async def _scan_one(coin: CoinData) -> Signal | None:
            # Phase 7.4A.7.1 / 7.4A.7.2: pass per-coin intelligence (None for non-TRENDING)
            ts = trend_score_map.get(coin.symbol)
            ss = sector_status_map.get(coin.symbol)
            return await scan_coin(
                coin, mode, config,
                btc_change_24h=btc_change_24h,
                trend_score=ts,
                sector_status=ss,
                gate_rejections=gate_rejections,
                btc_regime=btc_regime,   # Phase 8.1B — soft regime gate
            )

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
                signal.market_regime = btc_regime   # Phase 8.1B — store macro regime on signal
                signal.scan_run_id = scan_run_id

                # PHASE.9.1/P1 — stamp empirical cohort probability + grade
                # (shadow data; the delivery gate below only acts when flags ON)
                _cohort = None
                try:
                    from backend.analytics.probability import (  # noqa: PLC0415
                        get_probability_lookup, evaluate, empirical_grade,
                    )
                    _plookup = await get_probability_lookup()
                    if _plookup:
                        _cohort = evaluate(
                            _plookup,
                            market_regime=signal.market_regime,
                            signal_type=signal.type.value,
                            breakout_strength=signal.breakout_strength,
                            confidence=signal.confidence,
                        )
                        if _cohort is not None:
                            signal.empirical_wr = _cohort.wr
                            signal.empirical_n  = _cohort.n
                            signal.empirical_grade = empirical_grade(_cohort.exp, _cohort.n)
                except Exception as exc:
                    log.debug("empirical_stamp_failed", symbol=signal.symbol, error=str(exc))

                if await has_recent_signal(signal.symbol, signal.type.value, mode.value, cooldown_minutes=240):
                    _record_persisted_gate(gate_rejections, "SIGNAL_COOLDOWN")
                    gate_rejections_total.labels(gate="signal_cooldown").inc()
                    log.info(
                        "signal_cooldown_suppressed",
                        symbol=signal.symbol,
                        type=signal.type.value,
                        mode=mode.value,
                        cooldown_minutes=240,
                    )
                    continue

                # C1/C2 PIPELINE.HARDENING.1 — persistence-first: only accept a signal
                # if it was successfully written to DB. Prevents Telegram alerts and
                # analytics for signals that have no DB row.
                sig_id = await save_signal(signal)
                if not sig_id:
                    log.error(
                        "signal_dropped_save_failed",
                        symbol=signal.symbol,
                        type=signal.type.value,
                        mode=mode.value,
                    )
                    continue

                signal.id = sig_id
                # Monitoring counter (fire-and-forget)
                try:
                    from backend.analytics.monitoring import record_signal as _mon_signal  # noqa: PLC0415
                    t = asyncio.create_task(_mon_signal())
                    t.add_done_callback(lambda t: _on_task_done(t, "monitor_signal"))
                except Exception:
                    pass

                # PHASE.9.1 — persist the probability stamp (best-effort; tolerates
                # the migration not having run yet)
                if signal.empirical_wr is not None:
                    try:
                        from backend.analytics.probability import persist_empirical  # noqa: PLC0415
                        t = asyncio.create_task(
                            persist_empirical(sig_id, signal.empirical_wr, signal.empirical_n,
                                              signal.empirical_grade)
                        )
                        t.add_done_callback(lambda t: _on_task_done(t, "persist_empirical"))
                    except Exception:
                        pass

                if signal.confidence >= alert_thr:
                    # PHASE.9.1/P1 — probability delivery gate: suppress the
                    # Telegram send (signal stays persisted + outcome-tracked)
                    # when cohort WR is below floor — or, with the v1 expectancy
                    # filter ON, when cohort expectancy is below floor.
                    from backend.analytics.probability import should_suppress_send  # noqa: PLC0415
                    if should_suppress_send(
                        prob_gate_enabled, signal.empirical_wr, min_empirical_wr,
                        expectancy_filter=exp_filter_enabled,
                        empirical_exp=(_cohort.exp if _cohort is not None else None),
                        min_expectancy=min_empirical_exp,
                    ):
                        gate_rejections_total.labels(gate="probability_send_gate").inc()
                        log.info(
                            "probability_gate_suppressed_send",
                            symbol=signal.symbol,
                            type=signal.type.value,
                            empirical_wr=signal.empirical_wr,
                            empirical_n=signal.empirical_n,
                            empirical_exp=(_cohort.exp if _cohort is not None else None),
                            threshold=min_empirical_wr,
                            min_expectancy=min_empirical_exp if exp_filter_enabled else None,
                        )
                    else:
                        sent = await send_signal_alert(signal)
                        signal.telegram_sent = sent
                        if sent:
                            try:
                                await mark_signal_telegram_sent(signal.id)
                            except Exception as exc:
                                log.warning("mark_telegram_sent_failed", signal_id=signal.id, error=str(exc))

                # Analytics: register outcome tracker (best-effort)
                t = asyncio.create_task(_register_analytics(signal))
                t.add_done_callback(lambda t: _on_task_done(t, "register_analytics"))

                signals.append(signal)
                progress.signals_found += 1
                log.info(
                    "signal_accepted",
                    symbol=coin.symbol,
                    type=signal.type.value,
                    confidence=signal.confidence,
                    rr=signal.rr_ratio,
                )

            # OPT-1 extended: update Redis every 25 coins (was 10) — coarser bar, fewer ops
            if progress.scanned % 25 == 0 or progress.scanned == progress.total:
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
                completed_at=datetime.now(timezone.utc),
            )

        # Scan summary only for spot mode — futures/high_confidence summaries are noise
        if mode == ScannerMode.SPOT:
            t = asyncio.create_task(
                send_scan_summary(progress.scanned, len(signals), high_conf, duration_ms, mode.value)
            )
            t.add_done_callback(lambda t: _on_task_done(t, "send_scan_summary"))

        # Monitoring: record scan duration + coins (fire-and-forget)
        try:
            from backend.analytics.monitoring import record_scan as _mon_scan  # noqa: PLC0415
            t2 = asyncio.create_task(_mon_scan(progress.scanned, duration_ms))
            t2.add_done_callback(lambda t: _on_task_done(t, "monitor_scan"))
        except Exception:
            pass

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

        log.info("scan_gate_rejections", mode=mode.value, gate_rejections=gate_rejections)

        return ScanResult(
            scan_run_id=scan_run_id,
            mode=mode,
            signals=signals,
            coins_scanned=progress.scanned,
            duration_ms=duration_ms,
            signals_found=len(signals),
            errors=errors,
            gate_rejections=gate_rejections,
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
                completed_at=datetime.now(timezone.utc),
            )

        scan_runs_total.labels(mode=mode.value, status="failed").inc()
        raise


# ── Analytics integration (fire-and-forget) ───────────────────────────────────

async def _register_analytics(signal) -> None:
    """Register a signal with the outcome tracker."""
    try:
        from backend.analytics.signal_metrics import register_signal_outcome
        await register_signal_outcome(signal)
    except Exception as exc:
        log.warning("register_outcome_failed", symbol=signal.symbol, error=str(exc))
