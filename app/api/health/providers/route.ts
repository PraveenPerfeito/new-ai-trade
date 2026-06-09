import { NextResponse } from 'next/server'
import { createLogger } from '@/lib/logger'

export const runtime     = 'nodejs'
export const maxDuration = 15
export const dynamic     = 'force-dynamic'

const log = createLogger('api/health/providers')

export interface ProviderStatus {
  name:      string
  healthy:   boolean
  latencyMs: number
  note?:     string
  error?:    string
}

// ── Individual checks ──────────────────────────────────────────────────────────

async function checkBinance(): Promise<ProviderStatus> {
  const t0 = Date.now()
  try {
    const r = await fetch('https://api.binance.com/api/v3/ping', { signal: AbortSignal.timeout(4000) })
    return { name: 'Binance', healthy: r.ok, latencyMs: Date.now() - t0 }
  } catch (e) {
    return { name: 'Binance', healthy: false, latencyMs: Date.now() - t0,
      error: e instanceof Error ? e.message : 'unreachable' }
  }
}

async function checkCoinGecko(): Promise<ProviderStatus> {
  const t0 = Date.now()
  try {
    const r = await fetch('https://api.coingecko.com/api/v3/ping', { signal: AbortSignal.timeout(4000) })
    return { name: 'CoinGecko', healthy: r.ok, latencyMs: Date.now() - t0 }
  } catch (e) {
    return { name: 'CoinGecko', healthy: false, latencyMs: Date.now() - t0,
      error: e instanceof Error ? e.message : 'unreachable' }
  }
}

async function checkCMC(): Promise<ProviderStatus> {
  // CMC health = Redis intelligence cache is populated and fresh (< 10 min old).
  // A stale/missing cache means the TypeScript intelligence worker hasn't run
  // (or CMC API is down). We don't make live CMC API calls from here to
  // avoid burning quota on health checks.
  const t0 = Date.now()
  try {
    const { getRedis } = await import('@/lib/redis')
    const redis = getRedis()
    const ttl = await Promise.race([
      redis.ttl('cache:intel:listings'),
      new Promise<number>((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000)),
    ]) as number
    const latencyMs = Date.now() - t0
    // TTL > 0 means key exists; typical TTL is 300s (5 min); -1 = no TTL set; -2 = missing
    if (ttl === -2) {
      return { name: 'CMC', healthy: false, latencyMs, note: 'cache cold', error: 'Intelligence cache empty — worker may not have run yet' }
    }
    if (ttl === -1 || ttl > 600) {
      return { name: 'CMC', healthy: true, latencyMs, note: 'cache warm (no TTL)' }
    }
    // ttl > 0 — key present and expiring normally
    const ageSeconds = 300 - ttl  // 300s = 5-min TTL; negative if TTL > 300s
    const ageMin = Math.max(0, Math.round(ageSeconds / 60))
    return { name: 'CMC', healthy: true, latencyMs, note: `cache ${ageMin}m old` }
  } catch (e) {
    return { name: 'CMC', healthy: false, latencyMs: Date.now() - t0,
      error: e instanceof Error ? e.message : 'cache check failed' }
  }
}

async function checkClaude(): Promise<ProviderStatus> {
  // Claude health = Anthropic API key is configured + api.anthropic.com reachable.
  // We do NOT make a paid API call here — just TCP reachability + key presence.
  const t0 = Date.now()
  const hasKey = !!process.env.ANTHROPIC_API_KEY
  if (!hasKey) {
    return { name: 'Claude', healthy: false, latencyMs: 0,
      note: 'key missing', error: 'ANTHROPIC_API_KEY not set — heuristic fallback active' }
  }
  try {
    const r = await fetch('https://api.anthropic.com', { method: 'HEAD', signal: AbortSignal.timeout(4000) })
    // Anthropic returns 404 on HEAD / — that still means the host is reachable
    const reachable = r.status < 500
    return { name: 'Claude', healthy: reachable, latencyMs: Date.now() - t0,
      note: reachable ? 'key set · reachable' : 'host unreachable' }
  } catch (e) {
    return { name: 'Claude', healthy: false, latencyMs: Date.now() - t0,
      error: e instanceof Error ? e.message : 'unreachable' }
  }
}

