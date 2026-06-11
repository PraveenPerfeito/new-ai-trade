"""
PHASE.9.P0.EXPECTANCY.RECOVERY.1 — unit tests.

WS2 OUTPUT.COLLAPSE.ALERT.1   — breach decision boundaries
WS3 KLINE.EMPTY.TELEMETRY.1   — gate keys wired through metrics + orchestrator
WS4 EARLY.BREAKOUT.PENALTY.1  — pure penalty function + flag default OFF
WS5 BB.EXPANSION.RETIREMENT.1 — regression lock: pure BB expansion never classifies
WS6 ATTRIBUTION.SNAPSHOTS.1   — pure aggregation correctness + flag default ON
"""
from __future__ import annotations

import pytest

from backend.core.scanner.models import Candle, SignalType
from backend.system_settings.groups import FeatureFlags

BUY, SELL = SignalType.BUY, SignalType.SELL


# ── WS2: output collapse decision ─────────────────────────────────────────────

class TestOutputCollapseDecision:
    def _eval(self, signals_24h, avg_7d):
        from backend.analytics.monitoring import evaluate_output_collapse
        return evaluate_output_collapse(signals_24h, avg_7d)

    def test_collapse_detected_below_25_pct(self):
        # June 6–9 signature: ~180/day baseline, 2 signals in 24h
        assert self._eval(2, 180.0) is True

    def test_exactly_25_pct_is_not_breach(self):
        assert self._eval(25, 100.0) is False   # < is strict

    def test_just_below_25_pct_is_breach(self):
        assert self._eval(24, 100.0) is True

    def test_healthy_output_no_breach(self):
        assert self._eval(150, 180.0) is False

    def test_thin_baseline_guard(self):
        # Cold start / fresh deploy: baseline < 3/day → never breach
        assert self._eval(0, 2.9) is False
        assert self._eval(0, 0.0) is False

    def test_baseline_at_floor_evaluates(self):
        assert self._eval(0, 3.0) is True

    def test_flag_defaults_on(self):
        # Observability flag ships enabled — the original incident was silence
        assert FeatureFlags().output_collapse_alert is True


# ── WS3: kline telemetry wiring ───────────────────────────────────────────────

class TestKlineTelemetry:
    def test_keys_in_scan_metrics(self):
        from backend.analytics.scan_metrics import GATE_REJECTION_KEYS
        assert "KLINE_EMPTY" in GATE_REJECTION_KEYS
        assert "KLINE_PARTIAL" in GATE_REJECTION_KEYS

    def test_aliases_normalize(self):
        from backend.analytics.scan_metrics import _GATE_ALIASES
        assert _GATE_ALIASES["kline_empty"] == "KLINE_EMPTY"
        assert _GATE_ALIASES["kline_partial"] == "KLINE_PARTIAL"

    def test_keys_persisted_per_scan(self):
        from backend.core.scanner.orchestrator import _new_gate_rejections
        rejections = _new_gate_rejections()
        assert rejections["KLINE_EMPTY"] == 0
        assert rejections["KLINE_PARTIAL"] == 0


# ── WS4: early breakout BUY penalty ───────────────────────────────────────────

class TestEarlyBreakoutPenalty:
    def _adj(self, flag_on, signal_type, strength):
        from backend.core.scanner.signal_pipeline import early_breakout_score_adj
        return early_breakout_score_adj(flag_on, signal_type, strength)

    def test_flag_defaults_off(self):
        assert FeatureFlags().early_breakout_penalty_v1 is False

    def test_penalty_applies_buy_early_flag_on(self):
        assert self._adj(True, BUY, "EARLY_BREAKOUT") == -8

    def test_no_penalty_when_flag_off(self):
        assert self._adj(False, BUY, "EARLY_BREAKOUT") == 0

    def test_no_penalty_for_sell_early(self):
        # SELL-side EARLY is alpha (WR 68%) — must never be penalised
        assert self._adj(True, SELL, "EARLY_BREAKOUT") == 0

    @pytest.mark.parametrize("strength", [None, "NONE", "CONFIRMED_BREAKOUT", "HIGH_MOMENTUM_BREAKOUT"])
    def test_no_penalty_for_other_strengths(self, strength):
        assert self._adj(True, BUY, strength) == 0


# ── WS5: bb_expansion retirement regression lock ──────────────────────────────

def _candle(open_, high, low, close, volume, idx):
    base = 1_700_000_000_000 + idx * 3_600_000
    return Candle(open_time=base, open=open_, high=high, low=low,
                  close=close, volume=volume, close_time=base + 3_599_999)


