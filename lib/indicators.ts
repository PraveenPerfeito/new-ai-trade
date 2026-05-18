import { Candle, TechnicalIndicators, MACDResult } from '@/types';

// ─── Core calculations ──────────────────────────────────────────────────────

export function calcEMA(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  const emas: number[] = [values[0]];
  for (let i = 1; i < values.length; i++) {
    emas.push(values[i] * k + emas[i - 1] * (1 - k));
  }
  return emas;
}

export function calcRSI(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;

  const changes = closes.slice(1).map((c, i) => c - closes[i]);
  const gains = changes.map(c => (c > 0 ? c : 0));
  const losses = changes.map(c => (c < 0 ? -c : 0));

  // Wilder smoothing: seed with simple average, then apply rolling average
  let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;

  for (let i = period; i < changes.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
  }

  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

export function calcMACD(closes: number[]): MACDResult {
  // Need at least 35 candles for EMA-26 to be meaningful (26 + 9 signal)
  if (closes.length < 35) return { macd: 0, signal: 0, histogram: 0 };

  const ema12 = calcEMA(closes, 12);
  const ema26 = calcEMA(closes, 26);
  const macdLine = ema12.map((v, i) => v - ema26[i]);
  const signalLine = calcEMA(macdLine, 9);

  const macd = macdLine[macdLine.length - 1];
  const signal = signalLine[signalLine.length - 1];

  return { macd, signal, histogram: macd - signal };
}

export function calcATR(highs: number[], lows: number[], closes: number[], period = 14): number {
  if (highs.length < period + 1) return 0;

  const trs: number[] = [];
  for (let i = 1; i < highs.length; i++) {
    // True Range = max of: candle range, gap from prev close to high, gap from prev close to low
    trs.push(Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1]),
    ));
  }

  return trs.slice(-period).reduce((a, b) => a + b, 0) / period;
}

/**
 * Improved volume spike detection using a 20-period rolling average.
 * Returns the ratio of the latest candle's volume to the average.
 * A ratio > 1.5 means 50% above normal — considered a meaningful spike.
 * We exclude the last candle from the average to avoid self-referencing.
 */
export function calcVolumeSpike(volumes: number[], period = 20): number {
  if (volumes.length < period + 1) return 1;

  // Average over the PREVIOUS `period` candles (not including current)
  const avgVol = volumes.slice(-period - 1, -1).reduce((a, b) => a + b, 0) / period;
  if (avgVol === 0) return 1;

  const currentVol = volumes[volumes.length - 1];

  // Cap at 10× to avoid outlier spikes (exchange restarts, etc.) distorting scores
  return Math.min(10, currentVol / avgVol);
}

export function calculateAllIndicators(candles: Candle[]): TechnicalIndicators {
  const closes  = candles.map(c => c.close);
  const highs   = candles.map(c => c.high);
  const lows    = candles.map(c => c.low);
  const volumes = candles.map(c => c.volume);

  const rsi         = calcRSI(closes);
  const macd        = calcMACD(closes);
  const ema20Arr    = calcEMA(closes, 20);
  const ema50Arr    = calcEMA(closes, 50);
  const atr         = calcATR(highs, lows, closes);
  const volumeSpike = calcVolumeSpike(volumes);

  const currentPrice = closes[closes.length - 1];
  const ema20        = ema20Arr[ema20Arr.length - 1];
  const ema50        = ema50Arr[ema50Arr.length - 1];

  // Trend requires BOTH EMA alignment AND price position:
  //   BULLISH: EMA20 > EMA50 (golden cross region) AND price is above EMA20
  //   BEARISH: EMA20 < EMA50 (death cross region) AND price is below EMA20
  //   RANGING: anything else — price between EMAs or EMAs tangled
  let trend: TechnicalIndicators['trend'];
  if (ema20 > ema50 && currentPrice > ema20)      trend = 'BULLISH';
  else if (ema20 < ema50 && currentPrice < ema20) trend = 'BEARISH';
  else                                             trend = 'RANGING';

  return { rsi, macd, ema20, ema50, atr, volumeSpike, currentPrice, trend };
}

// ─── Volatility classification ──────────────────────────────────────────────

export type VolatilityRating = 'LOW' | 'NORMAL' | 'HIGH' | 'EXTREME';

/**
 * Classifies volatility by ATR as a percentage of current price.
 * Used to gate out signals during extreme volatility where:
 *   - Stops must be placed unrealistically far away
 *   - Price action is driven by news/panic rather than technicals
 *
 * Thresholds calibrated for top-100 crypto assets (1h candles):
 *   LOW     < 1.5%  — dead market, poor momentum for trend entries
 *   NORMAL  1.5-5%  — ideal range for ATR-based stop/target placement
 *   HIGH    5-8%    — caution: stops will be wide, reduce position size
 *   EXTREME > 8%    — reject: technically-driven levels unreliable
 */
export function calcVolatilityRating(atr: number, price: number): VolatilityRating {
  if (price === 0 || atr === 0) return 'EXTREME';
  const atrPct = (atr / price) * 100;

  if (atrPct > 8)   return 'EXTREME';
  if (atrPct > 5)   return 'HIGH';
  if (atrPct > 1.5) return 'NORMAL';
  return 'LOW';
}

// ─── Trend strength scoring ─────────────────────────────────────────────────

