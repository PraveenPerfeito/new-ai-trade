"""
Burn-in anomaly detector — pure threshold-based logic.

All functions are stateless (no I/O). They take pre-computed metric dicts
and return Anomaly instances.  The caller (burn_in.py) is responsible for
fetching the underlying data and persisting results.

Severity levels:
  info     — worth knowing, no action required
  warning  — investigate; may need threshold adjustment
  critical — requires immediate attention

Anomaly types:
  Signal quality:
    win_rate_degradation  — 7d win rate drops significantly vs 30d baseline
    expectancy_negative   — rolling expectancy turns negative
    false_positive_spike  — SL hit rate abnormally high
    drawdown_spike        — max drawdown exceeds warning level
    calibration_drift     — ECE increases or exceeds threshold

  Operational:
    scan_failure_spike    — scan error rate above threshold
    ai_error_spike        — Claude API error rate above threshold
    queue_backlog         — Celery queue depth above threshold
    no_recent_scans       — scanner appears stalled
"""
from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timezone

# ── Thresholds ────────────────────────────────────────────────────────────────

# Signal quality
WIN_RATE_DROP_WARN     = 0.12   # 12 pp drop in 7d vs 30d baseline
WIN_RATE_DROP_CRIT     = 0.25   # 25 pp drop
FALSE_POSITIVE_WARN    = 0.70   # 70%+ SL hit rate
EXPECTANCY_CRIT        = 0.0    # any negative expectancy (n>=20)
DRAWDOWN_WARN          = 5.0    # 5R drawdown
DRAWDOWN_CRIT          = 10.0   # 10R drawdown
ECE_WARN               = 0.12
ECE_CRIT               = 0.20
ECE_DRIFT_THRESHOLD    = 0.05   # ECE increase vs previous snapshot

# Operational
SCAN_FAILURE_WARN      = 0.15
SCAN_FAILURE_CRIT      = 0.30
AI_ERROR_WARN          = 0.08
AI_ERROR_CRIT          = 0.15
AI_FALLBACK_WARN       = 0.40   # 40% fallback rate (Claude often failing)
QUEUE_DEPTH_WARN       = 10
QUEUE_DEPTH_CRIT       = 30


# ── Runtime threshold overrides ───────────────────────────────────────────────

_active: dict = {}


def configure(thresholds: dict) -> None:
    """Hot-swap thresholds from AnomalySettings without restarting."""
    global _active
    _active = dict(thresholds)


def _g(key: str, fallback):
    return _active.get(key, fallback)


# ── Data class ────────────────────────────────────────────────────────────────

@dataclass
class Anomaly:
    anomaly_type:  str
    severity:      str           # "info" | "warning" | "critical"
    description:   str
    metric_value:  float | None
    threshold:     float | None
    detected_at:   str = ""

    def __post_init__(self):
        if not self.detected_at:
            self.detected_at = datetime.now(timezone.utc).isoformat()

    def to_dict(self) -> dict:
        return asdict(self)


# ── Signal quality checks ─────────────────────────────────────────────────────

def check_win_rate_degradation(stats_7d: dict, stats_30d: dict) -> Anomaly | None:
    """Detect significant win-rate drop in 7d vs 30d baseline."""
    wr_7d  = stats_7d.get("win_rate")
    wr_30d = stats_30d.get("win_rate")
    if wr_7d is None or wr_30d is None:
        return None
    if stats_7d.get("total", 0) < 10 or stats_30d.get("total", 0) < 10:
        return None

    drop = wr_30d - wr_7d
    if drop >= _g('win_rate_drop_crit', WIN_RATE_DROP_CRIT):
        return Anomaly(
            anomaly_type="win_rate_degradation",
            severity="critical",
            description=(
                f"Win rate severely degraded: {wr_7d:.1%} (7d) vs {wr_30d:.1%} (30d). "
                f"Drop of {drop:.1%}. Edge may be lost."
            ),
            metric_value=round(drop, 4),
            threshold=_g('win_rate_drop_crit', WIN_RATE_DROP_CRIT),
        )
    if drop >= _g('win_rate_drop_warn', WIN_RATE_DROP_WARN):
        return Anomaly(
            anomaly_type="win_rate_degradation",
            severity="warning",
            description=(
                f"Win rate degraded: {wr_7d:.1%} (7d) vs {wr_30d:.1%} (30d). "
                f"Drop of {drop:.1%}."
            ),
            metric_value=round(drop, 4),
            threshold=_g('win_rate_drop_warn', WIN_RATE_DROP_WARN),
        )
    return None


