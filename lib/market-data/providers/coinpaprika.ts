import axios from 'axios';
import { CoinData } from '@/types';
import { withApiRetry } from '@/lib/retry';
import { MarketDataProvider, ProviderName } from '../types';
import { resolveBinanceSymbol } from '../binance-symbols';

const BASE_URL = 'https://api.coinpaprika.com/v1';

interface PaprikaTicker {
  id: string;
  name: string;
  symbol: string;
  rank: number;
  quotes: {
    USD: {
      price: number;
      market_cap: number;
      volume_24h: number;
      percent_change_24h: number;
    };
  };
}

export class CoinPaprikaProvider implements MarketDataProvider {
  readonly name: ProviderName = 'coinpaprika';
  readonly priority = 5;

  async fetchTopCoins(limit: number): Promise<CoinData[]> {
    const res = await withApiRetry(
      () =>
        axios.get(`${BASE_URL}/tickers`, {
          params: { quotes: 'USD', limit: Math.min(limit, 250) },
          timeout: 15000,
        }),
      'coinpaprika-tickers',
    );

    const tickers: PaprikaTicker[] = res.data ?? [];

    return tickers.slice(0, limit).map((t): CoinData => {
      const cgId = t.id.toLowerCase();
      const symbol = t.symbol.toUpperCase();
      const usd = t.quotes?.USD ?? { price: 0, market_cap: 0, volume_24h: 0, percent_change_24h: 0 };

      return {
        id: cgId,
        symbol,
        name: t.name,
        rank: t.rank || 0,
        price: usd.price,
        marketCap: usd.market_cap,
        volume24h: usd.volume_24h,
        priceChange24h: usd.percent_change_24h,
        binanceSymbol: resolveBinanceSymbol(cgId, symbol),
        hasFutures: false,
      };
    });
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await axios.get(`${BASE_URL}/global`, { timeout: 5000 });
      return res.status === 200;
    } catch {
      return false;
    }
  }
}
