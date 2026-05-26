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

    // Fetch outcome statuses for these signals
    const ids = raw.map((s) => s.id).filter(Boolean) as string[];
    let outcomeMap = new Map<string, SignalOutcome>();

    if (ids.length > 0) {
      try {
        const admin = createSupabaseAdminClient();
        const { data: outcomes } = await admin
          .from('signal_outcomes')
          .select('signal_id, outcome')
          .in('signal_id', ids);
        for (const row of (outcomes ?? []) as { signal_id: string; outcome: string }[]) {
          outcomeMap.set(row.signal_id, row.outcome as SignalOutcome);
        }
      } catch {
        // Non-fatal — outcome status is optional
      }
    }

    // Map to tactical rows with computed lifecycle
    const totalBeforeFilter = raw.length;
    let rows: TacticalSignalRow[] = raw.map((signal) => {
      const outcomeStatus = signal.id ? outcomeMap.get(signal.id) : undefined;
      const stage = computeLifecycleStage(signal, outcomeStatus);
      return {
        ...signal,
        lifecycleStage: stage,
        outcomeStatus,
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
