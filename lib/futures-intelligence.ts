'use server';

import {
  getFundingRate,
  getOpenInterestHistory,
  getLongShortRatio,
} from './binance';
import {
  FuturesData,
  LiquidationZone,
  BreakoutSignal,
  TrendContinuationData,
  Candle,
} from '@/types';

// ─── Module-level caches ──────────────────────────────────────────────────────

interface CacheEntry<T> { value: T; ts: number; }

const fundingCache = new Map<string, CacheEntry<number>>();
const oiCache      = new Map<string, CacheEntry<{ current: number; change24h: number }>>();
const lsCache      = new Map<string, CacheEntry<{ ratio: number; longPct: number; shortPct: number }>>();

const FUNDING_TTL = 5 * 60_000;
const OI_TTL      = 2 * 60_000;
const LS_TTL      = 5 * 60_000;

const PRIORITY_SYMBOLS = new Set(['BTC', 'ETH', 'SOL']);

// ─── Funding rate ─────────────────────────────────────────────────────────────

async function getCachedFundingRate(symbol: string): Promise<number> {
  const cached = fundingCache.get(symbol);
  if (cached && Date.now() - cached.ts < FUNDING_TTL) return cached.value;

  const data = await getFundingRate(symbol);
  const rate = data?.fundingRate ?? 0;
  fundingCache.set(symbol, { value: rate, ts: Date.now() });
  return rate;
}

// ─── Open interest ────────────────────────────────────────────────────────────

async function getCachedOI(symbol: string): Promise<{ current: number; change24h: number }> {
  const cached = oiCache.get(symbol);
  if (cached && Date.now() - cached.ts < OI_TTL) return cached.value;

  const history = await getOpenInterestHistory(symbol, '1h', 25);
  if (history.length < 2) {
    const result = { current: 0, change24h: 0 };
    oiCache.set(symbol, { value: result, ts: Date.now() });
    return result;
  }

  const current   = history[history.length - 1].sumOpenInterest;
  const past24h   = history[Math.max(0, history.length - 25)].sumOpenInterest;
  const change24h = past24h > 0 ? ((current - past24h) / past24h) * 100 : 0;

  const result = { current, change24h };
  oiCache.set(symbol, { value: result, ts: Date.now() });
  return result;
}

// ─── Long/short ratio ─────────────────────────────────────────────────────────

async function getCachedLongShort(
  symbol: string,
): Promise<{ ratio: number; longPct: number; shortPct: number }> {
  const cached = lsCache.get(symbol);
  if (cached && Date.now() - cached.ts < LS_TTL) return cached.value;

  const history = await getLongShortRatio(symbol, '1h', 4);
  if (!history.length) {
    const result = { ratio: 1, longPct: 50, shortPct: 50 };
    lsCache.set(symbol, { value: result, ts: Date.now() });
    return result;
  }

  const latest  = history[history.length - 1];
  const result  = {
    ratio:    latest.longShortRatio,
    longPct:  latest.longAccount * 100,
    shortPct: latest.shortAccount * 100,
  };
  lsCache.set(symbol, { value: result, ts: Date.now() });
  return result;
}

// ─── Liquidation zone detection ───────────────────────────────────────────────

