'use client'

import { useCallback } from 'react'
import { Activity, Clock, Layers, TrendingDown } from 'lucide-react'
import { adminApi, ScanSummaryResponse, HealthReady } from '@/lib/admin-api'
import { useAutoRefresh } from '@/lib/use-auto-refresh'
import { MetricCard } from '@/components/admin/metric-card'

function HealthDot({ status }: { status: string }) {
  const ok = status === 'ok' || status === 'ready'
  return (
    <span className={`inline-block w-2 h-2 rounded-full ${ok ? 'bg-bull-default' : 'bg-bear-default'}`} />
  )
}

function ModeRow({ mode, data }: { mode: string; data: { total: number; success_rate: number } }) {
  return (
    <div className="flex items-center gap-4 py-2.5 border-b border-terminal-border/40 last:border-0">
      <span className="text-terminal-muted font-mono text-[11px] w-28 uppercase">{mode}</span>
      <div className="flex-1 h-1.5 bg-terminal-bright rounded-full overflow-hidden">
        <div
          className="h-full rounded-full bg-bull-default/60"
          style={{ width: `${data.success_rate * 100}%` }}
        />
      </div>
      <span className="font-mono text-[11px] text-bull-default w-14 text-right">
        {(data.success_rate * 100).toFixed(0)}%
      </span>
      <span className="font-mono text-[11px] text-terminal-muted w-16 text-right">
        {data.total} scans
      </span>
    </div>
  )
}

export default function OperationsPage() {
  const scanFetcher   = useCallback(() => adminApi.analytics.scans(24), [])
  const healthFetcher = useCallback(() => adminApi.health.ready(), [])

  const { data: scans, loading: sl } = useAutoRefresh<ScanSummaryResponse>(scanFetcher, 30_000)
  const { data: health, loading: hl } = useAutoRefresh<HealthReady>(healthFetcher, 30_000)

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-terminal-text text-lg font-semibold">Operations</h1>
        <p className="text-terminal-muted text-xs mt-0.5">Scanner throughput · Queue health · Infrastructure metrics</p>
      </div>

      {/* Key scan metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard
          label="Total Scans (24h)"
          value={scans?.total_scans ?? 0}
          sub="last 24 hours"
          accent="info"
          icon={<Activity size={13} />}
          loading={sl}
        />
        <MetricCard
          label="Success Rate"
          value={scans ? `${(scans.success_rate * 100).toFixed(0)}%` : '—'}
          sub="completed OK"
          accent={!scans ? 'neutral' : scans.failure_rate >= 0.30 ? 'bear' : scans.failure_rate >= 0.15 ? 'warning' : 'bull'}
          icon={<Activity size={13} />}
          loading={sl}
        />
        <MetricCard
          label="Failure Rate"
          value={scans ? `${(scans.failure_rate * 100).toFixed(1)}%` : '—'}
          sub="scan errors"
          accent={!scans ? 'neutral' : scans.failure_rate >= 0.30 ? 'bear' : scans.failure_rate >= 0.15 ? 'warning' : 'bull'}
          icon={<TrendingDown size={13} />}
          loading={sl}
        />
        <MetricCard
          label="Avg Duration"
          value={scans?.avg_duration_ms != null
            ? scans.avg_duration_ms >= 1000
              ? `${(scans.avg_duration_ms / 1000).toFixed(1)}s`
              : `${scans.avg_duration_ms.toFixed(0)}ms`
            : '—'}
          sub="per scan"
          accent="neutral"
          icon={<Clock size={13} />}
          loading={sl}
        />
      </div>

      {/* Per-mode breakdown */}
      {scans?.by_mode && Object.keys(scans.by_mode).length > 0 && (
        <div>
          <p className="text-terminal-muted text-[9px] uppercase tracking-widest mb-3">Scan Mode Breakdown</p>
          <div className="glass-card rounded-lg px-5 py-3">
            {Object.entries(scans.by_mode).map(([mode, data]) => (
              <ModeRow key={mode} mode={mode} data={data} />
            ))}
          </div>
        </div>
      )}

      {/* Infrastructure health */}
      <div>
        <p className="text-terminal-muted text-[9px] uppercase tracking-widest mb-3">Infrastructure Health</p>
        <div className="glass-card rounded-lg divide-y divide-terminal-border/50">
          {hl ? (
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="px-5 py-3.5 flex items-center gap-3">
                <div className="skeleton w-2 h-2 rounded-full" />
                <div className="skeleton h-3 w-24 rounded" />
                <div className="skeleton h-3 w-16 rounded ml-auto" />
              </div>
            ))
          ) : health ? (
            <>
              <div className="px-5 py-3.5 flex items-center gap-3">
                <HealthDot status={health.status} />
                <span className="text-terminal-text text-sm font-medium">Backend API</span>
                <span className={`ml-auto font-mono text-xs ${health.status === 'ready' ? 'text-bull-default' : 'text-bear-default'}`}>
                  {health.status.toUpperCase()}
                </span>
              </div>
              {Object.entries(health.checks).map(([service, status]) => (
                <div key={service} className="px-5 py-3 flex items-center gap-3">
                  <HealthDot status={status} />
                  <span className="text-terminal-muted text-sm capitalize">{service}</span>
                  <span className={`ml-auto font-mono text-xs ${
                    status === 'ok' ? 'text-bull-default'
                    : status === 'not_configured' ? 'text-terminal-muted'
                    : 'text-bear-default'
                  }`}>
                    {status.toUpperCase()}
                  </span>
                </div>
              ))}
            </>
          ) : (
            <div className="px-5 py-5 text-center text-terminal-muted text-sm">
              Backend unreachable
            </div>
          )}
        </div>
      </div>

      {/* Celery task schedule reference */}
      <div>
        <p className="text-terminal-muted text-[9px] uppercase tracking-widest mb-3">Beat Schedule</p>
        <div className="glass-card rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-terminal-border">
                <th className="text-terminal-muted text-[9px] uppercase tracking-wider text-left py-2 px-4">Task</th>
                <th className="text-terminal-muted text-[9px] uppercase tracking-wider text-left py-2 px-4">Schedule</th>
                <th className="text-terminal-muted text-[9px] uppercase tracking-wider text-left py-2 px-4">Queue</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['Standard Scan',          'Every 15 min',   'scanner'],
                ['High-Confidence Scan',   'Every 30 min',   'scanner'],
                ['Futures Scan',           'Every 30 min',   'scanner'],
                ['Paper Trading Monitor',  'Every minute',   'paper_trading'],
                ['Signal Outcome Check',   'Every 10 min',   'paper_trading'],
                ['Daily Analytics',        '23:59 UTC',      'celery'],
                ['Hourly Anomaly Check',   'Every hour',     'celery'],
                ['Refresh Daily View',     '00:05 UTC',      'celery'],
              ].map(([task, sched, queue]) => (
                <tr key={task} className="border-b border-terminal-border/30 hover:bg-terminal-bright/10">
                  <td className="py-2.5 px-4 text-terminal-text font-mono">{task}</td>
                  <td className="py-2.5 px-4 text-terminal-muted font-mono">{sched}</td>
                  <td className="py-2.5 px-4">
                    <span className={`text-[9px] px-1.5 py-0.5 rounded border font-mono ${
                      queue === 'scanner' ? 'text-signal-medium border-signal-medium/30 bg-signal-medium/5'
                      : queue === 'paper_trading' ? 'text-signal-purple border-signal-purple/30 bg-signal-purple/5'
                      : 'text-terminal-muted border-terminal-border'
                    }`}>{queue}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
