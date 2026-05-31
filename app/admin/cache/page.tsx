'use client'

import { useState, useCallback } from 'react'
import {
  RefreshCw, Layers, CheckCircle2, AlertTriangle,
  Clock, Activity, Database, Zap, TrendingUp,
  BarChart2, Shield, ChevronRight,
} from 'lucide-react'
import { useAutoRefresh } from '@/lib/use-auto-refresh'

// ─── Types ────────────────────────────────────────────────────────────────────

interface CacheGroupMeta {
  name:            string
  label:           string
  ttlMs:           number
  creditsPerCall:  number
  lastRefreshedAt: string | null
  isStale:         boolean
  ageSeconds:      number | null
  hitCount:        number
  missCount:       number
  hitRate:         number
}

interface QuotaGuardState {
  monthlyBudget:           number
  creditsUsed:             number
  creditsRemaining:        number
  pctUsed:                 number
  resetAt:                 string
  throttled:               boolean
  warningLevel:            'normal' | 'caution' | 'warning' | 'critical' | 'emergency'
  requestsLastMinute:      number
  perMinuteLimit:          number
  projectedMonthlyUse:     number
  projectedExhaustionDate: string | null
}

interface WorkerStatus {
  name:        string
  intervalMs:  number
  lastTickAt:  string | null
  nextTickAt:  string | null
  lastError:   string | null
  errorCount:  number
  tickCount:   number
  state:       'idle' | 'running' | 'error' | 'stopped'
}

