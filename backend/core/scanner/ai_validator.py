"""
AI signal validation using Claude Haiku.
Python port of lib/ai-validator.ts.
Falls back to heuristic scoring when the API key is absent or the call fails.
"""
from __future__ import annotations

import asyncio
import collections
import datetime as _dt
import json
import math as _math
import re
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

# Limit concurrent Claude calls to 3 — prevents burst-rate-limit errors when
# multiple coins pass all gates simultaneously and hit AI validation at once.
_ai_semaphore: asyncio.Semaphore | None = None

# Per-minute ceiling — Haiku tier allows up to 50 RPM but a full 80-coin scan
# could burst up to ~40 calls in seconds; 12 RPM leaves headroom and avoids 429s.
_REQUESTS_PER_MINUTE = 12
# On a 429, retry with exponential back-off before falling back to heuristic.
_MAX_429_RETRIES  = 2        # up to 3 total attempts (attempt 0, 1, 2)
_429_BASE_DELAY_S = 5.0      # delays: 5s, 10s

# ── Enhancement 3 note: Rate limiter persistence ──────────────────────────────
# The _SlidingWindowRateLimiter is in-process only — it resets on worker
# restart. A Redis-backed counter would survive restarts but adds a Redis
# round-trip on every Claude call (adds ~2ms latency each time).
# Decision: keep in-process. The Semaphore(3) caps burst regardless of
# limiter state, and worker restarts are rare. Revisit if multiple concurrent
# Railway services are ever deployed.

# ── Enhancement 1: Daily call counter — Redis-backed so it survives worker restarts ──
# Key: ai:daily_calls:{YYYY-MM-DD}  TTL: 25h (survives midnight by 1h)

async def _check_and_increment_daily_redis(limit: int) -> bool:
    """
    Returns True (exceeded) if daily limit is set and reached.
    Uses Redis so the counter survives Celery worker restarts.
    Falls back to allow (False) if Redis is unavailable.
    """
    if limit <= 0:
        return False  # no limit configured
    try:
        from backend.cache.redis_cache import get_redis
        redis = await get_redis()
        today = _dt.date.today().isoformat()
        key   = f"ai:daily_calls:{today}"
        count = await redis.incr(key)
        if count == 1:
            await redis.expire(key, 25 * 3600)  # expires next day + 1h buffer
        if count > limit:
            log.warning("ai_daily_call_limit_exceeded", calls=count, limit=limit, key=key)
            return True
        return False
    except Exception as exc:
        log.warning("ai_daily_counter_redis_failed", error=str(exc))
        return False  # fail open — send if Redis unavailable

# ── Enhancement 2: Degradation alerting (rolling 15-min window) ──────────────
_DEGRADATION_WINDOW_S   = 15 * 60   # 15-minute window
_DEGRADATION_THRESHOLD  = 0.5       # 50% fallback rate
_degradation_window: collections.deque = collections.deque()  # timestamps of fallback events
_all_calls_window:   collections.deque = collections.deque()   # timestamps of all calls
_degradation_alerted_at: float = 0.0

def _record_call_outcome(is_fallback: bool) -> None:
    """Track call outcomes and emit degradation warning when threshold exceeded."""
    global _degradation_alerted_at
    now = time.monotonic()
    cutoff = now - _DEGRADATION_WINDOW_S
    _all_calls_window.append(now)
    if is_fallback:
        _degradation_window.append(now)
    # Evict old entries
    while _all_calls_window and _all_calls_window[0] < cutoff:
        _all_calls_window.popleft()
    while _degradation_window and _degradation_window[0] < cutoff:
        _degradation_window.popleft()
    # Check degradation
    total_recent    = len(_all_calls_window)
    fallback_recent = len(_degradation_window)
    if total_recent >= 5 and fallback_recent / total_recent >= _DEGRADATION_THRESHOLD:
        # Only fire once per 15-min window to avoid spam
        if now - _degradation_alerted_at > _DEGRADATION_WINDOW_S:
            _degradation_alerted_at = now
            log.warning(
                "ai_validation_degraded",
                fallback_rate=round(fallback_recent / total_recent, 2),
                fallbacks=fallback_recent,
                total=total_recent,
                window_minutes=15,
                note="Claude fallback rate >50% — check Anthropic API key and quota",
            )
            # P1.4: Schedule Telegram alert (fire-and-forget — called from async scan context)
            try:
                loop = asyncio.get_running_loop()
                loop.create_task(_send_degradation_alert(fallback_recent, total_recent))
            except RuntimeError:
                pass  # not in an async context (e.g. tests) — skip Telegram


