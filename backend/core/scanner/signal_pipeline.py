"""
Per-coin signal pipeline — Python port of lib/scanner.ts scanCoin().

scan_coin() is a pure async function; it returns Signal | None and does
NOT touch the database or send alerts. Those concerns belong to the
orchestrator which calls this function concurrently.
"""
from __future__ import annotations

import time

from backend.core.scanner.ai_validator import validate_signal
from backend.core.scanner.futures_intelligence import analyze_futures_intelligence
from backend.core.scanner.indicators import (
    calculate_all_indicators,
    calc_trend_strength,
    calc_volatility_rating,
    confirm_multi_timeframe,
)
from backend.core.scanner.market_fetcher import fetch_klines
from backend.core.scanner.market_structure import run_market_structure_checks
from backend.core.scanner.models import (
    Candle, CoinData, Signal, ScannerConfig, ScannerMode, SignalType,
    TechnicalIndicators, TradeLevels, SetupResult, VolatilityRating,
    TrendDirection,
)
from backend.core.scanner.risk import validate_risk, RiskInput
from backend.logging.setup import get_logger
from backend.metrics.prometheus import (
    gate_rejections_total,
    signals_generated_total,
    scanner_coin_duration_seconds,
    scanner_concurrency_active,
)

log = get_logger(__name__)

# ── Mode configs (mirror of CONFIGS in lib/scanner.ts) ───────────────────────

CONFIGS: dict[ScannerMode, ScannerConfig] = {
    ScannerMode.SPOT: ScannerConfig(
        min_market_cap=500_000_000,
        min_volume_24h=50_000_000,
        min_rr_ratio=2.0,
        min_confidence=80,
        max_coins_to_scan=50,
        scanner_mode=ScannerMode.SPOT,
    ),
    ScannerMode.FUTURES: ScannerConfig(
        min_market_cap=1_000_000_000,
        min_volume_24h=200_000_000,
        min_rr_ratio=2.0,
        min_confidence=82,
        max_coins_to_scan=40,
        scanner_mode=ScannerMode.FUTURES,
    ),
    ScannerMode.HIGH_CONFIDENCE: ScannerConfig(
        min_market_cap=2_000_000_000,
        min_volume_24h=500_000_000,
        min_rr_ratio=2.0,
        min_confidence=87,
        max_coins_to_scan=30,
        scanner_mode=ScannerMode.HIGH_CONFIDENCE,
    ),
    ScannerMode.TRENDING: ScannerConfig(
        min_market_cap=100_000_000,
        min_volume_24h=20_000_000,
        min_rr_ratio=2.0,
        min_confidence=78,
        max_coins_to_scan=60,
        scanner_mode=ScannerMode.TRENDING,
    ),
}

_TARGET_MULT: dict[ScannerMode, float] = {
    ScannerMode.HIGH_CONFIDENCE: 3.0,
    ScannerMode.FUTURES: 2.5,
    ScannerMode.SPOT: 2.0,
    ScannerMode.TRENDING: 2.0,
}


# ── Setup quality scoring ─────────────────────────────────────────────────────

