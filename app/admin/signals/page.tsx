'use client'

import { useCallback } from 'react'
import { TradingSignal } from '@/types'
import { adminApi, EdgeReport } from '@/lib/admin-api'
import { useAutoRefresh } from '@/lib/use-auto-refresh'
import { formatTs } from '@/lib/utils'
import { computeLifecycleStage, LIFECYCLE_CONFIG } from '@/lib/signal-lifecycle'

// ─── Sub-components ───────────────────────────────────────────────────────────

function GradeBadge({ grade }: { grade?: string }) {
  if (!grade) return <span className="text-terminal-muted/40 text-xs">—</span>
  const colors: Record<string, string> = {
    A: 'text-bull-default border-bull-default/30 bg-bull-default/5',
    B: 'text-signal-medium border-signal-medium/30 bg-signal-medium/5',
    C: 'text-signal-high border-signal-high/30 bg-signal-high/5',
    D: 'text-orange-400 border-orange-400/30 bg-orange-400/5',
    F: 'text-bear-default border-bear-default/30 bg-bear-default/5',
  }
  return (
    <span className={`text-xs font-bold px-1.5 py-0.5 rounded border ${colors[grade] ?? 'text-terminal-muted border-terminal-border'}`}>
      {grade}
    </span>
  )
}

function LifecycleBadge({ signal }: { signal: TradingSignal }) {
  const stage = computeLifecycleStage(signal)
  const cfg = LIFECYCLE_CONFIG[stage]
  return (
    <span className={`text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded border ${cfg.badge}`}>
      {cfg.label}
    </span>
  )
}

