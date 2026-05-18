import { createClient } from '@supabase/supabase-js';
import { SignalOutcomeRecord, SignalOutcome, VolatilityRegime } from '@/types';
import { createLogger } from './logger';

const log = createLogger('lib/analytics-db');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(): any {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Supabase env vars not set');
  return createClient(url, key);
}

// ─── Volatility regime from stored ATR + price ────────────────────────────────

function volatilityRegimeFromATR(atr: number | null, price: number): VolatilityRegime {
  if (!atr || !price || price === 0) return 'NORMAL';
  const pct = (atr / price) * 100;
  if (pct > 8)   return 'EXTREME';
  if (pct > 5)   return 'HIGH';
  if (pct > 1.5) return 'NORMAL';
  return 'LOW';
}

// ─── Backfill: create PENDING records for signals that don't have one yet ─────

export async function backfillOutcomeRecords(): Promise<number> {
  const client = db();

  const [existingRes, signalsRes] = await Promise.all([
    client.from('signal_outcomes').select('signal_id'),
    client
      .from('signals')
      .select('id, symbol, type, timeframe, scanner_mode, entry_price, target_price, stop_loss, rr_ratio, confidence, ai_validated, atr, created_at')
      .order('created_at', { ascending: false })
      .limit(2000),
  ]);

  if (existingRes.error) {
    log.error({ err: existingRes.error.message }, 'backfill: fetch existing');
    return 0;
  }
  if (signalsRes.error) {
    log.error({ err: signalsRes.error.message }, 'backfill: fetch signals');
    return 0;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const existingIds = new Set((existingRes.data ?? []).map((r: any) => r.signal_id as string));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const missing = (signalsRes.data ?? []).filter((s: any) => !existingIds.has(s.id as string));

  if (missing.length === 0) return 0;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = missing.map((s: any) => ({
    signal_id:         s.id,
    symbol:            s.symbol,
    signal_type:       s.type,
    timeframe:         s.timeframe,
    scanner_mode:      s.scanner_mode ?? 'spot',
    entry_price:       s.entry_price,
    target_price:      s.target_price,
    stop_loss:         s.stop_loss,
    rr_ratio:          s.rr_ratio,
    confidence:        s.confidence,
    ai_validated:      s.ai_validated ?? false,
    volatility_regime: volatilityRegimeFromATR(s.atr, s.entry_price),
    outcome:           'PENDING',
    created_at:        s.created_at,
  }));

  let inserted = 0;
  const CHUNK = 100;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await client
      .from('signal_outcomes')
      .insert(rows.slice(i, i + CHUNK));
    if (error) log.warn({ err: error.message }, 'backfill insert chunk');
    else inserted += Math.min(CHUNK, rows.length - i);
  }

  log.info({ inserted }, 'backfill complete');
  return inserted;
}

// ─── Fetch pending outcomes for the tracker ───────────────────────────────────

export async function getPendingOutcomes(limit = 50): Promise<SignalOutcomeRecord[]> {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days max age
  const { data, error } = await db()
    .from('signal_outcomes')
    .select('*')
    .eq('outcome', 'PENDING')
    .gte('created_at', cutoff)
    .lt('check_count', 200)
    .order('checked_at', { ascending: true, nullsFirst: true })
    .limit(limit);

  if (error) {
    log.error({ err: error.message }, 'getPendingOutcomes');
    return [];
  }
  return (data ?? []).map(rowToOutcome);
}

// ─── Update a single outcome record ──────────────────────────────────────────

export interface OutcomeResolution {
  outcome: Exclude<SignalOutcome, 'PENDING'>;
  exitPrice: number;
  exitTime: Date;
  rrAchieved: number;
  pnlPct: number;
  durationHours: number;
}

export async function updateOutcome(
  id: string,
  currentCheckCount: number,
  resolution: OutcomeResolution | null,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const patch: Record<string, any> = {
    checked_at:  new Date().toISOString(),
    check_count: currentCheckCount + 1,
  };

  if (resolution) {
    patch.outcome       = resolution.outcome;
    patch.exit_price    = resolution.exitPrice;
    patch.exit_time     = resolution.exitTime.toISOString();
    patch.rr_achieved   = resolution.rrAchieved;
    patch.pnl_pct       = resolution.pnlPct;
    patch.duration_hours = resolution.durationHours;
    patch.resolved_at   = new Date().toISOString();
  }

  const { error } = await db().from('signal_outcomes').update(patch).eq('id', id);
  if (error) log.error({ err: error.message, id }, 'updateOutcome');
}

// ─── Fetch resolved outcomes for analytics ───────────────────────────────────

export async function getResolvedOutcomes(limit = 1000): Promise<SignalOutcomeRecord[]> {
  const { data, error } = await db()
    .from('signal_outcomes')
    .select('*')
    .neq('outcome', 'PENDING')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    log.error({ err: error.message }, 'getResolvedOutcomes');
    return [];
  }
  return (data ?? []).map(rowToOutcome);
}

// ─── Resolution status counts ─────────────────────────────────────────────────

export async function getResolutionStatus(): Promise<{
  total: number;
  resolved: number;
  pending: number;
  resolvedToday: number;
}> {
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  const client = db();
  const [totalRes, resolvedRes, todayRes] = await Promise.all([
    client.from('signal_outcomes').select('id', { count: 'exact', head: true }),
    client.from('signal_outcomes').select('id', { count: 'exact', head: true }).neq('outcome', 'PENDING'),
    client.from('signal_outcomes').select('id', { count: 'exact', head: true })
      .neq('outcome', 'PENDING')
      .gte('resolved_at', todayStart.toISOString()),
  ]);

  const total        = totalRes.count    ?? 0;
  const resolved     = resolvedRes.count ?? 0;
  const resolvedToday = todayRes.count   ?? 0;

  return { total, resolved, pending: total - resolved, resolvedToday };
}

// ─── Row mapper ───────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToOutcome(row: any): SignalOutcomeRecord {
  return {
    id:               row.id,
    signalId:         row.signal_id,
    symbol:           row.symbol,
    signalType:       row.signal_type,
    timeframe:        row.timeframe,
    scannerMode:      row.scanner_mode,
    entryPrice:       Number(row.entry_price),
    targetPrice:      Number(row.target_price),
    stopLoss:         Number(row.stop_loss),
    rrRatio:          Number(row.rr_ratio),
    confidence:       Number(row.confidence),
    aiValidated:      Boolean(row.ai_validated),
    volatilityRegime: (row.volatility_regime ?? 'NORMAL') as VolatilityRegime,
    riskGrade:        row.risk_grade ?? undefined,
    riskScore:        row.risk_score  != null ? Number(row.risk_score)  : undefined,
    qualityScore:     row.quality_score != null ? Number(row.quality_score) : undefined,
    outcome:          row.outcome,
    exitPrice:        row.exit_price    != null ? Number(row.exit_price)    : undefined,
    exitTime:         row.exit_time     ? new Date(row.exit_time)     : undefined,
    rrAchieved:       row.rr_achieved   != null ? Number(row.rr_achieved)   : undefined,
    pnlPct:           row.pnl_pct       != null ? Number(row.pnl_pct)       : undefined,
    durationHours:    row.duration_hours != null ? Number(row.duration_hours) : undefined,
    createdAt:        new Date(row.created_at),
    resolvedAt:       row.resolved_at ? new Date(row.resolved_at) : undefined,
    checkedAt:        row.checked_at  ? new Date(row.checked_at)  : undefined,
    checkCount:       Number(row.check_count) || 0,
  };
}
