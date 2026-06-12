"""PERFORMANCE.VERIFICATION.1 — unit tests for the pure validation functions."""
from __future__ import annotations

from backend.analytics.performance_verification import (
    GRADE_ORDER,
    accuracy_by_dimension,
    cohort_ranking,
    detect_inversions,
    grade_table,
    ranking_overlap,
)


def out(outcome="TP_HIT", rr=2.0, **kw):
    base = {"outcome": outcome, "rr_achieved": rr, "market_regime": "BEAR_TREND",
            "signal_type": "SELL", "breakout_strength": None}
    base.update(kw)
    return base


class TestAccuracyByDimension:
    def test_drift_and_calibration(self):
        rows = (
            [{"empirical_wr": 60.0, "market_regime": "BEAR_TREND", "outcome": "TP_HIT"}] * 6
            + [{"empirical_wr": 60.0, "market_regime": "BEAR_TREND", "outcome": "SL_HIT"}] * 4
        )
        [cell] = accuracy_by_dimension(rows, "market_regime")
        assert cell["value"] == "BEAR_TREND"
        assert cell["predicted_wr"] == 60.0
        assert cell["actual_wr"] == 60.0
        assert cell["drift"] == 0.0
        assert cell["calibrated"] is True
        assert cell["low_sample"] is False   # n=10 meets MIN_DIM_N exactly

    def test_miscalibrated_cell(self):
        rows = (
            [{"empirical_wr": 90.0, "outcome": "SL_HIT", "market_regime": "SIDEWAYS"}] * 30
        )
        [cell] = accuracy_by_dimension(rows, "market_regime")
        assert cell["actual_wr"] == 0.0
        assert cell["drift"] == -90.0
        assert cell["calibrated"] is False


class TestGradeValidation:
    def test_monotonic_table_no_inversions(self):
        rows = (
            [out(rr=2.0, derived_grade="A+")] * 20
            + [out(rr=2.0, derived_grade="A")] * 12 + [out("SL_HIT", -1.0, derived_grade="A")] * 8
            + [out("SL_HIT", -1.0, derived_grade="D")] * 20
        )
        table = grade_table(rows, "derived_grade", GRADE_ORDER)
        assert [t["grade"] for t in table] == ["A+", "A", "D"]
        assert detect_inversions(table, "wr") == []
        assert detect_inversions(table, "exp") == []

    def test_inversion_detected(self):
        rows = (
            [out("SL_HIT", -1.0, derived_grade="A")] * 15   # A: 0% WR
            + [out(rr=2.0, derived_grade="B")] * 15          # B: 100% WR — inverted!
        )
        table = grade_table(rows, "derived_grade", GRADE_ORDER)
        violations = detect_inversions(table, "wr")
        assert len(violations) == 1
        assert "A" in violations[0] and "B" in violations[0]

    def test_thin_grades_not_compared(self):
        rows = (
            [out("SL_HIT", -1.0, derived_grade="A")] * 5    # n < MIN_DIM_N — excluded
            + [out(rr=2.0, derived_grade="B")] * 15
        )
        table = grade_table(rows, "derived_grade", GRADE_ORDER)
        assert detect_inversions(table, "wr") == []


class TestEdgeStability:
    def test_cohort_ranking_orders_by_expectancy(self):
        rows = (
            [out(rr=2.0, market_regime="BEAR_TREND", breakout_strength="HIGH_MOMENTUM_BREAKOUT")] * 25
            + [out("SL_HIT", -1.0, market_regime="SIDEWAYS")] * 25
        )
        ranked = cohort_ranking(rows, min_n=20)
        assert ranked[0]["cohort"].startswith("BEAR_TREND")
        assert ranked[-1]["cohort"].startswith("SIDEWAYS")

    def test_small_cohorts_dropped(self):
        rows = [out()] * 10   # below MIN_COHORT_N
        assert cohort_ranking(rows, min_n=20) == []

    def test_ranking_overlap(self):
        a = [{"cohort": "X"}, {"cohort": "Y"}, {"cohort": "Z"}]
        b = [{"cohort": "X"}, {"cohort": "Y"}, {"cohort": "Q"}]
        ov = ranking_overlap(a, b)
        assert ov["jaccard"] == 0.5     # {X,Y} / {X,Y,Z,Q}
        assert ov["top3_retained"] == 2

    def test_overlap_empty(self):
        ov = ranking_overlap([], [])
        assert ov["jaccard"] is None
