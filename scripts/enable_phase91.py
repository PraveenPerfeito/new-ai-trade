"""
PHASE.9.1 activation — seed first attribution snapshot generation + enable flags.

Steps:
  1. Verify attribution_snapshots table exists (P0 migration)
  2. Seed the first snapshot generation NOW (instead of waiting for 00:15 UTC)
  3. Spot-check the probability lookup the gate will use
  4. Enable flags via the settings service (safety checks + audit log + pub/sub)
  5. Read back and report
"""
from __future__ import annotations

import asyncio
import sys

sys.path.insert(0, ".")


async def main() -> None:
    from backend.database.session import get_pool
    pool = await get_pool()

    # ── 1. Verify tables ──────────────────────────────────────────────────────
    for table in ("attribution_snapshots",):
        exists = await pool.fetchval(
            "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = $1)", table,
        )
        print(f"table {table}: {'EXISTS' if exists else 'MISSING'}")
        if not exists:
            print("ABORT: run database/attribution-snapshots-migration.sql first")
            return
    for col in ("empirical_wr", "empirical_n"):
        exists = await pool.fetchval(
            """SELECT EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = 'signals' AND column_name = $1)""", col,
        )
        print(f"signals.{col}: {'EXISTS' if exists else 'MISSING'}")

    # ── 2. Seed first snapshot generation ─────────────────────────────────────
    from backend.analytics.outcome_learning import compute_snapshots
    result = await compute_snapshots()
    print(f"snapshot seed: {result}")

    # ── 3. Spot-check the probability lookup ──────────────────────────────────
    from backend.analytics.probability import get_probability_lookup, lookup_empirical
    lookup = await get_probability_lookup()
    print(f"lookup cells loaded (n>=30): {len(lookup)}")
    for regime, stype, br in [
        ("BEAR_TREND", "SELL", "CONFIRMED_BREAKOUT"),
        ("BEAR_TREND", "SELL", None),
        ("BEAR_TREND", "BUY", None),
        ("SIDEWAYS",   "SELL", None),
    ]:
        wr, n = lookup_empirical(lookup, regime, stype, br)
        print(f"  {regime} | {stype} | {br or 'NULL'}  ->  wr={wr} n={n}")

    # ── 4. Enable flags through the settings service ──────────────────────────
    from backend.system_settings.service import get_settings_service
    svc = get_settings_service()
    for key in (
        "confidence_calibration_v2",   # read-only analytics section
        "probability_gate_enabled",    # PHASE.9.1 Telegram delivery gate
        "regime_hard_gate_v2",         # symmetric contra-regime gate with overrides
        "early_breakout_penalty_v1",   # -8 setup score on EARLY BUY
    ):
        try:
            res = await svc.patch_group("features", {key: True}, updated_by="phase91-activation")
            print(f"flag {key}: ON (data_version {res.get('data_version')})")
        except Exception as exc:
            print(f"flag {key}: FAILED — {exc}")

    # ── 5. Read back ──────────────────────────────────────────────────────────
    from backend.system_settings.groups import FeatureFlags, ScannerSettings
    flags = await svc.get_group(FeatureFlags)
    scanner = await svc.get_group(ScannerSettings)
    print("\nfinal state:")
    print(f"  confidence_calibration_v2 = {flags.confidence_calibration_v2}")
    print(f"  probability_gate_enabled  = {flags.probability_gate_enabled}")
    print(f"  regime_hard_gate_v2       = {flags.regime_hard_gate_v2}")
    print(f"  early_breakout_penalty_v1 = {flags.early_breakout_penalty_v1}")
    print(f"  high_confidence_mode_enabled = {flags.high_confidence_mode_enabled} (left as-is)")
    print(f"  apply_founder_thresholds  = {flags.apply_founder_thresholds} (left OFF — set values first)")
    print(f"  scanner.min_empirical_wr  = {scanner.min_empirical_wr}")


if __name__ == "__main__":
    asyncio.run(main())
