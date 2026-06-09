"""
Unit tests for backend/core/scanner/risk.py.
Tests cover the full grading matrix, all validators, and edge cases.
"""
from __future__ import annotations

import pytest

from backend.core.scanner.models import (
    Candle,
    CoinData,
    MACDResult,
    RiskGrade,
    RiskInput,
    ScannerMode,
    SignalType,
    TechnicalIndicators,
    TrendDirection,
    ViolationSeverity,
    VolatilityRating,
)
from backend.core.scanner.risk import validate_risk


# ── Fixture builders ──────────────────────────────────────────────────────────

def _ind(
    rsi: float = 60.0,
    hist: float = 0.5,
    volume_spike: float = 2.0,
    trend: TrendDirection = TrendDirection.BULLISH,
) -> TechnicalIndicators:
    return TechnicalIndicators(
        rsi=rsi,
        macd=MACDResult(macd=1.0, signal=0.5, histogram=hist),
        ema20=110.0,
        ema50=100.0,
        atr=2.0,
        volume_spike=volume_spike,
        current_price=115.0,
        trend=trend,
    )


def _coin(volume_24h: float = 100_000_000.0) -> CoinData:
    return CoinData(
        id="bitcoin", symbol="BTCUSDT", name="Bitcoin",
        price=50000.0, market_cap=1e12, volume_24h=volume_24h,
        price_change_24h=2.0, rank=1,
    )


def _good_input(
    entry: float = 100.0,
    sl: float = 97.0,      # 3% stop
    rr: float = 2.5,
    mode: ScannerMode = ScannerMode.SPOT,
    signal_type: SignalType = SignalType.BUY,
    rsi: float = 58.0,
    hist: float = 0.5,
    volume_spike: float = 2.0,
    volatility: VolatilityRating = VolatilityRating.NORMAL,
    volume_24h: float = 100_000_000.0,
    combined_strength: float = 65.0,
    btc_regime: str = "SIDEWAYS",
    breakout_strength: str | None = None,
) -> RiskInput:
    ind_1h = _ind(rsi=rsi, hist=hist, volume_spike=volume_spike)
    ind_4h = _ind(rsi=58.0, hist=0.3)
    return RiskInput(
        entry=entry,
        stop_loss=sl,
        rr_ratio=rr,
        ind_1h=ind_1h,
        ind_4h=ind_4h,
        coin=_coin(volume_24h),
        signal_type=signal_type,
        mode=mode,
        volatility=volatility,
        combined_strength=combined_strength,
        btc_regime=btc_regime,
        breakout_strength=breakout_strength,
    )


# ── Passing / failing basics ──────────────────────────────────────────────────

class TestValidateRiskBasics:
    def test_clean_setup_passes(self):
        result = validate_risk(_good_input())
        assert result.pass_ is True

    def test_clean_setup_grade_a_or_b(self):
        result = validate_risk(_good_input())
        assert result.risk_grade in (RiskGrade.A, RiskGrade.B)

    def test_position_multiplier_positive_on_pass(self):
        result = validate_risk(_good_input())
        assert result.position_size_multiplier > 0

    def test_failed_setup_grade_f(self):
        result = validate_risk(_good_input(sl=99.9, rr=0.5))  # RR 0.5 → critical
        assert result.risk_grade == RiskGrade.F

    def test_failed_setup_position_multiplier_zero(self):
        result = validate_risk(_good_input(sl=99.9, rr=0.5))
        assert result.position_size_multiplier == 0.0


# ── RR validator ──────────────────────────────────────────────────────────────

class TestRRValidation:
    def test_rr_below_critical_threshold_fails(self):
        result = validate_risk(_good_input(rr=1.2))
        assert result.pass_ is False
        codes = [v.code for v in result.violations]
        assert "RR_CRITICAL" in codes

    def test_rr_below_recommended_penalised(self):
        result = validate_risk(_good_input(rr=1.8))
        codes = [v.code for v in result.violations]
        assert "RR_LOW" in codes

    def test_rr_marginal_warning(self):
        result = validate_risk(_good_input(rr=2.2))
        codes = [w.code for w in result.warnings]
        assert "RR_MARGINAL" in codes

    def test_rr_ideal_no_penalty(self):
        result = validate_risk(_good_input(rr=3.5))
        codes = [v.code for v in result.violations] + [w.code for w in result.warnings]
        assert "RR_CRITICAL" not in codes
        assert "RR_LOW" not in codes


# ── Volatility validator ──────────────────────────────────────────────────────

