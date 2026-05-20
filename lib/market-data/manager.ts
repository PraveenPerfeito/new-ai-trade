import { CoinData } from '@/types';
import { createLogger } from '@/lib/logger';
import { getRedis } from '@/lib/redis';
import { sendMessage } from '@/lib/telegram-send';
import { FailoverEvent, MarketDataProvider, ProviderHealth, ProviderName } from './types';
import { getProviderMetrics } from './metrics';

const log = createLogger('lib/market-data/manager');

const FAILOVER_LOG_KEY = 'providers:failover:log';
const CONFIG_KEY       = 'settings:d:providers';    // written by Python settings
const MAX_FAILOVER_LOG = 50;

// DeFi-only providers: their coins are sourced from DEX pools and most are NOT
// listed on Binance. The scanner calls getSpotKlines() for every coin — for
// unknown DeFi tokens this generates Binance 400/404 errors on every single coin.
// We gate these providers by filtering out zero-market-cap tokens (completely
// obscure coins) and any coin with a market cap below $10 M (too illiquid for
// the scanner's Binance-based pipeline).
const DEFI_PROVIDERS = new Set<ProviderName>(['dexscreener', 'geckoterm']);
const DEFI_MIN_MARKET_CAP = 10_000_000; // $10 M floor

export interface ProviderConfig {
  enabled: boolean;
  priority: number;
  quotaLimit: number;       // 0 = unlimited
  quotaResetAt: string | null;
}

export type ProviderConfigMap = Partial<Record<ProviderName, ProviderConfig>>;

const DEFAULT_CONFIG: Record<ProviderName, ProviderConfig> = {
  coingecko:     { enabled: true,  priority: 1, quotaLimit: 0,     quotaResetAt: null },
  coinmarketcap: { enabled: false, priority: 2, quotaLimit: 10000, quotaResetAt: null },
  binance:       { enabled: true,  priority: 3, quotaLimit: 0,     quotaResetAt: null },
  dexscreener:   { enabled: true,  priority: 4, quotaLimit: 0,     quotaResetAt: null },
  coinpaprika:   { enabled: true,  priority: 5, quotaLimit: 0,     quotaResetAt: null },
  geckoterm:     { enabled: true,  priority: 6, quotaLimit: 0,     quotaResetAt: null },
};

export class ProviderManager {
  private configs: Record<ProviderName, ProviderConfig>;

  constructor(private readonly providers: MarketDataProvider[]) {
    this.configs = { ...DEFAULT_CONFIG };
  }

  /** Reload config from Redis (written by Python settings service). */
  async syncConfig(): Promise<void> {
    try {
      const raw = await getRedis().get(CONFIG_KEY);
      if (!raw) return;
      const remote: ProviderConfigMap = JSON.parse(raw);
      for (const [name, cfg] of Object.entries(remote)) {
        if (this.configs[name as ProviderName] && cfg) {
          this.configs[name as ProviderName] = { ...this.configs[name as ProviderName], ...cfg };
        }
      }
    } catch (err) {
      log.warn({ err }, 'provider_config_sync_failed — using defaults');
    }
  }

