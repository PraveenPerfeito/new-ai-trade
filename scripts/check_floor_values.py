"""Verify the founder-floor values now that apply_founder_thresholds is ON."""
from __future__ import annotations

import asyncio
import sys

sys.path.insert(0, ".")


async def main() -> None:
    from backend.system_settings.service import get_settings_service
    from backend.system_settings.groups import ScannerSettings, SignalThresholdSettings
    from backend.core.scanner.orchestrator import apply_founder_floors
    from backend.core.scanner.signal_pipeline import CONFIGS

    svc = get_settings_service()
    s = await svc.get_group(ScannerSettings)
    t = await svc.get_group(SignalThresholdSettings)
    print(f"scanner.min_confidence    = {s.min_confidence}")
    print(f"scanner.alert_confidence  = {s.alert_confidence}")
    print(f"scanner.max_coins_per_run = {s.max_coins_per_run}")
    print(f"signals.min_rr_ratio      = {t.min_rr_ratio}")

    print("\neffective per-mode config with floors applied (alert env base 85):")
    for mode, cfg in CONFIGS.items():
        floored, alert = apply_founder_floors(
            cfg, 85,
            min_confidence=s.min_confidence,
            alert_confidence=s.alert_confidence,
            min_rr_ratio=t.min_rr_ratio,
            max_coins=s.max_coins_per_run,
        )
        delta = []
        if floored.min_confidence != cfg.min_confidence:
            delta.append(f"conf {cfg.min_confidence}->{floored.min_confidence}")
        if floored.min_rr_ratio != cfg.min_rr_ratio:
            delta.append(f"rr {cfg.min_rr_ratio}->{floored.min_rr_ratio}")
        if floored.max_coins_to_scan != cfg.max_coins_to_scan:
            delta.append(f"coins {cfg.max_coins_to_scan}->{floored.max_coins_to_scan}")
        if alert != 85:
            delta.append(f"alert 85->{alert}")
        print(f"  {mode.value:16s} {'no change' if not delta else ', '.join(delta)}")


if __name__ == "__main__":
    asyncio.run(main())
