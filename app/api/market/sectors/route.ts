import { NextResponse } from 'next/server';
import { coinsCache } from '@/lib/cache';
import { computeSectorStats } from '@/lib/sectors';
import type { CoinData } from '@/types';

export const runtime    = 'nodejs';
export const maxDuration = 10;

export async function GET() {
  try {
    const coins = await coinsCache.get('top100') as CoinData[] | null;

    if (!coins || coins.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No coin data cached — run a scan first' },
        { status: 503 },
      );
    }

    const sectors    = computeSectorStats(coins);
    const computedAt = new Date();

    return NextResponse.json({ success: true, sectors, computedAt });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
