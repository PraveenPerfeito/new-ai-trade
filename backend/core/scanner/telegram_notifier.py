"""
Telegram alert delivery for scanner signals.

Sends are serialised through an asyncio.Queue so concurrent callers never
block each other and we never exceed Telegram's ~30 msg/s global + 1 msg/s
per-chat limits.

Retry policy:
  - 429  → honour Retry-After header, then retry (up to MAX_RETRIES)
  - 5xx  → exponential back-off (0.5 s, 1 s, 2 s …)
  - other → log and discard
"""
from __future__ import annotations

import asyncio
import time
from typing import Any

import httpx

from backend.config import get_settings
from backend.core.scanner.models import Signal
from backend.logging.setup import get_logger
from backend.metrics.prometheus import external_api_errors_total

log = get_logger(__name__)

# ── Constants ─────────────────────────────────────────────────────────────────

_MIN_INTERVAL = 1.1   # seconds between messages to the same chat (Telegram: 1/s)
_MAX_RETRIES  = 3
_QUEUE_MAX    = 64    # drop oldest if queue is full (prevents memory build-up)


# ── Internal queue singleton ──────────────────────────────────────────────────

_queue: asyncio.Queue[str] | None = None
_worker_task: asyncio.Task | None = None
_last_sent_at: float = 0.0


def _get_queue() -> asyncio.Queue[str]:
    global _queue, _worker_task
    if _queue is None:
        _queue = asyncio.Queue(maxsize=_QUEUE_MAX)
    # Spawn the drain worker lazily in the running event loop
    if _worker_task is None or _worker_task.done():
        try:
            loop = asyncio.get_running_loop()
            _worker_task = loop.create_task(_drain_queue())
        except RuntimeError:
            pass   # not inside an event loop — queue will drain when one exists
    return _queue


async def _drain_queue() -> None:
    """Background worker: dequeue and send messages with rate-limiting."""
    global _last_sent_at
    while True:
        try:
            text = await asyncio.wait_for(_queue.get(), timeout=60.0)
        except asyncio.TimeoutError:
            continue
        except asyncio.CancelledError:
            return

        try:
            # Enforce minimum inter-message gap
            elapsed = time.monotonic() - _last_sent_at
            if elapsed < _MIN_INTERVAL:
                await asyncio.sleep(_MIN_INTERVAL - elapsed)

            await _send_with_retry(text)
            _last_sent_at = time.monotonic()
        except Exception as exc:
            log.warning("telegram_drain_error", error=str(exc))
        finally:
            _queue.task_done()


async def _send_with_retry(text: str) -> bool:
    """POST to Telegram sendMessage with exponential back-off on transient errors."""
    if not _is_configured():
        return False

    s = get_settings()
    url     = f"https://api.telegram.org/bot{s.telegram_bot_token}/sendMessage"
    payload = {"chat_id": s.telegram_chat_id, "text": text, "parse_mode": "HTML"}
    delay   = 0.5

    for attempt in range(_MAX_RETRIES):
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(url, json=payload)

            if resp.status_code == 200:
                return True

            if resp.status_code == 429:
                retry_after = float(resp.headers.get("Retry-After", "5"))
                log.warning("telegram_rate_limited", retry_after=retry_after, attempt=attempt)
                external_api_errors_total.labels(service="telegram", error_type="rate_limit").inc()
                await asyncio.sleep(retry_after)
                continue

            if resp.status_code >= 500:
                log.warning("telegram_server_error", status=resp.status_code, attempt=attempt)
                external_api_errors_total.labels(service="telegram", error_type="server_error").inc()
                await asyncio.sleep(delay)
                delay *= 2
                continue

            # 4xx (not 429) — permanent error, discard
            log.error("telegram_client_error", status=resp.status_code, body=resp.text[:200])
            return False

        except httpx.TimeoutException:
            log.warning("telegram_timeout", attempt=attempt)
            external_api_errors_total.labels(service="telegram", error_type="timeout").inc()
            await asyncio.sleep(delay)
            delay *= 2
        except Exception as exc:
            log.warning("telegram_send_failed", error=str(exc), attempt=attempt)
            external_api_errors_total.labels(service="telegram", error_type="network").inc()
            await asyncio.sleep(delay)
            delay *= 2

    log.error("telegram_max_retries_exceeded")
    return False


# ── Public helpers ────────────────────────────────────────────────────────────

def _is_configured() -> bool:
    s = get_settings()
    return bool(s.telegram_bot_token and s.telegram_chat_id)


def _enqueue(text: str) -> None:
    """Push message to send queue; drops oldest if queue is full."""
    try:
        q = _get_queue()
        if q.full():
            try:
                q.get_nowait()       # discard oldest
                q.task_done()
            except asyncio.QueueEmpty:
                pass
            log.warning("telegram_queue_full_dropped_oldest")
        q.put_nowait(text)
    except Exception as exc:
        log.warning("telegram_enqueue_failed", error=str(exc))


