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


# ── Public API ────────────────────────────────────────────────────────────────

async def send_signal_alert(signal: Signal) -> bool:
    """Format and enqueue a signal alert. Returns True if enqueued (not yet sent)."""
    direction  = "📈 LONG" if signal.type.value == "BUY" else "📉 SHORT"
    grade_icon = _grade_emoji(signal.risk_grade.value)

    lines = [
        f"<b>{direction} — {signal.symbol}</b> ({signal.scanner_mode.value.upper()})",
        "",
        f"Entry:    <code>${signal.entry_price:.4f}</code>",
        f"Target:   <code>${signal.target_price:.4f}</code>",
        f"Stop:     <code>${signal.stop_loss:.4f}</code>",
        f"R:R:      1:{signal.rr_ratio:.2f}",
        f"Confidence: {signal.confidence}%",
        "",
        f"Grade: {grade_icon} {signal.risk_grade.value}  |  Risk score: {signal.risk_score:.0f}",
        f"RSI: {signal.indicators.rsi:.1f}  |  Vol spike: {signal.indicators.volume_spike:.1f}×",
    ]

    if signal.futures_data:
        fd = signal.futures_data
        lines.append(
            f"Funding: {fd.funding_rate * 100:.4f}%  |  Momentum: {fd.momentum_score}/100"
        )

    if signal.ai_explainability:
        lines += ["", f"<i>{signal.ai_explainability.summary}</i>"]

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
