'use client'

import { useCallback } from 'react'
import { Activity, Brain, Clock, Database, Target, TrendingUp, Zap } from 'lucide-react'
import { adminApi, AiSummaryResponse, BurninStatus, ReadinessResult, ScanSummaryResponse } from '@/lib/admin-api'
import { useAutoRefresh } from '@/lib/use-auto-refresh'
import { MetricCard } from '@/components/admin/metric-card'
import { ScoreRing } from '@/components/admin/score-ring'

function pct(v: number | null | undefined, decimals = 1) {
  return v != null ? `${(v * 100).toFixed(decimals)}%` : '—'
}

function fmt(v: number | null | undefined, suffix = '', decimals = 2) {
  return v != null ? `${v > 0 ? '+' : ''}${v.toFixed(decimals)}${suffix}` : '—'
}

const VERDICT_BADGE: Record<string, string> = {
  production_ready:      'bg-bull-default/10 text-bull-default border-bull-default/20',
  ready_with_monitoring: 'bg-signal-high/10 text-signal-high border-signal-high/20',
  needs_more_data:       'bg-signal-medium/10 text-signal-medium border-signal-medium/20',
  not_ready:             'bg-bear-default/10 text-bear-default border-bear-default/20',
}

export default function OverviewPage() {
  const burninFetcher    = useCallback(() => adminApi.burnin.status(), [])
  const readinessFetcher = useCallback(() => adminApi.burnin.readiness(), [])
  const aiFetcher        = useCallback(() => adminApi.analytics.ai(), [])
  const scanFetcher      = useCallback(() => adminApi.analytics.scans(), [])

  const { data: s, loading: sl } = useAutoRefresh<BurninStatus>(burninFetcher, 30_000)
  const { data: r, loading: rl } = useAutoRefresh<ReadinessResult>(readinessFetcher, 60_000)
  const { data: a, loading: al } = useAutoRefresh<AiSummaryResponse>(aiFetcher, 30_000)
  const { data: sc, loading: scl } = useAutoRefresh<ScanSummaryResponse>(scanFetcher, 30_000)

  const verdictLabel = r?.verdict.label ?? 'unknown'
  const verdictBadge = VERDICT_BADGE[verdictLabel] ?? 'bg-terminal-card text-terminal-muted border-terminal-border'
  const coverage     = s?.data_coverage

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="text-terminal-text text-lg font-semibold">Command Overview</h1>
        <p className="text-terminal-muted text-xs mt-0.5">System status · Signal edge · Operational health</p>
      </div>

      {/* Readiness hero */}
      <div className="grid grid-cols-12 gap-4">
        {/* Score ring */}
        <div className="col-span-12 sm:col-span-3 glass-card rounded-lg p-5 flex flex-col items-center justify-center gap-3">
          {rl
            ? <div className="skeleton w-28 h-28 rounded-full" />
            : <ScoreRing score={r?.overall_score ?? 0} size={112} />
          }
          <p className="text-terminal-muted text-[9px] uppercase tracking-widest">Readiness Score</p>
        </div>

        {/* Verdict */}
        <div className="col-span-12 sm:col-span-5 glass-card rounded-lg p-5">
          <p className="text-terminal-muted text-[9px] uppercase tracking-widest mb-3">System Verdict</p>
          {rl ? (
            <div className="space-y-2">
              <div className="skeleton h-6 w-32 rounded" />
              <div className="skeleton h-3 w-full rounded" />
              <div className="skeleton h-3 w-2/3 rounded" />
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 mb-3 flex-wrap">
                <span className={`font-mono font-bold text-lg ${r?.verdict.go ? 'text-bull-default' : 'text-bear-default'}`}>
                  {r?.verdict.go ? '✓ GO' : '✗ NOT GO'}
                </span>
                <span className={`text-[10px] px-2 py-0.5 rounded border font-bold uppercase tracking-wider ${verdictBadge}`}>
                  {verdictLabel.replace(/_/g, ' ')}
                </span>
              </div>
              <p className="text-terminal-muted text-xs leading-relaxed">
                {r?.verdict.rationale ?? 'No readiness data available.'}
              </p>
            </>
          )}
        </div>

        {/* Burn-in progress */}
        <div className="col-span-12 sm:col-span-4 glass-card rounded-lg p-5">
          <p className="text-terminal-muted text-[9px] uppercase tracking-widest mb-3">Burn-In Progress</p>
          {sl ? (
            <div className="skeleton h-16 rounded" />
          ) : (
            <div>
              <div className="flex items-baseline justify-between mb-2">
                <span className="font-mono font-bold text-2xl text-terminal-text">{coverage?.resolved ?? 0}</span>
                <span className="text-terminal-muted text-[11px]">/ {s?.min_for_report} signals</span>
              </div>
              <div className="w-full h-1.5 bg-terminal-bright rounded-full overflow-hidden mb-2">
                <div
                  className="h-full bg-bull-default rounded-full transition-all duration-700"
                  style={{ width: `${Math.min(100, s?.progress_pct ?? 0)}%` }}
                />
              </div>
              <div className="flex justify-between text-[10px] text-terminal-muted">
                <span>{(s?.progress_pct ?? 0).toFixed(0)}% complete</span>
                <span>{coverage?.days?.toFixed(1) ?? '0'} days · {coverage?.pending ?? 0} pending</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Metrics grid */}
      <div>
        <p className="text-terminal-muted text-[9px] uppercase tracking-widest mb-3">Live Metrics</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MetricCard
            label="Win Rate (7d)"
            value={pct(s?.live_metrics.win_rate_7d)}
            sub="7-day rolling"
            accent={s?.live_metrics.win_rate_7d != null
              ? (s.live_metrics.win_rate_7d >= 0.55 ? 'bull' : 'bear')
              : 'neutral'}
            icon={<TrendingUp size={13} />}
            loading={sl}
          />
          <MetricCard
            label="Expectancy (7d)"
            value={fmt(s?.live_metrics.expectancy_7d, 'R')}
            sub="avg per trade"
            accent={s?.live_metrics.expectancy_7d != null
              ? (s.live_metrics.expectancy_7d > 0 ? 'bull' : 'bear')
              : 'neutral'}
            icon={<Target size={13} />}
            loading={sl}
          />
          <MetricCard
            label="Resolved Signals"
            value={coverage?.resolved ?? 0}
            sub={`${coverage?.pending ?? 0} still pending`}
            accent="info"
            icon={<Zap size={13} />}
            loading={sl}
          />
          <MetricCard
            label="Data Window"
            value={`${coverage?.days?.toFixed(0) ?? 0}d`}
            sub={coverage?.earliest ? `since ${coverage.earliest.slice(0, 10)}` : 'no data yet'}
            accent="neutral"
            icon={<Clock size={13} />}
            loading={sl}
          />
          <MetricCard
            label="AI Calls (24h)"
            value={a?.total_calls ?? 0}
            sub={`${pct(a?.success_rate, 0)} success`}
            accent={!a || a.error_rate < 0.05 ? 'bull' : 'warning'}
            icon={<Brain size={13} />}
            loading={al}
          />
          <MetricCard
            label="AI Error Rate"
            value={pct(a?.error_rate)}
            sub="last 24 hours"
            accent={!a ? 'neutral' : a.error_rate >= 0.15 ? 'bear' : a.error_rate >= 0.08 ? 'warning' : 'bull'}
            icon={<Brain size={13} />}
            loading={al}
          />
          <MetricCard
            label="Scan Success"
            value={pct(sc?.success_rate, 0)}
            sub={sc ? `${sc.total_scans} scans` : '—'}
            accent={!sc ? 'neutral' : sc.failure_rate >= 0.30 ? 'bear' : sc.failure_rate >= 0.15 ? 'warning' : 'bull'}
            icon={<Activity size={13} />}
            loading={scl}
          />
          <MetricCard
            label="Fallback Rate"
            value={pct(a?.fallback_rate)}
            sub="heuristic fallback"
            accent={!a ? 'neutral' : a.fallback_rate >= 0.40 ? 'warning' : 'bull'}
            icon={<Database size={13} />}
            loading={al}
          />
        </div>
      </div>

      {/* Anomaly summary strip */}
      {s?.anomaly_summary && (
        <div>
          <p className="text-terminal-muted text-[9px] uppercase tracking-widest mb-3">Last Anomaly Check</p>
          <div className="glass-card rounded-lg px-5 py-4 flex items-center gap-6 flex-wrap">
            {[
              { label: 'Critical', v: s.anomaly_summary.critical, color: s.anomaly_summary.critical > 0 ? 'text-bear-default' : 'text-bull-default' },
              { label: 'Warnings', v: s.anomaly_summary.warning,  color: s.anomaly_summary.warning  > 0 ? 'text-signal-high'  : 'text-terminal-muted' },
              { label: 'Total',    v: s.anomaly_summary.total,    color: 'text-terminal-text' },
            ].map(({ label, v, color }) => (
              <div key={label} className="flex flex-col gap-1">
                <span className="text-terminal-muted text-[10px] uppercase tracking-wider">{label}</span>
                <span className={`font-mono font-bold text-xl ${color}`}>{v}</span>
              </div>
            ))}
            <div className="h-8 w-px bg-terminal-border mx-2 hidden sm:block" />
            <div className="flex flex-col gap-1">
              <span className="text-terminal-muted text-[10px] uppercase tracking-wider">Status</span>
              <span className={`font-mono font-bold text-sm ${s.anomaly_summary.ok ? 'text-bull-default' : 'text-bear-default'}`}>
                {s.anomaly_summary.ok ? '✓ CLEAN' : '⚠ ISSUES'}
              </span>
            </div>
            <div className="ml-auto text-terminal-muted/50 text-[10px] font-mono">
              {new Date(s.anomaly_summary.checked_at).toLocaleTimeString()}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
