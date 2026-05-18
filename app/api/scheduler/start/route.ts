import { NextRequest, NextResponse } from 'next/server';
import { scheduler } from '@/lib/scheduler';
import { parseBody, schedulerStartSchema } from '@/lib/validate';
import { createLogger } from '@/lib/logger';

export const runtime = 'nodejs';

const log = createLogger('api/scheduler/start');

export async function POST(req: NextRequest) {
  const { data, error: validationError } = await parseBody(req, schedulerStartSchema);
  if (validationError) return validationError;

  try {
    const intervalMs = data.intervalMinutes
      ? data.intervalMinutes * 60_000
      : data.intervalMs;

    scheduler.start({
      ...(data.mode     && { mode: data.mode }),
      ...(intervalMs    && { intervalMs }),
    });

    const status = scheduler.getStatus();
    log.info({ mode: status.config.mode, intervalMs: status.config.intervalMs }, 'Scheduler started');
    return NextResponse.json({ success: true, status });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to start scheduler';
    log.error({ err: msg }, 'Scheduler start error');
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
