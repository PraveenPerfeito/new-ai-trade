"""
Risk engine: grades, scores, violations, and position sizing.
Direct port of lib/risk.ts with identical scoring logic.

Configuration-driven thresholds are defined as module-level constants
so they can be overridden in tests or loaded from settings in Phase 3.
"""
from __future__ import annotations

from backend.core.scanner.models import (
    CoinData,
    RiskGrade,
    RiskInput,
    RiskResult,
    RiskViolation,
    RiskWarning,
    ScannerMode,
    ViolationSeverity,
    VolatilityRating,
)

# ── Configurable thresholds ───────────────────────────────────────────────────

RR_CRITICAL_MIN  = 1.5
RR_WARN_MIN      = 2.0
RR_IDEAL_MIN     = 2.5

SL_TOO_TIGHT_PCT = 0.5
SL_TIGHT_PCT     = 1.0
SL_WIDE_PCT      = 5.0
SL_TOO_WIDE_PCT  = 8.0

VOL24H_CRITICAL  = 10_000_000
VOL24H_LOW       = 25_000_000

RSI_OVERBOUGHT_CRITICAL = 80
RSI_OVERBOUGHT          = 75
RSI_OVERBOUGHT_WARN     = 70
RSI_OVERSOLD_CRITICAL   = 20
RSI_OVERSOLD            = 25
RSI_OVERSOLD_WARN       = 30

LEVERAGE_TIERS = [1, 2, 3, 5, 10, 15, 20]

# ── Leverage tier calculation ─────────────────────────────────────────────────

def _leverage_tier(sl_pct: float) -> int:
    """
    Choose the highest leverage tier that keeps the stop-loss within 20% of
    notional (standard risk budget for futures sizing).
    """
    theoretical = int(20 / sl_pct) if sl_pct > 0 else 1
    result = 1
    for tier in LEVERAGE_TIERS:
        if tier <= theoretical:
            result = tier
        else:
            break
    return result


# ── Individual validators (each returns a penalty score 0-N) ─────────────────

def _validate_rr(
    rr_ratio: float,
    violations: list[RiskViolation],
    warnings: list[RiskWarning],
) -> float:
    if rr_ratio < RR_CRITICAL_MIN:
        violations.append(RiskViolation(
            code="RR_CRITICAL",
            message=f"RR {rr_ratio:.2f} is below minimum {RR_CRITICAL_MIN}",
            severity=ViolationSeverity.CRITICAL,
        ))
        return 35.0
    if rr_ratio < RR_WARN_MIN:
        violations.append(RiskViolation(
            code="RR_LOW",
            message=f"RR {rr_ratio:.2f} is below recommended {RR_WARN_MIN}",
            severity=ViolationSeverity.HIGH,
        ))
        return 20.0
    if rr_ratio < RR_IDEAL_MIN:
        warnings.append(RiskWarning(
            code="RR_MARGINAL",
            message=f"RR {rr_ratio:.2f} — aim for ≥ {RR_IDEAL_MIN} for higher quality",
        ))
        return 5.0
    return 0.0


def _validate_volatility(
    volatility: VolatilityRating,
    mode: ScannerMode,
    violations: list[RiskViolation],
    warnings: list[RiskWarning],
) -> float:
    if volatility == VolatilityRating.EXTREME:
        violations.append(RiskViolation(
            code="VOLATILITY_EXTREME",
            message="Extreme ATR (>8% of price) — high reversal risk",
            severity=ViolationSeverity.CRITICAL,
        ))
        return 30.0
    if volatility == VolatilityRating.HIGH:
        warnings.append(RiskWarning(code="VOLATILITY_HIGH", message="High volatility — widen stops or reduce size"))
        return 18.0
    if volatility == VolatilityRating.LOW and mode == ScannerMode.FUTURES:
        warnings.append(RiskWarning(code="VOLATILITY_LOW_FUTURES", message="Low volatility for futures — limited profit potential"))
        return 5.0
    return 0.0


