'use client'

import { useCallback } from 'react'
import { adminApi, BurninStatus, ReadinessResult } from '@/lib/admin-api'
import { useAutoRefresh } from '@/lib/use-auto-refresh'
import { ScoreRing } from '@/components/admin/score-ring'
import { formatTs } from '@/lib/utils'

const COMPONENTS = [
  { key: 'operational_stability', label: 'Operational Stability', weight: 0.25 },
  { key: 'signal_edge',           label: 'Signal Edge',           weight: 0.30 },
  { key: 'calibration',           label: 'Calibration',           weight: 0.20 },
  { key: 'ai_effectiveness',      label: 'AI Effectiveness',      weight: 0.15 },
  { key: 'data_coverage',         label: 'Data Coverage',         weight: 0.10 },
] as const

function ScoreBar({ score, weight }: { score: number; weight: number }) {
  const color = score >= 80 ? '#00d084' : score >= 65 ? '#f59e0b' : score >= 50 ? '#f97316' : '#ff3b5c'
  return (
    <div className="flex items-center gap-3">
      <span className="text-terminal-muted text-xs font-mono w-8 text-right">{(weight * 100).toFixed(0)}%</span>
      <div className="flex-1 h-1.5 bg-terminal-bright rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${score}%`, backgroundColor: color }}
        />
      </div>
      <span className="font-mono text-sm font-bold w-8" style={{ color }}>{score}</span>
    </div>
  )
}

function SubScores({ comp, data }: { comp: typeof COMPONENTS[number]['key']; data: ReadinessResult }) {
  const c = data.components[comp]
  const entries = Object.entries(c).filter(([k]) => k.endsWith('_score') && k !== 'score')

  if (!entries.length) return null
  return (
    <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2">
      {entries.map(([k, v]) => (
        <div key={k} className="bg-terminal-bright/30 rounded px-2.5 py-1.5">
          <p className="text-terminal-muted text-xs uppercase tracking-wider">{k.replace('_score', '')}</p>
          <p className="font-mono font-bold text-sm text-terminal-text">{String(v)}</p>
        </div>
      ))}
    </div>
  )
}

function InputRow({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="flex justify-between items-center py-1 border-b border-terminal-border/40 last:border-0">
      <span className="text-terminal-muted text-xs capitalize">{label.replace(/_/g, ' ')}</span>
      <span className="font-mono text-xs text-terminal-text">{value != null ? value.toString() : '—'}</span>
    </div>
  )
}

export default function ReadinessPage() {
  const readinessFetcher = useCallback(() => adminApi.burnin.readiness(), [])
  const statusFetcher    = useCallback(() => adminApi.burnin.status(), [])

  const { data: r, loading: rl } = useAutoRefresh<ReadinessResult>(readinessFetcher, 60_000)
  const { data: s }              = useAutoRefresh<BurninStatus>(statusFetcher, 60_000)

  const verdictColors: Record<string, string> = {
    production_ready:      'text-bull-default border-bull-default/30 bg-bull-default/5',
    ready_with_monitoring: 'text-signal-high border-signal-high/30 bg-signal-high/5',
    needs_more_data:       'text-signal-medium border-signal-medium/30 bg-signal-medium/5',
    not_ready:             'text-bear-default border-bear-default/30 bg-bear-default/5',
  }
  const vColor = r ? verdictColors[r.verdict.label] ?? '' : ''

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-terminal-text text-xl font-semibold">Production Readiness</h1>
        <p className="text-terminal-muted text-sm mt-1">Go / No-go assessment · 5-component weighted score</p>
      </div>

      {/* Score + verdict hero */}
      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-12 sm:col-span-3 glass-card rounded-lg p-6 flex flex-col items-center justify-center">
          {rl
            ? <div className="skeleton w-28 h-28 rounded-full" />
            : <ScoreRing score={r?.overall_score ?? 0} size={120} />
          }
        </div>

        <div className="col-span-12 sm:col-span-9 glass-card rounded-lg p-5">
          {rl ? (
            <div className="space-y-3">
              <div className="skeleton h-6 w-40 rounded" />
              <div className="skeleton h-3 w-full rounded" />
              <div className="skeleton h-3 w-3/4 rounded" />
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3 mb-4 flex-wrap">
                <span className={`font-mono font-bold text-2xl ${r?.verdict.go ? 'text-bull-default' : 'text-bear-default'}`}>
                  {r?.verdict.go ? '✓  GO' : '✗  NOT GO'}
                </span>
                <span className={`text-xs px-2.5 py-1 rounded border font-bold uppercase tracking-wider ${vColor}`}>
                  {r?.verdict.label.replace(/_/g, ' ')}
                </span>
              </div>
              <p className="text-terminal-muted text-sm leading-relaxed">{r?.verdict.rationale}</p>
              {r && (
                <p className="text-terminal-muted/50 text-xs mt-3 font-mono">
                  Computed {formatTs(r.computed_at)} · {r.data_source}
                </p>
              )}
            </>
          )}
        </div>
      </div>

      {/* Component breakdown */}
      <div>
        <p className="text-terminal-muted text-xs uppercase tracking-wider mb-3">Component Breakdown</p>
        <div className="glass-card rounded-lg divide-y divide-terminal-border/50">
          {COMPONENTS.map(({ key, label, weight }) => {
            const comp = r?.components[key]
            const score = comp?.score ?? 0
            return (
              <details key={key} className="group">
                <summary className="flex items-center gap-4 px-5 py-4 cursor-pointer list-none hover:bg-terminal-bright/20 transition-colors">
                  <span className="text-terminal-text text-sm font-medium w-44 shrink-0">{label}</span>
                  <div className="flex-1 min-w-0">
                    {rl ? <div className="skeleton h-1.5 w-full rounded" /> : <ScoreBar score={score} weight={weight} />}
                  </div>
                  <span className="text-terminal-muted/50 text-xs group-open:rotate-180 transition-transform">▼</span>
                </summary>
                {r && comp && (
                  <div className="px-5 pb-4 bg-terminal-surface/40">
                    <SubScores comp={key} data={r} />
                    <div className="mt-3">
                      <p className="text-terminal-muted text-xs uppercase tracking-wider mb-1">Inputs</p>
                      {Object.entries(comp.inputs).map(([k, v]) => (
                        <InputRow key={k} label={k} value={v} />
                      ))}
                    </div>
                  </div>
                )}
              </details>
            )
          })}
        </div>
      </div>

      {/* Burn-in context */}
      {s && (
        <div>
          <p className="text-terminal-muted text-xs uppercase tracking-wider mb-3">Burn-In Context</p>
          <div className="glass-card rounded-lg p-5 grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: 'Resolved Signals', v: s.data_coverage.resolved },
              { label: 'Pending Signals',  v: s.data_coverage.pending },
              { label: 'Days of Data',     v: `${s.data_coverage.days.toFixed(1)}d` },
              { label: 'Progress',         v: `${s.progress_pct.toFixed(0)}%` },
            ].map(({ label, v }) => (
              <div key={label}>
                <p className="text-terminal-muted text-xs uppercase tracking-wider mb-1">{label}</p>
                <p className="font-mono font-bold text-lg text-terminal-text">{v}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
