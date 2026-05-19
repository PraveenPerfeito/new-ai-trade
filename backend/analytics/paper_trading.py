"""
Paper trading engine — port of lib/paper-trading-engine.ts.
Simulates trade entries and exits on scanner signals with a virtual
portfolio. Position sizing is risk-based (1% equity per trade).
"""
from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone

from backend.core.scanner.market_fetcher import fetch_klines
from backend.core.scanner.models import Signal
from backend.logging.setup import get_logger
from backend.metrics.prometheus import paper_positions_open, paper_trades_closed_total

log = get_logger(__name__)

DEFAULT_RISK_PCT       = 0.01   # fraction of equity risked per trade
MAX_OPEN_POSITIONS     = 5
TRADE_EXPIRY_HOURS     = 168    # 7 days
DEFAULT_PORTFOLIO_NAME = "Main"

_MAX_LEVERAGE: dict[str, int] = {
    "futures":         10,
    "high_confidence": 5,
    "spot":            1,
    "trending":        1,
}


async def _pool():
    try:
        from backend.database.session import get_pool
        return await get_pool()
    except RuntimeError:
        return None
    except Exception as exc:
        log.warning("paper_trading_db_unavailable", error=str(exc))
        return None


# ── Portfolio ─────────────────────────────────────────────────────────────────

async def get_or_create_portfolio(name: str = DEFAULT_PORTFOLIO_NAME) -> dict | None:
    pool = await _pool()
    if pool is None:
        return None
    try:
        # Use INSERT ... ON CONFLICT DO NOTHING to handle concurrent creation safely
        await pool.execute(
            "INSERT INTO paper_portfolios (name) VALUES ($1) ON CONFLICT (name) DO NOTHING", name
        )
        row = await pool.fetchrow(
            "SELECT * FROM paper_portfolios WHERE name=$1 LIMIT 1", name
        )
        return dict(row) if row else None
    except Exception as exc:
        log.warning("get_or_create_portfolio_failed", error=str(exc))
        return None


# ── Open trade ────────────────────────────────────────────────────────────────

async def open_trade(signal: Signal) -> dict | None:
    """
    Open a paper position for the given signal if capacity allows.
    Returns the created paper_trades row or None if skipped.
    """
    pool = await _pool()
    if pool is None:
        return None

    portfolio = await get_or_create_portfolio()
    if not portfolio:
        return None

    portfolio_id = str(portfolio["id"])

    try:
        # Guard: position cap
        open_count = await pool.fetchval(
            "SELECT COUNT(*) FROM paper_trades WHERE portfolio_id=$1 AND status='OPEN'",
            portfolio_id,
        )
        if open_count >= MAX_OPEN_POSITIONS:
            log.info("paper_trade_skipped_max_positions", symbol=signal.symbol)
            return None

        # Guard: one position per symbol
        existing = await pool.fetchval(
            "SELECT id FROM paper_trades WHERE portfolio_id=$1 AND symbol=$2 AND status='OPEN'",
            portfolio_id, signal.symbol,
        )
        if existing:
            return None

        # Position sizing
        equity      = float(portfolio["available_capital"]) + float(portfolio["realized_pnl"])
        risk_amount = equity * DEFAULT_RISK_PCT
        sl_dist     = abs(signal.entry_price - signal.stop_loss) / signal.entry_price

        if sl_dist <= 0 or signal.entry_price <= 0:
            return None

        mode_val  = signal.scanner_mode.value if hasattr(signal.scanner_mode, "value") else str(signal.scanner_mode)
        max_lev   = _MAX_LEVERAGE.get(mode_val, 1)
        notional  = risk_amount / sl_dist
        leverage  = max(1, min(math.ceil(notional / equity), max_lev))
        margin    = notional / leverage
        quantity  = notional / signal.entry_price

        if margin > float(portfolio["available_capital"]):
            log.info("paper_trade_skipped_insufficient_capital", symbol=signal.symbol)
            return None

        row = await pool.fetchrow(
            """
            INSERT INTO paper_trades (
                portfolio_id, signal_id, symbol, signal_type, timeframe,
                scanner_mode, confidence, entry_price, target_price, stop_loss,
                rr_ratio, leverage, risk_pct, notional_usdt, margin_usdt,
                risk_amount_usdt, quantity
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
            RETURNING *
            """,
            portfolio_id,
            signal.id,
            signal.symbol,
            signal.type.value,
            signal.timeframe,
            mode_val,
            signal.confidence,
            signal.entry_price,
            signal.target_price,
            signal.stop_loss,
            signal.rr_ratio,
            leverage,
            DEFAULT_RISK_PCT,
            round(notional, 4),
            round(margin, 4),
            round(risk_amount, 4),
            round(quantity, 8),
        )

        # Deduct margin from available capital
        await pool.execute(
            "UPDATE paper_portfolios SET available_capital=available_capital-$1, updated_at=NOW() WHERE id=$2",
            round(margin, 4), portfolio_id,
        )

        paper_positions_open.inc()
        log.info("paper_trade_opened", symbol=signal.symbol, notional=round(notional, 2), leverage=leverage)
        return dict(row) if row else None

    except Exception as exc:
        log.error("open_trade_failed", symbol=signal.symbol, error=str(exc))
        return None


