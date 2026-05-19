"""
Tests for backend/analytics/stats_utils.py.
All pure functions — no I/O, no DB, no mocks.
"""
from __future__ import annotations

import math
import pytest

from backend.analytics.stats_utils import (
    wilson_ci,
    mean_ci,
    two_prop_z,
    expected_calibration_error,
    calibration_label,
    reliability_score,
    sample_warning,
    has_data,
    safe_mean,
    safe_median,
    percentile,
    running_max_drawdown,
    profit_factor,
    sharpe,
    group_stats,
    MIN_SAMPLES,
    WARN_SAMPLES,
)


# ── wilson_ci ─────────────────────────────────────────────────────────────────

class TestWilsonCI:
    def test_zero_n_returns_full_range(self):
        lo, hi = wilson_ci(0, 0)
        assert lo == 0.0 and hi == 1.0

    def test_all_successes(self):
        lo, hi = wilson_ci(100, 100)
        assert lo > 0.9 and hi == 1.0

    def test_no_successes(self):
        lo, hi = wilson_ci(0, 100)
        assert lo == 0.0 and hi < 0.05

    def test_half_successes(self):
        lo, hi = wilson_ci(50, 100)
        assert 0.40 < lo < 0.50
        assert 0.50 < hi < 0.60

    def test_ci_contains_true_proportion(self):
        lo, hi = wilson_ci(30, 50)
        p_hat = 30 / 50
        assert lo <= p_hat <= hi

    def test_small_n_wider_ci(self):
        lo5,  hi5  = wilson_ci(3, 5)
        lo50, hi50 = wilson_ci(30, 50)
        assert (hi5 - lo5) > (hi50 - lo50)

    def test_ci_within_unit_interval(self):
        for s in range(0, 11):
            lo, hi = wilson_ci(s, 10)
            assert 0.0 <= lo <= 1.0
            assert 0.0 <= hi <= 1.0
            assert lo <= hi

    def test_symmetry_at_50pct(self):
        lo, hi = wilson_ci(5, 10)
        # Should be symmetric around 0.5
        assert abs((0.5 - lo) - (hi - 0.5)) < 0.02


# ── mean_ci ───────────────────────────────────────────────────────────────────

class TestMeanCI:
    def test_fewer_than_two_returns_none(self):
        assert mean_ci([]) is None
        assert mean_ci([1.0]) is None

    def test_identical_values_zero_variance(self):
        ci = mean_ci([2.0, 2.0, 2.0, 2.0])
        assert ci is not None
        lo, hi = ci
        assert abs(lo - 2.0) < 1e-6
        assert abs(hi - 2.0) < 1e-6

    def test_ci_contains_mean(self):
        values = [1.0, 2.0, 3.0, 4.0, 5.0]
        mu = sum(values) / len(values)
        lo, hi = mean_ci(values)
        assert lo <= mu <= hi

    def test_larger_sample_narrower_ci(self):
        import random
        random.seed(42)
        small = [random.gauss(0, 1) for _ in range(5)]
        large = [random.gauss(0, 1) for _ in range(100)]
        lo_s, hi_s = mean_ci(small)
        lo_l, hi_l = mean_ci(large)
        assert (hi_s - lo_s) > (hi_l - lo_l)


# ── two_prop_z ────────────────────────────────────────────────────────────────

class TestTwoPropZ:
    def test_small_n_not_significant(self):
        z, sig = two_prop_z(4, 4, 0, 4)
        assert not sig

    def test_equal_proportions_not_significant(self):
        z, sig = two_prop_z(50, 100, 50, 100)
        assert abs(z) < 0.01
        assert not sig

    def test_clearly_different_significant(self):
        # 90% vs 50% with 100 samples each — clearly significant
        z, sig = two_prop_z(90, 100, 50, 100)
        assert sig
        assert z > 1.96

    def test_direction_positive_when_p1_gt_p2(self):
        z, _ = two_prop_z(70, 100, 30, 100)
        assert z > 0

    def test_direction_negative_when_p1_lt_p2(self):
        z, _ = two_prop_z(30, 100, 70, 100)
        assert z < 0

    def test_zero_or_one_pooled_prop(self):
        z, sig = two_prop_z(0, 10, 0, 10)
        assert z == 0.0 and not sig


# ── expected_calibration_error ────────────────────────────────────────────────

