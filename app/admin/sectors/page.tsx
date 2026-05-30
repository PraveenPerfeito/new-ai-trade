'use client'

import { useState, useCallback } from 'react'
import { Globe, TrendingUp, TrendingDown, RefreshCw, AlertTriangle } from 'lucide-react'
import { useAutoRefresh } from '@/lib/use-auto-refresh'
import type { SectorStats } from '@/types'

// ─── Types ────────────────────────────────────────────────────────────────────

interface CategoryData {
  id: string; name: string; title: string
  coinCount: number; avgPriceChange: number
  volume24h: number; marketCap: number; marketCapChange: number
  coins: string[]
}
interface SectorsResponse {
  sectors:    SectorStats[]
  categories: CategoryData[] | null
  strongest:  string | null
  weakest:    string | null
  computedAt: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number, d = 2) {
  return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
}
function fmtB(n: number) {
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`
  if (n >= 1e9)  return `$${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6)  return `$${(n / 1e6).toFixed(0)}M`
  return `$${n.toFixed(0)}`
}

// Derive sector intelligence status from avgPriceChange
function sectorStatus(avgChange: number): {
  label: string; cls: string; border: string
} {
  if (avgChange > 12)  return { label: 'OVERCROWDED', cls: 'text-red-400',     border: 'border-l-red-500' }
  if (avgChange > 7)   return { label: 'STRONGEST',   cls: 'text-blue-400',    border: 'border-l-blue-500' }
  if (avgChange > 3)   return { label: 'ACCELERATING',cls: 'text-emerald-400', border: 'border-l-emerald-500' }
  if (avgChange < -3)  return { label: 'WEAKENING',   cls: 'text-amber-400',   border: 'border-l-amber-500' }
  if (avgChange < -7)  return { label: 'DECLINING',   cls: 'text-red-400',     border: 'border-l-red-600' }
  return                      { label: 'NEUTRAL',     cls: 'text-zinc-500',    border: 'border-l-zinc-600/40' }
}

function ChangeText({ val }: { val: number }) {
  return (
    <span className={`font-mono text-sm font-semibold ${val >= 0 ? 'text-green-400' : 'text-red-400'}`}>
      {val >= 0 ? '+' : ''}{fmt(val)}%
    </span>
  )
}

// ─── Category Card ────────────────────────────────────────────────────────────

