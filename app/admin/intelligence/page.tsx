'use client'

import { useState, useCallback, useEffect } from 'react'
import {
  Database, Layers, Globe, Activity,
  TrendingUp, TrendingDown, RefreshCw,
  CheckCircle2, AlertTriangle, BarChart2, Zap,
  ArrowUpRight, ArrowDownRight, Newspaper, ChevronRight,
  Shield,
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
interface NewsItem { title: string; url: string; source: string; publishedAt: string; sentiment?: 'bullish' | 'bearish' | 'neutral' }
interface NewsSnapshot { fearGreedValue: number | null; fearGreedLabel: string | null; headlines: NewsItem[]; bullishCount: number; bearishCount: number; neutralCount: number; cachedAt: string }

// ── Constants ────────────────────────────────────────────────────────────────

const PROVIDER_META: Record<string, { label: string; role: string; color: string; quotaNote: string; stackRole: string }> = {
  coinmarketcap: { label: 'CoinMarketCap', role: 'Market Intelligence',    color: '#3861fb', quotaNote: 'Startup · 10k req/day',  stackRole: 'Primary Intelligence' },
  binance:       { label: 'Binance',        role: 'Tactical Execution',     color: '#f0b90b', quotaNote: 'Rate-limited by IP',    stackRole: 'Tactical Execution'   },
  coingecko:     { label: 'CoinGecko',      role: 'Backup Intelligence',    color: '#2d9e49', quotaNote: 'Free tier',             stackRole: 'Backup Redundancy'    },
  dexscreener:   { label: 'DexScreener',    role: 'Low-Cap Intelligence',   color: '#7c3aed', quotaNote: 'Unlimited',             stackRole: 'Optional Low-Cap'     },
  coinpaprika:   { label: 'CoinPaprika',    role: 'Legacy Provider',        color: '#4b5563', quotaNote: 'Rate-limited',          stackRole: 'Legacy'               },
}
const REGIME_META: Record<string, { label: string; color: string; border: string; desc: string }> = {
  BULL_TREND:      { label: 'Bull Trend',     color: 'text-green-400',  border: 'border-green-500/25',  desc: 'BTC 4h bullish · strong trend momentum' },
  BEAR_TREND:      { label: 'Bear Trend',      color: 'text-red-400',    border: 'border-red-500/25',    desc: 'BTC 4h bearish · sustained selling pressure' },
  SIDEWAYS:        { label: 'Sideways',        color: 'text-zinc-400',   border: 'border-zinc-500/25',   desc: 'No directional bias · price consolidating' },
  HIGH_VOLATILITY: { label: 'High Volatility', color: 'text-amber-400',  border: 'border-amber-500/25',  desc: 'ATR elevated · increased whipsaw risk' },
  EUPHORIA:        { label: 'Euphoria',        color: 'text-purple-400', border: 'border-purple-500/25', desc: 'Overbought · RSI > 78 · extreme greed' },
  CAPITULATION:    { label: 'Capitulation',    color: 'text-rose-400',   border: 'border-rose-500/25',   desc: 'Extreme fear · RSI < 22 · mass selling' },
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
  bullish: 'text-green-400 bg-green-500/10 border-green-500/20',
  bearish: 'text-red-400 bg-red-500/10 border-red-500/20',
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
  if (s < 60)    return `${s}s`
  if (s < 3600)  return `${Math.floor(s / 60)}m ${s % 60}s`
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}
function formatTtl(ms: number) {
  const s = ms / 1000
  if (s < 60)    return `${s}s`
  if (s < 3600)  return `${s / 60}m`
  return `${s / 3600}h`
}
function warningColor(level: QuotaGuardState['warningLevel']) {
  switch (level) {
    case 'emergency': return 'text-red-400'; case 'critical': return 'text-orange-400'
    case 'warning':   return 'text-yellow-400'; case 'caution': return 'text-yellow-300'
    default: return 'text-green-400'
  }
}
function sectorStatus(avgChange: number) {
  if (avgChange > 12) return { label: 'OVERCROWDED', cls: 'text-red-400',     border: 'border-l-red-500'      }
  if (avgChange > 7)  return { label: 'STRONGEST',   cls: 'text-blue-400',    border: 'border-l-blue-500'     }
  if (avgChange > 3)  return { label: 'ACCELERATING',cls: 'text-emerald-400', border: 'border-l-emerald-500'  }
  if (avgChange < -3) return { label: 'WEAKENING',   cls: 'text-amber-400',   border: 'border-l-amber-500'    }
  if (avgChange < -7) return { label: 'DECLINING',   cls: 'text-red-400',     border: 'border-l-red-600'      }
  return               { label: 'NEUTRAL',     cls: 'text-zinc-500',    border: 'border-l-zinc-600/40'  }
}
function workerStateColor(state: WorkerStatus['state']) {
  switch (state) { case 'running': return 'text-blue-400'; case 'error': return 'text-red-400'; case 'stopped': return 'text-zinc-500'; default: return 'text-green-400' }
}

// ── Providers tab ────────────────────────────────────────────────────────────

function ProvidersTab({ providers, loading }: { providers: ProviderCheckResult[]; loading: boolean }) {
  const up    = providers.filter(p => p.healthy).length
  const total = providers.length

  return (
    <div className="space-y-5 max-w-5xl">
      {/* Quick health summary */}
      <div className="flex flex-wrap gap-2 items-center">
        <span className={`text-xs font-mono font-bold ${up === total && total > 0 ? 'text-emerald-400' : up > total / 2 ? 'text-amber-400' : 'text-red-400'}`}>
          {loading ? '…' : `${up}/${total} up`}
        </span>
        {providers.slice(0,5).map(p => (
          <span key={p.name} className={`flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border ${p.healthy ? 'border-green-500/20 bg-green-500/5 text-green-400' : 'border-red-500/20 bg-red-500/5 text-red-400'}`}>
            <span className={`w-1 h-1 rounded-full shrink-0 ${p.healthy ? 'bg-green-400' : 'bg-red-400 animate-pulse'}`}/>{p.name}
          </span>
        ))}
      </div>

      {/* Health table */}
      {loading ? (
        <div className="glass-card rounded-xl p-4">
          <p className="text-terminal-muted text-[9px] uppercase tracking-widest mb-3">Provider Health — 8 Services</p>
          <div className="space-y-1.5">{Array.from({length:6}).map((_,i)=><div key={i} className="skeleton h-7 rounded"/>)}</div>
        </div>
      ) : (
        <ProviderHealthTable providers={providers} />
      )}

      {/* Provider metadata cards */}
      <div>
        <p className="text-terminal-muted text-[9px] uppercase tracking-widest mb-2.5">Data Provider Stack</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
          {Object.entries(PROVIDER_META).filter(([k]) => k !== 'coinpaprika').map(([key, meta]) => {
            const health = providers.find(p => p.name.toLowerCase() === meta.label.toLowerCase().replace('coinmarketcap','cmc').replace('coingecko','coingecko'))
            const up = health?.healthy
            return (
              <div key={key} className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: meta.color }}/>
                  <span className="text-sm font-semibold text-white">{meta.label}</span>
                  {up !== undefined && (
                    <span className={`ml-auto text-[9px] font-mono font-bold px-1.5 py-0.5 rounded border ${up ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/5' : 'text-red-400 border-red-500/30 bg-red-500/5'}`}>
                      {up ? 'UP' : 'DOWN'}
                    </span>
                  )}
                </div>
                <p className="text-[10px] text-zinc-500">{meta.role}</p>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-[9px] font-mono text-zinc-600">{meta.quotaNote}</span>
                  <span className="text-[9px] text-zinc-600">{meta.stackRole}</span>
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

function CacheTab({ data, onForceRefresh, onRefreshGroup, refreshing, refreshingGroup, error }: {
  data: IntelligenceTelemetry | null
  onForceRefresh: () => void; onRefreshGroup: (g: string) => void
  refreshing: boolean; refreshingGroup: string | null; error: string | null
}) {
  const q = data?.quota

  return (
    <div className="space-y-5 max-w-5xl">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-white">Cache Intelligence</p>
        <button onClick={onForceRefresh} disabled={refreshing}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-xs font-medium text-white transition-colors">
          <RefreshCw className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`}/>Refresh All
        </button>
      </div>

      {error && <div className="p-3 rounded-lg bg-red-900/30 border border-red-800 text-red-300 text-sm flex items-center gap-2"><AlertTriangle className="w-4 h-4 shrink-0"/>{error}</div>}
      {!data && !error && <div className="flex items-center justify-center h-32 text-zinc-500 text-sm"><RefreshCw className="w-4 h-4 animate-spin mr-2"/>Loading telemetry…</div>}

      {data && (
        <>
          {q ? (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {[
                  { label: 'Credits Used',    value: q.creditsUsed.toLocaleString(),  sub: `of ${q.monthlyBudget.toLocaleString()} monthly`,  cls: 'text-white' },
                  { label: 'Budget Used',     value: `${q.pctUsed}%`,                 sub: q.warningLevel,                                     cls: warningColor(q.warningLevel) },
                  { label: 'Req / Minute',    value: String(q.requestsLastMinute),     sub: `limit ${q.perMinuteLimit}`,                        cls: 'text-white' },
                  { label: 'Overall Hit Rate',value: `${data.overallHitRate}%`,        sub: 'across all groups',                                cls: 'text-green-400' },
                ].map(c => (
                  <div key={c.label} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                    <p className="text-xs text-zinc-500 mb-1">{c.label}</p>
                    <p className={`text-2xl font-bold ${c.cls}`}>{c.value}</p>
                    <p className="text-xs text-zinc-500 capitalize">{c.sub}</p>
                  </div>
                ))}
              </div>
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2 text-sm text-zinc-300"><Shield className="w-4 h-4 text-blue-400"/>Monthly Budget</div>
                  <div className="text-xs text-zinc-500">
                    Resets {formatTs(q.resetAt)}
                    {q.projectedExhaustionDate && <span className="ml-2 text-orange-400">· Projected exhaustion {formatTs(q.projectedExhaustionDate)}</span>}
                  </div>
                </div>
                <div className="w-full h-2 rounded-full bg-zinc-800 overflow-hidden">
                  <div className={`h-full rounded-full transition-all ${q.pctUsed>=95?'bg-red-500':q.pctUsed>=85?'bg-orange-500':q.pctUsed>=70?'bg-yellow-500':q.pctUsed>=50?'bg-yellow-400':'bg-green-500'}`} style={{width:`${Math.min(q.pctUsed,100)}%`}}/>
                </div>
                <div className="flex items-center justify-between mt-1 text-xs text-zinc-500">
                  <span>{q.creditsUsed.toLocaleString()} used</span>
                  <span>{q.creditsRemaining.toLocaleString()} remaining</span>
                </div>
                {q.throttled && <div className="mt-2 text-xs text-red-400 flex items-center gap-1"><AlertTriangle className="w-3 h-3"/>Quota guard THROTTLED — requests blocked</div>}
              </div>
            </>
          ) : (
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 text-zinc-500 text-sm">CMC quota data unavailable — ensure COINMARKETCAP_API_KEY is set.</div>
          )}

          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-[9px] text-zinc-500 uppercase tracking-widest">Cache Groups</p>
              <span className="text-[10px] text-zinc-600 font-mono">{data.groups.filter(g=>!g.isStale).length}/{data.groups.length} fresh</span>
            </div>
            <div className="space-y-2">
              {data.groups.map(group => (
                <div key={group.name} className={`bg-zinc-900 border rounded-xl px-4 py-3 transition-colors ${group.isStale ? 'border-orange-500/25' : 'border-zinc-800'}`}>
                  <div className="flex items-center gap-3">
                    <div className={`shrink-0 ${group.isStale ? 'text-orange-400' : 'text-zinc-400'}`}>{GROUP_ICONS[group.name]}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-medium text-white">{group.label}</span>
                        <span className={`text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded border ${group.isStale ? 'text-orange-400 bg-orange-900/30 border-orange-700/40' : 'text-green-400 bg-green-900/30 border-green-700/40'}`}>
                          {group.isStale ? 'STALE' : 'FRESH'}
                        </span>
                        <span className="text-[9px] text-zinc-600 hidden sm:inline font-mono">Age {formatAge(group.ageSeconds)} · TTL {formatTtl(group.ttlMs)}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1 rounded-full bg-zinc-800 overflow-hidden max-w-[120px]">
                          <div className="h-full rounded-full" style={{width:`${group.hitRate}%`,backgroundColor:group.hitRate>=80?'#22c55e':group.hitRate>=50?'#f59e0b':'#ef4444'}}/>
                        </div>
                        <span className={`text-[10px] font-mono font-semibold ${group.hitRate>=80?'text-green-400':group.hitRate>=50?'text-amber-400':'text-red-400'}`}>{group.hitRate}%</span>
                        <span className="text-[9px] text-zinc-600 hidden sm:inline">{group.hitCount}H / {group.missCount}M</span>
                      </div>
                    </div>
                    <button onClick={()=>onRefreshGroup(group.name)} disabled={refreshingGroup===group.name}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-[10px] text-zinc-400 transition-colors shrink-0 font-mono">
                      <RefreshCw className={`w-3 h-3 ${refreshingGroup===group.name?'animate-spin':''}`}/><span className="hidden sm:inline">Refresh</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {data.workers.length > 0 && (
            <div>
              <p className="text-[9px] text-zinc-600 uppercase tracking-widest mb-2">Background Workers</p>
              <div className="space-y-1.5">
                {data.workers.map(w => (
                  <div key={w.name} className="bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-2.5 flex items-center gap-3">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${w.state==='running'?'bg-blue-400 animate-pulse':w.state==='error'?'bg-red-400 animate-pulse':w.state==='stopped'?'bg-zinc-600':'bg-green-400'}`}/>
                    <span className="text-xs font-mono text-zinc-300 flex-1 min-w-0 truncate">{w.name}</span>
                    <span className={`text-[10px] hidden sm:block ${workerStateColor(w.state)}`}>{w.state}</span>
                    <span className="text-[9px] text-zinc-600 font-mono hidden sm:block">{w.tickCount} ticks · next {formatTs(w.nextTickAt)}</span>
                    {w.errorCount > 0 && <span className="text-[10px] text-red-400 bg-red-900/20 border border-red-800/40 px-1.5 py-0.5 rounded shrink-0">{w.errorCount} err</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center gap-4 text-xs text-zinc-600 pt-2 border-t border-zinc-800">
            <div className="flex items-center gap-1.5">
              {data.cmcEnabled ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500"/> : <AlertTriangle className="w-3.5 h-3.5 text-orange-400"/>}
              CMC API {data.cmcEnabled ? 'configured' : 'key missing'}
            </div>
            {q && (
              <div className="flex items-center gap-1.5">
                <ChevronRight className="w-3 h-3"/>
                Projected monthly: {q.projectedMonthlyUse.toLocaleString()} credits
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
  const cats = data?.categories ? [...data.categories].sort((a,b)=>b.avgPriceChange-a.avgPriceChange) : null
  const statusCounts = cats ? {
    overcrowded:  cats.filter(c=>c.avgPriceChange>12).length,
    strongest:    cats.filter(c=>c.avgPriceChange>7&&c.avgPriceChange<=12).length,
    accelerating: cats.filter(c=>c.avgPriceChange>3&&c.avgPriceChange<=7).length,
    neutral:      cats.filter(c=>c.avgPriceChange>=-3&&c.avgPriceChange<=3).length,
    weakening:    cats.filter(c=>c.avgPriceChange<-3).length,
  } : null

  if (error) return <div className="p-3 rounded-lg bg-red-900/30 border border-red-800 text-red-300 text-sm flex items-center gap-2"><AlertTriangle className="w-4 h-4"/>{error}</div>
  if (!data) return <div className="flex items-center justify-center h-32 text-zinc-500 text-sm"><RefreshCw className="w-4 h-4 animate-spin mr-2"/>Loading…</div>

  return (
    <div className="space-y-4 max-w-5xl">
      <div className="text-xs text-zinc-500">{data ? `Updated ${new Date(data.computedAt).toLocaleTimeString()}` : ''}</div>

      {(data.strongest||data.weakest) && (
        <div className="grid grid-cols-2 gap-3">
          {data.strongest && <div className="bg-green-900/15 border border-green-800/30 rounded-xl px-4 py-3 flex items-center gap-3"><TrendingUp className="w-6 h-6 text-green-400 shrink-0"/><div><p className="text-[9px] text-zinc-500 uppercase tracking-wider">Strongest</p><p className="text-sm font-bold text-green-400 truncate">{data.strongest}</p></div></div>}
          {data.weakest && <div className="bg-red-900/15 border border-red-800/30 rounded-xl px-4 py-3 flex items-center gap-3"><TrendingDown className="w-6 h-6 text-red-400 shrink-0"/><div><p className="text-[9px] text-zinc-500 uppercase tracking-wider">Weakest</p><p className="text-sm font-bold text-red-400 truncate">{data.weakest}</p></div></div>}
        </div>
      )}

      {statusCounts && (
        <div className="flex flex-wrap gap-1.5">
          {statusCounts.overcrowded>0  && <span className="text-[10px] font-mono px-2 py-0.5 rounded border text-red-400 border-red-500/30 bg-red-500/8">{statusCounts.overcrowded} Overcrowded</span>}
          {statusCounts.strongest>0    && <span className="text-[10px] font-mono px-2 py-0.5 rounded border text-blue-400 border-blue-500/30 bg-blue-500/8">{statusCounts.strongest} Strongest</span>}
          {statusCounts.accelerating>0 && <span className="text-[10px] font-mono px-2 py-0.5 rounded border text-emerald-400 border-emerald-500/30 bg-emerald-500/8">{statusCounts.accelerating} Accelerating</span>}
          {statusCounts.neutral>0      && <span className="text-[10px] font-mono px-2 py-0.5 rounded border text-zinc-500 border-zinc-700/40">{statusCounts.neutral} Neutral</span>}
          {statusCounts.weakening>0    && <span className="text-[10px] font-mono px-2 py-0.5 rounded border text-amber-400 border-amber-500/30 bg-amber-500/8">{statusCounts.weakening} Weakening</span>}
        </div>
      )}

      {cats && cats.length > 0 && (
        <div>
          <p className="text-[9px] text-zinc-500 uppercase tracking-widest mb-2.5">CMC Ecosystem Categories</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {cats.slice(0,18).map(cat => {
              const st = sectorStatus(cat.avgPriceChange)
              return (
                <div key={cat.id} className={`bg-zinc-900 border border-zinc-800 border-l-2 ${st.border} rounded-xl px-4 py-3`}>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-white truncate">{cat.title||cat.name}</p>
                      <p className="text-[9px] text-zinc-500 mt-0.5">{fmtB(cat.marketCap)} · {cat.coinCount} coins</p>
                    </div>
                    <span className={`font-mono text-sm font-semibold shrink-0 ${cat.avgPriceChange>=0?'text-green-400':'text-red-400'}`}>{cat.avgPriceChange>=0?'+':''}{fmt(cat.avgPriceChange)}%</span>
                  </div>
                  <span className={`text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded border ${
                    st.label==='OVERCROWDED'?'text-red-400 border-red-500/30 bg-red-500/8':
                    st.label==='STRONGEST'?'text-blue-400 border-blue-500/30 bg-blue-500/8':
                    st.label==='ACCELERATING'?'text-emerald-400 border-emerald-500/30 bg-emerald-500/8':
                    st.label==='WEAKENING'?'text-amber-400 border-amber-500/30 bg-amber-500/8':
                    st.label==='DECLINING'?'text-red-400/70 border-red-500/20 bg-red-500/5':
                    'text-zinc-600 border-zinc-700/40 bg-zinc-800/40'
                  }`}>{st.label}</span>
                  {cat.coins.length>0 && <div className="flex flex-wrap gap-1 mt-2">{cat.coins.slice(0,4).map(c=><span key={c} className="text-[9px] font-mono text-zinc-500 px-1 py-0.5 rounded bg-zinc-800/60">{c}</span>)}</div>}
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
  if (error) return <div className="p-3 rounded-lg bg-red-900/30 border border-red-800 text-red-300 text-sm flex items-center gap-2"><AlertTriangle className="w-4 h-4"/>{error}</div>
  if (!data) return <div className="flex items-center justify-center h-32 text-zinc-500 text-sm"><RefreshCw className="w-4 h-4 animate-spin mr-2"/>Loading…</div>

  const regime = data.regime
  const meta   = regime ? REGIME_META[regime.regime] : null

  function Change({ val, size='sm' }: { val: number; size?: 'sm' | 'xs' }) {
    const pos = val >= 0
    const cls = size === 'sm'
      ? `inline-flex items-center gap-0.5 text-xs font-medium px-1.5 py-0.5 rounded ${pos ? 'text-green-400 bg-green-500/10' : 'text-red-400 bg-red-500/10'}`
      : `text-[10px] font-mono font-semibold ${pos ? 'text-green-400' : 'text-red-400'}`
    return (
      <span className={cls}>
        {size==='sm' && (pos ? <ArrowUpRight className="w-3 h-3"/> : <ArrowDownRight className="w-3 h-3"/>)}
        {pos&&size==='xs'?'+':''}{Math.abs(val).toFixed(2)}%
      </span>
    )
  }

  return (
    <div className="space-y-4 max-w-5xl">
      <div className="text-xs text-zinc-500">{data ? `Updated ${new Date(data.computedAt).toLocaleTimeString()}` : ''}</div>

      {regime && meta && (
        <div className={`rounded-xl border ${meta.border} p-5 bg-zinc-900`}>
          <div className="flex items-start gap-4">
            <div className="flex-1 min-w-0">
              <p className="text-[10px] text-zinc-500 uppercase tracking-widest mb-1">Market Regime</p>
              <p className={`text-2xl sm:text-3xl font-bold ${meta.color}`}>{meta.label}</p>
              <p className="text-xs text-zinc-400 mt-1">{meta.desc}</p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-[9px] text-zinc-500 uppercase tracking-wider mb-0.5">BTC RSI 4h</p>
              <p className={`text-2xl font-bold font-mono ${regime.btcRsi4h>70?'text-red-400':regime.btcRsi4h<30?'text-green-400':'text-white'}`}>{fmt(regime.btcRsi4h,1)}</p>
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-white/10 grid grid-cols-3 gap-3">
            <div><p className="text-[9px] text-zinc-500 uppercase tracking-wider mb-0.5">BTC 24h</p><Change val={regime.btc24hChange}/></div>
            <div><p className="text-[9px] text-zinc-500 uppercase tracking-wider mb-0.5">ATR%</p><p className={`text-sm font-mono font-semibold ${regime.btcAtrPct>4?'text-amber-400':'text-white'}`}>{fmt(regime.btcAtrPct,2)}%</p></div>
            <div>
              <p className="text-[9px] text-zinc-500 uppercase tracking-wider mb-0.5">4h Trend</p>
              <div className={`flex items-center gap-0.5 text-sm font-semibold ${regime.btcTrend4h==='BULLISH'?'text-green-400':regime.btcTrend4h==='BEARISH'?'text-red-400':'text-zinc-400'}`}>
                {regime.btcTrend4h==='BULLISH'&&<TrendingUp className="w-3.5 h-3.5"/>}
                {regime.btcTrend4h==='BEARISH'&&<TrendingDown className="w-3.5 h-3.5"/>}
                {regime.btcTrend4h}
              </div>
            </div>
          </div>
        </div>
      )}

      {data.global ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label:'Total Market Cap', value:fmtB(data.global.totalMarketCapUsd), sub:<Change val={data.global.marketCapChangePercent24h}/> },
            { label:'24h Volume',       value:fmtB(data.global.totalVolume24hUsd),  sub:null },
            { label:'BTC Dominance',    value:`${fmt(data.global.btcDominance,1)}%`, sub:null },
            { label:'ETH Dominance',    value:`${fmt(data.global.ethDominance,1)}%`, sub:null },
          ].map(m => (
            <div key={m.label} className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3">
              <p className="text-[9px] text-zinc-500 uppercase tracking-wider mb-1">{m.label}</p>
              <p className="text-lg font-bold text-white">{m.value}</p>
              {m.sub && <div className="mt-0.5">{m.sub}</div>}
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 px-5 py-3 text-xs text-zinc-500 text-center">CMC global cache cold — go to Cache tab to refresh.</div>
      )}

      {data.listings && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-5 py-4">
          <p className="text-[9px] text-zinc-500 uppercase tracking-widest mb-3">Market Breadth · Top 200 (CMC)</p>
          <div className="flex items-center gap-4 mb-2">
            <span className="text-xl font-bold font-mono text-green-400">{data.listings.breadthUp}%</span>
            <div className="flex-1 h-2 rounded-full bg-zinc-800 overflow-hidden">
              <div className="h-full bg-green-500 rounded-full" style={{width:`${data.listings.breadthUp}%`}}/>
            </div>
            <span className="text-xl font-bold font-mono text-red-400">{data.listings.breadthDown}%</span>
          </div>
          <div className="flex gap-2 text-[10px] text-zinc-500">
            <span className="text-green-400/70">▲ Advancing</span>
            <span className="ml-auto text-red-400/70">Declining ▼</span>
          </div>
        </div>
      )}

      {data.trending && data.trending.trending.length > 0 && (
        <div>
          <p className="text-[9px] text-zinc-500 uppercase tracking-widest mb-2.5">Trending Assets</p>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl divide-y divide-zinc-800/60">
            {data.trending.trending.slice(0,6).map(coin => (
              <div key={coin.id} className="flex items-center gap-3 px-4 py-2.5">
                <span className="text-[9px] text-zinc-600 w-5 shrink-0">#{coin.rank}</span>
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-semibold font-mono text-white">{coin.symbol}</span>
                  <span className="text-[10px] text-zinc-500 ml-2 hidden sm:inline">{coin.name}</span>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <div className="text-right hidden sm:block">
                    <p className="text-[9px] text-zinc-600">1h</p>
                    <Change val={coin.priceChange1h} size="xs"/>
                  </div>
                  <div className="text-right">
                    <p className="text-[9px] text-zinc-600">24h</p>
                    <Change val={coin.priceChange24h} size="xs"/>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="flex items-center gap-2 mb-2.5">
          <Newspaper className="w-3.5 h-3.5 text-zinc-500"/>
          <p className="text-[9px] text-zinc-500 uppercase tracking-widest">News Intelligence · Informational Only</p>
        </div>
        <div className="flex items-center gap-2 rounded-lg px-3 py-2 bg-amber-500/5 border border-amber-500/20 text-amber-400/80 text-[10px] mb-3">
          <AlertTriangle className="w-3 h-3 shrink-0"/>
          News context is never used by the signal pipeline. Signals are driven by technical analysis only.
        </div>
        {news ? (
          <div className="space-y-3">
            {news.fearGreedValue !== null && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3">
                  <p className="text-[9px] text-zinc-500 uppercase tracking-wider mb-1">Fear & Greed</p>
                  <p className={`text-2xl font-bold font-mono ${FG_COLOR[news.fearGreedLabel??'']||'text-zinc-400'}`}>{news.fearGreedValue}</p>
                  <p className={`text-[10px] mt-0.5 ${FG_COLOR[news.fearGreedLabel??'']||'text-zinc-400'}`}>{news.fearGreedLabel}</p>
                </div>
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3"><p className="text-[9px] text-zinc-500 uppercase tracking-wider mb-1">Bullish</p><p className="text-2xl font-bold font-mono text-green-400">{news.bullishCount}</p></div>
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3"><p className="text-[9px] text-zinc-500 uppercase tracking-wider mb-1">Bearish</p><p className="text-2xl font-bold font-mono text-red-400">{news.bearishCount}</p></div>
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3"><p className="text-[9px] text-zinc-500 uppercase tracking-wider mb-1">Headlines</p><p className="text-2xl font-bold font-mono text-white">{news.bullishCount+news.bearishCount+news.neutralCount}</p></div>
              </div>
            )}
            {news.headlines.length>0 && (
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl divide-y divide-zinc-800/60">
                {news.headlines.slice(0,8).map((item,i) => (
                  <a key={i} href={item.url} target="_blank" rel="noopener noreferrer" className="flex items-start gap-3 px-4 py-2.5 hover:bg-zinc-800/40 transition-colors">
                    <span className={`text-[9px] px-1.5 py-0.5 rounded border shrink-0 mt-0.5 font-semibold uppercase ${SENT_STYLE[item.sentiment??'neutral']}`}>{item.sentiment?.[0]?.toUpperCase()??'N'}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-zinc-200 leading-snug line-clamp-2">{item.title}</p>
                      <p className="text-[9px] text-zinc-600 mt-0.5">{item.source} · {item.publishedAt ? new Date(item.publishedAt).toLocaleTimeString() : '—'}</p>
                    </div>
                  </a>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 px-5 py-4 text-xs text-zinc-500 text-center">Loading news… (cached 15 min)</div>
        )}
      </div>
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

type Tab = 'providers' | 'cache' | 'sectors' | 'market'

const TABS: { id: Tab; label: string }[] = [
  { id: 'providers', label: 'Providers' },
  { id: 'cache',     label: 'Cache'     },
  { id: 'sectors',   label: 'Sectors'   },
  { id: 'market',    label: 'Market'    },
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

  // ── Shared polling ───────────────────────────────────────────────────────────
  const providerFetcher = useCallback(() =>
    fetch('/api/health/providers').then(r=>r.json()).then(j=>j.providers??[]).catch(()=>[]), [])
  const cacheFetcher    = useCallback(async () => {
    const res  = await fetch('/api/cache/intelligence')
    const json = await res.json()
    if (json.success) { setCacheError(null); return json.telemetry as IntelligenceTelemetry }
    setCacheError(json.error); return null
  }, [])
  const sectorsFetcher  = useCallback(async () => {
    const res  = await fetch('/api/market/sectors')
    const json = await res.json()
    if (json.success) { setSectorsError(null); return json as SectorsResponse }
    setSectorsError(json.error); return null
  }, [])
  const marketFetcher   = useCallback(async () => {
    const res  = await fetch('/api/market/intelligence')
    const json = await res.json()
    if (json.success) { setMarketError(null); return json as IntelligenceData }
    setMarketError(json.error); return null
  }, [])
  const newsFetcher     = useCallback(() =>
    fetch('/api/news').then(r=>r.json()).then(j=>j.success?j:null).catch(()=>null), [])

  const { data: providers, loading: provLoading } = useSharedPolling<ProviderCheckResult[]>('intelligence:providers', providerFetcher, 120_000)
  const { data: cacheData, refresh: refreshCache }  = useSharedPolling<IntelligenceTelemetry|null>('intelligence:cache',     cacheFetcher,   120_000)
  const { data: sectors                           }  = useSharedPolling<SectorsResponse|null>       ('intelligence:sectors',   sectorsFetcher,  60_000)
  const { data: market                            }  = useSharedPolling<IntelligenceData|null>       ('intelligence:market',    marketFetcher,  120_000)
  const { data: news                              }  = useAutoRefresh<NewsSnapshot|null>(newsFetcher, 900_000)

  // ── Cache actions ────────────────────────────────────────────────────────────
  async function handleForceRefresh() {
    setRefreshing(true)
    try {
      const res  = await fetch('/api/cache/intelligence',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({force:true})})
      const json = await res.json()
      if (json.success) { setCacheError(null); refreshCache() }
      else setCacheError(json.error)
    } catch(err) { setCacheError(err instanceof Error ? err.message : String(err)) }
    finally { setRefreshing(false) }
  }
  async function handleRefreshGroup(group: string) {
    setRefreshingGroup(group)
    try {
      const res  = await fetch(`/api/cache/intelligence/${group}`,{method:'POST'})
      const json = await res.json()
      if (json.success) { setCacheError(null); refreshCache() }
      else setCacheError(json.error)
    } catch(err) { setCacheError(err instanceof Error ? err.message : String(err)) }
    finally { setRefreshingGroup(null) }
  }

  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-6xl mx-auto">
      <div>
        <h1 className="text-lg sm:text-xl font-semibold text-white">Intelligence Center</h1>
        <p className="text-xs text-zinc-500 mt-0.5">Providers · Cache · Sectors · Market</p>
      </div>

      <div className="flex gap-0 border-b border-zinc-800 -mx-1">
        {TABS.map(t => (
          <button key={t.id} onClick={()=>setTab(t.id)}
            className={`px-4 py-2 text-xs font-mono uppercase tracking-wider border-b-2 transition-colors ${tab===t.id?'border-white text-white':'border-transparent text-zinc-500 hover:text-zinc-300'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab==='providers' && <ProvidersTab providers={providers??[]} loading={provLoading}/>}
      {tab==='cache'     && (
        <CacheTab
          data={cacheData??null}
          onForceRefresh={handleForceRefresh}
          onRefreshGroup={handleRefreshGroup}
          refreshing={refreshing}
          refreshingGroup={refreshingGroup}
          error={cacheError}
        />
      )}
      {tab==='sectors' && <SectorsTab data={sectors??null} error={sectorsError}/>}
      {tab==='market'  && <MarketTab  data={market??null}  news={news??null} error={marketError}/>}
    </div>
  )
}
