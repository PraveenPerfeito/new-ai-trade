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


def _on_task_done(task: asyncio.Task, label: str) -> None:
    if not task.cancelled() and task.exception() is not None:
        log.warning("background_task_failed", task=label, error=str(task.exception()))


# ── Constants ─────────────────────────────────────────────────────────────────

_MIN_INTERVAL = 1.1   # seconds between messages to the same chat (Telegram: 1/s)
_MAX_RETRIES  = 3
_QUEUE_MAX    = 64    # drop oldest if queue is full (prevents memory build-up)


# ── Queue item (TELEGRAM.RELIABILITY.1 WS2/WS3) ───────────────────────────────
# signal_id  → delivery receipt written to signals.telegram_delivered post-send
# dedup_key  → 1h cooldown key set ONLY after confirmed delivery (was set at
#              check-time, which poisoned the cooldown when the send was lost)

class _QueueItem:
    __slots__ = ("text", "signal_id", "dedup_key")

    def __init__(self, text: str, signal_id: str | None = None, dedup_key: str | None = None):
        self.text      = text
        self.signal_id = signal_id
        self.dedup_key = dedup_key


# ── Internal queue singleton (per event loop) ─────────────────────────────────
# TELEGRAM.RELIABILITY.1 WS1: Celery runs each task in a fresh asyncio.run()
# loop.  The queue + drain worker must be recreated when the loop changes —
# a worker task from a closed loop is dead, and messages left behind would be
# orphaned.  flush_queue() (called before every loop exit) guarantees the
# queue is empty at recreation time, so nothing is lost across loops.

_queue: "asyncio.Queue[_QueueItem] | None" = None
_queue_loop: "asyncio.AbstractEventLoop | None" = None
_worker_task: asyncio.Task | None = None
_last_sent_at: float = 0.0


def _get_queue() -> "asyncio.Queue[_QueueItem]":
    global _queue, _queue_loop, _worker_task
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None
    if _queue is None or (loop is not None and _queue_loop is not loop):
        if _queue is not None and not _queue.empty():
            log.warning("telegram_queue_recreated_with_pending", pending=_queue.qsize())
        _queue = asyncio.Queue(maxsize=_QUEUE_MAX)
        _queue_loop = loop
        _worker_task = None
    # Spawn the drain worker lazily in the running event loop
    if _worker_task is None or _worker_task.done():
        if loop is not None:
            _worker_task = loop.create_task(_drain_queue())
    return _queue


async def _drain_queue() -> None:
    """Background worker: dequeue and send messages with rate-limiting."""
    global _last_sent_at
    while True:
        try:
            item = await asyncio.wait_for(_queue.get(), timeout=60.0)
        except asyncio.TimeoutError:
            continue
        except asyncio.CancelledError:
            return

        try:
            # Enforce minimum inter-message gap
            elapsed = time.monotonic() - _last_sent_at
            if elapsed < _MIN_INTERVAL:
                await asyncio.sleep(_MIN_INTERVAL - elapsed)

            delivered = await _send_with_retry(item.text)
            _last_sent_at = time.monotonic()

            # WS3: dedup cooldown marked ONLY after confirmed delivery
            if delivered and item.dedup_key:
                await _mark_alert_cooldown(item.dedup_key)
            # WS2: delivery ground truth (best-effort, migration-tolerant)
            if item.signal_id:
                await _record_delivery(item.signal_id, delivered)
        except Exception as exc:
            log.warning("telegram_drain_error", error=str(exc))
            if item.signal_id:
                await _record_delivery(item.signal_id, False, str(exc)[:200])
        finally:
            _queue.task_done()


async def flush_queue(timeout_s: float = 20.0) -> bool:
    """
    Drain all queued Telegram messages before the event loop exits
    (TELEGRAM.RELIABILITY.1 WS1).  Call at the end of every Celery task that
    can enqueue alerts — without this, messages still queued when asyncio.run()
    returns are silently destroyed (audited tail-loss on multi-signal scans).
    Returns True when fully drained, False on timeout (remaining are logged).
    """
    if _queue is None or _queue.empty() and _queue._unfinished_tasks == 0:  # noqa: SLF001
        return True
    _get_queue()   # ensure a live worker on the current loop
    try:
        await asyncio.wait_for(_queue.join(), timeout=timeout_s)
        return True
    except asyncio.TimeoutError:
        log.error("telegram_flush_timeout", remaining=_queue.qsize(), timeout_s=timeout_s)
        return False


async def _record_delivery(signal_id: str, delivered: bool, error: str | None = None) -> None:
    """Persist delivery ground truth. Tolerates the migration not being run."""
    try:
        from backend.database.session import get_pool  # noqa: PLC0415
        pool = await get_pool()
        await pool.execute(
            "UPDATE signals SET telegram_delivered = $1, telegram_delivery_error = $2 WHERE id = $3::uuid",
            delivered, error, signal_id,
        )
    except Exception as exc:
        log.debug("record_delivery_failed", signal_id=signal_id, error=str(exc))