async def _send_degradation_alert(fallbacks: int, total: int) -> None:
    """Send one Telegram ops alert when Claude API is degraded. Throttled at call site."""
    # Skip if AI is intentionally disabled — this is not a degradation scenario
    try:
        from backend.system_settings.service import get_settings_service
        from backend.system_settings.groups import AISettings
        ai_cfg = await get_settings_service().get_group(AISettings)
        if not ai_cfg.enabled:
            return
    except Exception:
        pass  # can't check — proceed with alert

    try:
        from backend.core.scanner.telegram_notifier import _is_configured, _enqueue
        if not _is_configured():
            return
        rate_pct = round(fallbacks / total * 100)
        text = (
            f"⚠️ <b>Claude AI Degraded</b>\n\n"
            f"Fallback rate: <b>{rate_pct}%</b> "
            f"({fallbacks}/{total} calls in last 15 min)\n"
            f"→ Heuristic scoring active\n\n"
            f"<i>Check ANTHROPIC_API_KEY and daily quota in Admin → Calibration.</i>"
        )
        _enqueue(text)
        log.info("degradation_alert_sent", fallback_pct=rate_pct)
    except Exception as exc:
        log.warning("degradation_alert_failed", error=str(exc))


class _SlidingWindowRateLimiter:
    """Sliding-window per-minute rate limiter. acquire() blocks until a slot is free."""

    def __init__(self, limit: int) -> None:
        self._limit      = limit
        self._timestamps: list[float] = []
        self._lock       = asyncio.Lock()

    async def acquire(self) -> None:
        while True:
            async with self._lock:
                now = time.monotonic()
                self._timestamps = [t for t in self._timestamps if now - t < 60.0]
                if len(self._timestamps) < self._limit:
                    self._timestamps.append(now)
                    return
                # Wait until the oldest slot exits the 60-second window
                wait_s = 60.0 - (now - self._timestamps[0]) + 0.1
            await asyncio.sleep(wait_s)


_rate_limiter: _SlidingWindowRateLimiter | None = None
_rate_limiter_loop: "asyncio.AbstractEventLoop | None" = None
_ai_semaphore_loop: "asyncio.AbstractEventLoop | None" = None


def _get_rate_limiter() -> _SlidingWindowRateLimiter:
    """
    Per-event-loop rate limiter (TELEGRAM.RELIABILITY.1 WS4).
    Celery runs each task in a fresh asyncio.run() loop; an asyncio.Lock
    created in a previous task's loop raises 'bound to a different event loop'
    when contended.  Recreate when the running loop changes (same pattern as
    the asyncpg pool fix).  The 60s sliding window resets with it — acceptable,
    since the Semaphore still caps in-flight calls and tasks are minutes apart.
    """
    global _rate_limiter, _rate_limiter_loop
    loop = asyncio.get_running_loop()
    if _rate_limiter is None or _rate_limiter_loop is not loop:
        _rate_limiter = _SlidingWindowRateLimiter(_REQUESTS_PER_MINUTE)
        _rate_limiter_loop = loop
    return _rate_limiter


def _get_semaphore() -> asyncio.Semaphore:
    """
    Per-event-loop semaphore (TELEGRAM.RELIABILITY.1 WS4).
    The module-level Semaphore survived across Celery tasks but stayed bound
    to the first task's (closed) loop — audited: 3 Claude calls in 7d died
    with 'Semaphore is bound to a different event loop' and fell back to
    heuristic.  Recreate when the running loop changes.
    """
    global _ai_semaphore, _ai_semaphore_loop
    loop = asyncio.get_running_loop()
    if _ai_semaphore is None or _ai_semaphore_loop is not loop:
        _ai_semaphore = asyncio.Semaphore(3)
        _ai_semaphore_loop = loop
    return _ai_semaphore


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


