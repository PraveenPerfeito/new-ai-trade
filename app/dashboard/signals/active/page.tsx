'use client'

import { useEffect, useState, useCallback } from 'react'
import { ArrowUpRight, ArrowDownRight, Loader2 } from 'lucide-react'
import { fmtPx, timeAgo } from '@/lib/member-utils'
import type { TacticalSignalRow } from '@/types'

const ACTIVE_STAGES = new Set([
  'ACTIVE', 'TELEGRAM_SENT', 'AI_APPROVED', 'SCREENED', 'VALIDATED',
])

const STAGE_COLORS: Record<string, string> = {
  ACTIVE:        'bg-blue-400/10 text-blue-400',
  TELEGRAM_SENT: 'bg-blue-400/10 text-blue-400',
  AI_APPROVED:   'bg-purple-400/10 text-purple-400',
  SCREENED:      'bg-sky-400/10 text-sky-400',
  VALIDATED:     'bg-gray-500/10 text-gray-400',
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

type FilterDir  = 'all' | 'long' | 'short'
type FilterMode = 'all' | 'spot' | 'futures' | 'trending'

export default function ActiveSignalsPage() {
  const [all, setAll]         = useState<TacticalSignalRow[]>([])
  const [loading, setLoading] = useState(true)
  const [dir, setDir]         = useState<FilterDir>('all')
  const [mode, setMode]       = useState<FilterMode>('all')

  const fetch60 = useCallback(async () => {
    try {
      const res  = await fetch('/api/signals/tactical?limit=200', { cache: 'no-store' })
      const json = await res.json()
      const active = (json.signals ?? []).filter(
        (s: TacticalSignalRow) => ACTIVE_STAGES.has(s.lifecycleStage ?? ''),
      )
      setAll(active)
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetch60()
    const t = setInterval(fetch60, 60_000)
    return () => clearInterval(t)
  }, [fetch60])

  const filtered = all.filter(s => {
    if (dir  === 'long'     && s.type        !== 'BUY')      return false
    if (dir  === 'short'    && s.type        !== 'SELL')     return false
    if (mode === 'spot'     && s.scannerMode !== 'spot')     return false
    if (mode === 'futures'  && s.scannerMode !== 'futures')  return false
    if (mode === 'trending' && s.scannerMode !== 'trending') return false
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
          <h1 className="text-xl font-bold text-white">Active Signals</h1>
          <span className="bg-blue-400/10 text-blue-400 text-xs font-bold px-2 py-0.5 rounded-full">
            {filtered.length}
          </span>
        </div>
      </div>

      {/* Filter chips */}
      <div className="flex flex-wrap gap-2 mb-5">
        <button className={chipCls(dir === 'all')}    onClick={() => setDir('all')}>All</button>
        <button className={chipCls(dir === 'long')}   onClick={() => setDir('long')}>Long</button>
        <button className={chipCls(dir === 'short')}  onClick={() => setDir('short')}>Short</button>
        <div className="w-px h-5 bg-white/[0.08] self-center mx-1" />
        <button className={chipCls(mode === 'all')}      onClick={() => setMode('all')}>All modes</button>
        <button className={chipCls(mode === 'spot')}     onClick={() => setMode('spot')}>Spot</button>
        <button className={chipCls(mode === 'futures')}  onClick={() => setMode('futures')}>Futures</button>
        <button className={chipCls(mode === 'trending')} onClick={() => setMode('trending')}>Trending</button>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-16 text-gray-600">
          <Loader2 size={16} className="animate-spin mr-2" />
          <span className="text-sm">Loading signals…</span>
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <div className="text-center py-16">
          <div className="flex items-center justify-center gap-2 mb-3">
            <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
            <span className="text-gray-400 text-sm">Scanning markets…</span>
          </div>
          <p className="text-gray-600 text-xs">
            No active signals right now. Scans run every 15–30 minutes.
          </p>
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div className="space-y-1.5">
          {filtered.map(sig => {
            const isBuy    = sig.type === 'BUY'
            const stageCls = STAGE_COLORS[sig.lifecycleStage ?? ''] ?? 'bg-gray-500/10 text-gray-400'
            const gradeCls = GRADE_BADGE[sig.riskGrade ?? '']        ?? 'bg-gray-500/10 text-gray-400'
            return (
              <div
                key={sig.id ?? sig.symbol}
                className={`bg-[#0d0d14] border border-white/[0.07] rounded-xl px-4 py-3 border-l-2 hover:bg-[#0f0f1a] transition-colors ${
                  isBuy ? 'border-l-emerald-500' : 'border-l-red-500'
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
                  <span className="text-xs text-gray-400 font-mono tabular-nums w-10 text-right">
                    {sig.confidence}%
                  </span>

                  {/* Entry / TP / SL */}
                  <div className="hidden sm:flex items-center gap-3 text-xs font-mono tabular-nums">
                    <span className="text-gray-400">
                      <span className="text-gray-600 mr-1">E</span>{fmtPx(sig.entryPrice)}
                    </span>
                    <span className="text-emerald-400">
                      <span className="text-gray-600 mr-1">TP</span>{fmtPx(sig.targetPrice)}
                    </span>
                    <span className="text-red-400">
                      <span className="text-gray-600 mr-1">SL</span>{fmtPx(sig.stopLoss)}
                    </span>
                  </div>

                  {/* R:R */}
                  <span className="text-xs font-mono tabular-nums text-cyan-400 hidden sm:block">
                    {sig.rrRatio?.toFixed(1)}R
                  </span>

                  {/* Stage */}
                  {sig.lifecycleStage && (
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase ${stageCls}`}>
                      {sig.lifecycleStage.replace(/_/g, ' ')}
                    </span>
                  )}

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
