'use client'

import { useCallback } from 'react'
import { RefreshCw } from 'lucide-react'
import { adminApi, AnomalyRecord, BurninStatus } from '@/lib/admin-api'
import { useAutoRefresh } from '@/lib/use-auto-refresh'
import { AnomalyBadge } from '@/components/admin/anomaly-badge'

function AnomalyRow({ a }: { a: AnomalyRecord }) {
  return (
    <div className="px-5 py-3.5 border-b border-terminal-border/50 last:border-0 hover:bg-terminal-bright/10 transition-colors">
      <div className="flex items-start gap-3 flex-wrap">
        <AnomalyBadge severity={a.severity} />
        <div className="flex-1 min-w-0">
          <p className="text-terminal-text text-xs leading-relaxed">{a.description}</p>
          <div className="flex items-center gap-4 mt-1.5 flex-wrap">
            <span className="text-terminal-muted/60 text-[10px] font-mono uppercase tracking-wide">
              {a.anomaly_type.replace(/_/g, ' ')}
            </span>
            {a.metric_value != null && (
              <span className="text-terminal-muted/60 text-[10px] font-mono">
                value: {a.metric_value} · threshold: {a.threshold ?? '—'}
              </span>
            )}
            <span className="text-terminal-muted/40 text-[10px] font-mono ml-auto">
              {new Date(a.detected_at).toLocaleString()}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function AnomaliesPage() {
  const anomalyFetcher = useCallback(() => adminApi.burnin.anomalies(96), [])
  const statusFetcher  = useCallback(() => adminApi.burnin.status(), [])

  const { data: anomalies, loading: al, refresh } = useAutoRefresh<AnomalyRecord[]>(anomalyFetcher, 60_000)
  const { data: status }                           = useAutoRefresh<BurninStatus>(statusFetcher, 60_000)

  const critical = anomalies?.filter(a => a.severity === 'critical') ?? []
  const warnings = anomalies?.filter(a => a.severity === 'warning')  ?? []
  const info     = anomalies?.filter(a => a.severity === 'info')     ?? []

  const lastCheck = status?.anomaly_summary?.checked_at

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-terminal-text text-lg font-semibold">Anomaly Detection</h1>
          <p className="text-terminal-muted text-xs mt-0.5">
            {lastCheck ? `Last check: ${new Date(lastCheck).toLocaleString()}` : 'Threshold-based anomaly monitoring'}
          </p>
        </div>
        <button
          onClick={refresh}
          className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] text-terminal-muted hover:text-terminal-text border border-terminal-border hover:border-terminal-bright rounded transition-all"
        >
          <RefreshCw size={11} className={al ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Summary counters */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Critical', count: critical.length, color: 'text-bear-default', border: 'border-bear-default/20', bg: 'bg-bear-default/5' },
          { label: 'Warnings', count: warnings.length, color: 'text-signal-high',  border: 'border-signal-high/20',  bg: 'bg-signal-high/5' },
          { label: 'Info',     count: info.length,     color: 'text-signal-medium',border: 'border-signal-medium/20',bg: 'bg-signal-medium/5' },
        ].map(({ label, count, color, border, bg }) => (
          <div key={label} className={`glass-card rounded-lg px-5 py-4 border ${border} ${bg}`}>
            <p className="text-terminal-muted text-[9px] uppercase tracking-widest mb-1">{label}</p>
            <p className={`font-mono font-bold text-3xl ${color}`}>{al ? '—' : count}</p>
          </div>
        ))}
      </div>

      {/* Anomaly feed */}
      <div>
        <p className="text-terminal-muted text-[9px] uppercase tracking-widest mb-3">Recent Anomalies (last 96h)</p>
        <div className="glass-card rounded-lg overflow-hidden">
          {al ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="px-5 py-4 border-b border-terminal-border/50">
                <div className="skeleton h-3 w-16 mb-2 rounded" />
                <div className="skeleton h-2.5 w-full mb-1 rounded" />
                <div className="skeleton h-2.5 w-2/3 rounded" />
              </div>
            ))
          ) : !anomalies?.length ? (
            <div className="px-5 py-10 text-center">
              <p className="text-bull-default text-sm font-semibold">✓ No anomalies detected</p>
              <p className="text-terminal-muted text-xs mt-1">System operating within normal parameters</p>
            </div>
          ) : (
            <>
              {critical.map((a, i) => <AnomalyRow key={`c${i}`} a={a} />)}
              {warnings.map((a, i) => <AnomalyRow key={`w${i}`} a={a} />)}
              {info.map((a, i)     => <AnomalyRow key={`i${i}`} a={a} />)}
            </>
          )}
        </div>
      </div>

      {/* Anomaly type glossary */}
      <div>
        <p className="text-terminal-muted text-[9px] uppercase tracking-widest mb-3">Monitored Checks</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {[
            ['win_rate_degradation',  'Win rate drops ≥12 pp vs 30d baseline'],
            ['expectancy_negative',   'Rolling expectancy turns negative (n≥20)'],
            ['false_positive_spike',  'SL hit rate exceeds 70%'],
            ['drawdown_spike',        'Max drawdown exceeds 5R warning / 10R critical'],
            ['calibration_drift',     'ECE exceeds 0.12 or drifts +0.05 from last snapshot'],
            ['scan_failure_spike',    'Scan failure rate exceeds 15% / 30%'],
            ['ai_error_spike',        'Claude API error rate exceeds 8% / 15%'],
            ['queue_backlog',         'Celery queue depth exceeds 10 / 30 tasks'],
          ].map(([name, desc]) => (
            <div key={name} className="glass-card rounded-md px-3 py-2 flex gap-2">
              <span className="text-terminal-muted/60 font-mono text-[10px] shrink-0 mt-0.5">→</span>
              <div>
                <p className="text-terminal-text text-[11px] font-mono">{name}</p>
                <p className="text-terminal-muted text-[10px] mt-0.5">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