# ── Enhancement 4: JSON extraction hardening ──────────────────────────────────

def _extract_json_block(text: str) -> str:
    """Safely extract the first JSON object from Claude's response.
    Uses str.find/rfind instead of greedy regex to avoid over-matching."""
    text = text.strip()
    if text.startswith("{"):
        return text               # most common case — direct JSON
    start = text.find("{")
    end   = text.rfind("}")
    if start != -1 and end > start:
        return text[start:end + 1]
    return text                   # return as-is; json.loads raises JSONDecodeError


def _repair_json(text: str) -> "dict | None":
    """
    CLAUDE.OPTIMIZATION.1 — second-chance repair for almost-valid responses.
    Audited failure mode: 6 json_parse_failed/week, primarily truncation (avg
    completion ≈625 tokens vs a hard cap).  Repairs, in order:
      1. strip markdown code fences
      2. remove trailing commas before } / ]
      3. balance unclosed strings/braces/brackets (truncation recovery)
    Returns the parsed dict or None when unrecoverable.
    """
    t = text.strip()
    if t.startswith("```"):
        t = re.sub(r"^```(?:json)?\s*", "", t)
        t = re.sub(r"\s*```$", "", t)
    t = _extract_json_block(t)
    t = re.sub(r",\s*([}\]])", r"\1", t)

    # Truncation recovery: close an unterminated string, then balance brackets.
    depth_obj = depth_arr = 0
    in_str = esc = False
    for ch in t:
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "{":
            depth_obj += 1
        elif ch == "}":
            depth_obj -= 1
        elif ch == "[":
            depth_arr += 1
        elif ch == "]":
            depth_arr -= 1
    if in_str:
        t += '"'
    t = t.rstrip().rstrip(",")
    t += "]" * max(0, depth_arr) + "}" * max(0, depth_obj)

    try:
        parsed = json.loads(t)
        return parsed if isinstance(parsed, dict) else None
    except json.JSONDecodeError:
        return None


def _parse_claude_json(raw_text: str) -> dict:
    """Parse Claude's response; try direct extraction, then repair. Raises JSONDecodeError."""
    text = _extract_json_block(raw_text)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        repaired = _repair_json(raw_text)
        if repaired is not None:
            log.info("ai_json_repaired")
            return repaired
        raise


# ── Enhancement 5: Indicator sanitization ────────────────────────────────────

def _sf(value: float, decimals: int = 4) -> str:
    """Safe float formatter — replaces NaN/Inf with '?' to prevent malformed prompts."""
    try:
        if not _math.isfinite(value):
            return "?"
        return f"{value:.{decimals}f}"
    except (TypeError, ValueError):
        return "?"


# ── Claude validation ─────────────────────────────────────────────────────────

AI_MIN_SETUP_SCORE = 78  # only call Claude for setup scores ≥ this; lower = heuristic
                          # 78 = strong setups only; cuts ~50% of calls vs 72; saves ~$0.03/day


