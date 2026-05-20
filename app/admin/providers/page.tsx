'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Server, Activity, AlertTriangle, CheckCircle2,
  RefreshCw, Zap, ToggleLeft, ToggleRight, Trash2,
  RotateCcw, ChevronDown, ChevronUp, Clock, WifiOff,
} from 'lucide-react'
import { adminApi, ProviderHealth, ProviderName, FailoverEvent } from '@/lib/admin-api'

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatRelative(iso: string | null): string {
  if (!iso) return 'never'
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60_000)         return 'just now'
  if (diff < 3_600_000)      return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000)     return `${Math.floor(diff / 3_600_000)}h ago`
  return new Date(iso).toLocaleDateString()
}

function statusColor(status: string): string {
  switch (status) {
    case 'healthy':         return 'text-emerald-400'
    case 'degraded':        return 'text-yellow-400'
    case 'offline':         return 'text-slate-500'
    case 'quota_exhausted': return 'text-orange-400'
    default:                return 'text-slate-400'
  }
}

function statusBg(status: string): string {
  switch (status) {
    case 'healthy':         return 'bg-emerald-500/10 border-emerald-500/30'
    case 'degraded':        return 'bg-yellow-500/10 border-yellow-500/30'
    case 'offline':         return 'bg-slate-700/50 border-slate-600/30'
    case 'quota_exhausted': return 'bg-orange-500/10 border-orange-500/30'
    default:                return 'bg-slate-700/50 border-slate-600/30'
  }
}

function healthBar(score: number): string {
  if (score >= 80) return 'bg-emerald-500'
  if (score >= 60) return 'bg-yellow-500'
  if (score >= 40) return 'bg-orange-500'
  return 'bg-red-500'
}

function quotaBar(pct: number): string {
  if (pct >= 90) return 'bg-red-500'
  if (pct >= 75) return 'bg-orange-500'
  if (pct >= 50) return 'bg-yellow-500'
  return 'bg-emerald-500'
}

const PROVIDER_LABELS: Record<string, string> = {
  coingecko:     'CoinGecko',
  coinmarketcap: 'CoinMarketCap',
  binance:       'Binance',
  dexscreener:   'DexScreener',
  coinpaprika:   'CoinPaprika',
  geckoterm:     'GeckoTerminal',
}

const PROVIDER_FREE: Record<string, boolean> = {
  coingecko: true, coinmarketcap: false, binance: true,
  dexscreener: true, coinpaprika: true, geckoterm: true,
}

// ── Provider Card ─────────────────────────────────────────────────────────────