class TestECE:
    def test_perfect_calibration_zero_ece(self):
        bands = [
            {"total": 100, "win_rate": 0.75, "expected_win_rate": 0.75},
            {"total": 100, "win_rate": 0.85, "expected_win_rate": 0.85},
        ]
        assert expected_calibration_error(bands) == 0.0

    def test_empty_bands_zero_ece(self):
        assert expected_calibration_error([]) == 0.0

    def test_zero_total_ignored(self):
        bands = [
            {"total": 0,   "win_rate": 0.0,  "expected_win_rate": 0.80},
            {"total": 100, "win_rate": 0.80, "expected_win_rate": 0.80},
        ]
        assert expected_calibration_error(bands) == 0.0

    def test_known_ece(self):
        # 50% of weight: |0.60 - 0.75| = 0.15
        # 50% of weight: |0.85 - 0.85| = 0.00
        # ECE = 0.5*0.15 + 0.5*0.0 = 0.075
        bands = [
            {"total": 100, "win_rate": 0.60, "expected_win_rate": 0.75},
            {"total": 100, "win_rate": 0.85, "expected_win_rate": 0.85},
        ]
        assert abs(expected_calibration_error(bands) - 0.075) < 1e-6

    def test_none_win_rate_skipped(self):
        bands = [
            {"total": 5, "win_rate": None, "expected_win_rate": 0.80},
            {"total": 100, "win_rate": 0.80, "expected_win_rate": 0.80},
        ]
        # None band skipped — ECE driven only by the second band
        assert expected_calibration_error(bands) == 0.0


# ── calibration_label ─────────────────────────────────────────────────────────

class TestCalibrationLabel:
    def test_well_calibrated(self):
        assert calibration_label(0.03) == "well_calibrated"

    def test_moderately_calibrated(self):
        assert calibration_label(0.08) == "moderately_calibrated"

    def test_poorly_calibrated(self):
        assert calibration_label(0.20) == "poorly_calibrated"

    def test_boundary_well(self):
        assert calibration_label(0.0499) == "well_calibrated"

    def test_boundary_moderate(self):
        assert calibration_label(0.05) == "moderately_calibrated"


# ── reliability_score ─────────────────────────────────────────────────────────

class TestReliabilityScore:
    def test_zero_ece_100_score(self):
        assert reliability_score(0.0) == 100.0

    def test_ece_025_zero_score(self):
        assert reliability_score(0.25) == 0.0

    def test_clamped_at_zero(self):
        assert reliability_score(0.5) == 0.0

    def test_monotone_decreasing(self):
        prev = reliability_score(0.0)
        for ece in [0.02, 0.05, 0.10, 0.20, 0.25]:
            curr = reliability_score(ece)
            assert curr <= prev
            prev = curr


# ── sample_warning / has_data ─────────────────────────────────────────────────

class TestSampleUtils:
    def test_below_min_samples_warning(self):
        w = sample_warning(MIN_SAMPLES - 1)
        assert w is not None
        assert "Insufficient" in w

    def test_above_min_below_warn_caution(self):
        w = sample_warning(15)
        assert w is not None
        assert "caution" in w.lower()

    def test_above_warn_samples_none(self):
        assert sample_warning(WARN_SAMPLES) is None

    def test_has_data_false_below_threshold(self):
        assert not has_data(MIN_SAMPLES - 1)

    def test_has_data_true_at_threshold(self):
        assert has_data(MIN_SAMPLES)


# ── descriptive stats ─────────────────────────────────────────────────────────

class TestDescriptiveStats:
    def test_safe_mean_empty(self):
        assert safe_mean([]) is None

    def test_safe_mean_known(self):
        assert abs(safe_mean([1.0, 2.0, 3.0]) - 2.0) < 1e-6

    def test_safe_median_odd(self):
        assert safe_median([1.0, 3.0, 5.0]) == 3.0

    def test_safe_median_even(self):
        assert safe_median([1.0, 2.0, 3.0, 4.0]) == 2.5

    def test_safe_median_empty(self):
        assert safe_median([]) is None

    def test_percentile_0_is_min(self):
        assert percentile([3.0, 1.0, 2.0], 0) == 1.0

    def test_percentile_100_is_max(self):
        assert percentile([3.0, 1.0, 2.0], 100) == 3.0

    def test_percentile_empty(self):
        assert percentile([], 50) is None


# ── running_max_drawdown ──────────────────────────────────────────────────────

class TestRunningMaxDrawdown:
    def test_empty(self):
        assert running_max_drawdown([]) == 0.0

    def test_all_positive_no_drawdown(self):
        assert running_max_drawdown([1.0, 2.0, 3.0]) == 0.0

    def test_single_loss_from_zero(self):
        assert running_max_drawdown([-3.0]) == 3.0

    def test_peak_then_valley(self):
        # cum: 2, 1, 4, -1 → peak 4, trough -1 → dd = 5
        assert running_max_drawdown([2.0, -1.0, 3.0, -5.0]) == 5.0

    def test_alternating(self):
        # cum: 1, 0, 1, 0 → peak 1, min after peak 0 → dd = 1
        assert running_max_drawdown([1.0, -1.0, 1.0, -1.0]) == 1.0

    def test_all_losses_from_zero(self):
        # peak stays at 0, cum goes -1,-2,-3 → max dd = 3
        assert running_max_drawdown([-1.0, -1.0, -1.0]) == 3.0


