'use client'

import { useEffect, useState, useCallback } from 'react'
import { ArrowUpRight, ArrowDownRight, Loader2 } from 'lucide-react'
import { fmtPx, timeAgo, fmtDuration } from '@/lib/member-utils'
import type { TacticalSignalRow } from '@/types'

const CLOSED_STAGES = new Set([
  'TP_HIT', 'SL_HIT', 'CLOSED', 'STALE', 'ANALYZED',
])

type Period        = '7d' | '30d' | 'all'
type OutcomeFilter = 'all' | 'tp' | 'sl' | 'timeout'

const PERIOD_LIMITS: Record<Period, number> = { '7d': 100, '30d': 300, 'all': 1000 }

const OUTCOME_BADGE: Record<string, string> = {
  TP_HIT:   'bg-emerald-400/10 text-emerald-400 border border-emerald-400/20',
  SL_HIT:   'bg-red-400/10 text-red-400 border border-red-400/20',
  CLOSED:   'bg-gray-500/15 text-gray-400 border border-gray-500/25',
  STALE:    'bg-gray-500/15 text-gray-400 border border-gray-500/25',
  ANALYZED: 'bg-gray-500/15 text-gray-400 border border-gray-500/25',
}

const GRADE_BADGE: Record<string, string> = {
  'A+': 'bg-emerald-400/10 text-emerald-400',
  A:    'bg-emerald-400/10 text-emerald-400',
  'B+': 'bg-cyan-400/10 text-cyan-400',
  B:    'bg-cyan-400/10 text-cyan-400',
  C:    'bg-yellow-400/10 text-yellow-400',
  D:    'bg-orange-400/10 text-orange-400',
  F:    'bg-red-400/10 text-red-400',
}

function rrDisplay(sig: TacticalSignalRow): { text: string; cls: string } {
  if (sig.lifecycleStage === 'TP_HIT' && sig.rrAchieved != null) {
    return { text: `+${sig.rrAchieved.toFixed(2)}R`, cls: 'text-emerald-400' }
  }
  if (sig.lifecycleStage === 'SL_HIT') {
    const val = sig.rrAchieved != null ? Math.abs(sig.rrAchieved).toFixed(2) : '1.00'
    return { text: `-${val}R`, cls: 'text-red-400' }
  }
  return { text: '—', cls: 'text-gray-600' }
}

