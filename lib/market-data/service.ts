import { CoinData } from '@/types';
import { Cache } from '@/lib/cache';
import { createLogger } from '@/lib/logger';
import { ProviderManager } from './manager';
import { FailoverEvent, ProviderHealth, ProviderName } from './types';
import { CoinGeckoProvider }    from './providers/coingecko';
import { CoinMarketCapProvider } from './providers/coinmarketcap';
import { BinanceProvider }      from './providers/binance';
import { DexScreenerProvider }  from './providers/dexscreener';
import { CoinPaprikaProvider }  from './providers/coinpaprika';
import { GeckoTermProvider }    from './providers/geckoterm';

const log = createLogger('lib/market-data/service');

// Provider-aware cache: TTL matches the scanner's coin-list usage (5 min)
const coinsCache = new Cache<CoinData[]>('market-data', 5 * 60_000, 5);

function buildManager(): ProviderManager {
  const providers = [
    new CoinMarketCapProvider(process.env.COINMARKETCAP_API_KEY ?? ''),
    new CoinGeckoProvider(process.env.COINGECKO_API_KEY),
    new BinanceProvider(),
    new DexScreenerProvider(),
    new CoinPaprikaProvider(),
    new GeckoTermProvider(),
  ];
  return new ProviderManager(providers);
}

class MarketDataService {
  private readonly manager: ProviderManager;

  constructor() {
    this.manager = buildManager();
  }

  /**
   * Fetch the top `limit` coins.  Result is cached per provider-ordered key.
   * The scanner always calls this — never providers directly.
   */
  async getTopCoins(limit = 100): Promise<CoinData[]> {
    return coinsCache.getOrSet(`top-${limit}`, async () => {
      const result = await this.manager.fetchTopCoins(limit);
      log.info(
        { provider: result.provider, coins: result.coins.length },
        'market_data_fetched',
      );
      return result.coins;
    });
  }

  /** Returns live health for all providers (not cached). */
  getProviderHealth(): Promise<ProviderHealth[]> {
    return this.manager.getAllHealth();
  }

  getFailoverHistory(): Promise<FailoverEvent[]> {
    return this.manager.getFailoverHistory();
  }

  forceFailover(from: ProviderName): Promise<ProviderName | null> {
    return this.manager.forceFailover(from);
  }

  setEnabled(name: ProviderName, enabled: boolean): void {
    this.manager.setEnabled(name, enabled);
  }

  setPriority(name: ProviderName, priority: number): void {
    this.manager.setPriority(name, priority);
  }

  async resetMetrics(name: ProviderName): Promise<void> {
    return this.manager.resetMetrics(name);
  }

  async clearCache(): Promise<void> {
    await coinsCache.clear();
  }
}

// ─── Singleton (survives Next.js HMR via globalThis) ─────────────────────────

declare global {
  // eslint-disable-next-line no-var
  var __marketDataService: MarketDataService | undefined;
}

export function getMarketDataService(): MarketDataService {
  if (!globalThis.__marketDataService) {
    globalThis.__marketDataService = new MarketDataService();
  }
  return globalThis.__marketDataService;
}