function detectLiquidationZones(
  candles: Candle[],
  currentPrice: number,
  atr: number,
  fundingRate: number,
): LiquidationZone[] {
  if (candles.length < 20) return [];

  const zones: LiquidationZone[] = [];
  const window = candles.slice(-50);

  // Swing highs / lows in rolling 5-candle windows
  for (let i = 2; i < window.length - 2; i++) {
    const isSwingHigh =
      window[i].high > window[i - 1].high &&
      window[i].high > window[i - 2].high &&
      window[i].high > window[i + 1].high &&
      window[i].high > window[i + 2].high;

    const isSwingLow =
      window[i].low < window[i - 1].low &&
      window[i].low < window[i - 2].low &&
      window[i].low < window[i + 1].low &&
      window[i].low < window[i + 2].low;

    if (isSwingHigh) {
      // Long liquidations cluster above swing highs (price above = longs get liquidated)
      const liqPrice   = window[i].high * 1.005;
      const distancePct = ((liqPrice - currentPrice) / currentPrice) * 100;
      const ageCandles  = window.length - 1 - i;
      const strength    = ageCandles < 10 ? 'STRONG' : ageCandles < 25 ? 'MODERATE' : 'WEAK';
      zones.push({ price: liqPrice, side: 'LONG_LIQ', strength, distancePct });
    }

    if (isSwingLow) {
      // Short liquidations cluster below swing lows
      const liqPrice   = window[i].low * 0.995;
      const distancePct = ((liqPrice - currentPrice) / currentPrice) * 100;
      const ageCandles  = window.length - 1 - i;
      const strength    = ageCandles < 10 ? 'STRONG' : ageCandles < 25 ? 'MODERATE' : 'WEAK';
      zones.push({ price: liqPrice, side: 'SHORT_LIQ', strength, distancePct });
    }
  }

  // Funding-rate-biased ATR zones: extreme longs = SHORT_LIQ zone below price
  if (fundingRate > 0.0005) {
    const liqPrice    = currentPrice - 3 * atr;
    const distancePct = ((liqPrice - currentPrice) / currentPrice) * 100;
    zones.push({ price: liqPrice, side: 'SHORT_LIQ', strength: 'MODERATE', distancePct });
  } else if (fundingRate < -0.0005) {
    const liqPrice    = currentPrice + 3 * atr;
    const distancePct = ((liqPrice - currentPrice) / currentPrice) * 100;
    zones.push({ price: liqPrice, side: 'LONG_LIQ', strength: 'MODERATE', distancePct });
  }

  // Keep only zones within 10% of current price, sorted by proximity
  return zones
    .filter(z => Math.abs(z.distancePct) <= 10)
    .sort((a, b) => Math.abs(a.distancePct) - Math.abs(b.distancePct))
    .slice(0, 6);
}

// ─── Breakout detection ───────────────────────────────────────────────────────

function detectBreakout(candles: Candle[], currentPrice: number): BreakoutSignal {
  const consolidationCandles = 20;
  if (candles.length < consolidationCandles + 2) {
    return {
      detected: false, direction: 'UP', breakoutPct: 0,
      rangeHigh: currentPrice, rangeLow: currentPrice,
      volumeConfirmed: false, ageCandles: 0,
    };
  }

  const range    = candles.slice(-consolidationCandles - 2, -2);
  const last2    = candles.slice(-2);
  const latest   = candles[candles.length - 1];

  const rangeHigh = Math.max(...range.map(c => c.high));
  const rangeLow  = Math.min(...range.map(c => c.low));
  const rangeSize = (rangeHigh - rangeLow) / rangeLow;

  // Consolidation: range size must be <5%
  if (rangeSize > 0.05) {
    return {
      detected: false, direction: 'UP', breakoutPct: 0,
      rangeHigh, rangeLow, volumeConfirmed: false, ageCandles: 0,
    };
  }

  const avgVolume    = range.reduce((s, c) => s + c.volume, 0) / range.length;
  const breakoutVol  = last2.reduce((s, c) => s + c.volume, 0) / last2.length;
  const volumeSpike  = breakoutVol / (avgVolume || 1);
  const volumeConfirmed = volumeSpike >= 1.5;

  const THRESHOLD = 0.01; // 1% break beyond range

  if (latest.close > rangeHigh * (1 + THRESHOLD)) {
    const breakoutPct = ((latest.close - rangeHigh) / rangeHigh) * 100;
    return {
      detected: true, direction: 'UP', breakoutPct,
      rangeHigh, rangeLow, volumeConfirmed, ageCandles: 1,
    };
  }

  if (latest.close < rangeLow * (1 - THRESHOLD)) {
    const breakoutPct = ((rangeLow - latest.close) / rangeLow) * 100;
    return {
      detected: true, direction: 'DOWN', breakoutPct,
      rangeHigh, rangeLow, volumeConfirmed, ageCandles: 1,
    };
  }

  return {
    detected: false, direction: 'UP', breakoutPct: 0,
    rangeHigh, rangeLow, volumeConfirmed: false, ageCandles: 0,
  };
}

