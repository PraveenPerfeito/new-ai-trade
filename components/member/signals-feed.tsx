'use client'

import { useEffect, useState, useCallback } from 'react'
import { ArrowUpRight, ArrowDownRight, Loader2, RefreshCw } from 'lucide-react'
import type { TacticalSignalRow } from '@/types'

interface Props {
  limit?: number
}

const STAGE_COLORS: Record<string, string> = {
  ACTIVE:        'text-blue-400 bg-blue-400/10',
  TELEGRAM_SENT: 'text-blue-400 bg-blue-400/10',
  AI_APPROVED:   'text-purple-400 bg-purple-400/10',
  SCREENED:      'text-sky-400 bg-sky-400/10',
  TP_HIT:        'text-emerald-400 bg-emerald-400/10',
  SL_HIT:        'text-red-400 bg-red-400/10',
  TIMEOUT:       'text-red-400 bg-red-400/10',
  STALE:         'text-gray-500 bg-gray-500/10',
  CLOSED:        'text-gray-500 bg-gray-500/10',
  ANALYZED:      'text-gray-500 bg-gray-500/10',
  VALIDATED:     'text-gray-500 bg-gray-500/10',
}

const GRADE_COLORS: Record<string, string> = {
  'A+': 'text-emerald-400',
  A:    'text-emerald-400',
  'B+': 'text-cyan-400',
  B:    'text-cyan-400',
  C:    'text-yellow-400',
  D:    'text-orange-400',
  F:    'text-red-400',
}

function fmtPrice(n: number | null | undefined): string {
  if (n == null) return '—'
  if (n >= 1000) return `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
  if (n >= 1)    return `$${n.toFixed(4)}`
  return `$${n.toFixed(6)}`
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export function MemberSignalsFeed({ limit = 20 }: Props) {
  const [signals, setSignals] = useState<TacticalSignalRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(false)
  const [lastFetch, setLastFetch] = useState<Date | null>(null)

  const fetchSignals = useCallback(async () => {
    try {
      const res = await fetch(`/api/signals/tactical?limit=${limit}`, { cache: 'no-store' })
      if (!res.ok) throw new Error('fetch failed')
      const json = await res.json()
      setSignals(json.signals ?? [])
      setLastFetch(new Date())
      setError(false)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [limit])

  useEffect(() => {
    fetchSignals()
    const t = setInterval(fetchSignals, 60_000)
    return () => clearInterval(t)
  }, [fetchSignals])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-gray-600">
        <Loader2 size={18} className="animate-spin mr-2" />
        <span className="text-sm">Loading signals…</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] py-12 text-center text-gray-500 text-sm">
        Could not load signals.{' '}
        <button onClick={fetchSignals} className="text-cyan-400 hover:underline">Retry</button>
      </div>
    )
  }

  if (signals.length === 0) {
    return (
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] py-16 text-center">
        <p className="text-gray-500 text-sm">No signals in the last 7 days.</p>
      </div>
    )
  }

  return (
    <div>
      {/* Header row */}
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-gray-500">
          {signals.length} signal{signals.length !== 1 ? 's' : ''} — last 7 days
        </p>
        <button
          onClick={fetchSignals}
          className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-white transition-colors"
        >
          <RefreshCw size={11} />
          {lastFetch ? `Updated ${timeAgo(lastFetch.toISOString())}` : 'Refresh'}
        </button>
      </div>

      <div className="space-y-2">
        {signals.map((sig) => {
          const isBuy      = sig.type === 'BUY'
          const stageColor = STAGE_COLORS[sig.lifecycleStage ?? ''] ?? 'text-gray-500 bg-gray-500/10'
          const gradeColor = GRADE_COLORS[sig.riskGrade ?? ''] ?? 'text-gray-400'

          return (
            <div
              key={sig.id}
              className="rounded-xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04] hover:border-white/[0.10] transition-all px-4 py-3"
            >
              <div className="flex items-center gap-3 flex-wrap">
                {/* Direction icon */}
                <div className={`flex items-center gap-1 ${isBuy ? 'text-emerald-400' : 'text-red-400'}`}>
                  {isBuy
                    ? <ArrowUpRight size={15} />
                    : <ArrowDownRight size={15} />}
                  <span className="font-bold text-sm">{isBuy ? 'LONG' : 'SHORT'}</span>
                </div>

                {/* Symbol */}
                <span className="text-white font-semibold text-sm">{sig.symbol}</span>

                {/* Grade */}
                {sig.riskGrade && (
                  <span className={`text-xs font-bold ${gradeColor}`}>{sig.riskGrade}</span>
                )}

                {/* Confidence */}
                <span className="text-xs text-gray-400">{sig.confidence}%</span>

                {/* Stage badge */}
                {sig.lifecycleStage && (
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wide ${stageColor}`}>
                    {sig.lifecycleStage.replace(/_/g, ' ')}
                  </span>
                )}

                {/* Mode */}
                <span className="text-[10px] text-gray-600 uppercase ml-auto hidden sm:block">
                  {sig.scannerMode ?? '—'}
                </span>

                {/* Time */}
                <span className="text-[10px] text-gray-600">
                  {sig.createdAt ? timeAgo(String(sig.createdAt)) : ''}
                </span>
              </div>

              {/* Price levels row */}
              <div className="flex items-center gap-4 mt-1.5 text-xs text-gray-500 flex-wrap">
                <span>Entry <span className="text-gray-300">{fmtPrice(sig.entryPrice)}</span></span>
                <span>TP <span className="text-emerald-400">{fmtPrice(sig.targetPrice)}</span></span>
                <span>SL <span className="text-red-400">{fmtPrice(sig.stopLoss)}</span></span>
                {sig.rrRatio && (
                  <span className="text-cyan-400 font-medium">{sig.rrRatio.toFixed(1)}R</span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
