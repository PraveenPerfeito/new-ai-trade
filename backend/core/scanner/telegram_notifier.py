"""
Telegram alert delivery for scanner signals.
Python port of lib/telegram.ts — uses httpx for async HTTP.
Gracefully skips if credentials are not configured.
"""
from __future__ import annotations

import httpx

from backend.config import get_settings
from backend.core.scanner.models import Signal
from backend.logging.setup import get_logger

log = get_logger(__name__)


def _base_url() -> str:
    return f"https://api.telegram.org/bot{get_settings().telegram_bot_token}"


def _is_configured() -> bool:
    s = get_settings()
    return bool(s.telegram_bot_token and s.telegram_chat_id)


async def _send(text: str) -> bool:
    if not _is_configured():
        return False
    chat_id = get_settings().telegram_chat_id
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                f"{_base_url()}/sendMessage",
                json={"chat_id": chat_id, "text": text, "parse_mode": "HTML"},
            )
            resp.raise_for_status()
            return True
    except Exception as exc:
        log.warning("telegram_send_failed", error=str(exc))
        return False


def _grade_emoji(grade: str) -> str:
    return {"A": "🟢", "B": "🔵", "C": "🟡", "D": "🟠", "F": "🔴"}.get(grade, "⚪")


async def send_signal_alert(signal: Signal) -> bool:
    direction = "📈 LONG" if signal.type.value == "BUY" else "📉 SHORT"
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

    return await _send("\n".join(lines))


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
    return await _send(text)
