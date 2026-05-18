import { NextRequest, NextResponse } from 'next/server';
import { getBacktestRun } from '@/lib/supabase';

export const runtime = 'nodejs';

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const { run, trades } = await getBacktestRun(params.id);
  if (!run) {
    return NextResponse.json({ success: false, error: 'Backtest run not found' }, { status: 404 });
  }
  return NextResponse.json({ success: true, run, trades });
}
