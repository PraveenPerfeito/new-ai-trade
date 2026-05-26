'use client'

import { useState, useCallback } from 'react'
import {
  Crosshair, RefreshCw, AlertTriangle, Filter,
  CheckCircle2, Clock, Send, Zap, XCircle, TrendingUp,
  ArrowUpRight, ArrowDownRight,
} from 'lucide-react'
import { useAutoRefresh } from '@/lib/use-auto-refresh'
import type { TacticalSignalRow, SignalLifecycleStage } from '@/types'

// ─── Constants ────────────────────────────────────────────────────────────────

const STAGE_META: Record<SignalLifecycleStage, { label: string; color: string; icon: React.ElementType }> = {
  VALIDATED:     { label: 'Validated',     color: 'text-zinc-400  bg-zinc-500/10  border-zinc-500/20',  icon: CheckCircle2 },
  AI_APPROVED:   { label: 'AI Approved',   color: 'text-blue-400  bg-blue-500/10  border-blue-500/20',  icon: Zap          },
  TELEGRAM_SENT: { label: 'Sent',          color: 'text-purple-400 bg-purple-500/10 border-purple-500/20', icon: Send      },
  ACTIVE:        { label: 'Active',        color: 'text-green-400 bg-green-500/10 border-green-500/20',  icon: TrendingUp   },
  STALE:         { label: 'Stale',         color: 'text-amber-400 bg-amber-500/10 border-amber-500/20', icon: Clock        },
  TP_HIT:        { label: 'TP Hit',        color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20', icon: ArrowUpRight },
  SL_HIT:        { label: 'SL Hit',        color: 'text-red-400   bg-red-500/10   border-red-500/20',   icon: ArrowDownRight },
  CLOSED:        { label: 'Closed',        color: 'text-zinc-500  bg-zinc-500/10  border-zinc-600/20',  icon: XCircle      },
  ANALYZED:      { label: 'Analyzed',      color: 'text-indigo-400 bg-indigo-500/10 border-indigo-500/20', icon: CheckCircle2 },
}

const ALL_STAGES: (SignalLifecycleStage | 'all')[] = [
  'all', 'VALIDATED', 'AI_APPROVED', 'TELEGRAM_SENT', 'ACTIVE', 'STALE', 'TP_HIT', 'SL_HIT', 'CLOSED', 'ANALYZED',
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number, d = 2) {
  return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
}

function timeAgo(date: string | Date) {
  const s = Math.floor((Date.now() - new Date(date).getTime()) / 1000)
  if (s < 60)  return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  return `${Math.floor(s / 3600)}h ago`
}

function StageBadge({ stage }: { stage: SignalLifecycleStage }) {
  const m = STAGE_META[stage]
  const Icon = m.icon
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded border font-medium ${m.color}`}>
      <Icon className="w-3 h-3" />
      {m.label}
    </span>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function TacticalPage() {
  const [signals, setSignals] = useState<TacticalSignalRow[]>([])
  const [total, setTotal] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [computedAt, setComputedAt] = useState<string | null>(null)

  const [stageFilter, setStageFilter] = useState<SignalLifecycleStage | 'all'>('all')
  const [typeFilter,  setTypeFilter]  = useState<'BUY' | 'SELL' | 'all'>('all')
  const [modeFilter,  setModeFilter]  = useState<string>('all')

  const fetch_ = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        limit: '100',
        lifecycleStage: stageFilter,
        type: typeFilter,
        mode: modeFilter,
      })
      const res  = await fetch(`/api/signals/tactical?${params}`)
      const json = await res.json()
      if (json.success) {
        setSignals(json.signals)
        setTotal(json.total)
        setComputedAt(json.computedAt)
        setError(null)
      } else {
        setError(json.error)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [stageFilter, typeFilter, modeFilter])

  useAutoRefresh(fetch_, 10_000)

  // Stage counts for filter bar
  const stageCounts = signals.reduce<Record<string, number>>((acc, s) => {
    acc[s.lifecycleStage] = (acc[s.lifecycleStage] ?? 0) + 1
    return acc
  }, {})

  return (
    <div className="p-6 space-y-5 max-w-7xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Crosshair className="w-6 h-6 text-blue-400" />
          <div>
            <h1 className="text-xl font-semibold text-white">Tactical Feed</h1>
            <p className="text-sm text-zinc-400">Live signal lifecycle · all stages · 10s refresh</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {computedAt && <span className="text-xs text-zinc-600">Updated {new Date(computedAt).toLocaleTimeString()}</span>}
          <span className="text-xs text-zinc-500 bg-zinc-800 border border-zinc-700 px-2 py-1 rounded">{total} signals</span>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-900/30 border border-red-800 text-red-300 text-sm flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        {/* Stage filter */}
        <div className="flex items-center gap-1.5">
          <Filter className="w-3.5 h-3.5 text-zinc-500" />
          <div className="flex gap-1 flex-wrap">
            {ALL_STAGES.map((s) => {
              const active = stageFilter === s
              const count  = s === 'all' ? signals.length : (stageCounts[s] ?? 0)
              return (
                <button
                  key={s}
                  onClick={() => setStageFilter(s)}
                  className={[
                    'text-xs px-2 py-1 rounded border transition-colors',
                    active
                      ? 'bg-blue-500/20 border-blue-500/40 text-blue-300'
                      : 'border-zinc-700 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600',
                  ].join(' ')}
                >
                  {s === 'all' ? 'All' : STAGE_META[s as SignalLifecycleStage].label}
                  {count > 0 && <span className="ml-1 opacity-60">{count}</span>}
                </button>
              )
            })}
          </div>
        </div>

        {/* Type + Mode */}
        <div className="flex gap-1 ml-auto">
          {(['all', 'BUY', 'SELL'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={[
                'text-xs px-2.5 py-1 rounded border transition-colors',
                typeFilter === t
                  ? t === 'BUY' ? 'bg-green-500/20 border-green-500/40 text-green-300'
                    : t === 'SELL' ? 'bg-red-500/20 border-red-500/40 text-red-300'
                    : 'bg-zinc-700 border-zinc-600 text-zinc-200'
                  : 'border-zinc-700 text-zinc-500 hover:text-zinc-300',
              ].join(' ')}
            >
              {t === 'all' ? 'B+S' : t}
            </button>
          ))}
          {(['all', 'spot', 'futures', 'high_confidence', 'trending'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setModeFilter(m)}
              className={[
                'text-xs px-2.5 py-1 rounded border transition-colors',
                modeFilter === m
                  ? 'bg-blue-500/20 border-blue-500/40 text-blue-300'
                  : 'border-zinc-700 text-zinc-500 hover:text-zinc-300',
              ].join(' ')}
            >
              {m === 'all' ? 'All modes' : m}
            </button>
          ))}
        </div>
      </div>

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center h-32 text-zinc-500 text-sm">
          <RefreshCw className="w-4 h-4 animate-spin mr-2" /> Loading signals…
        </div>
      )}

      {/* Signal table */}
      {!loading && signals.length > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-xs text-zinc-500 uppercase tracking-wider">
                <th className="text-left px-4 py-3">Symbol</th>
                <th className="text-left px-4 py-3">Stage</th>
                <th className="text-right px-4 py-3">Type</th>
                <th className="text-right px-4 py-3">TF</th>
                <th className="text-right px-4 py-3">Entry</th>
                <th className="text-right px-4 py-3">R:R</th>
                <th className="text-right px-4 py-3">Conf</th>
                <th className="text-right px-4 py-3">Mode</th>
                <th className="text-right px-4 py-3">Age</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
              {signals.map((sig, i) => {
                const isBuy = sig.type === 'BUY'
                return (
                  <tr key={sig.id ?? i} className="hover:bg-zinc-800/40 transition-colors">
                    <td className="px-4 py-2.5">
                      <div className="font-semibold text-white text-sm">{sig.symbol}</div>
                      <div className="text-[11px] text-zinc-500 truncate max-w-[120px]">{sig.name}</div>
                    </td>
                    <td className="px-4 py-2.5">
                      <StageBadge stage={sig.lifecycleStage} />
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${isBuy ? 'text-green-400 bg-green-500/10' : 'text-red-400 bg-red-500/10'}`}>
                        {sig.type}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right text-zinc-400 text-xs font-mono">{sig.timeframe}</td>
                    <td className="px-4 py-2.5 text-right text-zinc-300 font-mono text-xs">${fmt(sig.entryPrice, sig.entryPrice < 1 ? 4 : 2)}</td>
                    <td className="px-4 py-2.5 text-right">
                      <span className={`text-xs font-mono font-medium ${sig.rrRatio >= 2 ? 'text-green-400' : sig.rrRatio >= 1.5 ? 'text-amber-400' : 'text-zinc-400'}`}>
                        {fmt(sig.rrRatio, 1)}:1
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <span className={`text-xs font-mono font-medium ${sig.confidence >= 85 ? 'text-green-400' : sig.confidence >= 75 ? 'text-blue-400' : 'text-zinc-400'}`}>
                        {sig.confidence}%
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right text-zinc-500 text-xs">{sig.scannerMode}</td>
                    <td className="px-4 py-2.5 text-right text-zinc-600 text-xs tabular-nums">{timeAgo(sig.createdAt)}</td>
                  </tr>
                )
              })}
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
