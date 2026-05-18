import { NextRequest, NextResponse } from 'next/server';
import { getBacktestRun } from '@/lib/supabase';

export const runtime = 'nodejs';

// GET /api/backtest/compare?ids=id1,id2,id3
export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('ids') ?? '';
  const ids = raw.split(',').map(s => s.trim()).filter(Boolean).slice(0, 6);

  if (ids.length < 2) {
    return NextResponse.json(
      { success: false, error: 'Provide at least 2 run IDs via ?ids=id1,id2' },
      { status: 400 },
    );
  }

  const results = await Promise.all(ids.map(id => getBacktestRun(id)));
  const runs = results.map(r => r.run).filter(Boolean);

  if (runs.length < 2) {
    return NextResponse.json({ success: false, error: 'Could not load requested runs' }, { status: 404 });
  }

  // Build ranked comparison table
  const table = runs.map(run => ({
    id:           run!.id,
    strategyName: run!.strategyName,
    mode:         run!.mode,
    coinsTested:  run!.coinsTested,
    totalTrades:  run!.totalTrades,
    startedAt:    run!.startedAt,
    winRate:         run!.metrics?.winRate        ?? 0,
    profitFactor:    run!.metrics?.profitFactor   ?? 0,
    totalReturn:     run!.metrics?.totalReturn    ?? 0,
    maxDrawdown:     run!.metrics?.maxDrawdown    ?? 0,
    sharpeRatio:     run!.metrics?.sharpeRatio    ?? 0,
    avgRR:           run!.metrics?.avgRR          ?? 0,
    bestTrade:       run!.metrics?.bestTrade      ?? 0,
    worstTrade:      run!.metrics?.worstTrade     ?? 0,
    // Composite score: win_rate*30 + profit_factor*10 + sharpe*20 - drawdown*10
    score: (
      (run!.metrics?.winRate      ?? 0) * 30 +
      Math.min(run!.metrics?.profitFactor ?? 0, 5) * 10 +
      (run!.metrics?.sharpeRatio  ?? 0) * 20 -
      (run!.metrics?.maxDrawdown  ?? 0) * 10
    ),
  }));

  table.sort((a, b) => b.score - a.score);

  return NextResponse.json({ success: true, comparison: table });
}