async def validate_signal(
    signal: Signal,
    coin: CoinData,
    ind4h: TechnicalIndicators,
    trend_strength: float,
    volatility: VolatilityRating,
    setup_score: int = 100,
) -> AIValidationResult:
    # Skip Claude for borderline setups — conserves API credits for high-quality signals
    if setup_score < AI_MIN_SETUP_SCORE:
        log.info("ai_validation_skipped_low_score", symbol=signal.symbol, setup_score=setup_score, threshold=AI_MIN_SETUP_SCORE)
        result = _heuristic(signal, ind4h, trend_strength, volatility)
        _record(signal.id, "heuristic", 0, result.confidence, result.validated, used_fallback=True,
                symbol=signal.symbol, setup_score=setup_score)
        return result

    # Check admin toggle and daily call limit
    ai_cfg_daily_limit = 0
    ai_max_tokens = 768
    try:
        from backend.system_settings.service import get_settings_service
        from backend.system_settings.groups import AISettings
        ai_cfg = await get_settings_service().get_group(AISettings)
        if not ai_cfg.enabled:
            log.info("ai_validation_disabled_by_settings", symbol=signal.symbol)
            result = _heuristic(signal, ind4h, trend_strength, volatility)
            _record(signal.id, "heuristic", 0, result.confidence, result.validated, used_fallback=True,
                    symbol=signal.symbol, setup_score=setup_score)
            # Do NOT record as degradation — AI is intentionally off, not failing
            return result
        ai_cfg_daily_limit = getattr(ai_cfg, "daily_call_limit", 0)
        # CLAUDE.OPTIMIZATION.1: wire ai.max_tokens (was hardcoded 768) with a
        # 768 floor — avg completion is ~625 tokens, so lower budgets truncate
        # the JSON mid-object (the audited json_parse_failed cause).
        ai_max_tokens = max(768, int(getattr(ai_cfg, "max_tokens", 768) or 768))
    except Exception as exc:
        log.warning("ai_settings_check_failed", error=str(exc))

    # Enhancement 1: daily call limit guard (Redis-backed — survives worker restarts)
    if await _check_and_increment_daily_redis(ai_cfg_daily_limit):
        result = _heuristic(signal, ind4h, trend_strength, volatility)
        _record(signal.id, "heuristic", 0, result.confidence, result.validated, used_fallback=True,
                symbol=signal.symbol, setup_score=setup_score)
        _record_call_outcome(is_fallback=True)
        return result

    client = _get_client()
    if not client:
        result = _heuristic(signal, ind4h, trend_strength, volatility)
        _record(signal.id, "heuristic", 0, result.confidence, result.validated, used_fallback=True,
                symbol=signal.symbol, setup_score=setup_score)
        _record_call_outcome(is_fallback=True)
        return result

    prompt = _build_prompt(signal, coin, ind4h, trend_strength, volatility)
    t0 = time.perf_counter()

    try:
        # Semaphore(3) caps concurrency; rate limiter caps RPM; retry handles 429.
        async with _get_semaphore():
            for attempt in range(_MAX_429_RETRIES + 1):
                await _get_rate_limiter().acquire()
                try:
                    msg = await asyncio.wait_for(
                        asyncio.to_thread(
                            client.messages.create,
                            model="claude-haiku-4-5",
                            max_tokens=ai_max_tokens,
                            messages=[{"role": "user", "content": prompt}],
                            timeout=15.0,
                        ),
                        timeout=20.0,
                    )
                    break  # success — exit retry loop
                except anthropic.RateLimitError as exc:
                    if attempt >= _MAX_429_RETRIES:
                        log.warning("ai_rate_limit_exhausted", symbol=signal.symbol, attempts=attempt + 1, error=str(exc))
                        raise
                    delay = _429_BASE_DELAY_S * (2 ** attempt)
                    log.warning("ai_rate_limited_retry", symbol=signal.symbol, attempt=attempt + 1, delay_s=delay)
                    await asyncio.sleep(delay)
        elapsed    = time.perf_counter() - t0
        latency_ms = int(elapsed * 1000)
        ai_validation_duration_seconds.observe(elapsed)

        text = msg.content[0].text.strip() if msg.content[0].type == "text" else ""
        # CLAUDE.OPTIMIZATION.1: direct extraction, then truncation-aware repair
        parsed = _parse_claude_json(text)
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
            signal.id, "claude-haiku-4-5", latency_ms, confidence, validated,
            prompt_tokens=msg.usage.input_tokens if msg.usage else None,
            completion_tokens=msg.usage.output_tokens if msg.usage else None,
            symbol=signal.symbol, setup_score=setup_score,
        )

        _record_call_outcome(is_fallback=False)   # Enhancement 2: track success
        return AIValidationResult(
            confidence=confidence,
            validated=validated,
            reasoning=str(parsed.get("reasoning", "")),
            risks=[str(r) for r in (parsed.get("risks") or [])],
            strengths=[str(s) for s in (parsed.get("strengths") or [])],
            explainability=expl,
            validation_source="CLAUDE",   # Phase 7.2B.9
        )

    except json.JSONDecodeError:
        log.warning("ai_json_parse_failed")
        ai_validation_total.labels(outcome="error").inc()
        result = _heuristic(signal, ind4h, trend_strength, volatility)
        _record(signal.id, "claude-haiku-4-5", int((time.perf_counter() - t0) * 1000),
                result.confidence, result.validated, error="json_parse_failed",
                symbol=signal.symbol, setup_score=setup_score)
        _record_call_outcome(is_fallback=True)   # Enhancement 2
        return result
    except Exception as exc:
        log.warning("ai_api_failed", error=str(exc))
        ai_validation_total.labels(outcome="fallback").inc()
        result = _heuristic(signal, ind4h, trend_strength, volatility)
        _record(signal.id, "claude-haiku-4-5", int((time.perf_counter() - t0) * 1000),
                result.confidence, result.validated, used_fallback=True, error=str(exc),
                symbol=signal.symbol, setup_score=setup_score)
        _record_call_outcome(is_fallback=True)   # Enhancement 2
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
Funding rate:   {fd.funding_rate * 100:.4f}%  ({fd.funding_rate_annualized:.1f}% ann.)  |  Bias: {fd.funding_bias}  |  Trend: {fd.funding_trend}
OI 24h change:  {'+' if fd.oi_change_24h >= 0 else ''}{fd.oi_change_24h:.2f}%  |  Trend: {fd.oi_trend}  |  Interpretation: {fd.oi_interpretation}
L/S ratio:      {fd.long_short_ratio:.2f}  (Long {fd.long_account_percent:.1f}% / Short {fd.short_account_percent:.1f}%)  |  Positioning: {fd.positioning_context}
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
Price:      ${_sf(i1h.current_price)}
Trend:      {i1h.trend}
RSI(14):    {_sf(i1h.rsi, 1)}
MACD hist:  {_sf(i1h.macd.histogram, 6)} ({'positive ▲' if i1h.macd.histogram > 0 else 'negative ▼'})
EMA20:      ${_sf(i1h.ema20)}  |  EMA50: ${_sf(i1h.ema50)}
ATR(14):    ${_sf(i1h.atr)}
Vol spike:  {_sf(i1h.volume_spike, 2)}×

