'use client'

import { useEffect, useState, useCallback } from 'react'
import { Loader2 } from 'lucide-react'

type Period = '7d' | '30d' | '90d'

interface PerfTotals {
  tp: number
  sl: number
  timeout: number
  total: number
  winRate: number
  profitFactor: number
  expectancy: number
}

interface ByMode {
  mode: string
  n: number
  tp: number
  winRate: number
  expectancy: number
  avgRR: number
}

interface ByGrade {
  grade: string
  n: number
  tp: number
  winRate: number
  expectancy: number
}

interface PerfData {
  period: string
  totals: PerfTotals
  byMode: ByMode[]
  byGrade: ByGrade[]
}

interface StatTileProps {
  label: string
  value: string
  color: string
}

function StatTile({ label, value, color }: StatTileProps) {
  return (
    <div className="bg-[#0d0d14] border border-white/[0.07] rounded-xl p-5">
      <p className={`text-xs uppercase tracking-wider mb-2 ${color}`}>{label}</p>
      <p className="text-3xl font-mono font-bold text-white tabular-nums">{value}</p>
    </div>
  )
}

export default function PerformancePage() {
  const [data, setData]       = useState<PerfData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(false)
  const [period, setPeriod]   = useState<Period>('7d')

  const fetchData = useCallback(async (p: Period) => {
    setLoading(true)
    setError(false)
    try {
      const res  = await fetch(`/api/member/performance?period=${p}`, { cache: 'no-store' })
      if (!res.ok) throw new Error('fetch failed')
      const json = await res.json()
      setData(json as PerfData)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData(period) }, [period, fetchData])

  function chipCls(active: boolean) {
    return `px-3 py-1 rounded-full text-xs font-medium transition-colors border ${
      active
        ? 'bg-white/[0.08] text-white border-white/[0.12]'
        : 'text-gray-400 border-white/[0.06] hover:text-white hover:border-white/[0.10]'
    }`
  }

  const wr  = data?.totals.winRate  ?? 0
  const pf  = data?.totals.profitFactor ?? 0
  const exp = data?.totals.expectancy   ?? 0
  const tot = data?.totals.total        ?? 0

  const wrDisplay  = tot >= 5 ? `${Math.round(wr * 100)}%`          : '—'
  const pfDisplay  = tot >= 5 ? pf.toFixed(2)                       : '—'
  const expDisplay = tot >= 5 ? `${exp >= 0 ? '+' : ''}${exp.toFixed(2)}R` : '—'

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h1 className="text-xl font-bold text-white">Performance</h1>
        <div className="flex gap-1.5">
          {(['7d', '30d', '90d'] as Period[]).map(p => (
            <button key={p} onClick={() => setPeriod(p)} className={chipCls(period === p)}>
              {p.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-16 text-gray-600">
          <Loader2 size={16} className="animate-spin mr-2" />
          <span className="text-sm">Loading performance data…</span>
        </div>
      )}

      {error && !loading && (
        <div className="bg-[#0d0d14] border border-white/[0.07] rounded-xl py-12 text-center">
          <p className="text-gray-500 text-sm">Could not load performance data.</p>
          <button
            onClick={() => fetchData(period)}
            className="text-cyan-400 text-xs hover:underline mt-2"
          >
            Retry
          </button>
        </div>
      )}

      {!loading && !error && data && (
        <>
          {/* Hero stat tiles */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <StatTile label="Win Rate"      value={wrDisplay}  color="text-emerald-400" />
            <StatTile label="Profit Factor" value={pfDisplay}  color="text-cyan-400"    />
            <StatTile label="Expectancy"    value={expDisplay} color="text-blue-400"    />
            <StatTile label="Resolved"      value={String(tot)} color="text-purple-400" />
          </div>

          {/* Outcome distribution bar */}
          {data.totals.total > 0 && (
            <div className="bg-[#0d0d14] border border-white/[0.07] rounded-xl p-5 mb-6">
              <p className="text-xs uppercase tracking-wider text-gray-500 mb-3">
                Outcome Distribution
              </p>
              <div className="flex rounded-full overflow-hidden h-3 mb-3">
                <div
                  style={{ width: `${(data.totals.tp / data.totals.total) * 100}%` }}
                  className="bg-emerald-500"
                />
                <div
                  style={{ width: `${(data.totals.sl / data.totals.total) * 100}%` }}
                  className="bg-red-500"
                />
                <div
                  style={{ width: `${(data.totals.timeout / data.totals.total) * 100}%` }}
                  className="bg-gray-600"
                />
              </div>
              <div className="flex gap-4 text-xs text-gray-400">
                <span>
                  <span className="text-emerald-400 font-bold">{data.totals.tp}</span> TP
                </span>
                <span>
                  <span className="text-red-400 font-bold">{data.totals.sl}</span> SL
                </span>
                <span>
                  <span className="text-gray-400 font-bold">{data.totals.timeout}</span> Timeout
                </span>
              </div>
            </div>
          )}

          {/* By mode + by grade tables */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* By Mode */}
            <div className="bg-[#0d0d14] border border-white/[0.07] rounded-xl p-5">
              <p className="text-xs uppercase tracking-wider text-gray-500 mb-4">
                By Scanner Mode
              </p>
              {data.byMode.length > 0 ? (
                <div className="space-y-3">
                  {data.byMode.map(row => (
                    <div key={row.mode}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm text-white capitalize">{row.mode}</span>
                        <span className="text-xs text-gray-400 font-mono tabular-nums">
                          {Math.round(row.winRate * 100)}% · {row.n}n
                        </span>
                      </div>
                      <div className="h-1.5 bg-white/[0.05] rounded-full overflow-hidden">
                        <div
                          style={{ width: `${row.winRate * 100}%` }}
                          className="h-full bg-emerald-400/60 rounded-full"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-gray-600 text-sm">No data for this period.</p>
              )}
            </div>

            {/* By Grade */}
            <div className="bg-[#0d0d14] border border-white/[0.07] rounded-xl p-5">
              <p className="text-xs uppercase tracking-wider text-gray-500 mb-4">
                By Risk Grade
              </p>
              {data.byGrade.length > 0 ? (
                <div className="space-y-3">
                  {data.byGrade.map(row => (
                    <div key={row.grade}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm text-white">Grade {row.grade}</span>
                        <span className="text-xs text-gray-400 font-mono tabular-nums">
                          {Math.round(row.winRate * 100)}% · {row.n}n
                        </span>
                      </div>
                      <div className="h-1.5 bg-white/[0.05] rounded-full overflow-hidden">
                        <div
                          style={{ width: `${row.winRate * 100}%` }}
                          className="h-full bg-cyan-400/60 rounded-full"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-gray-600 text-sm">No data for this period.</p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