def _grade_emoji(grade: str) -> str:
    return {"A": "🟢", "B": "🔵", "C": "🟡", "D": "🟠", "F": "🔴"}.get(grade, "⚪")


# ── Alert deduplication (Redis cooldown) ─────────────────────────────────────
# Prevents the same symbol+direction from firing multiple Telegram alerts
# within ALERT_COOLDOWN_HOURS. Same coin can alert again after cooldown expires,
# or immediately if the direction changes (BUY → SELL or vice versa).

ALERT_COOLDOWN_HOURS = 1


async def _is_duplicate_alert(symbol: str, direction: str) -> bool:
    """Return True if this symbol+direction was already alerted within the cooldown window."""
    try:
        from backend.cache.redis_cache import get_redis
        redis = await get_redis()
        key = f"tg:alert:{symbol.upper()}:{direction.upper()}"
        exists = await redis.exists(key)
        if not exists:
            await redis.setex(key, ALERT_COOLDOWN_HOURS * 3600, "1")
        return bool(exists)
    except Exception as exc:
        log.warning("alert_dedup_check_failed", error=str(exc))
        return False  # fail open — send the alert if Redis is down


# ── Public API ────────────────────────────────────────────────────────────────

def _confidence_label(conf: int) -> str:
    if conf >= 90: return "🔥 VERY HIGH"
    if conf >= 85: return "💪 HIGH"
    if conf >= 80: return "✅ SOLID"
    if conf >= 75: return "🟡 MEDIUM"
    return "⚠️ LOW"


def _leverage_text(max_lev: int, mode: str) -> str:
    if mode == "spot":
        return "Spot (no leverage)"
    if max_lev <= 0:
        return "No leverage recommended"
    tiers = [x for x in [3, 5, 10, 15, 20] if x <= max_lev]
    if not tiers:
        return f"Max {max_lev}× (very cautious)"
    safe = tiers[-1]
    return f"Up to {safe}× (max safe: {max_lev}×)"


async def send_signal_alert(signal: Signal) -> bool:
    """Format and enqueue a detailed signal alert. Skips if same symbol+direction was alerted within 4h."""
    # Deduplication check — prevents spam for the same coin
    direction_key = "LONG" if signal.type.value == "BUY" else "SHORT"
    if await _is_duplicate_alert(signal.symbol, direction_key):
        log.info("telegram_alert_skipped_duplicate", symbol=signal.symbol, direction=direction_key,
                 cooldown_hours=ALERT_COOLDOWN_HOURS)
        return False

    is_long    = signal.type.value == "BUY"
    direction  = "📈 LONG" if is_long else "📉 SHORT"
    grade_icon = _grade_emoji(signal.risk_grade.value)
    conf_label = _confidence_label(signal.confidence)
    mode       = signal.scanner_mode.value
    lev_text   = _leverage_text(signal.max_safe_leverage, mode)

    # Price change %
    pct_to_tp = abs(signal.target_price - signal.entry_price) / signal.entry_price * 100
    pct_to_sl = abs(signal.entry_price - signal.stop_loss) / signal.entry_price * 100

    lines = [
        f"<b>{direction} — {signal.symbol}/USDT</b>",
        f"Mode: <b>{mode.upper()}</b>  |  Confidence: <b>{signal.confidence}% {conf_label}</b>",
        f"Grade: {grade_icon} <b>{signal.risk_grade.value}</b>  |  R:R: <b>1:{signal.rr_ratio:.1f}</b>",
        "",
        "📊 <b>Trade Levels</b>",
        f"  Entry:  <code>${signal.entry_price:.4f}</code>",
        f"  Target: <code>${signal.target_price:.4f}</code>  (+{pct_to_tp:.2f}%)",
        f"  Stop:   <code>${signal.stop_loss:.4f}</code>  (-{pct_to_sl:.2f}%)",
        "",
        f"⚡ <b>Leverage:</b> {lev_text}",
    ]

    # Futures-specific data
    if signal.futures_data:
        fd = signal.futures_data
        bias_icon = "🔴" if fd.funding_bias == "LONG_HEAVY" else "🟢" if fd.funding_bias == "SHORT_HEAVY" else "⚪"
        lines += [
            "",
            "📡 <b>Futures Intelligence</b>",
            f"  Funding: {fd.funding_rate * 100:.4f}% {bias_icon} ({fd.funding_bias})",
            f"  OI Trend: {fd.oi_trend}  |  L/S: {fd.long_short_ratio:.2f}",
            f"  Momentum: {fd.momentum_score}/100",
        ]
        # Phase 7.4A.6.4 — compact institutional context line (omit neutral/balanced values)
        _trend_arrow = {"RISING": "↗", "FALLING": "↘"}.get(signal.funding_trend or "", "")
        _intel: list[str] = []
        if signal.oi_interpretation and signal.oi_interpretation != "NEUTRAL":
            _intel.append(f"OI: <b>{signal.oi_interpretation.replace('_', ' ')}</b>")
        if signal.positioning_context and signal.positioning_context not in ("BALANCED",):
            _intel.append(f"Pos: <b>{signal.positioning_context.replace('_', ' ')}</b>")
        if signal.funding_trend and signal.funding_trend != "STABLE":
            _intel.append(f"Fund: <b>{signal.funding_trend}</b> {_trend_arrow}")
        if _intel:
            lines.append(f"  Intel: {' · '.join(_intel)}")

    # Technical context
    ind = signal.indicators
    ema_cross = f"  EMA Cross: <b>{ind.ema_cross}</b>" if ind.ema_cross else ""
    pattern   = f"  Pattern: <b>{ind.candle_pattern.replace('_', ' ')}</b>" if ind.candle_pattern else ""
    bb_note   = "  BB: <b>SQUEEZE ⚡</b>" if ind.bb and ind.bb.squeeze else ""
    # Phase 7.4A.6.4 — breakout context (structured, all scan modes)
    if signal.breakout_type and signal.breakout_strength:
        _short_str  = signal.breakout_strength.replace("_BREAKOUT", "").replace("HIGH_MOMENTUM", "HIGH MOM")
        _short_type = signal.breakout_type.split("+")[0].replace("_", " ")
        breakout_note = f"  Breakout: <b>{_short_str}</b> ({_short_type})"
    else:
        breakout_note = ""

    tech_lines = [x for x in [ema_cross, pattern, bb_note, breakout_note] if x]
    if tech_lines:
        lines += ["", "🔬 <b>Technical</b>"] + tech_lines

    lines += [
        "",
        f"RSI: {ind.rsi:.0f}  |  Vol: {ind.volume_spike:.1f}×  |  EMA200: {'above ✅' if ind.current_price > ind.ema200 > 0 else 'below ⚠️'}",
    ]

    # AI summary
    if signal.ai_explainability and signal.ai_explainability.summary:
        lines += ["", f"🤖 <i>{signal.ai_explainability.summary}</i>"]

    # Setup description
    if signal.setup_description:
        lines += [f"📝 {signal.setup_description[:120]}"]

    # Timestamp + cooldown notice
    from datetime import datetime, timezone
    now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    lines += [
        "",
        f"🕐 <code>{now_str}</code>  |  Next alert in {ALERT_COOLDOWN_HOURS}h",
    ]

    _enqueue("\n".join(lines))
    return True