/**
 * Scores the strength of the current trend from 0-100.
 * Higher scores indicate cleaner, more reliable directional moves.
 *
 * Scoring breakdown (max 100):
 *   EMA separation  (0-30): % gap between EMA20 and EMA50 relative to price.
 *                            Wider gap = more established trend.
 *   RSI momentum    (0-25): Distance of RSI from neutral 50.
 *                            RSI 70 → 16 pts; RSI 80 → 24 pts.
 *   MACD force      (0-25): MACD histogram size relative to ATR.
 *                            Normalising by ATR prevents large-price assets
 *                            always dominating (e.g. BTC vs. a $0.10 token).
 *   Volume support  (0-20): Volume spike confirms institutional participation.
 *
 * Score < 30 → weak/choppy trend, skip
 * Score 30-50 → developing trend, proceed cautiously
 * Score 50+   → established trend, high quality
 */
export function calcTrendStrength(ind: TechnicalIndicators): number {
  // Factor 1: EMA separation as % of price
  const emaSepPct = Math.abs(ind.ema20 - ind.ema50) / (ind.currentPrice || 1);
  const emaPts    = Math.min(30, emaSepPct * 2500); // 1.2% sep → 30 pts

  // Factor 2: RSI distance from 50 (magnitude only — direction already confirmed)
  const rsiDist = Math.abs(ind.rsi - 50);
  const rsiPts  = Math.min(25, rsiDist * 0.7); // RSI 35.7 pts from 50 → 25 pts

  // Factor 3: MACD histogram relative to ATR (normalised momentum)
  const macdRel  = ind.atr > 0 ? Math.abs(ind.macd.histogram) / ind.atr : 0;
  const macdPts  = Math.min(25, macdRel * 150);

  // Factor 4: Volume spike confirmation
  const volPts = ind.volumeSpike >= 2.5 ? 20
               : ind.volumeSpike >= 1.8 ? 16
               : ind.volumeSpike >= 1.4 ? 10
               : ind.volumeSpike >= 1.1 ? 4
               : 0;

  return Math.min(100, emaPts + rsiPts + macdPts + volPts);
}

// ─── Multi-timeframe confirmation ───────────────────────────────────────────

export interface MultiTimeframeResult {
  confirmed: boolean;
  reason: string;
  // STRONG: both TFs clearly aligned + RSI healthy
  // WEAK:   aligned but marginal (borderline RSI or MACD)
  // CONFLICTED: hard reject
  alignment: 'STRONG' | 'WEAK' | 'CONFLICTED';
}

/**
 * Confirms that the 1h entry signal aligns with the 4h trend direction.
 *
 * Trading philosophy:
 *   The 4h chart determines the macro trend — we only trade WITH it.
 *   The 1h chart provides the entry timing — it must confirm the direction.
 *   This eliminates the most common false-positive: a strong 1h move that
 *   is actually just a retracement within a 4h downtrend.
 *
 * Hard reject rules (any one fails → CONFLICTED):
 *   BUY:  4h trend not BULLISH, 4h RSI > 72 (overbought), 1h trend not BULLISH,
 *         4h MACD histogram negative (4h momentum fading)
 *   SELL: 4h trend not BEARISH, 4h RSI < 28 (oversold),  1h trend not BEARISH,
 *         4h MACD histogram positive (4h momentum fading)
 *
 * STRONG vs WEAK:
 *   STRONG requires RSI and MACD on BOTH timeframes clearly directional.
 *   WEAK means the conditions are met but just barely.
 */
export function confirmMultiTimeframe(
  ind1h: TechnicalIndicators,
  ind4h: TechnicalIndicators,
  type: 'BUY' | 'SELL',
): MultiTimeframeResult {
  if (type === 'BUY') {
    if (ind4h.trend !== 'BULLISH')
      return { confirmed: false, reason: '4h trend not bullish — macro direction against signal', alignment: 'CONFLICTED' };
    if (ind4h.rsi > 72)
      return { confirmed: false, reason: `4h RSI overbought at ${ind4h.rsi.toFixed(1)} — late entry risk`, alignment: 'CONFLICTED' };
    if (ind1h.trend !== 'BULLISH')
      return { confirmed: false, reason: '1h trend not bullish — entry TF diverging from 4h', alignment: 'CONFLICTED' };
    if (ind4h.macd.histogram < 0)
      return { confirmed: false, reason: '4h MACD histogram negative — 4h momentum fading', alignment: 'CONFLICTED' };
  } else {
    if (ind4h.trend !== 'BEARISH')
      return { confirmed: false, reason: '4h trend not bearish — macro direction against signal', alignment: 'CONFLICTED' };
    if (ind4h.rsi < 28)
      return { confirmed: false, reason: `4h RSI oversold at ${ind4h.rsi.toFixed(1)} — late entry risk`, alignment: 'CONFLICTED' };
    if (ind1h.trend !== 'BEARISH')
      return { confirmed: false, reason: '1h trend not bearish — entry TF diverging from 4h', alignment: 'CONFLICTED' };
    if (ind4h.macd.histogram > 0)
      return { confirmed: false, reason: '4h MACD histogram positive — 4h momentum fading', alignment: 'CONFLICTED' };
  }

  // Classify alignment quality
  const strongBuy  = ind4h.rsi >= 55 && ind1h.rsi >= 52 && ind4h.macd.histogram > 0 && ind1h.macd.histogram > 0;
  const strongSell = ind4h.rsi <= 45 && ind1h.rsi <= 48 && ind4h.macd.histogram < 0 && ind1h.macd.histogram < 0;
  const isStrong   = type === 'BUY' ? strongBuy : strongSell;

  return {
    confirmed:  true,
    reason:    `1h + 4h both ${type === 'BUY' ? 'bullish' : 'bearish'} — MTF confirmed`,
    alignment:  isStrong ? 'STRONG' : 'WEAK',
  };
}
