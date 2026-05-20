import axios from 'axios';
import { CoinData } from '@/types';
import { withApiRetry } from '@/lib/retry';
import { MarketDataProvider, ProviderName } from '../types';
import { resolveBinanceSymbol } from '../binance-symbols';

const BASE_URL = 'https://api.dexscreener.com/latest/dex';

interface DexPair {
  baseToken: { address: string; name: string; symbol: string };
  quoteToken: { symbol: string };
  priceUsd: string;
  volume: { h24: number };
  priceChange: { h24: number };
  fdv: number | null;
  chainId: string;
  pairAddress: string;
}

export class DexScreenerProvider implements MarketDataProvider {
  readonly name: ProviderName = 'dexscreener';
  readonly priority = 4;

  async fetchTopCoins(limit: number): Promise<CoinData[]> {
    // Fetch top trending tokens across major chains
    const res = await withApiRetry(
      () =>
        axios.get(`${BASE_URL}/tokens/trending`, { timeout: 15000 }),
      'dexscreener-trending',
    );

    const pairs: DexPair[] = (res.data?.pairs ?? []).filter(
      (p: DexPair) => p.quoteToken?.symbol?.toUpperCase() === 'USDT' || p.quoteToken?.symbol?.toUpperCase() === 'USDC',
    );

    // Deduplicate by base token symbol, keep highest volume pair
    const seen = new Map<string, DexPair>();
    for (const pair of pairs) {
      const sym = pair.baseToken.symbol.toUpperCase();
      const existing = seen.get(sym);
      if (!existing || (pair.volume?.h24 ?? 0) > (existing.volume?.h24 ?? 0)) {
        seen.set(sym, pair);
      }
    }

    return Array.from(seen.values())
      .sort((a, b) => (b.volume?.h24 ?? 0) - (a.volume?.h24 ?? 0))
      .slice(0, limit)
      .map((pair, i): CoinData => {
        const symbol = pair.baseToken.symbol.toUpperCase();
        const cgId = symbol.toLowerCase();
        return {
          id: cgId,
          symbol,
          name: pair.baseToken.name,
          rank: i + 1,
          price: parseFloat(pair.priceUsd ?? '0') || 0,
          marketCap: pair.fdv ?? 0,
          volume24h: pair.volume?.h24 ?? 0,
          priceChange24h: pair.priceChange?.h24 ?? 0,
          binanceSymbol: resolveBinanceSymbol(cgId, symbol),
          hasFutures: false,
        };
      });
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await axios.get(`${BASE_URL}/tokens/trending`, { timeout: 5000 });
      return res.status === 200;
    } catch {
      return false;
    }
  }
}
