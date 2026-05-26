import axios from 'axios';
import { CoinData } from '@/types';
import { MarketDataProvider, ProviderName } from '../types';
import { readListings } from '@/lib/intelligence/reader';
import { getQuotaGuard } from '@/lib/intelligence/quota-guard';

const BASE_URL = 'https://pro-api.coinmarketcap.com/v1';

/**
 * CMC provider that serves coins from the intelligence cache.
 * Direct API calls are owned exclusively by lib/intelligence — this provider
 * never calls CMC itself to avoid double credit spending.
 * Kept enabled: false in ProviderManager so the intelligence layer is the
 * sole CMC consumer; CoinGecko remains the MarketDataService fallback.
 */
export class CoinMarketCapProvider implements MarketDataProvider {
  readonly name: ProviderName = 'coinmarketcap';
  readonly priority = 2;

  constructor(private readonly apiKey: string) {}

  async fetchTopCoins(limit: number): Promise<CoinData[]> {
    const snapshot = await readListings();
    if (!snapshot || snapshot.coins.length === 0) {
      throw new Error('CMC intelligence cache is cold — no coins available');
    }
    return snapshot.coins.slice(0, limit);
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await axios.get(`${BASE_URL}/key/info`, {
        headers: { 'X-CMC_PRO_API_KEY': this.apiKey, Accept: 'application/json' },
        timeout: 5000,
      });
      // Seed quota guard with authoritative credit usage from CMC
      const plan = res.data?.data?.usage?.current_month;
      if (plan?.credits_used != null) {
        await getQuotaGuard().seedFromKeyInfo(plan.credits_used).catch(() => {});
      }
      return res.status === 200;
    } catch {
      return false;
    }
  }
}
