'use client'

import { useState, useCallback, useEffect } from 'react'
import {
  LayoutDashboard, Activity, ScanLine, Zap, Database,
  RefreshCw, ArrowUpRight, ArrowDownRight, AlertOctagon, Pause,
  TrendingUp, TrendingDown, Minus,
} from 'lucide-react'
import Link from 'next/link'
import type { TacticalSignalRow, MarketRegime } from '@/types'

// ─── Types ────────────────────────────────────────────────────────────────────

interface SchedulerStatus {
  started: boolean; scanning: boolean; paused: boolean; emergencyStop: boolean
  mode: string; scanCount: number; errorCount: number
  lastScanAt: number | null; nextScanAt: number | null; intervalMs: number
}

interface RegimeData {
  regime: MarketRegime; btcRsi4h: number; btcTrend4h: string
  btcAtrPct: number; btc24hChange: number; computedAt: string
}

interface CacheGroup { name: string; fresh: boolean; ageMinutes: number; hits: number; misses: number }
interface CacheTelemetry { quotaGuard: { monthlyUsed: number; monthlyLimit: number }; groups: CacheGroup[] }

// ─── Constants ────────────────────────────────────────────────────────────────

const REGIME_COLOR: Record<MarketRegime, string> = {
  BULL_TREND:      'text-green-400',
  BEAR_TREND:      'text-red-400',
  SIDEWAYS:        'text-zinc-400',
  HIGH_VOLATILITY: 'text-amber-400',
  EUPHORIA:        'text-purple-400',
  CAPITULATION:    'text-rose-400',
}

const REGIME_LABEL: Record<MarketRegime, string> = {
  BULL_TREND: 'Bull Trend', BEAR_TREND: 'Bear Trend', SIDEWAYS: 'Sideways',
  HIGH_VOLATILITY: 'High Volatility', EUPHORIA: 'Euphoria', CAPITULATION: 'Capitulation',
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number, d = 2) {
  return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
}

function timeAgo(ts: number | null) {
  if (!ts) return '—'
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60)  return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  return `${Math.floor(s / 3600)}h ago`
}

function ScannerStatusBadge({ s }: { s: SchedulerStatus }) {
  if (s.emergencyStop) return <span className="text-xs font-semibold text-red-400 flex items-center gap-1"><AlertOctagon className="w-3 h-3" /> E-Stop</span>
  if (s.paused)        return <span className="text-xs font-semibold text-amber-400 flex items-center gap-1"><Pause className="w-3 h-3" /> Paused</span>
  if (s.scanning)      return <span className="text-xs font-semibold text-blue-400 flex items-center gap-1"><RefreshCw className="w-3 h-3 animate-spin" /> Scanning</span>
  if (s.started)       return <span className="text-xs font-semibold text-green-400 flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" /> Active</span>
  return <span className="text-xs font-semibold text-zinc-500">Stopped</span>
}