// ─── Trend continuation ───────────────────────────────────────────────────────

function analyzeTrendContinuation(
  candles: Candle[],
  ema20: number,
  atr: number,
  trend: 'BULLISH' | 'BEARISH' | 'RANGING',
): TrendContinuationData {
  if (candles.length < 10 || trend === 'RANGING') {
    return {
      isPullback: false, pullbackDepth: 0,
      holdingKeyLevel: false, keyLevel: 0, continuationConfidence: 0,
    };
  }

  const currentPrice = candles[candles.length - 1].close;
  const keyLevel     = ema20;
  const distFromEma  = Math.abs(currentPrice - ema20);
  const pullbackDepth = distFromEma / (atr || 1);

  // Pullback: price within 1.5 ATR of EMA20 after moving away
  const prevPrices = candles.slice(-6, -1).map(c => c.close);
  const wasFarther = prevPrices.some(p =>
    trend === 'BULLISH' ? p > ema20 + 1.5 * atr : p < ema20 - 1.5 * atr,
  );
  const isNearEma    = distFromEma < 1.5 * atr;
  const isPullback   = wasFarther && isNearEma;
  const holdingKeyLevel =
    trend === 'BULLISH' ? currentPrice >= ema20 : currentPrice <= ema20;

  // Confidence: higher if price recently respected EMA + volume normalizing
  let continuationConfidence = 0;
  if (isPullback && holdingKeyLevel) {
    continuationConfidence = 60;
    if (pullbackDepth < 0.8) continuationConfidence += 15;
    if (pullbackDepth > 2.0) continuationConfidence -= 20;
  }

  return {
    isPullback,
    pullbackDepth: Math.round(pullbackDepth * 10) / 10,
    holdingKeyLevel,
    keyLevel,
    continuationConfidence: Math.max(0, Math.min(100, continuationConfidence)),
  };
}

// ─── Momentum score ───────────────────────────────────────────────────────────

