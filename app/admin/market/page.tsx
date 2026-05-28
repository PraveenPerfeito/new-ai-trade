'use client'

import { useState, useCallback } from 'react'
import {
  TrendingUp, TrendingDown, Activity, Globe, Zap,
  RefreshCw, AlertTriangle, ArrowUpRight, ArrowDownRight,
} from 'lucide-react'
import { useAutoRefresh } from '@/lib/use-auto-refresh'

// ─── Types ────────────────────────────────────────────────────────────────────

type MarketRegime =
  | 'BULL_TREND' | 'BEAR_TREND' | 'SIDEWAYS'
  | 'HIGH_VOLATILITY' | 'EUPHORIA' | 'CAPITULATION'

interface RegimeData {
  regime:      MarketRegime
  btcRsi4h:    number
  btcTrend4h:  string
  btcAtrPct:   number
  btc24hChange: number
  computedAt:  string
}

interface GlobalData {
  btcDominance:               number
  ethDominance:               number
  totalMarketCapUsd:          number
  totalVolume24hUsd:          number
  marketCapChangePercent24h:  number
  activeCurrencies:           number
  refreshedAt:                string
}

interface TrendingCoin {
  id:             number
  symbol:         string
  name:           string
  rank:           number
  priceChange1h:  number
  priceChange24h: number
  volume24h:      number
  marketCap:      number
}

