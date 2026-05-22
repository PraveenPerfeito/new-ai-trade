import { MarketRegime, MarketRegimeSnapshot } from '@/types';
import { getSpotKlines } from './binance';
import { calculateAllIndicators, calcTrendStrength, calcVolatilityRating } from './indicators';
import { createLogger } from './logger';

const log = createLogger('lib/market-regime');

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes — BTC regime changes slowly

let _cache: { snapshot: MarketRegimeSnapshot; ts: number } | null = null;

/**
 * Returns a BTC-derived market regime snapshot, cached for 5 minutes per scan.
 * Falls back to a SIDEWAYS neutral default if the BTC fetch fails.
 */
export async function getMarketRegime(): Promise<MarketRegimeSnapshot> {
  if (_cache && Date.now() - _cache.ts < CACHE_TTL_MS) {
    return _cache.snapshot;
  }

  try {
    const candles4h = await getSpotKlines('BTCUSDT', '4h', 100);
    if (candles4h.length < 60) return neutralSnapshot();

    const ind4h    = calculateAllIndicators(candles4h);
    const strength = calcTrendStrength(ind4h);
    const vol      = calcVolatilityRating(ind4h.atr, ind4h.currentPrice);
    const atrPct   = ind4h.currentPrice > 0 ? (ind4h.atr / ind4h.currentPrice) * 100 : 0;

    // 24h change = last 6 × 4h candles (≈ 24h)
    const tail = candles4h.slice(-7);
    const btc24hChange =
      tail.length >= 7 ? ((tail[6].close - tail[0].open) / tail[0].open) * 100 : 0;

    const regime = classifyRegime(ind4h.rsi, ind4h.trend, atrPct, btc24hChange, strength, vol);

    const snapshot: MarketRegimeSnapshot = {
      regime,
      btcRsi4h:     ind4h.rsi,
      btcTrend4h:   ind4h.trend,
      btcAtrPct:    atrPct,
      btc24hChange,
      computedAt:   new Date(),
    };

    _cache = { snapshot, ts: Date.now() };
    log.info({ regime, btcRsi: ind4h.rsi.toFixed(1), atrPct: atrPct.toFixed(2), btc24h: btc24hChange.toFixed(2) }, 'market regime computed');
    return snapshot;
  } catch (err) {
    log.warn({ err }, 'BTC regime fetch failed — defaulting to SIDEWAYS');
    return neutralSnapshot();
  }
}

function classifyRegime(
  rsi: number,
  trend: 'BULLISH' | 'BEARISH' | 'RANGING',
  atrPct: number,
  change24h: number,
  strength: number,
  vol: 'LOW' | 'NORMAL' | 'HIGH' | 'EXTREME',
): MarketRegime {
  if (rsi > 78 && change24h > 8)  return 'EUPHORIA';
  if (rsi < 22 && change24h < -8) return 'CAPITULATION';
  if ((vol === 'HIGH' || vol === 'EXTREME') && Math.abs(change24h) > 5) return 'HIGH_VOLATILITY';
  if (trend === 'BULLISH' && strength >= 50) return 'BULL_TREND';
  if (trend === 'BEARISH' && strength >= 50) return 'BEAR_TREND';
  return 'SIDEWAYS';
}

/**
 * Scores how well the signal direction aligns with the current market regime.
 * Applied as a flat ±adjustment (not part of the institutional score weighted sum).
 */
export function scoreRegimeAlignment(
  signalType: 'BUY' | 'SELL',
  regime: MarketRegime,
): number {
  if (signalType === 'BUY') {
    if (regime === 'BULL_TREND')    return  15;
    if (regime === 'SIDEWAYS')      return   0;
    if (regime === 'HIGH_VOLATILITY') return -10;
    if (regime === 'EUPHORIA')      return -15; // overbought environment
    if (regime === 'BEAR_TREND')    return -25;
    if (regime === 'CAPITULATION')  return -25;
  } else {
    if (regime === 'BEAR_TREND')    return  15;
    if (regime === 'CAPITULATION')  return  10; // SELL in capitulation valid but extreme
    if (regime === 'SIDEWAYS')      return   0;
    if (regime === 'HIGH_VOLATILITY') return -10;
    if (regime === 'BULL_TREND')    return -25;
    if (regime === 'EUPHORIA')      return -25;
  }
  return 0;
}

function neutralSnapshot(): MarketRegimeSnapshot {
  return {
    regime:       'SIDEWAYS',
    btcRsi4h:     50,
    btcTrend4h:   'RANGING',
    btcAtrPct:    2.5,
    btc24hChange: 0,
    computedAt:   new Date(),
  };
}
