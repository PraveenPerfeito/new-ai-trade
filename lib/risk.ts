import { TechnicalIndicators, CoinData, ScannerMode, RiskGrade, RiskViolation, RiskWarning } from '@/types';
import { VolatilityRating } from './indicators';

// ─── Public types ─────────────────────────────────────────────────────────────

export interface RiskInput {
  entry:            number;
  stopLoss:         number;
  rrRatio:          number;
  ind1h:            TechnicalIndicators;
  ind4h:            TechnicalIndicators;
  coin:             CoinData;
  signalType:       'BUY' | 'SELL';
  mode:             ScannerMode;
  volatility:       VolatilityRating;
  combinedStrength: number;
}

export interface RiskResult {
  pass:                   boolean;
  riskScore:              number;   // 0-100, lower = safer
  qualityScore:           number;   // 0-100, higher = better
  riskGrade:              RiskGrade;
  violations:             RiskViolation[];
  warnings:               RiskWarning[];
  maxSafeLeverage:        number;
  positionSizeMultiplier: number;   // 0.25-1.0
  summary:                string;
}

// ─── Leverage tiers ───────────────────────────────────────────────────────────

const LEVERAGE_TIERS = [1, 2, 3, 5, 10, 15, 20] as const;

function leverageTier(slPct: number): number {
  // Risk budget: allow stop to consume at most 20% of notional
  const theoretical = Math.floor(20 / slPct);
  let result = 1;
  for (const t of LEVERAGE_TIERS) {
    if (t <= theoretical) result = t;
    else break;
  }
  return result;
}

// ─── Individual validators ────────────────────────────────────────────────────

function validateRR(
  rrRatio: number,
  violations: RiskViolation[],
  warnings: RiskWarning[],
): number {
  let penalty = 0;
  if (rrRatio < 1.5) {
    violations.push({ code: 'RR_CRITICAL', message: `RR ${rrRatio.toFixed(2)} is below minimum 1.5`, severity: 'CRITICAL' });
    penalty += 35;
  } else if (rrRatio < 2.0) {
    violations.push({ code: 'RR_LOW', message: `RR ${rrRatio.toFixed(2)} is below recommended 2.0`, severity: 'HIGH' });
    penalty += 20;
  } else if (rrRatio < 2.5) {
    warnings.push({ code: 'RR_MARGINAL', message: `RR ${rrRatio.toFixed(2)} — aim for ≥ 2.5 for higher quality` });
    penalty += 5;
  }
  return penalty;
}

function validateVolatility(
  volatility: VolatilityRating,
  mode: ScannerMode,
  violations: RiskViolation[],
  warnings: RiskWarning[],
): number {
  let penalty = 0;
  if (volatility === 'EXTREME') {
    violations.push({ code: 'VOLATILITY_EXTREME', message: 'Extreme ATR (>8% of price) — high reversal risk', severity: 'CRITICAL' });
    penalty += 30;
  } else if (volatility === 'HIGH') {
    warnings.push({ code: 'VOLATILITY_HIGH', message: 'High volatility — widen stops or reduce size' });
    penalty += 18;
  } else if (volatility === 'LOW' && mode === 'futures') {
    warnings.push({ code: 'VOLATILITY_LOW_FUTURES', message: 'Low volatility for futures — limited profit potential' });
    penalty += 5;
  }
  return penalty;
}

function validateOverextension(
  rsi: number,
  signalType: 'BUY' | 'SELL',
  violations: RiskViolation[],
  warnings: RiskWarning[],
): number {
  let penalty = 0;
  if (signalType === 'BUY') {
    if (rsi > 80) {
      violations.push({ code: 'RSI_OVERBOUGHT_CRITICAL', message: `RSI ${rsi.toFixed(1)} — severely overbought, reversal likely`, severity: 'CRITICAL' });
      penalty += 30;
    } else if (rsi > 75) {
      violations.push({ code: 'RSI_OVERBOUGHT', message: `RSI ${rsi.toFixed(1)} — overbought territory`, severity: 'HIGH' });
      penalty += 20;
    } else if (rsi > 70) {
      warnings.push({ code: 'RSI_ELEVATED', message: `RSI ${rsi.toFixed(1)} — elevated, watch for exhaustion` });
      penalty += 10;
    }
  } else {
    if (rsi < 20) {
      violations.push({ code: 'RSI_OVERSOLD_CRITICAL', message: `RSI ${rsi.toFixed(1)} — severely oversold, bounce likely`, severity: 'CRITICAL' });
      penalty += 30;
    } else if (rsi < 25) {
      violations.push({ code: 'RSI_OVERSOLD', message: `RSI ${rsi.toFixed(1)} — oversold territory`, severity: 'HIGH' });
      penalty += 20;
    } else if (rsi < 30) {
      warnings.push({ code: 'RSI_DEPRESSED', message: `RSI ${rsi.toFixed(1)} — depressed, watch for bounce` });
      penalty += 10;
    }
  }
  return penalty;
}

