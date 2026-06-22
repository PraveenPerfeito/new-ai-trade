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

async function checkWhatsApp(): Promise<ProviderStatus> {
  // WhatsApp alerts are sent from the Railway Python worker via UltraMsg.
  // Token presence = configured; delivery health covered by worker heartbeat check.
  const token = process.env.WHATSAPP_TOKEN
  if (!token) {
    return { name: 'WhatsApp', healthy: false, latencyMs: 0,
      note: 'not configured', error: 'WHATSAPP_TOKEN not set — alerts disabled' }
  }
  return { name: 'WhatsApp', healthy: true, latencyMs: 0, note: 'configured · delivery via Railway worker' }
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
      note: `worker alive · heartbeat ${ageMin}m ago` }
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

  const results = await Promise.allSettled([
    checkBinance(),
    checkCMC(),
    checkCoinGecko(),
    checkClaude(),
    checkWhatsApp(),
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

  _cache = { providers, ts: Date.now() }
  return NextResponse.json({ success: true, healthy: allHealthy, providers, checkedAt })
}
