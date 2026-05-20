import axios from 'axios';
import { CoinData } from '@/types';
import { withApiRetry } from '@/lib/retry';
import { MarketDataProvider, ProviderName } from '../types';
import { resolveBinanceSymbol } from '../binance-symbols';

// GeckoTerminal — free DeFi-focused provider (no API key needed)
const BASE_URL = 'https://api.geckoterminal.com/api/v2';

interface GTPool {
  id: string;
  attributes: {
    name: string;
    base_token_price_usd: string;
    market_cap_usd: string | null;
    volume_usd: { h24: string };
    price_change_percentage: { h24: string };
  };
  relationships: {
    base_token: { data: { id: string } };
  };
}

export class GeckoTermProvider implements MarketDataProvider {
  readonly name: ProviderName = 'geckoterm';
  readonly priority = 6;

  async fetchTopCoins(limit: number): Promise<CoinData[]> {
    // Top pools by volume on Ethereum + BNB Chain + Solana
    const networks = ['eth', 'bsc', 'solana'];
    const perNetwork = Math.ceil(limit / networks.length);

    const results = await Promise.allSettled(
      networks.map(network =>
        withApiRetry(
          () =>
            axios.get(`${BASE_URL}/networks/${network}/pools`, {
              params: { page: 1, include: 'base_token' },
              timeout: 10000,
            }),
          `geckoterm-${network}`,
        ),
      ),
    );

    const pools: GTPool[] = results
      .flatMap(r => (r.status === 'fulfilled' ? (r.value.data?.data as GTPool[] ?? []) : []))
      .slice(0, limit * 3); // over-fetch to account for dedupe

    // Deduplicate by token symbol, keep highest volume pool
    const seen = new Map<string, GTPool>();
    for (const pool of pools) {
      const parts = pool.attributes.name.split('/');
      const sym = (parts[0] ?? '').trim().toUpperCase();
      if (!sym) continue;
      const vol = parseFloat(pool.attributes.volume_usd?.h24 ?? '0');
      const existing = seen.get(sym);
      const existingVol = parseFloat(existing?.attributes.volume_usd?.h24 ?? '0');
      if (!existing || vol > existingVol) seen.set(sym, pool);
    }

    return Array.from(seen.values())
      .sort((a, b) => {
        const va = parseFloat(a.attributes.volume_usd?.h24 ?? '0');
        const vb = parseFloat(b.attributes.volume_usd?.h24 ?? '0');
        return vb - va;
      })
      .slice(0, limit)
      .map((pool, i): CoinData => {
        const parts = pool.attributes.name.split('/');
        const symbol = (parts[0] ?? '').trim().toUpperCase();
        const cgId = symbol.toLowerCase();
        return {
          id: cgId,
          symbol,
          name: symbol,
          rank: i + 1,
          price: parseFloat(pool.attributes.base_token_price_usd ?? '0') || 0,
          marketCap: parseFloat(pool.attributes.market_cap_usd ?? '0') || 0,
          volume24h: parseFloat(pool.attributes.volume_usd?.h24 ?? '0') || 0,
          priceChange24h: parseFloat(pool.attributes.price_change_percentage?.h24 ?? '0') || 0,
          binanceSymbol: resolveBinanceSymbol(cgId, symbol),
          hasFutures: false,
        };
      });
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await axios.get(`${BASE_URL}/networks`, { timeout: 5000 });
      return res.status === 200;
    } catch {
      return false;
    }
  }
}