interface IntelligenceTelemetry {
  groups:                CacheGroupMeta[]
  quota:                 QuotaGuardState
  workers:               WorkerStatus[]
  overallHitRate:        number
  lastPreloadAt:         string | null
  lastPreloadDurationMs: number | null
  cmcEnabled:            boolean
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatAge(seconds: number | null): string {
  if (seconds === null) return '—'
  if (seconds < 60)  return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
}

function formatTtl(ms: number): string {
  const s = ms / 1000
  if (s < 60)   return `${s}s`
  if (s < 3600) return `${s / 60}m`
  return `${s / 3600}h`
}

function formatTs(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString()
}

function warningColor(level: QuotaGuardState['warningLevel']): string {
  switch (level) {
    case 'emergency': return 'text-red-400'
    case 'critical':  return 'text-orange-400'
    case 'warning':   return 'text-yellow-400'
    case 'caution':   return 'text-yellow-300'
    default:          return 'text-green-400'
  }
}

function workerStateColor(state: WorkerStatus['state']): string {
  switch (state) {
    case 'running': return 'text-blue-400'
    case 'error':   return 'text-red-400'
    case 'stopped': return 'text-zinc-500'
    default:        return 'text-green-400'
  }
}

const GROUP_ICONS: Record<string, React.ReactNode> = {
  listings:   <BarChart2   className="w-4 h-4" />,
  global:     <TrendingUp  className="w-4 h-4" />,
  trending:   <Zap         className="w-4 h-4" />,
  categories: <Layers      className="w-4 h-4" />,
  metadata:   <Database    className="w-4 h-4" />,
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function CacheIntelligencePage() {
  const [telemetry, setTelemetry] = useState<IntelligenceTelemetry | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshingGroup, setRefreshingGroup] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const fetchTelemetry = useCallback(async () => {
    try {
      const res = await fetch('/api/cache/intelligence')
      const json = await res.json()
      if (json.success) setTelemetry(json.telemetry)
      else setError(json.error)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  useAutoRefresh(fetchTelemetry, 60_000)  // OPT-5: was 10_000 — cache TTLs are 5-360 min

  const forceRefreshAll = async () => {
    setRefreshing(true)
    try {
      const res  = await fetch('/api/cache/intelligence', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ force: true }) })
      const json = await res.json()
      if (json.success) setTelemetry(json.telemetry)
      else setError(json.error)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRefreshing(false)
    }
  }

  const refreshGroup = async (group: string) => {
    setRefreshingGroup(group)
    try {
      const res  = await fetch(`/api/cache/intelligence/${group}`, { method: 'POST' })
      const json = await res.json()
      if (json.success) setTelemetry(json.telemetry)
      else setError(json.error)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRefreshingGroup(null)
    }
  }

  const q = telemetry?.quota

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Layers className="w-6 h-6 text-blue-400" />
          <div>
            <h1 className="text-xl font-semibold text-white">Cache Intelligence</h1>
            <p className="text-sm text-zinc-400">CMC quota · 5 cache groups · background workers</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {telemetry && (
            <span className="text-xs text-zinc-500">
              Updated {formatTs(new Date().toISOString())}
            </span>
          )}
          <button
            onClick={forceRefreshAll}
            disabled={refreshing}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-sm font-medium text-white transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh All
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-900/30 border border-red-800 text-red-300 text-sm flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {!telemetry && !error && (
        <div className="flex items-center justify-center h-40 text-zinc-500 text-sm">
          <RefreshCw className="w-4 h-4 animate-spin mr-2" /> Loading telemetry…
        </div>
      )}

      {telemetry && (
        <>
          {/* Quota Overview */}
          {q ? (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                  <div className="text-xs text-zinc-500 mb-1">Credits Used</div>
                  <div className="text-2xl font-bold text-white">{q.creditsUsed.toLocaleString()}</div>
                  <div className="text-xs text-zinc-500">of {q.monthlyBudget.toLocaleString()} monthly</div>
                </div>
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                  <div className="text-xs text-zinc-500 mb-1">Budget Used</div>
                  <div className={`text-2xl font-bold ${warningColor(q.warningLevel)}`}>
                    {q.pctUsed}%
                  </div>
                  <div className="text-xs text-zinc-500 capitalize">{q.warningLevel}</div>
                </div>
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                  <div className="text-xs text-zinc-500 mb-1">Req / Minute</div>
                  <div className="text-2xl font-bold text-white">{q.requestsLastMinute}</div>
                  <div className="text-xs text-zinc-500">limit {q.perMinuteLimit}</div>
                </div>
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                  <div className="text-xs text-zinc-500 mb-1">Overall Hit Rate</div>
                  <div className="text-2xl font-bold text-green-400">{telemetry.overallHitRate}%</div>
                  <div className="text-xs text-zinc-500">across all groups</div>
                </div>
              </div>

              {/* Budget Bar */}
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2 text-sm text-zinc-300">
                    <Shield className="w-4 h-4 text-blue-400" />
                    Monthly Budget
                  </div>
                  <div className="text-xs text-zinc-500">
                    Resets {formatTs(q.resetAt)}
                    {q.projectedExhaustionDate && (
                      <span className="ml-2 text-orange-400">
                        · Projected exhaustion {formatTs(q.projectedExhaustionDate)}
                      </span>
                    )}
                  </div>
                </div>
                <div className="w-full h-2 rounded-full bg-zinc-800 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      q.pctUsed >= 95 ? 'bg-red-500' :
                      q.pctUsed >= 85 ? 'bg-orange-500' :
                      q.pctUsed >= 70 ? 'bg-yellow-500' :
                      q.pctUsed >= 50 ? 'bg-yellow-400' :
                      'bg-green-500'
                    }`}
                    style={{ width: `${Math.min(q.pctUsed, 100)}%` }}
                  />
                </div>
                <div className="flex items-center justify-between mt-1 text-xs text-zinc-500">
                  <span>{q.creditsUsed.toLocaleString()} used</span>
                  <span>{q.creditsRemaining.toLocaleString()} remaining</span>
                </div>
                {q.throttled && (
                  <div className="mt-2 text-xs text-red-400 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" /> Quota guard THROTTLED — requests blocked
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 text-zinc-500 text-sm">
              CMC quota data unavailable — ensure COINMARKETCAP_API_KEY is set.
            </div>
          )}

          {/* Cache Groups */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-[9px] text-zinc-500 uppercase tracking-widest">Cache Groups</p>
              <span className="text-[10px] text-zinc-600 font-mono">
                {telemetry.groups.filter(g => !g.isStale).length}/{telemetry.groups.length} fresh
              </span>
            </div>
            <div className="space-y-2">
              {telemetry.groups.map((group) => (
                <div
                  key={group.name}
                  className={`bg-zinc-900 border rounded-xl px-4 py-3 transition-colors ${
                    group.isStale ? 'border-orange-500/25' : 'border-zinc-800'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    {/* Icon + name */}
                    <div className={`shrink-0 ${group.isStale ? 'text-orange-400' : 'text-zinc-400'}`}>
                      {GROUP_ICONS[group.name]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-medium text-white">{group.label}</span>
                        <span className={`text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded border ${
                          group.isStale
                            ? 'text-orange-400 bg-orange-900/30 border-orange-700/40'
                            : 'text-green-400 bg-green-900/30 border-green-700/40'
                        }`}>
                          {group.isStale ? 'STALE' : 'FRESH'}
                        </span>
                        <span className="text-[9px] text-zinc-600 hidden sm:inline font-mono">
                          Age {formatAge(group.ageSeconds)} · TTL {formatTtl(group.ttlMs)}
                        </span>
                      </div>
                      {/* Hit rate bar */}
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1 rounded-full bg-zinc-800 overflow-hidden max-w-[120px]">
                          <div className="h-full rounded-full" style={{
                            width: `${group.hitRate}%`,
                            backgroundColor: group.hitRate >= 80 ? '#22c55e' : group.hitRate >= 50 ? '#f59e0b' : '#ef4444',
                          }} />
                        </div>
                        <span className={`text-[10px] font-mono font-semibold ${
                          group.hitRate >= 80 ? 'text-green-400' : group.hitRate >= 50 ? 'text-amber-400' : 'text-red-400'
                        }`}>{group.hitRate}%</span>
                        <span className="text-[9px] text-zinc-600 hidden sm:inline">{group.hitCount}H / {group.missCount}M</span>
                      </div>
                    </div>
                    {/* Refresh button */}
                    <button
                      onClick={() => refreshGroup(group.name)}
                      disabled={refreshingGroup === group.name}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-[10px] text-zinc-400 transition-colors shrink-0 font-mono"
                    >
                      <RefreshCw className={`w-3 h-3 ${refreshingGroup === group.name ? 'animate-spin' : ''}`} />
                      <span className="hidden sm:inline">Refresh</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Workers — compact, shown only if errors present or space permits */}
          {telemetry.workers.length > 0 && (
            <div>
              <p className="text-[9px] text-zinc-600 uppercase tracking-widest mb-2">Background Workers</p>
              <div className="space-y-1.5">
                {telemetry.workers.map((w) => (
                  <div key={w.name} className="bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-2.5 flex items-center gap-3">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                      w.state === 'running' ? 'bg-blue-400 animate-pulse' :
                      w.state === 'error'   ? 'bg-red-400 animate-pulse' :
                      w.state === 'stopped' ? 'bg-zinc-600' : 'bg-green-400'
                    }`} />
                    <span className="text-xs font-mono text-zinc-300 flex-1 min-w-0 truncate">{w.name}</span>
                    <span className={`text-[10px] hidden sm:block ${workerStateColor(w.state)}`}>{w.state}</span>
                    <span className="text-[9px] text-zinc-600 font-mono hidden sm:block">
                      {w.tickCount} ticks · next {formatTs(w.nextTickAt)}
                    </span>
                    {w.errorCount > 0 && (
                      <span className="text-[10px] text-red-400 bg-red-900/20 border border-red-800/40 px-1.5 py-0.5 rounded shrink-0">
                        {w.errorCount} err
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Footer status */}
          <div className="flex items-center gap-4 text-xs text-zinc-600 pt-2 border-t border-zinc-800">
            <div className="flex items-center gap-1.5">
              {telemetry.cmcEnabled
                ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
                : <AlertTriangle className="w-3.5 h-3.5 text-orange-400" />}
              CMC API {telemetry.cmcEnabled ? 'configured' : 'key missing'}
            </div>
            <div className="flex items-center gap-1.5">
              <ChevronRight className="w-3 h-3" />
              Projected monthly: {q!.projectedMonthlyUse.toLocaleString()} credits
            </div>
          </div>
        </>
      )}
    </div>
  )
}
