import { CoinData } from '@/types';
import { getRedis } from '@/lib/redis';
import { createLogger } from '@/lib/logger';
import { getMarketDataService } from '@/lib/market-data/service';
import { CACHE_GROUPS, groupHitsKey, groupMissesKey } from './cache-groups';
import {
  ListingsSnapshot,
  GlobalSnapshot,
  TrendingSnapshot,
  CategoriesSnapshot,
  MetadataSnapshot,
} from './types';

const log = createLogger('lib/intelligence/reader');

// ─── Generic cache read ───────────────────────────────────────────────────────

async function readGroup<T>(
  groupName: keyof typeof CACHE_GROUPS,
): Promise<T | null> {
  const cfg = CACHE_GROUPS[groupName];
  try {
    const redis = getRedis();
    const raw   = await redis.get(cfg.redisKey);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as T;
  } catch (err) {
    log.warn({ err, group: groupName }, 'intel_read_error');
    return null;
  }
}

// ─── Public readers ───────────────────────────────────────────────────────────

export async function readListings(): Promise<ListingsSnapshot | null> {
  return readGroup<ListingsSnapshot>('listings');
}

export async function readGlobal(): Promise<GlobalSnapshot | null> {
  return readGroup<GlobalSnapshot>('global');
}

export async function readTrending(): Promise<TrendingSnapshot | null> {
  return readGroup<TrendingSnapshot>('trending');
}

export async function readCategories(): Promise<CategoriesSnapshot | null> {
  return readGroup<CategoriesSnapshot>('categories');
}

export async function readMetadata(): Promise<MetadataSnapshot | null> {
  return readGroup<MetadataSnapshot>('metadata');
}

// ─── Primary entry-point used by the scanner ──────────────────────────────────

/**
 * Returns top N coins from the intelligence cache.
 * Falls back to MarketDataService (CoinGecko) when cache is cold.
 */
export async function getIntelligenceCoins(limit = 100): Promise<CoinData[]> {
  const snapshot = await readListings();

  if (snapshot && snapshot.coins.length > 0) {
    log.debug({ count: Math.min(limit, snapshot.coins.length) }, 'intel_coins_cache_hit');
    return snapshot.coins.slice(0, limit);
  }

  // Cache cold — fall back to MarketDataService (CoinGecko)
  log.warn('intel_coins_cache_miss — falling back to MarketDataService');
  try {
    return await getMarketDataService().getTopCoins(limit);
  } catch (err) {
    log.error({ err }, 'intel_coins_fallback_failed');
    return [];
  }
}

// ─── Staleness helper ─────────────────────────────────────────────────────────

export function isStale(refreshedAt: string, ttlMs: number): boolean {
  return Date.now() - new Date(refreshedAt).getTime() > ttlMs;
}
