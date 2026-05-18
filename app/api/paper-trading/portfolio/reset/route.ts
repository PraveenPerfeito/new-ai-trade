import { NextResponse } from 'next/server';
import { getOrCreatePortfolio, resetPortfolio } from '@/lib/paper-trading-db';
import { createLogger } from '@/lib/logger';

export const runtime = 'nodejs';
const log = createLogger('api/paper-trading/portfolio/reset');

export async function POST() {
  try {
    const portfolio = await getOrCreatePortfolio();
    await resetPortfolio(portfolio.id);
    log.info({ portfolioId: portfolio.id }, 'portfolio reset');
    return NextResponse.json({ success: true });
  } catch (err) {
    log.error({ err }, 'portfolio reset failed');
    return NextResponse.json({ success: false, error: 'Reset failed' }, { status: 500 });
  }
}
