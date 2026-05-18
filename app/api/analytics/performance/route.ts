import { NextResponse } from 'next/server';
import { buildAnalyticsData } from '@/lib/signal-analytics';
import { createLogger } from '@/lib/logger';

export const runtime = 'nodejs';

const log = createLogger('api/analytics/performance');

export async function GET() {
  try {
    const data = await buildAnalyticsData();
    return NextResponse.json({ success: true, ...data });
  } catch (err) {
    log.error({ err }, 'analytics/performance failed');
    return NextResponse.json({ success: false, error: 'Failed to compute analytics' }, { status: 500 });
  }
}