function ProviderCard({
  provider,
  onToggle,
  onForceFailover,
  onResetMetrics,
  loading,
}: {
  provider: ProviderHealth
  onToggle: (name: ProviderName, enabled: boolean) => void
  onForceFailover: (name: ProviderName) => void
  onResetMetrics: (name: ProviderName) => void
  loading: boolean
}) {
  const [expanded, setExpanded] = useState(false)

  const quotaPct = provider.quota.dailyLimit > 0 ? provider.quota.pct : 0

  return (
    <div className={`border rounded-xl overflow-hidden transition-all ${statusBg(provider.status)}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex-shrink-0">
            <Server className={`w-4 h-4 ${statusColor(provider.status)}`} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm font-semibold text-white">
                {PROVIDER_LABELS[provider.name] ?? provider.name}
              </span>
              {PROVIDER_FREE[provider.name] && (
                <span className="text-xs px-1.5 py-0.5 bg-slate-700 text-slate-400 rounded">free</span>
              )}
              <span className={`text-xs font-medium capitalize ${statusColor(provider.status)}`}>
                {provider.status.replace('_', ' ')}
              </span>
            </div>
            <div className="text-xs text-slate-500 mt-0.5">
              Priority {provider.priority} · {provider.requestsToday.toLocaleString()} req today
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Health score ring */}
          <div className="text-right hidden sm:block">
            <div className={`text-lg font-bold font-mono ${
              provider.healthScore >= 80 ? 'text-emerald-400' :
              provider.healthScore >= 60 ? 'text-yellow-400' :
              provider.healthScore >= 40 ? 'text-orange-400' : 'text-red-400'
            }`}>
              {provider.healthScore}
            </div>
            <div className="text-xs text-slate-500 -mt-0.5">health</div>
          </div>

          {/* Toggle */}
          <button
            onClick={() => onToggle(provider.name, !provider.enabled)}
            disabled={loading}
            className="text-slate-400 hover:text-white transition-colors disabled:opacity-50"
            title={provider.enabled ? 'Disable provider' : 'Enable provider'}
          >
            {provider.enabled
              ? <ToggleRight className="w-6 h-6 text-emerald-400" />
              : <ToggleLeft  className="w-6 h-6 text-slate-500"   />
            }
          </button>

          {/* Expand */}
          <button
            onClick={() => setExpanded(e => !e)}
            className="text-slate-500 hover:text-slate-300 transition-colors"
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Metrics row */}
      <div className="px-4 pb-3 grid grid-cols-3 gap-3 text-center">
        <div>
          <div className="text-xs text-slate-500 mb-1">Latency p95</div>
          <div className={`text-sm font-mono font-semibold ${
            provider.latencyMs > 5000 ? 'text-red-400' :
            provider.latencyMs > 2000 ? 'text-yellow-400' : 'text-emerald-400'
          }`}>
            {provider.latencyMs > 0 ? `${provider.latencyMs}ms` : '—'}
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500 mb-1">Error Rate</div>
          <div className={`text-sm font-mono font-semibold ${
            provider.errorRate > 0.15 ? 'text-red-400' :
            provider.errorRate > 0.05 ? 'text-yellow-400' : 'text-emerald-400'
          }`}>
            {(provider.errorRate * 100).toFixed(1)}%
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500 mb-1">Last OK</div>
          <div className="text-sm font-mono text-slate-300">
            {formatRelative(provider.lastSuccess)}
          </div>
        </div>
      </div>

      {/* Health bar */}
      <div className="px-4 pb-2">
        <div className="h-1 bg-slate-700 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${healthBar(provider.healthScore)}`}
            style={{ width: `${provider.healthScore}%` }}
          />
        </div>
      </div>

      {/* Quota bar (only for providers with quotas) */}
      {provider.quota.dailyLimit > 0 && (
        <div className="px-4 pb-3">
          <div className="flex justify-between text-xs text-slate-500 mb-1">
            <span>Quota {provider.quota.used.toLocaleString()} / {provider.quota.dailyLimit.toLocaleString()}</span>
            <span>{quotaPct.toFixed(0)}%</span>
          </div>
          <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${quotaBar(quotaPct)}`}
              style={{ width: `${Math.min(quotaPct, 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* Expanded panel */}
      {expanded && (
        <div className="border-t border-white/5 px-4 py-3 space-y-3">
          {provider.lastError && (
            <div className="text-xs text-red-400 bg-red-900/20 rounded px-2 py-1.5 font-mono break-all">
              Last error: {provider.lastError}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => onForceFailover(provider.name)}
              disabled={loading || !provider.enabled}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-orange-500/10 hover:bg-orange-500/20 text-orange-400 border border-orange-500/30 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Zap className="w-3 h-3" />
              Force Failover
            </button>
            <button
              onClick={() => onResetMetrics(provider.name)}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-slate-700/50 hover:bg-slate-700 text-slate-400 hover:text-white border border-slate-600/50 rounded-lg transition-colors disabled:opacity-40"
            >
              <RotateCcw className="w-3 h-3" />
              Reset Metrics
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Failover History ──────────────────────────────────────────────────────────

function FailoverHistory({ events }: { events: FailoverEvent[] }) {
  if (events.length === 0) {
    return (
      <div className="text-center py-8 text-slate-500">
        <CheckCircle2 className="w-8 h-8 mx-auto mb-2 opacity-30" />
        <p className="text-sm">No failover events recorded.</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {events.map(e => (
        <div key={e.id} className="flex items-start gap-3 px-3 py-2.5 bg-slate-800/50 rounded-lg border border-white/5">
          <AlertTriangle className="w-3.5 h-3.5 text-orange-400 flex-shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <div className="text-xs text-slate-300">
              <span className="text-orange-400 font-mono">{PROVIDER_LABELS[e.fromProvider] ?? e.fromProvider}</span>
              {' → '}
              <span className="text-emerald-400 font-mono">
                {e.toProvider === 'auto' ? 'auto' : (PROVIDER_LABELS[e.toProvider] ?? e.toProvider)}
              </span>
            </div>
            <div className="text-xs text-slate-500 mt-0.5 truncate">
              {e.reason.replace('_', ' ')} · {formatRelative(e.occurredAt)}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ProvidersPage() {
  const [providers, setProviders] = useState<ProviderHealth[]>([])
  const [failoverLog, setFailoverLog] = useState<FailoverEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3000)
  }

  const load = useCallback(async () => {
    try {
      const [provRes, logRes] = await Promise.all([
        adminApi.providers.list(),
        adminApi.providers.failoverHistory(),
      ])
      setProviders(provRes.providers)
      setFailoverLog(logRes.events)
      setLastRefresh(new Date())
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load provider data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Auto-refresh every 30 seconds
  useEffect(() => {
    const t = setInterval(load, 30_000)
    return () => clearInterval(t)
  }, [load])

  const withAction = async (fn: () => Promise<void>, msg: string) => {
    setActionLoading(true)
    try {
      await fn()
      showToast(msg)
      await load()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Action failed', false)
    } finally {
      setActionLoading(false)
    }
  }

  const handleToggle = (name: ProviderName, enabled: boolean) =>
    withAction(
      async () => { await (enabled ? adminApi.providers.enable(name) : adminApi.providers.disable(name)) },
      `${PROVIDER_LABELS[name]} ${enabled ? 'enabled' : 'disabled'}`,
    )

  const handleForceFailover = (name: ProviderName) =>
    withAction(
      async () => { await adminApi.providers.forceFailover(name) },
      `Failover triggered — ${PROVIDER_LABELS[name]} disabled`,
    )

  const handleResetMetrics = (name: ProviderName) =>
    withAction(
      async () => { await adminApi.providers.resetMetrics(name) },
      `Metrics cleared for ${PROVIDER_LABELS[name]}`,
    )

  const handleClearCache = () =>
    withAction(
      async () => { await adminApi.providers.clearCache() },
      'Market-data cache cleared',
    )

  const healthyCount = providers.filter(p => p.status === 'healthy' && p.enabled).length
  const totalEnabled = providers.filter(p => p.enabled).length

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white p-6">
      <div className="max-w-5xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <Activity className="w-6 h-6 text-cyan-400" />
            <div>
              <h1 className="text-xl font-bold text-white">Market Data Providers</h1>
              <p className="text-sm text-slate-400">
                {loading ? 'Loading…' : `${healthyCount}/${totalEnabled} healthy · auto-refresh 30s`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleClearCache}
              disabled={actionLoading}
              className="flex items-center gap-1.5 px-3 py-2 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-lg transition-colors disabled:opacity-40"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Clear Cache
            </button>
            <button
              onClick={load}
              disabled={loading || actionLoading}
              className="flex items-center gap-1.5 px-3 py-2 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-lg transition-colors disabled:opacity-40"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>

        {/* Toast */}
        {toast && (
          <div className={`flex items-center gap-2 px-4 py-3 rounded-lg border text-sm ${
            toast.ok
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
              : 'bg-red-500/10 border-red-500/30 text-red-400'
          }`}>
            {toast.ok ? <CheckCircle2 className="w-4 h-4 flex-shrink-0" /> : <AlertTriangle className="w-4 h-4 flex-shrink-0" />}
            {toast.msg}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 px-4 py-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
            <WifiOff className="w-4 h-4 flex-shrink-0" />
            {error}
          </div>
        )}

        {/* Stats bar */}
        {!loading && providers.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Total Providers', value: providers.length },
              { label: 'Enabled', value: totalEnabled },
              { label: 'Healthy', value: healthyCount },
              {
                label: 'Avg Health Score',
                value: providers.length > 0
                  ? Math.round(providers.filter(p => p.enabled).reduce((s, p) => s + p.healthScore, 0) / Math.max(totalEnabled, 1))
                  : 0,
              },
            ].map(stat => (
              <div key={stat.label} className="bg-slate-900/60 border border-white/5 rounded-xl px-4 py-3 text-center">
                <div className="text-2xl font-bold font-mono text-white">{stat.value}</div>
                <div className="text-xs text-slate-500 mt-0.5">{stat.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Provider cards */}
        <div>
          <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">Providers</h2>
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-28 bg-slate-800/40 rounded-xl animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              {providers.map(p => (
                <ProviderCard
                  key={p.name}
                  provider={p}
                  onToggle={handleToggle}
                  onForceFailover={handleForceFailover}
                  onResetMetrics={handleResetMetrics}
                  loading={actionLoading}
                />
              ))}
            </div>
          )}
        </div>

        {/* Failover history */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">
              Failover History
            </h2>
            {lastRefresh && (
              <div className="flex items-center gap-1 text-xs text-slate-600">
                <Clock className="w-3 h-3" />
                {formatRelative(lastRefresh.toISOString())}
              </div>
            )}
          </div>
          <div className="bg-slate-900/60 border border-white/5 rounded-xl p-4">
            <FailoverHistory events={failoverLog} />
          </div>
        </div>

      </div>
    </div>
  )
}