async def send_scan_summary(
    coins_scanned: int,
    signals_found: int,
    high_conf: int,
    duration_ms: int,
    mode: str,
) -> bool:
    text = (
        f"<b>Scan Complete — {mode.upper()}</b>\n"
        f"Coins scanned: {coins_scanned}\n"
        f"Signals found: {signals_found} ({high_conf} high-confidence)\n"
        f"Duration: {duration_ms / 1000:.1f}s"
    )
    _enqueue(text)
    return True


async def send_provider_fallback_alert(
    primary:    str,
    fallback:   str,
    coin_count: int,
    reason:     str = "cache_cold",
) -> None:
    """
    Operational alert sent when the CMC intelligence cache is cold and the
    scanner degrades to a secondary provider.

    Called fire-and-forget from intelligence_cache.py.
    Alert is throttled externally (Redis key) — this function always sends when called.
    """
    if not _is_configured():
        return

    _ICONS = {"coinmarketcap": "📊", "coingecko": "🦎", "binance": "⚡"}
    p_icon = _ICONS.get(primary.lower(), "📡")
    f_icon = _ICONS.get(fallback.lower(), "📡")
    reason_str = reason.replace("_", " ")

    text = (
        f"⚠️ <b>Intelligence Provider Fallback</b>\n\n"
        f"{p_icon} <b>{primary.title()}</b>  ❌  {reason_str}\n"
        f"{f_icon} <b>{fallback.title()}</b>  ✅  active fallback\n\n"
        f"Scan universe: <b>{coin_count} coins</b> "
        f"(CMC normally provides 200)\n\n"
        f"CMC cache will auto-refresh within 5 min.\n"
        f"<i>Scan continued — no signals dropped.</i>"
    )
    try:
        await _post(text)
        log.info("ops_alert_sent", alert="provider_fallback",
                 primary=primary, fallback=fallback)
    except Exception as exc:
        log.warning("ops_alert_failed", alert="provider_fallback", error=str(exc))


async def send_batch_summary(signals: list[Signal], mode: str) -> bool:
    """Send a condensed summary when many signals arrive in one scan."""
    if not signals:
        return False
    lines = [f"<b>📊 {len(signals)} Signals — {mode.upper()}</b>", ""]
    for s in signals:
        direction = "↑" if s.type.value == "BUY" else "↓"
        lines.append(
            f"{direction} <b>{s.symbol}</b>  RR {s.rr_ratio:.1f}  "
            f"Conf {s.confidence}%  [{s.risk_grade.value}]"
        )
    _enqueue("\n".join(lines))
    return True