# ── profit_factor ─────────────────────────────────────────────────────────────

class TestProfitFactor:
    def test_no_losses_returns_none(self):
        assert profit_factor([1.0, 2.0], []) is None

    def test_no_wins_zero(self):
        assert profit_factor([], [-1.0, -2.0]) == 0.0

    def test_break_even(self):
        assert abs(profit_factor([3.0], [-3.0]) - 1.0) < 1e-6

    def test_profitable(self):
        # gross_win=6, gross_loss=3 → 2.0
        assert abs(profit_factor([2.0, 4.0], [-1.0, -2.0]) - 2.0) < 1e-6


# ── sharpe ────────────────────────────────────────────────────────────────────

class TestSharpeRatio:
    def test_fewer_than_two_returns_none(self):
        assert sharpe([1.0], 24.0) is None

    def test_zero_duration_returns_none(self):
        assert sharpe([1.0, 2.0], 0.0) is None

    def test_zero_std_returns_none(self):
        assert sharpe([1.0, 1.0, 1.0], 24.0) is None

    def test_positive_returns_positive_sharpe(self):
        result = sharpe([2.0, 2.1, 1.9, 2.0], 24.0)
        assert result is not None and result > 0

    def test_negative_mean_negative_sharpe(self):
        result = sharpe([-1.0, -1.1, -0.9, -1.0], 24.0)
        assert result is not None and result < 0

    def test_shorter_duration_higher_sharpe(self):
        rr = [1.0, 0.8, 1.2, 0.9, 1.1]
        s24 = sharpe(rr, 24.0)
        s48 = sharpe(rr, 48.0)
        assert s24 > s48


# ── group_stats ───────────────────────────────────────────────────────────────

def _make_row(outcome: str, rr: float | None = None, hours: float = 24.0) -> dict:
    return {"outcome": outcome, "rr_achieved": rr, "duration_hours": hours}


class TestGroupStats:
    def test_empty_returns_zero_total(self):
        result = group_stats([])
        assert result["total"] == 0
        assert result["insufficient_data"] is True

    def test_all_tp_hits(self):
        rows = [_make_row("TP_HIT", 2.0) for _ in range(15)]
        result = group_stats(rows, label="test")
        assert result["total"] == 15
        assert result["tp_hits"] == 15
        assert result["sl_hits"] == 0
        assert result["win_rate"] == 1.0
        assert result["win_rate_ci"][0] > 0.75
        assert result["insufficient_data"] is False

    def test_all_sl_hits_negative_expectancy(self):
        rows = [_make_row("SL_HIT", -1.0) for _ in range(15)]
        result = group_stats(rows)
        assert result["win_rate"] == 0.0
        assert result["expectancy"] is not None and result["expectancy"] < 0

    def test_mixed_expectancy(self):
        # 50% win rate, avg_win=2R, avg_loss=-1R → E=0.5*2-0.5*1=0.5
        rows = (
            [_make_row("TP_HIT", 2.0) for _ in range(10)]
            + [_make_row("SL_HIT", -1.0) for _ in range(10)]
        )
        result = group_stats(rows)
        assert result["total"] == 20
        assert result["win_rate"] == 0.5
        assert abs(result["expectancy"] - 0.5) < 1e-4

    def test_wilson_ci_present(self):
        rows = [_make_row("TP_HIT", 1.0) for _ in range(10)]
        result = group_stats(rows)
        lo, hi = result["win_rate_ci"]
        assert 0.0 <= lo <= 1.0 <= hi or hi <= 1.0

    def test_profit_factor_none_when_no_losses(self):
        rows = [_make_row("TP_HIT", 2.0) for _ in range(10)]
        result = group_stats(rows)
        assert result["profit_factor"] is None   # infinite → None

    def test_max_drawdown_zero_for_all_wins(self):
        rows = [_make_row("TP_HIT", 1.0) for _ in range(10)]
        result = group_stats(rows)
        assert result["max_drawdown_r"] == 0.0

    def test_insufficient_data_flag_below_min(self):
        rows = [_make_row("TP_HIT", 1.0) for _ in range(MIN_SAMPLES - 1)]
        result = group_stats(rows)
        assert result["insufficient_data"] is True

    def test_pending_rows_excluded(self):
        rows = [_make_row("PENDING", 0.0)] * 5 + [_make_row("TP_HIT", 1.0)] * 10
        result = group_stats(rows)
        assert result["total"] == 10   # PENDING excluded

    def test_none_rr_handled_gracefully(self):
        rows = [_make_row("TP_HIT", None)] * 5 + [_make_row("TP_HIT", 2.0)] * 10
        result = group_stats(rows)
        assert result["total"] == 15
        assert result["avg_rr_achieved"] == 2.0   # only non-None
