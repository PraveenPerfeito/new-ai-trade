import { NextResponse } from 'next/server';
import { getPortfolioSnapshot } from '@/lib/paper-trading-engine';
import { createLogger } from '@/lib/logger';

export const runtime = 'nodejs';
const log = createLogger('api/paper-trading/portfolio');

export async function GET() {
  try {
    const snapshot = await getPortfolioSnapshot();
    return NextResponse.json({ success: true, ...snapshot });
  } catch (err) {
    log.error({ err }, 'portfolio snapshot failed');
    return NextResponse.json({ success: false, error: 'Failed to load portfolio' }, { status: 500 });
  }
}
