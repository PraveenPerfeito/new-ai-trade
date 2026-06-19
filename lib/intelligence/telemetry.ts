import { getRedis } from '@/lib/redis';
import { getEnv } from '@/lib/env';
import { CACHE_GROUPS } from './cache-groups';
import { getQuotaGuard } from './quota-guard';
import { getWorkerStatuses } from './workers';
import { IntelligenceTelemetry, CacheGroupMeta } from './types';

let _telCache: { data: IntelligenceTelemetry; ts: number } | null = null
const _TEL_TTL = 180_000  // 180s > 120s poll interval — cache always warm, zero Redis reads per poll cycle

export async function getIntelligenceTelemetry(): Promise<IntelligenceTelemetry> {
  if (_telCache && Date.now() - _telCache.ts < _TEL_TTL) return _telCache.data
  const redis = getRedis();
  const quota = await getQuotaGuard().getState();

  // R8 OPS.CONSOLIDATION.1: hit/miss counters removed — Python stopped writing
  // cache:intel:hits:* and cache:intel:misses:* keys. Reading dead keys wastes
  // ~21K Redis GET ops/month and always returns 0. Age-based freshness
  // (ageSeconds + isStale) is the correct freshness signal for this cache.
  const groupMetas: CacheGroupMeta[] = await Promise.all(
    (Object.keys(CACHE_GROUPS) as Array<keyof typeof CACHE_GROUPS>).map(async (name) => {
      const cfg = CACHE_GROUPS[name];
      const raw = await redis.get(cfg.redisKey);

      let lastRefreshedAt: string | null = null;
      let ageSeconds: number | null      = null;
      let isStale                        = true;

      if (raw) {
        try {
          const parsed = JSON.parse(raw) as { refreshedAt?: string };
          if (parsed.refreshedAt) {
            lastRefreshedAt = parsed.refreshedAt;
            ageSeconds      = Math.floor((Date.now() - new Date(parsed.refreshedAt).getTime()) / 1000);
            isStale         = ageSeconds * 1000 >= cfg.ttlMs;
          }
        } catch {
          /* malformed cache entry */
        }
      }

      return {
        name,
        label:           cfg.label,
        ttlMs:           cfg.ttlMs,
        creditsPerCall:  cfg.creditsPerCall,
        lastRefreshedAt,
        isStale,
        ageSeconds,
        hitCount:        0,
        missCount:       0,
        hitRate:         0,
      } satisfies CacheGroupMeta;
    }),
  );

  // Find the most recent preload timestamp from listings group (best proxy)
  const listingsMeta = groupMetas.find((g) => g.name === 'listings');

  const result: IntelligenceTelemetry = {
    groups:                groupMetas,
    quota,
    workers:               getWorkerStatuses(),
    overallHitRate:        0,
    lastPreloadAt:         listingsMeta?.lastRefreshedAt ?? null,
    lastPreloadDurationMs: null,
    cmcEnabled:            Boolean(getEnv().COINMARKETCAP_API_KEY),
  };
  _telCache = { data: result, ts: Date.now() }
  return result;
}
