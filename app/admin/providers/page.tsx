'use client'

import { useState, useCallback } from 'react'
import {
  Server, Activity, AlertTriangle, CheckCircle2,
  RefreshCw, Zap, ToggleLeft, ToggleRight, Trash2,
  RotateCcw, ChevronDown, ChevronUp, Clock, WifiOff,
} from 'lucide-react'
import { adminApi, ProviderHealth, ProviderName, FailoverEvent } from '@/lib/admin-api'
import { useAutoRefresh } from '@/lib/use-auto-refresh'
import { formatTs } from '@/lib/utils'

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatRelative(iso: string | null): string {
  if (!iso) return 'never'
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60_000)     return 'just now'
  if (diff < 3_600_000)  return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return new Date(iso).toLocaleDateString()
}

function statusColor(status: string): string {
  switch (status) {
    case 'healthy':         return 'text-bull-default'
    case 'degraded':        return 'text-signal-high'
    case 'offline':         return 'text-terminal-muted'
    case 'quota_exhausted': return 'text-signal-medium'
    default:                return 'text-terminal-muted'
  }
}

function statusBg(status: string): string {
  switch (status) {
    case 'healthy':         return 'bg-bull-default/5 border-bull-default/20'
    case 'degraded':        return 'bg-signal-high/5 border-signal-high/20'
    case 'offline':         return 'bg-terminal-bg border-terminal-border'
    case 'quota_exhausted': return 'bg-signal-medium/5 border-signal-medium/20'
    default:                return 'bg-terminal-bg border-terminal-border'
  }
}

function healthBarColor(score: number): string {
  if (score >= 80) return 'bg-bull-default'
  if (score >= 60) return 'bg-signal-high'
  if (score >= 40) return 'bg-signal-medium'
  return 'bg-bear-default'
}