async def _mark_alert_cooldown(dedup_key: str) -> None:
    """Set the 1h symbol+direction cooldown — only after a confirmed delivery."""
    try:
        from backend.cache.redis_cache import get_redis  # noqa: PLC0415
        redis = await get_redis()
        await redis.setex(dedup_key, ALERT_COOLDOWN_HOURS * 3600, "1")
    except Exception as exc:
        log.warning("alert_cooldown_mark_failed", key=dedup_key, error=str(exc))


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


def _enqueue(text: str, signal_id: str | None = None, dedup_key: str | None = None) -> None:
    """Push message to send queue; drops oldest if queue is full."""
    try:
        q = _get_queue()
        if q.full():
            try:
                dropped = q.get_nowait()       # discard oldest
                q.task_done()
                log.warning("telegram_queue_full_dropped_oldest",
                            dropped_signal_id=getattr(dropped, "signal_id", None))
            except asyncio.QueueEmpty:
                pass
        q.put_nowait(_QueueItem(text, signal_id, dedup_key))
    except Exception as exc:
        log.warning("telegram_enqueue_failed", error=str(exc))


def _grade_emoji(grade: str) -> str:
    return {"A": "🟢", "B": "🔵", "C": "🟡", "D": "🟠", "F": "🔴"}.get(grade, "⚪")


def send_output_collapse_alert(signals_24h: int, avg_daily_7d: float) -> None:
    """
    OUTPUT.COLLAPSE.ALERT.1 — operational alert when signal output collapses
    below 25% of the 7-day baseline for 2+ consecutive scan cycles.
    Throttling is handled by the caller (monitoring.check_output_collapse).
    """
    if not _is_configured():
        return
    text = (
        f"🚨 <b>Signal Output Collapse</b>\n\n"
        f"Last 24h: <b>{signals_24h}</b> signals\n"
        f"7-day average: <b>{avg_daily_7d:.0f}</b>/day\n"
        f"Threshold: &lt;25% of baseline for 2 consecutive scan cycles\n\n"
        f"Likely causes: intelligence cache cold, Binance kline failures (check "
        f"KLINE_EMPTY in gate rejections), provider geo-block, or over-tight gates.\n\n"
        f"<i>Admin → System for scan diagnostics.</i>"
    )
    _enqueue(text)
    log.warning("output_collapse_alert_sent", signals_24h=signals_24h, avg_daily_7d=round(avg_daily_7d, 1))


# ── Alert deduplication (Redis cooldown) ─────────────────────────────────────
# Prevents the same symbol+direction from firing multiple Telegram alerts
# within ALERT_COOLDOWN_HOURS. Same coin can alert again after cooldown expires,
# or immediately if the direction changes (BUY → SELL or vice versa).

ALERT_COOLDOWN_HOURS = 1


def _dedup_key(symbol: str, direction: str) -> str:
    return f"tg:alert:{symbol.upper()}:{direction.upper()}"


