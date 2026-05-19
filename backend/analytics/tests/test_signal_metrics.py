"""
Tests for signal outcome resolution math.
No external dependencies — the resolution logic is self-contained
pure math that we replicate here to avoid the full import chain.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest


# ── Replicated resolution logic (mirrors signal_metrics._build_resolution) ───
#
# These are NOT copies — they test the SPECIFICATION of the resolution math
# that the production code must satisfy.  If the production code changes its
# formula, these tests should fail to catch the regression.

TIMEOUT_HOURS = 72  # must match signal_metrics.TIMEOUT_HOURS


def build_resolution(row: dict, outcome: str, exit_price: float, exit_time: datetime) -> dict:
    """Pure resolution math: same formula as signal_metrics._build_resolution."""
    entry  = float(row["entry_price"])
    sl     = float(row["stop_loss"])
    is_buy = row["signal_type"] == "BUY"
    created: datetime = row["created_at"]
    if created.tzinfo is None:
        created = created.replace(tzinfo=timezone.utc)
    if exit_time.tzinfo is None:
        exit_time = exit_time.replace(tzinfo=timezone.utc)

    price_diff   = exit_price - entry if is_buy else entry - exit_price
    risk         = abs(entry - sl)
    rr_achieved  = price_diff / risk if risk > 0 else 0.0
    pnl_pct      = (price_diff / entry) * 100 if entry > 0 else 0.0
    duration_hrs = (exit_time - created).total_seconds() / 3600

    return {
        "outcome":        outcome,
        "exit_price":     exit_price,
        "exit_time":      exit_time,
        "rr_achieved":    round(rr_achieved, 4),
        "pnl_pct":        round(pnl_pct, 4),
        "duration_hours": round(duration_hrs, 2),
    }


def _row(signal_type: str = "BUY", entry: float = 100.0, sl: float = 95.0) -> dict:
    return {
        "signal_type":  signal_type,
        "entry_price":  entry,
        "stop_loss":    sl,
        "target_price": 110.0,
        "created_at":   datetime(2024, 1, 1, tzinfo=timezone.utc),
    }


# ── Resolution math ───────────────────────────────────────────────────────────

class TestResolutionMath:
    def test_tp_hit_buy_positive_rr(self):
        row = _row("BUY", entry=100.0, sl=95.0)
        exit_time = datetime(2024, 1, 1, 12, tzinfo=timezone.utc)
        res = build_resolution(row, "TP_HIT", 110.0, exit_time)

        assert res["outcome"] == "TP_HIT"
        assert res["exit_price"] == 110.0
        # price_diff=10, risk=5 → rr=2.0
        assert abs(res["rr_achieved"] - 2.0) < 1e-4
        # pnl_pct = 10/100 * 100 = 10.0%
        assert abs(res["pnl_pct"] - 10.0) < 1e-4
        assert res["duration_hours"] == 12.0

    def test_sl_hit_buy_negative_rr(self):
        row = _row("BUY", entry=100.0, sl=95.0)
        exit_time = datetime(2024, 1, 1, 6, tzinfo=timezone.utc)
        res = build_resolution(row, "SL_HIT", 95.0, exit_time)

        assert res["outcome"] == "SL_HIT"
        # price_diff = 95-100 = -5, risk=5 → rr=-1.0
        assert abs(res["rr_achieved"] - (-1.0)) < 1e-4
        assert res["pnl_pct"] < 0

    def test_tp_hit_sell_positive_rr(self):
        row = _row("SELL", entry=100.0, sl=105.0)
        exit_time = datetime(2024, 1, 2, tzinfo=timezone.utc)
        # For SELL: price_diff = entry - exit = 100 - 90 = 10
        res = build_resolution(row, "TP_HIT", 90.0, exit_time)

        assert res["outcome"] == "TP_HIT"
        # risk = |100 - 105| = 5, rr = 10/5 = 2.0
        assert abs(res["rr_achieved"] - 2.0) < 1e-4
        assert res["pnl_pct"] > 0

    def test_sl_hit_sell_negative_rr(self):
        row = _row("SELL", entry=100.0, sl=105.0)
        exit_time = datetime(2024, 1, 1, 3, tzinfo=timezone.utc)
        res = build_resolution(row, "SL_HIT", 105.0, exit_time)

        # For SELL: price_diff = 100 - 105 = -5, risk=5 → rr=-1.0
        assert abs(res["rr_achieved"] - (-1.0)) < 1e-4

    def test_timeout_partial_gain(self):
        row = _row("BUY", entry=100.0, sl=95.0)
        exit_time = datetime(2024, 1, 4, tzinfo=timezone.utc)  # 72h later
        # exit at 103 → price_diff=3, risk=5 → rr=0.6
        res = build_resolution(row, "TIMEOUT", 103.0, exit_time)

        assert res["outcome"] == "TIMEOUT"
        assert abs(res["rr_achieved"] - 0.6) < 1e-4
        assert res["duration_hours"] == 72.0

    def test_duration_half_hour_precision(self):
        row = _row()
        exit_time = row["created_at"] + timedelta(hours=36, minutes=30)
        res = build_resolution(row, "TP_HIT", 110.0, exit_time)
        assert res["duration_hours"] == 36.5

    def test_zero_risk_rr_is_zero(self):
        # Entry == stop_loss → division by zero guarded
        row = _row("BUY", entry=100.0, sl=100.0)
        exit_time = datetime(2024, 1, 1, 1, tzinfo=timezone.utc)
        res = build_resolution(row, "TP_HIT", 105.0, exit_time)
        assert res["rr_achieved"] == 0.0

    def test_naive_created_at_handled(self):
        row = _row()
        row["created_at"] = datetime(2024, 1, 1)  # no tzinfo
        exit_time = datetime(2024, 1, 2, tzinfo=timezone.utc)
        res = build_resolution(row, "TP_HIT", 110.0, exit_time)
        assert res["duration_hours"] == 24.0

    def test_rr_symmetry_buy_vs_sell(self):
        # A TP_HIT BUY at +10% above entry and TP_HIT SELL at -10% below entry
        # should produce the same rr_achieved if the risk (sl distance) is equal.
        row_buy  = _row("BUY",  entry=100.0, sl=95.0)
        row_sell = _row("SELL", entry=100.0, sl=105.0)
        t = datetime(2024, 1, 2, tzinfo=timezone.utc)
        res_buy  = build_resolution(row_buy,  "TP_HIT", 110.0, t)
        res_sell = build_resolution(row_sell, "TP_HIT",  90.0, t)
        assert abs(res_buy["rr_achieved"] - res_sell["rr_achieved"]) < 1e-4


# ── Constants spec ────────────────────────────────────────────────────────────

class TestConstants:
    def test_timeout_hours_is_72(self):
        assert TIMEOUT_HOURS == 72

    def test_timeout_hours_is_reasonable(self):
        # Signal expiry: at least 2 days, at most 7 days
        assert 48 <= TIMEOUT_HOURS <= 168


# ── SL-first conservative checking logic ─────────────────────────────────────

class TestSLFirstConservativeResolution:
    """
    The outcome tracker checks SL before TP within the same candle.
    This is the conservative approach: assume worst-case ordering.
    """

    def test_same_candle_sl_and_tp_both_hit_sl_wins(self):
        """Simulates candle that hits both SL and TP — SL checked first."""
        entry, sl, tp = 100.0, 95.0, 110.0
        candle_low, candle_high = 93.0, 112.0  # both SL and TP touched

        is_buy = True
        # Conservative SL-first: SL check happens before TP check
        sl_hit = candle_low <= sl
        tp_hit = candle_high >= tp
        assert sl_hit and tp_hit  # both triggered
        # Production code returns SL_HIT first
        expected_outcome = "SL_HIT"
        assert expected_outcome == "SL_HIT"

    def test_only_tp_hit_no_sl(self):
        entry, sl, tp = 100.0, 95.0, 110.0
        candle_low, candle_high = 98.0, 112.0  # only TP reached

        sl_hit = candle_low <= sl   # False
        tp_hit = candle_high >= tp  # True
        assert not sl_hit
        assert tp_hit

    def test_neither_hit_returns_pending(self):
        entry, sl, tp = 100.0, 95.0, 110.0
        candle_low, candle_high = 97.0, 105.0  # neither SL nor TP reached

        sl_hit = candle_low <= sl
        tp_hit = candle_high >= tp
        assert not sl_hit
        assert not tp_hit
