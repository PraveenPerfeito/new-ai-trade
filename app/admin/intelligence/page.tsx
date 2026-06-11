'use client'

import { useState, useCallback, useEffect } from 'react'
import {
  Database, Layers, Globe, Activity,
  TrendingUp, TrendingDown, RefreshCw,
  CheckCircle2, AlertTriangle, BarChart2, Zap,
  ArrowUpRight, ArrowDownRight, Newspaper, ChevronRight,
  Shield, Wifi, WifiOff, Clock, Server,
} from 'lucide-react'
import { adminApi } from '@/lib/admin-api'
import { useSharedPolling } from '@/lib/use-shared-polling'
import { useAutoRefresh } from '@/lib/use-auto-refresh'
import { formatTs } from '@/lib/utils'
import type { SectorStats } from '@/types'
import { ProviderHealthTable } from '@/components/admin/provider-health-table'

// ── Types ────────────────────────────────────────────────────────────────────

interface ProviderCheckResult {
  name: string; healthy: boolean; latencyMs: number; note?: string; error?: string
}
interface CacheGroupMeta {
  name: string; label: string; ttlMs: number; creditsPerCall: number
  lastRefreshedAt: string | null; isStale: boolean; ageSeconds: number | null
  hitCount: number; missCount: number; hitRate: number
}
interface QuotaGuardState {
  monthlyBudget: number; creditsUsed: number; creditsRemaining: number; pctUsed: number
  resetAt: string; throttled: boolean
  warningLevel: 'normal' | 'caution' | 'warning' | 'critical' | 'emergency'
  requestsLastMinute: number; perMinuteLimit: number
  projectedMonthlyUse: number; projectedExhaustionDate: string | null
}
interface WorkerStatus {
  name: string; intervalMs: number; lastTickAt: string | null; nextTickAt: string | null
  lastError: string | null; errorCount: number; tickCount: number
  state: 'idle' | 'running' | 'error' | 'stopped'
}
interface IntelligenceTelemetry {
  groups: CacheGroupMeta[]; quota: QuotaGuardState; workers: WorkerStatus[]
  overallHitRate: number; lastPreloadAt: string | null
  lastPreloadDurationMs: number | null; cmcEnabled: boolean
}
interface CategoryData {
  id: string; name: string; title: string; coinCount: number; avgPriceChange: number
  volume24h: number; marketCap: number; marketCapChange: number; coins: string[]
}
interface SectorsResponse {
  sectors: SectorStats[]; categories: CategoryData[] | null
  strongest: string | null; weakest: string | null; computedAt: string
}
type MarketRegime = 'BULL_TREND' | 'BEAR_TREND' | 'SIDEWAYS' | 'HIGH_VOLATILITY' | 'EUPHORIA' | 'CAPITULATION'
interface RegimeData { regime: MarketRegime; btcRsi4h: number; btcTrend4h: string; btcAtrPct: number; btc24hChange: number; computedAt: string }
interface GlobalData { btcDominance: number; ethDominance: number; totalMarketCapUsd: number; totalVolume24hUsd: number; marketCapChangePercent24h: number; refreshedAt: string }
interface TrendingCoin { id: number; symbol: string; name: string; rank: number; priceChange1h: number; priceChange24h: number; volume24h: number; marketCap: number }
interface IntelligenceData { regime: RegimeData; global: GlobalData | null; trending: { trending: TrendingCoin[]; refreshedAt: string } | null; listings: { breadthUp: number; breadthDown: number; topMovers: { symbol: string; change: number }[] } | null; computedAt: string }
interface NewsItem { title: string; url: string; source: string; publishedAt: string; sentiment?: 'bullish' | 'bearish' | 'neutral'; coins: string[] }
interface CoinSentimentEntry { bullish: number; bearish: number; net: number }
interface NewsSnapshot { fearGreedValue: number | null; fearGreedLabel: string | null; headlines: NewsItem[]; bullishCount: number; bearishCount: number; neutralCount: number; coinSentiment: Record<string, CoinSentimentEntry>; cachedAt: string }

// ── Constants ────────────────────────────────────────────────────────────────

