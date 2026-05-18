import { NextResponse } from 'next/server';
import { checkPositions } from '@/lib/paper-trading-engine';
import { createLogger } from '@/lib/logger';

export const runtime = 'nodejs';
const log = createLogger('api/paper-trading/check');

let running = false;

export async function POST() {
  if (running) {
    return NextResponse.json({ success: false, error: 'Check already running' }, { status: 423 });
  }

  try {
    running = true;
    const result = await checkPositions();
    return NextResponse.json({ success: true, result });
  } catch (err) {
    log.error({ err }, 'check positions failed');
    return NextResponse.json({ success: false, error: 'Position check failed' }, { status: 500 });
  } finally {
    running = false;
  }
}
