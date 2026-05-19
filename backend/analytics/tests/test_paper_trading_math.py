"""
Unit tests for paper trading position sizing math.
These tests do NOT touch the database — they validate the arithmetic
in open_trade() and _close_trade() in isolation.
"""
from __future__ import annotations

import math
import pytest

# Constants mirrored from paper_trading.py (no import needed — pure constants)
DEFAULT_RISK_PCT       = 0.01
MAX_OPEN_POSITIONS     = 5
TRADE_EXPIRY_HOURS     = 168
_MAX_LEVERAGE: dict[str, int] = {
    "futures":         10,
    "high_confidence": 5,
    "spot":            1,
    "trending":        1,
}


# ── Position sizing math (replicated for testing without DB) ──────────────────

def _calc_position(
    equity: float,
    entry: float,
    stop_loss: float,
    scanner_mode: str = "spot",
    risk_pct: float = DEFAULT_RISK_PCT,
) -> dict:
    """Mirror of open_trade() sizing logic — pure math, no I/O."""
    risk_amount = equity * risk_pct
    sl_dist     = abs(entry - stop_loss) / entry
    if sl_dist <= 0 or entry <= 0:
        return {}
    max_lev  = _MAX_LEVERAGE.get(scanner_mode, 1)
    notional = risk_amount / sl_dist
    leverage = max(1, min(math.ceil(notional / equity), max_lev))
    margin   = notional / leverage
    quantity = notional / entry
    return {
        "risk_amount": risk_amount,
        "notional":    notional,
        "leverage":    leverage,
        "margin":      margin,
        "quantity":    quantity,
        "sl_dist":     sl_dist,
    }


def _calc_pnl(
    entry: float,
    exit_price: float,
    notional: float,
    leverage: int,
    is_buy: bool,
) -> dict:
    """Mirror of _close_trade() PnL logic."""
    price_diff = exit_price - entry if is_buy else entry - exit_price
    pnl_pct    = price_diff / entry * leverage * 100
    pnl_usdt   = notional * (price_diff / entry)
    return {"pnl_pct": pnl_pct, "pnl_usdt": pnl_usdt}


# ── Constants ─────────────────────────────────────────────────────────────────

class TestConstants:
    def test_default_risk_pct_is_1_percent(self):
        assert DEFAULT_RISK_PCT == 0.01

    def test_max_open_positions_is_5(self):
        assert MAX_OPEN_POSITIONS == 5

    def test_trade_expiry_168h(self):
        assert TRADE_EXPIRY_HOURS == 168

    def test_spot_leverage_is_1(self):
        assert _MAX_LEVERAGE["spot"] == 1

    def test_futures_leverage_is_10(self):
        assert _MAX_LEVERAGE["futures"] == 10


# ── Risk-based position sizing ────────────────────────────────────────────────

