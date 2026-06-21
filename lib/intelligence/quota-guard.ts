import { createLogger } from '@/lib/logger';
import { getRedis } from '@/lib/redis';
import { QuotaGuardState, QuotaWarningLevel } from './types';

const log = createLogger('lib/intelligence/quota-guard');

const MONTHLY_BUDGET  = 300_000;
const PER_MINUTE_LIMIT = 30;

const KEY_USED        = 'intel:quota:used';
const KEY_RESET_AT    = 'intel:quota:reset_at';
const QUOTA_KEY_TTL   = 40 * 24 * 60 * 60; // 40 days — covers monthly billing cycle + buffer
const KEY_MINUTE_LOG  = 'intel:quota:minute_log';   // sorted set: member=timestamp, score=timestamp

export class QuotaGuard {
  private cachedState: QuotaGuardState | null = null;
  private cacheExpiresAt = 0;

  /** Returns true if consuming `credits` is safe. Does NOT consume. */
  async canConsume(credits = 1): Promise<boolean> {
    try {
      const state = await this.getState();
      if (state.throttled) return false;
      if (state.creditsRemaining < credits) return false;
      if (state.requestsLastMinute >= PER_MINUTE_LIMIT) return false;
      return true;
    } catch {
      return true; // non-fatal — allow request if Redis is unavailable
    }
  }

  /** Consume `credits` from the monthly budget and record a minute-window request. */
  async consume(credits = 1): Promise<void> {
    try {
      const redis = getRedis();
      const pipe  = redis.pipeline();

      // Monthly counter
      pipe.incrby(KEY_USED, credits);

      // Rolling-minute sorted set: add current timestamp as both member and score.
      // Expire old entries (>60s) on read in getState().
      const now = Date.now();
      pipe.zadd(KEY_MINUTE_LOG, now, String(now));
      pipe.expire(KEY_MINUTE_LOG, 120); // auto-expire the whole key after 2 min of silence

      await pipe.exec();
      this.invalidateCache();
    } catch (err) {
      log.warn({ err }, 'quota_consume_failed — non-fatal');
    }
  }

  /** Full quota state for telemetry. Cached for 5s to avoid Redis round-trips. */
  async getState(): Promise<QuotaGuardState> {
    if (this.cachedState && Date.now() < this.cacheExpiresAt) {
      return this.cachedState;
    }

    try {
      const redis = getRedis();
      const now   = Date.now();

      const [usedRaw, resetAtRaw, minuteMembers] = await Promise.all([
        redis.get(KEY_USED),
        redis.get(KEY_RESET_AT),
        redis.zrangebyscore(KEY_MINUTE_LOG, now - 60_000, now),
      ]);

      const creditsUsed  = parseInt(usedRaw ?? '0', 10) || 0;
      const remaining    = Math.max(0, MONTHLY_BUDGET - creditsUsed);
      const pctUsed      = creditsUsed / MONTHLY_BUDGET;
      const resetAt      = resetAtRaw ?? this.nextMonthReset();
      const reqLastMin   = minuteMembers.length;

      // Ensure reset_at is seeded
      if (!resetAtRaw) {
        await redis.set(KEY_RESET_AT, resetAt, 'EX', QUOTA_KEY_TTL).catch(() => {});
      }

      const warningLevel = this.calcWarningLevel(pctUsed, reqLastMin);
      const throttled    = warningLevel === 'emergency' || reqLastMin >= PER_MINUTE_LIMIT;

      // Projected monthly use based on current daily rate
      const dayOfMonth  = new Date().getDate();
      const dailyRate   = dayOfMonth > 0 ? creditsUsed / dayOfMonth : 0;
      const projMonthly = Math.round(dailyRate * 30);
      const projExhaustion = projMonthly > MONTHLY_BUDGET
        ? this.projectedExhaustionDate(creditsUsed, dailyRate)
        : null;

      const state: QuotaGuardState = {
        monthlyBudget:           MONTHLY_BUDGET,
        creditsUsed,
        creditsRemaining:        remaining,
        pctUsed:                 Math.round(pctUsed * 1000) / 10,
        resetAt,
        throttled,
        warningLevel,
        requestsLastMinute:      reqLastMin,
        perMinuteLimit:          PER_MINUTE_LIMIT,
        projectedMonthlyUse:     projMonthly,
        projectedExhaustionDate: projExhaustion,
      };

      this.cachedState    = state;
      this.cacheExpiresAt = now + 300_000; // REDIS.REDUCE.3: 5 min — quota changes slowly; saves reads in long-lived processes
      return state;

    } catch (err) {
      log.warn({ err }, 'quota_state_read_failed — returning safe defaults');
      return this.safeDefault();
    }
  }

  /** Called by workers at the start of each calendar month. */
  async resetMonthly(): Promise<void> {
    try {
      const redis = getRedis();
      await redis.set(KEY_USED, '0', 'EX', QUOTA_KEY_TTL);
      await redis.set(KEY_RESET_AT, this.nextMonthReset(), 'EX', QUOTA_KEY_TTL);
      this.invalidateCache();
      log.info('quota_monthly_reset');
    } catch (err) {
      log.warn({ err }, 'quota_monthly_reset_failed');
    }
  }

  /** Seed initial credit count from CMC key/info response. */
  async seedFromKeyInfo(creditsUsed: number): Promise<void> {
    try {
      const redis   = getRedis();
      const current = parseInt((await redis.get(KEY_USED)) ?? '0', 10) || 0;
      // Only update if CMC reports more usage than we've tracked (conservative)
      if (creditsUsed > current) {
        await redis.set(KEY_USED, String(creditsUsed), 'EX', QUOTA_KEY_TTL);
        this.invalidateCache();
        log.info({ creditsUsed }, 'quota_seeded_from_cmc_key_info');
      }
    } catch {
      /* non-fatal */
    }
  }

  private invalidateCache(): void {
    this.cachedState    = null;
    this.cacheExpiresAt = 0;
  }

  private calcWarningLevel(pctUsed: number, reqLastMin: number): QuotaWarningLevel {
    if (pctUsed >= 0.95 || reqLastMin >= PER_MINUTE_LIMIT) return 'emergency';
    if (pctUsed >= 0.85) return 'critical';
    if (pctUsed >= 0.70) return 'warning';
    if (pctUsed >= 0.50) return 'caution';
    return 'normal';
  }

  private nextMonthReset(): string {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth() + 1, 1).toISOString();
  }

  private projectedExhaustionDate(used: number, dailyRate: number): string {
    if (dailyRate <= 0) return '';
    const daysLeft = (MONTHLY_BUDGET - used) / dailyRate;
    const d = new Date();
    d.setDate(d.getDate() + daysLeft);
    return d.toISOString();
  }

  private safeDefault(): QuotaGuardState {
    return {
      monthlyBudget:           MONTHLY_BUDGET,
      creditsUsed:             0,
      creditsRemaining:        MONTHLY_BUDGET,
      pctUsed:                 0,
      resetAt:                 this.nextMonthReset(),
      throttled:               false,
      warningLevel:            'normal',
      requestsLastMinute:      0,
      perMinuteLimit:          PER_MINUTE_LIMIT,
      projectedMonthlyUse:     0,
      projectedExhaustionDate: null,
    };
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

declare global {
  // eslint-disable-next-line no-var
  var __cmcQuotaGuard: QuotaGuard | undefined;
}

export function getQuotaGuard(): QuotaGuard {
  if (!globalThis.__cmcQuotaGuard) {
    globalThis.__cmcQuotaGuard = new QuotaGuard();
  }
  return globalThis.__cmcQuotaGuard;
}
