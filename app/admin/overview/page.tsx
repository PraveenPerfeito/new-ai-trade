'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import {
  LayoutDashboard, Activity, ScanLine, Zap, Database,
  RefreshCw, AlertOctagon, Pause, Play, Square,
  TrendingUp, TrendingDown, Minus, CheckCircle, XCircle, Clock,
} from 'lucide-react'
import Link from 'next/link'
import { adminApi } from '@/lib/admin-api'
import type { TacticalSignalRow, MarketRegime } from '@/types'

// ─── Types ────────────────────────────────────────────────────────────────────

interface CeleryStatus {
  enabled: boolean; scanning: boolean; running_modes: string[]; last_scan_at: number | null
}
interface RegimeData {
  regime: MarketRegime; btcRsi4h: number; btcTrend4h: string
  btcAtrPct: number; btc24hChange: number; computedAt: string
}
interface CacheTelemetry {
  quota: { creditsUsed: number; monthlyBudget: number; pctUsed: number } | null
  groups: Array<{ name: string; isStale: boolean; ageSeconds: number | null }>
}
interface ProviderStatus { name: string; healthy: boolean; latencyMs: number; error?: string }

// ─── Constants ────────────────────────────────────────────────────────────────

const REGIME_COLOR: Record<MarketRegime, string> = {
  BULL_TREND: 'text-green-400', BEAR_TREND: 'text-red-400', SIDEWAYS: 'text-zinc-400',
  HIGH_VOLATILITY: 'text-amber-400', EUPHORIA: 'text-purple-400', CAPITULATION: 'text-rose-400',
}
const REGIME_LABEL: Record<MarketRegime, string> = {
  BULL_TREND: 'Bull Trend', BEAR_TREND: 'Bear Trend', SIDEWAYS: 'Sideways',
  HIGH_VOLATILITY: 'High Volatility', EUPHORIA: 'Euphoria', CAPITULATION: 'Capitulation',
}

