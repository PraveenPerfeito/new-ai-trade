import { NextRequest, NextResponse } from 'next/server';
import { getResolvedOutcomes } from '@/lib/analytics-db';
import { computeBreakdown } from '@/lib/signal-analytics';
import { createLogger } from '@/lib/logger';

export const runtime = 'nodejs';

const log = createLogger('api/analytics/breakdown');

const VALID_DIMENSIONS = ['symbol', 'timeframe', 'scannerMode', 'volatilityRegime'] as const;
type Dimension = typeof VALID_DIMENSIONS[number];

export async function GET(req: NextRequest) {
  try {
    const by = (req.nextUrl.searchParams.get('by') ?? 'symbol') as Dimension;
    if (!VALID_DIMENSIONS.includes(by)) {
      return NextResponse.json(
        { success: false, error: `Invalid dimension. Use: ${VALID_DIMENSIONS.join(', ')}` },
        { status: 400 },
      );
    }

    const outcomes = await getResolvedOutcomes(1000);
    const breakdown = computeBreakdown(outcomes, by);

    return NextResponse.json({ success: true, dimension: by, breakdown });
  } catch (err) {
    log.error({ err }, 'analytics/breakdown failed');
    return NextResponse.json({ success: false, error: 'Failed to compute breakdown' }, { status: 500 });
  }
}
