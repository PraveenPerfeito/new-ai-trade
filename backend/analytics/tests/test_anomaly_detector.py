"""
Tests for backend/analytics/anomaly_detector.py.
All functions are pure (no I/O) — no mocks needed.
"""
from __future__ import annotations

import pytest

from backend.analytics.anomaly_detector import (
    Anomaly,
    WIN_RATE_DROP_WARN,
    WIN_RATE_DROP_CRIT,
    FALSE_POSITIVE_WARN,
    EXPECTANCY_CRIT,
    DRAWDOWN_WARN,
    DRAWDOWN_CRIT,
    ECE_WARN,
    ECE_CRIT,
    ECE_DRIFT_THRESHOLD,
    SCAN_FAILURE_WARN,
    SCAN_FAILURE_CRIT,
    AI_ERROR_WARN,
    AI_ERROR_CRIT,
    AI_FALLBACK_WARN,
    QUEUE_DEPTH_WARN,
    QUEUE_DEPTH_CRIT,
    check_win_rate_degradation,
    check_expectancy_negative,
    check_false_positive_spike,
    check_drawdown_spike,
    check_calibration_drift,
    check_scan_failure_spike,
    check_ai_health,
    check_queue_backlog,
    run_all_checks,
)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _stats(win_rate=0.60, total=50, expectancy=0.40, sl_hits=None, max_drawdown_r=None):
    out = {"win_rate": win_rate, "total": total, "expectancy": expectancy}
    if sl_hits is not None:
        out["sl_hits"] = sl_hits
    if max_drawdown_r is not None:
        out["max_drawdown_r"] = max_drawdown_r
    return out


def _cal(ece=0.04, is_monotone=True):
    return {"calibration": {"ece": ece, "is_monotone": is_monotone}}


# ── Anomaly dataclass ─────────────────────────────────────────────────────────

class TestAnomalyDataclass:
    def test_to_dict_has_required_keys(self):
        a = Anomaly("scan_failure_spike", "warning", "desc", 0.20, 0.15)
        d = a.to_dict()
        for k in ("anomaly_type", "severity", "description", "metric_value", "threshold", "detected_at"):
            assert k in d

    def test_detected_at_populated_automatically(self):
        a = Anomaly("x", "info", "y", None, None)
        assert len(a.detected_at) > 0

    def test_severity_values(self):
        for sev in ("info", "warning", "critical"):
            a = Anomaly("x", sev, "y", 1.0, 2.0)
            assert a.severity == sev


# ── check_win_rate_degradation ────────────────────────────────────────────────

class TestWinRateDegradation:
    def test_no_anomaly_when_stable(self):
        s7  = _stats(win_rate=0.60, total=30)
        s30 = _stats(win_rate=0.62, total=50)
        assert check_win_rate_degradation(s7, s30) is None

    def test_warning_at_warn_threshold(self):
        drop = WIN_RATE_DROP_WARN
        s7  = _stats(win_rate=0.60 - drop, total=30)
        s30 = _stats(win_rate=0.60, total=50)
        result = check_win_rate_degradation(s7, s30)
        assert result is not None
        assert result.severity == "warning"
        assert result.anomaly_type == "win_rate_degradation"

    def test_critical_at_crit_threshold(self):
        drop = WIN_RATE_DROP_CRIT
        s7  = _stats(win_rate=0.60 - drop, total=30)
        s30 = _stats(win_rate=0.60, total=50)
        result = check_win_rate_degradation(s7, s30)
        assert result is not None
        assert result.severity == "critical"

    def test_none_when_insufficient_7d_data(self):
        s7  = _stats(win_rate=0.30, total=5)   # < 10
        s30 = _stats(win_rate=0.60, total=50)
        assert check_win_rate_degradation(s7, s30) is None

    def test_none_when_missing_win_rate(self):
        s7  = {"win_rate": None, "total": 30}
        s30 = {"win_rate": 0.60, "total": 50}
        assert check_win_rate_degradation(s7, s30) is None

    def test_improvement_does_not_trigger(self):
        s7  = _stats(win_rate=0.70, total=30)
        s30 = _stats(win_rate=0.55, total=50)
        assert check_win_rate_degradation(s7, s30) is None


# ── check_expectancy_negative ─────────────────────────────────────────────────