def detect_setup(
    ind1h: TechnicalIndicators,
    ind4h: TechnicalIndicators,
    signal_type: SignalType,
    strength_1h: float,
    strength_4h: float,
) -> SetupResult:
    """
    Pre-AI setup quality score (max ~100, threshold 65).
    Mirrors detectSetup() in lib/scanner.ts exactly.
    """
    score = 0
    reasons: list[str] = []

    if signal_type == SignalType.BUY:
        if ind4h.trend == TrendDirection.BULLISH:
            score += 30
            reasons.append(f"4h bullish (EMA20 {'>' if ind4h.ema20 > ind4h.ema50 else '<'} EMA50)")
        if ind1h.trend == TrendDirection.BULLISH:
            score += 20
            reasons.append("1h bullish trend confirmed")
        if 48 <= ind1h.rsi <= 70:
            score += 15
            reasons.append(f"RSI {ind1h.rsi:.1f} in bullish zone (48-70)")
        elif ind1h.rsi > 78:
            score -= 25
        elif ind1h.rsi < 40:
            score -= 5
        if ind1h.macd.histogram > 0:
            score += 15
            reasons.append("1h MACD histogram positive")
        else:
            score -= 10
        if ind1h.volume_spike >= 1.5:
            score += 10
            reasons.append(f"Volume spike {ind1h.volume_spike:.1f}×")
        elif ind1h.volume_spike < 0.8:
            score -= 10
    else:
        if ind4h.trend == TrendDirection.BEARISH:
            score += 30
            reasons.append(f"4h bearish (EMA20 {'<' if ind4h.ema20 < ind4h.ema50 else '>'} EMA50)")
        if ind1h.trend == TrendDirection.BEARISH:
            score += 20
            reasons.append("1h bearish trend confirmed")
        if 30 <= ind1h.rsi <= 52:
            score += 15
            reasons.append(f"RSI {ind1h.rsi:.1f} in bearish zone (30-52)")
        elif ind1h.rsi < 22:
            score -= 25
        elif ind1h.rsi > 60:
            score -= 5
        if ind1h.macd.histogram < 0:
            score += 15
            reasons.append("1h MACD histogram negative")
        else:
            score -= 10
        if ind1h.volume_spike >= 1.5:
            score += 10
            reasons.append(f"Volume spike {ind1h.volume_spike:.1f}×")
        elif ind1h.volume_spike < 0.8:
            score -= 10

    combined = strength_1h * 0.4 + strength_4h * 0.6
    if combined > 60:
        score += 10
        reasons.append(f"Strong trend score: {combined:.0f}/100")

    return SetupResult(
        has_setup=score >= 65,
        description=". ".join(reasons),
        pre_score=score,
    )


# ── Trade levels ──────────────────────────────────────────────────────────────

def trade_levels(
    price: float,
    atr: float,
    signal_type: SignalType,
    mode: ScannerMode,
) -> TradeLevels:
    target_mult = _TARGET_MULT.get(mode, 2.0)
    stop_mult   = 1.0

    if signal_type == SignalType.BUY:
        target = price + atr * target_mult
        stop   = price - atr * stop_mult
    else:
        target = price - atr * target_mult
        stop   = price + atr * stop_mult

    risk   = abs(price - stop)
    reward = abs(target - price)
    rr     = reward / risk if risk > 0 else 0.0

    return TradeLevels(
        entry_price=price,
        target_price=target,
        stop_loss=stop,
        rr_ratio=round(rr, 4),
    )


# ── Single-coin pipeline ──────────────────────────────────────────────────────

