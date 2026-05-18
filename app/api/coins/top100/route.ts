import { NextResponse } from 'next/server';
import { getTop100ByMarketCap } from '@/lib/coingecko';
import { coinsCache } from '@/lib/cache';
import { createLogger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api/coins/top100');
const CACHE_KEY = 'top100';

export async function GET() {
  try {
    const coins = await coinsCache.getOrSet(CACHE_KEY, () => getTop100ByMarketCap()) as Awaited<ReturnType<typeof getTop100ByMarketCap>>;
    log.debug({ count: coins.length }, 'Coins fetched');
    return NextResponse.json({ success: true, coins, total: coins.length });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to fetch coins';
    log.error({ err: msg }, 'Coins fetch error');
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