class TestBbExpansionRetired:
    """Pure BB expansion (no price-structure break) must NEVER classify as a breakout.

    Audited cohort: standalone bb_expansion WR=20.6%, Exp=−0.372R (n=68)."""

    def _build_candles(self):
        # 1h: 46 quiet candles (tight range = squeeze), then 4 wide candles
        # (BB expansion) — close stays at 100 so no 20d/30d structure break.
        candles_1h = [
            _candle(100.0, 100.05, 99.95, 100.0, 100.0, i) for i in range(46)
        ] + [
            _candle(100.0, 101.5, 98.5, 100.0, 100.0, 46 + i) for i in range(4)
        ]
        # 1d: 40 flat candles, every close identical → current close can never
        # exceed the prior 20d/30d max or undercut the min.
        candles_1d = [
            _candle(100.0, 104.0, 96.0, 100.0, 1000.0, i) for i in range(40)
        ]
        return candles_1d, candles_1h

    @pytest.mark.parametrize("signal_type", [BUY, SELL])
    def test_pure_bb_expansion_never_classifies(self, signal_type):
        from backend.core.scanner.breakout_intelligence import (
            BreakoutStrength,
            detect_breakout_strength,
        )
        candles_1d, candles_1h = self._build_candles()
        result = detect_breakout_strength(candles_1d, candles_1h, signal_type)
        assert result.strength == BreakoutStrength.NONE
        assert result.breakout_type != "bb_expansion"

    def test_bb_expansion_only_appears_combined_with_structure_break(self):
        # Static lock: the only classification path emitting "bb_expansion" in a
        # breakout_type must be the HIGH_MOMENTUM "<structure>+bb_expansion" combo.
        import inspect
        from backend.core.scanner import breakout_intelligence
        src = inspect.getsource(breakout_intelligence)
        assert 'breakout_type = "bb_expansion"' not in src
        assert "+bb_expansion" in src   # combined form still exists (HIGH_MOMENTUM)


# ── WS6: attribution snapshots aggregation ────────────────────────────────────

class TestAttributionSnapshots:
    def test_flag_defaults_on(self):
        assert FeatureFlags().attribution_snapshots is True

    def test_conf_band(self):
        # Unified with CONFIDENCE.CALIBRATION.2 spec banding
        from backend.analytics.outcome_learning import conf_band
        assert conf_band(None) == "NULL"
        assert conf_band(79) == "<80"
        assert conf_band(84) == "80-84"
        assert conf_band(85) == "85-89"
        assert conf_band(94) == "90-94"
        assert conf_band(95) == "95-100"
        assert conf_band(100) == "95-100"

    def test_trend_tier(self):
        from backend.analytics.outcome_learning import trend_tier
        assert trend_tier(None) == "NULL"
        assert trend_tier(90) == "ELITE"
        assert trend_tier(40) == "WEAK"

    def test_aggregate_rows_min_n_and_stats(self):
        from backend.analytics.outcome_learning import aggregate_rows, MIN_CELL_N
        # 12 BEAR SELL wins at +2R, 8 SIDEWAYS BUY losses at −1R (below MIN_CELL_N)
        rows = [
            {"outcome": "TP_HIT", "rr_achieved": 2.0, "market_regime": "BEAR_TREND",
             "signal_type": "SELL", "risk_grade": "A", "breakout_strength": None,
             "oi_interpretation": None, "funding_trend": None, "positioning_context": None,
             "trend_score": None, "scanner_mode": "spot", "confidence": 84}
            for _ in range(12)
        ] + [
            {"outcome": "SL_HIT", "rr_achieved": -1.0, "market_regime": "SIDEWAYS",
             "signal_type": "BUY", "risk_grade": "B", "breakout_strength": None,
             "oi_interpretation": None, "funding_trend": None, "positioning_context": None,
             "trend_score": None, "scanner_mode": "spot", "confidence": 90}
            for _ in range(MIN_CELL_N - 2)
        ]
        tuples = aggregate_rows(rows, window_days=7)
        cells = {(t[1], t[2]): t for t in tuples}

        # The 12-row BEAR|SELL cell survives with perfect stats
        key = ("regime|type", "BEAR_TREND|SELL")
        assert key in cells
        _, _, _, n, tp, sl, wr, exp, pf = cells[key]
        assert (n, tp, sl) == (12, 12, 0)
        assert wr == 100.0
        assert exp == 2.0
        assert pf is None   # no losses → undefined profit factor

        # The 8-row SIDEWAYS|BUY cell is dropped (below MIN_CELL_N)
        assert ("regime|type", "SIDEWAYS|BUY") not in cells

    def test_dimension_sets_include_probability_lookup_triple(self):
        from backend.analytics.outcome_learning import DIMENSION_SETS
        assert "regime|type|breakout" in DIMENSION_SETS
