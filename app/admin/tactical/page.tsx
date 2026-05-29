'use client'

import { useState, useCallback } from 'react'
import {
  Crosshair, RefreshCw, AlertTriangle,
  CheckCircle2, Clock, Send, Zap, XCircle, TrendingUp,
  ArrowUpRight, ArrowDownRight, ChevronDown,
} from 'lucide-react'
import { useAutoRefresh } from '@/lib/use-auto-refresh'
import type { TacticalSignalRow, SignalLifecycleStage } from '@/types'

// ─── Constants ────────────────────────────────────────────────────────────────

const STAGE_META: Record<SignalLifecycleStage, { label: string; color: string; icon: React.ElementType }> = {
  VALIDATED:     { label: 'Validated',   color: 'text-zinc-400    bg-zinc-500/10    border-zinc-500/20',    icon: CheckCircle2  },
  AI_APPROVED:   { label: 'AI Approved', color: 'text-blue-400    bg-blue-500/10    border-blue-500/20',    icon: Zap           },
  TELEGRAM_SENT: { label: 'Sent',        color: 'text-purple-400  bg-purple-500/10  border-purple-500/20',  icon: Send          },
  ACTIVE:        { label: 'Active',      color: 'text-green-400   bg-green-500/10   border-green-500/20',   icon: TrendingUp    },
  STALE:         { label: 'Stale',       color: 'text-amber-400   bg-amber-500/10   border-amber-500/20',   icon: Clock         },
  TP_HIT:        { label: 'TP Hit',      color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20', icon: ArrowUpRight  },
  SL_HIT:        { label: 'SL Hit',      color: 'text-red-400     bg-red-500/10     border-red-500/20',     icon: ArrowDownRight },
  CLOSED:        { label: 'Closed',      color: 'text-zinc-500    bg-zinc-500/10    border-zinc-600/20',    icon: XCircle       },
  ANALYZED:      { label: 'Analyzed',    color: 'text-indigo-400  bg-indigo-500/10  border-indigo-500/20',  icon: CheckCircle2  },
}

// Preset filter definitions
const PRESETS = [
  {
    id: 'active',
    label: '🟢 Active',
    stages: ['ACTIVE', 'AI_APPROVED', 'TELEGRAM_SENT'] as SignalLifecycleStage[],
    color: 'bg-green-500/10 border-green-500/30 text-green-300',
  },
  {
    id: 'won',
    label: '✓ Won',
    stages: ['TP_HIT', 'ANALYZED'] as SignalLifecycleStage[],
    color: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300',
  },
  {
    id: 'lost',
    label: '✗ Lost',
    stages: ['SL_HIT'] as SignalLifecycleStage[],
    color: 'bg-red-500/10 border-red-500/30 text-red-300',
  },
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

function StageBadge({ stage }: { stage: SignalLifecycleStage }) {
  const m    = STAGE_META[stage]
  const Icon = m.icon
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded border font-medium ${m.color}`}>
      <Icon className="w-3 h-3" />
      <span className="hidden sm:inline">{m.label}</span>
    </span>
  )
}

// ─── Expandable mobile row ────────────────────────────────────────────────────

function SignalRow({ sig, i }: { sig: TacticalSignalRow; i: number }) {
  const [open, setOpen] = useState(false)
  const isBuy = sig.type === 'BUY'
  return (
    <>
      <tr
        key={sig.id ?? i}
        className="hover:bg-zinc-800/40 transition-colors cursor-pointer"
        onClick={() => setOpen(o => !o)}
      >
        <td className="px-3 sm:px-4 py-2.5">
          <div className="font-semibold text-white text-sm">{sig.symbol}</div>
          <div className="text-[10px] text-zinc-500 sm:hidden">{sig.scannerMode} · {sig.timeframe}</div>
        </td>
        <td className="px-3 sm:px-4 py-2.5"><StageBadge stage={sig.lifecycleStage} /></td>
        <td className="px-3 sm:px-4 py-2.5 text-right">
          <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${isBuy ? 'text-green-400 bg-green-500/10' : 'text-red-400 bg-red-500/10'}`}>
            {sig.type}
          </span>
        </td>
        <td className="px-3 sm:px-4 py-2.5 text-right">
          <span className={`text-xs font-mono font-medium ${sig.confidence >= 85 ? 'text-green-400' : sig.confidence >= 75 ? 'text-blue-400' : 'text-zinc-400'}`}>
            {sig.confidence}%
          </span>
        </td>
        {/* Desktop-only columns */}
        <td className="px-4 py-2.5 text-right text-zinc-300 font-mono text-xs hidden md:table-cell">
          ${fmt(sig.entryPrice, sig.entryPrice < 1 ? 4 : 2)}
        </td>
        <td className="px-4 py-2.5 text-right hidden md:table-cell">
          <span className={`text-xs font-mono font-medium ${sig.rrRatio >= 2 ? 'text-green-400' : sig.rrRatio >= 1.5 ? 'text-amber-400' : 'text-zinc-400'}`}>
            {fmt(sig.rrRatio, 1)}:1
          </span>
        </td>
        <td className="px-4 py-2.5 text-right text-zinc-500 text-xs hidden md:table-cell">{sig.scannerMode}</td>
        <td className="px-3 sm:px-4 py-2.5 text-right text-zinc-600 text-xs tabular-nums">{timeAgo(sig.createdAt)}</td>
        <td className="px-2 py-2.5 text-zinc-600 md:hidden">
          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
        </td>
      </tr>
      {/* Mobile expand row */}
      {open && (
        <tr className="md:hidden bg-zinc-800/30">
          <td colSpan={6} className="px-4 py-3">
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div><span className="text-zinc-500">Entry: </span><span className="text-white font-mono">${fmt(sig.entryPrice, sig.entryPrice < 1 ? 4 : 2)}</span></div>
              <div><span className="text-zinc-500">R:R: </span><span className={`font-mono ${sig.rrRatio >= 2 ? 'text-green-400' : 'text-amber-400'}`}>{fmt(sig.rrRatio, 1)}:1</span></div>
              <div><span className="text-zinc-500">Mode: </span><span className="text-white">{sig.scannerMode}</span></div>
              <div><span className="text-zinc-500">TF: </span><span className="text-white">{sig.timeframe}</span></div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function TacticalPage() {
  const [allSignals, setAllSignals] = useState<TacticalSignalRow[]>([])
  const [total,      setTotal]      = useState(0)
  const [error,      setError]      = useState<string | null>(null)
  const [loading,    setLoading]    = useState(true)
  const [computedAt, setComputedAt] = useState<string | null>(null)

  // Simplified filters
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

  // Stage distribution counts
  const stageCounts = allSignals.reduce<Record<string, number>>((acc, s) => {
    acc[s.lifecycleStage] = (acc[s.lifecycleStage] ?? 0) + 1
    return acc
  }, {})

  // Apply filters
  const presetObj = PRESETS.find(p => p.id === preset)
  const signals   = allSignals.filter(s => {
    const stageOk = preset === 'all' ? true : presetObj?.stages.includes(s.lifecycleStage) ?? true
    const typeOk  = typeFilter === 'all' ? true : s.type === typeFilter
    const modeOk  = modeFilter === 'all' ? true : s.scannerMode === modeFilter
    return stageOk && typeOk && modeOk
  })

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-7xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Crosshair className="w-6 h-6 text-blue-400" />
          <div>
            <h1 className="text-lg sm:text-xl font-semibold text-white">Tactical Feed</h1>
            <p className="text-xs sm:text-sm text-zinc-400">Live signal lifecycle · 10s refresh</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {computedAt && <span className="text-xs text-zinc-600 hidden sm:block">Updated {new Date(computedAt).toLocaleTimeString()}</span>}
          <span className="text-xs text-zinc-500 bg-zinc-800 border border-zinc-700 px-2 py-1 rounded">{total} signals</span>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-900/30 border border-red-800 text-red-300 text-sm flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
        </div>
      )}

      {/* ── Stage distribution summary ── */}
      {allSignals.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {Object.entries(stageCounts)
            .filter(([, count]) => count > 0)
            .sort(([a], [b]) => {
              const order = ['ACTIVE','AI_APPROVED','TELEGRAM_SENT','TP_HIT','SL_HIT','STALE','CLOSED','VALIDATED','ANALYZED']
              return order.indexOf(a) - order.indexOf(b)
            })
            .map(([stage, count]) => {
              const m = STAGE_META[stage as SignalLifecycleStage]
              return m ? (
                <button
                  key={stage}
                  onClick={() => {
                    // clicking a distribution pill sets the matching preset
                    if (['ACTIVE','AI_APPROVED','TELEGRAM_SENT'].includes(stage)) setPreset('active')
                    else if (['TP_HIT','ANALYZED'].includes(stage)) setPreset('won')
                    else if (stage === 'SL_HIT') setPreset('lost')
                    else setPreset('all')
                  }}
                  className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded border hover:opacity-80 transition-opacity ${m.color}`}
                >
                  {count} {m.label}
                </button>
              ) : null
            })
          }
        </div>
      )}

      {/* ── Compact filter bar ── */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Preset buttons */}
        <div className="flex gap-1">
          <button
            onClick={() => setPreset('all')}
            className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${preset === 'all' ? 'bg-zinc-700 border-zinc-600 text-white' : 'border-zinc-700 text-zinc-500 hover:text-zinc-300'}`}
          >
            All
          </button>
          {PRESETS.map(p => (
            <button key={p.id} onClick={() => setPreset(p.id as PresetId)}
              className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${preset === p.id ? p.color : 'border-zinc-700 text-zinc-500 hover:text-zinc-300'}`}>
              {p.label}
            </button>
          ))}
        </div>

        <div className="w-px h-4 bg-zinc-700 hidden sm:block" />

        {/* Direction dropdown */}
        <select
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value as typeof typeFilter)}
          className="text-xs bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-1.5 text-zinc-400 hover:border-zinc-600"
        >
          <option value="all">All Directions</option>
          <option value="BUY">▲ Long only</option>
          <option value="SELL">▼ Short only</option>
        </select>

        {/* Mode dropdown */}
        <select
          value={modeFilter}
          onChange={e => setModeFilter(e.target.value)}
          className="text-xs bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-1.5 text-zinc-400 hover:border-zinc-600"
        >
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
          <RefreshCw className="w-4 h-4 animate-spin mr-2" /> Loading signals…
        </div>
      )}

      {/* Signal table — responsive with expandable rows on mobile */}
      {!loading && signals.length > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-xs text-zinc-500 uppercase tracking-wider">
                <th className="text-left px-3 sm:px-4 py-3">Symbol</th>
                <th className="text-left px-3 sm:px-4 py-3">Stage</th>
                <th className="text-right px-3 sm:px-4 py-3">Type</th>
                <th className="text-right px-3 sm:px-4 py-3">Conf</th>
                <th className="text-right px-4 py-3 hidden md:table-cell">Entry</th>
                <th className="text-right px-4 py-3 hidden md:table-cell">R:R</th>
                <th className="text-right px-4 py-3 hidden md:table-cell">Mode</th>
                <th className="text-right px-3 sm:px-4 py-3">Age</th>
                <th className="px-2 py-3 md:hidden" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
              {signals.map((sig, i) => <SignalRow key={sig.id ?? i} sig={sig} i={i} />)}
            </tbody>
          </table>
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