async function checkTelegram(): Promise<ProviderStatus> {
  const t0 = Date.now()
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) {
    return { name: 'Telegram', healthy: false, latencyMs: 0,
      note: 'not configured', error: 'TELEGRAM_BOT_TOKEN not set — alerts disabled' }
  }
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/getMe`, { signal: AbortSignal.timeout(4000) })
    const json = await r.json() as { ok: boolean; result?: { username?: string } }
    const latencyMs = Date.now() - t0
    if (json.ok) {
      return { name: 'Telegram', healthy: true, latencyMs, note: json.result?.username ? `@${json.result.username}` : 'bot ok' }
    }
    return { name: 'Telegram', healthy: false, latencyMs, error: 'Telegram API returned ok=false' }
  } catch (e) {
    return { name: 'Telegram', healthy: false, latencyMs: Date.now() - t0,
      error: e instanceof Error ? e.message : 'unreachable' }
  }
}

async function checkSupabase(): Promise<ProviderStatus> {
  const t0  = Date.now()
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) {
    return { name: 'Supabase', healthy: false, latencyMs: 0, error: 'Not configured' }
  }
  try {
    const r = await fetch(`${url}/rest/v1/signals?select=id&limit=1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(4000),
    })
    return { name: 'Supabase', healthy: r.ok, latencyMs: Date.now() - t0 }
  } catch (e) {
    return { name: 'Supabase', healthy: false, latencyMs: Date.now() - t0,
      error: e instanceof Error ? e.message : 'unreachable' }
  }
}

async function checkRedis(): Promise<ProviderStatus> {
  const t0 = Date.now()
  try {
    const { getRedis } = await import('@/lib/redis')
    const client = getRedis()
    await Promise.race([
      client.ping(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
    ])
    return { name: 'Redis', healthy: true, latencyMs: Date.now() - t0 }
  } catch (e) {
    return { name: 'Redis', healthy: false, latencyMs: Date.now() - t0,
      error: e instanceof Error ? e.message : 'connection failed' }
  }
}

async function checkCloudAMQP(): Promise<ProviderStatus> {
  // CloudAMQP health is inferred from the Celery worker heartbeat key.
  // The worker writes `celery:worker:last_heartbeat` (TTL 300s) every 60s via
  // the beat task. If the key exists and is fresh the broker is passing messages.
  // We cannot open a raw AMQP connection from a serverless Next.js route.
  const t0 = Date.now()
  const brokerConfigured = !!process.env.CELERY_BROKER_URL
  if (!brokerConfigured) {
    return { name: 'CloudAMQP', healthy: false, latencyMs: 0,
      note: 'not configured', error: 'CELERY_BROKER_URL not set' }
  }
  try {
    const { getRedis } = await import('@/lib/redis')
    const redis = getRedis()
    const [ttl] = await Promise.race([
      Promise.all([redis.ttl('celery:worker:last_heartbeat')]),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000)),
    ]) as [number]
    const latencyMs = Date.now() - t0
    if (ttl === -2) {
      // Key absent — worker has not written a heartbeat yet (startup) or is dead
      return { name: 'CloudAMQP', healthy: false, latencyMs,
        note: 'no heartbeat', error: 'Celery worker heartbeat missing — worker may be down or just starting up' }
    }
    // Key present → worker alive, AMQP broker is delivering messages
    const ageSeconds = 300 - ttl  // TTL starts at 300
    const ageMin = Math.max(0, Math.round(ageSeconds / 60))
    return { name: 'CloudAMQP', healthy: true, latencyMs,
      note: `worker heartbeat ${ageMin}m ago` }
  } catch (e) {
    return { name: 'CloudAMQP', healthy: false, latencyMs: Date.now() - t0,
      error: e instanceof Error ? e.message : 'check failed' }
  }
}

// ── Route handler ──────────────────────────────────────────────────────────────

export async function GET() {
  log.info('8-provider health check requested')

  const results = await Promise.allSettled([
    checkBinance(),
    checkCMC(),
    checkCoinGecko(),
    checkClaude(),
    checkTelegram(),
    checkSupabase(),
    checkRedis(),
    checkCloudAMQP(),
  ])

  const providers: ProviderStatus[] = results.map(r =>
    r.status === 'fulfilled'
      ? r.value
      : { name: 'unknown', healthy: false, latencyMs: 0, error: 'check threw' },
  )

  const allHealthy = providers.every(p => p.healthy)
  const checkedAt  = new Date().toISOString()

  log.info(
    { allHealthy, providers: providers.map(p => ({ name: p.name, healthy: p.healthy, ms: p.latencyMs })) },
    'health check complete',
  )

  return NextResponse.json({ success: true, healthy: allHealthy, providers, checkedAt })
}
