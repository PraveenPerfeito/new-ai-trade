import { NextRequest, NextResponse } from 'next/server';
import { closeTradeManually } from '@/lib/paper-trading-engine';
import { createLogger } from '@/lib/logger';

export const runtime = 'nodejs';
const log = createLogger('api/paper-trading/trades/[id]/close');

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const { id } = params;
    if (!id) {
      return NextResponse.json({ success: false, error: 'Trade ID required' }, { status: 400 });
    }

    const result = await closeTradeManually(id);

    if (!result.success) {
      return NextResponse.json({ success: false, error: result.error }, { status: 422 });
    }

    log.info({ tradeId: id }, 'manual close');
    return NextResponse.json({ success: true, trade: result.trade });
  } catch (err) {
    log.error({ err }, 'manual close failed');
    return NextResponse.json({ success: false, error: 'Failed to close trade' }, { status: 500 });
  }
}
