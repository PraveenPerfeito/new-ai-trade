'use client'

import { useCallback } from 'react'
import { adminApi, EdgeReport } from '@/lib/admin-api'
import { useAutoRefresh } from '@/lib/use-auto-refresh'

function StatPair({ label, value, accent = '' }: { label: string; value: string; accent?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-terminal-muted text-[9px] uppercase tracking-wider">{label}</span>
      <span className={`font-mono font-bold text-lg ${accent || 'text-terminal-text'}`}>{value}</span>
    </div>
  )
}

function CalibrationTable({ bands }: { bands: EdgeReport['confidence_calibration']['bands'] }) {
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="border-b border-terminal-border">
          {['Band', 'Signals', 'Win Rate', 'Expectancy', 'Status'].map(h => (
            <th key={h} className="text-terminal-muted text-[9px] uppercase tracking-wider text-left py-2 px-3 font-semibold">{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {bands.map(b => (
          <tr key={b.label} className="border-b border-terminal-border/30 hover:bg-terminal-bright/10">
            <td className="py-2.5 px-3 font-mono text-terminal-text">{b.label}</td>
            <td className="py-2.5 px-3 font-mono text-terminal-muted">{b.total}</td>
            <td className="py-2.5 px-3 font-mono">
              {b.insufficient_data || b.win_rate == null
                ? <span className="text-terminal-muted/40">—</span>
                : <span className={b.win_rate >= 0.55 ? 'text-bull-default' : 'text-bear-default'}>
                    {(b.win_rate * 100).toFixed(1)}%
                  </span>
              }
            </td>
            <td className="py-2.5 px-3 font-mono">
              {b.insufficient_data || b.expectancy == null
                ? <span className="text-terminal-muted/40">—</span>
                : <span className={b.expectancy > 0 ? 'text-bull-default' : 'text-bear-default'}>
                    {b.expectancy > 0 ? '+' : ''}{b.expectancy.toFixed(2)}R
                  </span>
              }
            </td>
            <td className="py-2.5 px-3">
              {b.insufficient_data
                ? <span className="text-[9px] text-terminal-muted/40 border border-terminal-border rounded px-1.5 py-0.5">INSUFFICIENT</span>
                : <span className="text-[9px] text-bull-default/70 border border-bull-default/20 rounded px-1.5 py-0.5">OK</span>
              }
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export default function AnalyticsPage() {
  const edgeFetcher = useCallback(() => adminApi.analytics.edgeReport(), [])
  const { data: edge, loading } = useAutoRefresh<EdgeReport>(edgeFetcher, 120_000)

  const overall = edge?.overall
  const verdict = edge?.edge_verdict
  const cal     = edge?.confidence_calibration

  const confidenceLevelColor: Record<string, string> = {
    strong:            'text-bull-default',
    moderate:          'text-signal-high',
    weak:              'text-signal-medium',
    none:              'text-bear-default',
    insufficient_data: 'text-terminal-muted',
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-terminal-text text-lg font-semibold">Quantitative Analytics</h1>
        <p className="text-terminal-muted text-xs mt-0.5">30-day edge validation · Confidence calibration · Mode rankings</p>
      </div>

      {/* Edge verdict */}
      <div className="glass-card rounded-lg p-5">
        <p className="text-terminal-muted text-[9px] uppercase tracking-widest mb-4">Edge Verdict</p>
        {loading ? (
          <div className="space-y-2">
            <div className="skeleton h-6 w-48 rounded" />
            <div className="skeleton h-3 w-full rounded" />
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3 mb-3 flex-wrap">
              <span className={`font-mono font-bold text-xl uppercase ${confidenceLevelColor[verdict?.confidence_level ?? '']}`}>
                {verdict?.confidence_level.replace(/_/g, ' ') ?? '—'}
              </span>
              {verdict?.has_edge != null && (
                <span className={`text-[10px] px-2 py-0.5 rounded border font-bold uppercase ${
                  verdict.has_edge ? 'bg-bull-default/10 text-bull-default border-bull-default/20' : 'bg-bear-default/10 text-bear-default border-bear-default/20'
                }`}>
                  {verdict.has_edge ? 'EDGE CONFIRMED' : 'NO EDGE'}
                </span>
              )}
            </div>
            <p className="text-terminal-muted text-xs">{verdict?.summary}</p>
          </>
        )}
      </div>

      {/* Overall stats */}
      <div>
        <p className="text-terminal-muted text-[9px] uppercase tracking-widest mb-3">Overall Statistics (30d)</p>
        <div className="glass-card rounded-lg p-5">
          {loading ? (
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="space-y-1">
                  <div className="skeleton h-2.5 w-16 rounded" />
                  <div className="skeleton h-6 w-12 rounded" />
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-4">
              <StatPair label="Signals"    value={String(overall?.total ?? 0)} />
              <StatPair label="Win Rate"   value={overall?.win_rate != null ? `${(overall.win_rate * 100).toFixed(1)}%` : '—'} accent={overall?.win_rate && overall.win_rate >= 0.55 ? 'text-bull-default' : 'text-bear-default'} />
              <StatPair label="Expectancy" value={overall?.expectancy != null ? `${overall.expectancy > 0 ? '+' : ''}${overall.expectancy.toFixed(2)}R` : '—'} accent={overall?.expectancy && overall.expectancy > 0 ? 'text-bull-default' : 'text-bear-default'} />
              <StatPair label="Profit Factor" value={overall?.profit_factor?.toFixed(2) ?? '—'} accent={overall?.profit_factor && overall.profit_factor >= 1.5 ? 'text-bull-default' : 'text-terminal-text'} />
              <StatPair label="Max DD"     value={overall?.max_drawdown_r != null ? `${overall.max_drawdown_r.toFixed(1)}R` : '—'} accent="text-bear-default" />
              <StatPair label="Sharpe"     value={overall?.sharpe?.toFixed(2) ?? '—'} accent={overall?.sharpe && overall.sharpe > 1 ? 'text-bull-default' : 'text-terminal-text'} />
            </div>
          )}
          {overall && (
            <div className="mt-4 pt-4 border-t border-terminal-border/50 flex gap-6 text-[11px] font-mono text-terminal-muted">
              <span>TP: <span className="text-bull-default">{overall.tp_hits}</span></span>
              <span>SL: <span className="text-bear-default">{overall.sl_hits}</span></span>
              <span>TO: <span className="text-terminal-text">{overall.timeouts}</span></span>
              {overall.win_rate_ci && (
                <span>95% CI: [{(overall.win_rate_ci[0] * 100).toFixed(1)}%, {(overall.win_rate_ci[1] * 100).toFixed(1)}%]</span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Calibration */}
      {cal && (
        <div>
          <p className="text-terminal-muted text-[9px] uppercase tracking-widest mb-3">Confidence Calibration</p>
          <div className="glass-card rounded-lg overflow-hidden">
            <div className="px-5 py-3 border-b border-terminal-border flex items-center gap-4 flex-wrap">
              <span className="text-terminal-muted text-[10px]">ECE:</span>
              <span className={`font-mono text-sm font-bold ${cal.calibration.ece < 0.05 ? 'text-bull-default' : cal.calibration.ece < 0.12 ? 'text-signal-high' : 'text-bear-default'}`}>
                {cal.calibration.ece.toFixed(4)}
              </span>
              <span className="text-terminal-muted text-[10px]">Label:</span>
              <span className="text-terminal-text text-[11px] font-mono">{cal.calibration.label.replace(/_/g, ' ')}</span>
              <span className="text-terminal-muted text-[10px]">Monotone:</span>
              <span className={`text-[11px] font-mono ${cal.calibration.is_monotone ? 'text-bull-default' : 'text-bear-default'}`}>
                {cal.calibration.is_monotone === null ? '—' : cal.calibration.is_monotone ? 'yes' : 'no'}
              </span>
              {cal.optimal_threshold != null && (
                <>
                  <span className="text-terminal-muted text-[10px]">Optimal threshold:</span>
                  <span className="text-signal-high font-mono text-[11px]">{cal.optimal_threshold}</span>
                </>
              )}
            </div>
            <CalibrationTable bands={cal.bands} />
          </div>
        </div>
      )}

      {edge && (
        <p className="text-terminal-muted/40 text-[10px] font-mono">
          Generated {new Date(edge.generated_at).toLocaleString()} · {edge.window_hours}h window
        </p>
      )}
    </div>
  )
}
