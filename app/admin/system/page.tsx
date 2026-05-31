'use client'

import { useCallback } from 'react'
import { adminApi, HealthReady, ScanSummaryResponse, AiSummaryResponse, MonitorSnapshot, MonitorLevel } from '@/lib/admin-api'
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

// ── Monitoring helpers ────────────────────────────────────────────────────────

const LEVEL_CLS: Record<MonitorLevel, string> = {
  healthy:  'text-emerald-400',
  warning:  'text-amber-400',
  critical: 'text-red-400',
}
const LEVEL_DOT: Record<MonitorLevel, string> = {
  healthy:  'bg-emerald-400',
  warning:  'bg-amber-400 animate-pulse',
  critical: 'bg-red-400 animate-pulse',
}

function MonitorRow({ label, metric }: { label: string; metric: { value: number; unit: string; level: MonitorLevel } }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-terminal-border/15 last:border-0">
      <span className="text-terminal-muted text-xs">{label}</span>
      <span className={`font-mono text-xs font-semibold ${LEVEL_CLS[metric.level]}`}>
        {metric.value.toLocaleString()}{metric.unit && ` ${metric.unit}`}
      </span>
    </div>
  )
}

export default function SystemPage() {
  const healthFetcher  = useCallback(() => adminApi.health.ready(), [])
  const scanFetcher    = useCallback(() => adminApi.analytics.scans(24), [])
  const aiFetcher      = useCallback(() => adminApi.analytics.ai(24), [])
  const monitorFetcher = useCallback(() => adminApi.analytics.monitor(), [])

  const { data: health,  loading: hl } = useAutoRefresh<HealthReady>(healthFetcher, 30_000)
  const { data: scans }                = useAutoRefresh<ScanSummaryResponse>(scanFetcher, 30_000)
  const { data: ai }                   = useAutoRefresh<AiSummaryResponse>(aiFetcher, 30_000)
  const { data: monitor }              = useAutoRefresh<MonitorSnapshot>(monitorFetcher, 60_000)

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-terminal-text text-xl font-semibold">System Health</h1>
        <p className="text-terminal-muted text-sm mt-1">Service status · Database · Redis · API connectivity</p>
      </div>

      {/* Overall status banner — primary health, above fold */}
      {!hl && health && (
        <div className={`rounded-xl px-5 py-4 border flex items-center gap-4 ${
          health.status === 'ready'
            ? 'bg-bull-default/5 border-bull-default/20'
            : 'bg-bear-default/5 border-bear-default/20'
        }`}>
          <span className={`w-3 h-3 rounded-full shrink-0 ${health.status === 'ready' ? 'bg-bull-default animate-pulse-slow' : 'bg-bear-default animate-pulse'}`} />
          <div>
            <span className={`font-mono font-bold text-base uppercase ${health.status === 'ready' ? 'text-bull-default' : 'text-bear-default'}`}>
              System {health.status}
            </span>
            <p className="text-xs text-terminal-muted/60 mt-0.5">
              {health.status === 'ready' ? 'All services operating normally' : 'One or more services degraded — check below'}
            </p>
          </div>
        </div>
      )}

      {/* Primary: Service grid */}
      <div>
        <p className="text-[9px] text-terminal-muted/50 uppercase tracking-widest mb-2.5">Service Status</p>
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

      {/* Secondary: Operational metrics */}
      <div>
        <p className="text-[9px] text-terminal-muted/50 uppercase tracking-widest mb-2.5">Operational Metrics · 24h</p>
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

      {/* ── Operational Monitoring ─────────────────────────────────────────── */}
      {monitor && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <span className={`w-2 h-2 rounded-full shrink-0 ${LEVEL_DOT[monitor.overall_level]}`} />
            <p className="text-terminal-muted text-xs uppercase tracking-wider font-semibold">
              Operational Monitoring — Today
            </p>
            <span className={`ml-auto text-[10px] font-mono font-bold uppercase ${LEVEL_CLS[monitor.overall_level]}`}>
              {monitor.overall_level}
            </span>
          </div>

          {/* Anomalies */}
          {monitor.anomalies.length > 0 && (
            <div className="space-y-1.5 mb-3">
              {monitor.anomalies.map((a, i) => (
                <div key={i} className={`rounded-lg px-3 py-2 border text-xs flex items-start gap-2 ${
                  a.severity === 'critical' ? 'bg-red-900/15 border-red-500/30 text-red-300'
                  : 'bg-amber-900/15 border-amber-500/30 text-amber-300'
                }`}>
                  <span className="shrink-0 mt-0.5">{a.severity === 'critical' ? '🔴' : '🟠'}</span>
                  <span>{a.message}</span>
                </div>
              ))}
            </div>
          )}

          {/* Metrics grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="glass-card rounded-xl p-4">
              <p className="text-terminal-muted text-[9px] uppercase tracking-widest mb-2">Signals & Outcomes</p>
              <MonitorRow label="Signals today"        metric={monitor.metrics.signals_per_day} />
              <MonitorRow label="Win rate (7d)"        metric={monitor.metrics.win_rate_pct} />
              <MonitorRow label="SL rate (7d)"         metric={monitor.metrics.sl_rate_pct} />
              <MonitorRow label="Resolved outcomes (7d)" metric={monitor.metrics.resolved_7d} />
              <MonitorRow label="Telegram sends"       metric={monitor.metrics.telegram_sends_per_day} />
            </div>
            <div className="glass-card rounded-xl p-4">
              <p className="text-terminal-muted text-[9px] uppercase tracking-widest mb-2">Scanner</p>
              <MonitorRow label="Scans today"          metric={monitor.metrics.scans_today} />
              <MonitorRow label="Coins/run"            metric={monitor.metrics.coins_scanned_per_run} />
              <MonitorRow label="Last scan duration"   metric={monitor.metrics.scan_duration_s} />
              <MonitorRow label="Binance errors"       metric={monitor.metrics.binance_errors_per_day} />
              <MonitorRow label="CMC credits/day"      metric={monitor.metrics.cmc_credits_per_day} />
            </div>
            <div className="glass-card rounded-xl p-4">
              <p className="text-terminal-muted text-[9px] uppercase tracking-widest mb-2">Claude / AI</p>
              <MonitorRow label="Claude calls"         metric={monitor.metrics.claude_calls_per_day} />
              <MonitorRow label="Heuristic calls"      metric={monitor.metrics.heuristic_calls_per_day} />
              <MonitorRow label="Fallback rate"        metric={monitor.metrics.claude_fallback_pct} />
              <MonitorRow label="Est. cost today"      metric={monitor.metrics.estimated_cost_usd} />
            </div>
          </div>
          <p className="text-terminal-muted/30 text-[10px] font-mono mt-2">
            Generated {new Date(monitor.generated_at).toLocaleTimeString()} · counters reset midnight UTC
          </p>
        </div>
      )}

      {/* Diagnostics section label */}
      <p className="text-[9px] text-terminal-muted/40 uppercase tracking-widest flex items-center gap-2">
        <span className="h-px flex-1 bg-terminal-border/30" />Diagnostics<span className="h-px flex-1 bg-terminal-border/30" />
      </p>
    </div>
  )
}
