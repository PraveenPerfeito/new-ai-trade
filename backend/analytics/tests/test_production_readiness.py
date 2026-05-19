"""
Tests for backend/analytics/production_readiness.py.
All scorer functions are pure — no I/O, no mocks.
"""
from __future__ import annotations

import pytest

from backend.analytics.production_readiness import (
    score_operational_stability,
    score_signal_edge,
    score_calibration,
    score_ai_effectiveness,
    score_data_coverage,
    _verdict,
    _score,
    _avg,
)


# ── _score helper ─────────────────────────────────────────────────────────────

class TestScoreHelper:
    def test_none_returns_zero(self):
        assert _score(None, [(0.9, 100), (0.8, 70)]) == 0

    def test_first_matching_threshold_wins(self):
        assert _score(0.95, [(0.90, 100), (0.80, 70)]) == 100

    def test_second_threshold_when_below_first(self):
        assert _score(0.85, [(0.90, 100), (0.80, 70)]) == 70

    def test_zero_when_below_all(self):
        assert _score(0.50, [(0.90, 100), (0.80, 70)]) == 0

    def test_exact_boundary(self):
        assert _score(0.90, [(0.90, 100), (0.80, 70)]) == 100


# ── _avg helper ───────────────────────────────────────────────────────────────

class TestAvgHelper:
    def test_empty_returns_zero(self):
        assert _avg() == 0

    def test_equal_weights(self):
        assert _avg(50, 100) == 75

    def test_weighted_average(self):
        # 100*0.6 + 0*0.4 = 60
        result = _avg(100, 0, weights=[0.6, 0.4])
        assert result == 60

    def test_rounds_to_int(self):
        result = _avg(1, 2)
        assert isinstance(result, int)


# ── score_operational_stability ───────────────────────────────────────────────

class TestOperationalStability:
    def _call(self, scan_fail=0.0, ai_error=0.0, critical=0):
        return score_operational_stability(
            scan_summary={"failure_rate": scan_fail},
            ai_summary={"error_rate": ai_error},
            anomaly_result={"critical_count": critical},
        )

    def test_perfect_scores_100(self):
        result = self._call()
        assert result["score"] == 100
        assert result["scan_score"] == 100
        assert result["ai_score"] == 100
        assert result["anomaly_score"] == 100

    def test_high_scan_failure_lowers_score(self):
        result = self._call(scan_fail=0.20)   # 20% failure → scan_score=40
        assert result["scan_score"] == 40
        assert result["score"] < 100

    def test_one_critical_anomaly_lowers_score(self):
        result = self._call(critical=1)
        assert result["anomaly_score"] == 40

    def test_two_or_more_critical_anomalies_zero(self):
        result = self._call(critical=2)
        assert result["anomaly_score"] == 0

    def test_output_keys_present(self):
        result = self._call()
        for k in ("score", "scan_score", "ai_score", "anomaly_score", "inputs"):
            assert k in result

    def test_inputs_recorded(self):
        result = self._call(scan_fail=0.10, ai_error=0.05, critical=1)
        assert result["inputs"]["scan_failure_rate"] == 0.10
        assert result["inputs"]["ai_error_rate"] == 0.05
        assert result["inputs"]["critical_anomalies"] == 1


# ── score_signal_edge ─────────────────────────────────────────────────────────

class TestSignalEdge:
    def _call(self, win_rate=0.65, expectancy=0.60, total=200):
        return score_signal_edge({"win_rate": win_rate, "expectancy": expectancy, "total": total})

    def test_strong_edge_high_score(self):
        result = self._call()
        assert result["score"] >= 90

    def test_insufficient_samples_lowers_score(self):
        result = self._call(total=5)
        assert result["sample_score"] == 0
        assert result["score"] < 90

    def test_low_win_rate_lowers_score(self):
        result = self._call(win_rate=0.45)
        assert result["wr_score"] == 0

    def test_negative_expectancy_low_score(self):
        result = self._call(expectancy=-0.50)
        assert result["exp_score"] == 0

    def test_output_keys_present(self):
        for k in ("score", "wr_score", "exp_score", "sample_score", "inputs"):
            assert k in self._call()

    def test_none_win_rate_handled(self):
        result = score_signal_edge({"win_rate": None, "expectancy": None, "total": 0})
        assert result["score"] == 0


# ── score_calibration ─────────────────────────────────────────────────────────

class TestCalibration:
    def _cal(self, ece=0.03, monotone=True):
        return {"calibration": {"ece": ece, "is_monotone": monotone}}

    def test_perfect_calibration_high_score(self):
        result = score_calibration(self._cal(ece=0.03))
        assert result["ece_score"] == 100

    def test_poor_ece_low_score(self):
        result = score_calibration(self._cal(ece=0.25))
        assert result["ece_score"] == 0

    def test_monotone_true_full_mono_score(self):
        result = score_calibration(self._cal(monotone=True))
        assert result["mono_score"] == 100

    def test_monotone_none_partial_mono_score(self):
        result = score_calibration(self._cal(monotone=None))
        assert result["mono_score"] == 50

    def test_monotone_false_zero_mono_score(self):
        result = score_calibration(self._cal(monotone=False))
        assert result["mono_score"] == 0

    def test_output_keys_present(self):
        result = score_calibration(self._cal())
        for k in ("score", "ece_score", "mono_score", "inputs"):
            assert k in result

    def test_missing_calibration_data(self):
        result = score_calibration({})
        assert result["ece_score"] == 0
        assert result["mono_score"] == 50   # None monotonicity → 50


# ── score_ai_effectiveness ────────────────────────────────────────────────────

