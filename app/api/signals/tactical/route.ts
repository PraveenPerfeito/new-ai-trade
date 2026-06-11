import { NextRequest, NextResponse } from 'next/server';
import { parseQuery } from '@/lib/validate';
import { tacticalQuerySchema } from '@/lib/validate';
import { getRecentSignals } from '@/lib/supabase';
import { computeLifecycleStage } from '@/lib/signal-lifecycle';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import type { TacticalSignalRow, SignalLifecycleStage, SignalOutcome } from '@/types';

export const runtime  = 'nodejs';
export const dynamic  = 'force-dynamic';

/** GET /api/signals/tactical — signal feed with server-side lifecycle computation */
export async function GET(req: NextRequest) {
  const parsed = parseQuery(req, tacticalQuerySchema);
  if (parsed.error) return parsed.error;

  const { limit, minConfidence, lifecycleStage, type, mode } = parsed.data;

  try {
    // Fetch more than needed to allow filtering
    const raw = await getRecentSignals(limit * 2, minConfidence);

    // Fetch outcome statuses + realized results for these signals
    const ids = raw.map((s) => s.id).filter(Boolean) as string[];
    interface OutcomeRec { outcome: SignalOutcome; rrAchieved: number | null; pnlPct: number | null; durationHours: number | null }
    const outcomeMap = new Map<string, OutcomeRec>();

    if (ids.length > 0) {
      try {
        const admin = createSupabaseAdminClient();
        const { data: outcomes } = await admin
          .from('signal_outcomes')
          .select('signal_id, outcome, rr_achieved, pnl_pct, duration_hours')
          .in('signal_id', ids);
        for (const row of (outcomes ?? []) as { signal_id: string; outcome: string; rr_achieved: number | null; pnl_pct: number | null; duration_hours: number | null }[]) {
          outcomeMap.set(row.signal_id, {
            outcome:       row.outcome as SignalOutcome,
            rrAchieved:    row.rr_achieved,
            pnlPct:        row.pnl_pct,
            durationHours: row.duration_hours,
          });
        }
      } catch {
        // Non-fatal — outcome status is optional
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

    // Apply filters
    if (lifecycleStage !== 'all') {
      rows = rows.filter((r) => r.lifecycleStage === (lifecycleStage as SignalLifecycleStage));
    }
    if (type !== 'all') {
      rows = rows.filter((r) => r.type === type);
    }
    if (mode !== 'all') {
      rows = rows.filter((r) => r.scannerMode === mode);
    }

    const sliced = rows.slice(0, limit);

    return NextResponse.json({
      success: true,
      signals: sliced,
      total:   sliced.length,
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
