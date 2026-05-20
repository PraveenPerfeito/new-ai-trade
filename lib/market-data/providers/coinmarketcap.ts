import axios from 'axios';
import { CoinData } from '@/types';
import { withApiRetry } from '@/lib/retry';
import { MarketDataProvider, ProviderName } from '../types';
import { resolveBinanceSymbol } from '../binance-symbols';

const BASE_URL = 'https://pro-api.coinmarketcap.com/v1';

export class CoinMarketCapProvider implements MarketDataProvider {
  readonly name: ProviderName = 'coinmarketcap';
  readonly priority = 2;

  constructor(private readonly apiKey: string) {}

  async fetchTopCoins(limit: number): Promise<CoinData[]> {
    const res = await withApiRetry(
      () =>
        axios.get(`${BASE_URL}/cryptocurrency/listings/latest`, {
          headers: {
            'X-CMC_PRO_API_KEY': this.apiKey,
            Accept: 'application/json',
          },
          params: {
            start: 1,
            limit: Math.min(limit, 200),
            sort: 'market_cap',
            sort_dir: 'desc',
            convert: 'USD',
          },
          timeout: 15000,
        }),
      'coinmarketcap-listings',
    );

    const coins: Record<string, unknown>[] = res.data?.data ?? [];

    return coins.slice(0, limit).map((coin, i): CoinData => {
      const cmcId = String(coin.slug ?? coin.id).toLowerCase();
      const symbol = String(coin.symbol).toUpperCase();
      const quote = (coin.quote as Record<string, Record<string, unknown>>)?.USD ?? {};

      return {
        id: cmcId,
        symbol,
        name: String(coin.name),
        rank: (coin.cmc_rank as number) || i + 1,
        price: (quote.price as number) || 0,
        marketCap: (quote.market_cap as number) || 0,
        volume24h: (quote.volume_24h as number) || 0,
        priceChange24h: (quote.percent_change_24h as number) || 0,
        binanceSymbol: resolveBinanceSymbol(cmcId, symbol),
        hasFutures: false,
      };
    });
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await axios.get(`${BASE_URL}/key/info`, {
        headers: { 'X-CMC_PRO_API_KEY': this.apiKey, Accept: 'application/json' },
        timeout: 5000,
      });
      return res.status === 200;
    } catch {
      return false;
    }
  }
}
