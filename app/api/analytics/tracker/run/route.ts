import { NextRequest, NextResponse } from 'next/server';
import { runOutcomeTracker } from '@/lib/outcome-tracker';
import { createLogger } from '@/lib/logger';

export const runtime = 'nodejs';

const log = createLogger('api/analytics/tracker/run');

let running = false;

export async function POST(req: NextRequest) {
  if (running) {
    return NextResponse.json({ success: false, error: 'Tracker already running' }, { status: 423 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const batchSize = Math.min(Math.max(parseInt(body.batchSize ?? '40', 10), 1), 100);

    running = true;
    log.info({ batchSize }, 'tracker run triggered');

    const result = await runOutcomeTracker(batchSize);

    return NextResponse.json({ success: true, result });
  } catch (err) {
    log.error({ err }, 'tracker run failed');
    return NextResponse.json({ success: false, error: 'Tracker run failed' }, { status: 500 });
  } finally {
    running = false;
  }
}