interface IntelligenceData {
  regime:   RegimeData
  global:   GlobalData | null
  trending: { trending: TrendingCoin[]; refreshedAt: string } | null
  listings: { breadthUp: number; breadthDown: number; topMovers: { symbol: string; change: number }[] } | null
  computedAt: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const REGIME_META: Record<MarketRegime, { label: string; color: string; bg: string; desc: string }> = {
  BULL_TREND:      { label: 'Bull Trend',      color: 'text-green-400',  bg: 'bg-green-500/10 border-green-500/20',  desc: 'BTC 4h bullish with strong trend momentum' },
  BEAR_TREND:      { label: 'Bear Trend',       color: 'text-red-400',    bg: 'bg-red-500/10 border-red-500/20',      desc: 'BTC 4h bearish with sustained selling pressure' },
  SIDEWAYS:        { label: 'Sideways',         color: 'text-zinc-400',   bg: 'bg-zinc-500/10 border-zinc-500/20',    desc: 'No clear directional bias — consolidating' },
  HIGH_VOLATILITY: { label: 'High Volatility',  color: 'text-amber-400',  bg: 'bg-amber-500/10 border-amber-500/20',  desc: 'ATR elevated — increased whipsaw risk' },
  EUPHORIA:        { label: 'Euphoria',         color: 'text-purple-400', bg: 'bg-purple-500/10 border-purple-500/20', desc: 'Overbought — RSI > 78, extreme greed' },
  CAPITULATION:    { label: 'Capitulation',     color: 'text-rose-400',   bg: 'bg-rose-900/20 border-rose-500/20',    desc: 'Extreme fear — RSI < 22, mass selling' },
}

function fmt(n: number, decimals = 2) {
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

function fmtB(n: number) {
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`
  if (n >= 1e9)  return `$${(n / 1e9).toFixed(1)}B`
  return `$${(n / 1e6).toFixed(0)}M`
}

function fmtTs(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString()
}

function ChangeChip({ val }: { val: number }) {
  const pos = val >= 0
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-medium px-1.5 py-0.5 rounded ${pos ? 'text-green-400 bg-green-500/10' : 'text-red-400 bg-red-500/10'}`}>
      {pos ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
      {Math.abs(val).toFixed(2)}%
    </span>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function MarketIntelligencePage() {
  const [data, setData] = useState<IntelligenceData | null>(null)
  const [error, setError] = useState<string | null>(null)

  const fetch_ = useCallback(async () => {
    try {
      const res  = await fetch('/api/market/intelligence')
      const json = await res.json()
      if (json.success) { setData(json); setError(null) }
      else setError(json.error)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  useAutoRefresh(fetch_, 30_000)

  const regime = data?.regime
  const meta   = regime ? REGIME_META[regime.regime] : null

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Activity className="w-6 h-6 text-blue-400" />
          <div>
            <h1 className="text-xl font-semibold text-white">Market Intelligence</h1>
            <p className="text-sm text-zinc-400">Regime · global metrics · breadth · trending</p>
          </div>
        </div>
        {data && <span className="text-xs text-zinc-600">Updated {fmtTs(data.computedAt)}</span>}
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
          {/* Regime Hero */}
          {regime && meta && (
            <div className={`rounded-xl border p-5 ${meta.bg}`}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-xs text-zinc-500 uppercase tracking-widest mb-1">Market Regime</div>
                  <div className={`text-3xl font-bold ${meta.color}`}>{meta.label}</div>
                  <div className="text-sm text-zinc-400 mt-1">{meta.desc}</div>
                </div>
                <div className="text-right shrink-0 space-y-1">
                  <div className="text-xs text-zinc-500">BTC RSI 4h</div>
                  <div className={`text-2xl font-bold ${regime.btcRsi4h > 70 ? 'text-red-400' : regime.btcRsi4h < 30 ? 'text-green-400' : 'text-white'}`}>
                    {fmt(regime.btcRsi4h, 1)}
                  </div>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-4 pt-4 border-t border-white/10">
                <div>
                  <div className="text-xs text-zinc-500">BTC 24h</div>
                  <ChangeChip val={regime.btc24hChange} />
                </div>
                <div>
                  <div className="text-xs text-zinc-500">ATR%</div>
                  <div className="text-sm text-white font-medium">{fmt(regime.btcAtrPct, 2)}%</div>
                </div>
                <div>
                  <div className="text-xs text-zinc-500">4h Trend</div>
                  <div className={`text-sm font-medium ${regime.btcTrend4h === 'BULLISH' ? 'text-green-400' : regime.btcTrend4h === 'BEARISH' ? 'text-red-400' : 'text-zinc-400'}`}>
                    {regime.btcTrend4h}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Global Metrics */}
          {data.global ? (
            <div>
              <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-3">Global Metrics</h2>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {[
                  { label: 'Total Market Cap', value: fmtB(data.global.totalMarketCapUsd), sub: <ChangeChip val={data.global.marketCapChangePercent24h} /> },
                  { label: '24h Volume',        value: fmtB(data.global.totalVolume24hUsd), sub: null },
                  { label: 'BTC Dominance',     value: `${fmt(data.global.btcDominance, 1)}%`, sub: null },
                  { label: 'ETH Dominance',     value: `${fmt(data.global.ethDominance, 1)}%`, sub: null },
                ].map((m) => (
                  <div key={m.label} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                    <div className="text-xs text-zinc-500 mb-1">{m.label}</div>
                    <div className="text-xl font-bold text-white">{m.value}</div>
                    {m.sub && <div className="mt-1">{m.sub}</div>}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 text-sm text-zinc-500 text-center">
              CMC global cache cold — visit <a href="/admin/cache" className="text-blue-400 underline">Cache Operations</a> to refresh.
            </div>
          )}

          {/* Market Breadth */}
          {data.listings && (
            <div>
              <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-3">Market Breadth (Top 200 via CMC)</h2>
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                <div className="flex items-center gap-6 mb-3">
                  <div>
                    <div className="text-xs text-zinc-500">Advancing</div>
                    <div className="text-2xl font-bold text-green-400">{data.listings.breadthUp}%</div>
                  </div>
                  <div>
                    <div className="text-xs text-zinc-500">Declining</div>
                    <div className="text-2xl font-bold text-red-400">{data.listings.breadthDown}%</div>
                  </div>
                </div>
                <div className="w-full h-2 rounded-full bg-zinc-800 overflow-hidden">
                  <div className="h-full bg-green-500 rounded-full" style={{ width: `${data.listings.breadthUp}%` }} />
                </div>
                {data.listings.topMovers.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {data.listings.topMovers.slice(0, 8).map((m) => (
                      <span key={m.symbol} className={`text-xs px-2 py-1 rounded ${m.change >= 0 ? 'bg-green-900/30 text-green-400 border border-green-800' : 'bg-red-900/30 text-red-400 border border-red-800'}`}>
                        {m.symbol} <ChangeChip val={m.change} />
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Trending */}
          {data.trending && data.trending.trending.length > 0 && (
            <div>
              <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-3">Trending Assets</h2>
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl divide-y divide-zinc-800">
                {data.trending.trending.slice(0, 10).map((coin) => (
                  <div key={coin.id} className="flex items-center gap-4 px-4 py-3">
                    <div className="w-6 text-center text-xs text-zinc-600">#{coin.rank}</div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-white text-sm">{coin.symbol}</div>
                      <div className="text-xs text-zinc-500 truncate">{coin.name}</div>
                    </div>
                    <div className="text-right space-x-3">
                      <ChangeChip val={coin.priceChange1h} />
                      <ChangeChip val={coin.priceChange24h} />
                    </div>
                  </div>
                ))}
              </div>
              <div className="text-xs text-zinc-600 mt-1 text-right">
                Updated {fmtTs(data.trending.refreshedAt)}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
