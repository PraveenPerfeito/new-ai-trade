"""
Comprehensive tests for backend/analytics/expectancy.py.
All inputs are synthetic and expected values are derived from first principles.
"""
from __future__ import annotations

import math
import pytest

from backend.analytics.expectancy import (
    win_rate,
    expectancy,
    profit_factor,
    max_drawdown,
    sharpe_ratio,
    compute_stats,
    _empty_stats,
)


# ── win_rate ──────────────────────────────────────────────────────────────────

class TestWinRate:
    def test_zero_total(self):
        assert win_rate(0, 0) == 0.0

    def test_all_wins(self):
        assert win_rate(10, 10) == 1.0

    def test_all_losses(self):
        assert win_rate(0, 10) == 0.0

    def test_half_wins(self):
        assert win_rate(5, 10) == 0.5

    def test_fractional(self):
        result = win_rate(3, 7)
        assert abs(result - 3 / 7) < 1e-9


# ── expectancy ────────────────────────────────────────────────────────────────

class TestExpectancy:
    def test_empty_both(self):
        assert expectancy([], []) == 0.0

    def test_perfect_wins_no_losses(self):
        # E = 1.0 * 2.0 - 0 = 2.0
        result = expectancy([2.0, 2.0, 2.0], [])
        assert abs(result - 2.0) < 1e-9

    def test_perfect_losses_no_wins(self):
        # E = 0 - 1.0 * 1.0 = -1.0
        result = expectancy([], [-1.0, -1.0, -1.0])
        assert abs(result - (-1.0)) < 1e-9

    def test_balanced_known_value(self):
        # win_rate=0.5, avg_win=2.0, avg_loss=1.0
        # E = 0.5*2.0 - 0.5*1.0 = 0.5
        result = expectancy([2.0, 2.0], [-1.0, -1.0])
        assert abs(result - 0.5) < 1e-9

    def test_negative_expectancy(self):
        # win_rate=0.3, avg_win=1.0, avg_loss=2.0
        # E = 0.3*1.0 - 0.7*2.0 = 0.3 - 1.4 = -1.1
        result = expectancy([1.0, 1.0, 1.0], [-2.0, -2.0, -2.0, -2.0, -2.0, -2.0, -2.0])
        assert result < 0

    def test_asymmetric_rr(self):
        # 40% win rate, avg win 3R, avg loss 1R
        # E = 0.4*3 - 0.6*1 = 1.2 - 0.6 = 0.6
        wins  = [3.0] * 4
        losses = [-1.0] * 6
        result = expectancy(wins, losses)
        assert abs(result - 0.6) < 1e-9

    def test_single_win(self):
        result = expectancy([5.0], [])
        assert result == 5.0

    def test_single_loss(self):
        result = expectancy([], [-2.0])
        assert result == -2.0


# ── profit_factor ─────────────────────────────────────────────────────────────

class TestProfitFactor:
    def test_no_losses_infinite(self):
        result = profit_factor([1.0, 2.0], [])
        assert result == float("inf")

    def test_no_wins(self):
        result = profit_factor([], [-1.0, -2.0])
        assert result == 0.0

    def test_break_even(self):
        result = profit_factor([3.0], [-3.0])
        assert abs(result - 1.0) < 1e-9

    def test_profitable(self):
        # gross_profit=6, gross_loss=3 → PF=2.0
        result = profit_factor([2.0, 4.0], [-1.0, -2.0])
        assert abs(result - 2.0) < 1e-9

    def test_losing(self):
        # gross_profit=1, gross_loss=2 → PF=0.5
        result = profit_factor([1.0], [-2.0])
        assert abs(result - 0.5) < 1e-9


# ── max_drawdown ──────────────────────────────────────────────────────────────

class TestMaxDrawdown:
    def test_empty(self):
        assert max_drawdown([]) == 0.0

    def test_all_wins_no_drawdown(self):
        assert max_drawdown([1.0, 1.0, 1.0]) == 0.0

    def test_single_loss(self):
        assert max_drawdown([-2.0]) == 2.0

    def test_peak_then_valley(self):
        # cumulative: 1, 2, 3, 1, -1 → peak=3, min after=−1 → dd=4
        result = max_drawdown([1.0, 1.0, 1.0, -2.0, -2.0])
        assert result == 4.0

    def test_recovers_then_new_dd(self):
        # cum: 2, 1, 4, -1 → peak progresses: 2, 2, 4, 4
        # drawdowns: 0, 1, 0, 5  → max = 5.0  (peak=4, trough=-1)
        result = max_drawdown([2.0, -1.0, 3.0, -5.0])
        assert result == 5.0

    def test_all_losses_from_zero(self):
        # Starting peak=0; cum: -1,-2,-3 → drawdowns from zero: 1,2,3 → max=3.0
        result = max_drawdown([-1.0, -1.0, -1.0])
        assert result == 3.0

    def test_alternating(self):
        # 1,-1,1,-1 → cum: 1,0,1,0 → peak=1, max valley=0 → dd=1
        result = max_drawdown([1.0, -1.0, 1.0, -1.0])
        assert result == 1.0


# ── sharpe_ratio ──────────────────────────────────────────────────────────────