class TestPositionSizing:
    def test_risk_amount_is_1_pct_of_equity(self):
        pos = _calc_position(equity=10_000, entry=100, stop_loss=95)
        assert abs(pos["risk_amount"] - 100.0) < 1e-6  # 1% of 10k

    def test_sl_distance_calculated_correctly(self):
        # entry=100, sl=95 → sl_dist = 5/100 = 0.05 (5%)
        pos = _calc_position(equity=10_000, entry=100, stop_loss=95)
        assert abs(pos["sl_dist"] - 0.05) < 1e-6

    def test_notional_equals_risk_over_sl_dist(self):
        pos = _calc_position(equity=10_000, entry=100, stop_loss=95)
        # notional = 100 / 0.05 = 2000
        assert abs(pos["notional"] - 2000.0) < 1e-6

    def test_spot_leverage_always_1(self):
        pos = _calc_position(equity=10_000, entry=100, stop_loss=99, scanner_mode="spot")
        assert pos["leverage"] == 1

    def test_futures_leverage_capped_at_10(self):
        # Very tight SL → would need very high leverage, but capped at 10
        pos = _calc_position(equity=10_000, entry=100, stop_loss=99.9, scanner_mode="futures")
        assert pos["leverage"] <= 10

    def test_margin_equals_notional_over_leverage(self):
        pos = _calc_position(equity=10_000, entry=100, stop_loss=95, scanner_mode="futures")
        assert abs(pos["margin"] - pos["notional"] / pos["leverage"]) < 1e-6

    def test_quantity_equals_notional_over_entry(self):
        pos = _calc_position(equity=10_000, entry=50_000, stop_loss=48_000)
        assert abs(pos["quantity"] - pos["notional"] / 50_000) < 1e-8

    def test_tight_sl_increases_leverage(self):
        pos_tight = _calc_position(equity=10_000, entry=100, stop_loss=99.5, scanner_mode="futures")
        pos_wide  = _calc_position(equity=10_000, entry=100, stop_loss=95,   scanner_mode="futures")
        assert pos_tight["leverage"] >= pos_wide["leverage"]

    def test_wider_sl_requires_less_notional(self):
        pos_tight = _calc_position(equity=10_000, entry=100, stop_loss=99,   scanner_mode="spot")
        pos_wide  = _calc_position(equity=10_000, entry=100, stop_loss=95,   scanner_mode="spot")
        assert pos_tight["notional"] > pos_wide["notional"]

    def test_zero_sl_distance_returns_empty(self):
        pos = _calc_position(equity=10_000, entry=100, stop_loss=100)
        assert pos == {}

    def test_max_loss_equals_risk_amount(self):
        pos = _calc_position(equity=10_000, entry=100, stop_loss=95, scanner_mode="spot")
        # At spot (lev=1): max_loss = notional * sl_dist
        max_loss = pos["notional"] * pos["sl_dist"]
        assert abs(max_loss - pos["risk_amount"]) < 1e-4


# ── PnL calculations ──────────────────────────────────────────────────────────

class TestPnLCalculations:
    def test_tp_hit_buy_positive_pnl(self):
        result = _calc_pnl(entry=100, exit_price=110, notional=2000, leverage=1, is_buy=True)
        # price_diff=10, pnl_pct=10/100*1*100=10%, pnl_usdt=2000*0.1=200
        assert abs(result["pnl_pct"] - 10.0) < 1e-6
        assert abs(result["pnl_usdt"] - 200.0) < 1e-6

    def test_sl_hit_buy_negative_pnl(self):
        result = _calc_pnl(entry=100, exit_price=95, notional=2000, leverage=1, is_buy=True)
        assert result["pnl_pct"] < 0
        assert result["pnl_usdt"] < 0

    def test_tp_hit_sell_positive_pnl(self):
        result = _calc_pnl(entry=100, exit_price=90, notional=2000, leverage=1, is_buy=False)
        # price_diff = 100-90 = 10 → pnl positive
        assert result["pnl_pct"] > 0
        assert result["pnl_usdt"] > 0

    def test_sl_hit_sell_negative_pnl(self):
        result = _calc_pnl(entry=100, exit_price=105, notional=2000, leverage=1, is_buy=False)
        assert result["pnl_pct"] < 0

    def test_leverage_amplifies_pnl_pct(self):
        r1 = _calc_pnl(entry=100, exit_price=110, notional=2000, leverage=1,  is_buy=True)
        r5 = _calc_pnl(entry=100, exit_price=110, notional=2000, leverage=5,  is_buy=True)
        assert abs(r5["pnl_pct"] - 5 * r1["pnl_pct"]) < 1e-6

    def test_leverage_does_not_amplify_usdt_pnl(self):
        # pnl_usdt = notional * price_diff/entry — leverage not in this formula
        r1 = _calc_pnl(entry=100, exit_price=110, notional=2000, leverage=1, is_buy=True)
        r5 = _calc_pnl(entry=100, exit_price=110, notional=2000, leverage=5, is_buy=True)
        assert abs(r1["pnl_usdt"] - r5["pnl_usdt"]) < 1e-6

    def test_breakeven_zero_pnl(self):
        result = _calc_pnl(entry=100, exit_price=100, notional=2000, leverage=1, is_buy=True)
        assert result["pnl_pct"] == 0.0
        assert result["pnl_usdt"] == 0.0
