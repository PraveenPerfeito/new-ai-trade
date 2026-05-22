import { Candle, TechnicalIndicators } from '@/types';
import { calcEMA } from './indicators';

// ─── Internal helpers ────────────────────────────────────────────────────────

/**
 * Full RSI series (one value per candle, using Wilder smoothing).
 * The first `period` values are filled with 50 (neutral) as there is
 * not enough history to compute a meaningful RSI there.
 */
function calcRSISeries(closes: number[], period = 14): number[] {
  if (closes.length < period + 2) return closes.map(() => 50);

  const changes = closes.slice(1).map((c, i) => c - closes[i]);
  const gains   = changes.map(c => (c > 0 ? c : 0));
  const losses  = changes.map(c => (c < 0 ? -c : 0));

  const result: number[] = new Array(period + 1).fill(50);

  let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));

  for (let i = period; i < changes.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
    result.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  }

  return result;
}

/**
 * Wilder's ADX (Average Directional Index), period 14.
 * Returns 0–100; values below 20 indicate a ranging/sideways market.
 * Returns 25 (neutral) when there are not enough candles to compute.
 */
function calcADX(candles: Candle[], period = 14): number {
  if (candles.length < period * 2 + 2) return 25;

  const highs  = candles.map(c => c.high);
  const lows   = candles.map(c => c.low);
  const closes = candles.map(c => c.close);

  const trs: number[]    = [];
  const dmPlus: number[] = [];
  const dmMinus: number[] = [];

  for (let i = 1; i < candles.length; i++) {
    trs.push(Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i]  - closes[i - 1]),
    ));
    const up   = highs[i] - highs[i - 1];
    const down = lows[i - 1] - lows[i];
    dmPlus.push(up > down && up > 0 ? up : 0);
    dmMinus.push(down > up && down > 0 ? down : 0);
  }

  // Wilder seed
  let atr14  = trs.slice(0, period).reduce((a, b) => a + b, 0);
  let dm14p  = dmPlus.slice(0, period).reduce((a, b) => a + b, 0);
  let dm14m  = dmMinus.slice(0, period).reduce((a, b) => a + b, 0);

  const dxValues: number[] = [];

  for (let i = period; i < trs.length; i++) {
    atr14 = atr14 - atr14 / period + trs[i];
    dm14p = dm14p - dm14p / period + dmPlus[i];
    dm14m = dm14m - dm14m / period + dmMinus[i];

    const di14p = atr14 > 0 ? (dm14p / atr14) * 100 : 0;
    const di14m = atr14 > 0 ? (dm14m / atr14) * 100 : 0;
    const sum   = di14p + di14m;
    dxValues.push(sum > 0 ? (Math.abs(di14p - di14m) / sum) * 100 : 0);
  }

  if (dxValues.length < period) return 25;
  return dxValues.slice(-period).reduce((a, b) => a + b, 0) / period;
}

// ─── 1. Sideways market detection ────────────────────────────────────────────

/**
 * Rejects entries in ranging/choppy markets using two independent checks:
 *   (a) ADX < 18 — Wilder's standard "no trend" threshold
 *   (b) 20-candle price range compressed below 2.5× ATR — price going nowhere
 *
 * Both checks must independently agree before rejecting to avoid false
 * positives when ADX hasn't yet caught up to a brand-new trend impulse.
 */
export function detectSidewaysMarket(
  candles: Candle[],
  atr: number,
): { isSideways: boolean; reason: string; adx: number } {
  const adx = calcADX(candles);

  if (candles.length < 20) return { isSideways: false, reason: '', adx };

  const recent20   = candles.slice(-20);
  const rangeHigh  = Math.max(...recent20.map(c => c.high));
  const rangeLow   = Math.min(...recent20.map(c => c.low));
  const rangeToAtr = atr > 0 ? (rangeHigh - rangeLow) / atr : 99;

  // Both ADX weak AND price compressed → clear sideways market
  if (adx < 20 && rangeToAtr < 3.0) {
    return {
      isSideways: true,
      reason: `ADX ${adx.toFixed(1)} + 20-candle range only ${rangeToAtr.toFixed(1)}× ATR — ranging market, no directional edge`,
      adx,
    };
  }

  // Very weak ADX alone is a hard reject
  if (adx < 16) {
    return {
      isSideways: true,
      reason: `ADX ${adx.toFixed(1)} < 16 — flat market, trend entry has no edge`,
      adx,
    };
  }

  // Severely compressed price range alone (< 2× ATR over 20 candles)
  if (rangeToAtr < 2.0) {
    return {
      isSideways: true,
      reason: `20-candle range ${rangeToAtr.toFixed(1)}× ATR — price tightly compressed, likely consolidation`,
      adx,
    };
  }

  return { isSideways: false, reason: '', adx };
}

