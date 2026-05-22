'use client'

import { useCallback } from 'react'
import { adminApi, HealthReady, ScanSummaryResponse, AiSummaryResponse } from '@/lib/admin-api'
import { useAutoRefresh } from '@/lib/use-auto-refresh'
import { MetricCard } from '@/components/admin/metric-card'
import { Server, Database, Cpu, Activity } from 'lucide-react'

function ServiceCard({ name, status, detail }: { name: string; status: string; detail?: string }) {
  const ok = ['ok', 'ready', 'not_configured'].includes(status)
  const isConfigured = status !== 'not_configured'
  return (
    <div className={`glass-card rounded-lg px-4 py-3.5 border ${
      !isConfigured ? 'border-terminal-border' : ok ? 'border-bull-default/20' : 'border-bear-default/20'
    }`}>
      <div className="flex items-center gap-2.5">
        <span className={`w-2 h-2 rounded-full shrink-0 ${
          !isConfigured ? 'bg-terminal-muted/40' : ok ? 'bg-bull-default' : 'bg-bear-default animate-pulse'
        }`} />
        <span className="text-terminal-text text-sm font-medium">{name}</span>
        <span className={`ml-auto font-mono text-xs font-bold uppercase ${
          !isConfigured ? 'text-terminal-muted/60'
          : ok ? 'text-bull-default' : 'text-bear-default'
        }`}>
          {status.replace(/_/g, ' ')}
        </span>
      </div>
      {detail && <p className="text-terminal-muted/50 text-xs font-mono mt-1 ml-4.5 pl-0">{detail}</p>}
    </div>
  )
}

export default function SystemPage() {
  const healthFetcher = useCallback(() => adminApi.health.ready(), [])
  const scanFetcher   = useCallback(() => adminApi.analytics.scans(24), [])
  const aiFetcher     = useCallback(() => adminApi.analytics.ai(24), [])

  const { data: health, loading: hl } = useAutoRefresh<HealthReady>(healthFetcher, 30_000)
  const { data: scans }               = useAutoRefresh<ScanSummaryResponse>(scanFetcher, 30_000)
  const { data: ai }                  = useAutoRefresh<AiSummaryResponse>(aiFetcher, 30_000)

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-terminal-text text-xl font-semibold">System Health</h1>
        <p className="text-terminal-muted text-sm mt-1">Service status · Database · Redis · API connectivity</p>
      </div>

      {/* Overall status banner */}
      {!hl && health && (
        <div className={`rounded-lg px-5 py-3 border flex items-center gap-3 ${
          health.status === 'ready'
            ? 'bg-bull-default/5 border-bull-default/20'
            : 'bg-bear-default/5 border-bear-default/20'
        }`}>
          <span className={`w-2 h-2 rounded-full ${health.status === 'ready' ? 'bg-bull-default animate-pulse-slow' : 'bg-bear-default animate-pulse'}`} />
          <span className={`font-mono font-bold text-sm uppercase ${health.status === 'ready' ? 'text-bull-default' : 'text-bear-default'}`}>
            System {health.status}
          </span>
        </div>
      )}

      {/* Service grid */}
      <div>
        <p className="text-terminal-muted text-xs uppercase tracking-wider mb-3">Service Status</p>
        {hl ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton h-12 rounded-lg" />)}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <ServiceCard name="Backend API" status={health?.status ?? 'unknown'} />
            {Object.entries(health?.checks ?? {}).map(([svc, status]) => (
              <ServiceCard
                key={svc}
                name={svc.charAt(0).toUpperCase() + svc.slice(1)}
                status={status.startsWith('error:') ? 'error' : status}
                detail={status.startsWith('error:') ? status.slice(7) : undefined}
              />
            ))}
          </div>
        )}
      </div>

      {/* Operational metrics */}
      <div>
        <p className="text-terminal-muted text-xs uppercase tracking-wider mb-3">Operational Metrics (24h)</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MetricCard
            label="Total Scans"
            value={scans?.total_scans ?? '—'}
            sub="scanner runs"
            accent="neutral"
            icon={<Activity size={13} />}
            loading={!scans && !hl}
          />
          <MetricCard
            label="Scan Failures"
            value={scans ? `${(scans.failure_rate * 100).toFixed(1)}%` : '—'}
            sub={scans ? `${Math.round(scans.total_scans * scans.failure_rate)} failed` : ''}
            accent={scans && scans.failure_rate >= 0.15 ? 'warning' : 'bull'}
            icon={<Server size={13} />}
            loading={!scans}
          />
          <MetricCard
            label="AI Calls"
            value={ai?.total_calls ?? '—'}
            sub="Claude API"
            accent="info"
            icon={<Cpu size={13} />}
            loading={!ai}
          />
          <MetricCard
            label="AI Failures"
            value={ai ? `${(ai.error_rate * 100).toFixed(1)}%` : '—'}
            sub="API errors"
            accent={ai && ai.error_rate >= 0.08 ? 'warning' : 'bull'}
            icon={<Database size={13} />}
            loading={!ai}
          />
        </div>
      </div>

      {/* Stack reference */}
      <div>
        <p className="text-terminal-muted text-xs uppercase tracking-wider mb-3">System Stack</p>
        <div className="glass-card rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <tbody>
              {[
                ['Backend',   'Python 3.12 + FastAPI + asyncpg'],
                ['Database',  'PostgreSQL via asyncpg connection pool'],
                ['Cache',     'Redis (ioredis + aioredis)'],
                ['Queue',     'Celery + Redis broker'],
                ['Scheduler', 'Celery Beat (cron-based)'],
                ['Frontend',  'Next.js 14 App Router + Tailwind CSS'],
                ['AI',        'Anthropic Claude Haiku (haiku-4-5)'],
                ['Exchange',  'Binance REST API (spot + futures)'],
                ['Monitoring','Prometheus + alertmanager'],
              ].map(([layer, detail]) => (
                <tr key={layer} className="border-b border-terminal-border/30 hover:bg-terminal-bright/10">
                  <td className="py-2.5 px-4 text-terminal-muted text-xs uppercase tracking-wider w-28">{layer}</td>
                  <td className="py-2.5 px-4 font-mono text-terminal-text text-xs">{detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
