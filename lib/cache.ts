interface Entry<T> {
  value:     T;
  expiresAt: number;
  hits:      number;
}

export class Cache<T> {
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

  // getOrSet: fetch from cache or populate via loader
  async getOrSet(key: string, loader: () => Promise<T>, ttlMs?: number): Promise<T> {
    const cached = this.get(key);
    if (cached !== null) return cached;
    const value = await loader();
    this.set(key, value, ttlMs);
    return value;
  }

  private evict(): void {
    const now = Date.now();
    // Pass 1: remove expired
    this.store.forEach((e, k) => { if (e.expiresAt < now) this.store.delete(k); });
    if (this.store.size < this.maxSize) return;
    // Pass 2: remove least-hit entry
    let minHits = Infinity, minKey = '';
    this.store.forEach((e, k) => { if (e.hits < minHits) { minHits = e.hits; minKey = k; } });
    if (minKey) this.store.delete(minKey);
  }
}

// ─── Shared application caches ────────────────────────────────────────────────

export const coinsCache   = new Cache<unknown>('coins',    5 * 60_000, 10);
export const signalsCache = new Cache<unknown>('signals',      30_000,  5);
export const oiCache      = new Cache<unknown>('open-interest', 2 * 60_000, 200);
export const fundingCache = new Cache<unknown>('funding-rate',  5 * 60_000, 200);
export const lsCache      = new Cache<unknown>('long-short',    5 * 60_000, 200);

export function allCacheStats() {
  return [coinsCache, signalsCache, oiCache, fundingCache, lsCache].map(c => c.stats());
}