def _validate_overextension(
    rsi: float,
    signal_type: str,
    violations: list[RiskViolation],
    warnings: list[RiskWarning],
) -> float:
    if signal_type == "BUY":
        if rsi > RSI_OVERBOUGHT_CRITICAL:
            violations.append(RiskViolation(code="RSI_OVERBOUGHT_CRITICAL", message=f"RSI {rsi:.1f} — severely overbought, reversal likely", severity=ViolationSeverity.CRITICAL))
            return 30.0
        if rsi > RSI_OVERBOUGHT:
            violations.append(RiskViolation(code="RSI_OVERBOUGHT", message=f"RSI {rsi:.1f} — overbought territory", severity=ViolationSeverity.HIGH))
            return 20.0
        if rsi > RSI_OVERBOUGHT_WARN:
            warnings.append(RiskWarning(code="RSI_ELEVATED", message=f"RSI {rsi:.1f} — elevated, watch for exhaustion"))
            return 10.0
    else:
        if rsi < RSI_OVERSOLD_CRITICAL:
            violations.append(RiskViolation(code="RSI_OVERSOLD_CRITICAL", message=f"RSI {rsi:.1f} — severely oversold, bounce likely", severity=ViolationSeverity.CRITICAL))
            return 30.0
        if rsi < RSI_OVERSOLD:
            violations.append(RiskViolation(code="RSI_OVERSOLD", message=f"RSI {rsi:.1f} — oversold territory", severity=ViolationSeverity.HIGH))
            return 20.0
        if rsi < RSI_OVERSOLD_WARN:
            warnings.append(RiskWarning(code="RSI_DEPRESSED", message=f"RSI {rsi:.1f} — depressed, watch for bounce"))
            return 10.0
    return 0.0


def _validate_stop_distance(
    sl_pct: float,
    mode: ScannerMode,
    violations: list[RiskViolation],
    warnings: list[RiskWarning],
) -> float:
    if sl_pct < SL_TOO_TIGHT_PCT:
        violations.append(RiskViolation(code="STOP_TOO_TIGHT", message=f"SL {sl_pct:.2f}% — too tight, likely noise stop-out", severity=ViolationSeverity.CRITICAL))
        return 25.0
    if sl_pct < SL_TIGHT_PCT:
        warnings.append(RiskWarning(code="STOP_TIGHT", message=f"SL {sl_pct:.2f}% — may trigger on normal price noise"))
        return 12.0
    if sl_pct > SL_TOO_WIDE_PCT:
        violations.append(RiskViolation(code="STOP_TOO_WIDE", message=f"SL {sl_pct:.2f}% — excessive capital risk per trade", severity=ViolationSeverity.CRITICAL))
        return 25.0
    if sl_pct > SL_WIDE_PCT and mode == ScannerMode.FUTURES:
        violations.append(RiskViolation(code="STOP_WIDE_FUTURES", message=f"SL {sl_pct:.2f}% too wide for futures leverage", severity=ViolationSeverity.HIGH))
        return 18.0
    if sl_pct > SL_WIDE_PCT:
        warnings.append(RiskWarning(code="STOP_WIDE", message=f"SL {sl_pct:.2f}% — wide stop reduces RR potential"))
        return 8.0
    return 0.0


