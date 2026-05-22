import { NextResponse } from 'next/server';
import { getAttributionRows } from '@/lib/supabase';
import { computeAttribution } from '@/lib/outcome-attribution';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const hours = Math.min(8760, Math.max(1, Number(searchParams.get('hours') ?? 720)));

  try {
    const rows   = await getAttributionRows(hours);
    const report = computeAttribution(rows, hours);
    return NextResponse.json({ success: true, report });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
