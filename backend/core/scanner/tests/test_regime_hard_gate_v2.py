"""
REGIME.HARD.GATE.V2 — unit tests for contra_regime_gate() and the feature flag.

Gate contract:
  BUY  in BEAR_TREND/CAPITULATION → reject unless HIGH_MOMENTUM_BREAKOUT or OI NEW_LONGS
  SELL in BULL_TREND/EUPHORIA     → reject unless HIGH_MOMENTUM_BREAKOUT or OI NEW_SHORTS
  Everything else                 → pass (False)
  NULL regime is owned by the ALPHA.TRUTH.1 gate, not this one.
Flag default OFF → legacy behavior preserved.
"""
from __future__ import annotations

import pytest

from backend.core.scanner.models import SignalType
from backend.core.scanner.signal_pipeline import contra_regime_gate
from backend.system_settings.groups import FeatureFlags

BUY, SELL = SignalType.BUY, SignalType.SELL
HM = "HIGH_MOMENTUM_BREAKOUT"


class TestContraRegimeRejections:
    """Contra-regime signals with no override must be rejected."""

    def test_buy_in_bear_trend_rejected(self):
        assert contra_regime_gate(BUY, "BEAR_TREND", None, None) is True

    def test_buy_in_capitulation_rejected(self):
        assert contra_regime_gate(BUY, "CAPITULATION", None, None) is True

    def test_sell_in_bull_trend_rejected(self):
        assert contra_regime_gate(SELL, "BULL_TREND", None, None) is True

    def test_sell_in_euphoria_rejected(self):
        assert contra_regime_gate(SELL, "EUPHORIA", None, None) is True

    def test_weaker_breakouts_do_not_override(self):
        assert contra_regime_gate(BUY, "BEAR_TREND", "CONFIRMED_BREAKOUT", None) is True
        assert contra_regime_gate(BUY, "BEAR_TREND", "EARLY_BREAKOUT", None) is True
        assert contra_regime_gate(SELL, "BULL_TREND", "CONFIRMED_BREAKOUT", None) is True

    def test_misaligned_oi_does_not_override(self):
        # NEW_SHORTS overrides SELL, not BUY — and vice versa
        assert contra_regime_gate(BUY, "BEAR_TREND", None, "NEW_SHORTS") is True
        assert contra_regime_gate(SELL, "BULL_TREND", None, "NEW_LONGS") is True
        assert contra_regime_gate(BUY, "CAPITULATION", None, "LONG_LIQUIDATION") is True
        assert contra_regime_gate(SELL, "EUPHORIA", None, "NEUTRAL") is True


class TestOverridePaths:
    """HIGH_MOMENTUM breakout or aligned OI lets contra-regime signals through."""

    def test_buy_in_bear_high_momentum_passes(self):
        assert contra_regime_gate(BUY, "BEAR_TREND", HM, None) is False

    def test_buy_in_capitulation_high_momentum_passes(self):
        assert contra_regime_gate(BUY, "CAPITULATION", HM, None) is False

    def test_buy_in_bear_new_longs_passes(self):
        assert contra_regime_gate(BUY, "BEAR_TREND", None, "NEW_LONGS") is False

    def test_buy_in_capitulation_new_longs_passes(self):
        assert contra_regime_gate(BUY, "CAPITULATION", None, "NEW_LONGS") is False

    def test_sell_in_bull_high_momentum_passes(self):
        assert contra_regime_gate(SELL, "BULL_TREND", HM, None) is False

    def test_sell_in_euphoria_high_momentum_passes(self):
        assert contra_regime_gate(SELL, "EUPHORIA", HM, None) is False

    def test_sell_in_bull_new_shorts_passes(self):
        assert contra_regime_gate(SELL, "BULL_TREND", None, "NEW_SHORTS") is False

    def test_sell_in_euphoria_new_shorts_passes(self):
        assert contra_regime_gate(SELL, "EUPHORIA", None, "NEW_SHORTS") is False

    def test_both_overrides_present_passes(self):
        assert contra_regime_gate(BUY, "BEAR_TREND", HM, "NEW_LONGS") is False


class TestAlignedAndNeutralPaths:
    """Aligned and neutral-regime signals are never touched by this gate."""

    def test_sell_in_bear_passes(self):
        assert contra_regime_gate(SELL, "BEAR_TREND", None, None) is False

    def test_sell_in_capitulation_passes(self):
        assert contra_regime_gate(SELL, "CAPITULATION", None, None) is False

    def test_buy_in_bull_passes(self):
        assert contra_regime_gate(BUY, "BULL_TREND", None, None) is False

    def test_buy_in_euphoria_passes(self):
        assert contra_regime_gate(BUY, "EUPHORIA", None, None) is False

    @pytest.mark.parametrize("signal_type", [BUY, SELL])
    @pytest.mark.parametrize("regime", ["SIDEWAYS", "HIGH_VOLATILITY"])
    def test_neutral_regimes_pass(self, signal_type, regime):
        assert contra_regime_gate(signal_type, regime, None, None) is False

    @pytest.mark.parametrize("signal_type", [BUY, SELL])
    def test_null_regime_not_handled_here(self, signal_type):
        # NULL regime belongs to the ALPHA.TRUTH.1 hard gate in scan_coin()
        assert contra_regime_gate(signal_type, None, None, None) is False
        assert contra_regime_gate(signal_type, "", None, None) is False


class TestFeatureFlag:
    """Flag default OFF — existing production behavior unchanged on deploy."""

    def test_flag_defaults_off(self):
        assert FeatureFlags().regime_hard_gate_v2 is False

    def test_flag_is_bool_field(self):
        field = FeatureFlags.model_fields["regime_hard_gate_v2"]
        assert field.annotation is bool
        assert field.default is False


class TestTelemetryKeys:
    """CONTRA_REGIME_REJECTION must be wired through scan metrics + orchestrator."""

    def test_key_in_scan_metrics_canonical_keys(self):
        from backend.analytics.scan_metrics import GATE_REJECTION_KEYS
        assert "CONTRA_REGIME_REJECTION" in GATE_REJECTION_KEYS

    def test_aliases_normalize(self):
        from backend.analytics.scan_metrics import _GATE_ALIASES
        assert _GATE_ALIASES["contra_regime"] == "CONTRA_REGIME_REJECTION"
        assert _GATE_ALIASES["contra_regime_rejection"] == "CONTRA_REGIME_REJECTION"

    def test_key_persisted_per_scan(self):
        from backend.core.scanner.orchestrator import _new_gate_rejections
        assert "CONTRA_REGIME_REJECTION" in _new_gate_rejections()
