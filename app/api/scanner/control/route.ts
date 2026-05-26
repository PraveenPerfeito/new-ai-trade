import { NextRequest, NextResponse } from 'next/server';
import { scheduler } from '@/lib/scheduler';
import { getRejectionStats } from '@/lib/rejection-tracker';
import { parseBody } from '@/lib/validate';
import { scannerControlSchema } from '@/lib/validate';

export const runtime  = 'nodejs';
export const dynamic  = 'force-dynamic';

/** GET /api/scanner/control — combined scheduler + rejection stats */
export async function GET() {
  try {
    return NextResponse.json({
      success:        true,
      scheduler:      scheduler.getStatus(),
      rejectionStats: getRejectionStats(),
      computedAt:     new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

/** POST /api/scanner/control — dispatch control actions */
export async function POST(req: NextRequest) {
  const parsed = await parseBody(req, scannerControlSchema);
  if (parsed.error) return parsed.error;

  const { action, config } = parsed.data;

  try {
    switch (action) {
      case 'start':
        if (scheduler.getStatus().emergencyStop) {
          return NextResponse.json(
            { success: false, error: 'Emergency stop is active — call reset first' },
            { status: 423 },
          );
        }
        scheduler.start({
          ...(config?.mode      ? { mode:       config.mode }      : {}),
          ...(config?.intervalMs ? { intervalMs: config.intervalMs } : {}),
        });
        break;

      case 'stop':
        scheduler.stop();
        break;

      case 'pause':
        scheduler.pause();
        break;

      case 'resume':
        scheduler.resume();
        break;

      case 'emergency_stop':
        scheduler.emergencyStop();
        break;

      case 'reset':
        scheduler.reset();
        break;

      case 'configure':
        if (!config) {
          return NextResponse.json(
            { success: false, error: 'config is required for action=configure' },
            { status: 400 },
          );
        }
        scheduler.start({
          ...(config.mode       ? { mode:       config.mode }       : {}),
          ...(config.intervalMs  ? { intervalMs: config.intervalMs }  : {}),
        });
        break;
    }

    return NextResponse.json({ success: true, status: scheduler.getStatus() });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
