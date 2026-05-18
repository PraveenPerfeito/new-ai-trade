import axios from 'axios';
import { Candle } from '@/types';
import { withApiRetry } from './retry';

const SPOT_BASE    = 'https://api.binance.com/api/v3';
const FUTURES_BASE = 'https://fapi.binance.com/fapi/v1';
const FUTURES_DATA = 'https://fapi.binance.com/futures/data';

// Cached futures symbols to avoid repeated exchange info calls
let futuresSymbolCache: Set<string> | null = null;
let futuresCacheTime = 0;
const FUTURES_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

export async function getFuturesSymbols(): Promise<Set<string>> {
  if (futuresSymbolCache && Date.now() - futuresCacheTime < FUTURES_CACHE_TTL) {
    return futuresSymbolCache;
  }

  try {
    const { data } = await axios.get(`${FUTURES_BASE}/exchangeInfo`, { timeout: 15000 });
    futuresSymbolCache = new Set(
      data.symbols
        .filter((s: { quoteAsset: string; status: string }) =>
          s.quoteAsset === 'USDT' && s.status === 'TRADING'
        )
        .map((s: { symbol: string }) => s.symbol)
    );
    futuresCacheTime = Date.now();
    return futuresSymbolCache;
  } catch {
    // Return a safe fallback set of top liquid futures
    return new Set([
      'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT',
      'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT', 'LINKUSDT', 'SUIUSDT',
    ]);
  }
}

function parseKlines(raw: (string | number)[][]): Candle[] {
  return raw.map(k => ({
    openTime: k[0] as number,
    open: parseFloat(k[1] as string),
    high: parseFloat(k[2] as string),
    low: parseFloat(k[3] as string),
    close: parseFloat(k[4] as string),
    volume: parseFloat(k[5] as string),
    closeTime: k[6] as number,
  }));
}

export async function getSpotKlines(
  symbol: string,
  interval = '1h',
  limit = 100,
): Promise<Candle[]> {
  return withApiRetry(async () => {
    try {
      const { data } = await axios.get(`${SPOT_BASE}/klines`, {
        params: { symbol, interval, limit },
        timeout: 10000,
      });
      return parseKlines(data);
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } }).response?.status;
      if (status === 400 || status === 404) return []; // invalid symbol — do not retry
      throw err;
    }
  }, `spot-klines:${symbol}`);
}

export async function getFuturesKlines(
  symbol: string,
  interval = '1h',
  limit = 100,
): Promise<Candle[]> {
  return withApiRetry(async () => {
    try {
      const { data } = await axios.get(`${FUTURES_BASE}/klines`, {
        params: { symbol, interval, limit },
        timeout: 10000,
      });
      return parseKlines(data);
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } }).response?.status;
      if (status === 400 || status === 404) return [];
      throw err;
    }
  }, `futures-klines:${symbol}`);
}

export interface FundingRateData {
  symbol:      string;
  fundingRate: number;   // raw decimal e.g. 0.0001
  fundingTime: number;
}

export async function getFundingRate(symbol: string): Promise<FundingRateData | null> {
  try {
    const { data } = await axios.get(`${FUTURES_BASE}/premiumIndex`, {
      params: { symbol },
      timeout: 8000,
    });
    return {
      symbol:      data.symbol,
      fundingRate: parseFloat(data.lastFundingRate ?? data.fundingRate ?? '0'),
      fundingTime: data.nextFundingTime ?? Date.now(),
    };
  } catch {
    return null;
  }
}

export interface OpenInterestEntry {
  symbol:           string;
  sumOpenInterest:  number;
  timestamp:        number;
}

export async function getOpenInterestHistory(
  symbol: string,
  period = '1h',
  limit  = 24,
): Promise<OpenInterestEntry[]> {
  try {
    const { data } = await axios.get(`${FUTURES_DATA}/openInterestHist`, {
      params: { symbol, period, limit },
      timeout: 8000,
    });
    return (data as { symbol: string; sumOpenInterest: string; timestamp: number }[]).map(d => ({
      symbol:          d.symbol,
      sumOpenInterest: parseFloat(d.sumOpenInterest),
      timestamp:       d.timestamp,
    }));
  } catch {
    return [];
  }
}

export interface LongShortData {
  symbol:              string;
  longShortRatio:      number;
  longAccount:         number;
  shortAccount:        number;
  timestamp:           number;
}

export async function getLongShortRatio(
  symbol: string,
  period = '1h',
  limit  = 4,
): Promise<LongShortData[]> {
  try {
    const { data } = await axios.get(`${FUTURES_DATA}/globalLongShortAccountRatio`, {
      params: { symbol, period, limit },
      timeout: 8000,
    });
    return (data as { symbol: string; longShortRatio: string; longAccount: string; shortAccount: string; timestamp: number }[]).map(d => ({
      symbol:         d.symbol,
      longShortRatio: parseFloat(d.longShortRatio),
      longAccount:    parseFloat(d.longAccount),
      shortAccount:   parseFloat(d.shortAccount),
      timestamp:      d.timestamp,
    }));
  } catch {
    return [];
  }
}
