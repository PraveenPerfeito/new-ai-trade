import { getRedis } from '@/lib/redis';
import { getEnv } from '@/lib/env';
import { CACHE_GROUPS, groupHitsKey, groupMissesKey } from './cache-groups';
import { getQuotaGuard } from './quota-guard';
import { getWorkerStatuses } from './workers';
import { IntelligenceTelemetry, CacheGroupMeta } from './types';

export async function getIntelligenceTelemetry(): Promise<IntelligenceTelemetry> {
  const redis = getRedis();
  const quota = await getQuotaGuard().getState();

  const groupMetas: CacheGroupMeta[] = await Promise.all(
    (Object.keys(CACHE_GROUPS) as Array<keyof typeof CACHE_GROUPS>).map(async (name) => {
      const cfg = CACHE_GROUPS[name];
      const [raw, hitsRaw, missesRaw] = await Promise.all([
        redis.get(cfg.redisKey),
        redis.get(groupHitsKey(name)),
        redis.get(groupMissesKey(name)),
      ]);

      const hits   = parseInt(hitsRaw  ?? '0', 10) || 0;
      const misses = parseInt(missesRaw ?? '0', 10) || 0;
      const total  = hits + misses;

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
        hitCount:        hits,
        missCount:       misses,
        hitRate:         total > 0 ? Math.round((hits / total) * 1000) / 10 : 0,
      } satisfies CacheGroupMeta;
    }),
  );

  const totalHits   = groupMetas.reduce((s, g) => s + g.hitCount,  0);
  const totalMisses = groupMetas.reduce((s, g) => s + g.missCount, 0);
  const totalReqs   = totalHits + totalMisses;

  // Find the most recent preload timestamp from listings group (best proxy)
  const listingsMeta = groupMetas.find((g) => g.name === 'listings');

  return {
    groups:                groupMetas,
    quota,
    workers:               getWorkerStatuses(),
    overallHitRate:        totalReqs > 0 ? Math.round((totalHits / totalReqs) * 1000) / 10 : 0,
    lastPreloadAt:         listingsMeta?.lastRefreshedAt ?? null,
    lastPreloadDurationMs: null, // populated by preloadIntelligence callers if needed
    cmcEnabled:            Boolean(getEnv().COINMARKETCAP_API_KEY),
  };
}
