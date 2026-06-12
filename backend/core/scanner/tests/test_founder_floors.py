"""
SETTINGS.WIRE.1 — founder threshold floors.

Floors can only TIGHTEN the audited per-mode configs (max for confidence/RR,
min for coin coverage) and the flag defaults OFF so deploy behavior is identical.
"""
from __future__ import annotations

from backend.core.scanner.models import ScannerMode
from backend.core.scanner.orchestrator import apply_founder_floors
from backend.core.scanner.signal_pipeline import CONFIGS
from backend.system_settings.groups import FeatureFlags, ScannerSettings, SignalThresholdSettings

SPOT = CONFIGS[ScannerMode.SPOT]


class TestFloorMath:
    def test_defaults_are_noop_for_every_mode(self):
        # Group defaults (min_confidence=75, alert=85, rr=1.5, coins=100) must
        # leave every audited per-mode config byte-identical.
        s, t = ScannerSettings(), SignalThresholdSettings()
        for mode, cfg in CONFIGS.items():
            floored, alert = apply_founder_floors(
                cfg, 85,
                min_confidence=s.min_confidence,
                alert_confidence=s.alert_confidence,
                min_rr_ratio=t.min_rr_ratio,
                max_coins=s.max_coins_per_run,
            )
            assert floored.min_confidence == cfg.min_confidence, mode
            assert floored.min_rr_ratio == cfg.min_rr_ratio, mode
            assert floored.max_coins_to_scan == cfg.max_coins_to_scan, mode
            assert alert == 85

    def test_floors_tighten(self):
        floored, alert = apply_founder_floors(
            SPOT, 85, min_confidence=90, alert_confidence=92,
            min_rr_ratio=2.5, max_coins=40,
        )
        assert floored.min_confidence == 90       # raised above spot's 85
        assert floored.min_rr_ratio == 2.5        # raised above spot's 2.0
        assert floored.max_coins_to_scan == 40    # reduced below spot's 80
        assert alert == 92

    def test_floors_never_loosen(self):
        # An 'Aggressive' preset writing 72/78/1.5/100 must NOT undo the
        # audited spot minimums (85 conf / 2.0 RR / 80 coins).
        floored, alert = apply_founder_floors(
            SPOT, 85, min_confidence=72, alert_confidence=78,
            min_rr_ratio=1.5, max_coins=100,
        )
        assert floored.min_confidence == SPOT.min_confidence == 85
        assert floored.min_rr_ratio == SPOT.min_rr_ratio == 2.0
        assert floored.max_coins_to_scan == SPOT.max_coins_to_scan == 80
        assert alert == 85

    def test_original_config_not_mutated(self):
        before = SPOT.model_dump()
        apply_founder_floors(SPOT, 85, min_confidence=99, alert_confidence=99,
                             min_rr_ratio=5.0, max_coins=10)
        assert SPOT.model_dump() == before


class TestFlag:
    def test_flag_defaults_off(self):
        assert FeatureFlags().apply_founder_thresholds is False
