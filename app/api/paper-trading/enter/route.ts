import { NextRequest, NextResponse } from 'next/server';
import { enterTrade } from '@/lib/paper-trading-engine';
import { TradingSignal } from '@/types';
import { createLogger } from '@/lib/logger';

export const runtime = 'nodejs';
const log = createLogger('api/paper-trading/enter');

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { signal, leverage, riskPct } = body as {
      signal:   TradingSignal;
      leverage?: number;
      riskPct?:  number;
    };

    if (!signal?.symbol || !signal?.entryPrice) {
      return NextResponse.json({ success: false, error: 'Invalid signal payload' }, { status: 400 });
    }

    const result = await enterTrade(signal, { leverage, riskPct });

    if (!result.success) {
      return NextResponse.json({ success: false, error: result.error }, { status: 422 });
    }

    log.info({ symbol: signal.symbol, type: signal.type }, 'paper trade entered');
    return NextResponse.json({ success: true, trade: result.trade });
  } catch (err) {
    log.error({ err }, 'enter trade failed');
    return NextResponse.json({ success: false, error: 'Failed to enter trade' }, { status: 500 });
  }
}
