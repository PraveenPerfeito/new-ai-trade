import { Candle, TechnicalIndicators, ContinuationAnalysis } from '@/types';

/**
 * Scores how likely a trend continuation is from the current position.
 *
 * Factors (all pure — no I/O):
 *   RSI zone:              ±15 / ±10 / ±20  (healthy zone vs borderline vs extreme)
 *   EMA20 overextension:   ±10 / -15         (tight to EMA = clean; >3 ATR = extended)
 *   Volume trend:          ±10               (rising vs falling participation)
 *   Candle momentum:       ±10 / -15         (last 3 candles in vs against direction)
 *
 * Probability is clamped to [10, 95].
 * exhaustionRisk and momentumHealth are derived from the final probability band.
 */
export function analyzeContinuation(
  candles: Candle[],
  ind1h: TechnicalIndicators,
  signalType: 'BUY' | 'SELL',
): ContinuationAnalysis {
  let probability = 50;
  const reasons: string[] = [];

  // ── 1. RSI zone ──────────────────────────────────────────────────────────────
  if (signalType === 'BUY') {
    if (ind1h.rsi >= 50 && ind1h.rsi <= 65) {
      probability += 15;
      reasons.push(`RSI ${ind1h.rsi.toFixed(0)} healthy bullish zone (50-65)`);
    } else if (ind1h.rsi > 40 && ind1h.rsi < 50) {
      probability -= 10;
      reasons.push(`RSI ${ind1h.rsi.toFixed(0)} below 50 — borderline`);
    } else if (ind1h.rsi > 72) {
      probability -= 20;
      reasons.push(`RSI ${ind1h.rsi.toFixed(0)} extended — reversal risk`);
    }
  } else {
    if (ind1h.rsi >= 35 && ind1h.rsi <= 50) {
      probability += 15;
      reasons.push(`RSI ${ind1h.rsi.toFixed(0)} healthy bearish zone (35-50)`);
    } else if (ind1h.rsi > 50 && ind1h.rsi < 60) {
      probability -= 10;
      reasons.push(`RSI ${ind1h.rsi.toFixed(0)} above 50 — bearish momentum borderline`);
    } else if (ind1h.rsi < 28) {
      probability -= 20;
      reasons.push(`RSI ${ind1h.rsi.toFixed(0)} oversold — bounce risk`);
    }
  }

  // ── 2. EMA20 overextension ────────────────────────────────────────────────────
  if (ind1h.atr > 0) {
    const emaDist = Math.abs(ind1h.currentPrice - ind1h.ema20) / ind1h.atr;
    if (emaDist > 3.0) {
      probability -= 15;
      reasons.push(`${emaDist.toFixed(1)}× ATR from EMA20 — overextended`);
    } else if (emaDist < 1.5) {
      probability += 10;
      reasons.push(`${emaDist.toFixed(1)}× ATR from EMA20 — clean entry zone`);
    }
  }

  // ── 3. Volume trend (last 3 vs last 10) ──────────────────────────────────────
  if (candles.length >= 13) {
    const avg10 = candles.slice(-11, -1).reduce((s, c) => s + c.volume, 0) / 10;
    const avg3  = candles.slice(-4,  -1).reduce((s, c) => s + c.volume, 0) / 3;
    if (avg3 > avg10 * 1.2) {
      probability += 10;
      reasons.push('Volume rising — building participation');
    } else if (avg3 < avg10 * 0.7) {
      probability -= 10;
      reasons.push('Volume declining — fading participation');
    }
  }

  // ── 4. Last 3 candle momentum direction ───────────────────────────────────────
  if (candles.length >= 4) {
    const last3 = candles.slice(-4, -1);
    const inDir = last3.filter(c =>
      signalType === 'BUY' ? c.close > c.open : c.close < c.open,
    ).length;
    if (inDir >= 3) {
      probability += 10;
      reasons.push('Last 3 candles all in trade direction');
    } else if (inDir === 0) {
      probability -= 15;
      reasons.push('Last 3 candles all against trade direction');
    }
  }

  probability = Math.max(10, Math.min(95, Math.round(probability)));

  const exhaustionRisk: 'low' | 'medium' | 'high' =
    probability < 35 ? 'high' : probability < 55 ? 'medium' : 'low';

  const momentumHealth: 'healthy' | 'fading' | 'exhausted' =
    probability >= 65 ? 'healthy' : probability >= 40 ? 'fading' : 'exhausted';

  return { continuationProbability: probability, exhaustionRisk, momentumHealth, reasons };
}