class TestExpectancyNegative:
    def test_no_anomaly_positive_expectancy(self):
        assert check_expectancy_negative(_stats(expectancy=0.20, total=25)) is None

    def test_no_anomaly_insufficient_samples(self):
        assert check_expectancy_negative(_stats(expectancy=-0.50, total=19)) is None

    def test_warning_mildly_negative(self):
        result = check_expectancy_negative(_stats(expectancy=-0.10, total=25))
        assert result is not None
        assert result.severity == "warning"

    def test_critical_severely_negative(self):
        result = check_expectancy_negative(_stats(expectancy=-0.40, total=25))
        assert result is not None
        assert result.severity == "critical"

    def test_window_label_in_description(self):
        result = check_expectancy_negative(_stats(expectancy=-0.10, total=25), "30d")
        assert "30d" in result.description

    def test_none_missing_expectancy(self):
        assert check_expectancy_negative({"expectancy": None, "total": 25}) is None


# ── check_false_positive_spike ────────────────────────────────────────────────

class TestFalsePositiveSpike:
    def test_no_anomaly_normal_sl_rate(self):
        assert check_false_positive_spike(_stats(total=20, sl_hits=10)) is None

    def test_warning_high_sl_rate(self):
        # 75% sl rate > 70% threshold
        result = check_false_positive_spike({"total": 20, "sl_hits": 15})
        assert result is not None
        assert result.severity == "warning"

    def test_no_anomaly_few_total(self):
        # total < 10 → skip
        assert check_false_positive_spike({"total": 8, "sl_hits": 8}) is None

    def test_metric_value_is_rate(self):
        result = check_false_positive_spike({"total": 20, "sl_hits": 16})
        assert result is not None
        assert abs(result.metric_value - 0.80) < 0.01


# ── check_drawdown_spike ──────────────────────────────────────────────────────

class TestDrawdownSpike:
    def test_no_anomaly_small_drawdown(self):
        assert check_drawdown_spike({"max_drawdown_r": 2.0}) is None

    def test_warning_at_warn_threshold(self):
        result = check_drawdown_spike({"max_drawdown_r": DRAWDOWN_WARN})
        assert result is not None
        assert result.severity == "warning"

    def test_critical_at_crit_threshold(self):
        result = check_drawdown_spike({"max_drawdown_r": DRAWDOWN_CRIT})
        assert result is not None
        assert result.severity == "critical"

    def test_none_missing_metric(self):
        assert check_drawdown_spike({}) is None


# ── check_calibration_drift ───────────────────────────────────────────────────

class TestCalibrationDrift:
    def test_no_anomaly_good_ece(self):
        assert check_calibration_drift(_cal(ece=0.03)) is None

    def test_warning_at_warn_threshold(self):
        result = check_calibration_drift(_cal(ece=ECE_WARN))
        assert result is not None
        assert result.severity == "warning"

    def test_critical_at_crit_threshold(self):
        result = check_calibration_drift(_cal(ece=ECE_CRIT))
        assert result is not None
        assert result.severity == "critical"

    def test_drift_info_when_ece_increases(self):
        current = _cal(ece=0.07)
        previous = _cal(ece=0.02)
        result = check_calibration_drift(current, previous)
        assert result is not None
        assert result.severity == "info"

    def test_no_drift_when_below_threshold(self):
        current = _cal(ece=0.06)
        previous = _cal(ece=0.04)   # delta = 0.02 < ECE_DRIFT_THRESHOLD(0.05)
        result = check_calibration_drift(current, previous)
        assert result is None

    def test_none_when_ece_missing(self):
        assert check_calibration_drift({"calibration": {}}) is None

    def test_critical_takes_priority_over_drift(self):
        current = _cal(ece=ECE_CRIT)   # already critical — drift check skipped
        previous = _cal(ece=0.01)
        result = check_calibration_drift(current, previous)
        assert result is not None
        assert result.severity == "critical"


# ── check_scan_failure_spike ──────────────────────────────────────────────────

class TestScanFailureSpike:
    def test_no_anomaly_low_rate(self):
        assert check_scan_failure_spike({"failure_rate": 0.05, "total_scans": 10}) is None

    def test_warning_at_warn_threshold(self):
        result = check_scan_failure_spike({"failure_rate": SCAN_FAILURE_WARN, "total_scans": 10})
        assert result is not None
        assert result.severity == "warning"

    def test_critical_at_crit_threshold(self):
        result = check_scan_failure_spike({"failure_rate": SCAN_FAILURE_CRIT, "total_scans": 10})
        assert result is not None
        assert result.severity == "critical"

    def test_none_when_too_few_scans(self):
        assert check_scan_failure_spike({"failure_rate": 0.90, "total_scans": 1}) is None

    def test_none_when_rate_missing(self):
        assert check_scan_failure_spike({"total_scans": 20}) is None


# ── check_ai_health ───────────────────────────────────────────────────────────

