"""
AI signal validation using Claude Haiku.
Python port of lib/ai-validator.ts.
Falls back to heuristic scoring when the API key is absent or the call fails.
"""
from __future__ import annotations

import asyncio
import json
import time

import anthropic

from backend.config import get_settings
from backend.core.scanner.models import (
    TechnicalIndicators, VolatilityRating, Signal,
    CoinData, AIValidationResult, AIExplainability, SignalType,
)
from backend.logging.setup import get_logger
from backend.metrics.prometheus import (
    ai_validation_duration_seconds,
    ai_validation_total,
    ai_confidence_histogram,
)

log = get_logger(__name__)

_client: anthropic.Anthropic | None = None


def _get_client() -> anthropic.Anthropic | None:
    key = get_settings().anthropic_api_key
    if not key:
        return None
    global _client
    if _client is None:
        _client = anthropic.Anthropic(api_key=key)
    return _client


def _clamp(value: float, lo: float, hi: float) -> int:
    return int(max(lo, min(hi, value)))


# ── Claude validation ─────────────────────────────────────────────────────────

async def validate_signal(
    signal: Signal,
    coin: CoinData,
    ind4h: TechnicalIndicators,
    trend_strength: float,
    volatility: VolatilityRating,
) -> AIValidationResult:
    client = _get_client()
    if not client:
        result = _heuristic(signal, ind4h, trend_strength, volatility)
        _record(signal.id, "heuristic", 0, result.confidence, result.validated, used_fallback=True)
        return result

    prompt = _build_prompt(signal, coin, ind4h, trend_strength, volatility)
    t0 = time.perf_counter()

    try:
        msg = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=768,
            messages=[{"role": "user", "content": prompt}],
        )
        elapsed    = time.perf_counter() - t0
        latency_ms = int(elapsed * 1000)
        ai_validation_duration_seconds.observe(elapsed)

        text = msg.content[0].text.strip() if msg.content[0].type == "text" else ""
        parsed     = json.loads(text)
        confidence = _clamp(float(parsed.get("confidence") or 0), 0, 100)

        expl: AIExplainability | None = None
        if all(k in parsed for k in ("trend", "momentum", "volatility", "rationale", "summary")):
            expl = AIExplainability(
                trend=str(parsed["trend"]),
                momentum=str(parsed["momentum"]),
                volatility=str(parsed["volatility"]),
                rationale=str(parsed["rationale"]),
                summary=str(parsed["summary"]),
            )

        validated = parsed.get("validated") is True and confidence >= 80
        outcome   = "validated" if validated else "rejected"
        ai_validation_total.labels(outcome=outcome).inc()
        if validated:
            ai_confidence_histogram.observe(confidence)

        _record(
            signal.id, "claude-haiku-4-5-20251001", latency_ms, confidence, validated,
            prompt_tokens=msg.usage.input_tokens if msg.usage else None,
            completion_tokens=msg.usage.output_tokens if msg.usage else None,
        )

        return AIValidationResult(
            confidence=confidence,
            validated=validated,
            reasoning=str(parsed.get("reasoning", "")),
            risks=[str(r) for r in (parsed.get("risks") or [])],
            strengths=[str(s) for s in (parsed.get("strengths") or [])],
            explainability=expl,
        )

    except json.JSONDecodeError:
        log.warning("ai_json_parse_failed")
        ai_validation_total.labels(outcome="error").inc()
        result = _heuristic(signal, ind4h, trend_strength, volatility)
        _record(signal.id, "claude-haiku-4-5-20251001", int((time.perf_counter() - t0) * 1000),
                result.confidence, result.validated, error="json_parse_failed")
        return result
    except Exception as exc:
        log.warning("ai_api_failed", error=str(exc))
        ai_validation_total.labels(outcome="fallback").inc()
        result = _heuristic(signal, ind4h, trend_strength, volatility)
        _record(signal.id, "claude-haiku-4-5-20251001", int((time.perf_counter() - t0) * 1000),
                result.confidence, result.validated, used_fallback=True, error=str(exc))
        return result