def check_expectancy_negative(stats: dict, window_label: str = "7d") -> Anomaly | None:
    """Detect when rolling expectancy turns negative."""
    exp   = stats.get("expectancy")
    total = stats.get("total", 0)
    if exp is None or total < 20:
        return None

    if exp < _g('expectancy_crit', EXPECTANCY_CRIT):
        sev = "critical" if exp < -0.3 else "warning"
        return Anomaly(
            anomaly_type="expectancy_negative",
            severity=sev,
            description=(
                f"Expectancy negative at {exp:+.2f}R ({window_label} window, n={total}). "
                "Edge may be lost — review recent signal quality."
            ),
            metric_value=round(exp, 4),
            threshold=_g('expectancy_crit', EXPECTANCY_CRIT),
        )
    return None


def check_false_positive_spike(stats: dict) -> Anomaly | None:
    """Detect abnormally high SL hit rate (too many false positives)."""
    total   = stats.get("total", 0)
    sl_hits = stats.get("sl_hits", 0)
    if total < 10:
        return None

    sl_rate = sl_hits / total
    if sl_rate > _g('false_positive_warn', FALSE_POSITIVE_WARN):
        return Anomaly(
            anomaly_type="false_positive_spike",
            severity="warning",
            description=(
                f"High false-positive rate: {sl_rate:.1%} of signals hit SL "
                f"({sl_hits}/{total} in window)."
            ),
            metric_value=round(sl_rate, 4),
            threshold=_g('false_positive_warn', FALSE_POSITIVE_WARN),
        )
    return None


def check_drawdown_spike(stats: dict) -> Anomaly | None:
    """Detect unusually large cumulative drawdown."""
    mdd = stats.get("max_drawdown_r")
    if mdd is None:
        return None

    if mdd >= _g('drawdown_crit', DRAWDOWN_CRIT):
        return Anomaly(
            anomaly_type="drawdown_spike",
            severity="critical",
            description=f"Extreme drawdown: {mdd:.1f}R. Review position sizing and filters.",
            metric_value=round(mdd, 2),
            threshold=_g('drawdown_crit', DRAWDOWN_CRIT),
        )
    if mdd >= _g('drawdown_warn', DRAWDOWN_WARN):
        return Anomaly(
            anomaly_type="drawdown_spike",
            severity="warning",
            description=f"Elevated drawdown: {mdd:.1f}R. Monitor closely.",
            metric_value=round(mdd, 2),
            threshold=_g('drawdown_warn', DRAWDOWN_WARN),
        )
    return None


def check_calibration_drift(
    calibration: dict,
    previous_calibration: dict | None = None,
) -> Anomaly | None:
    """Detect high ECE or ECE drift vs previous snapshot."""
    ece = calibration.get("calibration", {}).get("ece")
    if ece is None:
        return None

    if ece >= _g('ece_crit', ECE_CRIT):
        return Anomaly(
            anomaly_type="calibration_drift",
            severity="critical",
            description=(
                f"Confidence calibration is poor (ECE={ece:.3f}). "
                "Actual win rates diverge significantly from reported confidence. "
                "Recalibration required."
            ),
            metric_value=round(ece, 4),
            threshold=_g('ece_crit', ECE_CRIT),
        )
    if ece >= _g('ece_warn', ECE_WARN):
        return Anomaly(
            anomaly_type="calibration_drift",
            severity="warning",
            description=f"Confidence calibration is moderately poor (ECE={ece:.3f}).",
            metric_value=round(ece, 4),
            threshold=_g('ece_warn', ECE_WARN),
        )
    # Check drift from previous snapshot
    if previous_calibration:
        prev_ece = previous_calibration.get("calibration", {}).get("ece")
        if prev_ece is not None and (ece - prev_ece) >= _g('ece_drift_threshold', ECE_DRIFT_THRESHOLD):
            return Anomaly(
                anomaly_type="calibration_drift",
                severity="info",
                description=(
                    f"ECE drifting upward: {prev_ece:.3f} → {ece:.3f} "
                    f"(+{ece - prev_ece:.3f}). Monitor for further degradation."
                ),
                metric_value=round(ece - prev_ece, 4),
                threshold=_g('ece_drift_threshold', ECE_DRIFT_THRESHOLD),
            )
    return None


# ── Operational checks ────────────────────────────────────────────────────────

def check_scan_failure_spike(scan_summary: dict) -> Anomaly | None:
    """Detect elevated scan failure rate."""
    rate  = scan_summary.get("failure_rate")
    total = scan_summary.get("total_scans", 0)
    if rate is None or total < 2:
        return None

    if rate >= _g('scan_failure_crit', SCAN_FAILURE_CRIT):
        return Anomaly(
            anomaly_type="scan_failure_spike",
            severity="critical",
            description=f"Scan failure rate critical: {rate:.1%} ({total} scans). Check workers and external APIs.",
            metric_value=round(rate, 4),
            threshold=_g('scan_failure_crit', SCAN_FAILURE_CRIT),
        )
    if rate >= _g('scan_failure_warn', SCAN_FAILURE_WARN):
        return Anomaly(
            anomaly_type="scan_failure_spike",
            severity="warning",
            description=f"Elevated scan failure rate: {rate:.1%} ({total} scans).",
            metric_value=round(rate, 4),
            threshold=_g('scan_failure_warn', SCAN_FAILURE_WARN),
        )
    return None


