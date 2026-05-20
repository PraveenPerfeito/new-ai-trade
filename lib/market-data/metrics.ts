import { getRedis } from '@/lib/redis';
import { ProviderHealth, ProviderName, ProviderStatus, QuotaInfo } from './types';

const LATENCY_WINDOW = 100;  // keep last N latency samples
const ERROR_WINDOW   = 100;  // keep last N error timestamps
const KEY_PREFIX     = 'providers:metrics:';

function key(name: ProviderName, field: string): string {
  return `${KEY_PREFIX}${name}:${field}`;
}

export class ProviderMetrics {
  constructor(private readonly name: ProviderName) {}

  async recordSuccess(latencyMs: number): Promise<void> {
    const redis = getRedis();
    const now = Date.now();
    await redis
      .multi()
      .lpush(key(this.name, 'latency'), latencyMs)
      .ltrim(key(this.name, 'latency'), 0, LATENCY_WINDOW - 1)
      .hset(key(this.name, 'meta'), 'lastSuccess', new Date(now).toISOString())
      .hincrby(key(this.name, 'meta'), 'requestsToday', 1)
      .hincrby(key(this.name, 'meta'), 'requestsTotal', 1)
      .exec();
  }

  async recordError(errorMsg: string): Promise<void> {
    const redis = getRedis();
    const now = Date.now();
    await redis
      .multi()
      .lpush(key(this.name, 'errors'), now)
      .ltrim(key(this.name, 'errors'), 0, ERROR_WINDOW - 1)
      .hset(key(this.name, 'meta'), 'lastError', errorMsg.slice(0, 200))
      .hincrby(key(this.name, 'meta'), 'errorCount', 1)
      .exec();
  }

  async incrementQuota(n = 1): Promise<void> {
    await getRedis().hincrby(key(this.name, 'quota'), 'used', n);
  }

  async setQuotaLimit(limit: number, resetAt: string | null): Promise<void> {
    const redis = getRedis();
    await redis.hset(key(this.name, 'quota'), {
      dailyLimit: limit,
      resetAt: resetAt ?? '',
    });
  }

  async resetDailyCounters(): Promise<void> {
    const redis = getRedis();
    await redis
      .multi()
      .hset(key(this.name, 'quota'), 'used', 0)
      .hset(key(this.name, 'meta'), 'requestsToday', 0)
      .exec();
  }

  async getHealth(enabled: boolean, priority: number): Promise<ProviderHealth> {
    const redis = getRedis();

    const [meta, quotaRaw, latencyRaw, errorTimestamps] = await Promise.all([
      redis.hgetall(key(this.name, 'meta')),
      redis.hgetall(key(this.name, 'quota')),
      redis.lrange(key(this.name, 'latency'), 0, LATENCY_WINDOW - 1),
      redis.lrange(key(this.name, 'errors'), 0, ERROR_WINDOW - 1),
    ]);

    // Latency: p95 of the ring buffer
    const latencies = latencyRaw.map(Number).filter(Boolean);
    const p95 = latencies.length > 0
      ? sorted(latencies)[Math.floor(latencies.length * 0.95)]
      : 0;

    // Error rate: errors in the last 5 minutes vs total recent requests
    const fiveMinAgo = Date.now() - 5 * 60 * 1000;
    const recentErrors = errorTimestamps.map(Number).filter(t => t > fiveMinAgo).length;
    const requestsToday = Number(meta?.requestsToday ?? 0);
    const errorRate = requestsToday > 0
      ? Math.min(recentErrors / Math.max(requestsToday, recentErrors + 1), 1)
      : 0;

    // Quota
    const dailyLimit = Number(quotaRaw?.dailyLimit ?? 0);
    const used = Number(quotaRaw?.used ?? 0);
    const remaining = Math.max(dailyLimit - used, 0);
    const pct = dailyLimit > 0 ? Math.min((used / dailyLimit) * 100, 100) : 0;
    const quota: QuotaInfo = {
      dailyLimit,
      used,
      remaining: dailyLimit > 0 ? remaining : -1,  // -1 = unlimited
      resetAt: quotaRaw?.resetAt || null,
      pct,
    };

    // Health score: start at 100, subtract penalties
    let healthScore = 100;
    healthScore -= Math.min(errorRate * 50, 50);           // error penalty 0-50
    healthScore -= p95 > 5000 ? 20 : p95 > 2000 ? 10 : 0; // latency penalty
    healthScore -= pct > 90 ? 20 : pct > 75 ? 10 : 0;     // quota penalty
    if (!enabled) healthScore = 0;
    healthScore = Math.max(0, Math.round(healthScore));

    // Status
    let status: ProviderStatus = 'healthy';
    if (!enabled) status = 'offline';
    else if (dailyLimit > 0 && remaining === 0) status = 'quota_exhausted';
    else if (healthScore < 40) status = 'offline';
    else if (healthScore < 70) status = 'degraded';

    return {
      name: this.name,
      status,
      healthScore,
      latencyMs: Math.round(p95),
      errorRate,
      requestsToday,
      quota,
      lastSuccess: meta?.lastSuccess ?? null,
      lastError: meta?.lastError ?? null,
      enabled,
      priority,
    };
  }
}

function sorted(arr: number[]): number[] {
  return [...arr].sort((a, b) => a - b);
}

/** Singleton registry so managers share the same metric instances. */
const _registry = new Map<ProviderName, ProviderMetrics>();

export function getProviderMetrics(name: ProviderName): ProviderMetrics {
  if (!_registry.has(name)) {
    _registry.set(name, new ProviderMetrics(name));
  }
  return _registry.get(name)!;
}
