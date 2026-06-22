import { NextResponse } from 'next/server'
import { createLogger } from '@/lib/logger'

export const runtime     = 'nodejs'
export const maxDuration = 15
export const dynamic     = 'force-dynamic'

const log = createLogger('api/health/providers')

// In-process cache — avoids Redis TTL calls on every dashboard poll
let _cache: { providers: ProviderStatus[]; ts: number } | null = null
const MEM_TTL_MS = 300_000  // 300s > 120s poll — cache stays warm between polls, eliminating Redis reads

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
  const endpoint = 'https://api.binance.com/api/v3/ping'
  try {
    const r = await fetch(endpoint, { signal: AbortSignal.timeout(4000) })
    const latencyMs = Date.now() - t0
    log.info({ endpoint, http_status: r.status, latency_ms: latencyMs }, 'binance_health_check')
    if (!r.ok) {
      // fetch() resolves (not throws) for 4xx/5xx — r.ok is false, latency is real.
      // HTTP 451: Binance geo-restricts certain cloud regions (Vercel IPs).
      // The Python scanner on Railway is unaffected — it reaches Binance directly.
      const geoBlock = r.status === 451 || r.status === 403
      return {
        name: 'Binance',
        healthy: false,
        latencyMs,
        error: `HTTP ${r.status}${geoBlock ? ' — geo-restricted from Vercel region; scanner on Railway unaffected' : ''}`,
      }
    }
    return { name: 'Binance', healthy: true, latencyMs }
  } catch (e) {
    const latencyMs = Date.now() - t0
    const reason = e instanceof Error ? e.message : 'unreachable'
    log.info({ endpoint, latency_ms: latencyMs, failure_reason: reason }, 'binance_health_check_failed')
    return { name: 'Binance', healthy: false, latencyMs, error: reason }
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
    // ttl > 0 — key present and expiring normally; show remaining TTL directly
    const ttlMin = Math.round(ttl / 60)
    return { name: 'CMC', healthy: true, latencyMs, note: `cache warm · ~${ttlMin}m TTL left` }
  } catch (e) {
    return { name: 'CMC', healthy: false, latencyMs: Date.now() - t0,
      error: e instanceof Error ? e.message : 'cache check failed' }
  }
}

async function checkBackendConfigured(): Promise<{ claude: ProviderStatus; whatsapp: ProviderStatus }> {
  // ANTHROPIC_API_KEY and WHATSAPP_TOKEN live in Railway env, not Vercel.
  // Proxy to the Python backend /health/ready which reports both as checks.anthropic / checks.whatsapp.
  const backendUrl = process.env.BACKEND_URL
  if (!backendUrl) {
    const err = 'BACKEND_URL not set in Vercel env'
    return {
      claude:   { name: 'Claude',   healthy: false, latencyMs: 0, error: err },
      whatsapp: { name: 'WhatsApp', healthy: false, latencyMs: 0, error: err },
    }
  }
  const t0 = Date.now()
  try {
    const r = await fetch(`${backendUrl}/health/ready`, { signal: AbortSignal.timeout(5000) })
    const data = await r.json() as { checks?: Record<string, string> }
    const latencyMs = Date.now() - t0
    const c = data.checks ?? {}
    const claudeOk = c.anthropic === 'configured'
    const waOk     = c.whatsapp  === 'configured'
    return {
      claude: {
        name: 'Claude',
        healthy: claudeOk,
        latencyMs,
        note: claudeOk ? 'key set · Railway' : 'key missing · Railway',
        ...(!claudeOk && { error: 'ANTHROPIC_API_KEY not set in Railway env' }),
      },
      whatsapp: {
        name: 'WhatsApp',
        healthy: waOk,
        latencyMs,
        note: waOk ? 'configured · delivery via Railway' : 'not configured',
        ...(!waOk && { error: 'WHATSAPP_TOKEN / WHATSAPP_API_URL / WHATSAPP_PHONE not set in Railway' }),
      },
    }
  } catch (e) {
    const latencyMs = Date.now() - t0
    const msg = e instanceof Error ? e.message : 'backend unreachable'
    log.warn({ error: msg }, 'backend_health_proxy_failed')
    return {
      claude:   { name: 'Claude',   healthy: false, latencyMs, error: `backend unreachable: ${msg}` },
      whatsapp: { name: 'WhatsApp', healthy: false, latencyMs, error: `backend unreachable: ${msg}` },
    }
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
  // CloudAMQP health = Celery worker heartbeat key in Redis.
  // The worker writes `celery:worker:last_heartbeat` (TTL 1800s) every 600s.
  // Key present → worker alive → broker delivering messages.
  //
  // NOTE: CELERY_BROKER_URL is a Railway/Python environment variable and is
  // intentionally NOT present in Next.js / Vercel. Do NOT gate on it here —
  // the heartbeat key is the authoritative health signal regardless of broker type.
  const t0 = Date.now()
  try {
    const { getRedis } = await import('@/lib/redis')
    const redis = getRedis()
    const ttl = await Promise.race([
      redis.ttl('celery:worker:last_heartbeat'),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000)),
    ]) as number
    const latencyMs = Date.now() - t0
    // broker_exists reflects whether CELERY_BROKER_URL is set in Next.js env.
    // It will be false on Vercel (Railway var) — that is expected and not an error.
    const brokerHost = (() => {
      try { const u = process.env.CELERY_BROKER_URL; return u ? new URL(u).hostname : null } catch { return null }
    })()
    log.info({ broker_host: brokerHost, heartbeat_ttl: ttl, worker_alive: ttl !== -2 }, 'cloudamqp_health_check')
    if (ttl === -2) {
      return { name: 'CloudAMQP', healthy: false, latencyMs,
        note: 'no heartbeat', error: 'Celery worker heartbeat missing — worker may be down or starting up' }
    }
    // TTL starts at 1800s (OPS.CONSOLIDATION.1), refreshed every 600s
    const ageSeconds = Math.max(0, 1800 - ttl)
    const ageMin = Math.round(ageSeconds / 60)
    return { name: 'CloudAMQP', healthy: true, latencyMs,
      note: `worker alive · ~${ageMin}m ago (TTL-est.)` }
  } catch (e) {
    return { name: 'CloudAMQP', healthy: false, latencyMs: Date.now() - t0,
      error: e instanceof Error ? e.message : 'check failed' }
  }
}

