import { TechnicalIndicators, ContinuationAnalysis, SignalState } from '@/types';

/**
 * Determines the lifecycle state of a signal from current indicators.
 *
 * Decision tree (first match wins):
 *   INVALIDATED  — 1h trend has reversed against signal direction
 *   EXTENDED     — momentum exhausted (continuation probability too low)
 *   CORRECTING   — MACD turned against direction + RSI pulled back to neutral
 *   COOLING      — momentum fading but trend still intact
 *   CONFIRMED    — 4h aligned + healthy volume + healthy momentum
 *   DEVELOPING   — default: aligned but borderline
 *
 * Note: EXPIRED is reserved for stored-signal re-evaluation jobs (cron/analytics).
 * It is never produced during live scan time.
 */
export function computeSignalState(
  ind1h: TechnicalIndicators,
  ind4h: TechnicalIndicators,
  continuation: ContinuationAnalysis,
  signalType: 'BUY' | 'SELL',
): SignalState {
  // Invalidated: 1h trend reversed against signal direction
  if (signalType === 'BUY'  && ind1h.trend === 'BEARISH') return 'INVALIDATED';
  if (signalType === 'SELL' && ind1h.trend === 'BULLISH') return 'INVALIDATED';

  // Extended: momentum exhausted — entry would be late and risky
  if (continuation.momentumHealth === 'exhausted') return 'EXTENDED';

  // Correcting: MACD turned against direction + RSI near neutral (momentum flushing)
  if (signalType === 'BUY'  && ind1h.macd.histogram < 0 && ind1h.rsi < 45) return 'CORRECTING';
  if (signalType === 'SELL' && ind1h.macd.histogram > 0 && ind1h.rsi > 55) return 'CORRECTING';

  // Cooling: fading momentum but trend still valid
  if (continuation.momentumHealth === 'fading') return 'COOLING';

  // Confirmed: 4h on-side + above-average volume + healthy continuation
  if (
    continuation.momentumHealth === 'healthy' &&
    ind1h.volumeSpike >= 1.4 &&
    ((signalType === 'BUY'  && ind4h.trend === 'BULLISH') ||
     (signalType === 'SELL' && ind4h.trend === 'BEARISH'))
  ) return 'CONFIRMED';

  return 'DEVELOPING';
}
