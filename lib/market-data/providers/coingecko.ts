import axios from 'axios';
import { CoinData } from '@/types';
import { sleep } from '@/lib/utils';
import { withApiRetry } from '@/lib/retry';
import { MarketDataProvider, ProviderName } from '../types';
import { resolveBinanceSymbol } from '../binance-symbols';

const BASE_URL = 'https://api.coingecko.com/api/v3';

export class CoinGeckoProvider implements MarketDataProvider {
  readonly name: ProviderName = 'coingecko';
  readonly priority = 1;

  constructor(private readonly apiKey: string | undefined) {}

  async fetchTopCoins(limit: number): Promise<CoinData[]> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (this.apiKey) headers['x-cg-demo-api-key'] = this.apiKey;

    const perPage = Math.min(limit, 250);
    const pages = Math.ceil(limit / perPage);
    const requests = Array.from({ length: pages }, (_, i) => i + 1);

    const results = await Promise.all(
      requests.map((page, idx) =>
        (async () => {
          if (idx > 0) await sleep(400 * idx);
          return withApiRetry(
            () =>
              axios.get(`${BASE_URL}/coins/markets`, {
                headers,
                params: {
                  vs_currency: 'usd',
                  order: 'market_cap_desc',
                  per_page: perPage,
                  page,
                  sparkline: false,
                  price_change_percentage: '24h',
                },
                timeout: 15000,
              }),
            `coingecko-page${page}`,
          );
        })(),
      ),
    );

    const raw = results.flatMap(r => r.data as Record<string, unknown>[]);

    return raw.slice(0, limit).map((coin, i): CoinData => {
      const cgId = String(coin.id).toLowerCase();
      const symbol = String(coin.symbol).toUpperCase();
      return {
        id: cgId,
        symbol,
        name: String(coin.name),
        rank: (coin.market_cap_rank as number) || i + 1,
        price: (coin.current_price as number) || 0,
        marketCap: (coin.market_cap as number) || 0,
        volume24h: (coin.total_volume as number) || 0,
        priceChange24h: (coin.price_change_percentage_24h as number) || 0,
        binanceSymbol: resolveBinanceSymbol(cgId, symbol),
        hasFutures: false,
      };
    });
  }

  async healthCheck(): Promise<boolean> {
    try {
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (this.apiKey) headers['x-cg-demo-api-key'] = this.apiKey;
      const res = await axios.get(`${BASE_URL}/ping`, { headers, timeout: 5000 });
      return res.status === 200;
    } catch {
      return false;
    }
  }
}