class TestVolatilityValidation:
    def test_extreme_volatility_fails(self):
        result = validate_risk(_good_input(volatility=VolatilityRating.EXTREME))
        assert result.pass_ is False
        codes = [v.code for v in result.violations]
        assert "VOLATILITY_EXTREME" in codes

    def test_high_volatility_warning(self):
        result = validate_risk(_good_input(volatility=VolatilityRating.HIGH))
        codes = [w.code for w in result.warnings]
        assert "VOLATILITY_HIGH" in codes

    def test_normal_volatility_no_penalty(self):
        result = validate_risk(_good_input(volatility=VolatilityRating.NORMAL))
        codes = [v.code for v in result.violations]
        assert "VOLATILITY_EXTREME" not in codes


# ── RSI overextension validator ───────────────────────────────────────────────

class TestOverextensionValidation:
    def test_overbought_critical_fails(self):
        result = validate_risk(_good_input(rsi=82.0))
        assert result.pass_ is False
        codes = [v.code for v in result.violations]
        assert "RSI_OVERBOUGHT_CRITICAL" in codes

    def test_overbought_violation(self):
        result = validate_risk(_good_input(rsi=77.0))
        codes = [v.code for v in result.violations]
        assert "RSI_OVERBOUGHT" in codes

    def test_elevated_rsi_warning(self):
        result = validate_risk(_good_input(rsi=72.0))
        codes = [w.code for w in result.warnings]
        assert "RSI_ELEVATED" in codes

    def test_oversold_buy_no_penalty(self):
        result = validate_risk(_good_input(rsi=58.0, signal_type=SignalType.BUY))
        codes = [v.code for v in result.violations]
        assert "RSI_OVERSOLD_CRITICAL" not in codes

    def test_sell_oversold_critical(self):
        result = validate_risk(_good_input(rsi=18.0, signal_type=SignalType.SELL))
        codes = [v.code for v in result.violations]
        assert "RSI_OVERSOLD_CRITICAL" in codes


# ── Stop distance validator ───────────────────────────────────────────────────

class TestStopDistanceValidation:
    def test_too_tight_stop_fails(self):
        result = validate_risk(_good_input(entry=100.0, sl=99.7))  # 0.3%
        codes = [v.code for v in result.violations]
        assert "STOP_TOO_TIGHT" in codes

    def test_tight_stop_warning(self):
        result = validate_risk(_good_input(entry=100.0, sl=99.3))  # 0.7%
        codes = [w.code for w in result.warnings]
        assert "STOP_TIGHT" in codes

    def test_too_wide_stop_fails(self):
        result = validate_risk(_good_input(entry=100.0, sl=88.0))  # 12%
        codes = [v.code for v in result.violations]
        assert "STOP_TOO_WIDE" in codes


# ── Liquidity validator ───────────────────────────────────────────────────────

class TestLiquidityValidation:
    def test_critical_low_volume_fails(self):
        result = validate_risk(_good_input(volume_24h=5_000_000))
        assert result.pass_ is False
        codes = [v.code for v in result.violations]
        assert "LIQUIDITY_CRITICAL" in codes

    def test_low_volume_violation(self):
        result = validate_risk(_good_input(volume_24h=15_000_000))
        codes = [v.code for v in result.violations]
        assert "LIQUIDITY_LOW" in codes

    def test_weak_volume_spike_warning(self):
        result = validate_risk(_good_input(volume_spike=0.5))
        codes = [w.code for w in result.warnings]
        assert "VOLUME_WEAK" in codes


# ── Grade assignment ──────────────────────────────────────────────────────────

class TestGradeAssignment:
    def test_perfect_conditions_grade_a(self):
        result = validate_risk(_good_input(
            rr=3.5, rsi=58.0, hist=0.8, volume_spike=3.0,
            volatility=VolatilityRating.NORMAL,
            combined_strength=75.0,
        ))
        assert result.risk_grade == RiskGrade.A

    def test_critical_violation_always_grade_f(self):
        result = validate_risk(_good_input(rsi=85.0))
        assert result.risk_grade == RiskGrade.F

    def test_grade_improves_with_better_rr(self):
        r_low  = validate_risk(_good_input(rr=2.0))
        r_high = validate_risk(_good_input(rr=3.5))
        grades = [RiskGrade.A, RiskGrade.B, RiskGrade.C, RiskGrade.D, RiskGrade.F]
        assert grades.index(r_high.risk_grade) <= grades.index(r_low.risk_grade)


# ── Risk/quality score properties ────────────────────────────────────────────

