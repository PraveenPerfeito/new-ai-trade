import { NextRequest, NextResponse } from 'next/server';
import { scheduler } from '@/lib/scheduler';
import { parseBody, scanBodySchema } from '@/lib/validate';
import { getAccessContext, canTriggerScan } from '@/lib/access-control';
import { trackApiCall, trackScanTrigger } from '@/lib/usage-tracking';
import { createLogger } from '@/lib/logger';
import { getEnv } from '@/lib/env';

export const runtime     = 'nodejs';
export const maxDuration = 30;   // just a proxy call now — no long-running scan

const log = createLogger('api/scanner/run');

export async function POST(req: NextRequest) {
  const requestId = req.headers.get('x-request-id') ?? 'unknown';

  // ── Body validation ────────────────────────────────────────────────────────
  const { data, error: validationError } = await parseBody(req, scanBodySchema);
  if (validationError) return validationError;
  const { mode } = data;

  // ── Plan access check ──────────────────────────────────────────────────────
  const ctx = await getAccessContext(req);
  trackApiCall(ctx.userId).catch(() => {});

  if (!ctx.plan.allowedModes.includes(mode)) {
    return NextResponse.json(
      { success: false, error: `Scan mode "${mode}" requires a higher plan`, plan: ctx.planId },
      { status: 403 },
    );
  }

  const scanAllowed = await canTriggerScan(ctx);
  if (!scanAllowed.allowed) {
    return NextResponse.json(
      { success: false, error: scanAllowed.reason, plan: ctx.planId },
      { status: 429 },
    );
  }

  // ── Rate-limit guard (in-memory) ───────────────────────────────────────────
  const canRun = scheduler.checkCanRun();
  if (!canRun.ok) {
    return NextResponse.json(
      { success: false, error: canRun.reason, retryAfterMs: canRun.retryAfterMs },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(canRun.retryAfterMs / 1000)) } },
    );
  }

  trackScanTrigger(ctx.userId).catch(() => {});
  log.info({ requestId, mode }, 'Forwarding scan trigger to Python backend');

  // ── Proxy to Python backend scanner (has EMA200, BB, daily TF, candlestick patterns) ─
  try {
    const env         = getEnv();
    const backendUrl  = env.BACKEND_URL;
    const adminSecret = env.ADMIN_SECRET;

    if (!backendUrl) {
      return NextResponse.json({ success: false, error: 'BACKEND_URL not configured' }, { status: 503 });
    }

    const res = await fetch(`${backendUrl}/api/scanner/trigger`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'X-Admin-Secret': adminSecret ?? '',
      },
      body: JSON.stringify({ mode }),
    });

    if (res.status === 409) {
      return NextResponse.json(
        { success: false, error: `A ${mode} scan is already running — check back in a moment.` },
        { status: 423 },
      );
    }

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      log.error({ requestId, mode, status: res.status, text }, 'Backend scan trigger failed');
      return NextResponse.json({ success: false, error: `Backend error: ${res.status}` }, { status: 502 });
    }

    const json = await res.json();
    return NextResponse.json({
      success:  true,
      scanId:   json.scan_id,
      mode:     json.mode,
      status:   json.status,
      message:  json.message,
    });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to reach backend';
    log.error({ requestId, mode, err: msg }, 'Scan trigger network error');
    return NextResponse.json({ success: false, error: msg }, { status: 502 });
  }
}
