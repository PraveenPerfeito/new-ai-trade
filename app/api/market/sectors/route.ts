import { NextResponse } from 'next/server';
import { coinsCache } from '@/lib/cache';
import { computeSectorStats } from '@/lib/sectors';
import { readCategories } from '@/lib/intelligence/reader';
import type { CoinData } from '@/types';

export const runtime     = 'nodejs';
export const maxDuration = 10;
export const dynamic     = 'force-dynamic';

export async function GET() {
  try {
    const [coins, categoriesSnap] = await Promise.all([
      coinsCache.get('top100') as Promise<CoinData[] | null>,
      readCategories(),
    ]);

    const sectors = coins && coins.length > 0
      ? computeSectorStats(coins)
      : [];

    // Strongest/weakest from CMC categories (richer source) or fallback to coin-derived
    let strongest: string | null = null;
    let weakest:   string | null = null;

    if (categoriesSnap) {
      strongest = categoriesSnap.strongest || null;
      weakest   = categoriesSnap.weakest   || null;
    } else if (sectors.length > 0) {
      strongest = sectors[0]?.name ?? null;
      weakest   = sectors[sectors.length - 1]?.name ?? null;
    }

    return NextResponse.json({
      success:    true,
      sectors,
      categories: categoriesSnap?.categories ?? null,
      strongest,
      weakest,
      computedAt: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
