import { CoinData } from '@/types';

// ─── Cache group names ────────────────────────────────────────────────────────

export type CacheGroupName =
  | 'listings'    // top-100 market rankings  (5 min)
  | 'global'      // BTC dominance, total mcap (10 min)
  | 'trending'    // trending assets           (10 min)
  | 'categories'; // CMC ecosystem categories  (30 min)

// ─── Raw intelligence payloads ────────────────────────────────────────────────

export interface GlobalMetrics {
  btcDominance: number;
  ethDominance: number;
  totalMarketCapUsd: number;
  totalVolume24hUsd: number;
  marketCapChangePercent24h: number;
  activeCurrencies: number;
  updatedAt: string;
}

export interface TrendingCoin {
  id: number;
  symbol: string;
  name: string;
  rank: number;
  priceChange1h: number;
  priceChange24h: number;
  volume24h: number;
  marketCap: number;
}

export interface CategoryData {
  id: string;
  name: string;
  title: string;
  coinCount: number;
  avgPriceChange: number;
  volume24h: number;
  marketCap: number;
  marketCapChange: number;
  coins: string[];  // top symbol list
}

// ─── Intelligence snapshot (what each group stores in Redis) ─────────────────

export interface ListingsSnapshot {
  coins: CoinData[];
  breadthUp: number;          // % of top-100 with positive 24h change
  breadthDown: number;
  topMovers: { symbol: string; change: number }[];
  refreshedAt: string;
}

export interface GlobalSnapshot extends GlobalMetrics {
  refreshedAt: string;
}

export interface TrendingSnapshot {
  trending: TrendingCoin[];
  refreshedAt: string;
}

export interface CategoriesSnapshot {
  categories: CategoryData[];
  strongest: string;   // category name with highest avg change
  weakest: string;
  refreshedAt: string;
}

// ─── Cache group metadata (for telemetry) ────────────────────────────────────

export interface CacheGroupMeta {
  name: CacheGroupName;
  label: string;
  ttlMs: number;
  creditsPerCall: number;
  lastRefreshedAt: string | null;
  isStale: boolean;
  ageSeconds: number | null;
  hitCount: number;
  missCount: number;
  hitRate: number;
}

// ─── Quota guard state ────────────────────────────────────────────────────────

export type QuotaWarningLevel = 'normal' | 'caution' | 'warning' | 'critical' | 'emergency';

export interface QuotaGuardState {
  monthlyBudget: number;
  creditsUsed: number;
  creditsRemaining: number;
  pctUsed: number;
  resetAt: string;
  throttled: boolean;
  warningLevel: QuotaWarningLevel;
  requestsLastMinute: number;
  perMinuteLimit: number;
  projectedMonthlyUse: number;
  projectedExhaustionDate: string | null;
}

// ─── Worker status ────────────────────────────────────────────────────────────

export type WorkerState = 'idle' | 'running' | 'error' | 'stopped';

export interface WorkerStatus {
  name: string;
  intervalMs: number;
  lastTickAt: string | null;
  nextTickAt: string | null;
  lastError: string | null;
  errorCount: number;
  tickCount: number;
  state: WorkerState;
}

// ─── Full telemetry payload (for dashboard API) ───────────────────────────────

export interface IntelligenceTelemetry {
  groups: CacheGroupMeta[];
  quota: QuotaGuardState;
  workers: WorkerStatus[];
  overallHitRate: number;
  lastPreloadAt: string | null;
  lastPreloadDurationMs: number | null;
  cmcEnabled: boolean;
}