═══ 4H INDICATORS (trend filter) ════
Trend:      {ind4h.trend}
RSI(14):    {_sf(ind4h.rsi, 1)}
MACD hist:  {_sf(ind4h.macd.histogram, 6)} ({'positive ▲' if ind4h.macd.histogram > 0 else 'negative ▼'})
EMA20:      ${_sf(ind4h.ema20)}  |  EMA50: ${_sf(ind4h.ema50)}
{futures_section}
═══ TRADE LEVELS ════════════════════
Entry:   ${signal.entry_price}
Target:  ${signal.target_price}
Stop:    ${signal.stop_loss}
R:R:     1:{signal.rr_ratio:.2f}

═══ QUALITY METRICS ════════════════
Trend strength score: {trend_strength:.0f}/100
Volatility:           {volatility}
Breakout:             {signal.breakout_type or "none"}
Sector:               {signal.sector_status or "n/a"}
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
• Futures only: OI Interpretation is SHORT_COVERING on BUY (weak rally) or LONG_LIQUIDATION on SELL (squeeze risk)
• Futures only: Positioning is EXTREME_LONG on BUY or EXTREME_SHORT on SELL (crowd too crowded)
• Futures only: Funding trend RISING with ELEVATED bias on BUY (crowding accelerating)

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
    symbol: str | None = None,
    setup_score: int | None = None,
) -> None:
    """Non-blocking DB write — best effort, never raises."""
    try:
        from backend.analytics.ai_metrics import record_ai_call
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return  # not in async context — skip
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
                symbol=symbol,
                setup_score=setup_score,
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
        validation_source="HEURISTIC",   # Phase 7.2B.9
    )
