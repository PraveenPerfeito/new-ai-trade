import { NextRequest, NextResponse } from 'next/server';
import { getRecentSignals } from '@/lib/supabase';
import { parseQuery, signalsQuerySchema } from '@/lib/validate';
import { getAccessContext, filterSignalsForPlan } from '@/lib/access-control';
import { trackApiCall, trackSignalView } from '@/lib/usage-tracking';
import { createLogger } from '@/lib/logger';

export const runtime = 'nodejs';

const log = createLogger('api/signals');

export async function GET(req: NextRequest) {
  const { data, error: validationError } = parseQuery(req, signalsQuerySchema);
  if (validationError) return validationError;
  const { limit, minConfidence } = data;

  const ctx = await getAccessContext(req);
  trackApiCall(ctx.userId).catch(() => {});

  try {
    // Fetch extra so plan-filtering still fills the requested limit when possible
    const signals = await getRecentSignals(limit * 2, minConfidence);
    const { visible, lockedCount } = filterSignalsForPlan(signals, ctx);
    const paged = visible.slice(0, limit);

    if (paged.length > 0) trackSignalView(ctx.userId, paged.length).catch(() => {});

    log.debug({ limit, minConfidence, returned: paged.length, locked: lockedCount, plan: ctx.planId }, 'Signals fetched');
    return NextResponse.json({
      success: true,
      total:   paged.length,
      signals: paged,
      lockedCount,
      plan:    ctx.planId,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to fetch signals';
    log.error({ limit, minConfidence, err: msg }, 'Signal fetch error');
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