export default function ClosedSignalsPage() {
  const [all, setAll]           = useState<TacticalSignalRow[]>([])
  const [loading, setLoading]   = useState(true)
  const [period, setPeriod]     = useState<Period>('7d')
  const [outcome, setOutcome]   = useState<OutcomeFilter>('all')

  const fetchData = useCallback(async (p: Period) => {
    setLoading(true)
    try {
      const limit = PERIOD_LIMITS[p]
      const res   = await fetch(`/api/signals/tactical?limit=${limit}`, { cache: 'no-store' })
      const json  = await res.json()
      const closed = (json.signals ?? []).filter(
        (s: TacticalSignalRow) => CLOSED_STAGES.has(s.lifecycleStage ?? ''),
      )
      setAll(closed)
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData(period) }, [period, fetchData])

  const filtered = all.filter(s => {
    if (outcome === 'tp'      && s.lifecycleStage !== 'TP_HIT') return false
    if (outcome === 'sl'      && s.lifecycleStage !== 'SL_HIT') return false
    if (outcome === 'timeout' && (s.lifecycleStage === 'TP_HIT' || s.lifecycleStage === 'SL_HIT')) return false
    return true
  })

  function chipCls(active: boolean) {
    return `px-3 py-1 rounded-full text-xs font-medium transition-colors border ${
      active
        ? 'bg-white/[0.08] text-white border-white/[0.12]'
        : 'text-gray-400 border-white/[0.06] hover:text-white hover:border-white/[0.10]'
    }`
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-white">Closed Signals</h1>
          <span className="bg-gray-500/10 text-gray-400 text-xs font-bold px-2 py-0.5 rounded-full">
            {filtered.length}
          </span>
        </div>
        {/* Period selector */}
        <div className="flex gap-1.5">
          {(['7d', '30d', 'all'] as Period[]).map(p => (
            <button key={p} onClick={() => setPeriod(p)} className={chipCls(period === p)}>
              {p === 'all' ? 'All' : p.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Outcome filter chips */}
      <div className="flex flex-wrap gap-2 mb-5">
        <button className={chipCls(outcome === 'all')}     onClick={() => setOutcome('all')}>All</button>
        <button className={chipCls(outcome === 'tp')}      onClick={() => setOutcome('tp')}>TP Hit</button>
        <button className={chipCls(outcome === 'sl')}      onClick={() => setOutcome('sl')}>SL Hit</button>
        <button className={chipCls(outcome === 'timeout')} onClick={() => setOutcome('timeout')}>Timeout</button>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-16 text-gray-600">
          <Loader2 size={16} className="animate-spin mr-2" />
          <span className="text-sm">Loading…</span>
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <div className="bg-[#0d0d14] border border-white/[0.07] rounded-xl py-12 text-center">
          <p className="text-gray-500 text-sm">No closed signals for this period.</p>
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div className="space-y-1.5">
          {filtered.map(sig => {
            const isBuy     = sig.type === 'BUY'
            const { text: rrText, cls: rrCls } = rrDisplay(sig)
            const outcomeCls = OUTCOME_BADGE[sig.lifecycleStage ?? ''] ?? OUTCOME_BADGE['CLOSED']
            const gradeCls   = GRADE_BADGE[sig.riskGrade ?? '']        ?? 'bg-gray-500/10 text-gray-400'
            return (
              <div
                key={sig.id ?? `${sig.symbol}-${String(sig.createdAt)}`}
                className={`bg-[#0d0d14] border border-white/[0.07] rounded-xl px-4 py-3 border-l-2 ${
                  sig.lifecycleStage === 'TP_HIT' ? 'border-l-emerald-600' :
                  sig.lifecycleStage === 'SL_HIT' ? 'border-l-red-600' :
                  'border-l-gray-700'
                }`}
              >
                <div className="flex items-center gap-2 flex-wrap">
                  {/* Direction */}
                  <div className={`flex items-center gap-1 w-14 shrink-0 ${isBuy ? 'text-emerald-400' : 'text-red-400'}`}>
                    {isBuy ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
                    <span className="text-xs font-bold">{isBuy ? 'LONG' : 'SHORT'}</span>
                  </div>

                  {/* Symbol */}
                  <span className="text-white text-sm font-semibold min-w-[72px]">{sig.symbol}</span>

                  {/* Grade */}
                  {sig.riskGrade && (
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${gradeCls}`}>
                      {sig.riskGrade}
                    </span>
                  )}

                  {/* Confidence */}
                  <span className="text-xs text-gray-500 font-mono tabular-nums w-10 text-right">
                    {sig.confidence}%
                  </span>

                  {/* Entry */}
                  <span className="hidden sm:block text-xs font-mono tabular-nums text-gray-400">
                    {fmtPx(sig.entryPrice)}
                  </span>

                  {/* Outcome badge */}
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase ${outcomeCls}`}>
                    {(sig.lifecycleStage ?? '').replace(/_/g, ' ')}
                  </span>

                  {/* R achieved */}
                  <span className={`text-xs font-mono tabular-nums font-bold ${rrCls}`}>{rrText}</span>

                  {/* Duration */}
                  <span className="hidden sm:block text-xs text-gray-600 font-mono">
                    {fmtDuration(sig.durationHours)}
                  </span>

                  {/* Time */}
                  <span className="text-[10px] text-gray-600 ml-auto">
                    {sig.createdAt ? timeAgo(String(sig.createdAt)) : ''}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