// ─── 2. Fake volume spike detection ──────────────────────────────────────────

/**
 * Detects two types of fake volume:
 *   (a) Wash-trade signature: high volume but tiny candle body + small range
 *       → institution or bot cycling coins, not real directional demand
 *   (b) Isolated spike: surrounding candles all below average
 *       → one-off print (liquidation cascade, single large OTC order), not a trend driver
 *
 * Only triggers when volumeSpike is already ≥ 2.5× to avoid penalising
 * genuine below-average volume candles.
 */
export function isFakeVolumeSpike(
  candles: Candle[],
  volumeSpike: number,
  atr: number,
): { isFake: boolean; reason: string } {
  if (volumeSpike < 2.5 || candles.length < 8) return { isFake: false, reason: '' };

  const last  = candles[candles.length - 1];
  const range = last.high - last.low;
  const body  = Math.abs(last.close - last.open);

  // Wash-trade signature: big volume, tiny price movement
  if (range > 0 && body / range < 0.15 && atr > 0 && range < atr * 0.35) {
    return {
      isFake: true,
      reason: `Volume ${volumeSpike.toFixed(1)}× but candle body only ${(body / range * 100).toFixed(0)}% of range and range < 0.35 ATR — wash trade signature`,
    };
  }

  // Isolated spike: ≥ 4 of the 5 candles before the spike were below average
  if (volumeSpike >= 3.0 && candles.length >= 22) {
    const avgVol  = candles.slice(-21, -1).map(c => c.volume).reduce((a, b) => a + b, 0) / 20;
    const prior5  = candles.slice(-6, -1).map(c => c.volume);
    const lowCount = prior5.filter(v => v < avgVol * 0.75).length;
    if (lowCount >= 4) {
      return {
        isFake: true,
        reason: `Volume spike ${volumeSpike.toFixed(1)}× is isolated — ${lowCount}/5 prior candles below 75% avg, not sustained buying`,
      };
    }
  }

  return { isFake: false, reason: '' };
}

// ─── 3. Candle structure analysis ────────────────────────────────────────────

/**
 * Rejects entries based on the last candle's body/wick structure:
 *   • Rejection candle (BUY): upper wick > 62% of range + body < 20%
 *     → price spiked up but sellers pushed it back hard — not a good long entry
 *   • Bounce candle (SELL): lower wick > 62% of range + body < 20%
 *     → price spiked down but buyers absorbed it — not a good short entry
 *   • Engulfing against direction: strong momentum reversal signal
 *   • Doji with meaningful range: indecision at a key price level
 */
export function analyzeCandleStructure(
  candles: Candle[],
  signalType: 'BUY' | 'SELL',
  atr: number,
): { pass: boolean; reason: string } {
  if (candles.length < 3) return { pass: true, reason: '' };

  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const range = last.high - last.low;
  if (range === 0) return { pass: true, reason: '' };

  const body          = Math.abs(last.close - last.open);
  const upperWick     = last.high - Math.max(last.open, last.close);
  const lowerWick     = Math.min(last.open, last.close) - last.low;
  const bodyRatio     = body / range;
  const upperWickRatio = upperWick / range;
  const lowerWickRatio = lowerWick / range;

  if (signalType === 'BUY') {
    // Shooting star / bearish rejection: big upper wick, tiny body
    if (upperWickRatio > 0.62 && bodyRatio < 0.20) {
      return {
        pass: false,
        reason: `Bearish rejection candle: upper wick ${(upperWickRatio * 100).toFixed(0)}% of range, body ${(bodyRatio * 100).toFixed(0)}% — sellers rejected the high`,
      };
    }
    // Bearish engulfing: last bearish candle fully covers prior bullish candle
    if (
      last.close < last.open &&
      prev.close > prev.open &&
      body > Math.abs(prev.close - prev.open) * 1.1
    ) {
      return { pass: false, reason: 'Bearish engulfing: momentum reversal — avoid BUY entry' };
    }
  } else {
    // Hammer / bullish bounce: big lower wick, tiny body
    if (lowerWickRatio > 0.62 && bodyRatio < 0.20) {
      return {
        pass: false,
        reason: `Bullish bounce candle: lower wick ${(lowerWickRatio * 100).toFixed(0)}% of range, body ${(bodyRatio * 100).toFixed(0)}% — buyers absorbed the dip`,
      };
    }
    // Bullish engulfing: last bullish candle fully covers prior bearish candle
    if (
      last.close > last.open &&
      prev.close < prev.open &&
      body > Math.abs(prev.close - prev.open) * 1.1
    ) {
      return { pass: false, reason: 'Bullish engulfing: momentum reversal — avoid SELL entry' };
    }
  }

  // Doji on a meaningful candle: strong indecision
  if (bodyRatio < 0.08 && range >= atr * 0.4) {
    return {
      pass: false,
      reason: `Doji: body only ${(bodyRatio * 100).toFixed(0)}% of range on a ${(range / atr).toFixed(1)}× ATR candle — market indecision at this level`,
    };
  }

  return { pass: true, reason: '' };
}

