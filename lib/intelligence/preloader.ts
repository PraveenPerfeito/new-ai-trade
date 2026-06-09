import { getRedis } from '@/lib/redis';
import { createLogger } from '@/lib/logger';
import { getQuotaGuard } from './quota-guard';
import { CACHE_GROUPS } from './cache-groups';
import {
  fetchListings,
  fetchGlobalMetrics,
  fetchTrending,
  fetchCategories,
} from './cmc-client';
import {
  normalizeListings,
  normalizeGlobal,
  normalizeTrending,
  normalizeCategories,
} from './normalizer';

const log = createLogger('lib/intelligence/preloader');

export interface PreloadResult {
  groupsRefreshed: string[];
  groupsSkipped:   string[];
  durationMs:      number;
  error?:          string;
}

/**
 * Warms all stale cache groups that have quota available.
 * Called once before a scan batch and by the background workers.
 */
export async function preloadIntelligence(): Promise<PreloadResult> {
  const start    = Date.now();
  const refreshed: string[] = [];
  const skipped:   string[] = [];

  try {
    const redis = getRedis();
    const quota = getQuotaGuard();

    // ── listings ──────────────────────────────────────────────────────────────
    if (await isStale('listings', redis) && await quota.canConsume(1)) {
      try {
        const raw  = await fetchListings(100);
        const snap = normalizeListings(raw);
        await redis.set(
          CACHE_GROUPS.listings.redisKey,
          JSON.stringify(snap),
          'PX',
          CACHE_GROUPS.listings.ttlMs * 2, // keep twice TTL so reads never 404
        );
        await quota.consume(1);
        refreshed.push('listings');
        log.info({ count: snap.coins.length }, 'intel_preload_listings');
      } catch (err) {
        log.warn({ err }, 'intel_preload_listings_failed');
        skipped.push('listings');
      }
    } else {
      skipped.push('listings');
    }

    // ── global ────────────────────────────────────────────────────────────────
    if (await isStale('global', redis) && await quota.canConsume(1)) {
      try {
        const raw  = await fetchGlobalMetrics();
        const snap = normalizeGlobal(raw);
        await redis.set(
          CACHE_GROUPS.global.redisKey,
          JSON.stringify(snap),
          'PX',
          CACHE_GROUPS.global.ttlMs * 2,
        );
        await quota.consume(1);
        refreshed.push('global');
        log.info('intel_preload_global');
      } catch (err) {
        log.warn({ err }, 'intel_preload_global_failed');
        skipped.push('global');
      }
    } else {
      skipped.push('global');
    }

    // ── trending ──────────────────────────────────────────────────────────────
    if (await isStale('trending', redis) && await quota.canConsume(1)) {
      try {
        const raw  = await fetchTrending(20);
        const snap = normalizeTrending(raw);
        await redis.set(
          CACHE_GROUPS.trending.redisKey,
          JSON.stringify(snap),
          'PX',
          CACHE_GROUPS.trending.ttlMs * 2,
        );
        await quota.consume(1);
        refreshed.push('trending');
        log.info({ count: snap.trending.length }, 'intel_preload_trending');
      } catch (err) {
        log.warn({ err }, 'intel_preload_trending_failed');
        skipped.push('trending');
      }
    } else {
      skipped.push('trending');
    }

    // ── categories ────────────────────────────────────────────────────────────
    if (await isStale('categories', redis) && await quota.canConsume(1)) {
      try {
        const raw  = await fetchCategories();
        const snap = normalizeCategories(raw);
        await redis.set(
          CACHE_GROUPS.categories.redisKey,
          JSON.stringify(snap),
          'PX',
          CACHE_GROUPS.categories.ttlMs * 2,
        );
        await quota.consume(1);
        refreshed.push('categories');
        log.info({ count: snap.categories.length }, 'intel_preload_categories');
      } catch (err) {
        log.warn({ err }, 'intel_preload_categories_failed');
        skipped.push('categories');
      }
    } else {
      skipped.push('categories');
    }

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err }, 'intel_preload_fatal');
    return { groupsRefreshed: refreshed, groupsSkipped: skipped, durationMs: Date.now() - start, error: msg };
  }

  const durationMs = Date.now() - start;
  log.info({ refreshed, skipped, durationMs }, 'intel_preload_complete');
  return { groupsRefreshed: refreshed, groupsSkipped: skipped, durationMs };
}

// ─── Staleness check ──────────────────────────────────────────────────────────

async function isStale(
  group: keyof typeof CACHE_GROUPS,
  redis: ReturnType<typeof getRedis>,
): Promise<boolean> {
  try {
    const raw = await redis.get(CACHE_GROUPS[group].redisKey);
    if (!raw) return true;
    const parsed = JSON.parse(raw) as { refreshedAt?: string };
    if (!parsed.refreshedAt) return true;
    const age = Date.now() - new Date(parsed.refreshedAt).getTime();
    return age >= CACHE_GROUPS[group].ttlMs;
  } catch {
    return true;
  }
}
