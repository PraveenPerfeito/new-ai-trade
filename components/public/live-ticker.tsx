'use client'

import { useEffect, useState } from 'react'
import { TrendingUp, TrendingDown } from 'lucide-react'

interface Coin {
  symbol:     string
  name:       string
  price:      number
  change_24h: number
}

function fmt(price: number): string {
  if (price >= 10000) return `$${price.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
  if (price >= 1000)  return `$${price.toLocaleString('en-US', { maximumFractionDigits: 1 })}`
  if (price >= 1)     return `$${price.toFixed(2)}`
  if (price >= 0.01)  return `$${price.toFixed(4)}`
  return `$${price.toFixed(6)}`
}

const SHOWCASE = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'AVAX', 'DOT', 'LINK', 'MATIC', 'DOGE', 'ATOM', 'UNI', 'NEAR', 'ARB']

export function LiveMarketStrip() {
  const [coins, setCoins]       = useState<Coin[]>([])
  const [loading, setLoading]   = useState(true)
  const [regime, setRegime]     = useState<'BULLISH' | 'BEARISH' | 'MIXED'>('MIXED')

  const load = async () => {
    try {
      const res = await fetch('/api/coins/top100', { cache: 'no-store' })
      if (!res.ok) return
      const data = await res.json()
      const raw: Coin[] = (data.coins ?? data) as Coin[]
      const ordered = SHOWCASE
        .map(sym => raw.find(c => c.symbol?.toUpperCase() === sym || c.symbol?.toUpperCase() === sym + 'USDT'))
        .filter(Boolean) as Coin[]
      setCoins(ordered.length >= 6 ? ordered : raw.slice(0, 15))

      const gainers = raw.filter(c => (c.change_24h ?? 0) > 0).length
      const total   = raw.length
      setRegime(gainers / total > 0.65 ? 'BULLISH' : gainers / total < 0.35 ? 'BEARISH' : 'MIXED')
    } catch {
      // silently fail — no data shown
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    const id = setInterval(load, 60_000)
    return () => clearInterval(id)
  }, [])

  const regimeColor = regime === 'BULLISH' ? 'text-emerald-400' : regime === 'BEARISH' ? 'text-red-400' : 'text-yellow-400'
  const regimeBg    = regime === 'BULLISH' ? 'bg-emerald-500/10 border-emerald-500/20' : regime === 'BEARISH' ? 'bg-red-500/10 border-red-500/20' : 'bg-yellow-500/10 border-yellow-500/20'

  if (loading) {
    return (
      <div className="border-y border-white/[0.06] bg-white/[0.015] py-3 px-6 flex items-center gap-6 overflow-hidden">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-2 shrink-0 animate-pulse">
            <div className="h-3 w-12 bg-white/[0.06] rounded" />
            <div className="h-3 w-16 bg-white/[0.04] rounded" />
          </div>
        ))}
      </div>
    )
  }

  if (!coins.length) return null

  const doubled = [...coins, ...coins]

  return (
    <div className="border-y border-white/[0.06] bg-white/[0.015] py-3 overflow-hidden relative group">
      <div className="flex items-center gap-3 px-4">
        {/* Regime badge */}
        <div className={`shrink-0 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border ${regimeBg} ${regimeColor}`}>
          {regime === 'BULLISH'
            ? <TrendingUp size={10} />
            : regime === 'BEARISH'
            ? <TrendingDown size={10} />
            : <span className="w-1.5 h-1.5 rounded-full bg-current inline-block" />
          }
          {regime}
        </div>

        {/* Divider */}
        <div className="h-4 w-px bg-white/[0.08] shrink-0" />

        {/* Scrolling ticker */}
        <div className="overflow-hidden flex-1">
          <div
            className="flex items-center gap-8 animate-ticker group-hover:[animation-play-state:paused]"
            style={{ width: 'max-content' }}
          >
            {doubled.map((coin, i) => {
              const up = (coin.change_24h ?? 0) >= 0
              return (
                <div key={i} className="flex items-center gap-2 shrink-0">
                  <span className="text-gray-300 text-xs font-mono font-semibold">
                    {coin.symbol?.replace('USDT', '') ?? coin.name?.slice(0, 4)}
                  </span>
                  <span className="text-gray-100 text-xs font-mono">{fmt(coin.price)}</span>
                  <span className={`text-[11px] font-mono ${up ? 'text-emerald-400' : 'text-red-400'}`}>
                    {up ? '+' : ''}{(coin.change_24h ?? 0).toFixed(2)}%
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
