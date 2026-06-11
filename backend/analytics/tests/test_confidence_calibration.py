"""
CONFIDENCE.CALIBRATION.2 — unit tests for the read-only calibration engine.
All tests are pure (no DB) — DB access lives only in compute_confidence_calibration.
"""
from __future__ import annotations

from backend.analytics.confidence_calibration import (
    MIN_RELIABLE_N,
    band_of,
    band_stats,
    build_empirical_lookup,
    compute_band_table,
    compute_dimension_drift,
    compute_insights,
    empirical_confidence_for,
)
from backend.system_settings.groups import FeatureFlags


def row(outcome="TP_HIT", rr=2.0, conf=95, regime="BEAR_TREND", stype="SELL", mode="spot"):
    return {
        "outcome": outcome, "rr_achieved": rr, "confidence": conf,
        "market_regime": regime, "signal_type": stype, "scanner_mode": mode,
    }


def make_rows(n_win, n_loss, conf=95, regime="BEAR_TREND", stype="SELL", win_rr=2.0):
    return (
        [row("TP_HIT", win_rr, conf, regime, stype) for _ in range(n_win)]
        + [row("SL_HIT", -1.0, conf, regime, stype) for _ in range(n_loss)]
    )


class TestBanding:
    def test_spec_bands(self):
        assert band_of(79) == "<80"
        assert band_of(80) == "80-84"
        assert band_of(84.9) == "80-84"
        assert band_of(85) == "85-89"
        assert band_of(90) == "90-94"
        assert band_of(95) == "95-100"
        assert band_of(100) == "95-100"
        assert band_of(None) == "NULL"


class TestBandStats:
    def test_full_stats(self):
        rows = make_rows(6, 4)   # 60% WR, winners +2R, losers −1R
        s = band_stats(rows)
        assert s["n"] == 10
        assert s["wr"] == 60.0
        assert s["exp"] == 0.8          # (6*2 − 4) / 10
        assert s["pf"] == 3.0           # 12 / 4
        assert s["avg_winner"] == 2.0
        assert s["avg_loser"] == -1.0
        assert s["mean_stated"] == 95.0
        assert s["low_sample"] is True  # n < 30

    def test_no_losses_pf_none(self):
        s = band_stats(make_rows(5, 0))
        assert s["pf"] is None
        assert s["wr"] == 100.0


class TestDrift:
    def test_drift_is_actual_minus_stated(self):
        # stated 95, actual WR 40% → drift = −55 (the audit's inversion signature)
        table = compute_band_table(make_rows(40, 60, conf=95))
        s = table["95-100"]
        assert s["empirical_confidence"] == 40
        assert s["drift"] == -55.0
        assert s["low_sample"] is False

    def test_dimension_drift_suppresses_small_cells(self):
        rows = make_rows(4, 4, conf=95, regime="BEAR_TREND")        # n=8 < 10 → dropped
        rows += make_rows(30, 10, conf=88, regime="SIDEWAYS")       # n=40 → kept
        out = compute_dimension_drift(rows, "market_regime")
        assert "BEAR_TREND" not in out
        assert out["SIDEWAYS"]["85-89"]["n"] == 40


class TestInsights:
    def test_overrated_underrated_best_worst(self):
        rows = (
            make_rows(20, 25, conf=96)   # 95-100: WR 44 → drift ≈ −52 (overrated)
            + make_rows(30, 14, conf=87) # 85-89:  WR 68 → drift ≈ −19 (least bad → "underrated")
        )
        ins = compute_insights(compute_band_table(rows))
        assert ins["insufficient_data"] is False
        assert ins["most_overrated"]["band"] == "95-100"
        assert ins["most_underrated"]["band"] == "85-89"
        assert ins["best_actual"]["band"] == "85-89"
        assert ins["worst_actual"]["band"] == "95-100"

    def test_low_sample_bands_excluded(self):
        ins = compute_insights(compute_band_table(make_rows(5, 5, conf=96)))  # n=10 < 30
        assert ins["insufficient_data"] is True


class TestEmpiricalLookup:
    def test_l1_most_specific_wins(self):
        rows = make_rows(40, 10, conf=96, regime="BEAR_TREND", stype="SELL")  # 80% WR
        lookup = build_empirical_lookup(rows)
        res = empirical_confidence_for(96, "BEAR_TREND", "SELL", lookup)
        assert res["level"] == "L1"
        assert res["empirical_confidence"] == 80
        assert res["n"] == 50

    def test_fallback_to_band_then_global(self):
        rows = make_rows(40, 10, conf=96, regime="BEAR_TREND", stype="SELL")
        lookup = build_empirical_lookup(rows)
        # Unknown regime/type → falls through L1/L2 to L3 (band)
        res = empirical_confidence_for(96, "BULL_TREND", "BUY", lookup)
        assert res["level"] == "L3"
        # Unknown band entirely → global
        res = empirical_confidence_for(70, "BULL_TREND", "BUY", lookup)
        assert res["level"] == "L4"
        assert res["empirical_confidence"] == 80

    def test_small_cells_excluded_from_levels(self):
        rows = make_rows(5, 5, conf=96)   # n=10 < MIN_RELIABLE_N
        lookup = build_empirical_lookup(rows)
        assert lookup["L1"] == {}
        assert lookup["L3"] == {}
        # global always present
        assert "__global__" in lookup["L4"]

    def test_spec_example_shape(self):
        # "confidence = 95 → empirical_confidence = 47"
        rows = make_rows(47, 53, conf=95)
        res = empirical_confidence_for(95, None, None, build_empirical_lookup(rows))
        assert res["empirical_confidence"] == 47
        assert res["stated"] == 95


class TestFlag:
    def test_flag_defaults_off(self):
        assert FeatureFlags().confidence_calibration_v2 is False

    def test_min_reliable_n(self):
        assert MIN_RELIABLE_N == 30
