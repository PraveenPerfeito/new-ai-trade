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
        min_market_cap=200_000_000,   # lowered from 500M — CMC gives 200 coins so rank 100-200 now included
        min_volume_24h=20_000_000,    # lowered from 50M
        min_rr_ratio=2.0,
        min_confidence=80,
        max_coins_to_scan=80,         # up from 50
        scanner_mode=ScannerMode.SPOT,
    ),
    ScannerMode.FUTURES: ScannerConfig(
        min_market_cap=1_000_000_000,
        min_volume_24h=200_000_000,
        min_rr_ratio=2.0,
        min_confidence=82,
        max_coins_to_scan=50,         # up from 40
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
        min_market_cap=50_000_000,    # lowered from 100M — catches emerging coins
        min_volume_24h=10_000_000,    # lowered from 20M
        min_rr_ratio=2.0,
        min_confidence=78,
        max_coins_to_scan=80,         # up from 60
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
    ind1d: TechnicalIndicators | None = None,
    coin_change_24h: float = 0.0,
    btc_change_24h: float = 0.0,
    candle_count_1h: int = 0,
    candle_count_4h: int = 0,          # Phase 7.4A.3 — 4h EMA200 convergence guard
    candles_1h: "list[Candle]" = [],   # Phase 7.4A.1 — breakout detection
    candles_1d: "list[Candle]" = [],   # Phase 7.4A.1 — breakout detection
) -> SetupResult:
    """
    Pre-AI setup quality score. Threshold 60 (was 65 — lowered to catch more signals).
    Incorporates EMA200 bounce, Bollinger Band squeeze, daily trend, and candlestick patterns.
    Phase 7.4A.1: breakout intelligence — 20/30-day high/low + BB expansion.
    Phase 7.4A.3: 4h EMA200 convergence guard — bounce +8 pts (≥280c), direction +3 pts (≥250c).
    """
    score = 0
    reasons: list[str] = []

    # ── Core trend alignment ──────────────────────────────────────────────────
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

    # ── EMA200 convergence protection (Phase 7.3A.7) ─────────────────────────
    # EMA200 initialised from seed price has significant contamination at < 280
    # candles. See ema_convergence.py for the exact math.
    #
    # direction_reliable (≥ 250): "price above/below EMA200" bias (+5 pts)
    # bounce_reliable    (≥ 280): "price within ±2% of EMA200" (+15 pts)
    #
    # Conservative default: candle_count_1h == 0 means count not provided → DISABLED
    # (the old code had == 0 → ENABLED, which was a bug).
    from backend.core.scanner.ema_convergence import direction_reliable, bounce_reliable  # noqa: PLC0415

    if ind1h.ema200 > 0:
        price    = ind1h.current_price
        dist_pct = abs(price - ind1h.ema200) / ind1h.ema200 * 100

        # Bounce / rejection detection (±2% proximity) — requires ≥ 280 candles
        if bounce_reliable(candle_count_1h) and dist_pct <= 2.0:
            if signal_type == SignalType.BUY and price >= ind1h.ema200:
                score += 15
                reasons.append(f"Price bouncing off EMA200 ({dist_pct:.2f}% above)")
            elif signal_type == SignalType.SELL and price <= ind1h.ema200:
                score += 15
                reasons.append(f"Price rejected at EMA200 ({dist_pct:.2f}% below)")

        # Direction bias — price above/below EMA200 (+5 pts), requires ≥ 250 candles
        elif direction_reliable(candle_count_1h):
            if signal_type == SignalType.BUY and price > ind1h.ema200:
                score += 5
                reasons.append("Price above EMA200 — long-term bullish")
            elif signal_type == SignalType.SELL and price < ind1h.ema200:
                score += 5
                reasons.append("Price below EMA200 — long-term bearish")

    # ── 4h EMA200 convergence protection (Phase 7.4A.3) ──────────────────────
    # Same convergence guards as 1h (Phase 7.3A.7) applied to the higher timeframe.
    # 4h EMA200 is a major institutional reference level (covers ~50 days).
    # Scores are smaller than 1h (secondary confirmation, not primary gate).
    if ind4h.ema200 > 0:
        price4h   = ind4h.current_price
        dist4h    = abs(price4h - ind4h.ema200) / ind4h.ema200 * 100

        # 4h EMA200 bounce (+8) — requires ≥ 280 candles
        if bounce_reliable(candle_count_4h) and dist4h <= 2.0:
            if signal_type == SignalType.BUY and price4h >= ind4h.ema200:
                score += 8
                reasons.append(f"4h price bouncing off EMA200 ({dist4h:.2f}% above)")
            elif signal_type == SignalType.SELL and price4h <= ind4h.ema200:
                score += 8
                reasons.append(f"4h price rejected at EMA200 ({dist4h:.2f}% below)")

        # 4h EMA200 direction bias (+3) — requires ≥ 250 candles
        elif direction_reliable(candle_count_4h):
            if signal_type == SignalType.BUY and price4h > ind4h.ema200:
                score += 3
                reasons.append("4h price above EMA200 — higher-TF bullish bias")
            elif signal_type == SignalType.SELL and price4h < ind4h.ema200:
                score += 3
                reasons.append("4h price below EMA200 — higher-TF bearish bias")

    # ── Bollinger Band squeeze (+15) ──────────────────────────────────────────
    # BB squeeze = compression before explosion — strong breakout signal
    if ind1h.bb is not None and ind1h.bb.squeeze:
        score += 15
        reasons.append(f"BB squeeze detected (width {ind1h.bb.width:.3f}) — breakout imminent")
    elif ind4h.bb is not None and ind4h.bb.squeeze:
        score += 10
        reasons.append("4h BB squeeze — higher-timeframe compression")

    # ── Daily trend alignment (+12) ───────────────────────────────────────────
    if ind1d is not None:
        if signal_type == SignalType.BUY and ind1d.trend == TrendDirection.BULLISH:
            score += 12
            reasons.append("Daily trend bullish — all 3 timeframes aligned")
        elif signal_type == SignalType.SELL and ind1d.trend == TrendDirection.BEARISH:
            score += 12
            reasons.append("Daily trend bearish — all 3 timeframes aligned")
        elif ind1d.trend == TrendDirection.RANGING:
            score -= 5  # daily ranging = weak macro context

    # ── Candlestick pattern bonus (+8 to +15) ─────────────────────────────────
    BUY_PATTERNS  = {"HAMMER", "INVERTED_HAMMER", "MORNING_STAR",
                     "THREE_WHITE_SOLDIERS", "BULLISH_MARUBOZU"}
    SELL_PATTERNS = {"SHOOTING_STAR", "HANGING_MAN", "EVENING_STAR",
                     "THREE_BLACK_CROWS", "BEARISH_MARUBOZU"}

    pat = ind1h.candle_pattern
    if pat:
        if signal_type == SignalType.BUY and pat in BUY_PATTERNS:
            pts = 15 if pat in {"MORNING_STAR", "THREE_WHITE_SOLDIERS"} else 8
            score += pts
            reasons.append(f"Bullish candle pattern: {pat.replace('_', ' ').title()}")
        elif signal_type == SignalType.SELL and pat in SELL_PATTERNS:
            pts = 15 if pat in {"EVENING_STAR", "THREE_BLACK_CROWS"} else 8
            score += pts
            reasons.append(f"Bearish candle pattern: {pat.replace('_', ' ').title()}")
        elif signal_type == SignalType.BUY and pat in SELL_PATTERNS:
            score -= 10  # conflicting pattern
        elif signal_type == SignalType.SELL and pat in BUY_PATTERNS:
            score -= 10

    # ── EMA crossover freshness (+12) ─────────────────────────────────────────
    # Fresh EMA20/50 cross (within last 5 candles) = new momentum, not extended
    cross_1h = ind1h.ema_cross
    cross_4h = ind4h.ema_cross
    if signal_type == SignalType.BUY:
        if cross_4h == "GOLDEN_CROSS":
            score += 12
            reasons.append("Fresh 4h golden cross — EMA20 just crossed above EMA50")
        elif cross_1h == "GOLDEN_CROSS":
            score += 8
            reasons.append("Fresh 1h golden cross — new bullish momentum")
        elif cross_4h == "DEATH_CROSS" or cross_1h == "DEATH_CROSS":
            score -= 8  # buying into a fresh death cross = counter-trend
    else:
        if cross_4h == "DEATH_CROSS":
            score += 12
            reasons.append("Fresh 4h death cross — EMA20 just crossed below EMA50")
        elif cross_1h == "DEATH_CROSS":
            score += 8
            reasons.append("Fresh 1h death cross — new bearish momentum")
        elif cross_4h == "GOLDEN_CROSS" or cross_1h == "GOLDEN_CROSS":
            score -= 8  # shorting into a fresh golden cross = counter-trend

    # ── Relative strength vs BTC (+10) ────────────────────────────────────────
    # Coin outperforming BTC in the last 24h = market leadership = stronger signal
    if coin_change_24h != 0.0:
        rel_strength = coin_change_24h - btc_change_24h
        if signal_type == SignalType.BUY and rel_strength >= 3.0:
            score += 10
            reasons.append(
                f"Leading BTC by {rel_strength:.1f}% (coin +{coin_change_24h:.1f}% vs BTC "
                f"{'+' if btc_change_24h >= 0 else ''}{btc_change_24h:.1f}%)"
            )
        elif signal_type == SignalType.BUY and rel_strength <= -5.0:
            score -= 8   # significant underperformance on a buy signal = weak
            reasons.append(f"Lagging BTC by {abs(rel_strength):.1f}% — weak relative strength")
        elif signal_type == SignalType.SELL and rel_strength <= -3.0:
            score += 10
            reasons.append(
                f"Underperforming BTC by {abs(rel_strength):.1f}% — relative weakness on SELL"
            )

    # ── Breakout intelligence (Phase 7.4A.1 / 7.4A.6.1) ─────────────────────
    # Detects 20/30-day high/low structural breakouts + BB expansion after squeeze.
    # Phase 7.4A.6.1: breakout_type captured on SetupResult so scan_coin can
    # attach it to the Signal for persistence in signals and signal_outcomes.
    _breakout_type:     str | None = None
    _breakout_strength: str | None = None
    if candles_1h or candles_1d:
        from backend.core.scanner.breakout_intelligence import (  # noqa: PLC0415
            detect_breakout_strength,
        )
        from backend.metrics.prometheus import breakout_detections_total  # noqa: PLC0415

        br = detect_breakout_strength(candles_1d, candles_1h, signal_type)
        if br.detected:
            score += br.score_bonus
            reasons.append(br.details)
            _breakout_type     = br.breakout_type
            _breakout_strength = br.strength.value   # Phase 7.4A.6.3
            breakout_detections_total.labels(
                breakout_type=br.breakout_type,
                strength=br.strength.value,
            ).inc()
            log.info(
                "breakout_detected",
                symbol=getattr(ind1h, "symbol", "?"),
                strength=br.strength.value,
                breakout_type=br.breakout_type,
                volume_ratio=br.volume_ratio,
                score_bonus=br.score_bonus,
            )

    return SetupResult(
        has_setup=score >= 60,
        description=". ".join(reasons),
        pre_score=score,
        breakout_type=_breakout_type,
        breakout_strength=_breakout_strength,   # Phase 7.4A.6.3
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
    btc_change_24h: float = 0.0,
    trend_score:   float | None = None,  # Phase 7.4A.7.1 — from TrendingMeta (TRENDING mode)
    sector_status: str   | None = None,  # Phase 7.4A.7.2 — from SectorIntelligenceReport (TRENDING mode)
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
        candles_1h, candles_4h, candles_1d = await _fetch_all_timeframes(coin, is_futures)

        if len(candles_1h) < 60 or len(candles_4h) < 60:
            return None

        # Step 2: Indicators (1h, 4h, daily)
        ind1h = calculate_all_indicators(candles_1h)
        ind4h = calculate_all_indicators(candles_4h)
        ind1d = calculate_all_indicators(candles_1d) if len(candles_1d) >= 30 else None

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

        # Step 7: Setup scoring (daily, EMA200, BB, candle patterns, EMA cross, rel strength)
        setup = detect_setup(
            ind1h, ind4h, signal_type, s1h, s4h, ind1d,
            coin_change_24h=coin.price_change_24h,
            btc_change_24h=btc_change_24h,
            candle_count_1h=len(candles_1h),
            candle_count_4h=len(candles_4h),   # Phase 7.4A.3 — 4h EMA200 guard
            candles_1h=candles_1h,
            candles_1d=candles_1d,
        )
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
        futures_data     = None
        funding_score_adj = 0   # Phase 7.3A.6: setup_score adjustment from funding context
        if mode in (ScannerMode.FUTURES, ScannerMode.HIGH_CONFIDENCE):
            try:
                from backend.core.scanner.futures_funding import classify_funding  # noqa: PLC0415
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
                fa = classify_funding(
                    funding_rate  = futures_data.funding_rate,
                    is_buy        = signal_type == SignalType.BUY,
                    funding_trend = futures_data.funding_trend.value,  # Phase 7.4A.4
                )
                if fa.should_reject:
                    gate_rejections_total.labels(gate="futures").inc()
                    log.info("rejected_extreme_funding",
                             symbol=coin.symbol,
                             rate=futures_data.funding_rate,
                             adverse=fa.adverse_rate,
                             context=fa.context.value)
                    return None
                # ELEVATED → penalty | FAVORABLE → bonus applied to effective setup score
                funding_score_adj = fa.setup_score_adj
                if fa.setup_score_adj != 0:
                    log.info("funding_context_adjustment",
                             symbol=coin.symbol,
                             context=fa.context.value,
                             adj=fa.setup_score_adj,
                             note=fa.log_message)
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
            breakout_type=setup.breakout_type,       # Phase 7.4A.6.1
            breakout_strength=setup.breakout_strength, # Phase 7.4A.6.3
            trend_score=trend_score,                   # Phase 7.4A.7.1
            sector_status=sector_status,               # Phase 7.4A.7.2
            # Phase 7.4A.6.3 — promote FuturesData intelligence to top-level Signal fields
            oi_interpretation=(futures_data.oi_interpretation.value if futures_data else None),
            funding_trend=(futures_data.funding_trend.value if futures_data else None),
            positioning_context=(futures_data.positioning_context.value if futures_data else None),
            position_size_multiplier=risk.position_size_multiplier,
            futures_data=futures_data,
        )

        effective_score = setup.pre_score + funding_score_adj   # Phase 7.3A.6 funding adjustment
        ai = await validate_signal(draft, coin, ind4h, s1h * 0.4 + s4h * 0.6, volatility, setup_score=effective_score)
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


async def _fetch_all_timeframes(
    coin: CoinData, is_futures: bool
) -> tuple[list[Candle], list[Candle], list[Candle]]:
    """
    Fetch 1h, 4h, and 1d candles concurrently.

    300 candles on 1h/4h (Phase 7.3A.7):
      EMA200 seed influence at 200c = 13.8% — unreliable for bounce detection.
      EMA200 seed influence at 300c = 4.9%  — acceptable for direction and bounce.
      See ema_convergence.py for the full mathematical derivation.

    100 daily candles covers ~3 months of daily trend context.
    """
    import asyncio
    return await asyncio.gather(
        fetch_klines(coin.binance_symbol, "1h",  300, is_futures),
        fetch_klines(coin.binance_symbol, "4h",  300, is_futures),
        fetch_klines(coin.binance_symbol, "1d",  100, is_futures),
    )