function quotaBarColor(pct: number): string {
  if (pct >= 90) return 'bg-bear-default'
  if (pct >= 75) return 'bg-signal-medium'
  if (pct >= 50) return 'bg-signal-high'
  return 'bg-bull-default'
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
          <Server className={`w-4 h-4 shrink-0 ${statusColor(provider.status)}`} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm font-semibold text-terminal-text">
                {PROVIDER_LABELS[provider.name] ?? provider.name}
              </span>
              {PROVIDER_FREE[provider.name] && (
                <span className="text-xs px-1.5 py-0.5 bg-terminal-bright text-terminal-muted rounded">free</span>
              )}
              <span className={`text-xs font-medium capitalize ${statusColor(provider.status)}`}>
                {provider.status.replace('_', ' ')}
              </span>
            </div>
            <div className="text-xs text-terminal-muted mt-0.5">
              Priority {provider.priority} · {provider.requestsToday.toLocaleString()} req today
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <div className="text-right hidden sm:block">
            <div className={`text-lg font-bold font-mono ${
              provider.healthScore >= 80 ? 'text-bull-default' :
              provider.healthScore >= 60 ? 'text-signal-high' :
              provider.healthScore >= 40 ? 'text-signal-medium' : 'text-bear-default'
            }`}>
              {provider.healthScore}
            </div>
            <div className="text-xs text-terminal-muted -mt-0.5">health</div>
          </div>

          <button
            onClick={() => onToggle(provider.name, !provider.enabled)}
            disabled={loading}
            className="text-terminal-muted hover:text-terminal-text transition-colors disabled:opacity-50"
            title={provider.enabled ? 'Disable provider' : 'Enable provider'}
          >
            {provider.enabled
              ? <ToggleRight className="w-6 h-6 text-bull-default" />
              : <ToggleLeft  className="w-6 h-6 text-terminal-muted" />
            }
          </button>

          <button
            onClick={() => setExpanded(e => !e)}
            className="text-terminal-muted/50 hover:text-terminal-muted transition-colors"
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Metrics row */}
      <div className="px-4 pb-3 grid grid-cols-3 gap-3 text-center">
        <div>
          <div className="text-xs text-terminal-muted/60 mb-1">Latency p95</div>
          <div className={`text-sm font-mono font-semibold ${
            provider.latencyMs > 5000 ? 'text-bear-default' :
            provider.latencyMs > 2000 ? 'text-signal-high' : 'text-bull-default'
          }`}>
            {provider.latencyMs > 0 ? `${provider.latencyMs}ms` : '—'}
          </div>
        </div>
        <div>
          <div className="text-xs text-terminal-muted/60 mb-1">Error Rate</div>
          <div className={`text-sm font-mono font-semibold ${
            provider.errorRate > 0.15 ? 'text-bear-default' :
            provider.errorRate > 0.05 ? 'text-signal-high' : 'text-bull-default'
          }`}>
            {(provider.errorRate * 100).toFixed(1)}%
          </div>
        </div>
        <div>
          <div className="text-xs text-terminal-muted/60 mb-1">Last OK</div>
          <div className="text-sm font-mono text-terminal-text">
            {formatRelative(provider.lastSuccess)}
          </div>
        </div>
      </div>

      {/* Health bar */}
      <div className="px-4 pb-2">
        <div className="h-1 bg-terminal-bright rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${healthBarColor(provider.healthScore)}`}
            style={{ width: `${provider.healthScore}%` }}
          />
        </div>
      </div>

      {/* Quota bar */}
      {provider.quota.dailyLimit > 0 && (
        <div className="px-4 pb-3">
          <div className="flex justify-between text-xs text-terminal-muted mb-1">
            <span>Quota {provider.quota.used.toLocaleString()} / {provider.quota.dailyLimit.toLocaleString()}</span>
            <span>{quotaPct.toFixed(0)}%</span>
          </div>
          <div className="h-1.5 bg-terminal-bright rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${quotaBarColor(quotaPct)}`}
              style={{ width: `${Math.min(quotaPct, 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* Expanded panel */}
      {expanded && (
        <div className="border-t border-terminal-border/30 px-4 py-3 space-y-3">
          {provider.lastError && (
            <div className="text-xs text-bear-default bg-bear-default/5 rounded px-2 py-1.5 font-mono break-all">
              Last error: {provider.lastError}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => onForceFailover(provider.name)}
              disabled={loading || !provider.enabled}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-signal-medium/5 hover:bg-signal-medium/10 text-signal-medium border border-signal-medium/30 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Zap className="w-3 h-3" />
              Force Failover
            </button>
            <button
              onClick={() => onResetMetrics(provider.name)}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-terminal-bright/20 hover:bg-terminal-bright/40 text-terminal-muted hover:text-terminal-text border border-terminal-border rounded-lg transition-colors disabled:opacity-40"
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
      <div className="text-center py-8 text-terminal-muted">
        <CheckCircle2 className="w-8 h-8 mx-auto mb-2 opacity-30" />
        <p className="text-sm">No failover events recorded.</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {events.map(e => (
        <div key={e.id} className="flex items-start gap-3 px-3 py-2.5 bg-terminal-bright/10 rounded-lg border border-terminal-border/30">
          <AlertTriangle className="w-3.5 h-3.5 text-signal-medium shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <div className="text-xs text-terminal-text">
              <span className="text-signal-medium font-mono">{PROVIDER_LABELS[e.fromProvider] ?? e.fromProvider}</span>
              {' → '}
              <span className="text-bull-default font-mono">
                {e.toProvider === 'auto' ? 'auto' : (PROVIDER_LABELS[e.toProvider] ?? e.toProvider)}
              </span>
            </div>
            <div className="text-xs text-terminal-muted mt-0.5 truncate">
              {e.reason.replace('_', ' ')} · {formatTs(e.occurredAt)}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Combined fetcher type ─────────────────────────────────────────────────────

type ProvidersData = { providers: ProviderHealth[]; events: FailoverEvent[] }

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ProvidersPage() {
  const [actionLoading, setActionLoading] = useState(false)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)

  const fetcher = useCallback(async (): Promise<ProvidersData> => {
    const [provRes, logRes] = await Promise.all([
      adminApi.providers.list(),
      adminApi.providers.failoverHistory(),
    ])
    return { providers: provRes.providers, events: logRes.events }
  }, [])

  const { data, loading, error, lastUpdated, refresh } = useAutoRefresh<ProvidersData>(fetcher, 30_000)

  const providers  = data?.providers ?? []
  const failoverLog = data?.events  ?? []

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3000)
  }

  const withAction = async (fn: () => Promise<void>, msg: string) => {
    setActionLoading(true)
    try {
      await fn()
      showToast(msg)
      refresh()
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
    <div className="space-y-6 animate-fade-in">

      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-terminal-text text-xl font-semibold">Market Data Providers</h1>
          <p className="text-terminal-muted text-sm mt-1">
            {loading ? 'Loading…' : `${healthyCount}/${totalEnabled} healthy · auto-refresh 30s`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleClearCache}
            disabled={actionLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-terminal-muted border border-terminal-border hover:text-terminal-text hover:border-terminal-bright rounded-lg transition-colors disabled:opacity-40"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Clear Cache
          </button>
          <button
            onClick={refresh}
            disabled={loading || actionLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-terminal-muted border border-terminal-border hover:text-terminal-text hover:border-terminal-bright rounded-lg transition-colors disabled:opacity-40"
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
            ? 'bg-bull-default/10 border-bull-default/30 text-bull-default'
            : 'bg-bear-default/10 border-bear-default/30 text-bear-default'
        }`}>
          {toast.ok
            ? <CheckCircle2 className="w-4 h-4 shrink-0" />
            : <AlertTriangle className="w-4 h-4 shrink-0" />
          }
          {toast.msg}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 px-4 py-3 bg-bear-default/5 border border-bear-default/20 rounded-lg text-bear-default text-sm">
          <WifiOff className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Stats bar */}
      {!loading && providers.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Total Providers', value: providers.length },
            { label: 'Enabled',         value: totalEnabled },
            { label: 'Healthy',         value: healthyCount },
            {
              label: 'Avg Health',
              value: Math.round(providers.filter(p => p.enabled).reduce((s, p) => s + p.healthScore, 0) / Math.max(totalEnabled, 1)),
            },
          ].map(stat => (
            <div key={stat.label} className="glass-card rounded-lg px-4 py-3 text-center">
              <div className="text-2xl font-bold font-mono text-terminal-text">{stat.value}</div>
              <div className="text-xs text-terminal-muted mt-0.5">{stat.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Provider cards */}
      <div>
        <p className="text-terminal-muted text-xs uppercase tracking-wider mb-3">Providers</p>
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => <div key={i} className="h-28 skeleton rounded-xl" />)}
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
          <p className="text-terminal-muted text-xs uppercase tracking-wider">Failover History</p>
          {lastUpdated && (
            <div className="flex items-center gap-1 text-xs text-terminal-muted/40 font-mono">
              <Clock className="w-3 h-3" />
              {formatTs(lastUpdated.toISOString())}
            </div>
          )}
        </div>
        <div className="glass-card rounded-lg p-4">
          <FailoverHistory events={failoverLog} />
        </div>
      </div>

    </div>
  )
}
