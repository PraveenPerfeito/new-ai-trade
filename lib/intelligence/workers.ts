import { getRedis } from '@/lib/redis';
import { createLogger } from '@/lib/logger';
import { getQuotaGuard } from './quota-guard';
import { CACHE_GROUPS } from './cache-groups';
import {
  fetchListings,
  fetchGlobalMetrics,
  fetchTrending,
  fetchCategories,
  fetchMetadata,
  fetchKeyInfo,
} from './cmc-client';
import {
  normalizeListings,
  normalizeGlobal,
  normalizeTrending,
  normalizeCategories,
  normalizeMetadata,
} from './normalizer';
import { WorkerStatus, WorkerState } from './types';

const log = createLogger('lib/intelligence/workers');

// ─── Worker registry on globalThis ───────────────────────────────────────────

interface WorkerHandle {
  name:       string;
  intervalMs: number;
  timer:      ReturnType<typeof setInterval>;
  status:     WorkerStatus;
}

declare global {
  // eslint-disable-next-line no-var
  var __intelWorkers: Map<string, WorkerHandle> | undefined;
}

function getRegistry(): Map<string, WorkerHandle> {
  if (!globalThis.__intelWorkers) {
    globalThis.__intelWorkers = new Map();
  }
  return globalThis.__intelWorkers;
}

// ─── Generic worker factory ───────────────────────────────────────────────────

function makeStatus(name: string, intervalMs: number): WorkerStatus {
  return {
    name,
    intervalMs,
    lastTickAt:  null,
    nextTickAt:  new Date(Date.now() + intervalMs).toISOString(),
    lastError:   null,
    errorCount:  0,
    tickCount:   0,
    state:       'idle' as WorkerState,
  };
}

function registerWorker(
  name:       string,
  intervalMs: number,
  tick:       () => Promise<void>,
): void {
  const registry = getRegistry();

  // Skip if already registered (HMR safety)
  if (registry.has(name)) {
    log.debug({ name }, 'intel_worker_already_registered');
    return;
  }

  const status = makeStatus(name, intervalMs);

  const timer = setInterval(async () => {
    if (status.state === 'running') return; // skip overlap
    status.state     = 'running';
    status.lastTickAt = new Date().toISOString();
    try {
      await tick();
      status.tickCount++;
      status.lastError = null;
      status.state     = 'idle';
    } catch (err) {
      status.errorCount++;
      status.lastError = err instanceof Error ? err.message : String(err);
      status.state     = 'error';
      log.warn({ err, name }, 'intel_worker_tick_error');
    }
    status.nextTickAt = new Date(Date.now() + intervalMs).toISOString();
  }, intervalMs);

  // Allow Node.js to exit even if the timer is still pending
  if (timer.unref) timer.unref();

  registry.set(name, { name, intervalMs, timer, status });
  log.info({ name, intervalMs }, 'intel_worker_started');
}

// ─── Individual tick handlers ─────────────────────────────────────────────────

async function tickListings(): Promise<void> {
  const quota = getQuotaGuard();
  if (!(await quota.canConsume(1))) return;
  const raw  = await fetchListings(100);
  const snap = normalizeListings(raw);
  const redis = getRedis();
  await redis.set(CACHE_GROUPS.listings.redisKey, JSON.stringify(snap), 'PX', CACHE_GROUPS.listings.ttlMs * 2);
  await quota.consume(1);
  log.debug({ count: snap.coins.length }, 'worker_listings_refreshed');
}

async function tickGlobal(): Promise<void> {
  const quota = getQuotaGuard();
  if (!(await quota.canConsume(1))) return;
  const raw  = await fetchGlobalMetrics();
  const snap = normalizeGlobal(raw);
  const redis = getRedis();
  await redis.set(CACHE_GROUPS.global.redisKey, JSON.stringify(snap), 'PX', CACHE_GROUPS.global.ttlMs * 2);
  await quota.consume(1);
  log.debug('worker_global_refreshed');
}

async function tickTrending(): Promise<void> {
  const quota = getQuotaGuard();
  if (!(await quota.canConsume(1))) return;
  const raw  = await fetchTrending(20);
  const snap = normalizeTrending(raw);
  const redis = getRedis();
  await redis.set(CACHE_GROUPS.trending.redisKey, JSON.stringify(snap), 'PX', CACHE_GROUPS.trending.ttlMs * 2);
  await quota.consume(1);
  log.debug({ count: snap.trending.length }, 'worker_trending_refreshed');
}

async function tickCategories(): Promise<void> {
  const quota = getQuotaGuard();
  if (!(await quota.canConsume(1))) return;
  const raw  = await fetchCategories();
  const snap = normalizeCategories(raw);
  const redis = getRedis();
  await redis.set(CACHE_GROUPS.categories.redisKey, JSON.stringify(snap), 'PX', CACHE_GROUPS.categories.ttlMs * 2);
  await quota.consume(1);
  log.debug({ count: snap.categories.length }, 'worker_categories_refreshed');
}

async function tickMetadata(): Promise<void> {
  const quota = getQuotaGuard();
  if (!(await quota.canConsume(1))) return;

  // Fetch metadata for a fixed set of top symbols
  const TOP_SYMBOLS = [
    'BTC','ETH','BNB','SOL','XRP','DOGE','ADA','AVAX','LINK','SUI',
    'TON','SHIB','DOT','MATIC','LTC','UNI','ATOM','ICP','APT','ARB',
  ];
  const raw  = await fetchMetadata(TOP_SYMBOLS);
  const snap = normalizeMetadata(raw);
  const redis = getRedis();
  await redis.set(CACHE_GROUPS.metadata.redisKey, JSON.stringify(snap), 'PX', CACHE_GROUPS.metadata.ttlMs * 2);
  await quota.consume(1);
  log.debug({ count: Object.keys(snap.coins).length }, 'worker_metadata_refreshed');
}

async function tickQuotaSync(): Promise<void> {
  // Sync CMC credit usage from the API key info endpoint
  try {
    const info  = await fetchKeyInfo();
    const quota = getQuotaGuard();
    await quota.seedFromKeyInfo(info.credit_count_used);
    log.debug({ creditsUsed: info.credit_count_used }, 'worker_quota_synced');
  } catch (err) {
    log.warn({ err }, 'worker_quota_sync_failed');
  }
}

// ─── Public: start all workers ────────────────────────────────────────────────

export function startIntelligenceWorkers(): void {
  registerWorker('intel:listings',   CACHE_GROUPS.listings.ttlMs,   tickListings);
  registerWorker('intel:global',     CACHE_GROUPS.global.ttlMs,     tickGlobal);
  registerWorker('intel:trending',   CACHE_GROUPS.trending.ttlMs,   tickTrending);
  registerWorker('intel:categories', CACHE_GROUPS.categories.ttlMs, tickCategories);
  registerWorker('intel:metadata',   CACHE_GROUPS.metadata.ttlMs,   tickMetadata);
  registerWorker('intel:quota-sync', 15 * 60_000,                   tickQuotaSync); // every 15 min
}

export function stopIntelligenceWorkers(): void {
  const registry = getRegistry();
  for (const [name, handle] of Array.from(registry.entries())) {
    clearInterval(handle.timer);
    registry.delete(name);
    log.info({ name }, 'intel_worker_stopped');
  }
}

export function getWorkerStatuses(): WorkerStatus[] {
  return Array.from(getRegistry().values()).map((h) => h.status);
}
