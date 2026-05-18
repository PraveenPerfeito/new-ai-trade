import { NextRequest, NextResponse } from 'next/server';
import { getAccessContext } from '@/lib/access-control';
import { getQuotaStatus } from '@/lib/usage-tracking';
import { createLogger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api/usage');

export async function GET(req: NextRequest) {
  const ctx = await getAccessContext(req);

  try {
    const quota = await getQuotaStatus(ctx);
    log.debug({ userId: ctx.userId, planId: ctx.planId }, 'Usage fetched');
    return NextResponse.json({ success: true, data: quota });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to fetch usage';
    log.error({ err: msg }, 'Usage fetch error');
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