function StatTile({ label, value, sub, href, accent = 'default' }: {
  label: string; value: React.ReactNode; sub?: string; href?: string
  accent?: 'green' | 'red' | 'amber' | 'blue' | 'default'
}) {
  const colors = { green: 'text-green-400', red: 'text-red-400', amber: 'text-amber-400', blue: 'text-blue-400', default: 'text-white' }
  const el = (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 hover:border-zinc-700 transition-colors">
      <div className="text-[10px] text-zinc-500 uppercase tracking-widest mb-1">{label}</div>
      <div className={`text-xl font-bold font-mono ${colors[accent]}`}>{value}</div>
      {sub && <div className="text-[11px] text-zinc-600 mt-0.5">{sub}</div>}
    </div>
  )
  return href ? <Link href={href}>{el}</Link> : el
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function CommandOverviewPage() {
  const [scheduler,  setScheduler]  = useState<SchedulerStatus | null>(null)
  const [regime,     setRegime]     = useState<RegimeData | null>(null)
  const [signals,    setSignals]    = useState<TacticalSignalRow[]>([])
  const [cache,      setCache]      = useState<CacheTelemetry | null>(null)
  const [updatedAt,  setUpdatedAt]  = useState<string | null>(null)

  const fetchAll = useCallback(async () => {
    await Promise.allSettled([
      fetch('/api/scanner/control').then(r => r.json()).then((j) => {
        if (j.success) setScheduler(j.scheduler)
      }),
      fetch('/api/market/intelligence').then(r => r.json()).then((j) => {
        if (j.success) setRegime(j.regime)
      }),
      fetch('/api/signals/tactical?limit=10&lifecycleStage=all').then(r => r.json()).then((j) => {
        if (j.success) setSignals(j.signals)
      }),
      fetch('/api/cache/intelligence').then(r => r.json()).then((j) => {
        if (j.success) setCache(j.telemetry)
      }),
    ])
    setUpdatedAt(new Date().toLocaleTimeString())
  }, [])

  useEffect(() => {
    fetchAll()
    const t = setInterval(fetchAll, 15_000)
    return () => clearInterval(t)
  }, [fetchAll])

  // Compute quick signal stats
  const activeSignals  = signals.filter(s => s.lifecycleStage === 'ACTIVE').length
  const approvedSignals = signals.filter(s => ['AI_APPROVED', 'TELEGRAM_SENT', 'ACTIVE'].includes(s.lifecycleStage)).length
  const freshGroups    = cache ? cache.groups.filter(g => g.fresh).length : null
  const quotaPct       = cache ? Math.round((cache.quotaGuard.monthlyUsed / cache.quotaGuard.monthlyLimit) * 100) : null

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <LayoutDashboard className="w-6 h-6 text-blue-400" />
          <div>
            <h1 className="text-xl font-semibold text-white">Command Overview</h1>
            <p className="text-sm text-zinc-400">System status · scanner · regime · signals · cache</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {updatedAt && <span className="text-xs text-zinc-600">Updated {updatedAt}</span>}
          <button
            onClick={fetchAll}
            className="text-zinc-500 hover:text-zinc-300 p-1.5 rounded-lg border border-zinc-800 hover:border-zinc-600 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Scanner + Regime hero strip */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Scanner status */}
        <Link href="/admin/scanner" className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 hover:border-zinc-700 transition-colors block">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <ScanLine className="w-4 h-4 text-zinc-500" />
              <span className="text-xs font-semibold text-zinc-500 uppercase tracking-widest">Scanner</span>
            </div>
            {scheduler && <ScannerStatusBadge s={scheduler} />}
          </div>
          {scheduler ? (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-xs text-zinc-500">Mode</div>
                <div className="text-sm font-semibold text-white mt-0.5">{scheduler.mode}</div>
              </div>
              <div>
                <div className="text-xs text-zinc-500">Last Scan</div>
                <div className="text-sm font-semibold text-white mt-0.5">{timeAgo(scheduler.lastScanAt)}</div>
              </div>
              <div>
                <div className="text-xs text-zinc-500">Scans</div>
                <div className="text-sm font-semibold text-white mt-0.5">{scheduler.scanCount}</div>
              </div>
              <div>
                <div className="text-xs text-zinc-500">Errors</div>
                <div className={`text-sm font-semibold mt-0.5 ${scheduler.errorCount > 0 ? 'text-red-400' : 'text-white'}`}>{scheduler.errorCount}</div>
              </div>
            </div>
          ) : (
            <div className="text-zinc-600 text-sm">Loading…</div>
          )}
        </Link>

        {/* Regime */}
        <Link href="/admin/regime" className="block">
          {regime ? (
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 hover:border-zinc-700 transition-colors h-full">
              <div className="flex items-center gap-2 mb-3">
                <Activity className="w-4 h-4 text-zinc-500" />
                <span className="text-xs font-semibold text-zinc-500 uppercase tracking-widest">Market Regime</span>
              </div>
              <div className={`text-2xl font-bold mb-3 ${REGIME_COLOR[regime.regime]}`}>
                {REGIME_LABEL[regime.regime]}
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <div className="text-xs text-zinc-500">RSI 4h</div>
                  <div className={`text-sm font-bold font-mono ${regime.btcRsi4h > 70 ? 'text-red-400' : regime.btcRsi4h < 30 ? 'text-green-400' : 'text-white'}`}>
                    {fmt(regime.btcRsi4h, 1)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-zinc-500">BTC 24h</div>
                  <div className={`text-sm font-bold font-mono ${regime.btc24hChange >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {regime.btc24hChange >= 0 ? '+' : ''}{fmt(regime.btc24hChange, 1)}%
                  </div>
                </div>
                <div>
                  <div className="text-xs text-zinc-500">Trend</div>
                  <div className={`text-sm font-bold flex items-center gap-0.5 ${regime.btcTrend4h === 'BULLISH' ? 'text-green-400' : regime.btcTrend4h === 'BEARISH' ? 'text-red-400' : 'text-zinc-400'}`}>
                    {regime.btcTrend4h === 'BULLISH' && <TrendingUp className="w-3.5 h-3.5" />}
                    {regime.btcTrend4h === 'BEARISH' && <TrendingDown className="w-3.5 h-3.5" />}
                    {regime.btcTrend4h === 'RANGING' && <Minus className="w-3.5 h-3.5" />}
                    {regime.btcTrend4h}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 h-full flex items-center justify-center text-zinc-600 text-sm">
              Loading regime…
            </div>
          )}
        </Link>
      </div>

      {/* Quick stat tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatTile
          label="Active Signals"
          value={activeSignals}
          sub="ACTIVE lifecycle"
          href="/admin/tactical"
          accent={activeSignals > 0 ? 'green' : 'default'}
        />
        <StatTile
          label="Approved Signals"
          value={approvedSignals}
          sub="AI approved + sent"
          href="/admin/signals"
        />
        <StatTile
          label="Cache Groups"
          value={freshGroups !== null ? `${freshGroups} / ${cache?.groups.length ?? 5}` : '—'}
          sub="fresh groups"
          href="/admin/cache"
          accent={freshGroups !== null && freshGroups >= 4 ? 'green' : freshGroups !== null && freshGroups >= 2 ? 'amber' : 'red'}
        />
        <StatTile
          label="CMC Quota"
          value={quotaPct !== null ? `${quotaPct}%` : '—'}
          sub="monthly used"
          href="/admin/cache"
          accent={quotaPct !== null ? (quotaPct < 60 ? 'green' : quotaPct < 80 ? 'amber' : 'red') : 'default'}
        />
      </div>

      {/* Recent signals table */}
      {signals.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest">Recent Signals</h2>
            <Link href="/admin/tactical" className="text-xs text-blue-400 hover:text-blue-300">View all →</Link>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800 text-[10px] text-zinc-600 uppercase tracking-wider">
                  <th className="text-left px-4 py-2.5">Symbol</th>
                  <th className="text-left px-4 py-2.5">Stage</th>
                  <th className="text-right px-4 py-2.5">Type</th>
                  <th className="text-right px-4 py-2.5">Conf</th>
                  <th className="text-right px-4 py-2.5">R:R</th>
                  <th className="text-right px-4 py-2.5">Age</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/50">
                {signals.slice(0, 8).map((sig, i) => (
                  <tr key={sig.id ?? i} className="hover:bg-zinc-800/40">
                    <td className="px-4 py-2 font-semibold text-white text-sm">{sig.symbol}</td>
                    <td className="px-4 py-2">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded border ${
                        sig.lifecycleStage === 'ACTIVE'      ? 'text-green-400 border-green-500/20 bg-green-500/10' :
                        sig.lifecycleStage === 'AI_APPROVED' ? 'text-blue-400 border-blue-500/20 bg-blue-500/10'   :
                        sig.lifecycleStage === 'TELEGRAM_SENT' ? 'text-purple-400 border-purple-500/20 bg-purple-500/10' :
                        sig.lifecycleStage === 'TP_HIT'      ? 'text-emerald-400 border-emerald-500/20 bg-emerald-500/10' :
                        sig.lifecycleStage === 'SL_HIT'      ? 'text-red-400 border-red-500/20 bg-red-500/10' :
                        'text-zinc-500 border-zinc-700 bg-zinc-800'
                      }`}>
                        {sig.lifecycleStage}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <span className={`text-xs font-semibold ${sig.type === 'BUY' ? 'text-green-400' : 'text-red-400'}`}>{sig.type}</span>
                    </td>
                    <td className="px-4 py-2 text-right text-xs font-mono text-zinc-300">{sig.confidence}%</td>
                    <td className="px-4 py-2 text-right text-xs font-mono text-zinc-300">{sig.rrRatio.toFixed(1)}</td>
                    <td className="px-4 py-2 text-right text-xs text-zinc-600 tabular-nums">
                      {timeAgo(new Date(sig.createdAt).getTime())}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Cache group freshness strip */}
      {cache && cache.groups.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest">Intelligence Cache</h2>
            <Link href="/admin/cache" className="text-xs text-blue-400 hover:text-blue-300">Manage →</Link>
          </div>
          <div className="flex gap-2 flex-wrap">
            {cache.groups.map((g) => (
              <div
                key={g.name}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs ${
                  g.fresh ? 'border-green-500/20 bg-green-500/5' : 'border-amber-500/20 bg-amber-500/5'
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${g.fresh ? 'bg-green-400' : 'bg-amber-400'}`} />
                <span className={g.fresh ? 'text-green-300' : 'text-amber-300'}>{g.name}</span>
                <span className="text-zinc-600">{g.ageMinutes < 1 ? '<1m' : `${g.ageMinutes}m`}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