async def _is_duplicate_alert(symbol: str, direction: str) -> bool:
    """
    Check-only cooldown test (TELEGRAM.RELIABILITY.1 WS3).
    The cooldown key is now set in the drain worker AFTER a confirmed delivery
    (_mark_alert_cooldown) — previously it was set here at check-time, so a
    send that was later lost or failed still suppressed the symbol for 1h.
    """
    try:
        from backend.cache.redis_cache import get_redis
        redis = await get_redis()
        return bool(await redis.exists(_dedup_key(symbol, direction)))
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
    # ── Operational gate: check all Telegram / emergency switches ────────────
    try:
        from backend.system_settings.service import get_settings_service
        from backend.system_settings.groups import TelegramSettings, FeatureFlags
        tg_cfg   = await get_settings_service().get_group(TelegramSettings)
        flags    = await get_settings_service().get_group(FeatureFlags)
        if not tg_cfg.alerts_enabled:
            log.info("telegram_alert_blocked_disabled", symbol=signal.symbol)
            return False
        if not flags.telegram:
            log.info("telegram_alert_blocked_feature_flag", symbol=signal.symbol)
            return False
        if flags.emergency_stop:
            log.info("telegram_alert_blocked_emergency_stop", symbol=signal.symbol)
            return False
        if flags.maintenance_mode:
            log.info("telegram_alert_blocked_maintenance_mode", symbol=signal.symbol)
            return False
    except Exception as exc:
        log.warning("telegram_settings_check_failed", error=str(exc))
        # fail open — send if settings service is unavailable to avoid silent loss

    # Deduplication FIRST — must check before rate counter so duplicates
    # do NOT waste hourly quota slots (the previous bug: counter incremented
    # on every duplicate attempt, exhausting 20/hr in minutes)
    direction_key = "LONG" if signal.type.value == "BUY" else "SHORT"
    if await _is_duplicate_alert(signal.symbol, direction_key):
        log.info("telegram_alert_skipped_duplicate", symbol=signal.symbol, direction=direction_key,
                 cooldown_hours=ALERT_COOLDOWN_HOURS)
        return False

    # Hourly rate cap — only counted AFTER dedup passes (unique alerts only)
    try:
        from backend.cache.redis_cache import get_redis
        import time as _time
        redis_ratelimit = await get_redis()
        max_per_hr = getattr(tg_cfg, "max_alerts_per_hour", 20)
        current_hour = int(_time.time() / 3600)
        hour_key = f"tg:hourly_count:{current_hour}"
        count = await redis_ratelimit.incr(hour_key)
        if count == 1:
            await redis_ratelimit.expire(hour_key, 3700)
        if count > max_per_hr:
            log.info("telegram_rate_limited", symbol=signal.symbol, count=count, max=max_per_hr)
            return False
    except Exception as exc:
        log.warning("telegram_rate_limit_check_failed", error=str(exc))
        # fail open — send if Redis is unavailable

    is_long    = signal.type.value == "BUY"
    direction  = "📈 LONG" if is_long else "📉 SHORT"
    grade_icon = _grade_emoji(signal.risk_grade.value)
    conf_label = _confidence_label(signal.confidence)
    mode       = signal.scanner_mode.value
    lev_text   = _leverage_text(signal.max_safe_leverage, mode)

    # Price change %
    pct_to_tp = abs(signal.target_price - signal.entry_price) / signal.entry_price * 100
    pct_to_sl = abs(signal.entry_price - signal.stop_loss) / signal.entry_price * 100

    _regime_icons = {
        "BULL_TREND": "🟢", "BEAR_TREND": "🔴",
        "SIDEWAYS": "🟡", "HIGH_VOLATILITY": "🟠",
        "EUPHORIA": "🟣", "CAPITULATION": "⚫",
    }
    _regime      = getattr(signal, "market_regime", None) or "SIDEWAYS"
    _regime_icon = _regime_icons.get(_regime, "⚪")
    _regime_disp = _regime.replace("_", " ")

    # Validation source badge
    _vsource   = (getattr(signal, "validation_source", None) or "HEURISTIC").upper()
    _val_label = "🤖 <b>AI Approved</b>" if _vsource == "CLAUDE" else "🔍 <b>Screened</b>"

    lines = [
        f"<b>{direction} — {signal.symbol}/USDT</b>",
        f"Mode: <b>{mode.upper()}</b>  |  Confidence: <b>{signal.confidence}% {conf_label}</b>",
        f"Grade: {grade_icon} <b>{signal.risk_grade.value}</b>  |  R:R: <b>1:{signal.rr_ratio:.1f}</b>  |  {_val_label}",
        f"Regime: {_regime_icon} <b>{_regime_disp}</b>",
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

    # Phase 7.4A.7.2 — sector intelligence (TRENDING mode only; silent when NEUTRAL or absent)
    sector_note = ""
    if signal.sector_status and signal.sector_status not in ("NEUTRAL",):
        _sector_icon = {"ACCELERATING": "🚀", "STRONGEST": "⭐", "WEAKENING": "📉", "OVERCROWDED": "⚠️"}.get(
            signal.sector_status, "🏛"
        )
        sector_note = f"  Sector: <b>{_sector_icon} {signal.sector_status}</b>"

    tech_lines = [x for x in [ema_cross, pattern, bb_note, breakout_note, sector_note] if x]
    if tech_lines:
        lines += ["", "🔬 <b>Technical</b>"] + tech_lines

    lines += [
        "",
        f"RSI: {ind.rsi:.0f}  |  Vol: {ind.volume_spike:.1f}×  |  EMA200: {'above ✅' if ind.current_price > ind.ema200 > 0 else 'below ⚠️'}",
    ]

    # AI / heuristic summary
    if signal.ai_explainability and signal.ai_explainability.summary:
        _sum_icon = "🤖" if _vsource == "CLAUDE" else "🔍"
        lines += ["", f"{_sum_icon} <i>{signal.ai_explainability.summary}</i>"]

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

    # WS2/WS3: queue item carries the signal id (delivery receipt) and the
    # dedup key (cooldown marked only after confirmed delivery).
    _enqueue(
        "\n".join(lines),
        signal_id=signal.id,
        dedup_key=_dedup_key(signal.symbol, direction_key),
    )
    # Monitoring counter (fire-and-forget)
    try:
        from backend.analytics.monitoring import record_telegram_send as _mon_tg  # noqa: PLC0415
        t = asyncio.create_task(_mon_tg())
        t.add_done_callback(lambda t: _on_task_done(t, "monitor_telegram"))
    except Exception:
        pass
    return True


async def send_scan_summary(
    coins_scanned: int,
    signals_found: int,
    high_conf: int,
    duration_ms: int,
    mode: str,
) -> bool:
    try:
        from backend.system_settings.service import get_settings_service
        from backend.system_settings.groups import TelegramSettings, FeatureFlags
        tg_cfg = await get_settings_service().get_group(TelegramSettings)
        flags  = await get_settings_service().get_group(FeatureFlags)
        if not tg_cfg.alerts_enabled or not flags.telegram or flags.emergency_stop or flags.maintenance_mode:
            return False
    except Exception:
        pass  # fail open for scan summaries

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
        _enqueue(text)
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
