"""
Operational monitoring — daily metric counters, threshold evaluation, anomaly detection.

Tracks signals, Claude usage, Redis commands, Binance failures, and Telegram sends
using lightweight Redis INCR counters (daily keys, 48h TTL).

Thresholds define Healthy / Warning / Critical bands for each metric.
Anomalies are generated for: Redis spikes, Claude fallback spikes,
Binance failure spikes, zero-signal days, slow scans.
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

from backend.logging.setup import get_logger

log = get_logger(__name__)

_PREFIX = "monitor"
_TTL    = 48 * 3600   # 48h — covers today + yesterday


def _today() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def _key(metric: str, day: str | None = None) -> str:
    return f"{_PREFIX}:{day or _today()}:{metric}"


# ── Redis counter helpers ─────────────────────────────────────────────────────

# R4: Quota snapshot is written once per hour.  The 7-day rolling average it
# feeds uses daily granularity, so writing on every monitoring call (~60s) is
# pure waste.  A dict is used instead of globals to avoid 'global' statements.
_snapshot_write_state: dict = {"hour": -1, "date": ""}

# R5: Track keys that already have their TTL set; skip EXPIRE on subsequent
# calls.  Keys include today's date, so new-day keys automatically miss the
# set and get their TTL on first write.  At most ~5 entries grow per day
# (signals, scans, coins_scanned, telegram_sends, binance_errors).
_initialized_keys: set[str] = set()


async def _incr(metric: str, amount: int = 1) -> None:
    try:
        from backend.cache.redis_cache import get_redis
        redis = await get_redis()
        key   = _key(metric)
        pipe  = redis.pipeline()
        pipe.incrby(key, amount)
        if key not in _initialized_keys:
            pipe.expire(key, _TTL)
            _initialized_keys.add(key)
        await pipe.execute()
    except Exception as exc:
        log.debug("monitor_incr_failed", metric=metric, error=str(exc))


async def _read(metric: str, day: str | None = None) -> int:
    try:
        from backend.cache.redis_cache import get_redis
        redis = await get_redis()
        raw   = await redis.get(_key(metric, day))
        return int(raw) if raw else 0
    except Exception:
        return 0


# ── Public increment API (fire-and-forget safe) ───────────────────────────────

async def _read_db_generated_signals_24h(now: datetime) -> int | None:
    """Database truth for generated signal count; Redis is only a fallback."""
    try:
        from backend.database.session import get_pool
        pool = await get_pool()
        value = await pool.fetchval(
            """
            SELECT COUNT(*)
            FROM signals
            WHERE created_at > $1
            """,
            now - timedelta(hours=24),
        )
        return int(value or 0)
    except Exception as exc:
        log.warning("monitor_db_signal_count_failed", error=str(exc))
        return None


async def record_signal() -> None:
    await _incr("signals")

async def record_scan(coins_scanned: int, duration_ms: int) -> None:
    await _incr("scans")
    await _incr("coins_scanned", coins_scanned)
    try:
        from backend.cache.redis_cache import get_redis
        redis = await get_redis()
        await redis.setex(f"{_PREFIX}:last_scan_duration_ms", 3_600, str(duration_ms))
        # R1: scan_durations list removed — key was written but never read anywhere.
        # last_scan_duration_ms (scalar above) is the only duration value consumed by
        # get_monitoring_snapshot() and the dashboard.
    except Exception as exc:
        log.warning("monitor_record_scan_duration_failed", error=str(exc))

async def record_telegram_send() -> None:
    await _incr("telegram_sends")

async def record_binance_error() -> None:
    await _incr("binance_errors")


# ── Threshold definitions ─────────────────────────────────────────────────────
# For "inverted" metrics (lower is better), healthy ≤ warning ≤ critical.
# For "normal" metrics (higher is better), healthy ≥ warning ≥ critical.

THRESHOLDS: dict[str, dict] = {
    # (higher is better)
    "signals_per_day":         {"healthy": 1,     "warning": 0,       "critical": -1,      "inverted": False},
    "win_rate_pct":            {"healthy": 42.0,  "warning": 33.0,    "critical": 20.0,    "inverted": False},
    "coins_scanned_per_run":   {"healthy": 50,    "warning": 20,      "critical": 5,       "inverted": False},
    # (lower is better)
    "sl_rate_pct":             {"healthy": 60.0,  "warning": 80.0,    "critical": 95.0,    "inverted": True},
    "claude_fallback_pct":     {"healthy": 20.0,  "warning": 50.0,    "critical": 80.0,    "inverted": True},
    "claude_calls_per_day":    {"healthy": 200,   "warning": 400,     "critical": 600,     "inverted": True},
    "binance_errors_per_day":  {"healthy": 5,     "warning": 15,      "critical": 30,      "inverted": True},
    "cmc_credits_per_day":     {"healthy": 800,   "warning": 1_500,   "critical": 2_500,   "inverted": True},
    "telegram_sends_per_day":  {"healthy": 50,    "warning": 100,     "critical": 200,     "inverted": True},
    "scan_duration_s":         {"healthy": 600,   "warning": 900,     "critical": 1_020,   "inverted": True},
}


def _level(metric: str, value: float) -> str:
    t = THRESHOLDS.get(metric)
    if not t:
        return "healthy"
    h, w, c, inv = t["healthy"], t["warning"], t["critical"], t["inverted"]
    if inv:
        if value <= h: return "healthy"
        if value <= w: return "warning"
        return "critical"
    else:
        if value >= h: return "healthy"
        if value >= w: return "warning"
        return "critical"


def _entry(metric: str, value: float, unit: str = "") -> dict:
    return {"value": value, "unit": unit, "level": _level(metric, value)}


# ── Main snapshot ─────────────────────────────────────────────────────────────

async def get_monitoring_snapshot() -> dict:
    """Build today's full operational monitoring snapshot."""
    today = _today()
    now   = datetime.now(timezone.utc)

    # Daily counters. Generated signals are DB-authoritative; Redis is a fallback only.
    redis_signals  = await _read("signals")
    db_signals     = await _read_db_generated_signals_24h(now)
    signals        = db_signals if db_signals is not None else redis_signals
    signals_source = "database" if db_signals is not None else "redis_fallback"
    scans        = await _read("scans")
    coins_total  = await _read("coins_scanned")
    tg_sends     = await _read("telegram_sends")
    binance_errs = await _read("binance_errors")

    avg_coins_per_run = round(coins_total / scans) if scans > 0 else 0

    # Last scan duration
    last_duration_s = 0
    try:
        from backend.cache.redis_cache import get_redis
        redis          = await get_redis()
        raw            = await redis.get(f"{_PREFIX}:last_scan_duration_ms")
        last_duration_s = round(int(raw or 0) / 1000)
    except Exception as exc:
        log.warning("monitor_read_scan_duration_failed", error=str(exc))

    # Claude/heuristic from ai_call_log
    claude_calls = heuristic_calls = fallback_pct = 0.0
    estimated_cost_usd = 0.0
    try:
        from backend.analytics.ai_metrics import get_ai_summary
        ai              = await get_ai_summary(window_hours=24)
        claude_calls    = ai.get("claude_calls", 0)
        heuristic_calls = ai.get("heuristic_calls", 0)
        fallback_pct    = round(ai.get("fallback_rate", 0) * 100, 1)
        estimated_cost_usd = ai.get("estimated_cost_usd", 0.0)
    except Exception as exc:
        log.warning("monitor_read_ai_metrics_failed", error=str(exc))

    # CMC credits — 7-day rolling daily average using daily snapshots
    cmc_credits_day = 0
    try:
        from backend.cache.redis_cache import get_redis
        redis = await get_redis()
        raw   = await redis.get("intel:quota:used")
        cmc_month = int(raw or 0)

        # Store today's snapshot so rolling history accumulates (8d TTL).
        # R4: only write once per hour — daily granularity is all the rolling
        # average needs; writing on every dashboard poll is pure waste.
        if _snapshot_write_state["date"] != today or _snapshot_write_state["hour"] != now.hour:
            await redis.set(f"intel:quota:snapshot:{today}", str(cmc_month), ex=8 * 24 * 3600)
            _snapshot_write_state["date"] = today
            _snapshot_write_state["hour"] = now.hour

        # Find the oldest available daily snapshot within the last 7 days
        oldest_val, oldest_days = None, 0
        for days_back in range(7, 0, -1):
            day = (now.date() - timedelta(days=days_back)).isoformat()
            snap = await redis.get(f"intel:quota:snapshot:{day}")
            if snap is not None:
                oldest_val = int(snap)
                oldest_days = days_back
                break

        if oldest_val is not None and oldest_days > 0:
            cmc_credits_day = max(0, round((cmc_month - oldest_val) / oldest_days))
        else:
            # No rolling history yet — fall back to month-to-date average
            cmc_credits_day = round(cmc_month / max(now.day, 1))
    except Exception as exc:
        log.warning("monitor_read_cmc_credits_failed", error=str(exc))

    # 7-day win/SL rate from signal_outcomes
    win_rate_pct = sl_rate_pct = 0.0
    resolved_7d  = 0
    try:
        from backend.database.session import get_pool
        pool = await get_pool()
        row  = await pool.fetchrow("""
            SELECT
              COUNT(*) FILTER (WHERE outcome = 'TP_HIT') AS tp,
              COUNT(*) FILTER (WHERE outcome = 'SL_HIT') AS sl,
              COUNT(*) FILTER (WHERE outcome != 'PENDING') AS total
            FROM signal_outcomes
            WHERE created_at > NOW() - INTERVAL '7 days'
        """)
        if row and row["total"]:
            resolved_7d  = row["total"]
            win_rate_pct = round(row["tp"] / row["total"] * 100, 1)
            sl_rate_pct  = round(row["sl"] / row["total"] * 100, 1)
    except Exception as exc:
        log.warning("monitor_read_outcome_rates_failed", error=str(exc))

    metrics = {
        "signals_per_day": {
            **_entry("signals_per_day", signals, "signals"),
            "source": signals_source,
            "window_hours": 24,
        },
        "win_rate_pct":           _entry("win_rate_pct",           win_rate_pct,     "%"),
        "sl_rate_pct":            _entry("sl_rate_pct",            sl_rate_pct,      "%"),
        "scans_today":            {"value": scans,            "unit": "scans",   "level": "healthy"},
        "coins_scanned_per_run":  _entry("coins_scanned_per_run",  avg_coins_per_run, "coins"),
        "scan_duration_s":        _entry("scan_duration_s",        last_duration_s,  "s"),
        "claude_calls_per_day":   _entry("claude_calls_per_day",   claude_calls,     "calls"),
        "heuristic_calls_per_day": {"value": heuristic_calls, "unit": "calls",   "level": "healthy"},
        "claude_fallback_pct":    _entry("claude_fallback_pct",    fallback_pct,     "%"),
        "estimated_cost_usd":     {"value": estimated_cost_usd, "unit": "USD",  "level": "healthy"},
        "cmc_credits_per_day":    _entry("cmc_credits_per_day",    cmc_credits_day,  "credits"),
        "telegram_sends_per_day": _entry("telegram_sends_per_day", tg_sends,         "sends"),
        "binance_errors_per_day": _entry("binance_errors_per_day", binance_errs,     "errors"),
        "resolved_7d":            {"value": resolved_7d,     "unit": "outcomes","level": "healthy"},
    }

    # Overall level: worst wins
    order  = {"critical": 3, "warning": 2, "healthy": 1}
    worst  = max((m.get("level", "healthy") for m in metrics.values()), key=lambda l: order.get(l, 0))

    anomalies = _detect_anomalies(now, signals, fallback_pct, binance_errs, last_duration_s)

    return {
        "date":          today,
        "overall_level": worst,
        "metrics":       metrics,
        "anomalies":     anomalies,
        "thresholds":    THRESHOLDS,
        "generated_at":  now.isoformat(),
        "data_windows": {
            "signals_per_day": "rolling_24h_database_truth",
            "outcomes": "rolling_7d_database_truth",
            "redis_counters": "utc_day_fallback",
        },
    }


