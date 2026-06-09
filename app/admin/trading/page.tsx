'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import {
  Activity, Zap, ScanLine, Target, RefreshCw,
  Play, Square, ArrowRight, CheckCircle,
  TrendingUp, TrendingDown, Minus, Clock,
  ShieldAlert, Wrench, Bot, Send, AlertTriangle,
  ChevronRight, CheckCircle2, XCircle,
} from 'lucide-react'
import Link from 'next/link'
import { adminApi } from '@/lib/admin-api'
import { useSharedPolling } from '@/lib/use-shared-polling'
import { useAutoRefresh } from '@/lib/use-auto-refresh'
import { cn } from '@/lib/utils'
import type { TacticalSignalRow, MarketRegime, ScannerMode, SignalLifecycleStage } from '@/types'
import type { ScanSummaryResponse } from '@/lib/admin-api'

// ── Types ────────────────────────────────────────────────────────────────────

interface CeleryStatus {
  enabled: boolean; scanning: boolean; running_modes: string[]; last_scan_at: number | null
  next_scan_at?: Record<string, number | null>
  is_overdue?: boolean; last_scan_age_seconds?: number | null
}
interface RegimeData {
  regime: MarketRegime; btcRsi4h: number; btcTrend4h: string
  btcAtrPct: number; btc24hChange: number; computedAt: string
}
interface SignalCounts {
  signals_today: number; active_signals: number
  win_rate_7d: number; expectancy_7d: number; resolved_7d: number
}
interface OpsFlags {
  emergency_stop: boolean; maintenance_mode: boolean
  telegram: boolean; ai_validation: boolean
}
interface ProviderStatus { name: string; healthy: boolean; latencyMs: number; error?: string }
interface CacheTelemetry {
  quota: { creditsUsed: number; monthlyBudget: number; pctUsed: number } | null
  groups: Array<{ name: string; isStale: boolean; ageSeconds: number | null }>
}

// ── Constants ────────────────────────────────────────────────────────────────

