import { createClient } from '@supabase/supabase-js';
import type { UsageRecord, QuotaStatus, AccessContext } from '@/types';
import { isUnlimited } from './plans';
import { createLogger } from './logger';

const log = createLogger('lib/usage-tracking');

function adminDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase service-role env vars not set');
  return createClient(url, key);
}

function currentPeriod(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

// Atomically increment one or more counters in the usage record for the current period.
async function increment(
  userId: string,
  delta: Partial<Record<'api_calls' | 'signals_viewed' | 'scans_triggered', number>>,
): Promise<void> {
  const period = currentPeriod();

  // Ensure the row exists first (upsert with 0 values)
  await adminDb()
    .from('usage_records')
    .upsert(
      { user_id: userId, period, api_calls: 0, signals_viewed: 0, scans_triggered: 0 },
      { onConflict: 'user_id,period', ignoreDuplicates: true },
    );

  // Now increment — Supabase doesn't support atomic increments directly,
  // so we fetch + update. Acceptable for analytics; not financial-grade.
  const { data, error } = await adminDb()
    .from('usage_records')
    .select('api_calls,signals_viewed,scans_triggered')
    .eq('user_id', userId)
    .eq('period', period)
    .single();

  if (error || !data) {
    log.warn({ userId, period }, 'increment: failed to fetch usage row');
    return;
  }

  const patch: Record<string, number> = { updated_at: Date.now() };
  if (delta.api_calls)       patch.api_calls       = (data.api_calls       as number) + delta.api_calls;
  if (delta.signals_viewed)  patch.signals_viewed  = (data.signals_viewed  as number) + delta.signals_viewed;
  if (delta.scans_triggered) patch.scans_triggered = (data.scans_triggered as number) + delta.scans_triggered;
  patch.updated_at = Date.now(); // overwritten below with ISO string

  const { error: upErr } = await adminDb()
    .from('usage_records')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('period', period);

  if (upErr) log.warn({ userId, period, err: upErr.message }, 'increment update failed');
}

export async function trackApiCall(userId: string): Promise<void> {
  await increment(userId, { api_calls: 1 }).catch(e => log.warn({ err: String(e) }, 'trackApiCall'));
}

export async function trackSignalView(userId: string, count = 1): Promise<void> {
  await increment(userId, { signals_viewed: count }).catch(e => log.warn({ err: String(e) }, 'trackSignalView'));
}

export async function trackScanTrigger(userId: string): Promise<void> {
  await increment(userId, { scans_triggered: 1 }).catch(e => log.warn({ err: String(e) }, 'trackScanTrigger'));
}

export async function getUsage(userId: string, period?: string): Promise<UsageRecord | null> {
  const p = period ?? currentPeriod();
  const { data, error } = await adminDb()
    .from('usage_records')
    .select('*')
    .eq('user_id', userId)
    .eq('period', p)
    .single();

  if (error) return null;
  return rowToUsage(data);
}

export async function getQuotaStatus(ctx: AccessContext): Promise<QuotaStatus> {
  const period  = currentPeriod();
  const usage   = (await getUsage(ctx.userId, period)) ?? {
    id: '', userId: ctx.userId, period, apiCalls: 0, signalsViewed: 0, scansTriggered: 0, updatedAt: new Date(),
  };
  const { plan } = ctx;

  return {
    plan,
    period,
    usage,
    remaining: {
      apiCalls:      isUnlimited(plan.monthlyApiCalls) ? -1 : Math.max(0, plan.monthlyApiCalls - usage.apiCalls),
      signalsPerDay: isUnlimited(plan.dailySignalLimit) ? -1 : Math.max(0, plan.dailySignalLimit - usage.signalsViewed),
      scansPerDay:   isUnlimited(plan.maxScanTriggers) ? -1 : Math.max(0, plan.maxScanTriggers - usage.scansTriggered),
    },
  };
}

function rowToUsage(row: Record<string, unknown>): UsageRecord {
  return {
    id:             row.id as string,
    userId:         row.user_id as string,
    period:         row.period as string,
    apiCalls:       Number(row.api_calls),
    signalsViewed:  Number(row.signals_viewed),
    scansTriggered: Number(row.scans_triggered),
    updatedAt:      new Date(row.updated_at as string),
  };
}