# ── Anomaly detection ─────────────────────────────────────────────────────────

def _detect_anomalies(
    now: datetime,
    signals: int,
    fallback_pct: float,
    binance_errs: int,
    last_duration_s: int,
) -> list[dict]:
    anomalies: list[dict] = []
    hour = now.hour

    # Zero-signal day (skip first 2 hours — scanner may not have run yet)
    if signals == 0 and hour >= 2:
        anomalies.append({
            "type":     "zero_signals",
            "severity": "warning" if hour < 8 else "critical",
            "message":  f"0 signals generated today (UTC {hour:02d}:xx) — scanner may be paused or all signals rejected",
        })

    # Claude fallback spike
    if fallback_pct >= 50:
        anomalies.append({
            "type":     "claude_fallback_spike",
            "severity": "warning" if fallback_pct < 80 else "critical",
            "message":  f"Claude fallback rate is {fallback_pct:.0f}% — check ANTHROPIC_API_KEY and daily quota",
        })

    # Binance error spike
    if binance_errs >= 15:
        anomalies.append({
            "type":     "binance_error_spike",
            "severity": "warning" if binance_errs < 30 else "critical",
            "message":  f"{binance_errs} Binance errors today — klines degraded, check connectivity and geo-blocking",
        })

    # Slow scan
    if last_duration_s >= 900:
        anomalies.append({
            "type":     "slow_scan",
            "severity": "warning" if last_duration_s < 1_020 else "critical",
            "message":  f"Last scan took {last_duration_s}s — approaching soft_time_limit (1020s)",
        })

    return anomalies