  /** Fetch top coins with automatic failover through healthy providers. */
  async fetchTopCoins(limit = 100): Promise<{ coins: CoinData[]; provider: ProviderName; fromCache: boolean }> {
    await this.syncConfig();

    const ordered = this.orderedProviders();
    const enabledProviders = ordered.filter(p => this.configs[p.name].enabled);

    if (enabledProviders.length === 0) {
      await this.sendAllDegradedAlert('all providers disabled in config');
      throw new Error('No providers enabled — check provider configuration in admin panel');
    }

    let lastErr: unknown;
    let triedCount = 0;

    for (const provider of ordered) {
      const cfg = this.configs[provider.name];
      if (!cfg.enabled) continue;

      const metrics = getProviderMetrics(provider.name);
      const start = Date.now();
      triedCount++;

      try {
        let coins = await provider.fetchTopCoins(limit);
        const latency = Date.now() - start;
        await metrics.recordSuccess(latency);
        await metrics.incrementQuota();

        // DeFi provider gate: filter out zero/micro-cap coins that have no
        // Binance listing. The scanner will call getSpotKlines() for every coin —
        // unknown DeFi tokens produce a cascade of Binance 400s.
        if (DEFI_PROVIDERS.has(provider.name)) {
          const before = coins.length;
          coins = coins.filter(c => c.marketCap >= DEFI_MIN_MARKET_CAP);
          if (before !== coins.length) {
            log.info(
              { provider: provider.name, filtered: before - coins.length, remaining: coins.length },
              'defi_provider_micro_cap_filtered',
            );
          }
          if (coins.length === 0) {
            throw new Error(`DeFi provider ${provider.name} returned no coins above $10M market cap`);
          }
          log.warn(
            { provider: provider.name, coins: coins.length },
            'defi_provider_active — Binance klines may fail for unlisted tokens',
          );
        }

        return { coins, provider: provider.name, fromCache: false };
      } catch (err) {
        const latency = Date.now() - start;
        const msg = err instanceof Error ? err.message : String(err);
        log.warn({ provider: provider.name, latency, err: msg }, 'provider_fetch_failed — trying next');
        await metrics.recordError(msg);

        // Find the next enabled provider for failover logging
        const nextEnabledIdx = ordered.findIndex(
          (p, i) => i > ordered.indexOf(provider) && this.configs[p.name].enabled,
        );
        if (nextEnabledIdx !== -1) {
          await this.logFailover(provider.name, ordered[nextEnabledIdx].name, msg);
          await this.sendFailoverAlert(provider.name, ordered[nextEnabledIdx].name, msg);
        }
        lastErr = err;
      }
    }

    // All providers exhausted — fire critical alert
    await this.sendAllDegradedAlert(
      lastErr instanceof Error ? lastErr.message : String(lastErr),
    );
    throw new Error(`All providers failed. Last error: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
  }

  /** Get health status for all providers. */
  async getAllHealth(): Promise<ProviderHealth[]> {
    await this.syncConfig();
    return Promise.all(
      this.providers.map(p =>
        getProviderMetrics(p.name).getHealth(
          this.configs[p.name].enabled,
          this.configs[p.name].priority,
        ),
      ),
    );
  }

  /** Force failover: disable a provider and promote next healthy one. */
  async forceFailover(from: ProviderName): Promise<ProviderName | null> {
    this.configs[from].enabled = false;
    const health = await this.getAllHealth();
    const next = health
      .filter(h => h.enabled && h.name !== from && h.status !== 'offline' && h.status !== 'quota_exhausted')
      .sort((a, b) => a.priority - b.priority)[0];

    if (next) {
      await this.logFailover(from, next.name, 'manual_force_failover');
    }
    return next?.name ?? null;
  }

  /** Enable or disable a provider at runtime. */
  setEnabled(name: ProviderName, enabled: boolean): void {
    this.configs[name].enabled = enabled;
  }

  /** Set provider priority at runtime. */
  setPriority(name: ProviderName, priority: number): void {
    this.configs[name].priority = priority;
  }

  async getFailoverHistory(): Promise<FailoverEvent[]> {
    try {
      const raw = await getRedis().lrange(FAILOVER_LOG_KEY, 0, MAX_FAILOVER_LOG - 1);
      return raw.map(r => JSON.parse(r) as FailoverEvent);
    } catch {
      return [];
    }
  }

  async resetMetrics(name: ProviderName): Promise<void> {
    const redis = getRedis();
    await Promise.all([
      redis.del(`providers:metrics:${name}:latency`),
      redis.del(`providers:metrics:${name}:errors`),
      redis.del(`providers:metrics:${name}:meta`),
    ]);
  }

  private orderedProviders(): MarketDataProvider[] {
    return [...this.providers].sort(
      (a, b) =>
        (this.configs[a.name].priority ?? 99) - (this.configs[b.name].priority ?? 99),
    );
  }

  private async logFailover(from: ProviderName, to: ProviderName, reason: string): Promise<void> {
    const event: FailoverEvent = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      fromProvider: from,
      toProvider: to,
      reason: reason.slice(0, 200),
      occurredAt: new Date().toISOString(),
      durationMs: null,
      resolved: false,
    };
    try {
      const redis = getRedis();
      await redis.lpush(FAILOVER_LOG_KEY, JSON.stringify(event));
      await redis.ltrim(FAILOVER_LOG_KEY, 0, MAX_FAILOVER_LOG - 1);
    } catch {
      /* non-fatal */
    }
    log.warn({ from, to, reason }, 'provider_failover');
  }

  private async sendFailoverAlert(from: ProviderName, to: ProviderName, reason: string): Promise<void> {
    try {
      await sendMessage(
        `⚠️ <b>Provider Failover</b>\n` +
        `<b>From:</b> ${from}\n` +
        `<b>To:</b> ${to}\n` +
        `<b>Reason:</b> ${reason.slice(0, 150)}`,
      );
    } catch {
      /* non-fatal */
    }
  }

  private async sendAllDegradedAlert(reason: string): Promise<void> {
    log.error({ reason }, 'all_providers_degraded — market data unavailable');
    try {
      await sendMessage(
        `🚨 <b>CRITICAL: All Market Data Providers Failed</b>\n` +
        `No coin data can be fetched. Scanner will not produce signals.\n` +
        `<b>Last error:</b> ${reason.slice(0, 200)}\n` +
        `Check provider health in the admin panel.`,
      );
    } catch {
      /* non-fatal */
    }
  }
}