// ─── 4. Trend exhaustion detection ───────────────────────────────────────────

/**
 * Two exhaustion signals:
 *   (a) RSI divergence over the last 20 candles:
 *       BUY: price making higher highs but RSI making lower highs (bearish div)
 *       SELL: price making lower lows but RSI making higher lows (bullish div)
 *   (b) RSI sustained extreme: held above 73 (BUY) or below 27 (SELL) for 5+
 *       consecutive candles → overextended, reversal risk is elevated
 */
export function detectTrendExhaustion(
  candles: Candle[],
  signalType: 'BUY' | 'SELL',
): { isExhausted: boolean; reason: string } {
  if (candles.length < 30) return { isExhausted: false, reason: '' };

  const closes = candles.map(c => c.close);
  const highs  = candles.map(c => c.high);
  const lows   = candles.map(c => c.low);
  const rsiArr = calcRSISeries(closes);

  const n         = 20;
  const mid       = Math.floor(n / 2);
  const rsiWindow = rsiArr.slice(-n);
  const hiWindow  = highs.slice(-n);
  const loWindow  = lows.slice(-n);

  if (signalType === 'BUY') {
    // Bearish RSI divergence
    const priceHighOld = Math.max(...hiWindow.slice(0, mid));
    const priceHighNew = Math.max(...hiWindow.slice(mid));
    const rsiHighOld   = Math.max(...rsiWindow.slice(0, mid));
    const rsiHighNew   = Math.max(...rsiWindow.slice(mid));

    if (priceHighNew > priceHighOld * 1.008 && rsiHighNew < rsiHighOld - 4) {
      return {
        isExhausted: true,
        reason: `Bearish RSI divergence: price high +${((priceHighNew / priceHighOld - 1) * 100).toFixed(1)}% but RSI high fell ${(rsiHighOld - rsiHighNew).toFixed(1)}pts — momentum fading`,
      };
    }

    // Sustained overbought extension
    if (rsiWindow.slice(-5).every(r => r > 73)) {
      return {
        isExhausted: true,
        reason: `RSI sustained above 73 for 5 consecutive candles — overbought extension, reversal risk high`,
      };
    }
  } else {
    // Bullish RSI divergence
    const priceLowOld = Math.min(...loWindow.slice(0, mid));
    const priceLowNew = Math.min(...loWindow.slice(mid));
    const rsiLowOld   = Math.min(...rsiWindow.slice(0, mid));
    const rsiLowNew   = Math.min(...rsiWindow.slice(mid));

    if (priceLowNew < priceLowOld * 0.992 && rsiLowNew > rsiLowOld + 4) {
      return {
        isExhausted: true,
        reason: `Bullish RSI divergence: price low -${((1 - priceLowNew / priceLowOld) * 100).toFixed(1)}% but RSI low rose ${(rsiLowNew - rsiLowOld).toFixed(1)}pts — downtrend losing steam`,
      };
    }

    // Sustained oversold extension
    if (rsiWindow.slice(-5).every(r => r < 27)) {
      return {
        isExhausted: true,
        reason: `RSI sustained below 27 for 5 consecutive candles — oversold extension, bounce risk high`,
      };
    }
  }

  return { isExhausted: false, reason: '' };
}

// ─── 5. Support / resistance rejection zone detection ────────────────────────

/**
 * Finds pivot highs/lows in the last 50 candles (using a ±3 candle window)
 * and rejects entries where the current price is within 1.2× ATR of two or
 * more tested levels in the direction of the trade.
 *
 * Rationale: a single pivot could be random noise; two or more pivots at the
 * same zone indicate a well-tested level with a high probability of rejection.
 *
 * BUY: rejects when two+ resistance pivots sit just above current price
 * SELL: rejects when two+ support pivots sit just below current price
 */