def _build_prompt(
    signal: Signal,
    coin: CoinData,
    ind4h: TechnicalIndicators,
    trend_strength: float,
    volatility: VolatilityRating,
) -> str:
    i1h = signal.indicators
    fd  = signal.futures_data

    futures_section = ""
    if fd:
        bk = fd.breakout
        bk_line = (
            f"Breakout:       {bk.direction} +{bk.breakout_pct:.2f}%  |  Vol confirmed: {bk.volume_confirmed}"
            if bk else "Breakout:       none detected"
        )
        tc = fd.trend_continuation
        lz = fd.liquidation_zones
        lz_str = (
            " | ".join(f"${z.price:.2f} ({z.side}, {z.strength}, {z.distance_pct:.1f}%)" for z in lz[:3])
            if lz else "none within 10%"
        )
        futures_section = f"""
═══ FUTURES INTELLIGENCE ════════════════════
Funding rate:   {fd.funding_rate * 100:.4f}%  ({fd.funding_rate_annualized:.1f}% ann.)  |  Bias: {fd.funding_bias}
OI 24h change:  {'+' if fd.oi_change_24h >= 0 else ''}{fd.oi_change_24h:.2f}%  |  Trend: {fd.oi_trend}
L/S ratio:      {fd.long_short_ratio:.2f}  (Long {fd.long_account_percent:.1f}% / Short {fd.short_account_percent:.1f}%)
Momentum score: {fd.momentum_score}/100
{bk_line}
Pullback:       {'Yes — depth ' + str(tc.pullback_depth) + '× ATR  |  Holding key level: ' + str(tc.holding_key_level) + '  |  Cont. confidence: ' + str(tc.continuation_confidence) + '%' if tc.is_pullback else 'No pullback pattern'}
Liq. zones:     {lz_str}
"""

    return f"""You are a professional crypto trader and technical analyst. Evaluate this trade setup.

═══ ASSET ═════════════════════
Symbol: {signal.symbol} ({signal.name})
Direction: {signal.type}  |  Mode: {signal.scanner_mode}
Rank: #{coin.rank}  |  Vol 24h: ${coin.volume_24h / 1e6:.0f}M  |  MCap: ${coin.market_cap / 1e9:.1f}B

═══ 1H INDICATORS (entry timeframe) ═══
Price:      ${i1h.current_price}
Trend:      {i1h.trend}
RSI(14):    {i1h.rsi:.1f}
MACD hist:  {i1h.macd.histogram:.6f} ({'positive ▲' if i1h.macd.histogram > 0 else 'negative ▼'})
EMA20:      ${i1h.ema20:.4f}  |  EMA50: ${i1h.ema50:.4f}
ATR(14):    ${i1h.atr:.4f}
Vol spike:  {i1h.volume_spike:.2f}×

═══ 4H INDICATORS (trend filter) ════
Trend:      {ind4h.trend}
RSI(14):    {ind4h.rsi:.1f}
MACD hist:  {ind4h.macd.histogram:.6f} ({'positive ▲' if ind4h.macd.histogram > 0 else 'negative ▼'})
EMA20:      ${ind4h.ema20:.4f}  |  EMA50: ${ind4h.ema50:.4f}
{futures_section}
═══ TRADE LEVELS ════════════════════
Entry:   ${signal.entry_price}
Target:  ${signal.target_price}
Stop:    ${signal.stop_loss}
R:R:     1:{signal.rr_ratio:.2f}

═══ QUALITY METRICS ════════════════
Trend strength score: {trend_strength:.0f}/100
Volatility:           {volatility}
Setup:                {signal.setup_description}

═══ REJECTION CRITERIA ═══════════
Reject (confidence < 80) if ANY of these apply:
• 1h and 4h signals not aligned
• RSI overbought > 75 for BUY, or oversold < 25 for SELL
• Volume spike < 1.2× average
• R:R < 2.0
• EXTREME volatility (stop placement unreliable)
• Trend strength < 35 (choppy/weak market)
• MACD histogram direction conflicts with trade direction
• Futures only: funding rate bias strongly against trade direction
• Futures only: momentum score < 35

Respond ONLY with valid JSON (no markdown):
{{"confidence":<integer 0-100>,"validated":<boolean>,"reasoning":"<1-sentence verdict>","risks":["<risk>"],"strengths":["<strength>"],"trend":"<1-2 sentences on MTF trend>","momentum":"<1-2 sentences on RSI/MACD/volume>","volatility":"<1 sentence on ATR regime>","rationale":"<1 sentence on why this confidence level>","summary":"<one concise trade thesis>"}}"""


# ── Analytics fire-and-forget helper ─────────────────────────────────────────

def _record(
    signal_id: str | None,
    model: str,
    latency_ms: int,
    confidence: int,
    validated: bool,
    *,
    prompt_tokens: int | None = None,
    completion_tokens: int | None = None,
    used_fallback: bool = False,
    error: str | None = None,
) -> None:
    """Non-blocking DB write — best effort, never raises."""
    try:
        from backend.analytics.ai_metrics import record_ai_call
        loop = asyncio.get_event_loop()
        if loop.is_running():
            asyncio.create_task(record_ai_call(
                signal_id=signal_id,
                model=model,
                latency_ms=latency_ms,
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                validated=validated,
                confidence=confidence,
                used_fallback=used_fallback,
                error=error,
            ))
    except Exception:
        pass


# ── Heuristic fallback ────────────────────────────────────────────────────────