function validateStopDistance(
  slPct: number,
  mode: ScannerMode,
  violations: RiskViolation[],
  warnings: RiskWarning[],
): number {
  let penalty = 0;
  if (slPct < 0.5) {
    violations.push({ code: 'STOP_TOO_TIGHT', message: `SL ${slPct.toFixed(2)}% — too tight, likely noise stop-out`, severity: 'CRITICAL' });
    penalty += 25;
  } else if (slPct < 1.0) {
    warnings.push({ code: 'STOP_TIGHT', message: `SL ${slPct.toFixed(2)}% — may trigger on normal price noise` });
    penalty += 12;
  } else if (slPct > 8.0) {
    violations.push({ code: 'STOP_TOO_WIDE', message: `SL ${slPct.toFixed(2)}% — excessive capital risk per trade`, severity: 'CRITICAL' });
    penalty += 25;
  } else if (slPct > 5.0 && mode === 'futures') {
    violations.push({ code: 'STOP_WIDE_FUTURES', message: `SL ${slPct.toFixed(2)}% too wide for futures leverage`, severity: 'HIGH' });
    penalty += 18;
  } else if (slPct > 5.0) {
    warnings.push({ code: 'STOP_WIDE', message: `SL ${slPct.toFixed(2)}% — wide stop reduces RR potential` });
    penalty += 8;
  }
  return penalty;
}

function validateLiquidity(
  coin: CoinData,
  volumeSpike: number,
  violations: RiskViolation[],
  warnings: RiskWarning[],
): number {
  let penalty = 0;
  if (coin.volume24h < 10_000_000) {
    violations.push({ code: 'LIQUIDITY_CRITICAL', message: `24h volume $${(coin.volume24h / 1e6).toFixed(1)}M — insufficient liquidity`, severity: 'CRITICAL' });
    penalty += 30;
  } else if (coin.volume24h < 25_000_000) {
    violations.push({ code: 'LIQUIDITY_LOW', message: `24h volume $${(coin.volume24h / 1e6).toFixed(1)}M — low liquidity`, severity: 'HIGH' });
    penalty += 15;
  }
  if (volumeSpike < 0.7) {
    warnings.push({ code: 'VOLUME_WEAK', message: `Volume ${volumeSpike.toFixed(2)}× — below average, weak conviction` });
    penalty += 15;
  } else if (volumeSpike < 1.0) {
    warnings.push({ code: 'VOLUME_LOW', message: `Volume ${volumeSpike.toFixed(2)}× — below-average interest` });
    penalty += 8;
  }
  return penalty;
}

function validateLeverage(
  slPct: number,
  mode: ScannerMode,
  maxLev: number,
  violations: RiskViolation[],
  warnings: RiskWarning[],
): number {
  let penalty = 0;
  if (mode === 'futures') {
    if (maxLev < 2) {
      violations.push({ code: 'LEVERAGE_TOO_LOW', message: `Max safe leverage only ${maxLev}× — poor capital efficiency`, severity: 'HIGH' });
      penalty += 15;
    } else if (maxLev < 3) {
      warnings.push({ code: 'LEVERAGE_MARGINAL', message: `Max safe leverage ${maxLev}× — limited leverage available` });
      penalty += 5;
    }
  }
  return penalty;
}

// ─── Quality score ────────────────────────────────────────────────────────────