def _validate_liquidity(
    coin: CoinData,
    volume_spike: float,
    violations: list[RiskViolation],
    warnings: list[RiskWarning],
) -> float:
    penalty = 0.0
    vol_m = coin.volume_24h / 1_000_000
    if coin.volume_24h < VOL24H_CRITICAL:
        violations.append(RiskViolation(code="LIQUIDITY_CRITICAL", message=f"24h volume ${vol_m:.1f}M — insufficient liquidity", severity=ViolationSeverity.CRITICAL))
        penalty += 30.0
    elif coin.volume_24h < VOL24H_LOW:
        violations.append(RiskViolation(code="LIQUIDITY_LOW", message=f"24h volume ${vol_m:.1f}M — low liquidity", severity=ViolationSeverity.HIGH))
        penalty += 15.0

    if volume_spike < 0.7:
        warnings.append(RiskWarning(code="VOLUME_WEAK", message=f"Volume {volume_spike:.2f}× — below average, weak conviction"))
        penalty += 15.0
    elif volume_spike < 1.0:
        warnings.append(RiskWarning(code="VOLUME_LOW", message=f"Volume {volume_spike:.2f}× — below-average interest"))
        penalty += 8.0
    return penalty


def _validate_leverage(
    sl_pct: float,
    mode: ScannerMode,
    max_lev: int,
    violations: list[RiskViolation],
    warnings: list[RiskWarning],
) -> float:
    if mode != ScannerMode.FUTURES:
        return 0.0
    if max_lev < 2:
        violations.append(RiskViolation(code="LEVERAGE_TOO_LOW", message=f"Max safe leverage only {max_lev}× — poor capital efficiency", severity=ViolationSeverity.HIGH))
        return 15.0
    if max_lev < 3:
        warnings.append(RiskWarning(code="LEVERAGE_MARGINAL", message=f"Max safe leverage {max_lev}× — limited leverage available"))
        return 5.0
    return 0.0


# ── Quality scoring ───────────────────────────────────────────────────────────

def _calc_quality_score(inp: RiskInput, sl_pct: float) -> tuple[float, dict[str, float]]:
    score = 35.0

    if inp.rr_ratio >= 3.0:   score += 15
    elif inp.rr_ratio >= 2.5: score += 8
    elif inp.rr_ratio >= 2.0: score += 3

    vs = inp.ind_1h.volume_spike
    if vs >= 2.5:   score += 15
    elif vs >= 2.0: score += 10
    elif vs >= 1.5: score += 5

    cs = inp.combined_strength
    if cs >= 70:   score += 15
    elif cs >= 55: score += 8
    elif cs >= 40: score += 4

    macd_aligned = (
        (inp.signal_type.value == "BUY"  and inp.ind_1h.macd.histogram > 0) or
        (inp.signal_type.value == "SELL" and inp.ind_1h.macd.histogram < 0)
    )
    if macd_aligned:
        score += 10

    rsi = inp.ind_1h.rsi
    rsi_ideal = (
        (inp.signal_type.value == "BUY"  and 50 <= rsi <= 65) or
        (inp.signal_type.value == "SELL" and 35 <= rsi <= 50)
    )
    if rsi_ideal:
        score += 10

    if inp.volatility in (VolatilityRating.LOW, VolatilityRating.NORMAL):
        score += 5

    if 1.0 <= sl_pct <= 3.0:
        score += 7

    if inp.mode == ScannerMode.FUTURES and inp.rr_ratio >= 2.5:
        score += 5

    base_score = score

    # RISKGRADE.FIX.1 — breakout quality bonus
    breakout_bonus = 0.0
    bs = inp.breakout_strength
    if bs == "HIGH_MOMENTUM_BREAKOUT":  breakout_bonus = 15.0
    elif bs == "CONFIRMED_BREAKOUT":    breakout_bonus = 10.0
    elif bs == "EARLY_BREAKOUT":        breakout_bonus = 4.0
    score += breakout_bonus

    # RISKGRADE.FIX.1 — regime quality adjustment
    regime_bonus = 0.0
    regime = (inp.btc_regime or "").upper()
    if regime in {"BEAR_TREND", "CAPITULATION", "BULL_TREND", "EUPHORIA"}:
        regime_bonus = 5.0
    elif not regime or regime == "UNKNOWN":
        regime_bonus = -10.0
    score += regime_bonus

    return (
        min(100.0, max(0.0, score)),
        {"base_score": base_score, "breakout_bonus": breakout_bonus, "regime_bonus": regime_bonus},
    )


