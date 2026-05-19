"""
Tests for the pure-logic parts of edge_validation.py.

The DB-querying async functions (_fetch_outcomes etc.) are not tested here
— they are integration tests that require a live asyncpg pool.

What we test:
  - _edge_verdict() — the top-line edge verdict logic
  - group_stats integration: 7-analysis outputs are consistent
  - threshold_recommendations() output structure (via mocked inputs)
  - Statistical contracts (calibration monotonicity, CI ordering, etc.)
"""
from __future__ import annotations

import asyncio
import pytest

# Import the pure helpers that don't touch the DB
from backend.analytics.edge_validation import _edge_verdict, threshold_recommendations
from backend.analytics.stats_utils import group_stats, wilson_ci, MIN_SAMPLES


# ── _edge_verdict ─────────────────────────────────────────────────────────────

class TestEdgeVerdict:
    def test_insufficient_data_below_30(self):
        verdict = _edge_verdict(total=10, overall_wr=0.60, overall_exp=0.50)
        assert verdict["has_edge"] is None
        assert verdict["confidence_level"] == "insufficient_data"

    def test_no_edge_low_win_rate(self):
        verdict = _edge_verdict(total=100, overall_wr=0.45, overall_exp=-0.20)
        assert verdict["has_edge"] is False
        assert verdict["confidence_level"] == "none"

    def test_weak_edge_borderline(self):
        verdict = _edge_verdict(total=50, overall_wr=0.52, overall_exp=0.10)
        assert verdict["has_edge"] is True
        assert verdict["confidence_level"] == "weak"

    def test_moderate_edge(self):
        verdict = _edge_verdict(total=100, overall_wr=0.57, overall_exp=0.35)
        assert verdict["has_edge"] is True
        assert verdict["confidence_level"] == "moderate"

    def test_strong_edge(self):
        verdict = _edge_verdict(total=200, overall_wr=0.65, overall_exp=0.60)
        assert verdict["has_edge"] is True
        assert verdict["confidence_level"] == "strong"

    def test_none_win_rate_insufficient_data(self):
        verdict = _edge_verdict(total=100, overall_wr=None, overall_exp=None)
        assert verdict["has_edge"] is None
        assert verdict["confidence_level"] == "insufficient_data"

    def test_summary_is_str(self):
        verdict = _edge_verdict(total=100, overall_wr=0.60, overall_exp=0.40)
        assert isinstance(verdict["summary"], str) and len(verdict["summary"]) > 0

    def test_exactly_30_samples_evaluated(self):
        verdict = _edge_verdict(total=30, overall_wr=0.40, overall_exp=-0.10)
        assert verdict["has_edge"] is False   # not insufficient, has real verdict


# ── threshold_recommendations ─────────────────────────────────────────────────

def _fake_calibration(has_good_band: bool = True, ece: float = 0.04) -> dict:
    bands = []
    for lo, hi in [(70, 75), (75, 80), (80, 85), (85, 90), (90, 95)]:
        if has_good_band and lo >= 80:
            bands.append({
                "label": f"{lo}-{hi}",
                "total": 30,
                "win_rate": 0.60,
                "expectancy": 0.30,
                "insufficient_data": False,
            })
        else:
            bands.append({
                "label": f"{lo}-{hi}",
                "total": 5,
                "win_rate": None,
                "expectancy": None,
                "insufficient_data": True,
            })
    return {
        "bands": bands,
        "calibration": {"ece": ece, "label": "well_calibrated", "is_monotone": True},
    }


def _fake_setup(threshold: int | None = 65) -> dict:
    return {"optimal_threshold": threshold, "bands": []}


def _fake_modes(ranked: list[str], expectations: dict[str, float]) -> dict:
    return {
        "ranked_by_expectancy": ranked,
        "modes": {
            mode: {"expectancy": exp, "total": 30, "insufficient_data": False}
            for mode, exp in expectations.items()
        },
    }


def _fake_regimes(prefer: list[str], avoid: list[str]) -> dict:
    return {"recommended_prefer": prefer, "recommended_avoid": avoid}


def run(coro):
    return asyncio.run(coro)


