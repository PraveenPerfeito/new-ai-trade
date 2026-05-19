"""
Statistical utilities for edge validation and calibration analysis.

All functions are pure (no I/O) and return plain Python scalars / dicts.
"""
from __future__ import annotations

import math

MIN_SAMPLES = 10    # below this, results are unreliable
WARN_SAMPLES = 30   # below this, treat with caution


# ── Confidence intervals ──────────────────────────────────────────────────────

def wilson_ci(successes: int, n: int, z: float = 1.96) -> tuple[float, float]:
    """
    95% Wilson score confidence interval for a proportion.
    More reliable than the normal approximation for small n or extreme p.
    Returns (lower, upper) both in [0, 1].
    """
    if n == 0:
        return (0.0, 1.0)
    p    = successes / n
    z2   = z * z
    denom  = 1 + z2 / n
    center = (p + z2 / (2 * n)) / denom
    spread = z * math.sqrt(p * (1 - p) / n + z2 / (4 * n * n)) / denom
    return (round(max(0.0, center - spread), 4), round(min(1.0, center + spread), 4))


def mean_ci(values: list[float], z: float = 1.96) -> tuple[float, float] | None:
    """
    95% CI for a population mean (normal approximation).
    Returns None if n < 2.
    """
    n = len(values)
    if n < 2:
        return None
    mu  = sum(values) / n
    var = sum((x - mu) ** 2 for x in values) / (n - 1)
    se  = math.sqrt(var / n)
    return (round(mu - z * se, 4), round(mu + z * se, 4))


# ── Two-proportion z-test ─────────────────────────────────────────────────────

def two_prop_z(s1: int, n1: int, s2: int, n2: int) -> tuple[float, bool]:
    """
    Two-proportion z-test (H0: p1 == p2).
    Returns (z_score, is_significant_at_95pct).
    Requires n1, n2 >= 5.
    """
    if n1 < 5 or n2 < 5:
        return (0.0, False)
    p1     = s1 / n1
    p2     = s2 / n2
    p_pool = (s1 + s2) / (n1 + n2)
    if p_pool <= 0 or p_pool >= 1:
        return (0.0, False)
    se = math.sqrt(p_pool * (1 - p_pool) * (1 / n1 + 1 / n2))
    if se == 0:
        return (0.0, False)
    z = (p1 - p2) / se
    return (round(z, 3), abs(z) >= 1.96)


# ── Calibration metrics ───────────────────────────────────────────────────────

def expected_calibration_error(bands: list[dict]) -> float:
    """
    ECE = Σ (n_i / N) × |actual_win_rate_i − expected_win_rate_i|

    Each band dict must have: total, win_rate (actual), expected_win_rate (fraction).
    """
    total = sum(b.get("total", 0) for b in bands)
    if total == 0:
        return 0.0
    ece = 0.0
    for b in bands:
        n   = b.get("total", 0)
        wr  = b.get("win_rate")
        exp = b.get("expected_win_rate")
        if n == 0 or wr is None or exp is None:
            continue
        ece += (n / total) * abs(wr - exp)
    return round(ece, 4)


def calibration_label(ece: float) -> str:
    """Human-readable calibration quality from ECE score."""
    if ece < 0.05:
        return "well_calibrated"
    if ece < 0.12:
        return "moderately_calibrated"
    return "poorly_calibrated"


def reliability_score(ece: float) -> float:
    """Map ECE to a 0-100 reliability score. Higher = better calibrated."""
    return round(max(0.0, 100 * (1 - ece / 0.25)), 1)


# ── Sample-size utilities ─────────────────────────────────────────────────────

def sample_warning(n: int) -> str | None:
    if n < MIN_SAMPLES:
        return f"Insufficient data ({n} samples) — results not statistically reliable"
    if n < WARN_SAMPLES:
        return f"Small sample ({n} samples) — treat with caution"
    return None


def has_data(n: int) -> bool:
    return n >= MIN_SAMPLES


# ── Descriptive stats helpers ─────────────────────────────────────────────────

def safe_mean(values: list[float]) -> float | None:
    return round(sum(values) / len(values), 4) if values else None


