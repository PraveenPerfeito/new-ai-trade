import { NextResponse } from 'next/server';
import { coinsCache, signalsCache, oiCache, fundingCache, lsCache } from '@/lib/cache';
import { createLogger } from '@/lib/logger';

export const runtime     = 'nodejs';
export const maxDuration = 15;

const log = createLogger('api/cache/clear');

export async function POST() {
  log.info('cache clear requested');

  await Promise.allSettled([
    coinsCache.clear(),
    signalsCache.clear(),
    oiCache.clear(),
    fundingCache.clear(),
    lsCache.clear(),
  ]);

  log.info('all caches cleared');

  return NextResponse.json({
    success: true,
    cleared: ['coins', 'signals', 'open-interest', 'funding-rate', 'long-short'],
    clearedAt: new Date().toISOString(),
  });
}
