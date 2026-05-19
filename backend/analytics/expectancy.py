"""
Pure mathematical functions for computing trading performance metrics.
No I/O — deterministic calculations only.
"""
from __future__ import annotations

import math
from typing import Sequence


def win_rate(wins: int, total: int) -> float:
    return wins / total if total > 0 else 0.0


def expectancy(win_rrs: Sequence[float], loss_rrs: Sequence[float]) -> float:
    """E = (win_rate × avg_win_R) − (loss_rate × avg_loss_R)"""
    total = len(win_rrs) + len(loss_rrs)
    if total == 0:
        return 0.0
    wr = len(win_rrs) / total
    lr = len(loss_rrs) / total
    avg_win  = sum(win_rrs)  / len(win_rrs)  if win_rrs  else 0.0
    avg_loss = abs(sum(loss_rrs) / len(loss_rrs)) if loss_rrs else 0.0
    return wr * avg_win - lr * avg_loss


def profit_factor(win_rrs: Sequence[float], loss_rrs: Sequence[float]) -> float:
    gross_profit = sum(win_rrs)
    gross_loss   = abs(sum(loss_rrs))
    return gross_profit / gross_loss if gross_loss > 0 else float("inf")


def max_drawdown(rr_sequence: Sequence[float]) -> float:
    """Maximum peak-to-trough decline in cumulative R."""
    peak = cum = dd = 0.0
    for r in rr_sequence:
        cum += r
        if cum > peak:
            peak = cum
        drawdown = peak - cum
        if drawdown > dd:
            dd = drawdown
    return dd


def sharpe_ratio(rr_sequence: Sequence[float], avg_duration_hours: float) -> float:
    """Annualised Sharpe using R-per-trade and average holding time."""
    n = len(rr_sequence)
    if n < 2 or avg_duration_hours <= 0:
        return 0.0
    avg      = sum(rr_sequence) / n
    variance = sum((r - avg) ** 2 for r in rr_sequence) / (n - 1)
    std      = math.sqrt(variance) if variance > 0 else 0.0
    if std == 0:
        return 0.0
    trades_per_year = 8760 / avg_duration_hours
    return (avg / std) * math.sqrt(trades_per_year)


def compute_stats(outcomes: list[dict]) -> dict:
    """
    Compute all performance metrics from a list of resolved outcome dicts.
    Each dict needs: rr_achieved (float), outcome ('TP_HIT'|'SL_HIT'|'TIMEOUT'),
                     duration_hours (float).
    """
    resolved = [o for o in outcomes if o.get("outcome") in ("TP_HIT", "SL_HIT", "TIMEOUT")]
    total = len(resolved)
    if total == 0:
        return _empty_stats()

    tp_count      = sum(1 for o in resolved if o.get("outcome") == "TP_HIT")
    sl_count      = sum(1 for o in resolved if o.get("outcome") == "SL_HIT")
    timeout_count = sum(1 for o in resolved if o.get("outcome") == "TIMEOUT")

    win_rrs  = [float(o["rr_achieved"]) for o in resolved if o.get("outcome") == "TP_HIT"
                and o.get("rr_achieved") is not None]
    loss_rrs = [float(o["rr_achieved"]) for o in resolved if o.get("outcome") in ("SL_HIT", "TIMEOUT")
                and o.get("rr_achieved") is not None]
    all_rrs  = [float(o["rr_achieved"]) for o in resolved if o.get("rr_achieved") is not None]
    durations = [float(o["duration_hours"]) for o in resolved if o.get("duration_hours") is not None]

    avg_duration = sum(durations) / len(durations) if durations else 0.0

    pf = profit_factor(win_rrs, loss_rrs)

    return {
        "total_signals":    total,
        "tp_hits":          tp_count,
        "sl_hits":          sl_count,
        "timeouts":         timeout_count,
        "win_rate":         round(win_rate(tp_count, total), 4),
        "tp_rate":          round(tp_count / total, 4),
        "sl_rate":          round(sl_count / total, 4),
        "timeout_rate":     round(timeout_count / total, 4),
        "avg_rr_achieved":  round(sum(all_rrs) / len(all_rrs), 4) if all_rrs else 0.0,
        "avg_win_rr":       round(sum(win_rrs)  / len(win_rrs),  4) if win_rrs  else 0.0,
        "avg_loss_rr":      round(sum(loss_rrs) / len(loss_rrs), 4) if loss_rrs else 0.0,
        "expectancy":       round(expectancy(win_rrs, loss_rrs), 4),
        "profit_factor":    round(pf, 4) if pf != float("inf") else None,
        "max_drawdown_r":   round(max_drawdown(all_rrs), 4),
        "sharpe_ratio":     round(sharpe_ratio(all_rrs, avg_duration), 4),
        "avg_duration_hours": round(avg_duration, 2),
    }


def _empty_stats() -> dict:
    return {
        "total_signals": 0, "tp_hits": 0, "sl_hits": 0, "timeouts": 0,
        "win_rate": 0.0, "tp_rate": 0.0, "sl_rate": 0.0, "timeout_rate": 0.0,
        "avg_rr_achieved": 0.0, "avg_win_rr": 0.0, "avg_loss_rr": 0.0,
        "expectancy": 0.0, "profit_factor": 0.0, "max_drawdown_r": 0.0,
        "sharpe_ratio": 0.0, "avg_duration_hours": 0.0,
    }
