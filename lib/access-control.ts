import { createClient } from '@supabase/supabase-js';
import type { TradingSignal, AccessContext, PlanId } from '@/types';
import { getPlan, isUnlimited } from './plans';
import { validateApiKey } from './api-keys';
import { createLogger } from './logger';
import { NextRequest } from 'next/server';

const log = createLogger('lib/access-control');

// Anonymous / unauthenticated requests use the free plan with a synthetic user ID.
const ANON_USER_ID = '00000000-0000-0000-0000-000000000000';

function adminDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase service-role env vars not set');
  return createClient(url, key);
}

async function getUserPlan(userId: string): Promise<PlanId> {
  try {
    const { data } = await adminDb()
      .from('users')
      .select('plan_id')
      .eq('id', userId)
      .single();
    return (data?.plan_id as PlanId) ?? 'free';
  } catch {
    return 'free';
  }
}

/**
 * Resolve the caller's access context from the incoming request.
 * Checks `X-API-Key` header. Falls back to anonymous free-tier context.
 */
export async function getAccessContext(req: NextRequest): Promise<AccessContext> {
  const rawKey = req.headers.get('x-api-key');

  if (rawKey) {
    const apiKey = await validateApiKey(rawKey);
    if (apiKey) {
      const planId = await getUserPlan(apiKey.userId);
      const plan   = getPlan(planId);
      log.debug({ userId: apiKey.userId, planId }, 'Authenticated via API key');
      return { userId: apiKey.userId, planId, plan, apiKeyId: apiKey.id };
    }
    log.warn({}, 'Invalid API key provided');
  }

  // Unauthenticated — free tier
  return { userId: ANON_USER_ID, planId: 'free', plan: getPlan('free') };
}

/**
 * Filter signals based on the caller's plan:
 * - confidence threshold is enforced (low-confidence signals are hidden)
 * - daily signal limit is enforced (excess signals are omitted)
 * Returns { visible, lockedCount } so the UI can show a "locked" count.
 */
export function filterSignalsForPlan(
  signals: TradingSignal[],
  ctx: AccessContext,
): { visible: TradingSignal[]; lockedCount: number } {
  const { plan } = ctx;

  const aboveThreshold = signals.filter(s => s.confidence >= plan.minSignalConfidence);
  const belowThreshold = signals.filter(s => s.confidence <  plan.minSignalConfidence);

  let visible = aboveThreshold;
  let lockedCount = belowThreshold.length;

  // Apply daily signal limit if not unlimited
  if (!isUnlimited(plan.dailySignalLimit) && visible.length > plan.dailySignalLimit) {
    lockedCount += visible.length - plan.dailySignalLimit;
    visible = visible.slice(0, plan.dailySignalLimit);
  }

  return { visible, lockedCount };
}

/**
 * Check whether the caller may trigger a scan.
 * Returns true if allowed, false + reason if not.
 */
export async function canTriggerScan(ctx: AccessContext): Promise<{
  allowed: boolean;
  reason?: string;
}> {
  const { plan } = ctx;

  if (!plan.allowedModes.includes('spot')) {
    return { allowed: false, reason: 'Your plan does not allow scan triggers' };
  }

  if (isUnlimited(plan.maxScanTriggers)) return { allowed: true };

  // Count today's scan triggers
  try {
    const today = new Date().toISOString().slice(0, 10);  // YYYY-MM-DD
    const { count } = await adminDb()
      .from('usage_records')
      .select('scans_triggered', { count: 'exact', head: false })
      .eq('user_id', ctx.userId)
      .gte('updated_at', `${today}T00:00:00Z`);

    // Note: scans_triggered is per-month in usage_records; for per-day we'd
    // need a daily table. This is a simplified check against the monthly figure
    // scaled down. Production should add a daily_usage_records table.
    const monthlyScans = (count as number | null) ?? 0;
    if (monthlyScans >= plan.maxScanTriggers * 30) {
      return { allowed: false, reason: `Scan limit reached for your ${plan.name} plan` };
    }
  } catch (e) {
    log.warn({ err: String(e) }, 'canTriggerScan quota check failed — allowing');
  }

  return { allowed: true };
}

/**
 * Check whether the caller may use the API (monthly API call limit).
 */
export async function canUseApi(ctx: AccessContext): Promise<boolean> {
  if (isUnlimited(ctx.plan.monthlyApiCalls)) return true;
  if (ctx.userId === ANON_USER_ID) return true; // anonymous always allowed (free tier gate is signal-level)

  try {
    const { data } = await adminDb()
      .from('usage_records')
      .select('api_calls')
      .eq('user_id', ctx.userId)
      .eq('period', new Date().toISOString().slice(0, 7))
      .single();

    const calls = data ? Number(data.api_calls) : 0;
    return calls < ctx.plan.monthlyApiCalls;
  } catch {
    return true; // fail open
  }
}
