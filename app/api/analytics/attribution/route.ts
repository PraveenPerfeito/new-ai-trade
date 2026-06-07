import { NextResponse } from 'next/server';
import { getAttributionRows } from '@/lib/supabase';
import { computeAttribution } from '@/lib/outcome-attribution';

export const runtime = 'nodejs';

const _cache = new Map<number, { report: unknown; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const hours = Math.min(8760, Math.max(1, Number(searchParams.get('hours') ?? 720)));

  const cached = _cache.get(hours);
  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json({ success: true, report: cached.report });
  }

  try {
    const rows   = await getAttributionRows(hours);
    const report = computeAttribution(rows, hours);
    _cache.set(hours, { report, expiresAt: Date.now() + CACHE_TTL_MS });
    return NextResponse.json({ success: true, report });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
