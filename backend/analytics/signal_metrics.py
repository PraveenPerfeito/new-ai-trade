"""
Signal outcome tracking and performance analytics.
Registers new signals, resolves PENDING outcomes via Binance klines,
and computes analytics slices (overall, by mode, by volatility, etc.).
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from typing import Any

from backend.analytics.expectancy import compute_stats
from backend.core.scanner.indicators import calc_volatility_rating
from backend.core.scanner.market_fetcher import fetch_klines
from backend.core.scanner.models import Signal
from backend.logging.setup import get_logger

log = get_logger(__name__)

TIMEOUT_HOURS      = 72
CANDLE_LIMIT       = 200
CHECK_BATCH        = 50
STALE_DAYS         = 7

CONFIDENCE_BANDS: list[tuple[int, int]] = [
    (70, 75), (75, 80), (80, 85), (85, 90), (90, 95), (95, 101),
]

# ── TrendScore tier buckets (GAP-4) ──────────────────────────────────────────

def trend_score_tier(score: float | None) -> str:
    """Classify a 0-100 TrendScore into a named tier for analytics grouping."""
    if score is None:
        return "N/A"
    if score >= 85:
        return "ELITE"
    if score >= 70:
        return "STRONG"
    if score >= 50:
        return "GOOD"
    return "WEAK"


async def _pool():
    try:
        from backend.database.session import get_pool
        return await get_pool()
    except RuntimeError:
        return None
    except Exception as exc:
        log.warning("analytics_db_pool_unavailable", error=str(exc))
        return None


# ── Registration ──────────────────────────────────────────────────────────────

async def register_signal_outcome(signal: Signal) -> str | None:
    """Create a PENDING outcome record immediately after a signal is accepted."""
    if not signal.id:
        return None
    pool = await _pool()
    if pool is None:
        return None

    try:
        duplicate = await pool.fetchval(
            """
            SELECT EXISTS (
                SELECT 1
                FROM signal_outcomes
                WHERE upper(symbol) = upper($1)
                  AND signal_type = $2
                  AND timeframe = $3
                  AND created_at >= now() - interval '60 minutes'
                LIMIT 1
            )
            """,
            signal.symbol,
            signal.type.value,
            signal.timeframe,
        )
        if duplicate:
            log.info(
                "duplicate_outcome_suppressed",
                symbol=signal.symbol,
                signal_type=signal.type.value,
                timeframe=signal.timeframe,
            )
            return None
    except Exception as exc:
        log.warning("duplicate_outcome_check_failed", symbol=signal.symbol, error=str(exc))

    volatility_regime = None
    if signal.indicators:
        try:
            vr = calc_volatility_rating(signal.indicators.atr, signal.indicators.current_price)
            volatility_regime = vr.value
        except Exception:
            pass

    # Extract Phase 7.4A.x intelligence fields from futures_data (Phase 7.4A.6.1)
    fd = signal.futures_data
    oi_interpretation   = fd.oi_interpretation.value      if fd else None
    funding_trend       = fd.funding_trend.value          if fd else None
    positioning_context = fd.positioning_context.value    if fd else None
    momentum_score      = fd.momentum_score               if fd else None

    try:
        row = await pool.fetchrow(
            """
            INSERT INTO signal_outcomes (
                signal_id, symbol, signal_type, timeframe, scanner_mode,
                entry_price, target_price, stop_loss, rr_ratio,
                confidence, ai_validated,
                volatility_regime, risk_grade, risk_score, quality_score,
                breakout_type, breakout_strength,
                oi_interpretation, funding_trend,
                positioning_context, momentum_score, trend_score,
                sector_status,
                market_regime
            ) VALUES (
                $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
                $12,$13,$14,$15,
                $16,$17,
                $18,$19,
                $20,$21,$22,
                $23,
                $24
            )
            ON CONFLICT (signal_id) DO NOTHING
            RETURNING id::text
            """,
            signal.id,
            signal.symbol,
            signal.type.value,
            signal.timeframe,
            signal.scanner_mode.value,
            signal.entry_price,
            signal.target_price,
            signal.stop_loss,
            signal.rr_ratio,
            signal.confidence,
            signal.ai_validated,
            volatility_regime,
            signal.risk_grade.value if signal.risk_grade else None,
            signal.risk_score,
            signal.quality_score,
            signal.breakout_type,        # Phase 7.4A.6.1
            signal.breakout_strength,    # Phase 7.4A.6.3
            oi_interpretation,           # Phase 7.4A.6.1
            funding_trend,               # Phase 7.4A.6.1
            positioning_context,         # Phase 7.4A.6.1
            momentum_score,              # Phase 7.4A.6.1
            signal.trend_score,          # Phase 7.4A.6.1
            signal.sector_status,        # Phase 7.4A.7.2
            signal.market_regime,        # Phase 8.1B
        )
        return row["id"] if row else None
    except Exception as exc:
        log.warning("register_outcome_failed", symbol=signal.symbol, error=str(exc))
        return None


# ── Outcome checker ───────────────────────────────────────────────────────────

async def check_pending_outcomes() -> dict:
    """
    Fetch PENDING outcomes and resolve them via Binance klines.
    Returns a summary of what was resolved.
    """
    pool = await _pool()
    if pool is None:
        return {"resolved": 0, "still_pending": 0, "errors": 0}

    # H3 PIPELINE.HARDENING.1 — auto-timeout outcomes older than STALE_DAYS to
    # prevent permanent PENDING orphans after the 7-day fetch window closes.
    try:
        tag = await pool.execute(
            """
            UPDATE signal_outcomes
            SET outcome = 'TIMEOUT',
                exit_price = entry_price,
                exit_time = NOW(),
                rr_achieved = 0,
                pnl_pct = 0,
                duration_hours = EXTRACT(EPOCH FROM (NOW() - created_at)) / 3600,
                resolved_at = NOW(),
                checked_at = NOW(),
                check_count = check_count + 1
            WHERE outcome = 'PENDING'
              AND created_at < NOW() - INTERVAL '7 days'
            """,
        )
        stale_count = int(tag.split()[-1]) if tag else 0
        if stale_count:
            log.info("stale_outcomes_timed_out", count=stale_count)
    except Exception as exc:
        log.warning("stale_outcome_timeout_failed", error=str(exc))

    cutoff = datetime.now(timezone.utc) - timedelta(days=STALE_DAYS)
    try:
        rows = await pool.fetch(
            """
            SELECT id, signal_id, symbol, signal_type, scanner_mode, entry_price,
                   target_price, stop_loss, rr_ratio, created_at, check_count
            FROM signal_outcomes
            WHERE outcome = 'PENDING'
              AND created_at > $1
            ORDER BY checked_at ASC NULLS FIRST, created_at ASC
            LIMIT $2
            """,
            cutoff, CHECK_BATCH,
        )
    except Exception as exc:
        log.error("fetch_pending_outcomes_failed", error=str(exc))
        return {"resolved": 0, "still_pending": 0, "errors": 1}

    resolved = errors = 0
    for row in rows:
        try:
            resolution = await _try_resolve(dict(row))
            if resolution:
                await _update_outcome(pool, row["id"], resolution)
                resolved += 1
            else:
                await pool.execute(
                    "UPDATE signal_outcomes SET check_count=check_count+1, checked_at=NOW() WHERE id=$1",
                    row["id"],
                )
        except Exception as exc:
            log.warning("resolve_outcome_error", outcome_id=str(row["id"]), error=str(exc))
            errors += 1

    still_pending = len(rows) - resolved - errors
    log.info("outcomes_checked", resolved=resolved, still_pending=still_pending, errors=errors)
    return {"resolved": resolved, "still_pending": still_pending, "errors": errors}


async def _try_resolve(row: dict) -> dict | None:
    raw = row["symbol"]
    symbol = raw if raw.endswith("USDT") else raw + "USDT"  # P2.7: guard against BTCUSDTUSDT
    entry    = float(row["entry_price"])
    tp       = float(row["target_price"])
    sl       = float(row["stop_loss"])
    is_buy   = row["signal_type"] == "BUY"
    created: datetime = row["created_at"]
    if created.tzinfo is None:
        created = created.replace(tzinfo=timezone.utc)

    is_futures = row.get("scanner_mode") in ("futures", "high_confidence")
    try:
        candles = await fetch_klines(symbol, "1h", CANDLE_LIMIT, is_futures)
    except Exception as exc:
        log.debug("outcome_kline_fetch_failed", symbol=symbol, error=str(exc))
        return None

    if not candles:
        log.debug("outcome_kline_empty", symbol=symbol)
        return None

    for candle in candles:
        candle_close_time = datetime.fromtimestamp(candle.close_time / 1000, tz=timezone.utc)
        if candle_close_time <= created:
            continue

        high = candle.high
        low  = candle.low

        # Conservative: check SL first within the same candle
        if is_buy:
            if low <= sl:
                return _build_resolution(row, "SL_HIT", sl, candle_close_time)
            if high >= tp:
                return _build_resolution(row, "TP_HIT", tp, candle_close_time)
        else:
            if high >= sl:
                return _build_resolution(row, "SL_HIT", sl, candle_close_time)
            if low <= tp:
                return _build_resolution(row, "TP_HIT", tp, candle_close_time)

    # Check timeout
    hours_elapsed = (datetime.now(timezone.utc) - created).total_seconds() / 3600
    if hours_elapsed >= TIMEOUT_HOURS:
        exit_price = float(candles[-1].close) if candles else entry
        return _build_resolution(row, "TIMEOUT", exit_price, datetime.now(timezone.utc))

    return None


def _build_resolution(row: dict, outcome: str, exit_price: float, exit_time: datetime) -> dict:
    entry = float(row["entry_price"])
    sl    = float(row["stop_loss"])
    is_buy = row["signal_type"] == "BUY"
    created: datetime = row["created_at"]
    if created.tzinfo is None:
        created = created.replace(tzinfo=timezone.utc)

    price_diff   = exit_price - entry if is_buy else entry - exit_price
    risk         = abs(entry - sl)
    rr_achieved  = price_diff / risk if risk > 0 else 0.0
    pnl_pct      = (price_diff / entry) * 100 if entry > 0 else 0.0
    duration_hrs = (exit_time - created).total_seconds() / 3600

    return {
        "outcome":        outcome,
        "exit_price":     exit_price,
        "exit_time":      exit_time,
        "rr_achieved":    round(rr_achieved, 4),
        "pnl_pct":        round(pnl_pct, 4),
        "duration_hours": round(duration_hrs, 2),
    }


async def _update_outcome(pool, outcome_id: Any, resolution: dict) -> None:
    await pool.execute(
        """
        UPDATE signal_outcomes
        SET outcome=$1, exit_price=$2, exit_time=$3, rr_achieved=$4,
            pnl_pct=$5, duration_hours=$6, resolved_at=NOW(),
            checked_at=NOW(), check_count=check_count+1
        WHERE id=$7
        """,
        resolution["outcome"], resolution["exit_price"], resolution["exit_time"],
        resolution["rr_achieved"], resolution["pnl_pct"], resolution["duration_hours"],
        outcome_id,
    )


# ── Analytics computation ─────────────────────────────────────────────────────

async def get_outcomes(window_hours: int = 168) -> list[dict]:
    pool = await _pool()
    if pool is None:
        return []
    cutoff = datetime.now(timezone.utc) - timedelta(hours=window_hours)
    try:
        rows = await pool.fetch(
            """
            SELECT symbol, signal_type, timeframe, scanner_mode, confidence,
                   ai_validated, volatility_regime, risk_grade, risk_score, quality_score,
                   outcome, rr_achieved, pnl_pct, duration_hours,
                   trend_score, sector_status, breakout_type, breakout_strength,
                   oi_interpretation, funding_trend, positioning_context,
                   market_regime
            FROM signal_outcomes
            WHERE outcome != 'PENDING' AND created_at > $1
            ORDER BY created_at DESC
            """,
            cutoff,
        )
        return [dict(r) for r in rows]
    except Exception as exc:
        log.warning("get_outcomes_failed", error=str(exc))
        return []


async def get_analytics(window_hours: int = 168) -> dict:
    outcomes = await get_outcomes(window_hours)
    overall  = compute_stats(outcomes)

    def breakdown(key: str) -> dict:
        groups: dict[str, list] = {}
        for o in outcomes:
            val = str(o.get(key) or "unknown")
            groups.setdefault(val, []).append(o)
        return {k: compute_stats(v) for k, v in sorted(groups.items())}

    # AI accuracy by confidence band
    ai_accuracy: list[dict] = []
    for lo, hi in CONFIDENCE_BANDS:
        band = [o for o in outcomes if lo <= (o.get("confidence") or 0) < hi]
        if len(band) >= 3:
            ai_accuracy.append({"band": f"{lo}-{hi}", **compute_stats(band)})

    def breakdown_by_trend_tier() -> dict:
        groups: dict[str, list] = {}
        for o in outcomes:
            tier = trend_score_tier(o.get("trend_score"))
            groups.setdefault(tier, []).append(o)
        return {k: compute_stats(v) for k, v in groups.items()}

    return {
        "window_hours":               window_hours,
        "total_outcomes":             len(outcomes),
        "overall":                    overall,
        "by_mode":                    breakdown("scanner_mode"),
        "by_signal_type":             breakdown("signal_type"),
        "by_volatility":              breakdown("volatility_regime"),
        "by_risk_grade":              breakdown("risk_grade"),
        "ai_accuracy_by_confidence":  ai_accuracy,
        # ── Intelligence breakdowns (Phase 8.0.1 GAP-2) ──────────────────
        "by_market_regime":           breakdown("market_regime"),   # Phase 8.1B
        "by_trend_score_tier":        breakdown_by_trend_tier(),
        "by_sector_status":           breakdown("sector_status"),
        "by_breakout_type":           breakdown("breakout_type"),
        "by_breakout_strength":       breakdown("breakout_strength"),
        "by_oi_interpretation":       breakdown("oi_interpretation"),
        "by_funding_trend":           breakdown("funding_trend"),
        "by_positioning_context":     breakdown("positioning_context"),
    }


# ── Intelligence calibration summary (GAP-5) ─────────────────────────────────

_INTEL_MIN_SAMPLES = 10  # tiers with fewer samples are suppressed (unreliable stats)


async def get_intelligence_summary(window_hours: int = 720) -> dict:
    """Best-performing intelligence tier per dimension from resolved outcomes."""
    outcomes = await get_outcomes(window_hours)
    if not outcomes:
        return {"insufficient_data": True, "total": 0, "window_hours": window_hours}

    total = len(outcomes)

    def _dim_stats(key: str, get_label=None) -> dict:
        """Return best-tier stats + null_count/null_pct for one intelligence dimension."""
        groups: dict[str, list] = {}
        null_count = 0
        for o in outcomes:
            raw = o.get(key)
            label = get_label(raw) if get_label else (str(raw) if raw is not None else None)
            if label is None or label == "N/A":
                null_count += 1
                continue
            groups.setdefault(label, []).append(o)

        best: dict | None = None
        best_wr = -1.0
        for name, rows in groups.items():
            if len(rows) < _INTEL_MIN_SAMPLES:
                continue
            stats = compute_stats(rows)
            wr = stats.get("win_rate") or 0.0
            if wr > best_wr:
                best_wr = wr
                best = {"label": name, "n": len(rows), **stats}

        return {
            "best":      best,
            "null_count": null_count,
            "null_pct":  round(null_count / total * 100, 1) if total else 0.0,
            "note":      f"{null_count}/{total} signals have no {key} data" if null_count else None,
        }

    dims = {
        "trend_score_tier":         _dim_stats("trend_score", get_label=lambda v: trend_score_tier(v) if v is not None else None),
        "sector_status":            _dim_stats("sector_status"),
        "breakout_type":            _dim_stats("breakout_type"),
        "breakout_strength":        _dim_stats("breakout_strength"),
        "oi_interpretation":        _dim_stats("oi_interpretation"),
        "funding_trend":            _dim_stats("funding_trend"),
        "positioning_context":      _dim_stats("positioning_context"),
    }
    # Backward-compatible flat keys consumed by the frontend
    flat = {f"best_{k}": v["best"] for k, v in dims.items()}
    return {
        "total":             total,
        "window_hours":      window_hours,
        "insufficient_data": False,
        "min_samples":       _INTEL_MIN_SAMPLES,
        **flat,
        "null_stats":        {k: {"null_count": v["null_count"], "null_pct": v["null_pct"], "note": v["note"]} for k, v in dims.items()},
    }
