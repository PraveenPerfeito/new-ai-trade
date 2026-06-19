import { NextResponse } from 'next/server';
import { getMarketRegime } from '@/lib/market-regime';
import {
  readGlobal,
  readTrending,
  readListings,
} from '@/lib/intelligence/reader';

export const runtime   = 'nodejs';
export const dynamic   = 'force-dynamic';

// 300s in-process cache — regime tab polls every 120s; keeping cache > poll interval
// eliminates 3 Redis reads per poll (2,160 ops/day → ~432 ops/day).
let _cache: { data: unknown; ts: number } | null = null;
const _CACHE_TTL = 300_000;

/** GET /api/market/intelligence — aggregated market intelligence from caches */
export async function GET() {
  if (_cache && Date.now() - _cache.ts < _CACHE_TTL) {
    return NextResponse.json(_cache.data);
  }
  try {
    const [regime, global_, trending, listings] = await Promise.all([
      getMarketRegime(),
      readGlobal(),
      readTrending(),
      readListings(),
    ]);

    const payload = {
      success: true,
      regime: {
        regime:      regime.regime,
        btcRsi4h:    regime.btcRsi4h,
        btcTrend4h:  regime.btcTrend4h,
        btcAtrPct:   regime.btcAtrPct,
        btc24hChange: regime.btc24hChange,
        computedAt:  regime.computedAt instanceof Date
          ? regime.computedAt.toISOString()
          : regime.computedAt,
      },
      global:   global_,
      trending: trending,
      listings: listings
        ? {
            breadthUp:   listings.breadthUp,
            breadthDown: listings.breadthDown,
            topMovers:   listings.topMovers,
          }
        : null,
      computedAt: new Date().toISOString(),
    };
    _cache = { data: payload, ts: Date.now() };
    return NextResponse.json(payload);
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