function fmt(n: number, d = 2) {
  return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
}
function timeAgo(ts: number | null) {
  if (!ts) return '—'
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60)   return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  return `${Math.floor(s / 3600)}h ago`
}
function fmtCountdown(secs: number): string {
  if (secs <= 0) return 'now'
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return m > 0 ? `${m}m ${s.toString().padStart(2, '0')}s` : `${s}s`
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

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CommandOverviewPage() {
  const [celery,    setCelery]    = useState<CeleryStatus | null>(null)
  const [regime,    setRegime]    = useState<RegimeData | null>(null)
  const [signals,   setSignals]   = useState<TacticalSignalRow[]>([])
  const [cache,     setCache]     = useState<CacheTelemetry | null>(null)
  const [providers, setProviders] = useState<ProviderStatus[]>([])
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)
  const [countdown, setCountdown] = useState<number | null>(null)
  const [pausing,   setPausing]   = useState(false)

  const fetchAll = useCallback(async () => {
    await Promise.allSettled([
      adminApi.scheduler.status().then(res => { if (res.success && res.data) setCelery(res.data) }).catch(() => {}),
      fetch('/api/market/intelligence').then(r => r.json()).then(j => { if (j.success) setRegime(j.regime) }),
      fetch('/api/signals/tactical?limit=100&lifecycleStage=all').then(r => r.json()).then(j => { if (j.success) setSignals(j.signals) }),
      fetch('/api/cache/intelligence').then(r => r.json()).then(j => { if (j.success) setCache(j.telemetry) }),
      fetch('/api/health/providers').then(r => r.json()).then(j => { if (j.providers) setProviders(j.providers) }).catch(() => {}),
    ])
    setUpdatedAt(new Date().toLocaleTimeString())
  }, [])

  useEffect(() => { fetchAll(); const t = setInterval(fetchAll, 15_000); return () => clearInterval(t) }, [fetchAll])

  // Live countdown to next standard scan (15 min interval)
  useEffect(() => {
    const tick = () => {
      if (!celery?.last_scan_at) { setCountdown(null); return }
      const nextAt = celery.last_scan_at + 15 * 60
      const diff   = Math.max(0, Math.floor(nextAt - Date.now() / 1000))
      setCountdown(diff)
    }
    tick()
    const t = setInterval(tick, 1000)
    return () => clearInterval(t)
  }, [celery?.last_scan_at])

  const handlePause = async () => {
    if (!celery || pausing) return
    setPausing(true)
    try {
      if (celery.enabled) await adminApi.scheduler.stop()
      else                await adminApi.scheduler.start()
      await adminApi.scheduler.status().then(r => { if (r.success && r.data) setCelery(r.data) })
    } finally { setPausing(false) }
  }

  // Signal lifecycle distribution
  const lifecycleCounts = signals.reduce<Record<string, number>>((acc, s) => {
    acc[s.lifecycleStage] = (acc[s.lifecycleStage] ?? 0) + 1
    return acc
  }, {})
  const activeCount  = lifecycleCounts['ACTIVE']  ?? 0
  const tpCount      = lifecycleCounts['TP_HIT']  ?? 0
  const slCount      = lifecycleCounts['SL_HIT']  ?? 0
  const staleCount   = lifecycleCounts['STALE']   ?? 0
  const sentCount    = (lifecycleCounts['TELEGRAM_SENT'] ?? 0) + (lifecycleCounts['AI_APPROVED'] ?? 0)
  const freshGroups  = cache ? cache.groups.filter(g => !g.isStale).length : null
  const quotaPct     = cache?.quota?.pctUsed != null ? Math.round(cache.quota.pctUsed) : null

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-6xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <LayoutDashboard className="w-6 h-6 text-blue-400 shrink-0" />
          <div>
            <h1 className="text-lg sm:text-xl font-semibold text-white">Command Overview</h1>
            <p className="text-xs sm:text-sm text-zinc-400">System status · scanner · regime · signals</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {updatedAt && <span className="text-xs text-zinc-600 hidden sm:block">Updated {updatedAt}</span>}
          <button onClick={fetchAll} className="text-zinc-500 hover:text-zinc-300 p-1.5 rounded-lg border border-zinc-800 hover:border-zinc-600 transition-colors">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* ── Provider health strip ── */}
      {providers.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] text-zinc-500 uppercase tracking-wider shrink-0">Providers:</span>
          {providers.slice(0, 4).map(p => (
            <Link key={p.name} href="/admin/providers"
              className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border transition-colors hover:opacity-80 ${
                p.healthy ? 'border-green-500/25 bg-green-500/5 text-green-400' : 'border-red-500/25 bg-red-500/5 text-red-400'
              }`}>
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${p.healthy ? 'bg-green-400' : 'bg-red-400 animate-pulse'}`} />
              {p.name}
              {p.healthy && p.latencyMs > 0 && (
                <span className="text-[10px] opacity-60">{p.latencyMs}ms</span>
              )}
              {!p.healthy && <span className="text-[10px] opacity-70">down</span>}
            </Link>
          ))}
        </div>
      )}

      {/* ── Scanner status + countdown + emergency pause ── */}
      <div className={`rounded-xl border px-4 py-3 flex flex-wrap items-center gap-3 ${
        !celery?.enabled ? 'bg-zinc-900 border-zinc-700' :
        celery.scanning   ? 'bg-blue-500/5 border-blue-500/20' :
        'bg-zinc-900 border-zinc-800'
      }`}>
        <div className="flex items-center gap-2 min-w-0">
          <span className={`w-2 h-2 rounded-full shrink-0 ${
            celery?.scanning ? 'bg-blue-400 animate-pulse' : celery?.enabled ? 'bg-green-400 animate-pulse' : 'bg-zinc-600'
          }`} />
          <span className="text-sm font-semibold text-white">
            {celery === null              ? 'Connecting…' :
             celery.scanning             ? `Scanning — ${celery.running_modes.join(', ') || 'standard'}` :
             celery.enabled              ? 'Auto-scan active' :
             'Auto-scan paused'}
          </span>
        </div>

        {/* Countdown */}
        <div className="flex items-center gap-1.5 text-xs font-mono text-zinc-400">
          <Clock className="w-3.5 h-3.5 shrink-0" />
          {celery?.scanning
            ? <span className="text-blue-400">Scanning now…</span>
            : celery?.enabled && countdown !== null
              ? <span>Next standard scan: <span className="text-white font-semibold">{fmtCountdown(countdown)}</span></span>
              : <span className="text-zinc-500">—</span>
          }
        </div>

        {/* Emergency pause / resume */}
        <div className="ml-auto">
          <button
            onClick={handlePause}
            disabled={pausing || celery === null}
            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors disabled:opacity-40 ${
              celery?.enabled
                ? 'bg-red-500/10 border-red-500/30 text-red-400 hover:bg-red-500/20'
                : 'bg-green-500/10 border-green-500/30 text-green-400 hover:bg-green-500/20'
            }`}
          >
            {celery?.enabled
              ? <><Square className="w-3 h-3" /> Pause Scanner</>
              : <><Play  className="w-3 h-3" /> Resume Scanner</>
            }
          </button>
        </div>
      </div>

      {/* ── Signal lifecycle distribution ── */}
      {signals.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Signals:</span>
          {activeCount > 0 && (
            <Link href="/admin/tactical?stage=ACTIVE" className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 hover:bg-blue-500/20">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-400" /> {activeCount} Active
            </Link>
          )}
          {sentCount > 0 && (
            <span className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-purple-500/10 border border-purple-500/20 text-purple-400">
              <Zap className="w-3 h-3" /> {sentCount} Sent
            </span>
          )}
          {tpCount > 0 && (
            <span className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
              <CheckCircle className="w-3 h-3" /> {tpCount} TP Hit
            </span>
          )}
          {slCount > 0 && (
            <span className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-red-500/10 border border-red-500/20 text-red-400">
              <XCircle className="w-3 h-3" /> {slCount} SL Hit
            </span>
          )}
          {staleCount > 0 && (
            <span className="text-xs px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400">
              {staleCount} Stale
            </span>
          )}
          <Link href="/admin/signals" className="text-xs text-zinc-500 hover:text-zinc-300 ml-auto">View all →</Link>
        </div>
      )}

      {/* ── Regime hero ── */}
      <Link href="/admin/regime" className="block">
        {regime ? (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 sm:p-5 hover:border-zinc-700 transition-colors">
            <div className="flex items-center gap-2 mb-3">
              <Activity className="w-4 h-4 text-zinc-500" />
              <span className="text-xs font-semibold text-zinc-500 uppercase tracking-widest">Market Regime</span>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <div className={`text-2xl font-bold ${REGIME_COLOR[regime.regime]}`}>
                {REGIME_LABEL[regime.regime]}
              </div>
              <div className="flex gap-4 ml-auto flex-wrap">
                <div>
                  <div className="text-[10px] text-zinc-500">BTC RSI 4h</div>
                  <div className={`text-sm font-bold font-mono ${regime.btcRsi4h > 70 ? 'text-red-400' : regime.btcRsi4h < 30 ? 'text-green-400' : 'text-white'}`}>{fmt(regime.btcRsi4h, 1)}</div>
                </div>
                <div>
                  <div className="text-[10px] text-zinc-500">BTC 24h</div>
                  <div className={`text-sm font-bold font-mono ${regime.btc24hChange >= 0 ? 'text-green-400' : 'text-red-400'}`}>{regime.btc24hChange >= 0 ? '+' : ''}{fmt(regime.btc24hChange, 1)}%</div>
                </div>
                <div>
                  <div className="text-[10px] text-zinc-500">Trend</div>
                  <div className={`text-sm font-bold flex items-center gap-0.5 ${regime.btcTrend4h === 'BULLISH' ? 'text-green-400' : regime.btcTrend4h === 'BEARISH' ? 'text-red-400' : 'text-zinc-400'}`}>
                    {regime.btcTrend4h === 'BULLISH' && <TrendingUp className="w-3.5 h-3.5" />}
                    {regime.btcTrend4h === 'BEARISH' && <TrendingDown className="w-3.5 h-3.5" />}
                    {!['BULLISH','BEARISH'].includes(regime.btcTrend4h) && <Minus className="w-3.5 h-3.5" />}
                    {regime.btcTrend4h}
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 flex items-center justify-center text-zinc-600 text-sm h-24">Loading regime…</div>
        )}
      </Link>

      {/* ── Quick stat tiles ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatTile label="Active Signals" value={activeCount} sub="ACTIVE lifecycle" href="/admin/tactical" accent={activeCount > 0 ? 'green' : 'default'} />
        <StatTile label="Sent to Telegram" value={sentCount} sub="AI approved + sent" href="/admin/signals" />
        <StatTile label="Cache" value={freshGroups !== null ? `${freshGroups}/${cache?.groups.length ?? 5}` : '—'} sub="fresh groups" href="/admin/cache" accent={freshGroups !== null && freshGroups >= 4 ? 'green' : freshGroups !== null && freshGroups >= 2 ? 'amber' : 'red'} />
        <StatTile label="CMC Quota" value={quotaPct !== null ? `${quotaPct}%` : '—'} sub="monthly used" href="/admin/cache" accent={quotaPct !== null ? (quotaPct < 60 ? 'green' : quotaPct < 80 ? 'amber' : 'red') : 'default'} />
      </div>

      {/* ── Recent signals table ── */}
      {signals.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest">Recent Signals</h2>
            <Link href="/admin/tactical" className="text-xs text-blue-400 hover:text-blue-300">View all →</Link>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden overflow-x-auto">
            <table className="w-full text-sm min-w-[480px]">
              <thead>
                <tr className="border-b border-zinc-800 text-[10px] text-zinc-600 uppercase tracking-wider">
                  <th className="text-left px-4 py-2.5">Symbol</th>
                  <th className="text-left px-4 py-2.5">Stage</th>
                  <th className="text-right px-4 py-2.5">Type</th>
                  <th className="text-right px-4 py-2.5">Conf</th>
                  <th className="text-right px-4 py-2.5 hidden sm:table-cell">R:R</th>
                  <th className="text-right px-4 py-2.5">Age</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/50">
                {signals.slice(0, 8).map((sig, i) => (
                  <tr key={sig.id ?? i} className="hover:bg-zinc-800/40">
                    <td className="px-4 py-2 font-semibold text-white">{sig.symbol}</td>
                    <td className="px-4 py-2">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded border ${
                        sig.lifecycleStage === 'ACTIVE'        ? 'text-green-400  border-green-500/20  bg-green-500/10'  :
                        sig.lifecycleStage === 'AI_APPROVED'   ? 'text-blue-400   border-blue-500/20   bg-blue-500/10'   :
                        sig.lifecycleStage === 'TELEGRAM_SENT' ? 'text-purple-400 border-purple-500/20 bg-purple-500/10' :
                        sig.lifecycleStage === 'TP_HIT'        ? 'text-emerald-400 border-emerald-500/20 bg-emerald-500/10' :
                        sig.lifecycleStage === 'SL_HIT'        ? 'text-red-400    border-red-500/20    bg-red-500/10'    :
                        'text-zinc-500 border-zinc-700 bg-zinc-800'
                      }`}>{sig.lifecycleStage}</span>
                    </td>
                    <td className="px-4 py-2 text-right"><span className={`text-xs font-semibold ${sig.type === 'BUY' ? 'text-green-400' : 'text-red-400'}`}>{sig.type}</span></td>
                    <td className="px-4 py-2 text-right text-xs font-mono text-zinc-300">{sig.confidence}%</td>
                    <td className="px-4 py-2 text-right text-xs font-mono text-zinc-300 hidden sm:table-cell">{sig.rrRatio.toFixed(1)}</td>
                    <td className="px-4 py-2 text-right text-xs text-zinc-600 tabular-nums">{sig.createdAt ? timeAgo(new Date(sig.createdAt).getTime()) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
