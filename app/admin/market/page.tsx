'use client'

import { useState, useCallback } from 'react'
import {
  TrendingUp, TrendingDown, Activity,
  ArrowUpRight, ArrowDownRight, RefreshCw, AlertTriangle,
} from 'lucide-react'
import { useAutoRefresh } from '@/lib/use-auto-refresh'

// ─── Types ────────────────────────────────────────────────────────────────────

type MarketRegime =
  | 'BULL_TREND' | 'BEAR_TREND' | 'SIDEWAYS'
  | 'HIGH_VOLATILITY' | 'EUPHORIA' | 'CAPITULATION'

interface RegimeData {
  regime: MarketRegime; btcRsi4h: number; btcTrend4h: string
  btcAtrPct: number; btc24hChange: number; computedAt: string
}
interface GlobalData {
  btcDominance: number; ethDominance: number
  totalMarketCapUsd: number; totalVolume24hUsd: number
  marketCapChangePercent24h: number; refreshedAt: string
}
interface TrendingCoin {
  id: number; symbol: string; name: string; rank: number
  priceChange1h: number; priceChange24h: number; volume24h: number; marketCap: number
}
interface IntelligenceData {
  regime:   RegimeData
  global:   GlobalData | null
  trending: { trending: TrendingCoin[]; refreshedAt: string } | null
  listings: { breadthUp: number; breadthDown: number; topMovers: { symbol: string; change: number }[] } | null
  computedAt: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const REGIME_META: Record<MarketRegime, { label: string; color: string; border: string; bg: string; desc: string }> = {
  BULL_TREND:      { label: 'Bull Trend',     color: 'text-green-400',  border: 'border-green-500/25',  bg: 'bg-green-500/8',   desc: 'BTC 4h bullish · strong trend momentum' },
  BEAR_TREND:      { label: 'Bear Trend',      color: 'text-red-400',    border: 'border-red-500/25',    bg: 'bg-red-500/8',     desc: 'BTC 4h bearish · sustained selling pressure' },
  SIDEWAYS:        { label: 'Sideways',        color: 'text-zinc-400',   border: 'border-zinc-500/25',   bg: 'bg-zinc-500/8',    desc: 'No directional bias · price consolidating' },
  HIGH_VOLATILITY: { label: 'High Volatility', color: 'text-amber-400',  border: 'border-amber-500/25',  bg: 'bg-amber-500/8',   desc: 'ATR elevated · increased whipsaw risk' },
  EUPHORIA:        { label: 'Euphoria',        color: 'text-purple-400', border: 'border-purple-500/25', bg: 'bg-purple-500/8',  desc: 'Overbought · RSI > 78 · extreme greed' },
  CAPITULATION:    { label: 'Capitulation',    color: 'text-rose-400',   border: 'border-rose-500/25',   bg: 'bg-rose-900/15',   desc: 'Extreme fear · RSI < 22 · mass selling' },
}

function fmt(n: number, d = 2) {
  return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
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

function Change({ val, size = 'sm' }: { val: number; size?: 'sm' | 'xs' }) {
  const pos = val >= 0
  const cls = size === 'sm'
    ? `inline-flex items-center gap-0.5 text-xs font-medium px-1.5 py-0.5 rounded ${pos ? 'text-green-400 bg-green-500/10' : 'text-red-400 bg-red-500/10'}`
    : `text-[10px] font-mono font-semibold ${pos ? 'text-green-400' : 'text-red-400'}`
  return (
    <span className={cls}>
      {size === 'sm' && (pos ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />)}
      {pos && size === 'xs' ? '+' : ''}{Math.abs(val).toFixed(2)}%
    </span>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function MarketIntelligencePage() {
  const [data,  setData]  = useState<IntelligenceData | null>(null)
  const [error, setError] = useState<string | null>(null)

  const fetch_ = useCallback(async () => {
    try {
      const res  = await fetch('/api/market/intelligence')
      const json = await res.json()
      if (json.success) { setData(json); setError(null) }
      else setError(json.error)
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
  }, [])

  useAutoRefresh(fetch_, 30_000)

  const regime = data?.regime
  const meta   = regime ? REGIME_META[regime.regime] : null

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-5xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg sm:text-xl font-semibold text-white">Market Intelligence</h1>
          <p className="text-xs text-zinc-500 mt-0.5">
            {data ? `Updated ${fmtTs(data.computedAt)}` : 'Regime · global metrics · breadth · trending'}
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
          {/* ── HERO: Regime + BTC vitals ── */}
          {regime && meta && (
            <div className={`rounded-xl border ${meta.border} p-5`} style={{ backgroundColor: meta.bg.replace('bg-', '') }}>
              <div className="flex items-start gap-4">
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] text-zinc-500 uppercase tracking-widest mb-1">Market Regime</p>
                  <p className={`text-2xl sm:text-3xl font-bold ${meta.color}`}>{meta.label}</p>
                  <p className="text-xs text-zinc-400 mt-1">{meta.desc}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[9px] text-zinc-500 uppercase tracking-wider mb-0.5">BTC RSI 4h</p>
                  <p className={`text-2xl font-bold font-mono ${regime.btcRsi4h > 70 ? 'text-red-400' : regime.btcRsi4h < 30 ? 'text-green-400' : 'text-white'}`}>
                    {fmt(regime.btcRsi4h, 1)}
                  </p>
                </div>
              </div>
              {/* BTC quick stats */}
              <div className="mt-4 pt-3 border-t border-white/10 grid grid-cols-3 gap-3">
                <div>
                  <p className="text-[9px] text-zinc-500 uppercase tracking-wider mb-0.5">BTC 24h</p>
                  <Change val={regime.btc24hChange} />
                </div>
                <div>
                  <p className="text-[9px] text-zinc-500 uppercase tracking-wider mb-0.5">ATR%</p>
                  <p className={`text-sm font-mono font-semibold ${regime.btcAtrPct > 4 ? 'text-amber-400' : 'text-white'}`}>
                    {fmt(regime.btcAtrPct, 2)}%
                  </p>
                </div>
                <div>
                  <p className="text-[9px] text-zinc-500 uppercase tracking-wider mb-0.5">4h Trend</p>
                  <div className={`flex items-center gap-0.5 text-sm font-semibold ${
                    regime.btcTrend4h === 'BULLISH' ? 'text-green-400' :
                    regime.btcTrend4h === 'BEARISH' ? 'text-red-400' : 'text-zinc-400'
                  }`}>
                    {regime.btcTrend4h === 'BULLISH' && <TrendingUp className="w-3.5 h-3.5" />}
                    {regime.btcTrend4h === 'BEARISH' && <TrendingDown className="w-3.5 h-3.5" />}
                    {regime.btcTrend4h}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── Global metrics (supporting) ── */}
          {data.global ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: 'Total Market Cap', value: fmtB(data.global.totalMarketCapUsd), sub: <Change val={data.global.marketCapChangePercent24h} /> },
                { label: '24h Volume',       value: fmtB(data.global.totalVolume24hUsd), sub: null },
                { label: 'BTC Dominance',    value: `${fmt(data.global.btcDominance, 1)}%`, sub: null },
                { label: 'ETH Dominance',    value: `${fmt(data.global.ethDominance, 1)}%`, sub: null },
              ].map(m => (
                <div key={m.label} className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3">
                  <p className="text-[9px] text-zinc-500 uppercase tracking-wider mb-1">{m.label}</p>
                  <p className="text-lg font-bold text-white">{m.value}</p>
                  {m.sub && <div className="mt-0.5">{m.sub}</div>}
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 px-5 py-3 text-xs text-zinc-500 text-center">
              CMC global cache cold — visit <a href="/admin/cache" className="text-blue-400 underline">Cache</a> to refresh.
            </div>
          )}

          {/* ── Market Breadth ── */}
          {data.listings && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-5 py-4">
              <p className="text-[9px] text-zinc-500 uppercase tracking-widest mb-3">Market Breadth · Top 200 (CMC)</p>
              <div className="flex items-center gap-4 mb-2">
                <span className="text-xl font-bold font-mono text-green-400">{data.listings.breadthUp}%</span>
                <div className="flex-1 h-2 rounded-full bg-zinc-800 overflow-hidden">
                  <div className="h-full bg-green-500 rounded-full" style={{ width: `${data.listings.breadthUp}%` }} />
                </div>
                <span className="text-xl font-bold font-mono text-red-400">{data.listings.breadthDown}%</span>
              </div>
              <div className="flex gap-2 text-[10px] text-zinc-500">
                <span className="text-green-400/70">▲ Advancing</span>
                <span className="ml-auto text-red-400/70">Declining ▼</span>
              </div>
            </div>
          )}

          {/* ── Trending Assets ── */}
          {data.trending && data.trending.trending.length > 0 && (
            <div>
              <p className="text-[9px] text-zinc-500 uppercase tracking-widest mb-2.5">Trending Assets</p>
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl divide-y divide-zinc-800/60">
                {data.trending.trending.slice(0, 6).map(coin => (
                  <div key={coin.id} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="text-[9px] text-zinc-600 w-5 shrink-0">#{coin.rank}</span>
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-semibold font-mono text-white">{coin.symbol}</span>
                      <span className="text-[10px] text-zinc-500 ml-2 hidden sm:inline">{coin.name}</span>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <div className="text-right hidden sm:block">
                        <p className="text-[9px] text-zinc-600">1h</p>
                        <Change val={coin.priceChange1h} size="xs" />
                      </div>
                      <div className="text-right">
                        <p className="text-[9px] text-zinc-600">24h</p>
                        <Change val={coin.priceChange24h} size="xs" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-[9px] text-zinc-600 mt-1 text-right">Updated {fmtTs(data.trending.refreshedAt)}</p>
            </div>
          )}
        </>
      )}
    </div>
  )
}