function TacticalBadges({ signal }: { signal: TradingSignal }) {
  const badges: React.ReactNode[] = []

  if (signal.futuresData?.fundingRate != null && Math.abs(signal.futuresData.fundingRate) > 0.0005) {
    const fr = signal.futuresData.fundingRate
    badges.push(
      <span key="fr" className={`text-[9px] font-mono px-1 py-0.5 rounded border ${fr > 0 ? 'text-bear-default border-bear-default/20 bg-bear-default/5' : 'text-bull-default border-bull-default/20 bg-bull-default/5'}`}>
        FR {fr > 0 ? '+' : ''}{(fr * 100).toFixed(3)}%
      </span>
    )
  }

  if (signal.continuation?.continuationProbability != null && signal.continuation.continuationProbability >= 0.6) {
    badges.push(
      <span key="cont" className="text-[9px] font-mono px-1 py-0.5 rounded border text-purple-400 border-purple-500/20 bg-purple-500/5">
        CONT {Math.round(signal.continuation.continuationProbability * 100)}%
      </span>
    )
  }

  if (signal.mcapTier) {
    const tierColor: Record<string, string> = {
      large:  'text-bull-default border-bull-default/15',
      mid:    'text-signal-medium border-signal-medium/15',
      small:  'text-signal-high border-signal-high/15',
      micro:  'text-terminal-muted border-terminal-border',
    }
    badges.push(
      <span key="tier" className={`text-[9px] font-mono px-1 py-0.5 rounded border ${tierColor[signal.mcapTier] ?? 'text-terminal-muted border-terminal-border'}`}>
        {signal.mcapTier.toUpperCase()}
      </span>
    )
  }

  return badges.length > 0 ? <div className="flex gap-1 flex-wrap">{badges}</div> : null
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SignalsPage() {
  const edgeFetcher = useCallback(() => adminApi.analytics.edgeReport(168), [])
  const { data: edge, loading: el } = useAutoRefresh<EdgeReport>(edgeFetcher, 60_000)

  const signalsFetcher = useCallback(async () => {
    const res = await fetch('/api/signals?limit=100&minConfidence=0', { cache: 'no-store' })
    if (!res.ok) throw new Error('signals fetch failed')
    return res.json() as Promise<{ signals: TradingSignal[] }>
  }, [])
  const { data: signalsData, loading: sl } = useAutoRefresh<{ signals: TradingSignal[] }>(signalsFetcher, 30_000)

  const signals = signalsData?.signals ?? []

  const rrRatio = (entry: number, target: number, stop: number) => {
    const reward = Math.abs(target - entry)
    const risk   = Math.abs(entry - stop)
    return risk > 0 ? (reward / risk).toFixed(1) + 'R' : '—'
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-terminal-text text-xl font-semibold">Signal Intelligence</h1>
        <p className="text-terminal-muted text-sm mt-1">Live feed · Lifecycle stages · Tactical fields</p>
      </div>

      {/* Edge summary */}
      {!el && edge && (!edge.overall || edge.edge_verdict?.confidence_level === 'insufficient_data') && (
        <div className="rounded-lg px-4 py-3 bg-signal-medium/5 border border-signal-medium/20 text-xs text-terminal-muted">
          <span className="text-signal-medium font-semibold">◌ Edge warming up · </span>
          {edge.overall?.total ?? 0} signal{(edge.overall?.total ?? 0) !== 1 ? 's' : ''} tracked — 30+ resolved outcomes needed for win rate and expectancy.
        </div>
      )}

      {!el && edge && edge.overall && edge.edge_verdict?.confidence_level !== 'insufficient_data' && (
        <div className="glass-card rounded-lg px-5 py-4 flex items-center gap-6 flex-wrap text-xs font-mono">
          <div>
            <span className="text-terminal-muted">WIN RATE</span>{' '}
            <span className={edge.overall.win_rate != null && edge.overall.win_rate >= 0.55 ? 'text-bull-default font-bold' : 'text-bear-default font-bold'}>
              {edge.overall.win_rate != null ? `${(edge.overall.win_rate * 100).toFixed(1)}%` : '—'}
            </span>
          </div>
          <div>
            <span className="text-terminal-muted">EXPECTANCY</span>{' '}
            <span className={edge.overall.expectancy != null && edge.overall.expectancy > 0 ? 'text-bull-default font-bold' : 'text-bear-default font-bold'}>
              {edge.overall.expectancy != null ? `${edge.overall.expectancy > 0 ? '+' : ''}${edge.overall.expectancy.toFixed(2)}R` : '—'}
            </span>
          </div>
          <div>
            <span className="text-terminal-muted">SIGNALS (7d)</span>{' '}
            <span className="text-terminal-text font-bold">{edge.overall.total}</span>
          </div>
          <div>
            <span className="text-terminal-muted">EDGE</span>{' '}
            <span className={edge.edge_verdict.has_edge ? 'text-bull-default font-bold' : 'text-bear-default font-bold'}>
              {edge.edge_verdict.confidence_level.toUpperCase().replace(/_/g, ' ')}
            </span>
          </div>
        </div>
      )}

      {/* Signal table */}
      <div>
        <p className="text-terminal-muted text-xs uppercase tracking-wider mb-3">Recent Signals</p>
        <div className="glass-card rounded-lg overflow-hidden">
          {sl ? (
            Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="px-4 py-3 border-b border-terminal-border/40 flex items-center gap-3">
                <div className="skeleton h-3 w-16 rounded" />
                <div className="skeleton h-3 w-8 rounded" />
                <div className="skeleton h-3 w-12 rounded" />
                <div className="skeleton h-3 w-20 rounded ml-auto" />
              </div>
            ))
          ) : !signals.length ? (
            <div className="px-5 py-10 text-center space-y-2">
              <p className="text-terminal-text text-sm font-medium">No signals generated yet</p>
              <p className="text-terminal-muted text-xs leading-relaxed max-w-sm mx-auto">
                Run a scan from the Scanner page. High-confidence and futures modes produce the most actionable setups.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs min-w-[860px]">
                <thead>
                  <tr className="border-b border-terminal-border">
                    {['Symbol', 'Type', 'TF', 'Conf', 'Entry', 'RR', 'Grade', 'Mode', 'Lifecycle', 'Tactical', 'Created'].map(h => (
                      <th key={h} className="text-terminal-muted text-[10px] uppercase tracking-wider text-left py-2 px-3 font-semibold whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {signals.map(sig => (
                    <tr key={sig.id} className="border-b border-terminal-border/30 hover:bg-terminal-bright/10">
                      <td className="py-2.5 px-3 font-mono text-terminal-text font-bold whitespace-nowrap">{sig.symbol}</td>
                      <td className="py-2.5 px-3">
                        <span className={`font-mono text-xs font-bold ${sig.type === 'BUY' ? 'text-bull-default' : 'text-bear-default'}`}>
                          {sig.type}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 font-mono text-terminal-muted/70">{sig.timeframe}</td>
                      <td className="py-2.5 px-3 font-mono">
                        <span className={sig.confidence >= 85 ? 'text-signal-high' : sig.confidence >= 75 ? 'text-signal-medium' : 'text-terminal-muted'}>
                          {sig.confidence}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 font-mono text-terminal-text">{sig.entryPrice.toFixed(4)}</td>
                      <td className="py-2.5 px-3 font-mono text-terminal-muted">{rrRatio(sig.entryPrice, sig.targetPrice, sig.stopLoss)}</td>
                      <td className="py-2.5 px-3"><GradeBadge grade={sig.riskGrade} /></td>
                      <td className="py-2.5 px-3 text-terminal-muted font-mono text-[10px] uppercase whitespace-nowrap">{sig.scannerMode}</td>
                      <td className="py-2.5 px-3"><LifecycleBadge signal={sig} /></td>
                      <td className="py-2.5 px-3"><TacticalBadges signal={sig} /></td>
                      <td className="py-2.5 px-3 text-terminal-muted/50 font-mono text-[10px] whitespace-nowrap">
                        {formatTs(sig.createdAt instanceof Date ? sig.createdAt.toISOString() : sig.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