async def scan_coin(
    coin: CoinData,
    mode: ScannerMode,
    config: ScannerConfig,
) -> Signal | None:
    """
    Full 10-step pipeline for one coin.
    Returns Signal on acceptance, None at any rejection step.
    Never raises — all exceptions are caught and logged.
    """
    label = f"{coin.symbol}:{mode.value}"
    t0 = time.perf_counter()
    scanner_concurrency_active.inc()

    try:
        is_futures = mode == ScannerMode.FUTURES
        candles_1h, candles_4h = await _fetch_both_timeframes(coin, is_futures)

        if len(candles_1h) < 60 or len(candles_4h) < 60:
            return None

        # Step 2: Indicators
        ind1h = calculate_all_indicators(candles_1h)
        ind4h = calculate_all_indicators(candles_4h)

        # Step 3: Direction from 4h
        if ind4h.trend == TrendDirection.BULLISH:
            signal_type = SignalType.BUY
        elif ind4h.trend == TrendDirection.BEARISH:
            signal_type = SignalType.SELL
        else:
            return None  # 4h ranging

        # Step 4: MTF confirmation
        mtf = confirm_multi_timeframe(ind1h, ind4h, signal_type)
        if not mtf.confirmed:
            gate_rejections_total.labels(gate="mtf").inc()
            return None

        # Step 5: Volatility gate
        volatility = calc_volatility_rating(ind1h.atr, ind1h.current_price)
        if volatility == VolatilityRating.EXTREME:
            gate_rejections_total.labels(gate="volatility").inc()
            log.info("rejected_extreme_volatility", symbol=coin.symbol)
            return None

        # Step 6: Trend strength
        s1h = calc_trend_strength(ind1h)
        s4h = calc_trend_strength(ind4h)
        if s1h * 0.4 + s4h * 0.6 < 30:
            gate_rejections_total.labels(gate="trend_strength").inc()
            return None

        # Step 5b: Market structure (7 filters)
        structure = run_market_structure_checks(
            candles=candles_1h,
            atr=ind1h.atr,
            current_price=ind1h.current_price,
            volume_spike=ind1h.volume_spike,
            signal_type=signal_type,
        )
        if not structure.pass_:
            gate_rejections_total.labels(gate="market_structure").inc()
            log.info("rejected_market_structure", symbol=coin.symbol, reason=structure.rejection_reason)
            return None

        # Step 7: Setup scoring
        setup = detect_setup(ind1h, ind4h, signal_type, s1h, s4h)
        if not setup.has_setup:
            gate_rejections_total.labels(gate="setup_score").inc()
            return None

        # Step 8: Trade levels + RR gate
        if ind1h.atr == 0:
            return None
        levels = trade_levels(ind1h.current_price, ind1h.atr, signal_type, mode)
        if levels.rr_ratio < config.min_rr_ratio:
            gate_rejections_total.labels(gate="rr_ratio").inc()
            return None

        # Step 9: Risk engine
        risk = validate_risk(RiskInput(
            entry=levels.entry_price,
            stop_loss=levels.stop_loss,
            rr_ratio=levels.rr_ratio,
            ind_1h=ind1h,
            ind_4h=ind4h,
            coin=coin,
            signal_type=signal_type,
            mode=mode,
            volatility=volatility,
            combined_strength=s1h * 0.4 + s4h * 0.6,
        ))
        if not risk.pass_:
            gate_rejections_total.labels(gate="risk_engine").inc()
            log.info("rejected_risk_engine", symbol=coin.symbol, summary=risk.summary)
            return None

        # Step 10: Futures intelligence (futures / high_confidence modes only)
        futures_data = None
        if mode in (ScannerMode.FUTURES, ScannerMode.HIGH_CONFIDENCE):
            try:
                futures_data = await analyze_futures_intelligence(
                    symbol=coin.binance_symbol,
                    base_symbol=coin.symbol,
                    candles_1h=candles_1h,
                    ema20=ind1h.ema20,
                    atr=ind1h.atr,
                    rsi=ind1h.rsi,
                    trend=ind1h.trend,
                    signal_type=signal_type,
                )
                if abs(futures_data.funding_rate) > 0.002:
                    gate_rejections_total.labels(gate="futures").inc()
                    log.info("rejected_extreme_funding", symbol=coin.symbol, rate=futures_data.funding_rate)
                    return None
            except Exception as exc:
                log.warning("futures_intelligence_failed", symbol=coin.symbol, error=str(exc))

        # Step 11: AI validation
        draft = Signal(
            symbol=coin.symbol,
            name=coin.name,
            type=signal_type,
            timeframe="1h",
            scanner_mode=mode,
            entry_price=levels.entry_price,
            target_price=levels.target_price,
            stop_loss=levels.stop_loss,
            rr_ratio=levels.rr_ratio,
            confidence=0,
            indicators=ind1h,
            setup_description=f"{setup.description} | ADX: {structure.adx:.0f}",
            risk_score=risk.risk_score,
            quality_score=risk.quality_score,
            risk_grade=risk.risk_grade,
            risk_warnings=risk.warnings,
            max_safe_leverage=risk.max_safe_leverage,
            position_size_multiplier=risk.position_size_multiplier,
            futures_data=futures_data,
        )

        ai = await validate_signal(draft, coin, ind4h, s1h * 0.4 + s4h * 0.6, volatility)
        if not ai.validated or ai.confidence < config.min_confidence:
            gate_rejections_total.labels(gate="ai").inc()
            return None

        signals_generated_total.labels(mode=mode.value, signal_type=signal_type.value).inc()
        elapsed = time.perf_counter() - t0
        scanner_coin_duration_seconds.labels(mode=mode.value).observe(elapsed)

        return Signal(
            **draft.model_dump(exclude={"confidence", "ai_validated", "ai_reasoning",
                                        "ai_explainability", "risks", "strengths"}),
            confidence=ai.confidence,
            ai_validated=ai.validated,
            ai_reasoning=ai.reasoning,
            ai_explainability=ai.explainability,
            risks=ai.risks,
            strengths=ai.strengths,
        )

    except Exception as exc:
        log.error("scan_coin_error", symbol=coin.symbol, mode=mode.value, error=str(exc))
        return None

    finally:
        scanner_concurrency_active.dec()


async def _fetch_both_timeframes(
    coin: CoinData, is_futures: bool
) -> tuple[list[Candle], list[Candle]]:
    import asyncio
    return await asyncio.gather(
        fetch_klines(coin.binance_symbol, "1h", 100, is_futures),
        fetch_klines(coin.binance_symbol, "4h", 100, is_futures),
    )