// ── Route handler ──────────────────────────────────────────────────────────────

export async function GET() {
  if (_cache && Date.now() - _cache.ts < MEM_TTL_MS) {
    return NextResponse.json({ success: true, providers: _cache.providers, cached: true })
  }

  log.info('8-provider health check requested')

  const [binance, cmc, coingecko, backendKeys, supabase, redis, cloudamqp] = await Promise.allSettled([
    checkBinance(),
    checkCMC(),
    checkCoinGecko(),
    checkBackendConfigured(),
    checkSupabase(),
    checkRedis(),
    checkCloudAMQP(),
  ])

  const bk = backendKeys.status === 'fulfilled'
    ? backendKeys.value
    : {
        claude:   { name: 'Claude',   healthy: false, latencyMs: 0, error: 'check threw' } as ProviderStatus,
        whatsapp: { name: 'WhatsApp', healthy: false, latencyMs: 0, error: 'check threw' } as ProviderStatus,
      }

  const providers: ProviderStatus[] = [
    binance.status   === 'fulfilled' ? binance.value   : { name: 'Binance',   healthy: false, latencyMs: 0, error: 'check threw' },
    cmc.status       === 'fulfilled' ? cmc.value       : { name: 'CMC',       healthy: false, latencyMs: 0, error: 'check threw' },
    coingecko.status === 'fulfilled' ? coingecko.value : { name: 'CoinGecko', healthy: false, latencyMs: 0, error: 'check threw' },
    bk.claude,
    bk.whatsapp,
    supabase.status  === 'fulfilled' ? supabase.value  : { name: 'Supabase',  healthy: false, latencyMs: 0, error: 'check threw' },
    redis.status     === 'fulfilled' ? redis.value     : { name: 'Redis',     healthy: false, latencyMs: 0, error: 'check threw' },
    cloudamqp.status === 'fulfilled' ? cloudamqp.value : { name: 'CloudAMQP', healthy: false, latencyMs: 0, error: 'check threw' },
  ]

  const allHealthy = providers.every(p => p.healthy)
  const checkedAt  = new Date().toISOString()

  log.info(
    { allHealthy, providers: providers.map(p => ({ name: p.name, healthy: p.healthy, ms: p.latencyMs })) },
    'health check complete',
  )

  _cache = { providers, ts: Date.now() }
  return NextResponse.json({ success: true, healthy: allHealthy, providers, checkedAt })
}
