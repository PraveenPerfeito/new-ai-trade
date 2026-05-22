import { TechnicalIndicators, EntryQualityResult, ExtensionRisk, PullbackQuality } from '@/types';

/**
 * Scores the tactical quality of a signal's entry point.
 *
 * Assesses: RSI position, EMA20 distance (overextension), MACD alignment,
 * volume conviction, 4h trend confirmation, and R:R bonus.
 *
 * Score 80-100 = elite entry, 60-79 = good, 40-59 = marginal, <40 = poor.
 */
export function assessEntryQuality(
  ind1h:      TechnicalIndicators,
  ind4h:      TechnicalIndicators,
  signalType: 'BUY' | 'SELL',
  rrRatio:    number,
): EntryQualityResult {
  let score = 50; // neutral base
  const factors: string[] = [];

  // ── RSI position quality ────────────────────────────────────────────────────
  const rsi = ind1h.rsi;
  if (signalType === 'BUY') {
    if (rsi >= 48 && rsi <= 62)      { score += 15; factors.push('RSI ideal momentum zone'); }
    else if (rsi >= 40 && rsi < 48)  { score += 5;  }
    else if (rsi > 68 && rsi <= 73)  { score -= 15; factors.push('RSI elevated — extension risk'); }
    else if (rsi > 73)               { score -= 25; factors.push('RSI overbought — late entry'); }
  } else {
    if (rsi >= 38 && rsi <= 52)      { score += 15; factors.push('RSI ideal momentum zone'); }
    else if (rsi > 52 && rsi <= 60)  { score += 5;  }
    else if (rsi < 32 && rsi >= 27)  { score -= 15; factors.push('RSI depressed — extension risk'); }
    else if (rsi < 27)               { score -= 25; factors.push('RSI oversold — late entry'); }
  }

  // ── EMA20 distance (overextension check) ────────────────────────────────────
  const price        = ind1h.currentPrice;
  const ema20Dist    = Math.abs(price - ind1h.ema20) / ind1h.ema20;
  if      (ema20Dist <= 0.015)        { score += 15; factors.push('Price at EMA — optimal pullback'); }
  else if (ema20Dist <= 0.03)         { score += 8;  factors.push('Clean EMA proximity'); }
  else if (ema20Dist > 0.08)          { score -= 20; factors.push(`+${(ema20Dist * 100).toFixed(1)}% from EMA20 — overextended`); }
  else if (ema20Dist > 0.05)          { score -= 10; factors.push('Moderately extended from EMA20'); }

  // ── MACD histogram alignment ────────────────────────────────────────────────
  const macdAligned =
    (signalType === 'BUY'  && ind1h.macd.histogram > 0) ||
    (signalType === 'SELL' && ind1h.macd.histogram < 0);
  if (macdAligned)  { score += 10; factors.push('MACD aligned with direction'); }
  else              { score -= 10; factors.push('MACD diverging from direction'); }

  // ── Volume quality ──────────────────────────────────────────────────────────
  if      (ind1h.volumeSpike >= 2.5) { score += 15; factors.push('Strong volume confirmation'); }
  else if (ind1h.volumeSpike >= 1.5) { score += 8;  }
  else if (ind1h.volumeSpike < 0.9)  { score -= 15; factors.push('Below-average volume — weak conviction'); }

  // ── 4h trend confirmation ───────────────────────────────────────────────────
  const tf4hAligned =
    (signalType === 'BUY'  && ind4h.trend === 'BULLISH') ||
    (signalType === 'SELL' && ind4h.trend === 'BEARISH');
  if (tf4hAligned) { score += 10; factors.push('4h trend confirmed'); }

  // ── R:R quality bonus ───────────────────────────────────────────────────────
  if      (rrRatio >= 3.0) { score += 10; factors.push('Excellent R:R ratio'); }
  else if (rrRatio >= 2.5) { score += 5;  }

  score = Math.min(100, Math.max(0, score));

  // ── Derived assessments ─────────────────────────────────────────────────────

  let pullbackQuality: PullbackQuality;
  if      (ema20Dist <= 0.015 && macdAligned) pullbackQuality = 'STRONG';
  else if (ema20Dist <= 0.035)                pullbackQuality = 'MODERATE';
  else if (ema20Dist <= 0.07)                 pullbackQuality = 'WEAK';
  else                                         pullbackQuality = 'NONE';

  let extensionRisk: ExtensionRisk;
  const rsiExtended = signalType === 'BUY' ? rsi > 73 : rsi < 27;
  if      (ema20Dist > 0.08 || rsiExtended)              extensionRisk = 'HIGH';
  else if (ema20Dist > 0.05 || (signalType === 'BUY' ? rsi > 68 : rsi < 32)) extensionRisk = 'MODERATE';
  else                                                    extensionRisk = 'LOW';

  const lateEntry = extensionRisk === 'HIGH' || ema20Dist > 0.10;

  return { score, extensionRisk, pullbackQuality, lateEntry, factors };
}
