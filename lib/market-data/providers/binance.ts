import axios from 'axios';
import { CoinData } from '@/types';
import { withApiRetry } from '@/lib/retry';
import { MarketDataProvider, ProviderName } from '../types';

const SPOT_BASE  = 'https://api.binance.com';
const FUTURES_BASE = 'https://fapi.binance.com';

interface Ticker24h {
  symbol: string;
  lastPrice: string;
  quoteVolume: string;
  priceChangePercent: string;
}

export class BinanceProvider implements MarketDataProvider {
  readonly name: ProviderName = 'binance';
  readonly priority = 3;

  async fetchTopCoins(limit: number): Promise<CoinData[]> {
    const res = await withApiRetry(
      () =>
        axios.get(`${SPOT_BASE}/api/v3/ticker/24hr`, { timeout: 15000 }),
      'binance-ticker24h',
    );

    const tickers: Ticker24h[] = res.data;

    // Filter to USDT pairs with reasonable volume, sort by USDT volume desc
    const usdt = tickers
      .filter(t => t.symbol.endsWith('USDT') && !t.symbol.includes('UP') && !t.symbol.includes('DOWN'))
      .map(t => ({
        symbol: t.symbol.replace('USDT', ''),
        binanceSymbol: t.symbol,
        price: parseFloat(t.lastPrice),
        volume24h: parseFloat(t.quoteVolume),
        priceChange24h: parseFloat(t.priceChangePercent),
      }))
      .filter(t => t.volume24h > 1_000_000 && t.price > 0)
      .sort((a, b) => b.volume24h - a.volume24h)
      .slice(0, limit);

    return usdt.map((t, i): CoinData => ({
      id: t.symbol.toLowerCase(),
      symbol: t.symbol,
      name: t.symbol,
      rank: i + 1,
      price: t.price,
      marketCap: 0,           // Binance ticker doesn't include market cap
      volume24h: t.volume24h,
      priceChange24h: t.priceChange24h,
      binanceSymbol: t.binanceSymbol,
      hasFutures: false,
    }));
  }

  async healthCheck(): Promise<boolean> {
    try {
      const [spot, futures] = await Promise.allSettled([
        axios.get(`${SPOT_BASE}/api/v3/ping`, { timeout: 5000 }),
        axios.get(`${FUTURES_BASE}/fapi/v1/ping`, { timeout: 5000 }),
      ]);
      return spot.status === 'fulfilled' && spot.value.status === 200
        || futures.status === 'fulfilled' && futures.value.status === 200;
    } catch {
      return false;
    }
  }
}