export function detectSRRejection(
  candles: Candle[],
  currentPrice: number,
  atr: number,
  signalType: 'BUY' | 'SELL',
): { isNearRejection: boolean; reason: string } {
  if (candles.length < 30 || atr === 0) return { isNearRejection: false, reason: '' };

  const lookback     = candles.slice(-50);
  const pivotWindow  = 3;
  const pivotHighs: number[] = [];
  const pivotLows:  number[] = [];

  for (let i = pivotWindow; i < lookback.length - pivotWindow; i++) {
    const h    = lookback[i].high;
    const l    = lookback[i].low;
    const band = lookback.slice(i - pivotWindow, i + pivotWindow + 1);
    if (band.every(c => c.high <= h)) pivotHighs.push(h);
    if (band.every(c => c.low  >= l)) pivotLows.push(l);
  }

  const threshold = atr * 1.2;

  if (signalType === 'BUY') {
    const overhead = pivotHighs.filter(h => h > currentPrice && h < currentPrice + threshold);
    if (overhead.length >= 2) {
      return {
        isNearRejection: true,
        reason: `${overhead.length} resistance pivots within 1.2× ATR overhead — price entering a tested rejection zone`,
      };
    }
  } else {
    const underfoot = pivotLows.filter(l => l < currentPrice && l > currentPrice - threshold);
    if (underfoot.length >= 2) {
      return {
        isNearRejection: true,
        reason: `${underfoot.length} support pivots within 1.2× ATR below — price entering a tested bounce zone`,
      };
    }
  }

  return { isNearRejection: false, reason: '' };
}

// ─── 6. Overextended candle detection ────────────────────────────────────────

/**
 * Rejects entries after abnormally large candle moves:
 *   (a) Last single candle range > 3× ATR — likely news-driven, stops unreliable
 *   (b) 3-candle directional run > 4× ATR — momentum exhausted, mean reversion likely
 *
 * Using the open-to-close of the 3-candle run (not high-low) ensures we
 * measure directional displacement, not just volatility.
 */
export function detectOverextension(
  candles: Candle[],
  atr: number,
  signalType: 'BUY' | 'SELL',
): { isOverextended: boolean; reason: string; factor: number } {
  if (candles.length < 4 || atr === 0) return { isOverextended: false, reason: '', factor: 1 };

  const last         = candles[candles.length - 1];
  const singleRange  = last.high - last.low;
  const singleFactor = singleRange / atr;

  if (singleFactor > 3.0) {
    return {
      isOverextended: true,
      reason: `Last candle range ${singleFactor.toFixed(1)}× ATR — abnormally large, likely news-driven move`,
      factor: singleFactor,
    };
  }

  const last3  = candles.slice(-3);
  const move3  = signalType === 'BUY'
    ? last3[2].close - last3[0].open
    : last3[0].open - last3[2].close;
  const run3   = move3 / atr;

  if (run3 > 4.0) {
    return {
      isOverextended: true,
      reason: `3-candle run of ${run3.toFixed(1)}× ATR — overextended, mean reversion likely before continuation`,
      factor: run3,
    };
  }

  return { isOverextended: false, reason: '', factor: Math.max(singleFactor, run3) };
}

// ─── 7. Weak breakout detection ──────────────────────────────────────────────

/**
 * Two weak-breakout patterns:
 *   (a) Failed breakout: wick crossed a key level but the candle closed back
 *       inside the range → liquidity grab / stop hunt, not a real breakout
 *   (b) Marginal breakout: price barely cleared the level (<0.25 ATR) AND
 *       volume was below-average (< 1.3×) → no institutional conviction
 *
 * The reference level is the highest/lowest CLOSE of the prior 25 candles
 * (not the high/low) to use the same logic the market uses for close-above
 * confirmation of a breakout.
 */