const PROVIDER_META: Record<string, { label: string; role: string; color: string; quotaNote: string; stackRole: string }> = {
  coinmarketcap: { label: 'CoinMarketCap', role: 'Market Intelligence',    color: '#3861fb', quotaNote: 'Startup · 10k req/day',  stackRole: 'Primary Intelligence' },
  binance:       { label: 'Binance',        role: 'Tactical Execution',     color: '#f0b90b', quotaNote: 'Rate-limited by IP',    stackRole: 'Tactical Execution'   },
  coingecko:     { label: 'CoinGecko',      role: 'Backup Intelligence',    color: '#2d9e49', quotaNote: 'Free tier',             stackRole: 'Backup Redundancy'    },
  dexscreener:   { label: 'DexScreener',    role: 'Low-Cap Intelligence',   color: '#7c3aed', quotaNote: 'Unlimited',             stackRole: 'Optional Low-Cap'     },
}
const REGIME_META: Record<string, { label: string; color: string; border: string; bg: string; desc: string; icon: string }> = {
  BULL_TREND:      { label: 'Bull Trend',     color: 'text-emerald-400', border: 'border-emerald-500/30', bg: 'bg-emerald-500/5',  desc: 'BTC 4h bullish · strong trend momentum',          icon: '🐂' },
  BEAR_TREND:      { label: 'Bear Trend',     color: 'text-red-400',     border: 'border-red-500/30',     bg: 'bg-red-500/5',      desc: 'BTC 4h bearish · sustained selling pressure',      icon: '🐻' },
  SIDEWAYS:        { label: 'Sideways',       color: 'text-zinc-300',    border: 'border-zinc-600/40',    bg: 'bg-zinc-800/30',    desc: 'No directional bias · price consolidating',        icon: '↔' },
  HIGH_VOLATILITY: { label: 'High Volatility',color: 'text-amber-400',   border: 'border-amber-500/30',   bg: 'bg-amber-500/5',    desc: 'ATR elevated · increased whipsaw risk',            icon: '⚡' },
  EUPHORIA:        { label: 'Euphoria',       color: 'text-purple-400',  border: 'border-purple-500/30',  bg: 'bg-purple-500/5',   desc: 'Overbought · RSI > 78 · extreme greed',           icon: '🚀' },
  CAPITULATION:    { label: 'Capitulation',   color: 'text-rose-400',    border: 'border-rose-500/30',    bg: 'bg-rose-500/5',     desc: 'Extreme fear · RSI < 22 · mass selling',          icon: '💥' },
}
const GROUP_ICONS: Record<string, React.ReactNode> = {
  listings:   <BarChart2   className="w-4 h-4" />,
  global:     <TrendingUp  className="w-4 h-4" />,
  trending:   <Zap         className="w-4 h-4" />,
  categories: <Layers      className="w-4 h-4" />,
}
const FG_COLOR: Record<string, string> = {
  'Extreme Fear': 'text-red-400', 'Fear': 'text-orange-400', 'Neutral': 'text-zinc-400',
  'Greed': 'text-green-400', 'Extreme Greed': 'text-emerald-400',
}
const SENT_STYLE: Record<string, string> = {
  bullish: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/25',
  bearish: 'text-red-400 bg-red-500/10 border-red-500/25',
  neutral: 'text-zinc-400 bg-zinc-800/60 border-zinc-700',
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number, d = 2) { return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) }
function fmtB(n: number) {
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`
  if (n >= 1e9)  return `$${(n / 1e9).toFixed(1)}B`
  return `$${(n / 1e6).toFixed(0)}M`
}
function formatAge(s: number | null) {
  if (s === null) return '—'
  if (s < 60)    return `${s}s ago`
  if (s < 3600)  return `${Math.floor(s / 60)}m ${s % 60}s ago`
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ago`
}
function formatTtl(ms: number) {
  const s = ms / 1000
  if (s < 60)    return `${s}s TTL`
  if (s < 3600)  return `${s / 60}m TTL`
  return `${s / 3600}h TTL`
}
function warningColor(level: QuotaGuardState['warningLevel']) {
  switch (level) {
    case 'emergency': return 'text-red-400'; case 'critical': return 'text-orange-400'
    case 'warning':   return 'text-yellow-400'; case 'caution': return 'text-yellow-300'
    default: return 'text-emerald-400'
  }
}
function warningBg(level: QuotaGuardState['warningLevel']) {
  switch (level) {
    case 'emergency': return 'bg-red-500'; case 'critical': return 'bg-orange-500'
    case 'warning': case 'caution': return 'bg-yellow-500'
    default: return 'bg-emerald-500'
  }
}
function sectorStatus(avgChange: number) {
  if (avgChange > 12) return { label: 'OVERCROWDED', cls: 'text-red-400',     border: 'border-l-red-500'      }
  if (avgChange > 7)  return { label: 'STRONGEST',   cls: 'text-blue-400',    border: 'border-l-blue-500'     }
  if (avgChange > 3)  return { label: 'ACCELERATING',cls: 'text-emerald-400', border: 'border-l-emerald-500'  }
  if (avgChange < -7) return { label: 'DECLINING',   cls: 'text-red-400',     border: 'border-l-red-600'      }
  if (avgChange < -3) return { label: 'WEAKENING',   cls: 'text-amber-400',   border: 'border-l-amber-500'    }
  return               { label: 'NEUTRAL',     cls: 'text-zinc-500',    border: 'border-l-zinc-700'     }
}
function workerStateColor(state: WorkerStatus['state']) {
  switch (state) { case 'running': return 'text-blue-400'; case 'error': return 'text-red-400'; case 'stopped': return 'text-zinc-500'; default: return 'text-emerald-400' }
}

// ── Providers tab ────────────────────────────────────────────────────────────