def check_ai_health(ai_summary: dict, ai_enabled: bool = True) -> list[Anomaly]:
    """Detect AI API errors and excessive fallback usage."""
    anomalies: list[Anomaly] = []
    total = ai_summary.get("total_calls", 0)
    if total < 5:
        return anomalies

    error_rate    = ai_summary.get("error_rate", 0.0)
    fallback_rate = ai_summary.get("fallback_rate", 0.0)

    if error_rate >= _g('ai_error_crit', AI_ERROR_CRIT):
        anomalies.append(Anomaly(
            anomaly_type="ai_error_spike",
            severity="critical",
            description=f"AI API error rate critical: {error_rate:.1%}. Check Anthropic quota / API key.",
            metric_value=round(error_rate, 4),
            threshold=_g('ai_error_crit', AI_ERROR_CRIT),
        ))
    elif error_rate >= _g('ai_error_warn', AI_ERROR_WARN):
        anomalies.append(Anomaly(
            anomaly_type="ai_error_spike",
            severity="warning",
            description=f"Elevated AI API error rate: {error_rate:.1%}.",
            metric_value=round(error_rate, 4),
            threshold=_g('ai_error_warn', AI_ERROR_WARN),
        ))

    # Skip fallback-rate warning when AI is intentionally disabled (100% fallback is expected)
    if ai_enabled and fallback_rate >= _g('ai_fallback_warn', AI_FALLBACK_WARN):
        anomalies.append(Anomaly(
            anomaly_type="ai_error_spike",
            severity="warning",
            description=(
                f"High heuristic fallback rate: {fallback_rate:.1%}. "
                "Claude API may be unreliable — validation quality degraded."
            ),
            metric_value=round(fallback_rate, 4),
            threshold=_g('ai_fallback_warn', AI_FALLBACK_WARN),
        ))

    return anomalies


def check_queue_backlog(queue_depths: dict[str, int]) -> list[Anomaly]:
    """Detect Celery queue backlog growth."""
    anomalies: list[Anomaly] = []
    for queue_name, depth in queue_depths.items():
        if depth >= _g('queue_depth_crit', QUEUE_DEPTH_CRIT):
            anomalies.append(Anomaly(
                anomaly_type="queue_backlog",
                severity="critical",
                description=f"Queue '{queue_name}' has {depth} pending tasks. Workers may be stalled.",
                metric_value=float(depth),
                threshold=float(_g('queue_depth_crit', QUEUE_DEPTH_CRIT)),
            ))
        elif depth >= _g('queue_depth_warn', QUEUE_DEPTH_WARN):
            anomalies.append(Anomaly(
                anomaly_type="queue_backlog",
                severity="warning",
                description=f"Queue '{queue_name}' backlog growing: {depth} pending tasks.",
                metric_value=float(depth),
                threshold=float(_g('queue_depth_warn', QUEUE_DEPTH_WARN)),
            ))
    return anomalies


# ── Full check runner ─────────────────────────────────────────────────────────

def run_all_checks(
    stats_7d: dict,
    stats_30d: dict,
    calibration: dict,
    scan_summary: dict,
    ai_summary: dict,
    queue_depths: dict[str, int],
    previous_calibration: dict | None = None,
    ai_enabled: bool = True,
) -> list[Anomaly]:
    """
    Run every anomaly check and return a list of Anomaly instances,
    sorted by severity (critical first).
    """
    anomalies: list[Anomaly] = []

    # Signal quality
    for fn, args in [
        (check_win_rate_degradation, (stats_7d, stats_30d)),
        (check_expectancy_negative,  (stats_7d,)),
        (check_false_positive_spike, (stats_7d,)),
        (check_drawdown_spike,       (stats_7d,)),
        (check_calibration_drift,    (calibration, previous_calibration)),
        (check_scan_failure_spike,   (scan_summary,)),
    ]:
        result = fn(*args)
        if result is not None:
            anomalies.append(result)

    # List-returning checks
    anomalies.extend(check_ai_health(ai_summary, ai_enabled=ai_enabled))
    anomalies.extend(check_queue_backlog(queue_depths))

    _severity_order = {"critical": 0, "warning": 1, "info": 2}
    return sorted(anomalies, key=lambda a: _severity_order.get(a.severity, 9))
