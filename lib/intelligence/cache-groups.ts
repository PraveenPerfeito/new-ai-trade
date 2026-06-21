import { CacheGroupName } from './types';

export interface CacheGroupConfig {
  name: CacheGroupName;
  label: string;
  redisKey: string;
  ttlMs: number;
  creditsPerCall: number;
  description: string;
}

// ─── 4 Intelligence Cache Groups ─────────────────────────────────────────────
//
// REDIS.REDUCE.3: cadences halved to cut Redis worker ops by ~62%
//   listings  every 15 min →  96 calls/day  =  96 credits/day  (was 5 min / 288)
//   global    every 30 min →  48 calls/day  =  48 credits/day  (was 10 min / 144)
//   trending  every 30 min →  48 calls/day  =  48 credits/day  (was 10 min / 144)
//   categories every 60 min →  24 calls/day  =  24 credits/day  (was 30 min / 48)
//                                              ───────────────
//                              Total          = 216 credits/day
//                              Monthly est.   =  6,480 credits   (2.2% of 300k)
//
// Price data is still fresh enough: listings 15 min is fine for a signal scanner
// that runs every 15 min; category rotation moves on hours-long timescales.

export const CACHE_GROUPS: Record<CacheGroupName, CacheGroupConfig> = {
  listings: {
    name:          'listings',
    label:         'Market Snapshot',
    redisKey:      'cache:intel:listings',
    ttlMs:         15 * 60_000,   // REDIS.REDUCE.3: 15 min (was 5 min)
    creditsPerCall: 1,
    description:   'Top-100 rankings, prices, volumes, breadth (CMC /listings/latest)',
  },
  global: {
    name:          'global',
    label:         'Global Metrics',
    redisKey:      'cache:intel:global',
    ttlMs:         30 * 60_000,   // REDIS.REDUCE.3: 30 min (was 10 min)
    creditsPerCall: 1,
    description:   'BTC dominance, total market cap, 24h volume (CMC /global-metrics)',
  },
  trending: {
    name:          'trending',
    label:         'Trending Engine',
    redisKey:      'cache:intel:trending',
    ttlMs:         30 * 60_000,   // REDIS.REDUCE.3: 30 min (was 10 min)
    creditsPerCall: 1,
    description:   'Trending assets and narrative momentum (CMC /trending/latest)',
  },
  categories: {
    name:          'categories',
    label:         'Sector Intelligence',
    redisKey:      'cache:intel:categories',
    ttlMs:         60 * 60_000,   // REDIS.REDUCE.3: 60 min (was 30 min)
    creditsPerCall: 1,
    description:   'Ecosystem categories, sector performance, narrative rotation (CMC /categories)',
  },
};

