'use client'

import { useEffect, useState } from 'react'
import { ArrowUpRight, ArrowDownRight, Loader2 } from 'lucide-react'
import { timeAgo } from '@/lib/member-utils'
import type { TacticalSignalRow } from '@/types'

const STAGE_COLORS: Record<string, string> = {
  ACTIVE:        'text-blue-400 bg-blue-400/10',
  TELEGRAM_SENT: 'text-blue-400 bg-blue-400/10',
  AI_APPROVED:   'text-purple-400 bg-purple-400/10',
  SCREENED:      'text-sky-400 bg-sky-400/10',
  TP_HIT:        'text-emerald-400 bg-emerald-400/10',
  SL_HIT:        'text-red-400 bg-red-400/10',
  TIMEOUT:       'text-gray-500 bg-gray-500/10',
  STALE:         'text-gray-500 bg-gray-500/10',
}

const GRADE_COLORS: Record<string, string> = {
  'A+': 'text-emerald-400', A: 'text-emerald-400',
  'B+': 'text-cyan-400',    B: 'text-cyan-400',
  C:    'text-yellow-400',  D: 'text-orange-400', F: 'text-red-400',
}

export function OverviewSignalsFeed() {
  const [signals, setSignals] = useState<TacticalSignalRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/signals/tactical?limit=5')
      .then(r => r.json())
      .then(j => setSignals(j.signals ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 text-gray-600">
        <Loader2 size={16} className="animate-spin mr-2" />
        <span className="text-xs">Loading…</span>
      </div>
    )
  }

  if (signals.length === 0) {
    return (
      <div className="bg-[#0d0d14] border border-white/[0.07] rounded-xl py-8 text-center">
        <p className="text-gray-500 text-sm">No recent signals</p>
      </div>
    )
  }

  return (
    <div className="space-y-1.5">
      {signals.map(sig => {
        const isBuy = sig.type === 'BUY'
        const stageColor = STAGE_COLORS[sig.lifecycleStage ?? ''] ?? 'text-gray-500 bg-gray-500/10'
        const gradeColor = GRADE_COLORS[sig.riskGrade ?? ''] ?? 'text-gray-400'
        return (
          <div
            key={sig.id ?? sig.symbol}
            className="bg-[#0d0d14] border border-white/[0.07] rounded-xl px-4 py-3 flex items-center gap-3 flex-wrap hover:border-white/[0.12] transition-colors"
          >
            <div className={`flex items-center gap-1 shrink-0 ${isBuy ? 'text-emerald-400' : 'text-red-400'}`}>
              {isBuy ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
              <span className="text-xs font-bold">{isBuy ? 'LONG' : 'SHORT'}</span>
            </div>

            <span className="text-white text-sm font-semibold">{sig.symbol}</span>

            {sig.riskGrade && (
              <span className={`text-xs font-bold ${gradeColor}`}>{sig.riskGrade}</span>
            )}

            <span className="text-xs text-gray-500 font-mono tabular-nums">{sig.confidence}%</span>

            {sig.lifecycleStage && (
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase ${stageColor}`}>
                {sig.lifecycleStage.replace(/_/g, ' ')}
              </span>
            )}

            <span className="text-[10px] text-gray-600 ml-auto">
              {sig.createdAt ? timeAgo(String(sig.createdAt)) : ''}
            </span>
          </div>
        )
      })}
    </div>
  )
}