# ── Position monitor ──────────────────────────────────────────────────────────

async def monitor_open_positions() -> dict:
    """
    Evaluate all open paper positions against current prices.
    Called every minute by the Celery beat task.
    """
    pool = await _pool()
    if pool is None:
        return {"checked": 0, "closed": 0}

    try:
        trades = await pool.fetch(
            "SELECT * FROM paper_trades WHERE status='OPEN' ORDER BY created_at ASC"
        )
    except Exception as exc:
        log.error("fetch_open_positions_failed", error=str(exc))
        return {"checked": 0, "closed": 0}

    checked = closed = 0
    for trade in trades:
        checked += 1
        try:
            exit_reason = await _evaluate_trade(dict(trade))
            if exit_reason:
                await _close_trade(pool, dict(trade), exit_reason)
                closed += 1
        except Exception as exc:
            log.warning("evaluate_trade_failed", trade_id=str(trade["id"]), error=str(exc))

    if closed:
        log.info("paper_positions_closed", checked=checked, closed=closed)
    return {"checked": checked, "closed": closed}


async def _evaluate_trade(trade: dict) -> str | None:
    """Returns exit reason or None if position should remain open."""
    created: datetime = trade["created_at"]
    if created.tzinfo is None:
        created = created.replace(tzinfo=timezone.utc)
    hours_open = (datetime.now(timezone.utc) - created).total_seconds() / 3600
    if hours_open >= TRADE_EXPIRY_HOURS:
        return "EXPIRED"

    symbol = trade["symbol"] + "USDT"
    try:
        candles = await fetch_klines(symbol, "1h", 3, False)
    except Exception:
        return None

    if not candles:
        return None

    current = float(candles[-1].close)
    tp      = float(trade["target_price"])
    sl      = float(trade["stop_loss"])
    is_buy  = trade["signal_type"] == "BUY"

    if is_buy:
        if current <= sl:
            return "SL_HIT"
        if current >= tp:
            return "TP_HIT"
    else:
        if current >= sl:
            return "SL_HIT"
        if current <= tp:
            return "TP_HIT"

    return None