def safe_median(values: list[float]) -> float | None:
    if not values:
        return None
    s = sorted(values)
    n = len(s)
    mid = n // 2
    return round(s[mid] if n % 2 else (s[mid - 1] + s[mid]) / 2, 4)


def percentile(values: list[float], p: float) -> float | None:
    """Return the p-th percentile (0-100) using nearest rank."""
    if not values:
        return None
    s = sorted(values)
    idx = max(0, min(len(s) - 1, int(math.ceil(p / 100 * len(s))) - 1))
    return round(s[idx], 4)


def running_max_drawdown(rr_series: list[float]) -> float:
    """Max peak-to-trough drawdown on a cumulative-R series. Peak starts at 0."""
    peak = 0.0
    cumulative = 0.0
    max_dd = 0.0
    for r in rr_series:
        cumulative += r
        if cumulative > peak:
            peak = cumulative
        dd = peak - cumulative
        if dd > max_dd:
            max_dd = dd
    return round(max_dd, 4)


def profit_factor(wins: list[float], losses: list[float]) -> float | None:
    """Gross wins / gross losses. None if no losses (infinite)."""
    gross_win  = sum(w for w in wins if w > 0)
    gross_loss = abs(sum(l for l in losses if l < 0))
    if gross_loss == 0:
        return None   # infinite PF — serialise as None
    return round(gross_win / gross_loss, 4)


def sharpe(rr_series: list[float], avg_duration_hours: float) -> float | None:
    """Annualised Sharpe on an R-series. Returns None if std == 0 or n < 2."""
    n = len(rr_series)
    if n < 2 or avg_duration_hours <= 0:
        return None
    mu  = sum(rr_series) / n
    var = sum((x - mu) ** 2 for x in rr_series) / (n - 1)
    std = math.sqrt(var)
    if std == 0:
        return None
    trades_per_year = 8760 / avg_duration_hours
    return round((mu / std) * math.sqrt(trades_per_year), 3)


# ── Group stats builder ───────────────────────────────────────────────────────

def group_stats(rows: list[dict], *, label: str = "") -> dict:
    """
    Compute full statistics from a list of resolved outcome rows.
    Each row must have: outcome (str), rr_achieved (float | None),
    duration_hours (float | None).
    """
    resolved = [r for r in rows if r.get("outcome") not in (None, "PENDING")]
    n        = len(resolved)

    if n == 0:
        return {"label": label, "total": 0, "insufficient_data": True}

    tp_rows   = [r for r in resolved if r["outcome"] == "TP_HIT"]
    sl_rows   = [r for r in resolved if r["outcome"] == "SL_HIT"]
    to_rows   = [r for r in resolved if r["outcome"] == "TIMEOUT"]

    tp_hits = len(tp_rows)
    sl_hits = len(sl_rows)
    timeouts = len(to_rows)

    rr_values = [float(r["rr_achieved"]) for r in resolved if r.get("rr_achieved") is not None]
    win_rr    = [r for r in rr_values if r > 0]
    loss_rr   = [r for r in rr_values if r < 0]
    durations = [float(r["duration_hours"]) for r in resolved if r.get("duration_hours") is not None]

    wr     = tp_hits / n
    ci_lo, ci_hi = wilson_ci(tp_hits, n)
    exp    = safe_mean(rr_values)
    pf     = profit_factor(win_rr, loss_rr)
    avg_dur = safe_mean(durations) or 24.0
    sh     = sharpe(rr_values, avg_dur)
    mdd    = running_max_drawdown(rr_values)

    warn = sample_warning(n)
    return {
        "label":           label,
        "total":           n,
        "tp_hits":         tp_hits,
        "sl_hits":         sl_hits,
        "timeouts":        timeouts,
        "win_rate":        round(wr, 4),
        "win_rate_ci":     [ci_lo, ci_hi],
        "expectancy":      exp,
        "profit_factor":   pf,
        "max_drawdown_r":  mdd,
        "sharpe_ratio":    sh,
        "avg_rr_achieved": safe_mean(rr_values),
        "p25_rr":          percentile(rr_values, 25),
        "p75_rr":          percentile(rr_values, 75),
        "avg_duration_hours": round(avg_dur, 1),
        "insufficient_data": n < MIN_SAMPLES,
        "warning":         warn,
    }