const REGIME_COLOR: Record<string, string> = {
  BULL_TREND: 'text-green-400', BEAR_TREND: 'text-red-400', SIDEWAYS: 'text-zinc-400',
  HIGH_VOLATILITY: 'text-amber-400', EUPHORIA: 'text-purple-400', CAPITULATION: 'text-rose-400',
}
const REGIME_LABEL: Record<string, string> = {
  BULL_TREND: 'Bull Trend', BEAR_TREND: 'Bear Trend', SIDEWAYS: 'Sideways',
  HIGH_VOLATILITY: 'High Volatility', EUPHORIA: 'Euphoria', CAPITULATION: 'Capitulation',
}
const REGIME_BORDER: Record<string, string> = {
  BULL_TREND: 'border-green-500/25', BEAR_TREND: 'border-red-500/25',
  SIDEWAYS: 'border-zinc-600/30', HIGH_VOLATILITY: 'border-amber-500/25',
  EUPHORIA: 'border-purple-500/25', CAPITULATION: 'border-rose-500/25',
}
const REGIME_META: Record<string, { desc: string; implication: string }> = {
  BULL_TREND:      { desc: 'BTC 4h EMA bullish with sustained momentum', implication: 'Increase signal confidence thresholds — setups resolve faster in trending conditions' },
  BEAR_TREND:      { desc: 'BTC 4h EMA bearish with sustained selling pressure', implication: 'Tighten stop-losses — strong downtrend increases invalidation risk' },
  SIDEWAYS:        { desc: 'No clear directional bias — price consolidating', implication: 'Range-bound setups preferred — avoid breakout plays without volume confirmation' },
  HIGH_VOLATILITY: { desc: 'ATR above normal — increased whipsaw risk', implication: 'Widen stops or reduce position size — ATR spike increases noise in all setups' },
  EUPHORIA:        { desc: 'Overbought — RSI > 78, extreme greed territory', implication: 'Avoid new long entries — mean-reversion risk high; favor shorts or cash' },
  CAPITULATION:    { desc: 'Extreme fear — RSI < 22, mass selling', implication: 'High-conviction long setups may be viable — capitulation often precedes reversals' },
}
const MODE_COLORS: Record<string, string> = {
  spot:            'text-sky-400     border-sky-400/20     bg-sky-400/5',
  futures:         'text-purple-400  border-purple-400/20  bg-purple-400/5',
  high_confidence: 'text-emerald-400 border-emerald-400/20 bg-emerald-400/5',
  trending:        'text-amber-400   border-amber-400/20   bg-amber-400/5',
}
const MODES: ScannerMode[] = ['spot', 'futures', 'high_confidence', 'trending']
const MODE_FIRE_MINUTES: Record<string, number[]> = {
  spot: [0,15,30,45], futures: [10,40], high_confidence: [5,35], trending: [20,50],
}
const STAGE_META: Record<string, { label: string; color: string }> = {
  VALIDATED:     { label: 'Validated',   color: 'text-zinc-400    bg-zinc-500/10    border-zinc-500/20'    },
  AI_APPROVED:   { label: 'Approved',    color: 'text-blue-400    bg-blue-500/10    border-blue-500/20'    },
  TELEGRAM_SENT: { label: 'Sent',        color: 'text-purple-400  bg-purple-500/10  border-purple-500/20'  },
  ACTIVE:        { label: 'Active',      color: 'text-green-400   bg-green-500/10   border-green-500/20'   },
  STALE:         { label: 'Stale',       color: 'text-amber-400   bg-amber-500/10   border-amber-500/20'   },
  TP_HIT:        { label: 'TP Hit',      color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' },
  SL_HIT:        { label: 'SL Hit',      color: 'text-red-400     bg-red-500/10     border-red-500/20'     },
  CLOSED:        { label: 'Closed',      color: 'text-zinc-500    bg-zinc-500/10    border-zinc-600/20'    },
  ANALYZED:      { label: 'Analyzed',    color: 'text-indigo-400  bg-indigo-500/10  border-indigo-500/20'  },
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function fmt(n: number, d = 2) {
  return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
}
function timeAgo(ts: number | null | string) {
  if (!ts) return '—'
  const ms = typeof ts === 'string' ? new Date(ts).getTime() : ts * 1000
  const s = Math.floor((Date.now() - ms) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  return `${Math.floor(s / 3600)}h ago`
}
function fmtCd(secs: number) {
  if (secs <= 0) return 'now'
  const m = Math.floor(secs / 60), s = secs % 60
  return m > 0 ? `${m}m ${s.toString().padStart(2, '0')}s` : `${s}s`
}
function nextFire(mode: string) {
  const mins = MODE_FIRE_MINUTES[mode] ?? [0,15,30,45]
  const now = new Date(), cur = now.getMinutes()
  for (const m of [...mins].sort((a,b)=>a-b)) {
    if (cur < m) { const n=new Date(now); n.setMinutes(m,0,0); return Math.max(0,Math.floor((n.getTime()-Date.now())/1000)) }
  }
  const n=new Date(now); n.setHours(now.getHours()+1,[...mins].sort((a,b)=>a-b)[0],0,0)
  return Math.max(0,Math.floor((n.getTime()-Date.now())/1000))
}

// ── Shared sub-components ────────────────────────────────────────────────────

function MetricTile({ label, value, sub, accent = 'default' }: {
  label: string; value: React.ReactNode; sub?: string
  accent?: 'green' | 'red' | 'amber' | 'blue' | 'default'
}) {
  const colors = { green:'text-green-400', red:'text-red-400', amber:'text-amber-400', blue:'text-blue-400', default:'text-white' }
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3">
      <div className="text-[10px] text-zinc-500 uppercase tracking-widest mb-1">{label}</div>
      <div className={`text-xl font-bold font-mono ${colors[accent]}`}>{value}</div>
      {sub && <div className="text-[11px] text-zinc-600 mt-0.5">{sub}</div>}
    </div>
  )
}

function OpsToggle({ label, description, enabled, loading, icon, onEnable, onDisable, inverse }: {
  label: string; description: string; enabled: boolean | null; loading: boolean
  icon: React.ReactNode; onEnable: () => void; onDisable: () => void; inverse?: boolean
}) {
  const isActive = enabled === true
  return (
    <div className={cn('glass-card rounded-xl p-4 flex items-start sm:items-center gap-4 flex-col sm:flex-row transition-colors', inverse && isActive ? 'border-red-500/40 bg-red-900/10' : '')}>
      <div className={cn('p-2.5 rounded-lg shrink-0', inverse && isActive ? 'bg-red-500/20 text-red-400' : isActive ? 'bg-emerald-500/15 text-emerald-400' : 'bg-zinc-800 text-zinc-500')}>{icon}</div>
      <div className="flex-1 min-w-0">
        <p className="text-terminal-text font-semibold text-sm">{label}</p>
        <p className="text-terminal-muted text-xs mt-0.5 leading-relaxed">{description}</p>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <span className={cn('text-xs font-mono px-2 py-0.5 rounded-md border',
          enabled===null ? 'text-zinc-500 border-zinc-700 bg-zinc-800'
          : inverse && isActive ? 'text-red-300 border-red-500/30 bg-red-500/10'
          : isActive ? 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10'
          : 'text-zinc-400 border-zinc-700 bg-zinc-800')}>
          {enabled===null ? '…' : inverse ? (isActive ? 'ACTIVE' : 'CLEAR') : (isActive ? 'ON' : 'OFF')}
        </span>
        {inverse ? (
          isActive
            ? <button onClick={onDisable} disabled={loading||enabled===null} className="text-xs px-3 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-300 hover:bg-zinc-700 disabled:opacity-40 transition-colors">Clear Stop</button>
            : <button onClick={onEnable}  disabled={loading||enabled===null} className="text-xs px-3 py-1.5 rounded-lg bg-red-500/20 border border-red-500/40 text-red-300 hover:bg-red-500/30 disabled:opacity-40 transition-colors font-semibold">Activate</button>
        ) : (
          isActive
            ? <button onClick={onDisable} disabled={loading||enabled===null} className="text-xs px-3 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-300 hover:bg-zinc-700 disabled:opacity-40 transition-colors">Disable</button>
            : <button onClick={onEnable}  disabled={loading||enabled===null} className="text-xs px-3 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-40 transition-colors">Enable</button>
        )}
      </div>
    </div>
  )
}

// ── Overview tab ─────────────────────────────────────────────────────────────

function OverviewTab({ celery, regime, signalCounts, providers, cache, signals, countdown, onPause, pausing }: {
  celery: CeleryStatus | null; regime: RegimeData | null; signalCounts: SignalCounts | null
  providers: ProviderStatus[]; cache: CacheTelemetry | null
  signals: TacticalSignalRow[]; countdown: number | null
  onPause: () => void; pausing: boolean
}) {
  const lc = signals.reduce<Record<string,number>>((a,s)=>{ a[s.lifecycleStage]=(a[s.lifecycleStage]??0)+1; return a }, {})
  const freshGroups = cache ? cache.groups.filter(g=>!g.isStale).length : null
  const quotaPct = cache?.quota?.pctUsed != null ? Math.round(cache.quota.pctUsed) : null

  return (
    <div className="space-y-4">
      {/* Hero row: Scanner + Regime */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <div className={`lg:col-span-3 rounded-xl border p-5 ${
          !celery?.enabled ? 'bg-zinc-900 border-zinc-700' :
          celery.scanning  ? 'bg-blue-500/5 border-blue-500/25' :
          celery.is_overdue ? 'bg-amber-500/5 border-amber-500/25' : 'bg-zinc-900 border-zinc-800'
        }`}>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                celery?.scanning ? 'bg-blue-400 animate-pulse' :
                celery?.enabled && celery?.is_overdue ? 'bg-amber-400 animate-pulse' :
                celery?.enabled ? 'bg-green-400 animate-pulse' : 'bg-zinc-600'
              }`} />
              <span className={`text-sm font-semibold ${celery?.is_overdue && celery?.enabled ? 'text-amber-300' : 'text-white'}`}>
                {celery===null ? 'Connecting…' : celery.scanning ? `Scanning — ${celery.running_modes.join(', ')||'standard'}` :
                 celery.enabled && celery.is_overdue ? 'Auto-scan Overdue' : celery.enabled ? 'Auto-scan Active' : 'Auto-scan Paused'}
              </span>
            </div>
            <button onClick={onPause} disabled={pausing||celery===null}
              className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors disabled:opacity-40 ${
                celery?.enabled ? 'bg-red-500/10 border-red-500/30 text-red-400 hover:bg-red-500/20' : 'bg-green-500/10 border-green-500/30 text-green-400 hover:bg-green-500/20'
              }`}>
              {celery?.enabled ? <><Square className="w-3 h-3"/>Pause</> : <><Play className="w-3 h-3"/>Resume</>}
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-zinc-800/60 rounded-lg px-3 py-2.5">
              <p className="text-[9px] text-zinc-500 uppercase tracking-wider mb-1">Last Scan</p>
              <p className="text-sm font-mono font-semibold text-white">{celery?.last_scan_at ? timeAgo(celery.last_scan_at) : '—'}</p>
            </div>
            <div className="bg-zinc-800/60 rounded-lg px-3 py-2.5">
              <p className="text-[9px] text-zinc-500 uppercase tracking-wider mb-1">Next Scan</p>
              <p className={`text-sm font-mono font-semibold ${celery?.scanning ? 'text-blue-400' : celery?.is_overdue && celery?.enabled ? 'text-amber-400' : 'text-white'}`}>
                {celery?.scanning ? 'Running now' : celery?.enabled && celery?.is_overdue ? 'Overdue' : celery?.enabled && countdown!==null ? fmtCd(countdown) : '—'}
              </p>
            </div>
          </div>
          {signals.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {(lc['ACTIVE']??0) > 0 && <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400"><span className="w-1 h-1 rounded-full bg-blue-400"/>{lc['ACTIVE']} Active</span>}
              {((lc['TELEGRAM_SENT']??0)+(lc['AI_APPROVED']??0)) > 0 && <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-purple-500/10 border border-purple-500/20 text-purple-400"><Zap className="w-2.5 h-2.5"/>{(lc['TELEGRAM_SENT']??0)+(lc['AI_APPROVED']??0)} Sent</span>}
              {(lc['TP_HIT']??0) > 0 && <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400"><CheckCircle2 className="w-2.5 h-2.5"/>{lc['TP_HIT']} TP</span>}
              {(lc['SL_HIT']??0) > 0 && <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-red-500/10 border border-red-500/20 text-red-400"><XCircle className="w-2.5 h-2.5"/>{lc['SL_HIT']} SL</span>}
            </div>
          )}
        </div>
        {/* Regime card */}
        {regime ? (
          <div className={`lg:col-span-2 rounded-xl border p-5 bg-zinc-900 h-full ${REGIME_BORDER[regime.regime]}`}>
            <div className="flex items-center gap-1.5 mb-3">
              <Activity className="w-3.5 h-3.5 text-zinc-500"/>
              <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-widest">Market Regime</span>
            </div>
            <div className={`text-2xl font-bold mb-4 ${REGIME_COLOR[regime.regime]}`}>{REGIME_LABEL[regime.regime]}</div>
            <div className="grid grid-cols-3 gap-2">
              <div><p className="text-[9px] text-zinc-500 mb-0.5">RSI 4h</p><p className={`text-sm font-bold font-mono ${regime.btcRsi4h>70?'text-red-400':regime.btcRsi4h<30?'text-green-400':'text-white'}`}>{fmt(regime.btcRsi4h,1)}</p></div>
              <div><p className="text-[9px] text-zinc-500 mb-0.5">BTC 24h</p><p className={`text-sm font-bold font-mono ${regime.btc24hChange>=0?'text-green-400':'text-red-400'}`}>{regime.btc24hChange>=0?'+':''}{fmt(regime.btc24hChange,1)}%</p></div>
              <div><p className="text-[9px] text-zinc-500 mb-0.5">4h Trend</p>
                <p className={`text-sm font-bold flex items-center gap-0.5 ${regime.btcTrend4h==='BULLISH'?'text-green-400':regime.btcTrend4h==='BEARISH'?'text-red-400':'text-zinc-400'}`}>
                  {regime.btcTrend4h==='BULLISH' && <TrendingUp className="w-3.5 h-3.5"/>}
                  {regime.btcTrend4h==='BEARISH' && <TrendingDown className="w-3.5 h-3.5"/>}
                  {!['BULLISH','BEARISH'].includes(regime.btcTrend4h) && <Minus className="w-3.5 h-3.5"/>}
                  <span className="text-[11px]">{regime.btcTrend4h}</span>
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="lg:col-span-2 rounded-xl border border-zinc-800 bg-zinc-900 p-5 h-full flex items-center justify-center text-zinc-600 text-sm">Loading regime…</div>
        )}
      </div>

      {/* Provider/cache strip */}
      <div className="flex flex-wrap items-center gap-3">
        {providers.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] text-zinc-600 uppercase tracking-wider">Providers:</span>
            {providers.slice(0,4).map(p => (
              <span key={p.name} className={`flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border ${p.healthy?'border-green-500/20 bg-green-500/5 text-green-400':'border-red-500/20 bg-red-500/5 text-red-400'}`}>
                <span className={`w-1 h-1 rounded-full shrink-0 ${p.healthy?'bg-green-400':'bg-red-400 animate-pulse'}`}/>{p.name}
              </span>
            ))}
          </div>
        )}
        {freshGroups !== null && (
          <span className="flex items-center gap-1.5 text-[10px] text-zinc-500 ml-auto">
            <span className={`w-1.5 h-1.5 rounded-full ${freshGroups>=4?'bg-green-400':freshGroups>=2?'bg-amber-400':'bg-red-400'}`}/>
            Cache: {freshGroups}/{cache?.groups.length??5} fresh
          </span>
        )}
        {quotaPct !== null && <span className={`text-[10px] ${quotaPct<60?'text-green-400':quotaPct<80?'text-amber-400':'text-red-400'}`}>CMC {quotaPct}% used</span>}
      </div>

      {/* Metric tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MetricTile label="Signals Today"  value={signalCounts?.signals_today??'—'} sub="generated last 24h"
          accent={signalCounts!=null?(signalCounts.signals_today>0?'blue':'default'):'default'}/>
        <MetricTile label="Active Signals" value={signalCounts?.active_signals??'—'} sub="open positions (7d)"
          accent={signalCounts!=null?(signalCounts.active_signals>0?'green':'default'):'default'}/>
        <MetricTile label="Win Rate 7D" value={signalCounts?.resolved_7d?`${signalCounts.win_rate_7d}%`:'—'} sub={signalCounts?.resolved_7d?`${signalCounts.resolved_7d} resolved`:'no resolved signals'}
          accent={signalCounts?.win_rate_7d!=null?(signalCounts.win_rate_7d>=50?'green':signalCounts.win_rate_7d>=40?'amber':'red'):'default'}/>
        <MetricTile label="Expectancy 7D" value={signalCounts?.resolved_7d?`${signalCounts.expectancy_7d>0?'+':''}${signalCounts.expectancy_7d}R`:'—'} sub="avg return per trade"
          accent={signalCounts?.expectancy_7d!=null?(signalCounts.expectancy_7d>0?'green':signalCounts.expectancy_7d>-0.2?'amber':'red'):'default'}/>
      </div>

      {/* Recent signals */}
      {signals.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-2">Recent Signals</p>
          <div className="space-y-1.5">
            {signals.slice(0,6).map((sig,i)=>(
              <div key={sig.id??i} className="bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-2.5 flex items-center gap-3 hover:border-zinc-700 transition-colors">
                <span className="font-semibold text-sm text-white w-16 shrink-0">{sig.symbol}</span>
                <span className={`text-xs font-semibold w-8 shrink-0 ${sig.type==='BUY'?'text-green-400':'text-red-400'}`}>{sig.type}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded border shrink-0 ${STAGE_META[sig.lifecycleStage]?.color??'text-zinc-500 border-zinc-700 bg-zinc-800'}`}>{sig.lifecycleStage.replace(/_/g,' ')}</span>
                <div className="ml-auto flex items-center gap-4">
                  <span className="text-xs font-mono text-zinc-300 hidden sm:block">{sig.confidence}%</span>
                  <span className="text-xs font-mono text-zinc-500 hidden sm:block">{sig.rrRatio.toFixed(1)}:1</span>
                  <span className="text-[11px] text-zinc-600 tabular-nums">{sig.createdAt?timeAgo(sig.createdAt.toISOString()):'—'}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Scanner tab ──────────────────────────────────────────────────────────────

function ScannerTab({ celery, flags, aiEnabled, loading, error, scanning, scanDone, scanMode,
  setScanMode, onEnable, onDisable, onScanNow, onPatchFlag, onClearError, countdown, scanStats }: {
  celery: CeleryStatus | null; flags: OpsFlags | null; aiEnabled: boolean | null
  loading: boolean; error: string | null; scanning: boolean; scanDone: boolean
  scanMode: ScannerMode; setScanMode: (m: ScannerMode) => void
  onEnable: () => void; onDisable: () => void; onScanNow: () => void
  onPatchFlag: (g: string, k: string, v: boolean) => void
  onClearError: () => void; countdown: number | null
  scanStats: ScanSummaryResponse | null
}) {
  const emergencyOn = flags?.emergency_stop ?? false

  return (
    <div className="space-y-5 max-w-5xl">
      {emergencyOn && (
        <div className="p-4 rounded-xl bg-red-900/25 border border-red-500/50 text-red-200 flex items-center gap-3">
          <ShieldAlert className="w-5 h-5 shrink-0 text-red-400"/>
          <div className="flex-1">
            <p className="font-semibold text-sm">Emergency Stop is ACTIVE</p>
            <p className="text-xs text-red-300 mt-0.5">All scans, signal generation, and Telegram output are blocked.</p>
          </div>
          <button onClick={()=>onPatchFlag('features','emergency_stop',false)} disabled={loading}
            className="text-xs px-3 py-1.5 rounded-lg bg-red-500/30 border border-red-500/50 text-red-200 hover:bg-red-500/40 transition-colors disabled:opacity-40 font-semibold">
            Clear Stop
          </button>
        </div>
      )}
      {error && (
        <div className="p-3 rounded-lg bg-red-900/20 border border-red-800 text-red-300 text-sm flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0"/><span className="flex-1">{error}</span>
          <button onClick={onClearError}>✕</button>
        </div>
      )}
      {scanDone && (
        <div className="p-3 rounded-lg bg-emerald-900/20 border border-emerald-700/50 text-emerald-300 text-sm flex items-center gap-3 flex-wrap">
          <CheckCircle className="w-4 h-4 shrink-0"/><span className="flex-1">Scan queued — results appear in Signals within ~60s</span>
        </div>
      )}

      {/* Ops toggles */}
      <div>
        <p className="text-terminal-muted text-xs uppercase tracking-wider mb-3 font-semibold">Operational Switches</p>
        <div className="space-y-2">
          <OpsToggle label="Emergency Stop" description="Immediately halts ALL scans, signal generation, and Telegram output. Overrides every other switch."
            enabled={flags?.emergency_stop??null} loading={loading} icon={<ShieldAlert className="w-4 h-4"/>} inverse
            onEnable={()=>onPatchFlag('features','emergency_stop',true)} onDisable={()=>onPatchFlag('features','emergency_stop',false)}/>
          <OpsToggle label="Maintenance Mode" description="Blocks all scans and Telegram sends. Read-only API calls still work."
            enabled={flags?.maintenance_mode??null} loading={loading} icon={<Wrench className="w-4 h-4"/>} inverse
            onEnable={()=>onPatchFlag('features','maintenance_mode',true)} onDisable={()=>onPatchFlag('features','maintenance_mode',false)}/>
          <OpsToggle label="Scanner (Celery Scheduler)" description="Enables/disables the 15-min auto-scan cycle."
            enabled={celery?.enabled??null} loading={loading} icon={<ScanLine className="w-4 h-4"/>}
            onEnable={onEnable} onDisable={onDisable}/>
          <OpsToggle label="Claude AI Validation" description="When OFF, signals use heuristic scoring instead of Claude Haiku."
            enabled={aiEnabled} loading={loading} icon={<Bot className="w-4 h-4"/>}
            onEnable={()=>{ adminApi.settings.patch('ai',{enabled:true}) }} onDisable={()=>{ adminApi.settings.patch('ai',{enabled:false}) }}/>
          <OpsToggle label="Telegram Alerts" description="Master switch for all outgoing Telegram messages."
            enabled={flags?.telegram??null} loading={loading} icon={<Send className="w-4 h-4"/>}
            onEnable={()=>onPatchFlag('features','telegram',true)} onDisable={()=>onPatchFlag('features','telegram',false)}/>
        </div>
      </div>

      {/* Scheduler status */}
      <div className="glass-card rounded-xl p-4 sm:p-5">
        <p className="text-terminal-muted text-xs uppercase tracking-wider mb-3 font-semibold">Scheduler Status</p>
        <div className="flex items-center gap-3">
          <div className={cn('w-3 h-3 rounded-full shrink-0',
            celery===null ? 'bg-zinc-500 animate-pulse' : emergencyOn ? 'bg-red-400' :
            celery?.enabled && celery?.scanning ? 'bg-blue-400 animate-pulse' :
            celery?.enabled && celery?.is_overdue ? 'bg-amber-400 animate-pulse' :
            celery?.enabled ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-600')}/>
          <div className="min-w-0">
            <p className="font-semibold text-sm text-terminal-text">
              {celery===null?'Connecting…':emergencyOn?'Emergency Stop — blocked':
               celery.enabled&&celery.scanning?`Scanning — ${celery.running_modes.join(', ')||'standard'}`:
               celery.enabled&&celery.is_overdue?'Overdue — Beat may be down':celery.enabled?'Active':'Paused'}
            </p>
            <div className="flex items-center gap-2 flex-wrap mt-0.5">
              <span className="text-terminal-muted text-xs">Last: <span className="text-terminal-text">{timeAgo(celery?.last_scan_at??null)}</span></span>
              {celery?.enabled && !emergencyOn && !celery.scanning && !celery.is_overdue && countdown!==null && (
                <span className="flex items-center gap-1 text-xs text-terminal-muted"><Clock className="w-3 h-3"/>Next: <span className="text-white font-semibold font-mono ml-0.5">{fmtCd(countdown)}</span></span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Manual scan */}
      <div className="glass-card rounded-xl p-4 sm:p-5">
        <p className="text-terminal-muted text-xs uppercase tracking-wider mb-3 font-semibold">Manual Scan</p>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1">
            {MODES.map(m=>(
              <button key={m} onClick={()=>setScanMode(m)}
                className={cn('text-sm px-3 py-2 rounded-lg border transition-colors font-medium', scanMode===m?MODE_COLORS[m]:'border-transparent text-terminal-muted hover:text-terminal-text')}>
                {m.replace('_',' ')}
              </button>
            ))}
          </div>
          <button onClick={onScanNow} disabled={scanning||emergencyOn||flags?.maintenance_mode||celery?.enabled===false}
            className="flex items-center gap-2 text-sm px-4 py-2 rounded-lg bg-blue-500/15 border border-blue-500/30 text-blue-300 hover:bg-blue-500/25 transition-colors disabled:opacity-40 ml-auto">
            {scanning ? <><RefreshCw className="w-4 h-4 animate-spin"/>Queuing…</> : <><ScanLine className="w-4 h-4"/>Scan Now</>}
          </button>
        </div>
        <p className="text-terminal-muted/40 text-xs mt-3 font-mono">Auto: standard 15m · high_conf 30m (:05,:35) · futures 30m (:10,:40)</p>
      </div>

      {/* Gate stats */}
      {scanStats && scanStats.total_scans > 0 && (() => {
        const total = Math.round((scanStats.avg_coins_scanned??0)*scanStats.total_scans)
        const accepted = Math.round((scanStats.avg_signals_found??0)*scanStats.total_scans)
        const rejected = Math.max(0, total-accepted)
        const rate = total > 0 ? ((accepted/total)*100).toFixed(1) : '0.0'
        const gates = scanStats.gate_rejections??{}
        const totalGate = Object.values(gates).reduce((s,n)=>s+n,0)
        const topGates = Object.entries(gates).filter(([,n])=>n>0).sort(([,a],[,b])=>b-a).slice(0,8)
        return (
          <div>
            <p className="text-terminal-muted text-xs uppercase tracking-wider mb-3 font-semibold">Last 24h — Scan Summary</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              {[{label:'Scanned',value:total,color:'text-terminal-text'},{label:'Signals',value:accepted,color:'text-emerald-400'},{label:'Rejected',value:rejected,color:'text-red-400'},{label:'Accept Rate',value:`${rate}%`,color:'text-blue-400'}].map(c=>(
                <div key={c.label} className="glass-card rounded-xl px-4 py-3">
                  <p className="text-terminal-muted text-[10px] uppercase tracking-widest mb-1">{c.label}</p>
                  <p className={`text-xl font-bold font-mono ${c.color}`}>{c.value}</p>
                </div>
              ))}
            </div>
            {topGates.length > 0 && (
              <div className="glass-card rounded-xl p-4">
                <p className="text-terminal-muted text-xs uppercase tracking-wider mb-3">Gate Rejections ({scanStats.total_scans} scans)</p>
                <div className="space-y-2.5">
                  {topGates.map(([gate,count])=>{
                    const pct = totalGate>0?Math.round(count/totalGate*100):0
                    return (
                      <div key={gate}>
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="text-terminal-text text-sm capitalize">{gate.replace(/_/g,' ').toLowerCase()}</span>
                          <span className="text-terminal-muted text-xs font-mono">{count} · {pct}%</span>
                        </div>
                        <div className="h-1 bg-zinc-800 rounded-full overflow-hidden">
                          <div className="h-full rounded-full bg-blue-400/40" style={{width:`${pct}%`}}/>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )
      })()}
    </div>
  )
}

// ── Signals tab ──────────────────────────────────────────────────────────────

function SignalsTab() {
  const [typeFilter, setTypeFilter] = useState<'all'|'BUY'|'SELL'>('all')
  const [modeFilter, setModeFilter] = useState<'all'|string>('all')
  const fetcher = useCallback(() =>
    fetch('/api/signals?limit=50').then(r=>r.json()).then(j=>j.signals??[]), [])
  const { data: signals, loading } = useAutoRefresh<TacticalSignalRow[]>(fetcher, 120_000)

  const filtered = (signals??[]).filter(s=>
    (typeFilter==='all'||s.type===typeFilter) &&
    (modeFilter==='all'||s.scannerMode===modeFilter)
  )

  return (
    <div className="space-y-4 max-w-5xl">
      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        {(['all','BUY','SELL'] as const).map(f=>(
          <button key={f} onClick={()=>setTypeFilter(f)}
            className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${typeFilter===f?'bg-zinc-700 border-zinc-600 text-white':'border-transparent text-zinc-500 hover:text-zinc-300'}`}>
            {f}
          </button>
        ))}
        <div className="w-px bg-zinc-800 mx-1"/>
        {(['all',...MODES] as const).map(m=>(
          <button key={m} onClick={()=>setModeFilter(m)}
            className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${modeFilter===m?(MODE_COLORS[m]||'bg-zinc-700 border-zinc-600 text-white'):'border-transparent text-zinc-500 hover:text-zinc-300'}`}>
            {m==='all'?'All Modes':m.replace('_',' ')}
          </button>
        ))}
      </div>

      {loading && <div className="space-y-2">{Array.from({length:5}).map((_,i)=><div key={i} className="skeleton h-14 rounded-xl"/>)}</div>}

      {!loading && filtered.length === 0 && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-8 text-center text-zinc-600 text-sm">No signals match the current filters</div>
      )}

      <div className="space-y-1.5">
        {filtered.map((sig,i)=>(
          <div key={sig.id??i} className="bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-3 flex items-center gap-3 hover:border-zinc-700 transition-colors">
            <span className="font-semibold text-sm text-white w-20 shrink-0">{sig.symbol}</span>
            <span className={`text-xs font-semibold w-8 shrink-0 ${sig.type==='BUY'?'text-green-400':'text-red-400'}`}>{sig.type}</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded border shrink-0 ${STAGE_META[sig.lifecycleStage]?.color??'text-zinc-500 border-zinc-700 bg-zinc-800'}`}>{sig.lifecycleStage.replace(/_/g,' ')}</span>
            {sig.scannerMode && <span className={`text-[10px] px-1.5 py-0.5 rounded border shrink-0 hidden sm:inline ${MODE_COLORS[sig.scannerMode]}`}>{sig.scannerMode.replace('_',' ')}</span>}
            <div className="ml-auto flex items-center gap-4 shrink-0">
              <span className="text-xs font-mono text-zinc-300 hidden sm:block">{sig.confidence}%</span>
              <span className="text-xs font-mono text-zinc-500 hidden sm:block">{sig.rrRatio?.toFixed(1)}:1</span>
              <span className="text-[11px] text-zinc-600 tabular-nums">{sig.createdAt?timeAgo(sig.createdAt.toISOString()):'—'}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Tactical tab ─────────────────────────────────────────────────────────────

function TacticalTab() {
  const [preset, setPreset] = useState<'all'|'active'|'won'|'lost'>('active')
  const stageMap: Record<string, SignalLifecycleStage[]> = {
    active: ['ACTIVE','AI_APPROVED','TELEGRAM_SENT'],
    won:    ['TP_HIT','ANALYZED'],
    lost:   ['SL_HIT'],
  }
  const stages = preset==='all' ? null : stageMap[preset]

  const fetcher = useCallback(()=>
    fetch(`/api/signals/tactical?limit=50&lifecycleStage=all`).then(r=>r.json()).then(j=>j.signals??[]), [])
  const { data: allSigs, loading } = useAutoRefresh<TacticalSignalRow[]>(fetcher, 60_000)

  const signals = (allSigs??[]).filter(s=>!stages||stages.includes(s.lifecycleStage))

  const presets = [
    {id:'all',label:'All',cls:'border-zinc-600 text-zinc-300'},
    {id:'active',label:'Active',cls:'bg-green-500/10 border-green-500/30 text-green-300'},
    {id:'won',label:'✓ Won',cls:'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'},
    {id:'lost',label:'✗ Lost',cls:'bg-red-500/10 border-red-500/30 text-red-300'},
  ]

  return (
    <div className="space-y-4 max-w-5xl">
      <div className="flex gap-2 flex-wrap">
        {presets.map(p=>(
          <button key={p.id} onClick={()=>setPreset(p.id as typeof preset)}
            className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${preset===p.id?p.cls:'border-transparent text-zinc-500 hover:text-zinc-300'}`}>
            {p.label} {allSigs&&preset===p.id?`(${signals.length})`:allSigs&&p.id!=='all'?`(${(allSigs).filter(s=>!stageMap[p.id]||stageMap[p.id].includes(s.lifecycleStage)).length})`:''}
          </button>
        ))}
      </div>

      {loading && <div className="space-y-2">{Array.from({length:4}).map((_,i)=><div key={i} className="skeleton h-20 rounded-xl"/>)}</div>}

      {!loading && signals.length === 0 && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-8 text-center text-zinc-600 text-sm">No signals in this stage</div>
      )}

      <div className="space-y-2">
        {signals.map((sig,i)=>{
          const meta = STAGE_META[sig.lifecycleStage]
          const isBuy = sig.type==='BUY'
          return (
            <div key={sig.id??i} className={`bg-zinc-900 border rounded-xl overflow-hidden flex`}>
              <div className={`w-1 shrink-0 ${isBuy?'bg-green-500':'bg-red-500'}`}/>
              <div className="flex-1 px-4 py-3">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="font-bold text-white">{sig.symbol}</span>
                  <span className={`text-xs font-semibold ${isBuy?'text-green-400':'text-red-400'}`}>{sig.type}</span>
                  {meta && <span className={`text-[10px] px-1.5 py-0.5 rounded border ${meta.color}`}>{meta.label}</span>}
                  {sig.scannerMode && <span className={`text-[10px] px-1.5 py-0.5 rounded border ${MODE_COLORS[sig.scannerMode]}`}>{sig.scannerMode.replace('_',' ')}</span>}
                  <span className="ml-auto text-xs text-zinc-500">{sig.createdAt?timeAgo(sig.createdAt.toISOString()):'—'}</span>
                </div>
                <div className="flex gap-4 mt-1.5 flex-wrap">
                  <span className="text-[11px] text-zinc-500">Conf: <span className="text-zinc-300 font-mono">{sig.confidence}%</span></span>
                  <span className="text-[11px] text-zinc-500">RR: <span className="text-zinc-300 font-mono">{sig.rrRatio?.toFixed(1)}:1</span></span>
                  {sig.entryPrice > 0 && <span className="text-[11px] text-zinc-500">Entry: <span className="text-zinc-300 font-mono">${sig.entryPrice.toFixed(4)}</span></span>}
                  {sig.targetPrice > 0 && <span className="text-[11px] text-zinc-500">TP: <span className={`font-mono ${isBuy?'text-green-400':'text-red-400'}`}>${sig.targetPrice.toFixed(4)}</span></span>}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Regime tab ───────────────────────────────────────────────────────────────

function RegimeTab({ regime }: { regime: RegimeData | null }) {
  const [applying, setApplying] = useState(false)
  const [applyResult, setApplyResult] = useState<string|null>(null)

  const REGIME_PROFILE: Record<string, string> = {
    BULL_TREND: 'aggressive', BEAR_TREND: 'conservative', SIDEWAYS: 'balanced',
    HIGH_VOLATILITY: 'conservative', EUPHORIA: 'conservative', CAPITULATION: 'balanced',
  }

  async function applyRegimeSettings() {
    if (!regime) return
    setApplying(true); setApplyResult(null)
    try {
      const profile = REGIME_PROFILE[regime.regime] ?? 'balanced'
      await adminApi.settings.patch('scanner', { preset: profile })
      setApplyResult(`Applied ${profile} preset for ${REGIME_LABEL[regime.regime]}`)
    } catch {
      setApplyResult('Failed to apply settings')
    } finally { setApplying(false) }
  }

  if (!regime) return <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-8 text-center text-zinc-600">Loading regime…</div>

  const meta = REGIME_META[regime.regime]
  return (
    <div className="space-y-4 max-w-3xl">
      <div className={`rounded-xl border p-6 bg-zinc-900 ${REGIME_BORDER[regime.regime]}`}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Target className="w-4 h-4 text-zinc-500"/>
            <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-widest">Current Regime</span>
          </div>
          <span className="text-[10px] text-zinc-600 font-mono">{new Date(regime.computedAt).toLocaleTimeString()}</span>
        </div>
        <div className={`text-3xl font-bold mt-2 mb-4 ${REGIME_COLOR[regime.regime]}`}>{REGIME_LABEL[regime.regime]}</div>
        {meta && (
          <>
            <p className="text-zinc-400 text-sm leading-relaxed mb-2">{meta.desc}</p>
            <p className="text-zinc-500 text-xs leading-relaxed border-l-2 border-zinc-700 pl-3">{meta.implication}</p>
          </>
        )}
        <div className="grid grid-cols-3 gap-4 mt-4 pt-4 border-t border-zinc-800">
          <div><p className="text-[10px] text-zinc-600 uppercase tracking-wider mb-1">RSI 4h</p><p className={`text-xl font-bold font-mono ${regime.btcRsi4h>70?'text-red-400':regime.btcRsi4h<30?'text-green-400':'text-white'}`}>{fmt(regime.btcRsi4h,1)}</p></div>
          <div><p className="text-[10px] text-zinc-600 uppercase tracking-wider mb-1">BTC 24h</p><p className={`text-xl font-bold font-mono ${regime.btc24hChange>=0?'text-green-400':'text-red-400'}`}>{regime.btc24hChange>=0?'+':''}{fmt(regime.btc24hChange,1)}%</p></div>
          <div><p className="text-[10px] text-zinc-600 uppercase tracking-wider mb-1">ATR %</p><p className="text-xl font-bold font-mono text-white">{fmt(regime.btcAtrPct,2)}%</p></div>
        </div>
      </div>

      <div className="glass-card rounded-xl p-4 flex items-center justify-between gap-4">
        <div>
          <p className="text-terminal-text text-sm font-semibold">Apply Regime Settings</p>
          <p className="text-terminal-muted text-xs mt-0.5">Sets scanner preset to <span className="font-mono text-zinc-300">{REGIME_PROFILE[regime.regime]??'balanced'}</span> based on current regime</p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {applyResult && <span className={`text-xs font-mono ${applyResult.startsWith('Applied')?'text-green-400':'text-red-400'}`}>{applyResult}</span>}
          <button onClick={applyRegimeSettings} disabled={applying}
            className="flex items-center gap-1.5 text-xs px-4 py-2 rounded-lg bg-blue-500/15 border border-blue-500/30 text-blue-300 hover:bg-blue-500/25 transition-colors disabled:opacity-40">
            {applying ? <><RefreshCw className="w-3 h-3 animate-spin"/>Applying…</> : <>Apply Regime Settings<ArrowRight className="w-3 h-3"/></>}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main page ────────────────────────────────────────────────────────────────

type Tab = 'overview' | 'scanner' | 'signals' | 'tactical' | 'regime'

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview'   },
  { id: 'scanner',  label: 'Scanner'    },
  { id: 'signals',  label: 'Signals'    },
  { id: 'tactical', label: 'Tactical'   },
  { id: 'regime',   label: 'Regime'     },
]

export default function TradingOperationsPage() {
  const [tab, setTab] = useState<Tab>('overview')

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab') as Tab | null
    if (t && TABS.some(x => x.id === t)) setTab(t)
  }, [])

  // ── Shared data (single polling registry) ──────────────────────────────────
  const celeryFetcher  = useCallback(()=>adminApi.scheduler.status().then(r=>r.success?r.data:null), [])
  const regimeFetcher  = useCallback(()=>fetch('/api/market/intelligence').then(r=>r.json()).then(j=>j.regime??null), [])
  const countsFetcher  = useCallback(()=>fetch('/api/signals/counts').then(r=>r.json()), [])
  const cacheFetcher   = useCallback(()=>fetch('/api/cache/intelligence').then(r=>r.json()).then(j=>j.telemetry??null), [])
  const provFetcher    = useCallback(()=>fetch('/api/health/providers').then(r=>r.json()).then(j=>j.providers??[]).catch(()=>[]), [])
  const sigFetcher     = useCallback(()=>fetch('/api/signals/tactical?limit=6&lifecycleStage=all').then(r=>r.json()).then(j=>j.signals??[]).catch(()=>[]), [])
  const flagsFetcher   = useCallback(async ()=>{
    const [featRes,aiRes] = await Promise.all([adminApi.settings.group('features'),adminApi.settings.group('ai')])
    const field = (res: { fields: {key:string;value:unknown}[] }, k: string) => res.fields.find(f=>f.key===k)?.value
    return {
      emergency_stop:   Boolean(field(featRes,'emergency_stop')),
      maintenance_mode: Boolean(field(featRes,'maintenance_mode')),
      telegram:         Boolean(field(featRes,'telegram')),
      ai_validation:    Boolean(field(featRes,'ai_validation')),
      _aiEnabled:       Boolean(field(aiRes,'enabled')),
    }
  }, [])
  const scansFetcher   = useCallback(()=>adminApi.analytics.scans(24).catch(()=>null), [])

  const { data: celery,      refresh: refreshCelery  } = useSharedPolling<CeleryStatus|null>('trading:celery', celeryFetcher, 120_000)
  const { data: regime }                                = useSharedPolling<RegimeData|null>('trading:regime', regimeFetcher, 120_000)
  const { data: signalCounts }                          = useSharedPolling<SignalCounts|null>('trading:counts', countsFetcher, 120_000)
  const { data: cache }                                 = useSharedPolling<CacheTelemetry|null>('trading:cache', cacheFetcher, 120_000)
  const { data: providers }                             = useSharedPolling<ProviderStatus[]>('trading:providers', provFetcher, 120_000)
  const { data: recentSignals }                         = useSharedPolling<TacticalSignalRow[]>('trading:recent-sigs', sigFetcher, 120_000)
  const { data: flagsData,  refresh: refreshFlags }     = useSharedPolling<{emergency_stop:boolean;maintenance_mode:boolean;telegram:boolean;ai_validation:boolean;_aiEnabled:boolean}|null>('trading:flags', flagsFetcher, 120_000)
  const { data: scanStats }                             = useSharedPolling<ScanSummaryResponse|null>('trading:scans', scansFetcher, 120_000)

  // ── Scanner countdown ────────────────────────────────────────────────────────
  const [countdown, setCountdown] = useState<number|null>(null)
  const [scanMode,  setScanMode]  = useState<ScannerMode>('spot')

  useEffect(()=>{
    const tick=()=>{
      if (!celery) { setCountdown(null); return }
      if (celery.is_overdue) { setCountdown(null); return }
      const modeNext = celery.next_scan_at?.[scanMode]??null
      const diff = modeNext ? Math.floor(modeNext-Date.now()/1000) : -1
      setCountdown(diff>0 ? diff : nextFire(scanMode))
    }
    tick(); const t=setInterval(tick,1000); return ()=>clearInterval(t)
  }, [celery, scanMode])

  // ── Scanner actions ──────────────────────────────────────────────────────────
  const [opLoading,  setOpLoading]  = useState(false)
  const [opError,    setOpError]    = useState<string|null>(null)
  const [scanning,   setScanning]   = useState(false)
  const [scanDone,   setScanDone]   = useState(false)
  const [pausing,    setPausing]    = useState(false)
  const scanDoneTimer = useRef<ReturnType<typeof setTimeout>|null>(null)

  const flags: OpsFlags|null = flagsData ? { emergency_stop: flagsData.emergency_stop, maintenance_mode: flagsData.maintenance_mode, telegram: flagsData.telegram, ai_validation: flagsData.ai_validation } : null
  const aiEnabled = flagsData?._aiEnabled ?? null

  async function handleEnable()  { setOpLoading(true); setOpError(null); try { await adminApi.scheduler.start(); refreshCelery() } catch(e) { setOpError(e instanceof Error?e.message:'Failed') } finally { setOpLoading(false) } }
  async function handleDisable() { setOpLoading(true); setOpError(null); try { await adminApi.scheduler.stop();  refreshCelery() } catch(e) { setOpError(e instanceof Error?e.message:'Failed') } finally { setOpLoading(false) } }
  async function handlePatchFlag(group: string, key: string, value: boolean) {
    setOpLoading(true); setOpError(null)
    try { await adminApi.settings.patch(group,{[key]:value}); refreshFlags() }
    catch(e) { setOpError(e instanceof Error?e.message:'Failed') }
    finally { setOpLoading(false) }
  }
  async function handleScanNow() {
    setScanning(true); setScanDone(false); setOpError(null)
    if (scanDoneTimer.current) clearTimeout(scanDoneTimer.current)
    try {
      const res  = await fetch('/api/scanner/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:scanMode})})
      const json = await res.json()
      if (res.status===423) { setOpError('A scan is already running.'); return }
      if (res.status===503) { setOpError(json.detail??'Scanner is disabled or blocked.'); return }
      if (!json.success) { setOpError(json.error??'Scan failed'); return }
      setScanDone(true); scanDoneTimer.current=setTimeout(()=>setScanDone(false),30_000); refreshCelery()
    } catch(e) { setOpError(e instanceof Error?e.message:'Network error') }
    finally { setScanning(false) }
  }
  async function handlePause() {
    if (!celery||pausing) return; setPausing(true)
    try { if (celery.enabled) await adminApi.scheduler.stop(); else await adminApi.scheduler.start(); refreshCelery() }
    finally { setPausing(false) }
  }

  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-6xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-lg sm:text-xl font-semibold text-white">Trading Operations</h1>
        <p className="text-xs text-zinc-500 mt-0.5">Overview · Scanner · Signals · Tactical · Regime</p>
      </div>

      {/* Tab nav */}
      <div className="flex gap-0 border-b border-zinc-800 -mx-1">
        {TABS.map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)}
            className={`px-4 py-2 text-xs font-mono uppercase tracking-wider border-b-2 transition-colors ${
              tab===t.id ? 'border-white text-white' : 'border-transparent text-zinc-500 hover:text-zinc-300'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab==='overview' && (
        <OverviewTab
          celery={celery??null} regime={regime??null} signalCounts={signalCounts??null}
          providers={providers??[]} cache={cache??null} signals={recentSignals??[]}
          countdown={countdown} onPause={handlePause} pausing={pausing}
        />
      )}
      {tab==='scanner' && (
        <ScannerTab
          celery={celery??null} flags={flags} aiEnabled={aiEnabled}
          loading={opLoading} error={opError} scanning={scanning} scanDone={scanDone}
          scanMode={scanMode} setScanMode={setScanMode}
          onEnable={handleEnable} onDisable={handleDisable} onScanNow={handleScanNow}
          onPatchFlag={handlePatchFlag} onClearError={()=>setOpError(null)}
          countdown={countdown} scanStats={scanStats??null}
        />
      )}
      {tab==='signals'  && <SignalsTab/>}
      {tab==='tactical' && <TacticalTab/>}
      {tab==='regime'   && <RegimeTab regime={regime??null}/>}
    </div>
  )
}
