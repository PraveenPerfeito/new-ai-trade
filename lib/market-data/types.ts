import { CoinData } from '@/types';

export type ProviderName =
  | 'coingecko'
  | 'coinmarketcap'
  | 'binance'
  | 'dexscreener'
  | 'coinpaprika'
  | 'geckoterm';

export type ProviderStatus = 'healthy' | 'degraded' | 'offline' | 'quota_exhausted';

export interface QuotaInfo {
  dailyLimit: number;
  used: number;
  remaining: number;
  resetAt: string | null;
  pct: number;
}

export interface ProviderHealth {
  name: ProviderName;
  status: ProviderStatus;
  healthScore: number;        // 0-100, higher = healthier
  latencyMs: number;          // rolling p95
  errorRate: number;          // 0-1
  requestsToday: number;
  quota: QuotaInfo;
  lastSuccess: string | null; // ISO timestamp
  lastError: string | null;
  enabled: boolean;
  priority: number;           // 1 = highest, lower = checked first
}

export interface FailoverEvent {
  id: string;
  fromProvider: ProviderName;
  toProvider: ProviderName;
  reason: string;
  occurredAt: string;         // ISO timestamp
  durationMs: number | null;  // null if provider never recovered
  resolved: boolean;
}

export interface ProviderFetchResult {
  coins: CoinData[];
  provider: ProviderName;
  latencyMs: number;
  fromCache: boolean;
}

export interface MarketDataProvider {
  readonly name: ProviderName;
  readonly priority: number;

  /** Fetch top coins ranked by market cap, return at most `limit` entries. */
  fetchTopCoins(limit: number): Promise<CoinData[]>;

  /** Check provider reachability; resolve true if OK. */
  healthCheck(): Promise<boolean>;
}