class TestThresholdRecommendations:
    def test_returns_dict_with_recs_and_warnings(self):
        cal   = _fake_calibration()
        setup = _fake_setup(65)
        modes = _fake_modes(["spot", "futures"], {"spot": 0.4, "futures": 0.2})
        reg   = _fake_regimes(["normal"], ["extreme"])
        result = run(threshold_recommendations(cal, setup, modes, reg))
        assert "recommendations" in result
        assert "warnings" in result
        assert isinstance(result["warnings"], list)

    def test_min_confidence_set_from_bands(self):
        cal   = _fake_calibration(has_good_band=True)
        result = run(threshold_recommendations(
            cal, _fake_setup(), _fake_modes([], {}), _fake_regimes([], [])
        ))
        recs = result["recommendations"]
        assert recs["min_confidence"] is not None
        assert recs["min_confidence"] >= 70

    def test_no_good_bands_null_confidence(self):
        cal   = _fake_calibration(has_good_band=False)
        result = run(threshold_recommendations(
            cal, _fake_setup(None), _fake_modes([], {}), _fake_regimes([], [])
        ))
        recs = result["recommendations"]
        assert recs["min_confidence"] is None
        assert any("confidence" in w.lower() for w in result["warnings"])

    def test_quality_score_threshold_propagated(self):
        cal   = _fake_calibration()
        result = run(threshold_recommendations(
            cal, _fake_setup(65), _fake_modes([], {}), _fake_regimes([], [])
        ))
        assert result["recommendations"]["min_quality_score"] == 65

    def test_recalibrate_flag_set_when_ece_high(self):
        cal   = _fake_calibration(ece=0.20)
        result = run(threshold_recommendations(
            cal, _fake_setup(), _fake_modes([], {}), _fake_regimes([], [])
        ))
        assert result["recommendations"]["recalibrate_confidence"] is True
        assert any("calibration" in w.lower() for w in result["warnings"])

    def test_recalibrate_false_when_ece_good(self):
        cal   = _fake_calibration(ece=0.03)
        result = run(threshold_recommendations(
            cal, _fake_setup(), _fake_modes([], {}), _fake_regimes([], [])
        ))
        assert result["recommendations"]["recalibrate_confidence"] is False

    def test_avoid_modes_with_negative_expectancy(self):
        modes = _fake_modes(["spot"], {"spot": 0.4, "futures": -0.3})
        result = run(threshold_recommendations(
            _fake_calibration(), _fake_setup(),
            modes, _fake_regimes([], [])
        ))
        avoid = result["recommendations"]["avoid_modes"]
        assert "futures" in avoid
        assert "spot" not in avoid

    def test_regime_preferences_propagated(self):
        result = run(threshold_recommendations(
            _fake_calibration(), _fake_setup(),
            _fake_modes([], {}),
            _fake_regimes(prefer=["normal"], avoid=["extreme"]),
        ))
        assert result["recommendations"]["prefer_regimes"] == ["normal"]
        assert result["recommendations"]["avoid_regimes"] == ["extreme"]


# ── Statistical contracts ─────────────────────────────────────────────────────

class TestStatisticalContracts:
    """High-level contracts that must hold regardless of data."""

    def test_wilson_ci_lo_le_hi(self):
        for s in range(0, 21):
            lo, hi = wilson_ci(s, 20)
            assert lo <= hi, f"CI inverted for s={s}, n=20"

    def test_group_stats_win_rate_in_unit_interval(self):
        rows = [
            {"outcome": "TP_HIT", "rr_achieved": 1.0, "duration_hours": 24.0}
            for _ in range(15)
        ] + [
            {"outcome": "SL_HIT", "rr_achieved": -1.0, "duration_hours": 12.0}
            for _ in range(5)
        ]
        stats = group_stats(rows)
        assert 0.0 <= stats["win_rate"] <= 1.0

    def test_group_stats_tp_plus_sl_plus_to_le_total(self):
        rows = (
            [{"outcome": "TP_HIT",  "rr_achieved": 1.5, "duration_hours": 20.0}] * 6
            + [{"outcome": "SL_HIT", "rr_achieved": -1.0, "duration_hours": 10.0}] * 3
            + [{"outcome": "TIMEOUT","rr_achieved":  0.2, "duration_hours": 72.0}] * 1
        )
        s = group_stats(rows)
        assert s["tp_hits"] + s["sl_hits"] + s["timeouts"] == s["total"]

    def test_group_stats_ci_contains_win_rate(self):
        rows = [
            {"outcome": "TP_HIT", "rr_achieved": 2.0, "duration_hours": 24.0}
            for _ in range(12)
        ] + [
            {"outcome": "SL_HIT", "rr_achieved": -1.0, "duration_hours": 12.0}
            for _ in range(8)
        ]
        s = group_stats(rows)
        lo, hi = s["win_rate_ci"]
        assert lo <= s["win_rate"] <= hi

    def test_group_stats_profit_factor_none_when_no_losses(self):
        rows = [{"outcome": "TP_HIT", "rr_achieved": 1.0, "duration_hours": 24.0}] * MIN_SAMPLES
        s = group_stats(rows)
        assert s["profit_factor"] is None

    def test_edge_verdict_has_edge_is_bool_or_none(self):
        for total, wr, exp in [
            (5, 0.60, 0.40),    # insufficient
            (100, 0.65, 0.60),  # strong
            (100, 0.45, -0.30), # no edge
        ]:
            verdict = _edge_verdict(total, wr, exp)
            assert verdict["has_edge"] in (True, False, None)
            assert verdict["confidence_level"] in ("strong", "moderate", "weak", "none", "insufficient_data")
