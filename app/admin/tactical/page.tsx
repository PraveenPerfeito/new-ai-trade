'use client'

import { useState, useCallback } from 'react'
import {
  Crosshair, RefreshCw, AlertTriangle,
  CheckCircle2, Clock, Send, Zap, XCircle, TrendingUp,
  ArrowUpRight, ArrowDownRight, ChevronDown, ChevronUp,
} from 'lucide-react'
import { useAutoRefresh } from '@/lib/use-auto-refresh'
import type { TacticalSignalRow, SignalLifecycleStage } from '@/types'

// ─── Constants ────────────────────────────────────────────────────────────────

const STAGE_META: Record<SignalLifecycleStage, {
  label: string; color: string; icon: React.ElementType; accentCls: string
}> = {
  VALIDATED:     { label: 'Validated',   color: 'text-zinc-400    bg-zinc-500/10    border-zinc-500/20',    accentCls: 'bg-zinc-500/50',     icon: CheckCircle2   },
  AI_APPROVED:   { label: 'AI Approved', color: 'text-blue-400    bg-blue-500/10    border-blue-500/20',    accentCls: 'bg-blue-500',         icon: Zap            },
  TELEGRAM_SENT: { label: 'Sent',        color: 'text-purple-400  bg-purple-500/10  border-purple-500/20',  accentCls: 'bg-purple-500',       icon: Send           },
  ACTIVE:        { label: 'Active',      color: 'text-green-400   bg-green-500/10   border-green-500/20',   accentCls: 'bg-green-500',        icon: TrendingUp     },
  STALE:         { label: 'Stale',       color: 'text-amber-400   bg-amber-500/10   border-amber-500/20',   accentCls: 'bg-amber-500/60',     icon: Clock          },
  TP_HIT:        { label: 'TP Hit',      color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20', accentCls: 'bg-emerald-500',      icon: ArrowUpRight   },
  SL_HIT:        { label: 'SL Hit',      color: 'text-red-400     bg-red-500/10     border-red-500/20',     accentCls: 'bg-red-500',          icon: ArrowDownRight },
  CLOSED:        { label: 'Closed',      color: 'text-zinc-500    bg-zinc-500/10    border-zinc-600/20',    accentCls: 'bg-zinc-600/50',      icon: XCircle        },
  ANALYZED:      { label: 'Analyzed',    color: 'text-indigo-400  bg-indigo-500/10  border-indigo-500/20',  accentCls: 'bg-indigo-500',       icon: CheckCircle2   },
}

const MODE_COLORS: Record<string, string> = {
  spot:            'text-sky-400    border-sky-400/25    bg-sky-400/5',
  futures:         'text-purple-400 border-purple-400/25 bg-purple-400/5',
  high_confidence: 'text-emerald-400 border-emerald-400/25 bg-emerald-400/5',
  trending:        'text-amber-400  border-amber-400/25  bg-amber-400/5',
}

// Phase 7.x intelligence chip styles (matching signals page)
const OI_CLS: Record<string, string> = {
  NEW_LONGS:        'text-emerald-400 bg-emerald-400/10 border-emerald-400/30',
  NEW_SHORTS:       'text-red-400    bg-red-400/10    border-red-400/30',
  SHORT_COVERING:   'text-amber-400  bg-amber-400/10  border-amber-400/30',
  LONG_LIQUIDATION: 'text-orange-400 bg-orange-400/10 border-orange-400/30',
}
const BREAKOUT_CLS: Record<string, string> = {
  HIGH_MOMENTUM_BREAKOUT: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30',
  CONFIRMED_BREAKOUT:     'text-blue-400   bg-blue-400/10   border-blue-400/30',
  EARLY_BREAKOUT:         'text-amber-400  bg-amber-400/10  border-amber-400/30',
}
const FUND_CLS: Record<string, string> = {
  RISING: 'text-red-400 bg-red-400/10 border-red-400/30',
  FALLING: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30',
}

const INTEL_CHIP = 'flex items-center gap-1 px-1.5 py-0.5 rounded border text-[9px] font-mono font-semibold'

const PRESETS = [
  { id: 'active', label: 'Active', stages: ['ACTIVE', 'AI_APPROVED', 'TELEGRAM_SENT'] as SignalLifecycleStage[], cls: 'bg-green-500/10 border-green-500/30 text-green-300' },
  { id: 'won',    label: '✓ Won',  stages: ['TP_HIT', 'ANALYZED']                   as SignalLifecycleStage[], cls: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' },
  { id: 'lost',   label: '✗ Lost', stages: ['SL_HIT']                               as SignalLifecycleStage[], cls: 'bg-red-500/10 border-red-500/30 text-red-300' },
]

type PresetId = 'all' | 'active' | 'won' | 'lost'

function fmt(n: number, d = 2) {
  return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
}
function timeAgo(date: string | Date) {
  const s = Math.floor((Date.now() - new Date(date).getTime()) / 1000)
  if (s < 60)   return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  return `${Math.floor(s / 3600)}h ago`
}

// ─── Signal Card (replaces table row) ────────────────────────────────────────

function SignalCard({ sig }: { sig: TacticalSignalRow }) {
  const [open, setOpen] = useState(false)
  const isBuy    = sig.type === 'BUY'
  const meta     = STAGE_META[sig.lifecycleStage]
  const StagIcon = meta.icon
  const tpPct    = sig.targetPrice > 0 && sig.entryPrice > 0
    ? ((Math.abs(sig.targetPrice - sig.entryPrice) / sig.entryPrice) * 100).toFixed(1) : '—'
  const slPct    = sig.stopLoss > 0 && sig.entryPrice > 0
    ? ((Math.abs(sig.entryPrice - sig.stopLoss) / sig.entryPrice) * 100).toFixed(1) : '—'

  const hasIntel = (sig as any).oiInterpretation || (sig as any).breakoutStrength ||
    (sig as any).fundingTrend || (sig as any).sectorStatus

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden hover:border-zinc-700 transition-colors">
      {/* Collapsed row */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer relative"
        onClick={() => setOpen(o => !o)}
      >
        {/* Stage accent bar (left) */}
        <div className={`absolute left-0 top-2 bottom-2 w-0.5 rounded-r ${meta.accentCls}`} />

        {/* Direction icon */}
        <div className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 ${
          isBuy ? 'bg-green-500/10 border border-green-500/20' : 'bg-red-500/10 border border-red-500/20'
        }`}>
          {isBuy
            ? <ArrowUpRight className="w-4 h-4 text-green-400" />
            : <ArrowDownRight className="w-4 h-4 text-red-400" />}
        </div>

        {/* Symbol + direction */}
        <div className="w-[88px] shrink-0">
          <p className="text-white text-sm font-bold font-mono leading-tight">{sig.symbol}</p>
          <p className={`text-[9px] font-semibold font-mono ${isBuy ? 'text-green-400' : 'text-red-400'}`}>
            {isBuy ? '▲ LONG' : '▼ SHORT'}
          </p>
        </div>

        {/* Stage badge */}
        <span className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border font-medium shrink-0 ${meta.color}`}>
          <StagIcon className="w-2.5 h-2.5" />
          <span>{meta.label}</span>
        </span>

        {/* Mode badge — hidden on small mobile */}
        <span className={`hidden sm:inline-flex text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded border shrink-0 ${MODE_COLORS[sig.scannerMode] ?? 'text-zinc-500 border-zinc-700'}`}>
          {sig.scannerMode.replace('_', ' ').toUpperCase()}
        </span>

        {/* Confidence */}
        <span className={`text-xs font-mono font-semibold shrink-0 ${sig.confidence >= 85 ? 'text-green-400' : sig.confidence >= 75 ? 'text-blue-400' : 'text-zinc-400'}`}>
          {sig.confidence}%
        </span>

        {/* R:R — hidden on small mobile */}
        <span className={`hidden sm:inline text-xs font-mono font-semibold shrink-0 ${sig.rrRatio >= 2 ? 'text-green-400' : sig.rrRatio >= 1.5 ? 'text-amber-400' : 'text-zinc-500'}`}>
          {fmt(sig.rrRatio, 1)}:1
        </span>

        {/* Age + expand */}
        <div className="ml-auto flex items-center gap-1.5 shrink-0">
          <span className="text-[10px] text-zinc-600 tabular-nums">{timeAgo(sig.createdAt)}</span>
          {open
            ? <ChevronUp className="w-3.5 h-3.5 text-zinc-600" />
            : <ChevronDown className="w-3.5 h-3.5 text-zinc-600" />}
        </div>
      </div>

      {/* Expanded detail */}
      {open && (
        <div className="border-t border-zinc-800/60 px-4 py-3 space-y-3 bg-zinc-800/20">

          {/* Trade levels */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <div>
              <p className="text-[9px] text-zinc-500 uppercase tracking-wider mb-0.5">Entry</p>
              <p className="text-sm font-mono font-semibold text-white">${fmt(sig.entryPrice, sig.entryPrice < 1 ? 4 : 2)}</p>
            </div>
            <div>
              <p className="text-[9px] text-zinc-500 uppercase tracking-wider mb-0.5">Target</p>
              <p className="text-sm font-mono font-semibold text-emerald-400">
                ${fmt(sig.targetPrice, sig.targetPrice < 1 ? 4 : 2)}
              </p>
              <p className="text-[9px] text-emerald-400/60 font-mono">+{tpPct}%</p>
            </div>
            <div>
              <p className="text-[9px] text-zinc-500 uppercase tracking-wider mb-0.5">Stop Loss</p>
              <p className="text-sm font-mono font-semibold text-red-400">
                ${fmt(sig.stopLoss, sig.stopLoss < 1 ? 4 : 2)}
              </p>
              <p className="text-[9px] text-red-400/60 font-mono">-{slPct}%</p>
            </div>
            <div>
              <p className="text-[9px] text-zinc-500 uppercase tracking-wider mb-0.5">R:R · Mode</p>
              <p className={`text-sm font-mono font-semibold ${sig.rrRatio >= 2 ? 'text-green-400' : sig.rrRatio >= 1.5 ? 'text-amber-400' : 'text-zinc-400'}`}>
                {fmt(sig.rrRatio, 1)}:1
              </p>
              <p className="text-[9px] text-zinc-500 font-mono">{sig.scannerMode} · {sig.timeframe}</p>
            </div>
          </div>

          {/* Intelligence chips */}
          {hasIntel && (
            <div className="flex flex-wrap gap-1.5 pt-1 border-t border-zinc-800/50">
              {(sig as any).breakoutStrength && (
                <span className={`${INTEL_CHIP} ${BREAKOUT_CLS[(sig as any).breakoutStrength] ?? 'text-zinc-500 border-zinc-700'}`}>
                  ⚡ {((sig as any).breakoutStrength as string).replace('_BREAKOUT','').replace('HIGH_MOMENTUM','HI-MOM')}
                </span>
              )}
              {(sig as any).oiInterpretation && (sig as any).oiInterpretation !== 'NEUTRAL' && (
                <span className={`${INTEL_CHIP} ${OI_CLS[(sig as any).oiInterpretation] ?? 'text-zinc-500 border-zinc-700'}`}>
                  OI: {((sig as any).oiInterpretation as string).replace(/_/g,' ')}
                </span>
              )}
              {(sig as any).fundingTrend && (sig as any).fundingTrend !== 'STABLE' && (
                <span className={`${INTEL_CHIP} ${FUND_CLS[(sig as any).fundingTrend] ?? 'text-zinc-500 border-zinc-700'}`}>
                  {(sig as any).fundingTrend === 'RISING' ? '↗' : '↘'} FUND {(sig as any).fundingTrend}
                </span>
              )}
              {(sig as any).sectorStatus && (sig as any).sectorStatus !== 'NEUTRAL' && (
                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded border text-zinc-400 border-zinc-600 bg-zinc-800/50">
                  🏛 {(sig as any).sectorStatus}
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function TacticalPage() {
  const [allSignals, setAllSignals] = useState<TacticalSignalRow[]>([])
  const [total,      setTotal]      = useState(0)
  const [error,      setError]      = useState<string | null>(null)
  const [loading,    setLoading]    = useState(true)
  const [computedAt, setComputedAt] = useState<string | null>(null)

  const [preset,     setPreset]     = useState<PresetId>('all')
  const [typeFilter, setTypeFilter] = useState<'BUY' | 'SELL' | 'all'>('all')
  const [modeFilter, setModeFilter] = useState<string>('all')

  const fetch_ = useCallback(async () => {
    try {
      const res  = await fetch('/api/signals/tactical?limit=200&lifecycleStage=all&type=all&mode=all')
      const json = await res.json()
      if (json.success) {
        setAllSignals(json.signals ?? [])
        setTotal(json.total ?? 0)
        setComputedAt(json.computedAt)
        setError(null)
      } else { setError(json.error) }
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setLoading(false) }
  }, [])

  useAutoRefresh(fetch_, 10_000)

  const stageCounts = allSignals.reduce<Record<string, number>>((acc, s) => {
    acc[s.lifecycleStage] = (acc[s.lifecycleStage] ?? 0) + 1; return acc
  }, {})

  const presetObj = PRESETS.find(p => p.id === preset)
  const signals   = allSignals.filter(s => {
    const stageOk = preset === 'all' ? true : presetObj?.stages.includes(s.lifecycleStage) ?? true
    const typeOk  = typeFilter === 'all' ? true : s.type === typeFilter
    const modeOk  = modeFilter === 'all' ? true : s.scannerMode === modeFilter
    return stageOk && typeOk && modeOk
  })

  // Count per preset for badges
  const presetCounts = {
    all:    allSignals.length,
    active: allSignals.filter(s => ['ACTIVE','AI_APPROVED','TELEGRAM_SENT'].includes(s.lifecycleStage)).length,
    won:    allSignals.filter(s => ['TP_HIT','ANALYZED'].includes(s.lifecycleStage)).length,
    lost:   allSignals.filter(s => s.lifecycleStage === 'SL_HIT').length,
  }

  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-5xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg sm:text-xl font-semibold text-white">Tactical Feed</h1>
          <p className="text-xs text-zinc-500 mt-0.5">Live signal lifecycle · 10s refresh</p>
        </div>
        <div className="flex items-center gap-2">
          {computedAt && <span className="text-xs text-zinc-600 hidden sm:block">Updated {new Date(computedAt).toLocaleTimeString()}</span>}
          <span className="text-xs text-zinc-500 bg-zinc-800/80 border border-zinc-700 px-2 py-1 rounded-lg">{total} total</span>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-900/30 border border-red-800 text-red-300 text-sm flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
        </div>
      )}

      {/* Stage distribution pills (clickable shortcuts) */}
      {allSignals.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(stageCounts)
            .filter(([, c]) => c > 0)
            .sort(([a], [b]) => {
              const order = ['ACTIVE','AI_APPROVED','TELEGRAM_SENT','TP_HIT','SL_HIT','STALE','CLOSED','VALIDATED','ANALYZED']
              return order.indexOf(a) - order.indexOf(b)
            })
            .map(([stage, count]) => {
              const m = STAGE_META[stage as SignalLifecycleStage]
              if (!m) return null
              return (
                <button key={stage}
                  onClick={() => {
                    if (['ACTIVE','AI_APPROVED','TELEGRAM_SENT'].includes(stage)) setPreset('active')
                    else if (['TP_HIT','ANALYZED'].includes(stage)) setPreset('won')
                    else if (stage === 'SL_HIT') setPreset('lost')
                    else setPreset('all')
                  }}
                  className={`flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border hover:opacity-80 transition-opacity ${m.color}`}
                >
                  {count} {m.label}
                </button>
              )
            })}
        </div>
      )}

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Preset buttons with counts */}
        <div className="flex gap-1">
          <button onClick={() => setPreset('all')}
            className={`text-xs px-2.5 py-1.5 rounded-lg border transition-colors flex items-center gap-1.5 ${preset === 'all' ? 'bg-zinc-700 border-zinc-600 text-white' : 'border-zinc-700 text-zinc-500 hover:text-zinc-300'}`}>
            All
            <span className="text-[9px] px-1 py-0.5 rounded bg-zinc-800 text-zinc-400 font-mono">{presetCounts.all}</span>
          </button>
          {PRESETS.map(p => (
            <button key={p.id} onClick={() => setPreset(p.id as PresetId)}
              className={`text-xs px-2.5 py-1.5 rounded-lg border transition-colors flex items-center gap-1.5 ${preset === p.id ? p.cls : 'border-zinc-700 text-zinc-500 hover:text-zinc-300'}`}>
              {p.label}
              <span className="text-[9px] px-1 py-0.5 rounded bg-zinc-800 text-zinc-400 font-mono">{presetCounts[p.id as keyof typeof presetCounts]}</span>
            </button>
          ))}
        </div>

        <div className="w-px h-4 bg-zinc-700 hidden sm:block" />

        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value as typeof typeFilter)}
          className="text-xs bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-1.5 text-zinc-400 hover:border-zinc-600">
          <option value="all">All Directions</option>
          <option value="BUY">▲ Long</option>
          <option value="SELL">▼ Short</option>
        </select>

        <select value={modeFilter} onChange={e => setModeFilter(e.target.value)}
          className="text-xs bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-1.5 text-zinc-400 hover:border-zinc-600">
          <option value="all">All Modes</option>
          <option value="spot">Spot</option>
          <option value="futures">Futures</option>
          <option value="high_confidence">High Conf</option>
          <option value="trending">Trending</option>
        </select>

        <span className="ml-auto text-xs text-zinc-600">{signals.length} shown</span>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center h-32 text-zinc-500 text-sm">
          <RefreshCw className="w-4 h-4 animate-spin mr-2" /> Loading…
        </div>
      )}

      {/* Signal cards */}
      {!loading && signals.length > 0 && (
        <div className="space-y-2">
          {signals.map((sig, i) => <SignalCard key={sig.id ?? i} sig={sig} />)}
        </div>
      )}

      {!loading && signals.length === 0 && !error && (
        <div className="text-center py-16 text-zinc-500 text-sm">
          No signals match the current filters.
        </div>
      )}
    </div>
  )
}
