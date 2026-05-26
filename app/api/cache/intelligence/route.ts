import { NextRequest, NextResponse } from 'next/server';
import { getIntelligenceTelemetry } from '@/lib/intelligence/telemetry';
import { preloadIntelligence } from '@/lib/intelligence/preloader';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/cache/intelligence — full telemetry snapshot */
export async function GET() {
  try {
    const telemetry = await getIntelligenceTelemetry();
    return NextResponse.json({ success: true, telemetry });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

/** POST /api/cache/intelligence — force-refresh all stale groups */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const force = body?.force === true;

    const result = await preloadIntelligence();
    const telemetry = await getIntelligenceTelemetry();

    return NextResponse.json({ success: true, result, telemetry, forced: force });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
