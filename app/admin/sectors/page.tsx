'use client'

import { useState, useCallback } from 'react'
import { Globe, TrendingUp, TrendingDown, RefreshCw, AlertTriangle } from 'lucide-react'
import { useAutoRefresh } from '@/lib/use-auto-refresh'
import type { SectorStats } from '@/types'

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

const MOMENTUM_COLOR: Record<string, string> = {
  ACCELERATING: 'text-green-400 bg-green-500/10 border-green-500/20',
  STABLE:       'text-blue-400 bg-blue-500/10 border-blue-500/20',
  DECELERATING: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
  REVERSING:    'text-red-400 bg-red-500/10 border-red-500/20',
}

function fmt(n: number, d = 2) { return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) }
function fmtB(n: number) {
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`
  if (n >= 1e9)  return `$${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6)  return `$${(n / 1e6).toFixed(0)}M`
  return `$${n.toFixed(0)}`
}
function ChangeCell({ val }: { val: number }) {
  return (
    <span className={`font-mono text-sm font-medium ${val >= 0 ? 'text-green-400' : 'text-red-400'}`}>
      {val >= 0 ? '+' : ''}{fmt(val)}%
    </span>
  )
}

export default function SectorsPage() {
  const [data, setData] = useState<SectorsResponse | null>(null)
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

  const cats = data?.categories
    ? [...data.categories].sort((a, b) => b.avgPriceChange - a.avgPriceChange)
    : null

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Globe className="w-6 h-6 text-blue-400" />
          <div>
            <h1 className="text-xl font-semibold text-white">Sector Rotation</h1>
            <p className="text-sm text-zinc-400">CMC categories · coin-derived breadth · momentum</p>
          </div>
        </div>
        {data && <span className="text-xs text-zinc-600">Updated {new Date(data.computedAt).toLocaleTimeString()}</span>}
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-900/30 border border-red-800 text-red-300 text-sm flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
        </div>
      )}

      {!data && !error && (
        <div className="flex items-center justify-center h-40 text-zinc-500 text-sm">
          <RefreshCw className="w-4 h-4 animate-spin mr-2" /> Loading…
        </div>
      )}

      {data && (
        <>
          {/* Strongest / Weakest highlight */}
          {(data.strongest || data.weakest) && (
            <div className="grid grid-cols-2 gap-4">
              {data.strongest && (
                <div className="bg-green-900/20 border border-green-800/40 rounded-xl p-4 flex items-center gap-3">
                  <TrendingUp className="w-8 h-8 text-green-400 shrink-0" />
                  <div>
                    <div className="text-xs text-zinc-500">Strongest Sector</div>
                    <div className="text-lg font-bold text-green-400">{data.strongest}</div>
                  </div>
                </div>
              )}
              {data.weakest && (
                <div className="bg-red-900/20 border border-red-800/40 rounded-xl p-4 flex items-center gap-3">
                  <TrendingDown className="w-8 h-8 text-red-400 shrink-0" />
                  <div>
                    <div className="text-xs text-zinc-500">Weakest Sector</div>
                    <div className="text-lg font-bold text-red-400">{data.weakest}</div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* CMC Categories (richer source) */}
          {cats && cats.length > 0 && (
            <div>
              <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-3">
                CMC Ecosystem Categories
              </h2>
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-800 text-xs text-zinc-500 uppercase tracking-wider">
                      <th className="text-left px-4 py-3">Category</th>
                      <th className="text-right px-4 py-3">Avg Δ%</th>
                      <th className="text-right px-4 py-3">Mcap Δ%</th>
                      <th className="text-right px-4 py-3">Market Cap</th>
                      <th className="text-right px-4 py-3">Coins</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800">
                    {cats.slice(0, 20).map((cat) => (
                      <tr key={cat.id} className="hover:bg-zinc-800/50 transition-colors">
                        <td className="px-4 py-3 font-medium text-white">{cat.title || cat.name}</td>
                        <td className="px-4 py-3 text-right"><ChangeCell val={cat.avgPriceChange} /></td>
                        <td className="px-4 py-3 text-right"><ChangeCell val={cat.marketCapChange} /></td>
                        <td className="px-4 py-3 text-right text-zinc-400 font-mono">{fmtB(cat.marketCap)}</td>
                        <td className="px-4 py-3 text-right text-zinc-500">{cat.coinCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Coin-derived sector stats */}
          {data.sectors.length > 0 && (
            <div>
              <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-3">
                Sector Breadth (Scanner-derived)
              </h2>
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-800 text-xs text-zinc-500 uppercase tracking-wider">
                      <th className="text-left px-4 py-3">Sector</th>
                      <th className="text-right px-4 py-3">Avg 24h</th>
                      <th className="text-right px-4 py-3">Breadth</th>
                      <th className="text-right px-4 py-3">Coins</th>
                      <th className="text-right px-4 py-3">Momentum</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800">
                    {data.sectors.map((s) => (
                      <tr key={s.name} className="hover:bg-zinc-800/50 transition-colors">
                        <td className="px-4 py-3 font-medium text-white">{s.name}</td>
                        <td className="px-4 py-3 text-right"><ChangeCell val={s.avgChange24h} /></td>
                        <td className="px-4 py-3 text-right text-zinc-400">
                          <div className="flex items-center justify-end gap-1.5">
                            <div className="w-16 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                              <div className="h-full bg-green-500 rounded-full" style={{ width: `${s.breadth * 100}%` }} />
                            </div>
                            <span className="font-mono text-xs">{(s.breadth * 100).toFixed(0)}%</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right text-zinc-500">{s.coinCount}</td>
                        <td className="px-4 py-3 text-right">
                          <span className={`text-xs px-2 py-0.5 rounded border ${MOMENTUM_COLOR[s.momentum] ?? 'text-zinc-400'}`}>
                            {s.momentum}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {data.sectors.length === 0 && !cats && (
            <div className="text-center py-12 text-zinc-500 text-sm">
              No sector data — run a scan first to populate coin-derived stats.
            </div>
          )}
        </>
      )}
    </div>
  )
}