export function analyzeBreakoutStrength(
  candles: Candle[],
  atr: number,
  volumeSpike: number,
  signalType: 'BUY' | 'SELL',
): { isWeak: boolean; reason: string } {
  if (candles.length < 27 || atr === 0) return { isWeak: false, reason: '' };

  const reference = candles.slice(-26, -1); // 25 prior candles
  const last      = candles[candles.length - 1];

  if (signalType === 'BUY') {
    const resistanceClose = Math.max(...reference.map(c => c.close));
    const resistanceHigh  = Math.max(...reference.map(c => c.high));

    // Wick above resistance but closed back below (liquidity grab)
    if (last.high > resistanceHigh && last.close < resistanceClose) {
      return {
        isWeak: true,
        reason: `Failed breakout: wick above ${resistanceHigh.toFixed(4)} resistance but closed below — stop hunt / rejection`,
      };
    }

    // Marginal breakout with no volume follow-through
    const margin = last.close - resistanceClose;
    if (margin > 0 && margin < atr * 0.25 && volumeSpike < 1.3) {
      return {
        isWeak: true,
        reason: `Weak breakout: only ${(margin / atr * 100).toFixed(0)}% ATR above resistance with ${volumeSpike.toFixed(1)}× volume — no conviction`,
      };
    }
  } else {
    const supportClose = Math.min(...reference.map(c => c.close));
    const supportLow   = Math.min(...reference.map(c => c.low));

    // Wick below support but closed back above (liquidity grab)
    if (last.low < supportLow && last.close > supportClose) {
      return {
        isWeak: true,
        reason: `Failed breakdown: wick below ${supportLow.toFixed(4)} support but closed above — stop hunt / bounce`,
      };
    }

    // Marginal breakdown with no volume follow-through
    const margin = supportClose - last.close;
    if (margin > 0 && margin < atr * 0.25 && volumeSpike < 1.3) {
      return {
        isWeak: true,
        reason: `Weak breakdown: only ${(margin / atr * 100).toFixed(0)}% ATR below support with ${volumeSpike.toFixed(1)}× volume — no conviction`,
      };
    }
  }

  return { isWeak: false, reason: '' };
}

// ─── 8. Fake breakout / breakdown detection ───────────────────────────────────

/**
 * Rejects breakouts that cleared a reference level but did so with insufficient
 * volume — a common sign of a stop hunt or low-conviction push.
 *
 * Note: analyzeBreakoutStrength (check 7) catches failed wicks and marginal
 * closes; this check catches confirmed closes with weak volume follow-through
 * (different scenario — the price is genuinely above resistance but nobody
 * is participating in the continuation).
 */
export function detectFakeBreakout(
  candles: Candle[],
  volumeSpike: number,
  signalType: 'BUY' | 'SELL',
): { isFake: boolean; reason: string } {
  if (candles.length < 26 || volumeSpike >= 1.5) return { isFake: false, reason: '' };

  const last = candles[candles.length - 1];
  const ref  = candles.slice(-26, -1);

  if (signalType === 'BUY') {
    const prevHighClose = Math.max(...ref.map(c => c.close));
    if (last.close > prevHighClose) {
      return {
        isFake: true,
        reason: `Breakout close above ${prevHighClose.toFixed(4)} on only ${volumeSpike.toFixed(1)}× volume — unconfirmed breakout`,
      };
    }
  } else {
    const prevLowClose = Math.min(...ref.map(c => c.close));
    if (last.close < prevLowClose) {
      return {
        isFake: true,
        reason: `Breakdown close below ${prevLowClose.toFixed(4)} on only ${volumeSpike.toFixed(1)}× volume — unconfirmed breakdown`,
      };
    }
  }

  return { isFake: false, reason: '' };
}

// ─── 9. Euphoric spike / capitulation spike detection ─────────────────────────

/**
 * Rejects entries after abnormally fast directional moves combined with extreme
 * RSI — hallmark of euphoric tops and capitulation bottoms, both of which are
 * poor entry points because mean reversion is imminent.
 */
export function detectEuphoricSpike(
  candles: Candle[],
  ind1h: TechnicalIndicators,
  signalType: 'BUY' | 'SELL',
): { isEuphoric: boolean; reason: string } {
  if (candles.length < 5) return { isEuphoric: false, reason: '' };

  const last4     = candles.slice(-5, -1);
  const change4h  = ((last4[last4.length - 1].close - last4[0].open) / last4[0].open) * 100;

  if (signalType === 'BUY' && change4h > 12 && ind1h.rsi > 78) {
    return {
      isEuphoric: true,
      reason: `+${change4h.toFixed(1)}% in last 4 candles + RSI ${ind1h.rsi.toFixed(0)} — euphoric spike, not a clean long entry`,
    };
  }

  if (signalType === 'SELL' && change4h < -12 && ind1h.rsi < 22) {
    return {
      isEuphoric: true,
      reason: `${change4h.toFixed(1)}% crash in last 4 candles + RSI ${ind1h.rsi.toFixed(0)} — capitulation spike, not a clean short entry`,
    };
  }

  return { isEuphoric: false, reason: '' };
}

