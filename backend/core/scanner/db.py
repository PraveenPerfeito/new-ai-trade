"""
Async database operations for the scanner engine.
Uses the shared asyncpg pool from backend/database/session.py.
All operations degrade gracefully when DATABASE_URL is not configured.
"""
from __future__ import annotations

import asyncio
import json
from datetime import datetime
from typing import Any

from backend.core.scanner.models import CoinData, Signal
from backend.logging.setup import get_logger

log = get_logger(__name__)


async def _pool():
    """Return the pool or None if not configured."""
    try:
        from backend.database.session import get_pool
        return await get_pool()
    except RuntimeError:
        return None
    except Exception as exc:
        log.warning("db_pool_unavailable", error=str(exc))
        return None


# ── Scan runs ─────────────────────────────────────────────────────────────────

async def create_scan_run(mode: str) -> str | None:
    pool = await _pool()
    if not pool:
        return None
    try:
        row = await pool.fetchrow(
            """
            INSERT INTO scan_runs (mode, status, coins_scanned, signals_found)
            VALUES ($1, 'running', 0, 0)
            RETURNING id::text
            """,
            mode,
        )
        return row["id"] if row else None
    except Exception as exc:
        log.warning("db_create_scan_run_failed", error=str(exc))
        return None


async def update_scan_run(
    scan_run_id: str,
    *,
    coins_scanned: int | None = None,
    signals_found: int | None = None,
    status: str | None = None,
    completed_at: datetime | None = None,
    error: str | None = None,
) -> None:
    pool = await _pool()
    if not pool:
        return
    sets: list[str] = []
    vals: list[Any] = []
    idx = 1

    for col, val in [
        ("coins_scanned", coins_scanned),
        ("signals_found", signals_found),
        ("status",        status),
        ("completed_at",  completed_at),
        ("error",         error),
    ]:
        if val is not None:
            sets.append(f"{col} = ${idx}")
            vals.append(val)
            idx += 1

    if not sets:
        return
    vals.append(scan_run_id)
    try:
        await pool.execute(
            f"UPDATE scan_runs SET {', '.join(sets)} WHERE id = ${idx}::uuid",
            *vals,
        )
    except Exception as exc:
        log.warning("db_update_scan_run_failed", scan_run_id=scan_run_id, error=str(exc))


# ── Signals ───────────────────────────────────────────────────────────────────

async def save_signal(signal: Signal) -> str | None:
    pool = await _pool()
    if not pool:
        return None
    expl = signal.ai_explainability.model_dump() if signal.ai_explainability else None
    ind  = signal.indicators
    last_exc: Exception | None = None
    # C3 PIPELINE.HARDENING.1 — 3-attempt retry with 0.5s exponential backoff
    for attempt in range(3):
        try:
            row = await pool.fetchrow(
                """
                INSERT INTO signals (
                    scan_run_id, symbol, name, type, timeframe, scanner_mode,
                    entry_price, target_price, stop_loss, rr_ratio, confidence,
                    rsi, macd_histogram, ema_trend, atr, volume_spike,
                    setup_description, ai_validated, ai_reasoning,
                    ai_explainability, risks, strengths, telegram_sent,
                    breakout_type,
                    breakout_strength, oi_interpretation, funding_trend,
                    positioning_context, trend_score,
                    sector_status,
                    market_regime,
                    validation_source
                ) VALUES (
                    $1::uuid, $2, $3, $4, $5, $6,
                    $7, $8, $9, $10, $11,
                    $12, $13, $14, $15, $16,
                    $17, $18, $19,
                    $20, $21, $22, $23,
                    $24,
                    $25, $26, $27,
                    $28, $29,
                    $30,
                    $31,
                    $32
                )
                RETURNING id::text
                """,
                signal.scan_run_id,
                signal.symbol,
                signal.name,
                signal.type.value,
                signal.timeframe,
                signal.scanner_mode.value,
                signal.entry_price,
                signal.target_price,
                signal.stop_loss,
                signal.rr_ratio,
                signal.confidence,
                ind.rsi if ind else None,
                ind.macd.histogram if ind else None,
                ind.trend.value if ind else None,
                ind.atr if ind else None,
                ind.volume_spike if ind else None,
                signal.setup_description,
                signal.ai_validated,
                signal.ai_reasoning or None,
                json.dumps(expl) if expl else None,
                signal.risks,
                signal.strengths,
                signal.telegram_sent,
                signal.breakout_type,        # Phase 7.4A.6.1
                signal.breakout_strength,    # Phase 7.4A.6.3
                signal.oi_interpretation,    # Phase 7.4A.6.3
                signal.funding_trend,        # Phase 7.4A.6.3
                signal.positioning_context,  # Phase 7.4A.6.3
                signal.trend_score,          # Phase 7.4A.6.3
                signal.sector_status,        # Phase 7.4A.7.2
                signal.market_regime,        # Phase 8.1B
                signal.validation_source,    # Phase 7.2B.9
            )
            return row["id"] if row else None
        except Exception as exc:
            last_exc = exc
            if attempt < 2:
                await asyncio.sleep(0.5 * (2 ** attempt))  # 0.5s, 1.0s
    log.warning("db_save_signal_failed", symbol=signal.symbol, error=str(last_exc))
    return None