function ProvidersTab({ providers, loading }: { providers: ProviderCheckResult[]; loading: boolean }) {
  const up    = providers.filter(p => p.healthy).length
  const total = providers.length
  const down  = total - up
  const avgLatency = total > 0 ? Math.round(providers.filter(p => p.healthy).reduce((a, p) => a + p.latencyMs, 0) / Math.max(up, 1)) : 0

  const summaryTiles = [
    {
      label: 'Services Up',
      value: loading ? '…' : `${up}/${total}`,
      sub: loading ? 'checking' : down > 0 ? `${down} degraded` : 'all healthy',
      cls: loading ? 'text-zinc-400' : down === 0 && total > 0 ? 'text-emerald-400' : down > 2 ? 'text-red-400' : 'text-amber-400',
      icon: <Wifi className="w-4 h-4" />,
    },
    {
      label: 'Avg Latency',
      value: loading ? '…' : up > 0 ? `${avgLatency}ms` : '—',
      sub: 'healthy services',
      cls: avgLatency > 1000 ? 'text-amber-400' : 'text-white',
      icon: <Clock className="w-4 h-4" />,
    },
    {
      label: 'CMC Cache',
      value: (() => {
        if (loading) return '…'
        const cmc = providers.find(p => p.name === 'CMC')
        if (!cmc) return '—'
        return cmc.healthy ? 'Warm' : 'Cold'
      })(),
      sub: (() => {
        const cmc = providers.find(p => p.name === 'CMC')
        return cmc?.note ?? 'intelligence cache'
      })(),
      cls: (() => {
        const cmc = providers.find(p => p.name === 'CMC')
        return cmc?.healthy ? 'text-emerald-400' : 'text-amber-400'
      })(),
      icon: <Database className="w-4 h-4" />,
    },
    {
      label: 'Celery Worker',
      value: (() => {
        if (loading) return '…'
        const amqp = providers.find(p => p.name === 'CloudAMQP')
        return amqp?.healthy ? 'Alive' : 'Down'
      })(),
      sub: (() => {
        const amqp = providers.find(p => p.name === 'CloudAMQP')
        return amqp?.note ?? 'via heartbeat'
      })(),
      cls: (() => {
        const amqp = providers.find(p => p.name === 'CloudAMQP')
        return amqp?.healthy ? 'text-emerald-400' : 'text-red-400'
      })(),
      icon: <Server className="w-4 h-4" />,
    },
  ]

  return (
    <div className="space-y-5 max-w-5xl">
      {/* Summary tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {summaryTiles.map(t => (
          <div key={t.label} className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3">
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-[10px] text-zinc-500 uppercase tracking-wider">{t.label}</p>
              <span className="text-zinc-600">{t.icon}</span>
            </div>
            <p className={`text-2xl font-bold font-mono ${t.cls}`}>{t.value}</p>
            <p className="text-[10px] text-zinc-500 mt-0.5 truncate">{t.sub}</p>
          </div>
        ))}
      </div>

      {/* Health table */}
      {loading ? (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
          <p className="text-[10px] text-zinc-500 uppercase tracking-widest mb-3">Live Health Check — 8 Services</p>
          <div className="space-y-1.5">{Array.from({length: 8}).map((_, i) => (
            <div key={i} className="h-8 rounded-lg bg-zinc-800/50 animate-pulse"/>
          ))}</div>
        </div>
      ) : (
        <ProviderHealthTable providers={providers} />
      )}

      {/* Provider stack cards */}
      <div>
        <p className="text-[10px] text-zinc-500 uppercase tracking-widest mb-3">Data Provider Stack</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
          {Object.entries(PROVIDER_META).map(([key, meta]) => {
            const health = providers.find(p =>
              p.name.toLowerCase() === meta.label.toLowerCase()
                .replace('coinmarketcap', 'cmc')
                .replace('coingecko', 'coingecko')
            )
            const isUp = health?.healthy
            return (
              <div key={key} className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: meta.color }}/>
                  <span className="text-sm font-semibold text-white flex-1 truncate">{meta.label}</span>
                  {!loading && isUp !== undefined && (
                    <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded border shrink-0 ${isUp ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/5' : 'text-red-400 border-red-500/30 bg-red-500/5'}`}>
                      {isUp ? 'UP' : 'DOWN'}
                    </span>
                  )}
                </div>
                <p className="text-[10px] text-zinc-400 mb-1.5">{meta.role}</p>
                <div className="flex items-center justify-between">
                  <span className="text-[9px] font-mono text-zinc-600">{meta.quotaNote}</span>
                  {health?.latencyMs ? <span className="text-[9px] font-mono text-zinc-600">{health.latencyMs}ms</span> : null}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── Cache tab ────────────────────────────────────────────────────────────────

const INTEL_SECTIONS = [
  { key: 'listings',   label: 'Market Snapshot',     ttlMin: 5,  desc: 'Top 200 listings, breadth, movers'  },
  { key: 'global',     label: 'Global Metrics',      ttlMin: 5,  desc: 'Market cap, volume, dominance'       },
  { key: 'categories', label: 'Sector Intelligence', ttlMin: 60, desc: 'CMC category states + signals'       },
  { key: 'trending',   label: 'Trending Engine',     ttlMin: 5,  desc: 'CMC trending coins, 5-source fusion' },
]

function CacheTab({ data, onForceRefresh, onRefreshGroup, onRefreshAll, refreshing, refreshingGroup, error }: {
  data: IntelligenceTelemetry | null
  onForceRefresh: () => void; onRefreshGroup: (g: string) => void; onRefreshAll: () => void
  refreshing: boolean; refreshingGroup: string | null; error: string | null
}) {
  const q = data?.quota

  return (
    <div className="space-y-5 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-white">Cache Intelligence</p>
          <p className="text-[10px] text-zinc-500 mt-0.5">CMC quota · group freshness · worker status</p>
        </div>
        <button onClick={() => { onForceRefresh(); onRefreshAll() }} disabled={refreshing}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-xs font-medium text-white transition-colors">
          <RefreshCw className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`}/>Refresh All Sources
        </button>
      </div>

      {/* Intel sections quick-refresh */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        {INTEL_SECTIONS.map(s => {
          const group = data?.groups.find(g => g.name === s.key)
          const stale = group ? group.isStale : false
          const age   = group ? formatAge(group.ageSeconds) : `every ${s.ttlMin}m`
          return (
            <div key={s.key} className={`bg-zinc-900 border rounded-xl px-3 py-2.5 ${stale ? 'border-orange-500/25' : 'border-zinc-800'}`}>
              <div className="flex items-start justify-between gap-1 mb-1">
                <p className="text-[10px] text-zinc-300 font-medium leading-tight">{s.label}</p>
                <span className={`text-[8px] font-mono font-bold px-1 py-0.5 rounded shrink-0 ${stale ? 'text-orange-400 bg-orange-900/30' : 'text-emerald-400 bg-emerald-900/20'}`}>
                  {stale ? 'STALE' : 'FRESH'}
                </span>
              </div>
              <p className="text-[9px] text-zinc-600 mb-2 font-mono">{age}</p>
              <button onClick={() => { onRefreshGroup(s.key); onRefreshAll() }} disabled={refreshingGroup === s.key || refreshing}
                className="w-full flex items-center justify-center gap-1 px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-[9px] text-zinc-400 transition-colors font-mono">
                <RefreshCw className={`w-2.5 h-2.5 ${refreshingGroup === s.key ? 'animate-spin' : ''}`}/>Refresh
              </button>
            </div>
          )
        })}
      </div>


      {error && <div className="p-3 rounded-lg bg-red-900/30 border border-red-800 text-red-300 text-sm flex items-center gap-2"><AlertTriangle className="w-4 h-4 shrink-0"/>{error}</div>}
      {!data && !error && <div className="flex items-center justify-center h-32 text-zinc-500 text-sm"><RefreshCw className="w-4 h-4 animate-spin mr-2"/>Loading telemetry…</div>}

      {data && (
        <>
          {/* Quota tiles */}
          {q ? (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {[
                  { label: 'Credits Used',   value: q.creditsUsed.toLocaleString(),                                   sub: `of ${q.monthlyBudget.toLocaleString()} monthly`,                     cls: 'text-white'                    },
                  { label: 'Budget Used',    value: `${q.pctUsed}%`,                                                   sub: q.warningLevel,                                                        cls: warningColor(q.warningLevel)     },
                  { label: 'Req / Minute',   value: String(q.requestsLastMinute),                                      sub: `of ${q.perMinuteLimit} limit`,                                        cls: q.requestsLastMinute >= q.perMinuteLimit ? 'text-red-400' : 'text-white' },
                  { label: 'Cache Freshness',value: `${data.groups.filter(g => !g.isStale).length}/${data.groups.length}`, sub: 'groups fresh',                                                  cls: data.groups.every(g => !g.isStale) ? 'text-emerald-400' : 'text-amber-400' },
                ].map(c => (
                  <div key={c.label} className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3">
                    <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">{c.label}</p>
                    <p className={`text-2xl font-bold font-mono ${c.cls}`}>{c.value}</p>
                    <p className="text-[10px] text-zinc-500 capitalize mt-0.5">{c.sub}</p>
                  </div>
                ))}
              </div>

              {/* Budget progress bar */}
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2.5">
                  <div className="flex items-center gap-2 text-sm text-zinc-300">
                    <Shield className="w-4 h-4 text-blue-400"/>Monthly Budget
                  </div>
                  <div className="text-[10px] text-zinc-500 flex items-center gap-2">
                    <span>Resets {formatTs(q.resetAt)}</span>
                    {q.projectedExhaustionDate && (
                      <span className="text-orange-400">· Exhaustion {formatTs(q.projectedExhaustionDate)}</span>
                    )}
                  </div>
                </div>
                <div className="w-full h-2.5 rounded-full bg-zinc-800 overflow-hidden">
                  <div className={`h-full rounded-full transition-all ${warningBg(q.warningLevel)}`} style={{width:`${Math.min(q.pctUsed, 100)}%`}}/>
                </div>
                <div className="flex items-center justify-between mt-1.5 text-[10px] text-zinc-500">
                  <span className="font-mono">{q.creditsUsed.toLocaleString()} used</span>
                  <span className="font-mono">{q.projectedMonthlyUse.toLocaleString()} projected</span>
                  <span className="font-mono">{q.creditsRemaining.toLocaleString()} remaining</span>
                </div>
                {q.throttled && (
                  <div className="mt-2 text-xs text-red-400 flex items-center gap-1.5 pt-2 border-t border-zinc-800">
                    <AlertTriangle className="w-3 h-3"/>Quota guard THROTTLED — new requests blocked
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 text-zinc-500 text-sm">
              CMC quota data unavailable — ensure COINMARKETCAP_API_KEY is set.
            </div>
          )}

          {/* Cache groups */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-[10px] text-zinc-500 uppercase tracking-widest">Cache Groups</p>
              <span className="text-[10px] text-zinc-600 font-mono">
                {data.groups.filter(g => !g.isStale).length}/{data.groups.length} fresh
                {data.overallHitRate > 0 && ` · ${Math.round(data.overallHitRate * 100)}% hit rate`}
              </span>
            </div>
            <div className="space-y-2">
              {data.groups.map(group => {
                const hitPct = Math.round((group.hitRate ?? 0) * 100)
                const total  = (group.hitCount ?? 0) + (group.missCount ?? 0)
                return (
                  <div key={group.name} className={`bg-zinc-900 border rounded-xl px-4 py-3 transition-colors ${group.isStale ? 'border-orange-500/25' : 'border-zinc-800'}`}>
                    <div className="flex items-center gap-3">
                      <div className={`shrink-0 ${group.isStale ? 'text-orange-400' : 'text-zinc-500'}`}>{GROUP_ICONS[group.name] ?? <Database className="w-4 h-4"/>}</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm font-medium text-white">{group.label}</span>
                          <span className={`text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded border ${group.isStale ? 'text-orange-400 bg-orange-900/30 border-orange-700/40' : 'text-emerald-400 bg-emerald-900/30 border-emerald-700/40'}`}>
                            {group.isStale ? 'STALE' : 'FRESH'}
                          </span>
                          <span className="text-[9px] text-zinc-600 hidden sm:inline font-mono">{formatAge(group.ageSeconds)} · {formatTtl(group.ttlMs)}</span>
                        </div>
                        {total > 0 && (
                          <div className="flex items-center gap-2 mt-1.5">
                            <div className="flex-1 h-1 rounded-full bg-zinc-800 overflow-hidden max-w-[120px]">
                              <div className="h-full bg-emerald-500/70 rounded-full" style={{width:`${hitPct}%`}}/>
                            </div>
                            <span className="text-[9px] font-mono text-zinc-500">{hitPct}% hit · {total} calls</span>
                          </div>
                        )}
                      </div>
                      <button onClick={() => onRefreshGroup(group.name)} disabled={refreshingGroup === group.name}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-[10px] text-zinc-400 transition-colors shrink-0 font-mono">
                        <RefreshCw className={`w-3 h-3 ${refreshingGroup === group.name ? 'animate-spin' : ''}`}/><span className="hidden sm:inline">Refresh</span>
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Background workers */}
          {data.workers.length > 0 && (
            <div>
              <p className="text-[10px] text-zinc-500 uppercase tracking-widest mb-2.5">Background Workers</p>
              <div className="space-y-1.5">
                {data.workers.map(w => (
                  <div key={w.name} className="bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-2.5 flex items-center gap-3">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${w.state === 'running' ? 'bg-blue-400 animate-pulse' : w.state === 'error' ? 'bg-red-400 animate-pulse' : w.state === 'stopped' ? 'bg-zinc-600' : 'bg-emerald-400'}`}/>
                    <span className="text-xs font-mono text-zinc-300 flex-1 min-w-0 truncate">{w.name}</span>
                    <span className={`text-[10px] font-medium hidden sm:block shrink-0 ${workerStateColor(w.state)}`}>{w.state}</span>
                    <span className="text-[9px] text-zinc-600 font-mono hidden md:block shrink-0">{w.tickCount} ticks · next {formatTs(w.nextTickAt)}</span>
                    {w.errorCount > 0 && <span className="text-[10px] text-red-400 bg-red-900/20 border border-red-800/40 px-1.5 py-0.5 rounded shrink-0">{w.errorCount} err</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Footer */}
          <div className="flex items-center gap-4 text-[10px] text-zinc-600 pt-2 border-t border-zinc-800">
            <div className="flex items-center gap-1.5">
              {data.cmcEnabled ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500"/> : <AlertTriangle className="w-3.5 h-3.5 text-orange-400"/>}
              CMC API {data.cmcEnabled ? 'configured' : 'key missing'}
            </div>
            {data.lastPreloadAt && (
              <div className="flex items-center gap-1.5">
                <Clock className="w-3 h-3"/>
                Last preload {formatTs(data.lastPreloadAt)}
                {data.lastPreloadDurationMs && <span className="text-zinc-700">· {Math.round(data.lastPreloadDurationMs / 1000)}s</span>}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

// ── Sectors tab ──────────────────────────────────────────────────────────────

function SectorsTab({ data, error }: { data: SectorsResponse | null; error: string | null }) {
  const cats = data?.categories ? [...data.categories].sort((a, b) => b.avgPriceChange - a.avgPriceChange) : null
  const statusCounts = cats ? {
    overcrowded:  cats.filter(c => c.avgPriceChange > 12).length,
    strongest:    cats.filter(c => c.avgPriceChange > 7  && c.avgPriceChange <= 12).length,
    accelerating: cats.filter(c => c.avgPriceChange > 3  && c.avgPriceChange <= 7).length,
    neutral:      cats.filter(c => c.avgPriceChange >= -3 && c.avgPriceChange <= 3).length,
    weakening:    cats.filter(c => c.avgPriceChange < -3).length,
  } : null

  if (error)  return <div className="p-3 rounded-lg bg-red-900/30 border border-red-800 text-red-300 text-sm flex items-center gap-2"><AlertTriangle className="w-4 h-4"/>{error}</div>
  if (!data)  return <div className="flex items-center justify-center h-32 text-zinc-500 text-sm"><RefreshCw className="w-4 h-4 animate-spin mr-2"/>Loading…</div>

  const total = cats?.length ?? 0

  return (
    <div className="space-y-5 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-zinc-500">Updated {data ? new Date(data.computedAt).toLocaleTimeString() : '—'}</p>
        {cats && <span className="text-[10px] text-zinc-600 font-mono">{total} sectors tracked</span>}
      </div>

      {/* Strongest / Weakest hero */}
      {(data.strongest || data.weakest) && (
        <div className="grid grid-cols-2 gap-3">
          {data.strongest && (
            <div className="bg-zinc-900 border border-emerald-500/20 rounded-xl px-4 py-3 flex items-center gap-3">
              <TrendingUp className="w-5 h-5 text-emerald-400 shrink-0"/>
              <div className="min-w-0">
                <p className="text-[9px] text-zinc-500 uppercase tracking-wider">Strongest Sector</p>
                <p className="text-sm font-bold text-emerald-400 truncate mt-0.5">{data.strongest}</p>
              </div>
            </div>
          )}
          {data.weakest && (
            <div className="bg-zinc-900 border border-red-500/20 rounded-xl px-4 py-3 flex items-center gap-3">
              <TrendingDown className="w-5 h-5 text-red-400 shrink-0"/>
              <div className="min-w-0">
                <p className="text-[9px] text-zinc-500 uppercase tracking-wider">Weakest Sector</p>
                <p className="text-sm font-bold text-red-400 truncate mt-0.5">{data.weakest}</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Status distribution bar */}
      {statusCounts && total > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3">
          <p className="text-[10px] text-zinc-500 uppercase tracking-widest mb-3">Sector Distribution</p>
          <div className="flex h-2 rounded-full overflow-hidden gap-0.5 mb-3">
            {statusCounts.overcrowded  > 0 && <div className="bg-red-500"     style={{flex: statusCounts.overcrowded}}/>}
            {statusCounts.strongest    > 0 && <div className="bg-blue-500"    style={{flex: statusCounts.strongest}}/>}
            {statusCounts.accelerating > 0 && <div className="bg-emerald-500" style={{flex: statusCounts.accelerating}}/>}
            {statusCounts.neutral      > 0 && <div className="bg-zinc-600"    style={{flex: statusCounts.neutral}}/>}
            {statusCounts.weakening    > 0 && <div className="bg-amber-500"   style={{flex: statusCounts.weakening}}/>}
          </div>
          <div className="flex flex-wrap gap-2">
            {statusCounts.overcrowded  > 0 && <span className="flex items-center gap-1 text-[10px] font-mono text-red-400"><span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0"/>{statusCounts.overcrowded} Overcrowded</span>}
            {statusCounts.strongest    > 0 && <span className="flex items-center gap-1 text-[10px] font-mono text-blue-400"><span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0"/>{statusCounts.strongest} Strongest</span>}
            {statusCounts.accelerating > 0 && <span className="flex items-center gap-1 text-[10px] font-mono text-emerald-400"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0"/>{statusCounts.accelerating} Accelerating</span>}
            {statusCounts.neutral      > 0 && <span className="flex items-center gap-1 text-[10px] font-mono text-zinc-400"><span className="w-1.5 h-1.5 rounded-full bg-zinc-600 shrink-0"/>{statusCounts.neutral} Neutral</span>}
            {statusCounts.weakening    > 0 && <span className="flex items-center gap-1 text-[10px] font-mono text-amber-400"><span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0"/>{statusCounts.weakening} Weakening</span>}
          </div>
        </div>
      )}

      {/* Sector grid */}
      {cats && cats.length > 0 && (
        <div>
          <p className="text-[10px] text-zinc-500 uppercase tracking-widest mb-3">CMC Ecosystem Categories</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {cats.slice(0, 18).map(cat => {
              const st = sectorStatus(cat.avgPriceChange)
              const absChange = Math.abs(cat.avgPriceChange)
              const barWidth  = Math.min(absChange / 15 * 100, 100)
              return (
                <div key={cat.id} className={`bg-zinc-900 border border-zinc-800 border-l-2 ${st.border} rounded-xl px-4 py-3`}>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-white truncate">{cat.title || cat.name}</p>
                      <p className="text-[9px] text-zinc-500 mt-0.5 font-mono">{fmtB(cat.marketCap)} · {cat.coinCount} coins</p>
                    </div>
                    <span className={`font-mono text-sm font-bold shrink-0 ${cat.avgPriceChange >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {cat.avgPriceChange >= 0 ? '+' : ''}{fmt(cat.avgPriceChange)}%
                    </span>
                  </div>
                  {/* Mini price bar */}
                  <div className="w-full h-1 rounded-full bg-zinc-800 overflow-hidden mb-2">
                    <div
                      className={`h-full rounded-full transition-all ${cat.avgPriceChange >= 0 ? 'bg-emerald-500/60' : 'bg-red-500/60'}`}
                      style={{width:`${barWidth}%`}}
                    />
                  </div>
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded border ${
                      st.label === 'OVERCROWDED'  ? 'text-red-400 border-red-500/30 bg-red-500/8'        :
                      st.label === 'STRONGEST'    ? 'text-blue-400 border-blue-500/30 bg-blue-500/8'      :
                      st.label === 'ACCELERATING' ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/8' :
                      st.label === 'WEAKENING'    ? 'text-amber-400 border-amber-500/30 bg-amber-500/8'   :
                      st.label === 'DECLINING'    ? 'text-red-400/70 border-red-500/20 bg-red-500/5'      :
                      'text-zinc-600 border-zinc-700/40 bg-zinc-800/40'
                    }`}>{st.label}</span>
                    <span className="text-[9px] font-mono text-zinc-600">{fmtB(cat.volume24h)} vol</span>
                  </div>
                  {cat.coins.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {cat.coins.slice(0, 8).map(c => (
                        <span key={c} className="text-[9px] font-mono text-zinc-400 px-1.5 py-0.5 rounded bg-zinc-800/80 border border-zinc-700/40">{c}</span>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Market tab ───────────────────────────────────────────────────────────────

function MarketTab({ data, news, error }: { data: IntelligenceData | null; news: NewsSnapshot | null; error: string | null }) {
  if (error)  return <div className="p-3 rounded-lg bg-red-900/30 border border-red-800 text-red-300 text-sm flex items-center gap-2"><AlertTriangle className="w-4 h-4"/>{error}</div>
  if (!data)  return <div className="flex items-center justify-center h-32 text-zinc-500 text-sm"><RefreshCw className="w-4 h-4 animate-spin mr-2"/>Loading…</div>

  const regime = data.regime
  const meta   = regime ? REGIME_META[regime.regime] : null

  function Change({ val, size = 'sm' }: { val: number; size?: 'sm' | 'xs' }) {
    const pos = val >= 0
    const cls = size === 'sm'
      ? `inline-flex items-center gap-0.5 text-xs font-medium px-1.5 py-0.5 rounded ${pos ? 'text-emerald-400 bg-emerald-500/10' : 'text-red-400 bg-red-500/10'}`
      : `text-[10px] font-mono font-semibold ${pos ? 'text-emerald-400' : 'text-red-400'}`
    return (
      <span className={cls}>
        {size === 'sm' && (pos ? <ArrowUpRight className="w-3 h-3"/> : <ArrowDownRight className="w-3 h-3"/>)}
        {pos && size === 'xs' ? '+' : ''}{Math.abs(val).toFixed(2)}%
      </span>
    )
  }

  return (
    <div className="space-y-5 max-w-5xl">

      {/* ── Section 1: BTC Regime ── */}
      <div>
        <p className="text-[10px] text-zinc-600 uppercase tracking-widest mb-2.5 font-mono">BTC Market Regime</p>
        {regime && meta ? (
          <div className={`rounded-xl border ${meta.border} ${meta.bg} px-5 py-4`}>
            <div className="flex items-center gap-4">
              <div className="text-3xl leading-none select-none shrink-0">{meta.icon}</div>
              <div className="flex-1 min-w-0">
                <p className={`text-2xl font-bold ${meta.color}`}>{meta.label}</p>
                <p className="text-xs text-zinc-400 mt-0.5">{meta.desc}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-[9px] text-zinc-500 uppercase tracking-wider mb-0.5">RSI 4h</p>
                <p className={`text-2xl font-bold font-mono ${regime.btcRsi4h > 70 ? 'text-red-400' : regime.btcRsi4h < 30 ? 'text-emerald-400' : 'text-white'}`}>
                  {fmt(regime.btcRsi4h, 1)}
                </p>
              </div>
            </div>
            <div className="mt-3 pt-3 border-t border-white/8 grid grid-cols-3 gap-4">
              <div>
                <p className="text-[9px] text-zinc-500 uppercase tracking-wider mb-1">BTC 24h Change</p>
                <Change val={regime.btc24hChange}/>
              </div>
              <div>
                <p className="text-[9px] text-zinc-500 uppercase tracking-wider mb-1">Volatility (ATR%)</p>
                <p className={`text-sm font-mono font-semibold ${regime.btcAtrPct > 4 ? 'text-amber-400' : 'text-white'}`}>
                  {fmt(regime.btcAtrPct, 2)}% {regime.btcAtrPct > 4 ? '⚡ elevated' : ''}
                </p>
              </div>
              <div>
                <p className="text-[9px] text-zinc-500 uppercase tracking-wider mb-1">4h Trend</p>
                <div className={`flex items-center gap-1 text-sm font-semibold ${regime.btcTrend4h === 'BULLISH' ? 'text-emerald-400' : regime.btcTrend4h === 'BEARISH' ? 'text-red-400' : 'text-zinc-400'}`}>
                  {regime.btcTrend4h === 'BULLISH' && <TrendingUp className="w-3.5 h-3.5"/>}
                  {regime.btcTrend4h === 'BEARISH' && <TrendingDown className="w-3.5 h-3.5"/>}
                  {regime.btcTrend4h}
                </div>
              </div>
            </div>
            <p className="text-[9px] text-zinc-600 mt-2 font-mono">computed {formatTs(regime.computedAt)}</p>
          </div>
        ) : (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 px-5 py-3 text-xs text-zinc-500 text-center">
            Regime data unavailable — BTC klines may not be cached yet.
          </div>
        )}
      </div>

      {/* ── Section 2: Global Market Metrics ── */}
      <div>
        <p className="text-[10px] text-zinc-600 uppercase tracking-widest mb-2.5 font-mono">Global Market Metrics</p>
        {data.global ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Total Market Cap', value: fmtB(data.global.totalMarketCapUsd), sub: <Change val={data.global.marketCapChangePercent24h}/> },
              { label: '24h Volume',       value: fmtB(data.global.totalVolume24hUsd), sub: <span className="text-[10px] text-zinc-500">rolling 24h</span> },
              { label: 'BTC Dominance',    value: `${fmt(data.global.btcDominance, 1)}%`, sub: <span className="text-[10px] text-zinc-500">market share</span> },
              { label: 'ETH Dominance',    value: `${fmt(data.global.ethDominance, 1)}%`, sub: <span className="text-[10px] text-zinc-500">market share</span> },
            ].map(m => (
              <div key={m.label} className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3">
                <p className="text-[9px] text-zinc-500 uppercase tracking-wider mb-1">{m.label}</p>
                <p className="text-lg font-bold text-white">{m.value}</p>
                <div className="mt-0.5">{m.sub}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 px-5 py-3 text-xs text-zinc-500 text-center">
            CMC global cache cold — go to Cache tab → Refresh Global Metrics.
          </div>
        )}
      </div>

      {/* ── Section 3: Market Breadth + Top Movers ── */}
      {data.listings && (
        <div>
          <p className="text-[10px] text-zinc-600 uppercase tracking-widest mb-2.5 font-mono">Market Breadth · Top 200 Coins</p>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-5 py-4">
            {/* Breadth bar */}
            <div className="flex items-center gap-3 mb-1.5">
              <div className="w-16 text-right">
                <span className="text-lg font-bold font-mono text-emerald-400">{data.listings.breadthUp}%</span>
              </div>
              <div className="flex-1 h-3 rounded-full bg-zinc-800 overflow-hidden flex">
                <div className="h-full bg-emerald-500 transition-all" style={{width:`${data.listings.breadthUp}%`}}/>
                <div className="h-full bg-red-500 flex-1 transition-all"/>
              </div>
              <div className="w-16">
                <span className="text-lg font-bold font-mono text-red-400">{data.listings.breadthDown}%</span>
              </div>
            </div>
            <div className="flex text-[10px] text-zinc-500 px-[4.5rem]">
              <span className="text-emerald-400/60">▲ Advancing</span>
              <span className="ml-auto text-red-400/60">Declining ▼</span>
            </div>
            {/* Top movers */}
            {data.listings.topMovers && data.listings.topMovers.length > 0 && (
              <div className="mt-4 pt-3 border-t border-zinc-800">
                <p className="text-[9px] text-zinc-600 uppercase tracking-widest mb-2">Top Movers (24h)</p>
                <div className="flex flex-wrap gap-1.5">
                  {data.listings.topMovers.slice(0, 10).map(m => (
                    <span key={m.symbol} className={`text-[10px] font-mono font-semibold px-2 py-0.5 rounded border ${m.change >= 0 ? 'text-emerald-400 border-emerald-500/25 bg-emerald-500/5' : 'text-red-400 border-red-500/25 bg-red-500/5'}`}>
                      {m.symbol} {m.change >= 0 ? '+' : ''}{m.change.toFixed(1)}%
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Section 4: Trending Assets ── */}
      {data.trending && data.trending.trending.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2.5">
            <p className="text-[10px] text-zinc-600 uppercase tracking-widest font-mono">Trending Assets</p>
            <p className="text-[9px] text-zinc-600 font-mono">refreshed {formatTs(data.trending.refreshedAt)}</p>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
            {/* Header */}
            <div className="grid grid-cols-[2rem_1fr_3rem_3rem_4rem] gap-2 px-4 py-1.5 border-b border-zinc-800/60 bg-zinc-800/30">
              <span className="text-[9px] text-zinc-600 font-mono">Rank</span>
              <span className="text-[9px] text-zinc-600 font-mono">Coin</span>
              <span className="text-[9px] text-zinc-600 font-mono text-right">1h</span>
              <span className="text-[9px] text-zinc-600 font-mono text-right">24h</span>
              <span className="text-[9px] text-zinc-600 font-mono text-right hidden md:block">Volume</span>
            </div>
            {data.trending.trending.slice(0, 10).map(coin => (
              <div key={coin.id} className="grid grid-cols-[2rem_1fr_3rem_3rem_4rem] gap-2 items-center px-4 py-2 border-b border-zinc-800/40 last:border-0 hover:bg-zinc-800/20 transition-colors">
                <span className="text-[9px] text-zinc-600 font-mono text-right">#{coin.rank}</span>
                <div className="min-w-0">
                  <span className="text-xs font-bold font-mono text-white">{coin.symbol}</span>
                  <span className="text-[9px] text-zinc-500 ml-1.5 hidden sm:inline">{coin.name}</span>
                </div>
                <div className="text-right">
                  <Change val={coin.priceChange1h} size="xs"/>
                </div>
                <div className="text-right">
                  <Change val={coin.priceChange24h} size="xs"/>
                </div>
                {coin.volume24h > 0 ? (
                  <div className="text-right hidden md:block">
                    <span className="text-[9px] font-mono text-zinc-400">{fmtB(coin.volume24h)}</span>
                  </div>
                ) : <div/>}
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  )
}

// ── News tab ──────────────────────────────────────────────────────────────────
const FG_COLOR_MAP: Record<string, string> = {
  'Extreme Fear': 'text-red-400', 'Fear': 'text-orange-400',
  'Neutral': 'text-yellow-400', 'Greed': 'text-emerald-400', 'Extreme Greed': 'text-emerald-300',
}

function timeAgo(iso: string): string {
  try {
    const diff = Date.now() - new Date(iso).getTime()
    if (diff < 0) return 'just now'
    const m = Math.floor(diff / 60_000)
    if (m < 1)   return 'just now'
    if (m < 60)  return `${m}m ago`
    if (m < 1440) return `${Math.floor(m / 60)}h ago`
    return `${Math.floor(m / 1440)}d ago`
  } catch { return '' }
}

function NewsTab({ data, loading }: { data: NewsSnapshot | null; loading: boolean }) {
  if (loading && !data) {
    return (
      <div className="flex items-center justify-center h-40 gap-3 text-zinc-500 text-sm">
        <RefreshCw className="w-4 h-4 animate-spin text-violet-400"/>
        <span>Loading news…</span>
      </div>
    )
  }
  if (!data) return null

  // Top coins by total mentions, sorted by |net| then total
  const coinEntries = Object.entries(data.coinSentiment ?? {})
    .map(([coin, s]) => ({ coin, ...s, total: s.bullish + s.bearish }))
    .filter(e => e.total > 0)
    .sort((a, b) => Math.abs(b.net) - Math.abs(a.net) || b.total - a.total)
    .slice(0, 12)

  return (
    <div className="space-y-4 max-w-5xl">
      {/* Fear & Greed + overall sentiment */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {data.fearGreedValue !== null && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-center">
            <p className="text-[9px] text-zinc-500 uppercase tracking-wider mb-1">Fear &amp; Greed</p>
            <p className={`text-2xl font-bold font-mono ${FG_COLOR_MAP[data.fearGreedLabel ?? ''] ?? 'text-zinc-400'}`}>{data.fearGreedValue}</p>
            <p className={`text-[9px] mt-0.5 font-semibold ${FG_COLOR_MAP[data.fearGreedLabel ?? ''] ?? 'text-zinc-500'}`}>{data.fearGreedLabel}</p>
          </div>
        )}
        <div className="bg-zinc-900 border border-emerald-500/20 rounded-xl px-4 py-3 text-center">
          <p className="text-[9px] text-zinc-500 uppercase tracking-wider mb-1">Bullish</p>
          <p className="text-2xl font-bold font-mono text-emerald-400">{data.bullishCount}</p>
        </div>
        <div className="bg-zinc-900 border border-red-500/20 rounded-xl px-4 py-3 text-center">
          <p className="text-[9px] text-zinc-500 uppercase tracking-wider mb-1">Bearish</p>
          <p className="text-2xl font-bold font-mono text-red-400">{data.bearishCount}</p>
        </div>
        <div className="bg-zinc-900 border border-zinc-700/40 rounded-xl px-4 py-3 text-center">
          <p className="text-[9px] text-zinc-500 uppercase tracking-wider mb-1">Total</p>
          <p className="text-2xl font-bold font-mono text-zinc-300">{data.headlines.length}</p>
        </div>
      </div>

      {/* Coin impact panel */}
      {coinEntries.length > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
          <p className="text-[9px] text-zinc-500 uppercase tracking-widest font-mono mb-3">Coin Impact</p>
          <div className="flex flex-wrap gap-2">
            {coinEntries.map(({ coin, bullish, bearish, net }) => {
              const dominant = net > 0 ? 'bullish' : net < 0 ? 'bearish' : 'neutral'
              return (
                <div key={coin} className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-mono ${
                  dominant === 'bullish' ? 'bg-emerald-500/8 border-emerald-500/25 text-emerald-300' :
                  dominant === 'bearish' ? 'bg-red-500/8 border-red-500/25 text-red-300' :
                  'bg-zinc-800/60 border-zinc-700 text-zinc-400'
                }`}>
                  <span className="font-bold">{coin}</span>
                  <span className="text-[9px] opacity-70">
                    {bullish > 0 && <span className="text-emerald-400">▲{bullish}</span>}
                    {bullish > 0 && bearish > 0 && ' '}
                    {bearish > 0 && <span className="text-red-400">▼{bearish}</span>}
                  </span>
                </div>
              )
            })}
          </div>
          <p className="text-[9px] text-zinc-600 mt-2 font-mono">Based on {data.headlines.length} headlines · keyword analysis</p>
        </div>
      )}

      {/* Article feed */}
      {data.headlines.length > 0 ? (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl divide-y divide-zinc-800/60">
          {data.headlines.map((item, i) => (
            <a key={i} href={item.url} target="_blank" rel="noopener noreferrer"
              className="flex items-start gap-3 px-4 py-3 hover:bg-zinc-800/30 transition-colors group">
              <span className={`text-[9px] px-1.5 py-0.5 rounded border shrink-0 mt-0.5 font-bold ${SENT_STYLE[item.sentiment ?? 'neutral']}`}>
                {item.sentiment === 'bullish' ? 'B+' : item.sentiment === 'bearish' ? 'B−' : 'N'}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-zinc-100 leading-snug group-hover:text-white transition-colors line-clamp-2">{item.title}</p>
                {item.coins && item.coins.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {item.coins.slice(0, 4).map(c => (
                      <span key={c} className="text-[9px] px-1 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-400 font-mono">{c}</span>
                    ))}
                  </div>
                )}
                <p className="text-[9px] text-zinc-600 mt-1 font-mono">{item.source} · {timeAgo(item.publishedAt)}</p>
              </div>
              <ArrowUpRight className="w-3.5 h-3.5 text-zinc-700 group-hover:text-zinc-400 shrink-0 mt-0.5 transition-colors"/>
            </a>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 px-5 py-8 text-xs text-zinc-500 text-center">
          No headlines available — refreshes every 15 minutes.
        </div>
      )}
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

type Tab = 'providers' | 'cache' | 'sectors' | 'market' | 'news'

const TABS: { id: Tab; label: string; sub: string }[] = [
  { id: 'providers', label: 'Providers', sub: '8 services'   },
  { id: 'cache',     label: 'Cache',     sub: 'CMC quota'    },
  { id: 'sectors',   label: 'Sectors',   sub: 'CMC ecosystem'},
  { id: 'market',    label: 'Market',    sub: 'regime + news'},
  { id: 'news',      label: 'News',      sub: 'Grok live'    },
]

export default function IntelligenceCenterPage() {
  const [tab, setTab] = useState<Tab>('providers')

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab') as Tab | null
    if (t && TABS.some(x => x.id === t)) setTab(t)
  }, [])

  const [refreshing,       setRefreshing]       = useState(false)
  const [refreshingGroup,  setRefreshingGroup]  = useState<string | null>(null)
  const [cacheError,       setCacheError]       = useState<string | null>(null)
  const [sectorsError,     setSectorsError]     = useState<string | null>(null)
  const [marketError,      setMarketError]      = useState<string | null>(null)
  // ── Data fetchers ─────────────────────────────────────────────────────────
  const providerFetcher = useCallback(() =>
    fetch('/api/health/providers').then(r => r.json()).then(j => j.providers ?? []).catch(() => []), [])
  const cacheFetcher = useCallback(async () => {
    const res  = await fetch('/api/cache/intelligence')
    const json = await res.json()
    if (json.success) { setCacheError(null); return json.telemetry as IntelligenceTelemetry }
    setCacheError(json.error); return null
  }, [])
  const sectorsFetcher = useCallback(async () => {
    const res  = await fetch('/api/market/sectors')
    const json = await res.json()
    if (json.success) { setSectorsError(null); return json as SectorsResponse }
    setSectorsError(json.error); return null
  }, [])
  const marketFetcher = useCallback(async () => {
    const res  = await fetch('/api/market/intelligence')
    const json = await res.json()
    if (json.success) { setMarketError(null); return json as IntelligenceData }
    setMarketError(json.error); return null
  }, [])
  const newsFetcher = useCallback(() =>
    fetch('/api/news').then(r => r.json()).then(j => j.success ? j : null).catch(() => null), [])

  const { data: providers, loading: provLoading } = useSharedPolling<ProviderCheckResult[]>('intelligence:providers', providerFetcher, 120_000)
  const { data: cacheData, refresh: refreshCache }   = useSharedPolling<IntelligenceTelemetry | null>('intelligence:cache',   cacheFetcher,   120_000)
  const { data: sectors,   refresh: refreshSectors } = useSharedPolling<SectorsResponse | null>       ('intelligence:sectors', sectorsFetcher,  60_000)
  const { data: market,    refresh: refreshMarket  } = useSharedPolling<IntelligenceData | null>       ('intelligence:market',  marketFetcher,  120_000)
  const { data: news    }                            = useAutoRefresh<NewsSnapshot | null>(newsFetcher, 900_000)

  // ── Cache actions ─────────────────────────────────────────────────────────
  function refreshAllPolling() { refreshCache(); refreshSectors(); refreshMarket() }

  async function handleForceRefresh() {
    setRefreshing(true)
    try {
      const res  = await fetch('/api/cache/intelligence', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ force: true }) })
      const json = await res.json()
      if (json.success) { setCacheError(null) }
      else setCacheError(json.error)
    } catch (err) { setCacheError(err instanceof Error ? err.message : String(err)) }
    finally { setRefreshing(false) }
  }
  async function handleRefreshGroup(group: string) {
    setRefreshingGroup(group)
    try {
      const res  = await fetch(`/api/cache/intelligence/${group}`, { method: 'POST' })
      const json = await res.json()
      if (json.success) { setCacheError(null) }
      else setCacheError(json.error)
    } catch (err) { setCacheError(err instanceof Error ? err.message : String(err)) }
    finally { setRefreshingGroup(null) }
  }

  // ── Quick status bar ──────────────────────────────────────────────────────
  const up    = providers ? providers.filter(p => p.healthy).length : null
  const total = providers ? providers.length : null

  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg sm:text-xl font-semibold text-white">Intelligence Center</h1>
          <p className="text-xs text-zinc-500 mt-0.5">Data providers · CMC cache health · Sector momentum · Market regime</p>
        </div>
        {up !== null && total !== null && (
          <div className={`flex items-center gap-1.5 text-xs font-mono font-semibold px-2.5 py-1.5 rounded-lg border ${up === total ? 'text-emerald-400 border-emerald-500/25 bg-emerald-500/5' : up > total / 2 ? 'text-amber-400 border-amber-500/25 bg-amber-500/5' : 'text-red-400 border-red-500/25 bg-red-500/5'}`}>
            {up === total
              ? <CheckCircle2 className="w-3.5 h-3.5"/>
              : <AlertTriangle className="w-3.5 h-3.5"/>
            }
            {up}/{total} services up
          </div>
        )}
      </div>

      {/* Tab bar */}
      <div className="flex gap-0 border-b border-zinc-800 -mx-1">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-xs font-mono uppercase tracking-wider border-b-2 transition-colors ${tab === t.id ? 'border-white text-white' : 'border-transparent text-zinc-500 hover:text-zinc-300'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'providers' && <ProvidersTab providers={providers ?? []} loading={provLoading}/>}
      {tab === 'cache' && (
        <CacheTab
          data={cacheData ?? null}
          onForceRefresh={handleForceRefresh}
          onRefreshGroup={handleRefreshGroup}
          onRefreshAll={refreshAllPolling}
          refreshing={refreshing}
          refreshingGroup={refreshingGroup}
          error={cacheError}
        />
      )}
      {tab === 'sectors' && <SectorsTab data={sectors ?? null} error={sectorsError}/>}
      {tab === 'market'  && <MarketTab  data={market ?? null}  news={news ?? null} error={marketError}/>}
      {tab === 'news' && <NewsTab data={news ?? null} loading={!news}/>}
    </div>
  )
}