function CategoryCard({ cat }: { cat: CategoryData }) {
  const st = sectorStatus(cat.avgPriceChange)
  return (
    <div className={`bg-zinc-900 border border-zinc-800 border-l-2 ${st.border} rounded-xl px-4 py-3`}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white truncate">{cat.title || cat.name}</p>
          <p className="text-[9px] text-zinc-500 mt-0.5">{fmtB(cat.marketCap)} · {cat.coinCount} coins</p>
        </div>
        <div className="text-right shrink-0">
          <ChangeText val={cat.avgPriceChange} />
        </div>
      </div>
      {/* Status badge */}
      <span className={`text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded border ${
        st.label === 'OVERCROWDED'  ? 'text-red-400     border-red-500/30     bg-red-500/8'     :
        st.label === 'STRONGEST'    ? 'text-blue-400    border-blue-500/30    bg-blue-500/8'    :
        st.label === 'ACCELERATING' ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/8' :
        st.label === 'WEAKENING'    ? 'text-amber-400   border-amber-500/30   bg-amber-500/8'   :
        st.label === 'DECLINING'    ? 'text-red-400/70  border-red-500/20     bg-red-500/5'     :
        'text-zinc-600 border-zinc-700/40 bg-zinc-800/40'
      }`}>{st.label}</span>
      {/* Top coins */}
      {cat.coins.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {cat.coins.slice(0, 4).map(c => (
            <span key={c} className="text-[9px] font-mono text-zinc-500 px-1 py-0.5 rounded bg-zinc-800/60">{c}</span>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SectorsPage() {
  const [data,  setData]  = useState<SectorsResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  const fetch_ = useCallback(async () => {
    try {
      const res  = await fetch('/api/market/sectors')
      const json = await res.json()
      if (json.success) { setData(json); setError(null) }
      else setError(json.error)
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
  }, [])

  useAutoRefresh(fetch_, 60_000)

  // Sort categories: strongest first
  const cats = data?.categories
    ? [...data.categories].sort((a, b) => b.avgPriceChange - a.avgPriceChange)
    : null

  // Group by status for the summary row
  const statusCounts = cats ? {
    overcrowded:  cats.filter(c => c.avgPriceChange > 12).length,
    strongest:    cats.filter(c => c.avgPriceChange > 7 && c.avgPriceChange <= 12).length,
    accelerating: cats.filter(c => c.avgPriceChange > 3 && c.avgPriceChange <= 7).length,
    neutral:      cats.filter(c => c.avgPriceChange >= -3 && c.avgPriceChange <= 3).length,
    weakening:    cats.filter(c => c.avgPriceChange < -3).length,
  } : null

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-5xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg sm:text-xl font-semibold text-white">Sector Intelligence</h1>
          <p className="text-xs text-zinc-500 mt-0.5">
            {data ? `Updated ${new Date(data.computedAt).toLocaleTimeString()}` : 'CMC ecosystem categories · momentum'}
          </p>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-900/30 border border-red-800 text-red-300 text-sm flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
        </div>
      )}

      {!data && !error && (
        <div className="flex items-center justify-center h-32 text-zinc-500 text-sm">
          <RefreshCw className="w-4 h-4 animate-spin mr-2" /> Loading…
        </div>
      )}

      {data && (
        <>
          {/* ── Hero: Strongest + Weakest ── */}
          {(data.strongest || data.weakest) && (
            <div className="grid grid-cols-2 gap-3">
              {data.strongest && (
                <div className="bg-green-900/15 border border-green-800/30 rounded-xl px-4 py-3 flex items-center gap-3">
                  <TrendingUp className="w-6 h-6 text-green-400 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-[9px] text-zinc-500 uppercase tracking-wider">Strongest</p>
                    <p className="text-sm font-bold text-green-400 truncate">{data.strongest}</p>
                  </div>
                </div>
              )}
              {data.weakest && (
                <div className="bg-red-900/15 border border-red-800/30 rounded-xl px-4 py-3 flex items-center gap-3">
                  <TrendingDown className="w-6 h-6 text-red-400 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-[9px] text-zinc-500 uppercase tracking-wider">Weakest</p>
                    <p className="text-sm font-bold text-red-400 truncate">{data.weakest}</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Status distribution ── */}
          {statusCounts && (
            <div className="flex flex-wrap gap-1.5">
              {statusCounts.overcrowded  > 0 && <span className="text-[10px] font-mono px-2 py-0.5 rounded border text-red-400 border-red-500/30 bg-red-500/8">{statusCounts.overcrowded} Overcrowded</span>}
              {statusCounts.strongest    > 0 && <span className="text-[10px] font-mono px-2 py-0.5 rounded border text-blue-400 border-blue-500/30 bg-blue-500/8">{statusCounts.strongest} Strongest</span>}
              {statusCounts.accelerating > 0 && <span className="text-[10px] font-mono px-2 py-0.5 rounded border text-emerald-400 border-emerald-500/30 bg-emerald-500/8">{statusCounts.accelerating} Accelerating</span>}
              {statusCounts.neutral      > 0 && <span className="text-[10px] font-mono px-2 py-0.5 rounded border text-zinc-500 border-zinc-700/40">{statusCounts.neutral} Neutral</span>}
              {statusCounts.weakening    > 0 && <span className="text-[10px] font-mono px-2 py-0.5 rounded border text-amber-400 border-amber-500/30 bg-amber-500/8">{statusCounts.weakening} Weakening</span>}
            </div>
          )}

          {/* ── Category cards ── */}
          {cats && cats.length > 0 && (
            <div>
              <p className="text-[9px] text-zinc-500 uppercase tracking-widest mb-2.5">CMC Ecosystem Categories</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                {cats.slice(0, 18).map(cat => (
                  <CategoryCard key={cat.id} cat={cat} />
                ))}
              </div>
            </div>
          )}

          {!cats && data.sectors.length === 0 && (
            <div className="text-center py-12 text-zinc-500 text-sm">
              No sector data — run a scan first to populate sector stats.
            </div>
          )}
        </>
      )}
    </div>
  )
}
