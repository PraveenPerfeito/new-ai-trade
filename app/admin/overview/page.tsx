'use client'

import { useState, useCallback, useEffect } from 'react'
import {
  Activity, ScanLine, Zap,
  RefreshCw, Play, Square, Clock,
  TrendingUp, TrendingDown, Minus, CheckCircle, XCircle,
  ChevronRight,
} from 'lucide-react'
import Link from 'next/link'
import { adminApi } from '@/lib/admin-api'
import type { TacticalSignalRow, MarketRegime } from '@/types'

// ─── Types ────────────────────────────────────────────────────────────────────

interface CeleryStatus {
  enabled: boolean; scanning: boolean; running_modes: string[]; last_scan_at: number | null
  next_scan_at?: Record<string, number | null>
  is_overdue?: boolean
  last_scan_age_seconds?: number | null
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
const REGIME_BORDER: Record<MarketRegime, string> = {
  BULL_TREND: 'border-green-500/25', BEAR_TREND: 'border-red-500/25',
  SIDEWAYS: 'border-zinc-600/30', HIGH_VOLATILITY: 'border-amber-500/25',
  EUPHORIA: 'border-purple-500/25', CAPITULATION: 'border-rose-500/25',
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

// ─── Sub-components ───────────────────────────────────────────────────────────

function MetricTile({ label, value, sub, href, accent = 'default' }: {
  label: string; value: React.ReactNode; sub?: string; href?: string
  accent?: 'green' | 'red' | 'amber' | 'blue' | 'default'
}) {
  const colors = { green: 'text-green-400', red: 'text-red-400', amber: 'text-amber-400', blue: 'text-blue-400', default: 'text-white' }
  const el = (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 hover:border-zinc-700 transition-colors h-full">
      <div className="text-[10px] text-zinc-500 uppercase tracking-widest mb-1">{label}</div>
      <div className={`text-xl font-bold font-mono ${colors[accent]}`}>{value}</div>
      {sub && <div className="text-[11px] text-zinc-600 mt-0.5">{sub}</div>}
    </div>
  )
  return href ? <Link href={href} className="block">{el}</Link> : el
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

  useEffect(() => { fetchAll(); const t = setInterval(fetchAll, 60_000); return () => clearInterval(t) }, [fetchAll])  // OPT-11: was 30_000 — scanner cycles are 15-30 min

  useEffect(() => {
    const tick = () => {
      if (!celery) { setCountdown(null); return }
      // If the backend flagged the scheduler as overdue (Beat likely dead or scans
      // failing), stop the countdown — showing a ticking timer when nothing will
      // fire is misleading.
      if (celery.is_overdue) { setCountdown(null); return }
      const serverNext = celery.next_scan_at?.['standard'] ?? null
      const nextAt = serverNext ?? (celery.last_scan_at ? celery.last_scan_at + 15 * 60 : null)
      if (!nextAt) { setCountdown(null); return }
      const diff = Math.max(0, Math.floor(nextAt - Date.now() / 1000))
      setCountdown(diff)
    }
    tick()
    const t = setInterval(tick, 1000)
    return () => clearInterval(t)
  }, [celery])

  const handlePause = async () => {
    if (!celery || pausing) return
    setPausing(true)
    try {
      if (celery.enabled) await adminApi.scheduler.stop()
      else                await adminApi.scheduler.start()
      await adminApi.scheduler.status().then(r => { if (r.success && r.data) setCelery(r.data) })
    } finally { setPausing(false) }
  }

  const lifecycleCounts = signals.reduce<Record<string, number>>((acc, s) => {
    acc[s.lifecycleStage] = (acc[s.lifecycleStage] ?? 0) + 1; return acc
  }, {})
  const activeCount = lifecycleCounts['ACTIVE']  ?? 0
  const tpCount     = lifecycleCounts['TP_HIT']  ?? 0
  const slCount     = lifecycleCounts['SL_HIT']  ?? 0
  const staleCount  = lifecycleCounts['STALE']   ?? 0
  const sentCount   = (lifecycleCounts['TELEGRAM_SENT'] ?? 0) + (lifecycleCounts['AI_APPROVED'] ?? 0)
  const freshGroups = cache ? cache.groups.filter(g => !g.isStale).length : null
  const quotaPct    = cache?.quota?.pctUsed != null ? Math.round(cache.quota.pctUsed) : null
  const healthyProviders = providers.filter(p => p.healthy).length

  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-6xl mx-auto">

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg sm:text-xl font-semibold text-white">Command Overview</h1>
          <p className="text-xs text-zinc-500 mt-0.5">
            {updatedAt ? `Updated ${updatedAt}` : 'Loading…'}
          </p>
        </div>
        <button onClick={fetchAll} className="text-zinc-500 hover:text-zinc-300 p-1.5 rounded-lg border border-zinc-800 hover:border-zinc-600 transition-colors">
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* ── HERO ROW: Scanner + Regime (most important, above fold) ── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">

        {/* Scanner Status — spans 3 of 5 columns, more visual weight */}
        <div className={`lg:col-span-3 rounded-xl border p-5 ${
          !celery?.enabled              ? 'bg-zinc-900 border-zinc-700' :
          celery.scanning               ? 'bg-blue-500/5  border-blue-500/25' :
          celery.is_overdue             ? 'bg-amber-500/5 border-amber-500/25' :
          'bg-zinc-900 border-zinc-800'
        }`}>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                celery?.scanning               ? 'bg-blue-400  animate-pulse' :
                celery?.enabled && celery?.is_overdue ? 'bg-amber-400 animate-pulse' :
                celery?.enabled                ? 'bg-green-400 animate-pulse' : 'bg-zinc-600'
              }`} />
              <span className={`text-sm font-semibold ${celery?.is_overdue && celery?.enabled ? 'text-amber-300' : 'text-white'}`}>
                {celery === null                     ? 'Connecting…' :
                 celery.scanning                    ? `Scanning — ${celery.running_modes.join(', ') || 'standard'}` :
                 celery.enabled && celery.is_overdue ? 'Auto-scan Overdue' :
                 celery.enabled                     ? 'Auto-scan Active' :
                 'Auto-scan Paused'}
              </span>
            </div>
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
                ? <><Square className="w-3 h-3" /> Pause</>
                : <><Play  className="w-3 h-3" /> Resume</>
              }
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="bg-zinc-800/60 rounded-lg px-3 py-2.5">
              <p className="text-[9px] text-zinc-500 uppercase tracking-wider mb-1">Last Scan</p>
              <p className="text-sm font-mono font-semibold text-white">
                {celery?.last_scan_at ? timeAgo(celery.last_scan_at * 1000) : '—'}
              </p>
            </div>
            <div className="bg-zinc-800/60 rounded-lg px-3 py-2.5">
              <p className="text-[9px] text-zinc-500 uppercase tracking-wider mb-1">Next Scan</p>
              <p className={`text-sm font-mono font-semibold ${
                celery?.scanning  ? 'text-blue-400' :
                celery?.is_overdue && celery?.enabled ? 'text-amber-400' : 'text-white'
              }`}>
                {celery?.scanning                       ? 'Running now' :
                 celery?.enabled && celery?.is_overdue  ? 'Overdue' :
                 celery?.enabled && countdown !== null  ? fmtCountdown(countdown) : '—'}
              </p>
            </div>
          </div>

          {/* Signal distribution pills */}
          {signals.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {activeCount > 0 && (
                <Link href="/admin/tactical" className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 hover:bg-blue-500/20">
                  <span className="w-1 h-1 rounded-full bg-blue-400" /> {activeCount} Active
                </Link>
              )}
              {sentCount > 0 && (
                <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-purple-500/10 border border-purple-500/20 text-purple-400">
                  <Zap className="w-2.5 h-2.5" /> {sentCount} Sent
                </span>
              )}
              {tpCount > 0 && (
                <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                  <CheckCircle className="w-2.5 h-2.5" /> {tpCount} TP
                </span>
              )}
              {slCount > 0 && (
                <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-red-500/10 border border-red-500/20 text-red-400">
                  <XCircle className="w-2.5 h-2.5" /> {slCount} SL
                </span>
              )}
              {staleCount > 0 && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400">
                  {staleCount} Stale
                </span>
              )}
              <Link href="/admin/signals" className="text-[10px] text-zinc-600 hover:text-zinc-400 ml-auto flex items-center gap-0.5">
                All signals <ChevronRight className="w-3 h-3" />
              </Link>
            </div>
          )}
        </div>

        {/* Regime Card — spans 2 of 5, right side */}
        <Link href="/admin/regime" className="lg:col-span-2 block">
          {regime ? (
            <div className={`rounded-xl border p-5 bg-zinc-900 hover:border-zinc-600 transition-colors h-full ${REGIME_BORDER[regime.regime]}`}>
              <div className="flex items-center gap-1.5 mb-3">
                <Activity className="w-3.5 h-3.5 text-zinc-500" />
                <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-widest">Market Regime</span>
              </div>
              <div className={`text-2xl font-bold mb-4 ${REGIME_COLOR[regime.regime]}`}>
                {REGIME_LABEL[regime.regime]}
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <p className="text-[9px] text-zinc-500 mb-0.5">RSI 4h</p>
                  <p className={`text-sm font-bold font-mono ${regime.btcRsi4h > 70 ? 'text-red-400' : regime.btcRsi4h < 30 ? 'text-green-400' : 'text-white'}`}>{fmt(regime.btcRsi4h, 1)}</p>
                </div>
                <div>
                  <p className="text-[9px] text-zinc-500 mb-0.5">BTC 24h</p>
                  <p className={`text-sm font-bold font-mono ${regime.btc24hChange >= 0 ? 'text-green-400' : 'text-red-400'}`}>{regime.btc24hChange >= 0 ? '+' : ''}{fmt(regime.btc24hChange, 1)}%</p>
                </div>
                <div>
                  <p className="text-[9px] text-zinc-500 mb-0.5">4h Trend</p>
                  <p className={`text-sm font-bold flex items-center gap-0.5 ${regime.btcTrend4h === 'BULLISH' ? 'text-green-400' : regime.btcTrend4h === 'BEARISH' ? 'text-red-400' : 'text-zinc-400'}`}>
                    {regime.btcTrend4h === 'BULLISH' && <TrendingUp className="w-3.5 h-3.5" />}
                    {regime.btcTrend4h === 'BEARISH' && <TrendingDown className="w-3.5 h-3.5" />}
                    {!['BULLISH','BEARISH'].includes(regime.btcTrend4h) && <Minus className="w-3.5 h-3.5" />}
                    <span className="text-[11px]">{regime.btcTrend4h}</span>
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 h-full flex items-center justify-center text-zinc-600 text-sm">
              Loading regime…
            </div>
          )}
        </Link>
      </div>

      {/* ── Provider health + cache status (compact strip) ── */}
      <div className="flex flex-wrap items-center gap-3">
        {providers.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] text-zinc-600 uppercase tracking-wider">Providers:</span>
            {providers.slice(0, 4).map(p => (
              <Link key={p.name} href="/admin/providers"
                className={`flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border transition-colors hover:opacity-80 ${
                  p.healthy ? 'border-green-500/20 bg-green-500/5 text-green-400' : 'border-red-500/20 bg-red-500/5 text-red-400'
                }`}>
                <span className={`w-1 h-1 rounded-full shrink-0 ${p.healthy ? 'bg-green-400' : 'bg-red-400 animate-pulse'}`} />
                {p.name}
              </Link>
            ))}
          </div>
        )}
        {freshGroups !== null && (
          <Link href="/admin/cache" className="flex items-center gap-1.5 text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors ml-auto">
            <span className={`w-1.5 h-1.5 rounded-full ${freshGroups >= 4 ? 'bg-green-400' : freshGroups >= 2 ? 'bg-amber-400' : 'bg-red-400'}`} />
            Cache: {freshGroups}/{cache?.groups.length ?? 5} fresh
          </Link>
        )}
        {quotaPct !== null && (
          <Link href="/admin/cache" className={`text-[10px] ${quotaPct < 60 ? 'text-green-400' : quotaPct < 80 ? 'text-amber-400' : 'text-red-400'} hover:opacity-80`}>
            CMC {quotaPct}% used
          </Link>
        )}
      </div>

      {/* ── Metric tiles row (no duplicates — active already shown in scanner card) ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MetricTile label="Recent Sent"    value={sentCount}  sub="latest 100 tactical rows" href="/admin/signals"  accent={sentCount > 0 ? 'blue' : 'default'} />
        <MetricTile label="Recent TP"      value={tpCount}    sub="latest 100 tactical rows" href="/admin/tactical" accent={tpCount > 0 ? 'green' : 'default'} />
        <MetricTile label="Recent SL"      value={slCount}    sub="latest 100 tactical rows" href="/admin/tactical" accent={slCount > 0 ? 'red' : 'default'} />
        <MetricTile label="Providers Up"   value={providers.length > 0 ? `${healthyProviders}/${providers.length}` : '—'} sub="data feeds healthy" href="/admin/providers" accent={healthyProviders === providers.length && providers.length > 0 ? 'green' : 'amber'} />
      </div>

      {/* ── Recent signals — card rows (no horizontal scroll) ── */}
      {signals.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest">Recent Signals</h2>
            <Link href="/admin/signals" className="text-[10px] text-blue-400 hover:text-blue-300 flex items-center gap-0.5">
              View all <ChevronRight className="w-3 h-3" />
            </Link>
          </div>
          <div className="space-y-1.5">
            {signals.slice(0, 6).map((sig, i) => (
              <div key={sig.id ?? i}
                className="bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-2.5 flex items-center gap-3 hover:border-zinc-700 transition-colors">
                {/* Symbol + type */}
                <span className="font-semibold text-sm text-white w-16 shrink-0">{sig.symbol}</span>
                <span className={`text-xs font-semibold w-8 shrink-0 ${sig.type === 'BUY' ? 'text-green-400' : 'text-red-400'}`}>{sig.type}</span>
                {/* Stage badge */}
                <span className={`text-[10px] px-1.5 py-0.5 rounded border shrink-0 ${
                  sig.lifecycleStage === 'ACTIVE'        ? 'text-green-400   border-green-500/20   bg-green-500/10'   :
                  sig.lifecycleStage === 'AI_APPROVED'   ? 'text-blue-400    border-blue-500/20    bg-blue-500/10'    :
                  sig.lifecycleStage === 'TELEGRAM_SENT' ? 'text-purple-400  border-purple-500/20  bg-purple-500/10'  :
                  sig.lifecycleStage === 'TP_HIT'        ? 'text-emerald-400 border-emerald-500/20 bg-emerald-500/10' :
                  sig.lifecycleStage === 'SL_HIT'        ? 'text-red-400     border-red-500/20     bg-red-500/10'     :
                  'text-zinc-500 border-zinc-700 bg-zinc-800'
                }`}>{sig.lifecycleStage.replace(/_/g, ' ')}</span>
                {/* Metrics */}
                <div className="ml-auto flex items-center gap-4">
                  <span className="text-xs font-mono text-zinc-300 hidden sm:block">{sig.confidence}%</span>
                  <span className="text-xs font-mono text-zinc-500 hidden sm:block">{sig.rrRatio.toFixed(1)}:1</span>
                  <span className="text-[11px] text-zinc-600 tabular-nums">{sig.createdAt ? timeAgo(new Date(sig.createdAt).getTime()) : '—'}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  )
}