async def has_recent_signal(
    symbol: str,
    signal_type: str,
    scanner_mode: str,
    cooldown_minutes: int = 240,   # Phase SIGNAL.COOLDOWN.1: 4h window (was 60min on timeframe)
) -> bool:
    """
    Return True when the same symbol+direction+mode was persisted within the cooldown window.
    Prevents repeated signals for the same trade thesis (e.g. ETH SELL every 15min scan).
    """
    pool = await _pool()
    if not pool:
        return False
    try:
        return bool(await pool.fetchval(
            """
            SELECT EXISTS (
                SELECT 1
                FROM signals
                WHERE upper(symbol)  = upper($1)
                  AND type           = $2
                  AND scanner_mode   = $3
                  AND created_at >= now() - ($4::int * interval '1 minute')
                LIMIT 1
            )
            """,
            symbol,
            signal_type,
            scanner_mode,
            cooldown_minutes,
        ))
    except Exception as exc:
        log.warning("db_recent_signal_check_failed", symbol=symbol, error=str(exc))
        return False


async def mark_signal_telegram_sent(signal_id: str) -> None:
    """Set telegram_sent=true after a successful Telegram dispatch."""
    pool = await _pool()
    if not pool:
        return
    try:
        await pool.execute(
            "UPDATE signals SET telegram_sent = true WHERE id = $1::uuid",
            signal_id,
        )
    except Exception as exc:
        log.warning("db_mark_telegram_sent_failed", signal_id=signal_id, error=str(exc))


# ── Coins ─────────────────────────────────────────────────────────────────────

async def upsert_coins(coins: list[CoinData]) -> None:
    pool = await _pool()
    if not pool:
        return
    rows = [
        (
            c.symbol, c.name, c.id, c.binance_symbol,
            c.market_cap, c.volume_24h, c.price, c.price_change_24h,
            c.rank, c.has_futures,
        )
        for c in coins
    ]
    try:
        await pool.executemany(
            """
            INSERT INTO coins (
                symbol, name, coingecko_id, binance_symbol,
                market_cap, volume_24h, price, price_change_24h,
                rank, has_futures, last_updated
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
            ON CONFLICT (symbol) DO UPDATE SET
                name             = EXCLUDED.name,
                binance_symbol   = EXCLUDED.binance_symbol,
                market_cap       = EXCLUDED.market_cap,
                volume_24h       = EXCLUDED.volume_24h,
                price            = EXCLUDED.price,
                price_change_24h = EXCLUDED.price_change_24h,
                rank             = EXCLUDED.rank,
                has_futures      = EXCLUDED.has_futures,
                last_updated     = now()
            """,
            rows,
        )
    except Exception as exc:
        log.warning("db_upsert_coins_failed", count=len(coins), error=str(exc))
