import { NextRequest, NextResponse } from 'next/server';
import { runScan } from '@/lib/scanner';
import { scheduler } from '@/lib/scheduler';
import { parseBody, scanBodySchema } from '@/lib/validate';
import { getAccessContext, canTriggerScan } from '@/lib/access-control';
import { trackApiCall, trackScanTrigger } from '@/lib/usage-tracking';
import { createLogger } from '@/lib/logger';

export const runtime     = 'nodejs';
export const maxDuration = 300;

const log = createLogger('api/scanner/run');

export async function POST(req: NextRequest) {
  const requestId = req.headers.get('x-request-id') ?? 'unknown';
  const t0        = Date.now();

  // ── Body validation ────────────────────────────────────────────────────────
  const { data, error: validationError } = await parseBody(req, scanBodySchema);
  if (validationError) return validationError;
  const { mode, coins } = data;

  // ── Plan access check ──────────────────────────────────────────────────────
  const ctx = await getAccessContext(req);
  trackApiCall(ctx.userId).catch(() => {});

  if (!ctx.plan.allowedModes.includes(mode)) {
    log.warn({ requestId, mode, planId: ctx.planId }, 'Scan rejected — mode not in plan');
    return NextResponse.json(
      { success: false, error: `Scan mode "${mode}" requires a higher plan`, plan: ctx.planId },
      { status: 403 },
    );
  }

  const scanAllowed = await canTriggerScan(ctx);
  if (!scanAllowed.allowed) {
    log.warn({ requestId, mode, planId: ctx.planId, reason: scanAllowed.reason }, 'Scan rejected — plan limit');
    return NextResponse.json(
      { success: false, error: scanAllowed.reason, plan: ctx.planId },
      { status: 429 },
    );
  }

  log.info({ requestId, mode }, 'Manual scan requested');

  // ── Overlap prevention ─────────────────────────────────────────────────────
  if (scheduler.isLocked) {
    const st = scheduler.getStatus();
    log.warn({ requestId, mode, lockedBy: st.lockOwner }, 'Scan rejected — already locked');
    return NextResponse.json(
      { success: false, error: 'A scan is already in progress', locked: true, lockedBy: st.lockOwner },
      { status: 423 },
    );
  }

  // ── Rate limit + gap protection ────────────────────────────────────────────
  const canRun = scheduler.checkCanRun();
  if (!canRun.ok) {
    log.warn({ requestId, mode, reason: canRun.reason }, 'Scan rejected — rate limit');
    return NextResponse.json(
      { success: false, error: canRun.reason, retryAfterMs: canRun.retryAfterMs },
      {
        status:  429,
        headers: { 'Retry-After': String(Math.ceil(canRun.retryAfterMs / 1000)) },
      },
    );
  }

  // ── Acquire lock ───────────────────────────────────────────────────────────
  if (!scheduler.tryAcquireLock('api')) {
    return NextResponse.json(
      { success: false, error: 'Lock acquired by concurrent request', locked: true },
      { status: 423 },
    );
  }

  trackScanTrigger(ctx.userId).catch(() => {});
  const scanId = scheduler.beginScan(mode, 'manual');

  try {
    const result = await runScan(mode, coins?.length ? { filterCoins: coins } : undefined);
    scheduler.completeScan(scanId, result);

    const durationMs = Date.now() - t0;
    log.info(
      { requestId, mode, coinsScanned: result.coinsScanned, signalsFound: result.signals.length, durationMs },
      'Scan completed',
    );

    return NextResponse.json({
      success:        true,
      scanId,
      scanRunId:      result.scanRunId,
      mode:           result.mode,
      coinsScanned:   result.coinsScanned,
      signalsFound:   result.signals.length,
      highConfidence: result.signals.filter(s => s.confidence >= 85).length,
      durationMs,
      signals:        result.signals.slice(0, 20),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Scan failed';
    scheduler.failScan(scanId, err, mode, 0, false);
    log.error({ requestId, mode, err: msg, durationMs: Date.now() - t0 }, 'Scan failed');
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  } finally {
    scheduler.releaseLock();
  }
}
