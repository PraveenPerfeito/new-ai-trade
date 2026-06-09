import { NextRequest, NextResponse } from 'next/server';
import { getRedis } from '@/lib/redis';
import { getQuotaGuard } from '@/lib/intelligence/quota-guard';
import { CACHE_GROUPS } from '@/lib/intelligence/cache-groups';
import {
  fetchListings,
  fetchGlobalMetrics,
  fetchTrending,
  fetchCategories,
} from '@/lib/intelligence/cmc-client';
import {
  normalizeListings,
  normalizeGlobal,
  normalizeTrending,
  normalizeCategories,
} from '@/lib/intelligence/normalizer';
import { getIntelligenceTelemetry } from '@/lib/intelligence/telemetry';
import { CacheGroupName } from '@/lib/intelligence/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_GROUPS = new Set<CacheGroupName>([
  'listings', 'global', 'trending', 'categories',
]);

/** POST /api/cache/intelligence/[group] — force-refresh a single cache group */
export async function POST(
  _req: NextRequest,
  { params }: { params: { group: string } },
) {
  const group = params.group as CacheGroupName;

  if (!VALID_GROUPS.has(group)) {
    return NextResponse.json(
      { success: false, error: `Unknown group: ${group}. Valid: ${Array.from(VALID_GROUPS).join(', ')}` },
      { status: 400 },
    );
  }

  const quota = getQuotaGuard();
  const can   = await quota.canConsume(1);
  if (!can) {
    return NextResponse.json(
      { success: false, error: 'Quota guard blocked refresh — rate limit or monthly budget exceeded' },
      { status: 429 },
    );
  }

  try {
    const redis = getRedis();
    const cfg   = CACHE_GROUPS[group];
    let snap: unknown;

    switch (group) {
      case 'listings': {
        const raw = await fetchListings(100);
        snap = normalizeListings(raw);
        break;
      }
      case 'global': {
        const raw = await fetchGlobalMetrics();
        snap = normalizeGlobal(raw);
        break;
      }
      case 'trending': {
        const raw = await fetchTrending(20);
        snap = normalizeTrending(raw);
        break;
      }
      case 'categories': {
        const raw = await fetchCategories();
        snap = normalizeCategories(raw);
        break;
      }
    }

    await redis.set(cfg.redisKey, JSON.stringify(snap), 'PX', cfg.ttlMs * 2);
    await quota.consume(1);

    const telemetry = await getIntelligenceTelemetry();
    return NextResponse.json({ success: true, group, telemetry });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
