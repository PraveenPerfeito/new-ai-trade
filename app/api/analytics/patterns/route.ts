import { NextRequest, NextResponse } from 'next/server';
import { getResolvedOutcomes } from '@/lib/analytics-db';
import { computeSetupPatterns, computeAIAccuracy } from '@/lib/signal-analytics';
import { createLogger } from '@/lib/logger';

export const runtime = 'nodejs';

const log = createLogger('api/analytics/patterns');

export async function GET(req: NextRequest) {
  try {
    const topN = parseInt(req.nextUrl.searchParams.get('n') ?? '8', 10);
    const outcomes = await getResolvedOutcomes(1000);

    const [bestSetups, worstSetups, aiAccuracy] = await Promise.all([
      Promise.resolve(computeSetupPatterns(outcomes, 'best', topN)),
      Promise.resolve(computeSetupPatterns(outcomes, 'worst', topN)),
      Promise.resolve(computeAIAccuracy(outcomes)),
    ]);

    return NextResponse.json({ success: true, bestSetups, worstSetups, aiAccuracy });
  } catch (err) {
    log.error({ err }, 'analytics/patterns failed');
    return NextResponse.json({ success: false, error: 'Failed to compute patterns' }, { status: 500 });
  }
}
