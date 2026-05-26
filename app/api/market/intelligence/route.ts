import { NextResponse } from 'next/server';
import { getMarketRegime } from '@/lib/market-regime';
import {
  readGlobal,
  readTrending,
  readListings,
} from '@/lib/intelligence/reader';

export const runtime   = 'nodejs';
export const dynamic   = 'force-dynamic';

/** GET /api/market/intelligence — aggregated market intelligence from caches */
export async function GET() {
  try {
    const [regime, global_, trending, listings] = await Promise.all([
      getMarketRegime(),
      readGlobal(),
      readTrending(),
      readListings(),
    ]);

    return NextResponse.json({
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
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
