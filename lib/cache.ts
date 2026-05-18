import { createLogger } from './logger';

const log = createLogger('lib/cache');

interface Entry<T> {
  value:     T;
  expiresAt: number;
  hits:      number;
}

// ─── In-memory fallback cache (used when Redis is unavailable) ────────────────

class MemoryCache<T> {
  private readonly store = new Map<string, Entry<T>>();
  private hitCount  = 0;
  private missCount = 0;

  constructor(
    readonly name:    string,
    readonly ttlMs:   number,
    private maxSize = 500,
  ) {}

  get(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) { this.missCount++; return null; }
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      this.missCount++;
      return null;
    }
    entry.hits++;
    this.hitCount++;
    return entry.value;
  }

  set(key: string, value: T, ttlMs?: number): void {
    if (this.store.size >= this.maxSize) this.evict();
    this.store.set(key, {
      value,
      expiresAt: Date.now() + (ttlMs ?? this.ttlMs),
      hits:      0,
    });
  }

  delete(key: string): void { this.store.delete(key); }
  clear(): void             { this.store.clear(); }
  get size(): number        { return this.store.size; }

  stats() {
    const total = this.hitCount + this.missCount;
    return {
      name:    this.name,
      size:    this.store.size,
      hits:    this.hitCount,
      misses:  this.missCount,
      hitRate: total > 0 ? Math.round((this.hitCount / total) * 1000) / 10 : 0,
    };
  }

  private evict(): void {
    const now = Date.now();
    this.store.forEach((e, k) => { if (e.expiresAt < now) this.store.delete(k); });
    if (this.store.size < this.maxSize) return;
    let minHits = Infinity, minKey = '';
    this.store.forEach((e, k) => { if (e.hits < minHits) { minHits = e.hits; minKey = k; } });
    if (minKey) this.store.delete(minKey);
  }
}

// ─── Unified cache class (Redis when available, in-memory fallback) ───────────

export class Cache<T> {
  private readonly mem: MemoryCache<T>;

  constructor(
    readonly name:    string,
    readonly ttlMs:   number,
    private maxSize = 500,
  ) {
    this.mem = new MemoryCache<T>(name, ttlMs, maxSize);
  }

  private get ttlSec(): number { return Math.ceil(this.ttlMs / 1000); }

  private redisKey(key: string): string { return `cache:${this.name}:${key}`; }

  private async redis() {
    try {
      const { getRedis } = await import('./redis');
      const client = getRedis();
      // Quick ping to verify connectivity; throws if not connected
      await client.ping();
      return client;
    } catch {
      return null;
    }
  }

  async get(key: string): Promise<T | null> {
    const r = await this.redis();
    if (r) {
      try {
        const raw = await r.get(this.redisKey(key));
        if (raw !== null) return JSON.parse(raw) as T;
        return null;
      } catch (err) {
        log.warn({ key, err }, 'redis get failed — falling back to memory');
      }
    }
    return this.mem.get(key);
  }

  async set(key: string, value: T, ttlMs?: number): Promise<void> {
    const r = await this.redis();
    if (r) {
      try {
        const ttl = Math.ceil((ttlMs ?? this.ttlMs) / 1000);
        await r.setex(this.redisKey(key), ttl, JSON.stringify(value));
        return;
      } catch (err) {
        log.warn({ key, err }, 'redis set failed — falling back to memory');
      }
    }
    this.mem.set(key, value, ttlMs);
  }

  async delete(key: string): Promise<void> {
    const r = await this.redis();
    if (r) {
      try { await r.del(this.redisKey(key)); return; } catch { /* fallthrough */ }
    }
    this.mem.delete(key);
  }

  async clear(): Promise<void> {
    const r = await this.redis();
    if (r) {
      try {
        const keys = await r.keys(this.redisKey('*'));
        if (keys.length) await r.del(...keys);
        return;
      } catch { /* fallthrough */ }
    }
    this.mem.clear();
  }

  stats() { return this.mem.stats(); }

  async getOrSet(key: string, loader: () => Promise<T>, ttlMs?: number): Promise<T> {
    const cached = await this.get(key);
    if (cached !== null) return cached;
    const value = await loader();
    await this.set(key, value, ttlMs);
    return value;
  }
}

// ─── Shared application caches ────────────────────────────────────────────────

export const coinsCache   = new Cache<unknown>('coins',        5 * 60_000, 10);
export const signalsCache = new Cache<unknown>('signals',          30_000,  5);
export const oiCache      = new Cache<unknown>('open-interest', 2 * 60_000, 200);
export const fundingCache = new Cache<unknown>('funding-rate',  5 * 60_000, 200);
export const lsCache      = new Cache<unknown>('long-short',    5 * 60_000, 200);

export function allCacheStats() {
  return [coinsCache, signalsCache, oiCache, fundingCache, lsCache].map(c => c.stats());
}