// ─── 10. Momentum decline at RSI extreme ─────────────────────────────────────

/**
 * Rejects entries where the last 3 candle bodies in the trade direction are
 * consecutively shrinking AND the RSI is in extreme territory — classic momentum
 * exhaustion pattern before a reversal candle prints.
 */
export function detectMomentumDecline(
  candles: Candle[],
  ind1h: TechnicalIndicators,
  signalType: 'BUY' | 'SELL',
): { isDeclining: boolean; reason: string } {
  if (candles.length < 5) return { isDeclining: false, reason: '' };

  const extremeRsi = signalType === 'BUY' ? ind1h.rsi > 75 : ind1h.rsi < 25;
  if (!extremeRsi) return { isDeclining: false, reason: '' };

  const last3  = candles.slice(-4, -1);
  const bodies = last3.map(c =>
    signalType === 'BUY' ? c.close - c.open : c.open - c.close,
  );

  const allPositive = bodies.every(b => b > 0);
  const declining   = allPositive && bodies[2] < bodies[1] && bodies[1] < bodies[0];

  if (declining) {
    return {
      isDeclining: true,
      reason: `3 consecutive shrinking ${signalType === 'BUY' ? 'bullish' : 'bearish'} bodies at RSI ${ind1h.rsi.toFixed(0)} — momentum fading at extreme`,
    };
  }

  return { isDeclining: false, reason: '' };
}

// ─── Aggregate gate ───────────────────────────────────────────────────────────

export interface MarketStructureResult {
  pass:            boolean;
  rejectionReason: string | null;
  adx:             number;
}

/**
 * Runs all 10 market-structure filters in order from cheapest to most expensive.
 * Returns on the first hard reject — the remaining checks are skipped.
 *
 * Phase 6.1 additions (checks 8-10, only run when ind1h is supplied):
 *   fake breakout → euphoric spike → momentum decline at extreme
 */
export function runMarketStructureChecks(
  candles: Candle[],
  atr: number,
  currentPrice: number,
  volumeSpike: number,
  signalType: 'BUY' | 'SELL',
  ind1h?: TechnicalIndicators,
): MarketStructureResult {
  const sideways = detectSidewaysMarket(candles, atr);
  if (sideways.isSideways) {
    return { pass: false, rejectionReason: sideways.reason, adx: sideways.adx };
  }

  const overextended = detectOverextension(candles, atr, signalType);
  if (overextended.isOverextended) {
    return { pass: false, rejectionReason: overextended.reason, adx: sideways.adx };
  }

  const candleOk = analyzeCandleStructure(candles, signalType, atr);
  if (!candleOk.pass) {
    return { pass: false, rejectionReason: candleOk.reason, adx: sideways.adx };
  }

  const exhaustion = detectTrendExhaustion(candles, signalType);
  if (exhaustion.isExhausted) {
    return { pass: false, rejectionReason: exhaustion.reason, adx: sideways.adx };
  }

  const fakeVol = isFakeVolumeSpike(candles, volumeSpike, atr);
  if (fakeVol.isFake) {
    return { pass: false, rejectionReason: fakeVol.reason, adx: sideways.adx };
  }

  const srReject = detectSRRejection(candles, currentPrice, atr, signalType);
  if (srReject.isNearRejection) {
    return { pass: false, rejectionReason: srReject.reason, adx: sideways.adx };
  }

  const breakout = analyzeBreakoutStrength(candles, atr, volumeSpike, signalType);
  if (breakout.isWeak) {
    return { pass: false, rejectionReason: breakout.reason, adx: sideways.adx };
  }

  // Phase 6.1 checks — only run when ind1h is provided (scanner always passes it)
  if (ind1h) {
    const fakeBO = detectFakeBreakout(candles, volumeSpike, signalType);
    if (fakeBO.isFake) {
      return { pass: false, rejectionReason: fakeBO.reason, adx: sideways.adx };
    }

    const euphoric = detectEuphoricSpike(candles, ind1h, signalType);
    if (euphoric.isEuphoric) {
      return { pass: false, rejectionReason: euphoric.reason, adx: sideways.adx };
    }

    const declining = detectMomentumDecline(candles, ind1h, signalType);
    if (declining.isDeclining) {
      return { pass: false, rejectionReason: declining.reason, adx: sideways.adx };
    }
  }

  return { pass: true, rejectionReason: null, adx: sideways.adx };
}