class TestScoreProperties:
    def test_risk_score_bounded(self):
        for rr in [0.5, 1.5, 2.5, 4.0]:
            result = validate_risk(_good_input(rr=rr))
            assert 0 <= result.risk_score <= 100

    def test_quality_score_bounded(self):
        result = validate_risk(_good_input())
        assert 0 <= result.quality_score <= 100

    def test_higher_rr_lower_risk_score(self):
        r_low  = validate_risk(_good_input(rr=1.6))
        r_high = validate_risk(_good_input(rr=3.5))
        assert r_high.risk_score <= r_low.risk_score

    def test_futures_adds_base_risk_premium(self):
        spot    = validate_risk(_good_input(mode=ScannerMode.SPOT))
        futures = validate_risk(_good_input(mode=ScannerMode.FUTURES, sl=98.0))
        assert futures.risk_score >= spot.risk_score


# ── Leverage tier ─────────────────────────────────────────────────────────────

class TestLeverageTier:
    def test_spot_always_leverage_1(self):
        result = validate_risk(_good_input(mode=ScannerMode.SPOT))
        assert result.max_safe_leverage == 1

    def test_futures_leverage_decreases_with_wider_stop(self):
        tight  = validate_risk(_good_input(mode=ScannerMode.FUTURES, entry=100.0, sl=98.0))
        wide   = validate_risk(_good_input(mode=ScannerMode.FUTURES, entry=100.0, sl=93.0))
        assert tight.max_safe_leverage >= wide.max_safe_leverage


# ── RISKGRADE.FIX.1 — breakout bonus, regime adjustment, futures penalty ──────

class TestRiskgradeFix1:

    def test_high_momentum_breakout_raises_quality(self):
        base    = validate_risk(_good_input())
        with_bo = validate_risk(_good_input(breakout_strength="HIGH_MOMENTUM_BREAKOUT"))
        assert with_bo.quality_score == min(100.0, base.quality_score + 15.0)

    def test_confirmed_breakout_raises_quality(self):
        base    = validate_risk(_good_input())
        with_bo = validate_risk(_good_input(breakout_strength="CONFIRMED_BREAKOUT"))
        assert with_bo.quality_score == min(100.0, base.quality_score + 10.0)

    def test_early_breakout_raises_quality(self):
        base    = validate_risk(_good_input())
        with_bo = validate_risk(_good_input(breakout_strength="EARLY_BREAKOUT"))
        assert with_bo.quality_score == min(100.0, base.quality_score + 4.0)

    def test_no_breakout_no_bonus(self):
        base     = validate_risk(_good_input())
        none_bo  = validate_risk(_good_input(breakout_strength=None))
        assert base.quality_score == none_bo.quality_score

    def test_bear_trend_regime_adds_quality(self):
        base = validate_risk(_good_input(btc_regime="SIDEWAYS"))
        bear = validate_risk(_good_input(btc_regime="BEAR_TREND"))
        assert bear.quality_score == min(100.0, base.quality_score + 5.0)

    def test_unknown_regime_penalizes_quality(self):
        base    = validate_risk(_good_input(btc_regime="SIDEWAYS"))
        unknown = validate_risk(_good_input(btc_regime="UNKNOWN"))
        assert unknown.quality_score == max(0.0, base.quality_score - 10.0)

    def test_futures_penalty_is_zero(self):
        # ALPHA.TRUTH.1: futures risk penalty removed (was 5.0 → 2.0 → 0).
        # Grade C > A/B distortion persisted after RISKGRADE.FIX.1; the +2
        # penalty was distorting grading without improving outcomes.
        # grade_factors["futures_penalty"] == 0.0 is also verified by
        # test_grade_factors_contains_required_keys.
        spot    = validate_risk(_good_input(mode=ScannerMode.SPOT))
        futures = validate_risk(_good_input(mode=ScannerMode.FUTURES))
        assert futures.risk_score == spot.risk_score  # no futures risk penalty

    def test_grade_factors_contains_required_keys(self):
        result = validate_risk(_good_input(
            breakout_strength="CONFIRMED_BREAKOUT",
            btc_regime="BEAR_TREND",
        ))
        for key in ("base_quality", "breakout_bonus", "regime_bonus",
                    "futures_penalty", "final_quality", "final_risk"):
            assert key in result.grade_factors
        assert result.grade_factors["breakout_bonus"]  == 10.0
        assert result.grade_factors["regime_bonus"]    == 5.0
        assert result.grade_factors["futures_penalty"] == 0.0
