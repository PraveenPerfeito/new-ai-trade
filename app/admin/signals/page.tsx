'use client'

import { useCallback } from 'react'
import { adminApi, EdgeReport } from '@/lib/admin-api'
import { useAutoRefresh } from '@/lib/use-auto-refresh'
import { formatTs } from '@/lib/utils'

type Signal = {
  id: string
  symbol: string
  signal_type: string
  confidence: number
  entry_price: number
  target_price: number
  stop_loss: number
  risk_grade: string
  scanner_mode: string
  outcome?: string
  created_at: string
  ai_validated?: boolean
}

function GradeBadge({ grade }: { grade: string }) {
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

function OutcomePill({ outcome }: { outcome?: string }) {
  if (!outcome || outcome === 'PENDING') return <span className="text-terminal-muted/40 text-xs">PENDING</span>
  const cfg: Record<string, string> = {
    TP_HIT:  'text-bull-default',
    SL_HIT:  'text-bear-default',
    TIMEOUT: 'text-signal-high',
  }
  return <span className={`text-xs font-mono font-bold ${cfg[outcome] ?? 'text-terminal-muted'}`}>{outcome}</span>
}

export default function SignalsPage() {
  const edgeFetcher = useCallback(() => adminApi.analytics.edgeReport(168), [])
  const { data: edge, loading: el } = useAutoRefresh<EdgeReport>(edgeFetcher, 60_000)

  // Fetch from the existing Next.js /api/signals endpoint (reads from Supabase directly)
  const signalsFetcher = useCallback(async () => {
    const res = await fetch('/api/signals?limit=50', { cache: 'no-store' })
    if (!res.ok) throw new Error('signals fetch failed')
    return res.json()
  }, [])
  const { data: signalsData, loading: sl } = useAutoRefresh<{ signals: Signal[] }>(signalsFetcher, 30_000)

  const signals = signalsData?.signals ?? []

  const rrRatio = (entry: number, target: number, stop: number) => {
    const reward = Math.abs(target - entry)
    const risk   = Math.abs(entry - stop)
    return risk > 0 ? (reward / risk).toFixed(1) : '—'
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-terminal-text text-xl font-semibold">Signal Intelligence</h1>
        <p className="text-terminal-muted text-sm mt-1">Live feed · Outcomes · Edge analysis</p>
      </div>

      {/* Edge summary from validation */}
      {!el && edge && edge.edge_verdict?.confidence_level === 'insufficient_data' && (
        <div className="rounded-lg px-4 py-3 bg-signal-medium/5 border border-signal-medium/20 text-xs text-terminal-muted">
          <span className="text-signal-medium font-semibold">◌ Edge warming up · </span>
          {edge.overall.total} signal{edge.overall.total !== 1 ? 's' : ''} tracked — 30+ resolved outcomes needed for win rate and expectancy. Results appear automatically as signals hit TP / SL.
        </div>
      )}
      {edge && edge.edge_verdict?.confidence_level !== 'insufficient_data' && (
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

      {/* Signal feed */}
      <div>
        <p className="text-terminal-muted text-xs uppercase tracking-wider mb-3">Recent Signals</p>
        <div className="glass-card rounded-lg overflow-hidden">
          {sl ? (
            Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="px-4 py-3 border-b border-terminal-border/40 flex items-center gap-3">
                <div className="skeleton h-3 w-20 rounded" />
                <div className="skeleton h-3 w-12 rounded" />
                <div className="skeleton h-3 w-16 rounded" />
                <div className="skeleton h-3 w-24 rounded ml-auto" />
              </div>
            ))
          ) : !signals.length ? (
            <div className="px-5 py-10 text-center space-y-2">
              <p className="text-terminal-text text-sm font-medium">No signals generated yet</p>
              <p className="text-terminal-muted text-xs leading-relaxed max-w-sm mx-auto">
                Run a scan from the Scanner page to generate signals. High-confidence and futures modes tend to produce the most actionable setups.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs min-w-[700px]">
                <thead>
                  <tr className="border-b border-terminal-border">
                    {['Symbol', 'Type', 'Conf', 'Entry', 'RR', 'Grade', 'Mode', 'AI', 'Outcome', 'Created'].map(h => (
                      <th key={h} className="text-terminal-muted text-xs uppercase tracking-wider text-left py-2 px-3 font-semibold">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {signals.map(sig => (
                    <tr key={sig.id} className="border-b border-terminal-border/30 hover:bg-terminal-bright/10">
                      <td className="py-2.5 px-3 font-mono text-terminal-text font-bold">{sig.symbol}</td>
                      <td className="py-2.5 px-3">
                        <span className={`font-mono text-xs font-bold ${sig.signal_type === 'BUY' ? 'text-bull-default' : 'text-bear-default'}`}>
                          {sig.signal_type}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 font-mono">
                        <span className={sig.confidence >= 85 ? 'text-signal-high' : sig.confidence >= 75 ? 'text-signal-medium' : 'text-terminal-muted'}>
                          {sig.confidence}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 font-mono text-terminal-text">{sig.entry_price?.toFixed(4)}</td>
                      <td className="py-2.5 px-3 font-mono text-terminal-muted">{rrRatio(sig.entry_price, sig.target_price, sig.stop_loss)}R</td>
                      <td className="py-2.5 px-3"><GradeBadge grade={sig.risk_grade} /></td>
                      <td className="py-2.5 px-3 text-terminal-muted font-mono text-xs uppercase">{sig.scanner_mode}</td>
                      <td className="py-2.5 px-3">
                        {sig.ai_validated == null
                          ? <span className="text-terminal-muted/40 text-xs">—</span>
                          : sig.ai_validated
                            ? <span className="text-bull-default text-xs font-mono">✓</span>
                            : <span className="text-bear-default text-xs font-mono">✗</span>
                        }
                      </td>
                      <td className="py-2.5 px-3"><OutcomePill outcome={sig.outcome} /></td>
                      <td className="py-2.5 px-3 text-terminal-muted/50 font-mono text-xs">
                        {formatTs(sig.created_at)}
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