function calcMomentumScore(params: {
  fundingRate:     number;
  oiChange24h:     number;
  longShortRatio:  number;
  breakout:        BreakoutSignal;
  trendCont:       TrendContinuationData;
  rsi:             number;
  trend:           'BULLISH' | 'BEARISH' | 'RANGING';
  signalType:      'BUY' | 'SELL';
  baseSymbol:      string;
}): number {
  let score = 50; // neutral start

  const { fundingRate, oiChange24h, longShortRatio, breakout, trendCont, rsi, trend, signalType, baseSymbol } = params;

  // Priority coin bonus
  if (PRIORITY_SYMBOLS.has(baseSymbol.toUpperCase())) score += 5;

  // Funding rate alignment: low/negative funding on BUY = bullish (shorts paying longs)
  if (signalType === 'BUY') {
    if (fundingRate < -0.0001) score += 12;
    else if (fundingRate < 0.0001) score += 6;
    else if (fundingRate > 0.0003) score -= 8;
    else if (fundingRate > 0.0006) score -= 15;
  } else {
    if (fundingRate > 0.0003) score += 12;
    else if (fundingRate > 0.0001) score += 6;
    else if (fundingRate < -0.0003) score -= 8;
    else if (fundingRate < -0.0006) score -= 15;
  }

  // OI trend
  if (signalType === 'BUY') {
    if (oiChange24h > 5) score += 10;
    else if (oiChange24h > 2) score += 5;
    else if (oiChange24h < -5) score -= 8;
  } else {
    if (oiChange24h < -5) score += 10;
    else if (oiChange24h < -2) score += 5;
    else if (oiChange24h > 5) score -= 8;
  }

  // Long/short ratio extremes (contrarian signals)
  if (signalType === 'BUY' && longShortRatio < 0.8) score += 8;  // extreme shorts = squeeze fuel
  if (signalType === 'SELL' && longShortRatio > 1.5) score += 8; // extreme longs = dump fuel

  // Breakout bonus
  if (breakout.detected) {
    const breakoutAligned =
      (signalType === 'BUY' && breakout.direction === 'UP') ||
      (signalType === 'SELL' && breakout.direction === 'DOWN');
    if (breakoutAligned) {
      score += breakout.volumeConfirmed ? 15 : 8;
    } else {
      score -= 10; // breakout against signal direction
    }
  }

  // Trend continuation
  if (trendCont.isPullback && trendCont.holdingKeyLevel) {
    score += Math.round(trendCont.continuationConfidence * 0.15);
  }

  // Trend alignment
  if (signalType === 'BUY' && trend === 'BULLISH') score += 8;
  else if (signalType === 'SELL' && trend === 'BEARISH') score += 8;
  else if (trend !== 'RANGING') score -= 5;

  // RSI context
  if (signalType === 'BUY' && rsi < 45) score += 5;
  else if (signalType === 'SELL' && rsi > 55) score += 5;

  return Math.max(0, Math.min(100, Math.round(score)));
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export interface FuturesIntelligenceInput {
  symbol:      string;      // e.g. "BTCUSDT"
  baseSymbol:  string;      // e.g. "BTC"
  candles1h:   Candle[];
  ema20:       number;
  atr:         number;
  rsi:         number;
  trend:       'BULLISH' | 'BEARISH' | 'RANGING';
  signalType:  'BUY' | 'SELL';
}

export async function analyzeFuturesIntelligence(
  input: FuturesIntelligenceInput,
): Promise<FuturesData> {
  const { symbol, baseSymbol, candles1h, ema20, atr, rsi, trend, signalType } = input;

  const [fundingRate, oiData, lsData] = await Promise.all([
    getCachedFundingRate(symbol),
    getCachedOI(symbol),
    getCachedLongShort(symbol),
  ]);

  const fundingRateAnnualized = fundingRate * 3 * 365 * 100; // 3 sessions/day, annualized %
  const fundingBias =
    fundingRate >  0.0002 ? 'LONG_HEAVY'  :
    fundingRate < -0.0002 ? 'SHORT_HEAVY' : 'NEUTRAL';

  const oiTrend =
    oiData.change24h > 3  ? 'RISING'  :
    oiData.change24h < -3 ? 'FALLING' : 'STABLE';

  const currentPrice = candles1h.length > 0 ? candles1h[candles1h.length - 1].close : 0;

  const liquidationZones    = detectLiquidationZones(candles1h, currentPrice, atr, fundingRate);
  const breakout            = detectBreakout(candles1h, currentPrice);
  const trendContinuation   = analyzeTrendContinuation(candles1h, ema20, atr, trend);

  const momentumScore = calcMomentumScore({
    fundingRate,
    oiChange24h:    oiData.change24h,
    longShortRatio: lsData.ratio,
    breakout,
    trendCont:      trendContinuation,
    rsi,
    trend,
    signalType,
    baseSymbol,
  });

  return {
    fundingRate,
    fundingRateAnnualized: Math.round(fundingRateAnnualized * 100) / 100,
    fundingBias,
    openInterest:      oiData.current,
    oiChange24h:       Math.round(oiData.change24h * 100) / 100,
    oiTrend,
    longShortRatio:    lsData.ratio,
    longAccountPercent:  lsData.longPct,
    shortAccountPercent: lsData.shortPct,
    liquidationZones,
    momentumScore,
    breakout: breakout.detected ? breakout : undefined,
    trendContinuation,
  };
}
