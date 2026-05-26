'use client'

import { useState, useCallback } from 'react'
import {
  Target, RefreshCw, AlertTriangle,
  ArrowUpRight, ArrowDownRight, Minus,
  TrendingUp, TrendingDown, Activity,
} from 'lucide-react'
import { useAutoRefresh } from '@/lib/use-auto-refresh'
import type { MarketRegime } from '@/types'

// ─── Types ────────────────────────────────────────────────────────────────────

interface RegimeData {
  regime:       MarketRegime
  btcRsi4h:     number
  btcTrend4h:   string
  btcAtrPct:    number
  btc24hChange: number
  computedAt:   string
}

interface IntelligenceResponse {
  success:    boolean
  error?:     string
  regime:     RegimeData
  computedAt: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

const REGIME_META: Record<MarketRegime, {
  label: string; color: string; bg: string
  border: string; desc: string; implication: string
}> = {
  BULL_TREND: {
    label: 'Bull Trend', color: 'text-green-400',
    bg: 'bg-green-500/10', border: 'border-green-500/20',
    desc: 'BTC 4h EMA bullish with sustained momentum',
    implication: 'Increase signal confidence thresholds — setups resolve faster in trending conditions',
  },
  BEAR_TREND: {
    label: 'Bear Trend', color: 'text-red-400',
    bg: 'bg-red-500/10', border: 'border-red-500/20',
    desc: 'BTC 4h EMA bearish with sustained selling pressure',
    implication: 'Tighten stop-losses — strong downtrend increases invalidation risk',
  },
  SIDEWAYS: {
    label: 'Sideways', color: 'text-zinc-400',
    bg: 'bg-zinc-500/10', border: 'border-zinc-600/20',
    desc: 'No clear directional bias — price consolidating',
    implication: 'Range-bound setups preferred — avoid breakout plays without volume confirmation',
  },
  HIGH_VOLATILITY: {
    label: 'High Volatility', color: 'text-amber-400',
    bg: 'bg-amber-500/10', border: 'border-amber-500/20',
    desc: 'ATR above normal — increased whipsaw risk',
    implication: 'Widen stops or reduce position size — ATR spike increases noise in all setups',
  },
  EUPHORIA: {
    label: 'Euphoria', color: 'text-purple-400',
    bg: 'bg-purple-500/10', border: 'border-purple-500/20',
    desc: 'Overbought — RSI > 78, extreme greed territory',
    implication: 'Avoid new long entries — mean-reversion risk high; favor shorts or cash',
  },
  CAPITULATION: {
    label: 'Capitulation', color: 'text-rose-400',
    bg: 'bg-rose-900/20', border: 'border-rose-500/20',
    desc: 'Extreme fear — RSI < 22, mass selling',
    implication: 'High-conviction long setups may be viable — capitulation often precedes reversals',
  },
}

const RSI_THRESHOLDS = [
  { label: 'Overbought',  min: 70,  max: 100, color: 'bg-red-500' },
  { label: 'Neutral-High',min: 55,  max: 70,  color: 'bg-amber-500' },
  { label: 'Neutral',     min: 45,  max: 55,  color: 'bg-zinc-500' },
  { label: 'Neutral-Low', min: 30,  max: 45,  color: 'bg-blue-500' },
  { label: 'Oversold',    min: 0,   max: 30,  color: 'bg-green-500' },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number, d = 2) {
  return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
}

function RsiGauge({ rsi }: { rsi: number }) {
  const pct    = Math.min(100, Math.max(0, rsi))
  const zone   = RSI_THRESHOLDS.find((z) => rsi >= z.min && rsi <= z.max)
  const color  = rsi > 70 ? 'text-red-400' : rsi < 30 ? 'text-green-400' : 'text-white'

  return (
    <div className="space-y-2">
      <div className="flex items-end justify-between">
        <span className="text-xs text-zinc-500">RSI 4h</span>
        <span className={`text-2xl font-bold font-mono ${color}`}>{fmt(rsi, 1)}</span>
      </div>
      <div className="relative h-3 rounded-full overflow-hidden bg-gradient-to-r from-green-500 via-zinc-500 to-red-500">
        <div
          className="absolute top-0 h-full w-0.5 bg-white shadow-lg"
          style={{ left: `${pct}%`, transform: 'translateX(-50%)' }}
        />
      </div>
      <div className="flex justify-between text-[10px] text-zinc-600">
        <span>0 Oversold</span>
        <span>50</span>
        <span>Overbought 100</span>
      </div>
      {zone && (
        <div className="text-xs text-zinc-500 text-center">{zone.label}</div>
      )}
    </div>
  )
}

function StatPill({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
      <div className="text-xs text-zinc-500 mb-1">{label}</div>
      <div className="text-lg font-bold text-white">{value}</div>
      {sub && <div className="text-xs text-zinc-600 mt-0.5">{sub}</div>}
    </div>
  )
}

// ─── Regime implication rows ──────────────────────────────────────────────────

const SCANNER_PARAMS: Record<MarketRegime, { label: string; value: string }[]> = {
  BULL_TREND:      [{ label: 'Min Confidence', value: '75%' }, { label: 'Preferred Modes', value: 'futures, high_confidence' }, { label: 'R:R Minimum', value: '1.5:1' }],
  BEAR_TREND:      [{ label: 'Min Confidence', value: '80%' }, { label: 'Preferred Modes', value: 'spot (short bias)' },         { label: 'R:R Minimum', value: '2.0:1' }],
  SIDEWAYS:        [{ label: 'Min Confidence', value: '75%' }, { label: 'Preferred Modes', value: 'spot, trending' },            { label: 'R:R Minimum', value: '1.5:1' }],
  HIGH_VOLATILITY: [{ label: 'Min Confidence', value: '85%' }, { label: 'Preferred Modes', value: 'high_confidence only' },      { label: 'R:R Minimum', value: '2.5:1' }],
  EUPHORIA:        [{ label: 'Min Confidence', value: '90%' }, { label: 'Preferred Modes', value: 'high_confidence shorts' },    { label: 'R:R Minimum', value: '2.0:1' }],
  CAPITULATION:    [{ label: 'Min Confidence', value: '80%' }, { label: 'Preferred Modes', value: 'spot longs' },               { label: 'R:R Minimum', value: '2.0:1' }],
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function RegimePage() {
  const [data, setData]   = useState<IntelligenceResponse | null>(null)
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
  const params = regime ? SCANNER_PARAMS[regime.regime] : null

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Target className="w-6 h-6 text-blue-400" />
          <div>
            <h1 className="text-xl font-semibold text-white">Regime Intelligence</h1>
            <p className="text-sm text-zinc-400">BTC-derived market classification · scanner parameter guidance</p>
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

      {data && regime && meta && (
        <>
          {/* Regime Hero */}
          <div className={`rounded-xl border p-6 ${meta.bg} ${meta.border}`}>
            <div className="flex items-start justify-between gap-6">
              <div className="flex-1">
                <div className="text-xs text-zinc-500 uppercase tracking-widest mb-2">Current Regime</div>
                <div className={`text-4xl font-bold ${meta.color}`}>{meta.label}</div>
                <div className="text-sm text-zinc-400 mt-2 max-w-md">{meta.desc}</div>
              </div>
              <div className="w-52 shrink-0">
                <RsiGauge rsi={regime.btcRsi4h} />
              </div>
            </div>

            {/* BTC quick stats */}
            <div className="mt-5 grid grid-cols-3 gap-4 pt-4 border-t border-white/10">
              <div>
                <div className="text-xs text-zinc-500">BTC 24h</div>
                <div className={`text-lg font-bold font-mono ${regime.btc24hChange >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {regime.btc24hChange >= 0 ? '+' : ''}{fmt(regime.btc24hChange, 2)}%
                </div>
              </div>
              <div>
                <div className="text-xs text-zinc-500">ATR%</div>
                <div className={`text-lg font-bold font-mono ${regime.btcAtrPct > 4 ? 'text-amber-400' : 'text-white'}`}>
                  {fmt(regime.btcAtrPct, 2)}%
                </div>
              </div>
              <div>
                <div className="text-xs text-zinc-500">4h Trend</div>
                <div className={`text-lg font-bold flex items-center gap-1 ${
                  regime.btcTrend4h === 'BULLISH' ? 'text-green-400' :
                  regime.btcTrend4h === 'BEARISH' ? 'text-red-400' : 'text-zinc-400'
                }`}>
                  {regime.btcTrend4h === 'BULLISH' && <TrendingUp className="w-5 h-5" />}
                  {regime.btcTrend4h === 'BEARISH' && <TrendingDown className="w-5 h-5" />}
                  {regime.btcTrend4h === 'RANGING' && <Minus className="w-5 h-5" />}
                  {regime.btcTrend4h}
                </div>
              </div>
            </div>
          </div>

          {/* Implication + recommended params */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
              <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-3 flex items-center gap-2">
                <Activity className="w-3.5 h-3.5" /> Trading Implication
              </h2>
              <p className={`text-sm leading-relaxed ${meta.color}`}>{meta.implication}</p>
            </div>

            {params && (
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
                <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-3 flex items-center gap-2">
                  <Target className="w-3.5 h-3.5" /> Recommended Scanner Params
                </h2>
                <div className="space-y-2">
                  {params.map(({ label, value }) => (
                    <div key={label} className="flex items-center justify-between py-1.5 border-b border-zinc-800 last:border-0">
                      <span className="text-xs text-zinc-500">{label}</span>
                      <span className="text-sm font-medium text-white font-mono">{value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* All regimes reference */}
          <div>
            <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-3">Regime Classification Reference</h2>
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-800 text-xs text-zinc-500 uppercase tracking-wider">
                    <th className="text-left px-4 py-3">Regime</th>
                    <th className="text-left px-4 py-3">Trigger</th>
                    <th className="text-left px-4 py-3 hidden md:table-cell">Implication</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800">
                  {Object.entries(REGIME_META).map(([key, m]) => (
                    <tr
                      key={key}
                      className={`transition-colors ${key === regime.regime ? 'bg-zinc-800/60' : 'hover:bg-zinc-800/30'}`}
                    >
                      <td className="px-4 py-2.5">
                        <span className={`font-semibold text-sm ${m.color}`}>{m.label}</span>
                        {key === regime.regime && (
                          <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-white">CURRENT</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-zinc-400 text-xs">{m.desc}</td>
                      <td className="px-4 py-2.5 text-zinc-500 text-xs hidden md:table-cell">{m.implication}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
