"""PHASE.9.P1.PROBABILITY.ENGINE.1 — unit tests (pure, no DB)."""
from __future__ import annotations

from backend.analytics.probability import (
    EMPIRICAL_GRADE_BINS,
    CohortStats,
    empirical_grade,
    evaluate,
    lookup_empirical,
    should_suppress_send,
    wilson_interval,
)
from backend.system_settings.groups import FeatureFlags, ScannerSettings


def cell(wr, n, exp=None, pf=None):
    return {"wr": wr, "n": n, "exp": exp, "pf": pf}


LOOKUP = {
    ("regime|type|breakout", "BEAR_TREND|SELL|CONFIRMED_BREAKOUT"): cell(56.5, 568, 0.797, 2.83),
    ("regime|type",          "BEAR_TREND|SELL"):                    cell(59.6, 792, 0.877, 3.17),
    ("regime",               "BEAR_TREND"):                          cell(51.4, 992, 0.618, 2.27),
    ("conf_band",            "85-89"):                               cell(42.1, 525, 0.266, 1.46),
    ("global",               "ALL"):                                 cell(36.1, 1822, 0.128, 1.20),
}


class TestWilsonInterval:
    def test_known_value(self):
        lo, hi = wilson_interval(50.0, 100)
        assert 40.0 < lo < 41.0 and 59.0 < hi < 60.0

    def test_small_sample_wide(self):
        lo, hi = wilson_interval(80.0, 5)
        assert hi - lo > 45   # tiny n → very wide interval

    def test_large_sample_narrow(self):
        lo, hi = wilson_interval(59.6, 792)
        assert hi - lo < 7

    def test_zero_n(self):
        assert wilson_interval(50.0, 0) == (0.0, 100.0)


class TestEngineHierarchy:
    def test_most_specific_first(self):
        s = evaluate(LOOKUP, market_regime="BEAR_TREND", signal_type="SELL",
                     breakout_strength="CONFIRMED_BREAKOUT")
        assert s is not None and s.level == "regime|type|breakout"
        assert (s.wr, s.exp, s.pf, s.n) == (56.5, 0.797, 2.83, 568)
        assert s.ci_low < 56.5 < s.ci_high

    def test_falls_to_conf_band(self):
        s = evaluate(LOOKUP, market_regime="BULL_TREND", signal_type="BUY",
                     breakout_strength=None, confidence=87)
        assert s is not None and s.level == "conf_band"
        assert s.wr == 42.1

    def test_falls_to_global(self):
        s = evaluate(LOOKUP, market_regime="BULL_TREND", signal_type="BUY",
                     breakout_strength=None)   # no confidence → skips band level
        assert s is not None and s.level == "global"
        assert s.n == 1822

    def test_empty_lookup_returns_none(self):
        assert evaluate({}, market_regime="BEAR_TREND", signal_type="SELL",
                        breakout_strength=None, confidence=90) is None

    def test_backward_compatible_wrapper(self):
        wr, n = lookup_empirical(LOOKUP, "BEAR_TREND", "SELL", None)
        assert (wr, n) == (59.6, 792)

    def test_as_dict_shape(self):
        s = CohortStats(59.6, 0.877, 3.17, 792, "regime|type")
        d = s.as_dict()
        assert d["probability_of_win"] == 59.6
        assert d["expectancy"] == 0.877
        assert d["profit_factor"] == 3.17
        assert d["sample_size"] == 792
        assert len(d["confidence_interval"]) == 2


class TestEmpiricalGrade:
    def test_bins(self):
        assert empirical_grade(1.62, 100) == "A+"
        assert empirical_grade(0.88, 100) == "A"
        assert empirical_grade(0.40, 100) == "B+"
        assert empirical_grade(0.20, 100) == "B"
        assert empirical_grade(0.05, 100) == "C"
        assert empirical_grade(-0.30, 100) == "D"

    def test_thin_cohort_ungraded(self):
        assert empirical_grade(1.0, 29) is None
        assert empirical_grade(None, 500) is None

    def test_bins_ordered_descending(self):
        floors = [f for f, _ in EMPIRICAL_GRADE_BINS]
        assert floors == sorted(floors, reverse=True)


class TestDeliveryGateV1:
    def test_wr_gate_unchanged(self):
        assert should_suppress_send(True, 30.0, 45.0) is True
        assert should_suppress_send(True, 60.0, 45.0) is False
        assert should_suppress_send(True, None, 45.0) is False
        assert should_suppress_send(False, 30.0, 45.0) is False

    def test_expectancy_filter_off_by_default(self):
        # exp below floor but filter not enabled → delivers
        assert should_suppress_send(True, 60.0, 45.0,
                                    empirical_exp=-0.5, min_expectancy=0.0) is False

    def test_expectancy_filter_on(self):
        assert should_suppress_send(True, 60.0, 45.0, expectancy_filter=True,
                                    empirical_exp=-0.5, min_expectancy=0.0) is True
        assert should_suppress_send(True, 60.0, 45.0, expectancy_filter=True,
                                    empirical_exp=0.4, min_expectancy=0.0) is False

    def test_unknown_expectancy_never_gates(self):
        assert should_suppress_send(True, 60.0, 45.0, expectancy_filter=True,
                                    empirical_exp=None, min_expectancy=0.0) is False


class TestFlagsAndDims:
    def test_flags_default_state(self):
        # P0 flags promoted to ON by SQA3 (2026-06-16)
        ff = FeatureFlags()
        assert ff.probability_gate_v1 is True
        assert ff.riskgrade_v2 is True
        assert ff.regime_hard_gate_v2 is True
        assert ff.early_breakout_penalty_v1 is True
        assert ff.high_confidence_mode_enabled is False

    def test_min_empirical_exp_default(self):
        assert ScannerSettings().min_empirical_exp == 0.0

    def test_new_snapshot_dims_exist(self):
        from backend.analytics.outcome_learning import DIMENSION_SETS
        for key in ("global", "trend_tier|breakout", "sector|funding", "oi|positioning"):
            assert key in DIMENSION_SETS

    def test_global_dim_yields_single_cell(self):
        from backend.analytics.outcome_learning import aggregate_rows
        rows = [{"outcome": "TP_HIT", "rr_achieved": 2.0, "market_regime": "BEAR_TREND",
                 "signal_type": "SELL", "risk_grade": "A", "breakout_strength": None,
                 "oi_interpretation": None, "funding_trend": None, "positioning_context": None,
                 "trend_score": None, "scanner_mode": "spot", "confidence": 86}] * 12
        tuples = aggregate_rows(rows, 30)
        global_cells = [t for t in tuples if t[1] == "global"]
        assert len(global_cells) == 1
        assert global_cells[0][2] == "ALL"
