import { NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';

export const runtime     = 'nodejs';
export const maxDuration = 15;

const log = createLogger('api/health/providers');

interface ProviderStatus {
  name:      string;
  healthy:   boolean;
  latencyMs: number;
  error?:    string;
}

async function checkBinance(): Promise<ProviderStatus> {
  const t0 = Date.now();
  try {
    const r = await fetch('https://api.binance.com/api/v3/ping', {
      signal: AbortSignal.timeout(4000),
    });
    return { name: 'Binance', healthy: r.ok, latencyMs: Date.now() - t0 };
  } catch (e) {
    return { name: 'Binance', healthy: false, latencyMs: Date.now() - t0,
      error: e instanceof Error ? e.message : 'unreachable' };
  }
}

async function checkCoinGecko(): Promise<ProviderStatus> {
  const t0 = Date.now();
  try {
    const r = await fetch('https://api.coingecko.com/api/v3/ping', {
      signal: AbortSignal.timeout(4000),
    });
    return { name: 'CoinGecko', healthy: r.ok, latencyMs: Date.now() - t0 };
  } catch (e) {
    return { name: 'CoinGecko', healthy: false, latencyMs: Date.now() - t0,
      error: e instanceof Error ? e.message : 'unreachable' };
  }
}

async function checkRedis(): Promise<ProviderStatus> {
  const t0 = Date.now();
  try {
    const { getRedis } = await import('@/lib/redis');
    const client = getRedis();
    await Promise.race([
      client.ping(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
    ]);
    return { name: 'Redis', healthy: true, latencyMs: Date.now() - t0 };
  } catch (e) {
    return { name: 'Redis', healthy: false, latencyMs: Date.now() - t0,
      error: e instanceof Error ? e.message : 'connection failed' };
  }
}

async function checkSupabase(): Promise<ProviderStatus> {
  const t0  = Date.now();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    return { name: 'Supabase', healthy: false, latencyMs: 0, error: 'Not configured' };
  }
  try {
    const r = await fetch(`${url}/rest/v1/signals?select=id&limit=1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(4000),
    });
    return { name: 'Supabase', healthy: r.ok, latencyMs: Date.now() - t0 };
  } catch (e) {
    return { name: 'Supabase', healthy: false, latencyMs: Date.now() - t0,
      error: e instanceof Error ? e.message : 'unreachable' };
  }
}

export async function GET() {
  log.info('provider health check requested');

  const results = await Promise.allSettled([
    checkBinance(),
    checkCoinGecko(),
    checkRedis(),
    checkSupabase(),
  ]);

  const providers: ProviderStatus[] = results.map(r =>
    r.status === 'fulfilled'
      ? r.value
      : { name: 'unknown', healthy: false, latencyMs: 0, error: 'check threw' },
  );

  const allHealthy = providers.every(p => p.healthy);
  log.info({ allHealthy, providers: providers.map(p => ({ name: p.name, healthy: p.healthy, ms: p.latencyMs })) }, 'health check complete');

  return NextResponse.json({
    success:   true,
    healthy:   allHealthy,
    providers,
    checkedAt: new Date().toISOString(),
  });
}