class TestAiEffectiveness:
    def _call(self, verdict="claude_adds_value", heuristic_total=5, total_with_ai=100):
        return score_ai_effectiveness({
            "verdict": verdict,
            "heuristic": {"total": heuristic_total},
            "total_with_ai_log": total_with_ai,
        })

    def test_best_verdict_high_score(self):
        result = self._call()
        assert result["verdict_score"] == 100

    def test_heuristic_outperforms_low_score(self):
        result = self._call(verdict="heuristic_outperforms")
        assert result["verdict_score"] == 10

    def test_unknown_verdict_defaults_to_30(self):
        result = self._call(verdict="something_new")
        assert result["verdict_score"] == 30

    def test_low_fallback_rate_high_fb_score(self):
        result = self._call(heuristic_total=5, total_with_ai=100)  # 5%
        assert result["fallback_score"] == 100

    def test_high_fallback_rate_low_fb_score(self):
        result = self._call(heuristic_total=60, total_with_ai=100)  # 60%
        assert result["fallback_score"] == 0

    def test_zero_total_with_ai_no_divide_error(self):
        result = self._call(total_with_ai=0)
        assert result["inputs"]["fallback_rate"] == 0.0

    def test_output_keys_present(self):
        result = self._call()
        for k in ("score", "verdict_score", "fallback_score", "inputs"):
            assert k in result


# ── score_data_coverage ───────────────────────────────────────────────────────

class TestDataCoverage:
    def _call(self, resolved=200, days=30.0):
        return score_data_coverage({"resolved": resolved, "days": days})

    def test_full_coverage_high_score(self):
        result = self._call()
        assert result["score"] >= 90

    def test_no_data_zero_score(self):
        result = self._call(resolved=0, days=0.0)
        assert result["score"] == 0

    def test_few_signals_lowers_score(self):
        result = self._call(resolved=5, days=30.0)
        assert result["signal_score"] == 0

    def test_short_window_lowers_score(self):
        result = self._call(resolved=200, days=1.0)
        assert result["days_score"] == 0

    def test_output_keys_present(self):
        result = self._call()
        for k in ("score", "signal_score", "days_score", "inputs"):
            assert k in result


# ── _verdict ──────────────────────────────────────────────────────────────────

def _make_components(ops=80, edge=80, cal=80, ai=80, cov=80):
    return {
        "operational_stability": {"score": ops},
        "signal_edge":           {"score": edge},
        "calibration":           {"score": cal},
        "ai_effectiveness":      {"score": ai},
        "data_coverage":         {"score": cov},
    }


class TestVerdict:
    def test_production_ready_at_80(self):
        v = _verdict(80, _make_components())
        assert v["label"] == "production_ready"
        assert v["go"] is True
        assert v["score"] == 80

    def test_ready_with_monitoring_at_65(self):
        v = _verdict(65, _make_components())
        assert v["label"] == "ready_with_monitoring"
        assert v["go"] is True

    def test_needs_more_data_at_50(self):
        v = _verdict(50, _make_components())
        assert v["label"] == "needs_more_data"
        assert v["go"] is False

    def test_not_ready_below_50(self):
        v = _verdict(49, _make_components())
        assert v["label"] == "not_ready"
        assert v["go"] is False

    def test_rationale_is_string(self):
        for score in (80, 65, 50, 30):
            v = _verdict(score, _make_components())
            assert isinstance(v["rationale"], str) and len(v["rationale"]) > 0

    def test_ready_with_monitoring_names_weakest(self):
        comps = _make_components(ops=90, edge=90, cal=90, ai=40, cov=90)
        v = _verdict(70, comps)
        assert "ai_effectiveness" in v["rationale"]

    def test_score_preserved_in_verdict(self):
        v = _verdict(72, _make_components())
        assert v["score"] == 72

    def test_go_true_only_above_65(self):
        assert _verdict(64, _make_components())["go"] is False
        assert _verdict(65, _make_components())["go"] is True


# ── Weighted score integration ────────────────────────────────────────────────

class TestWeightedScoreIntegration:
    """Verify the component scoring functions all return valid score dicts."""

    def test_all_scorers_return_int_score(self):
        ops = score_operational_stability(
            {"failure_rate": 0.05}, {"error_rate": 0.03}, {"critical_count": 0}
        )
        edge = score_signal_edge({"win_rate": 0.60, "expectancy": 0.40, "total": 150})
        cal = score_calibration({"calibration": {"ece": 0.04, "is_monotone": True}})
        ai = score_ai_effectiveness({
            "verdict": "claude_adds_value",
            "heuristic": {"total": 10},
            "total_with_ai_log": 100,
        })
        cov = score_data_coverage({"resolved": 100, "days": 20.0})

        for result in (ops, edge, cal, ai, cov):
            assert isinstance(result["score"], int)
            assert 0 <= result["score"] <= 100

    def test_overall_weighted_score_in_range(self):
        components = {
            "operational_stability": score_operational_stability(
                {"failure_rate": 0.0}, {"error_rate": 0.0}, {"critical_count": 0}
            ),
            "signal_edge": score_signal_edge(
                {"win_rate": 0.65, "expectancy": 0.50, "total": 200}
            ),
            "calibration": score_calibration(
                {"calibration": {"ece": 0.03, "is_monotone": True}}
            ),
            "ai_effectiveness": score_ai_effectiveness({
                "verdict": "claude_adds_value",
                "heuristic": {"total": 5},
                "total_with_ai_log": 100,
            }),
            "data_coverage": score_data_coverage({"resolved": 200, "days": 30.0}),
        }
        weights = {
            "operational_stability": 0.25,
            "signal_edge":           0.30,
            "calibration":           0.20,
            "ai_effectiveness":      0.15,
            "data_coverage":         0.10,
        }
        overall = round(sum(components[k]["score"] * weights[k] for k in components))
        assert 0 <= overall <= 100
