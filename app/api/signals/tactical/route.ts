import { NextRequest, NextResponse } from 'next/server';
import { parseQuery } from '@/lib/validate';
import { tacticalQuerySchema } from '@/lib/validate';
import { getRecentSignals } from '@/lib/supabase';
import { computeLifecycleStage } from '@/lib/signal-lifecycle';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { getAccessContext } from '@/lib/access-control';
import type { TacticalSignalRow, SignalLifecycleStage, SignalOutcome } from '@/types';

export const runtime  = 'nodejs';
export const dynamic  = 'force-dynamic';

/** GET /api/signals/tactical — signal feed with server-side lifecycle computation */
export async function GET(req: NextRequest) {
  const parsed = parseQuery(req, tacticalQuerySchema);
  if (parsed.error) return parsed.error;

  const { limit, minConfidence, lifecycleStage, type, mode } = parsed.data;

  // Resolve caller's plan and apply confidence floor — prevents free/pro users from
  // seeing signals below their plan threshold via direct API calls. Admin (enterprise)
  // plan threshold is 70, so this is always a no-op for admin dashboard callers.
  const ctx = await getAccessContext(req);
  const effectiveMinConf = Math.max(minConfidence, ctx.plan.minSignalConfidence);

  try {
    // Count total DB signals matching criteria — returned as dbTotal so the UI
    // can show "showing X of Y" without a second API call.
    let dbTotal: number | null = null;
    try {
      const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const adminForCount = createSupabaseAdminClient();
      const { count } = await adminForCount
        .from('signals')
        .select('*', { count: 'exact', head: true })
        .gte('confidence', effectiveMinConf)
        .gte('created_at', cutoff);
      dbTotal = count;
    } catch { /* non-fatal — UI degrades gracefully */ }

    // Fetch with DB-level mode/type filtering so pagination isn't limited by client-side post-filter
    const raw = await getRecentSignals(
      limit * 2,
      effectiveMinConf,
      7,
      mode !== 'all' ? mode : undefined,
      type !== 'all' ? type : undefined,
    );

    // Fetch outcome statuses + realized results for these signals
    const ids = raw.map((s) => s.id).filter(Boolean) as string[];
    interface OutcomeRec { outcome: SignalOutcome; rrAchieved: number | null; pnlPct: number | null; durationHours: number | null }
    const outcomeMap = new Map<string, OutcomeRec>();
    let outcomesAvailable = true;

    if (ids.length > 0) {
      try {
        const admin = createSupabaseAdminClient();
        const { data: outcomes } = await admin
          .from('signal_outcomes')
          .select('signal_id, outcome, rr_achieved, pnl_pct, duration_hours')
          .in('signal_id', ids)
          .neq('outcome', 'PENDING');
        for (const row of (outcomes ?? []) as { signal_id: string; outcome: string; rr_achieved: number | null; pnl_pct: number | null; duration_hours: number | null }[]) {
          outcomeMap.set(row.signal_id, {
            outcome:       row.outcome as SignalOutcome,
            rrAchieved:    row.rr_achieved,
            pnlPct:        row.pnl_pct,
            durationHours: row.duration_hours,
          });
        }
      } catch {
        outcomesAvailable = false;
      }
    }

    // Map to tactical rows with computed lifecycle
    const totalBeforeFilter = raw.length;
    let rows: TacticalSignalRow[] = raw.map((signal) => {
      const rec = signal.id ? outcomeMap.get(signal.id) : undefined;
      const stage = computeLifecycleStage(signal, rec?.outcome);
      return {
        ...signal,
        lifecycleStage: stage,
        outcomeStatus:  rec?.outcome,
        rrAchieved:     rec?.rrAchieved ?? null,
        pnlPct:         rec?.pnlPct ?? null,
        durationHours:  rec?.durationHours ?? null,
      };
    });

    // Apply lifecycle filter (mode/type already applied at DB level)
    if (lifecycleStage !== 'all') {
      rows = rows.filter((r) => r.lifecycleStage === (lifecycleStage as SignalLifecycleStage));
    }

    const sliced = rows.slice(0, limit);

    return NextResponse.json({
      success: true,
      signals: sliced,
      total:   sliced.length,
      dbTotal,
      outcomesAvailable,    // false when signal_outcomes DB query failed — UI shows degraded banner
      filters: {
        applied: { lifecycleStage, type, mode, minConfidence },
        totalBeforeFilter,
      },
      computedAt: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