async def _close_trade(pool, trade: dict, exit_reason: str) -> None:
    symbol = trade["symbol"] + "USDT"
    try:
        candles      = await fetch_klines(symbol, "1h", 1, False)
        current_price = float(candles[-1].close) if candles else float(trade["entry_price"])
    except Exception:
        current_price = float(trade["entry_price"])

    entry    = float(trade["entry_price"])
    is_buy   = trade["signal_type"] == "BUY"
    notional = float(trade["notional_usdt"])
    leverage = int(trade["leverage"])
    margin   = float(trade["margin_usdt"])

    price_diff = current_price - entry if is_buy else entry - current_price
    pnl_pct    = price_diff / entry * leverage * 100
    pnl_usdt   = notional * (price_diff / entry)

    created: datetime = trade["created_at"]
    if created.tzinfo is None:
        created = created.replace(tzinfo=timezone.utc)
    duration_hours = (datetime.now(timezone.utc) - created).total_seconds() / 3600
    is_win = exit_reason == "TP_HIT"

    try:
        await pool.execute(
            """
            UPDATE paper_trades
            SET status=$1, exit_price=$2, exit_reason=$3,
                realized_pnl=$4, realized_pnl_pct=$5, duration_hours=$6,
                closed_at=NOW(), last_checked_at=NOW()
            WHERE id=$7
            """,
            "CLOSED_" + exit_reason,
            round(current_price, 8),
            exit_reason,
            round(pnl_usdt, 4),
            round(pnl_pct, 4),
            round(duration_hours, 2),
            trade["id"],
        )
        await pool.execute(
            """
            UPDATE paper_portfolios
            SET available_capital = available_capital + $1,
                realized_pnl      = realized_pnl + $2,
                total_trades      = total_trades + 1,
                wins              = wins   + $3,
                losses            = losses + $4,
                updated_at        = NOW()
            WHERE id = $5
            """,
            round(margin + pnl_usdt, 4),
            round(pnl_usdt, 4),
            1 if is_win else 0,
            0 if is_win else 1,
            trade["portfolio_id"],
        )
        paper_positions_open.dec()
        paper_trades_closed_total.labels(exit_reason=exit_reason).inc()
        log.info("paper_trade_closed", symbol=trade["symbol"], reason=exit_reason, pnl=round(pnl_usdt, 2))
    except Exception as exc:
        log.error("close_trade_failed", trade_id=str(trade["id"]), error=str(exc))


# ── Portfolio metrics ─────────────────────────────────────────────────────────

async def get_portfolio_metrics() -> dict | None:
    portfolio = await get_or_create_portfolio()
    if not portfolio:
        return None

    pool = await _pool()
    if pool is None:
        return None

    portfolio_id = str(portfolio["id"])
    try:
        open_trades   = await pool.fetch(
            "SELECT * FROM paper_trades WHERE portfolio_id=$1 AND status='OPEN'",
            portfolio_id,
        )
        closed_trades = await pool.fetch(
            """
            SELECT realized_pnl, realized_pnl_pct, duration_hours, exit_reason
            FROM paper_trades
            WHERE portfolio_id=$1 AND status != 'OPEN'
            ORDER BY closed_at DESC LIMIT 200
            """,
            portfolio_id,
        )
    except Exception as exc:
        log.warning("get_portfolio_metrics_failed", error=str(exc))
        return None

    initial      = float(portfolio["initial_capital"])
    available    = float(portfolio["available_capital"])
    realized_pnl = float(portfolio["realized_pnl"])
    equity       = available + realized_pnl
    total_trades = int(portfolio["total_trades"])
    wins         = int(portfolio["wins"])
    losses       = int(portfolio["losses"])

    closed = [dict(r) for r in closed_trades]
    profit_amounts = [float(t["realized_pnl"]) for t in closed if float(t["realized_pnl"]) > 0]
    loss_amounts   = [float(t["realized_pnl"]) for t in closed if float(t["realized_pnl"]) < 0]
    durations      = [float(t["duration_hours"]) for t in closed if t.get("duration_hours")]

    gross_loss = abs(sum(loss_amounts))
    profit_factor = (
        round(sum(profit_amounts) / gross_loss, 4)
        if gross_loss > 0 else None
    )

    return {
        "portfolio": {
            "initial_capital":  initial,
            "available_capital": round(available, 2),
            "equity":           round(equity, 2),
            "realized_pnl":     round(realized_pnl, 2),
            "total_return_pct": round((equity - initial) / initial * 100, 2),
            "total_trades":     total_trades,
            "wins":             wins,
            "losses":           losses,
            "win_rate":         round(wins / total_trades, 4) if total_trades > 0 else 0.0,
            "profit_factor":    profit_factor,
            "avg_duration_hours": round(sum(durations) / len(durations), 2) if durations else 0.0,
        },
        "open_positions": [dict(t) for t in open_trades],
        "open_count":     len(open_trades),
    }