class TestSharpeRatio:
    def test_fewer_than_two_samples(self):
        assert sharpe_ratio([1.0], 24.0) == 0.0

    def test_zero_duration(self):
        assert sharpe_ratio([1.0, 2.0], 0.0) == 0.0

    def test_zero_std(self):
        # all returns identical → std=0 → sharpe=0
        assert sharpe_ratio([1.0, 1.0, 1.0], 24.0) == 0.0

    def test_positive_sharpe(self):
        # Consistent positive returns → positive Sharpe
        result = sharpe_ratio([2.0, 2.0, 2.0, 2.0, 1.9, 2.1], 24.0)
        assert result > 0

    def test_negative_mean(self):
        # Consistent losses → negative Sharpe
        result = sharpe_ratio([-1.0, -1.1, -0.9, -1.0], 48.0)
        assert result < 0

    def test_shorter_duration_higher_sharpe(self):
        # Same R-series but shorter holding → more trades/year → higher annualised
        rr = [1.0, 0.8, 1.2, 0.9, 1.1]
        s24  = sharpe_ratio(rr, 24.0)
        s48  = sharpe_ratio(rr, 48.0)
        assert s24 > s48


# ── compute_stats ─────────────────────────────────────────────────────────────

def _make_outcome(outcome: str, rr: float, hours: float = 24.0) -> dict:
    return {"outcome": outcome, "rr_achieved": rr, "duration_hours": hours}


class TestComputeStats:
    def test_empty_returns_zeros(self):
        result = compute_stats([])
        assert result["total_signals"] == 0
        assert result["win_rate"] == 0.0
        assert result["expectancy"] == 0.0

    def test_pending_excluded(self):
        outcomes = [
            _make_outcome("PENDING", 0.0),
            _make_outcome("TP_HIT", 2.0),
        ]
        result = compute_stats(outcomes)
        assert result["total_signals"] == 1  # PENDING excluded

    def test_all_tp_hits(self):
        outcomes = [_make_outcome("TP_HIT", 2.0) for _ in range(5)]
        result = compute_stats(outcomes)
        assert result["total_signals"] == 5
        assert result["tp_hits"] == 5
        assert result["sl_hits"] == 0
        assert result["win_rate"] == 1.0
        assert result["tp_rate"] == 1.0
        assert abs(result["avg_rr_achieved"] - 2.0) < 1e-6

    def test_all_sl_hits(self):
        outcomes = [_make_outcome("SL_HIT", -1.0) for _ in range(4)]
        result = compute_stats(outcomes)
        assert result["total_signals"] == 4
        assert result["win_rate"] == 0.0
        assert result["sl_hits"] == 4
        assert result["expectancy"] < 0

    def test_mixed_50pct_win(self):
        outcomes = [
            _make_outcome("TP_HIT", 2.0),
            _make_outcome("TP_HIT", 2.0),
            _make_outcome("SL_HIT", -1.0),
            _make_outcome("SL_HIT", -1.0),
        ]
        result = compute_stats(outcomes)
        assert result["total_signals"] == 4
        assert result["win_rate"] == 0.5
        # E = 0.5*2 - 0.5*1 = 0.5
        assert abs(result["expectancy"] - 0.5) < 1e-4
        # PF = 4/2 = 2.0
        assert abs(result["profit_factor"] - 2.0) < 1e-4

    def test_timeout_counts_as_loss(self):
        outcomes = [
            _make_outcome("TP_HIT", 2.0),
            _make_outcome("TIMEOUT", -0.3),
        ]
        result = compute_stats(outcomes)
        assert result["timeouts"] == 1
        assert result["win_rate"] == 0.5

    def test_missing_rr_handled(self):
        outcomes = [
            {"outcome": "TP_HIT", "rr_achieved": None, "duration_hours": 12.0},
            _make_outcome("TP_HIT", 2.0),
        ]
        result = compute_stats(outcomes)
        assert result["total_signals"] == 2
        assert result["avg_rr_achieved"] == 2.0  # only the non-None entry

    def test_drawdown_monotone_winning(self):
        outcomes = [_make_outcome("TP_HIT", 1.0) for _ in range(10)]
        result = compute_stats(outcomes)
        assert result["max_drawdown_r"] == 0.0

    def test_profit_factor_none_on_no_losses(self):
        outcomes = [_make_outcome("TP_HIT", 2.0) for _ in range(3)]
        result = compute_stats(outcomes)
        assert result["profit_factor"] is None  # infinite → serialised as None

    def test_avg_duration_correct(self):
        outcomes = [
            _make_outcome("TP_HIT", 2.0, hours=10.0),
            _make_outcome("SL_HIT", -1.0, hours=20.0),
        ]
        result = compute_stats(outcomes)
        assert result["avg_duration_hours"] == 15.0

    def test_realistic_scenario(self):
        # 60% win rate, avg win 2.1R, avg loss -1R, 20 trades
        wins   = [_make_outcome("TP_HIT",  2.1, hours=36.0) for _ in range(12)]
        losses = [_make_outcome("SL_HIT", -1.0, hours=18.0) for _ in range(8)]
        result = compute_stats(wins + losses)
        assert result["total_signals"] == 20
        assert result["win_rate"] == 0.6
        assert result["expectancy"] > 0
        assert result["profit_factor"] is not None
        assert result["profit_factor"] > 1.0
        assert result["sharpe_ratio"] != 0.0
