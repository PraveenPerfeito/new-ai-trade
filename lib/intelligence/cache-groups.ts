import { CacheGroupName } from './types';

export interface CacheGroupConfig {
  name: CacheGroupName;
  label: string;
  redisKey: string;
  ttlMs: number;
  creditsPerCall: number;
  description: string;
}

// ─── 5 Intelligence Cache Groups ─────────────────────────────────────────────
//
// Refresh cadences are chosen to stay well within 300k monthly credits:
//   listings  every  5 min → 288 calls/day  = 288 credits/day
//   global    every 10 min → 144 calls/day  = 144 credits/day
//   trending  every 10 min → 144 calls/day  = 144 credits/day
//   categories every 30 min →  48 calls/day  =  48 credits/day
//   metadata  every  6 hr  →   4 calls/day  =   4 credits/day
//                                              ───────────────
//                              Total          = 628 credits/day
//                              Monthly est.   = 18,840 credits   (6.3% of 300k)

export const CACHE_GROUPS: Record<CacheGroupName, CacheGroupConfig> = {
  listings: {
    name:          'listings',
    label:         'Market Snapshot',
    redisKey:      'cache:intel:listings',
    ttlMs:         5 * 60_000,    // 5 min
    creditsPerCall: 1,
    description:   'Top-100 rankings, prices, volumes, breadth (CMC /listings/latest)',
  },
  global: {
    name:          'global',
    label:         'Global Metrics',
    redisKey:      'cache:intel:global',
    ttlMs:         10 * 60_000,   // 10 min
    creditsPerCall: 1,
    description:   'BTC dominance, total market cap, 24h volume (CMC /global-metrics)',
  },
  trending: {
    name:          'trending',
    label:         'Trending Engine',
    redisKey:      'cache:intel:trending',
    ttlMs:         10 * 60_000,   // 10 min
    creditsPerCall: 1,
    description:   'Trending assets and narrative momentum (CMC /trending/latest)',
  },
  categories: {
    name:          'categories',
    label:         'Sector Intelligence',
    redisKey:      'cache:intel:categories',
    ttlMs:         30 * 60_000,   // 30 min
    creditsPerCall: 1,
    description:   'Ecosystem categories, sector performance, narrative rotation (CMC /categories)',
  },
  metadata: {
    name:          'metadata',
    label:         'Metadata Engine',
    redisKey:      'cache:intel:metadata',
    ttlMs:         6 * 60 * 60_000, // 6 hr
    creditsPerCall: 1,
    description:   'Coin tags, ecosystem labels, descriptions — aggressively cached (CMC /info)',
  },
};

// Redis key for hit/miss telemetry per group
export function groupHitsKey(name: CacheGroupName): string {
  return `cache:intel:hits:${name}`;
}
export function groupMissesKey(name: CacheGroupName): string {
  return `cache:intel:misses:${name}`;
}