class TestAiHealth:
    def test_no_anomalies_healthy(self):
        ai = {"total_calls": 10, "error_rate": 0.02, "fallback_rate": 0.10}
        assert check_ai_health(ai) == []

    def test_no_anomalies_few_calls(self):
        ai = {"total_calls": 3, "error_rate": 0.90, "fallback_rate": 0.90}
        assert check_ai_health(ai) == []

    def test_warning_error_rate(self):
        ai = {"total_calls": 10, "error_rate": AI_ERROR_WARN, "fallback_rate": 0.0}
        results = check_ai_health(ai)
        assert any(a.severity == "warning" and "error" in a.anomaly_type for a in results)

    def test_critical_error_rate(self):
        ai = {"total_calls": 10, "error_rate": AI_ERROR_CRIT, "fallback_rate": 0.0}
        results = check_ai_health(ai)
        assert any(a.severity == "critical" for a in results)

    def test_warning_fallback_rate(self):
        ai = {"total_calls": 10, "error_rate": 0.0, "fallback_rate": AI_FALLBACK_WARN}
        results = check_ai_health(ai)
        assert any(a.severity == "warning" for a in results)

    def test_multiple_anomalies_returned(self):
        ai = {"total_calls": 10, "error_rate": AI_ERROR_CRIT, "fallback_rate": AI_FALLBACK_WARN}
        results = check_ai_health(ai)
        assert len(results) >= 2


# ── check_queue_backlog ───────────────────────────────────────────────────────

class TestQueueBacklog:
    def test_no_anomalies_empty_queues(self):
        assert check_queue_backlog({"scanner": 0, "celery": 5}) == []

    def test_warning_at_warn_depth(self):
        results = check_queue_backlog({"scanner": QUEUE_DEPTH_WARN})
        assert any(a.severity == "warning" for a in results)

    def test_critical_at_crit_depth(self):
        results = check_queue_backlog({"scanner": QUEUE_DEPTH_CRIT})
        assert any(a.severity == "critical" for a in results)

    def test_queue_name_in_description(self):
        results = check_queue_backlog({"my_queue": QUEUE_DEPTH_WARN})
        assert results and "my_queue" in results[0].description

    def test_multiple_queues_each_checked(self):
        depths = {"q1": QUEUE_DEPTH_CRIT, "q2": QUEUE_DEPTH_WARN, "q3": 0}
        results = check_queue_backlog(depths)
        assert len(results) == 2


# ── run_all_checks ────────────────────────────────────────────────────────────

class TestRunAllChecks:
    def _empty_stats(self):
        return {"win_rate": 0.60, "total": 0, "expectancy": 0.30, "sl_hits": 0, "max_drawdown_r": 0.5}

    def test_no_anomalies_all_healthy(self):
        result = run_all_checks(
            stats_7d=self._empty_stats(),
            stats_30d=self._empty_stats(),
            calibration=_cal(ece=0.03),
            scan_summary={"failure_rate": 0.02, "total_scans": 20},
            ai_summary={"total_calls": 10, "error_rate": 0.01, "fallback_rate": 0.05},
            queue_depths={"scanner": 2},
        )
        assert result == []

    def test_sorted_critical_first(self):
        result = run_all_checks(
            stats_7d={"win_rate": 0.20, "total": 30, "expectancy": -0.50, "sl_hits": 25, "max_drawdown_r": 15.0},
            stats_30d={"win_rate": 0.60, "total": 50, "expectancy": 0.30},
            calibration=_cal(ece=ECE_CRIT),
            scan_summary={"failure_rate": SCAN_FAILURE_CRIT, "total_scans": 20},
            ai_summary={"total_calls": 10, "error_rate": AI_ERROR_CRIT, "fallback_rate": AI_FALLBACK_WARN},
            queue_depths={"scanner": QUEUE_DEPTH_CRIT},
        )
        assert len(result) > 0
        # First element must be critical
        assert result[0].severity == "critical"
        # All items are Anomaly instances
        for a in result:
            assert isinstance(a, Anomaly)

    def test_returns_list(self):
        result = run_all_checks(
            stats_7d=self._empty_stats(),
            stats_30d=self._empty_stats(),
            calibration=_cal(),
            scan_summary={},
            ai_summary={},
            queue_depths={},
        )
        assert isinstance(result, list)

    def test_severity_order_maintained(self):
        result = run_all_checks(
            stats_7d={"win_rate": 0.40, "total": 30, "expectancy": -0.20, "sl_hits": 0, "max_drawdown_r": 0},
            stats_30d={"win_rate": 0.60, "total": 50},
            calibration=_cal(ece=ECE_WARN),
            scan_summary={"failure_rate": SCAN_FAILURE_WARN, "total_scans": 10},
            ai_summary={"total_calls": 10, "error_rate": 0.01, "fallback_rate": 0.05},
            queue_depths={},
        )
        _order = {"critical": 0, "warning": 1, "info": 2}
        severities = [_order[a.severity] for a in result]
        assert severities == sorted(severities)