# ── Grade assignment ──────────────────────────────────────────────────────────

def _assign_grade(risk_score: float, quality_score: float) -> RiskGrade:
    if risk_score <= 20 and quality_score >= 70: return RiskGrade.A
    if risk_score <= 35 and quality_score >= 55: return RiskGrade.B
    if risk_score <= 50 and quality_score >= 40: return RiskGrade.C
    if risk_score <= 65 and quality_score >= 25: return RiskGrade.D
    return RiskGrade.F


_POSITION_MULTIPLIERS: dict[RiskGrade, float] = {
    RiskGrade.A: 1.0,
    RiskGrade.B: 0.75,
    RiskGrade.C: 0.5,
    RiskGrade.D: 0.35,
    RiskGrade.F: 0.0,
}


# ── Main entry point ──────────────────────────────────────────────────────────

def validate_risk(inp: RiskInput) -> RiskResult:
    """
    Runs all risk validators and returns a complete RiskResult.
    Mirrors validateRisk() from lib/risk.ts with identical scoring.
    """
    violations: list[RiskViolation] = []
    warnings:   list[RiskWarning]   = []

    sl_pct  = abs(inp.entry - inp.stop_loss) / inp.entry * 100
    max_lev = 1 if inp.mode == ScannerMode.SPOT else _leverage_tier(sl_pct)

    risk_score = 0.0
    risk_score += _validate_rr(inp.rr_ratio, violations, warnings)
    risk_score += _validate_volatility(inp.volatility, inp.mode, violations, warnings)
    risk_score += _validate_overextension(inp.ind_1h.rsi, inp.signal_type.value, violations, warnings)
    risk_score += _validate_stop_distance(sl_pct, inp.mode, violations, warnings)
    risk_score += _validate_liquidity(inp.coin, inp.ind_1h.volume_spike, violations, warnings)
    risk_score += _validate_leverage(sl_pct, inp.mode, max_lev, violations, warnings)

    futures_penalty = 0.0  # ALPHA.TRUTH.1: removed (was 5.0→2.0→0). Grade C > A/B persisted after FIX.1; penalty distorts grading without improving outcomes.
    risk_score += futures_penalty

    risk_score = min(100.0, max(0.0, risk_score))

    quality_score, _qf = _calc_quality_score(inp, sl_pct)
    grade_factors = {
        "base_quality":    _qf["base_score"],
        "breakout_bonus":  _qf["breakout_bonus"],
        "regime_bonus":    _qf["regime_bonus"],
        "futures_penalty": futures_penalty,
        "final_quality":   quality_score,
        "final_risk":      risk_score,
    }

    has_critical  = any(v.severity == ViolationSeverity.CRITICAL for v in violations)
    passed        = not has_critical and risk_score <= 60 and quality_score >= 35
    grade         = _assign_grade(risk_score, quality_score) if passed else RiskGrade.F
    pos_multi     = _POSITION_MULTIPLIERS[grade]

    if has_critical:
        critical_msg = next(v.message for v in violations if v.severity == ViolationSeverity.CRITICAL)
        summary = f"REJECTED: {critical_msg}"
    elif not passed:
        summary = f"REJECTED: risk score {risk_score:.0f}/100, quality {quality_score:.0f}/100"
    else:
        summary = f"Grade {grade.value} — Risk {risk_score:.0f}/100 · Quality {quality_score:.0f}/100"

    return RiskResult(**{
        "pass":                    passed,
        "risk_score":              risk_score,
        "quality_score":           quality_score,
        "risk_grade":              grade,
        "violations":              violations,
        "warnings":                warnings,
        "max_safe_leverage":       max_lev,
        "position_size_multiplier": pos_multi,
        "summary":                 summary,
        "grade_factors":           grade_factors,
    })