def _heuristic(
    signal: Signal,
    ind4h: TechnicalIndicators,
    trend_strength: float,
    volatility: VolatilityRating,
) -> AIValidationResult:
    i1h  = signal.indicators
    stype = signal.type
    rr   = signal.rr_ratio
    score = 45
    strengths: list[str] = []
    risks: list[str] = []

    # MTF alignment (±25)
    tf_aligned = (
        (stype == SignalType.BUY  and i1h.trend.value == "BULLISH" and ind4h.trend.value == "BULLISH")
        or (stype == SignalType.SELL and i1h.trend.value == "BEARISH" and ind4h.trend.value == "BEARISH")
    )
    if tf_aligned:
        score += 25
        strengths.append(f"1h + 4h both {'bullish' if stype == SignalType.BUY else 'bearish'} — MTF aligned")
    else:
        score -= 15
        risks.append("Timeframe conflict: 1h and 4h trends not aligned")

    # RSI zone (±15)
    if stype == SignalType.BUY:
        if 48 <= i1h.rsi <= 70:
            score += 15; strengths.append(f"RSI {i1h.rsi:.1f} in bullish momentum zone (48-70)")
        elif i1h.rsi > 75:
            score -= 20; risks.append(f"RSI overbought at {i1h.rsi:.1f}")
        else:
            score -= 5;  risks.append(f"RSI {i1h.rsi:.1f} outside optimal zone")
    else:
        if 30 <= i1h.rsi <= 52:
            score += 15; strengths.append(f"RSI {i1h.rsi:.1f} in bearish momentum zone (30-52)")
        elif i1h.rsi < 25:
            score -= 20; risks.append(f"RSI oversold at {i1h.rsi:.1f}")
        else:
            score -= 5;  risks.append(f"RSI {i1h.rsi:.1f} outside optimal zone")

    # MACD (±10)
    macd_aligned = (
        (stype == SignalType.BUY  and i1h.macd.histogram > 0)
        or (stype == SignalType.SELL and i1h.macd.histogram < 0)
    )
    if macd_aligned:
        score += 10; strengths.append("MACD histogram confirms entry direction")
    else:
        score -= 10; risks.append("MACD histogram diverges from trade direction")

    # Volume (±15)
    if i1h.volume_spike >= 2.0:
        score += 15; strengths.append(f"Strong volume spike: {i1h.volume_spike:.1f}×")
    elif i1h.volume_spike >= 1.4:
        score += 8;  strengths.append(f"Above-average volume: {i1h.volume_spike:.1f}×")
    elif i1h.volume_spike < 1.0:
        score -= 15; risks.append(f"Below-average volume ({i1h.volume_spike:.2f}×)")

    # Trend strength (±10)
    if trend_strength >= 60:
        score += 10; strengths.append(f"High trend strength: {trend_strength:.0f}/100")
    elif trend_strength >= 40:
        score += 5
    else:
        score -= 10; risks.append(f"Weak trend strength: {trend_strength:.0f}/100")

    # R:R (±10)
    if rr >= 2.5:
        score += 10; strengths.append(f"Excellent R:R 1:{rr:.1f}")
    elif rr >= 2.0:
        score += 5;  strengths.append(f"Solid R:R 1:{rr:.1f}")
    else:
        score -= 15; risks.append(f"R:R below minimum: 1:{rr:.2f}")

    # Volatility
    if volatility == VolatilityRating.EXTREME:
        score -= 40; risks.append("EXTREME volatility — stops unreliable")
    elif volatility == VolatilityRating.HIGH:
        score -= 15; risks.append("HIGH volatility — wider stops required")
    elif volatility == VolatilityRating.LOW:
        score -= 5;  risks.append("LOW volatility — limited momentum")

    score = _clamp(score, 10, 95)
    dir_str = "bullish" if stype == SignalType.BUY else "bearish"

    expl = AIExplainability(
        trend=(
            f"Both 1h and 4h are {dir_str}, trend strength {trend_strength:.0f}/100."
            if tf_aligned
            else f"Timeframe conflict: 1h is {i1h.trend.value.lower()} but 4h is {ind4h.trend.value.lower()}."
        ),
        momentum=(
            f"RSI {i1h.rsi:.1f}, MACD {'confirming' if macd_aligned else 'conflicting'}, "
            f"volume {i1h.volume_spike:.1f}× average."
        ),
        volatility={
            VolatilityRating.EXTREME: "EXTREME volatility — stop placement unreliable.",
            VolatilityRating.HIGH:    "HIGH volatility — wider stops required.",
            VolatilityRating.LOW:     "LOW volatility — limited breakout potential.",
            VolatilityRating.NORMAL:  "Normal volatility with reliable ATR stops.",
        }[volatility],
        rationale=f"Score {score}/100: {len(strengths)} strength(s), {len(risks)} risk(s). R:R 1:{rr:.1f}.",
        summary=f"{'MTF aligned' if tf_aligned else 'Single-TF'} {dir_str} — R:R 1:{rr:.1f}, trend {trend_strength:.0f}/100.",
    )

    ai_validation_total.labels(outcome="fallback").inc()
    return AIValidationResult(
        confidence=score,
        validated=score >= 80,
        reasoning=f"Heuristic: {len(strengths)} strength(s), {len(risks)} concern(s). Score {score}/100.",
        risks=risks,
        strengths=strengths,
        explainability=expl,
    )