function calcQualityScore(input: RiskInput, slPct: number): number {
  let score = 35; // base

  // RR quality
  if (input.rrRatio >= 3.0)      score += 15;
  else if (input.rrRatio >= 2.5) score += 8;
  else if (input.rrRatio >= 2.0) score += 3;

  // Volume confirmation
  if (input.ind1h.volumeSpike >= 2.5)      score += 15;
  else if (input.ind1h.volumeSpike >= 2.0) score += 10;
  else if (input.ind1h.volumeSpike >= 1.5) score += 5;

  // Trend strength
  if (input.combinedStrength >= 70)      score += 15;
  else if (input.combinedStrength >= 55) score += 8;
  else if (input.combinedStrength >= 40) score += 4;

  // MACD alignment
  const macdAligned = (input.signalType === 'BUY' && input.ind1h.macd.histogram > 0)
                   || (input.signalType === 'SELL' && input.ind1h.macd.histogram < 0);
  if (macdAligned) score += 10;

  // RSI in ideal zone
  const rsi = input.ind1h.rsi;
  const rsiIdeal = input.signalType === 'BUY'
    ? (rsi >= 50 && rsi <= 65)
    : (rsi >= 35 && rsi <= 50);
  if (rsiIdeal) score += 10;

  // Low/normal volatility bonus
  if (input.volatility === 'LOW' || input.volatility === 'NORMAL') score += 5;

  // Sweet-spot SL distance (1–3%)
  if (slPct >= 1.0 && slPct <= 3.0) score += 7;

  // Futures with strong RR
  if (input.mode === 'futures' && input.rrRatio >= 2.5) score += 5;

  return Math.min(100, Math.max(0, score));
}

// ─── Grade assignment ─────────────────────────────────────────────────────────

function assignGrade(riskScore: number, qualityScore: number): RiskGrade {
  if (riskScore <= 20 && qualityScore >= 70) return 'A';
  if (riskScore <= 35 && qualityScore >= 55) return 'B';
  if (riskScore <= 50 && qualityScore >= 40) return 'C';
  if (riskScore <= 65 && qualityScore >= 25) return 'D';
  return 'F';
}

// ─── Position sizing ──────────────────────────────────────────────────────────

function positionMultiplier(grade: RiskGrade): number {
  const map: Record<RiskGrade, number> = { 'A+': 1.0, A: 1.0, 'B+': 0.75, B: 0.75, C: 0.5, D: 0.35, F: 0 };
  return map[grade];
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export function validateRisk(input: RiskInput): RiskResult {
  const violations: RiskViolation[] = [];
  const warnings:   RiskWarning[]   = [];

  const slPct     = (Math.abs(input.entry - input.stopLoss) / input.entry) * 100;
  const maxLev    = input.mode === 'spot' ? 1 : leverageTier(slPct);

  let riskScore = 0;
  riskScore += validateRR(input.rrRatio, violations, warnings);
  riskScore += validateVolatility(input.volatility, input.mode, violations, warnings);
  riskScore += validateOverextension(input.ind1h.rsi, input.signalType, violations, warnings);
  riskScore += validateStopDistance(slPct, input.mode, violations, warnings);
  riskScore += validateLiquidity(input.coin, input.ind1h.volumeSpike, violations, warnings);
  riskScore += validateLeverage(slPct, input.mode, maxLev, violations, warnings);

  // Futures base risk premium
  if (input.mode === 'futures') riskScore += 5;

  riskScore = Math.min(100, Math.max(0, riskScore));

  const qualityScore = calcQualityScore(input, slPct);
  const hasCritical  = violations.some(v => v.severity === 'CRITICAL');
  const pass         = !hasCritical && riskScore <= 60 && qualityScore >= 35;
  const grade        = pass ? assignGrade(riskScore, qualityScore) : 'F';
  const posMulti     = positionMultiplier(grade);

  const summary = hasCritical
    ? `REJECTED: ${violations.filter(v => v.severity === 'CRITICAL')[0]?.message}`
    : !pass
    ? `REJECTED: risk score ${riskScore}/100, quality ${qualityScore}/100`
    : `Grade ${grade} — Risk ${riskScore}/100 · Quality ${qualityScore}/100`;

  return {
    pass,
    riskScore,
    qualityScore,
    riskGrade:              grade,
    violations,
    warnings,
    maxSafeLeverage:        maxLev,
    positionSizeMultiplier: posMulti,
    summary,
  };
}
