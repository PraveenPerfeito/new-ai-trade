'use client'

import { useCallback } from 'react'
import { adminApi, HealthReady } from '@/lib/admin-api'
import { useAutoRefresh } from '@/lib/use-auto-refresh'
import { Settings2, AlertCircle } from 'lucide-react'

type SettingRow = {
  key: string
  value: string
  category: string
  note?: string
}

const STATIC_SETTINGS: SettingRow[] = [
  // Anomaly thresholds
  { key: 'WIN_RATE_DROP_WARN',     value: '0.12 (12 pp)',  category: 'Anomaly Thresholds', note: 'Warning threshold' },
  { key: 'WIN_RATE_DROP_CRIT',     value: '0.25 (25 pp)',  category: 'Anomaly Thresholds', note: 'Critical threshold' },
  { key: 'FALSE_POSITIVE_WARN',    value: '0.70 (70%)',    category: 'Anomaly Thresholds' },
  { key: 'EXPECTANCY_CRIT',        value: '0.00',          category: 'Anomaly Thresholds', note: 'Any negative expectancy (n≥20)' },
  { key: 'DRAWDOWN_WARN',          value: '5.0R',          category: 'Anomaly Thresholds' },
  { key: 'DRAWDOWN_CRIT',          value: '10.0R',         category: 'Anomaly Thresholds' },
  { key: 'ECE_WARN',               value: '0.12',          category: 'Anomaly Thresholds' },
  { key: 'ECE_CRIT',               value: '0.20',          category: 'Anomaly Thresholds' },
  { key: 'ECE_DRIFT_THRESHOLD',    value: '0.05',          category: 'Anomaly Thresholds' },
  { key: 'SCAN_FAILURE_WARN',      value: '0.15 (15%)',    category: 'Anomaly Thresholds' },
  { key: 'SCAN_FAILURE_CRIT',      value: '0.30 (30%)',    category: 'Anomaly Thresholds' },
  { key: 'AI_ERROR_WARN',          value: '0.08 (8%)',     category: 'Anomaly Thresholds' },
  { key: 'AI_ERROR_CRIT',          value: '0.15 (15%)',    category: 'Anomaly Thresholds' },
  { key: 'AI_FALLBACK_WARN',       value: '0.40 (40%)',    category: 'Anomaly Thresholds' },
  { key: 'QUEUE_DEPTH_WARN',       value: '10',            category: 'Anomaly Thresholds' },
  { key: 'QUEUE_DEPTH_CRIT',       value: '30',            category: 'Anomaly Thresholds' },
  // Readiness weights
  { key: 'operational_stability',  value: '25%',           category: 'Readiness Weights' },
  { key: 'signal_edge',            value: '30%',           category: 'Readiness Weights' },
  { key: 'calibration',            value: '20%',           category: 'Readiness Weights' },
  { key: 'ai_effectiveness',       value: '15%',           category: 'Readiness Weights' },
  { key: 'data_coverage',          value: '10%',           category: 'Readiness Weights' },
  // Burn-in
  { key: 'MIN_SIGNALS_FOR_EDGE',   value: '30',            category: 'Burn-In', note: 'Minimum for edge verdict' },
  { key: 'MIN_SIGNALS_FOR_REPORT', value: '100',           category: 'Burn-In', note: 'Minimum for full report' },
  // Readiness verdicts
  { key: 'production_ready',       value: 'score ≥ 80',    category: 'Readiness Verdicts', note: 'GO' },
  { key: 'ready_with_monitoring',  value: 'score ≥ 65',    category: 'Readiness Verdicts', note: 'GO with monitoring' },
  { key: 'needs_more_data',        value: 'score ≥ 50',    category: 'Readiness Verdicts', note: 'NOT GO — burn-in' },
  { key: 'not_ready',              value: 'score < 50',    category: 'Readiness Verdicts', note: 'NOT GO — issues' },
]

const CATEGORIES = Array.from(new Set(STATIC_SETTINGS.map(s => s.category)))

export default function SettingsPage() {
  const healthFetcher = useCallback(() => adminApi.health.ready(), [])
  const { data: health } = useAutoRefresh<HealthReady>(healthFetcher, 60_000)

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-start gap-3">
        <div>
          <h1 className="text-terminal-text text-lg font-semibold">Settings</h1>
          <p className="text-terminal-muted text-xs mt-0.5">System thresholds · Readiness configuration · Build info</p>
        </div>
        <Settings2 size={20} className="text-terminal-muted/40 mt-0.5" />
      </div>

      {/* Read-only notice */}
      <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-signal-medium/5 border border-signal-medium/20 text-signal-medium text-xs">
        <AlertCircle size={13} />
        <span>Settings are read-only in this view. Modify values in <code className="font-mono bg-terminal-bright/50 px-1 rounded">backend/analytics/anomaly_detector.py</code> and <code className="font-mono bg-terminal-bright/50 px-1 rounded">backend/analytics/production_readiness.py</code>.</span>
      </div>

      {/* Grouped settings tables */}
      {CATEGORIES.map(category => {
        const rows = STATIC_SETTINGS.filter(s => s.category === category)
        return (
          <div key={category}>
            <p className="text-terminal-muted text-[9px] uppercase tracking-widest mb-3">{category}</p>
            <div className="glass-card rounded-lg overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-terminal-border">
                    <th className="text-terminal-muted text-[9px] uppercase tracking-wider text-left py-2 px-4">Key</th>
                    <th className="text-terminal-muted text-[9px] uppercase tracking-wider text-left py-2 px-4">Value</th>
                    <th className="text-terminal-muted text-[9px] uppercase tracking-wider text-left py-2 px-4">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => (
                    <tr key={row.key} className="border-b border-terminal-border/30 hover:bg-terminal-bright/10">
                      <td className="py-2.5 px-4 font-mono text-terminal-text">{row.key}</td>
                      <td className="py-2.5 px-4 font-mono text-signal-medium font-bold">{row.value}</td>
                      <td className="py-2.5 px-4 text-terminal-muted/60">{row.note ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      })}

      {/* Runtime health */}
      {health && (
        <div>
          <p className="text-terminal-muted text-[9px] uppercase tracking-widest mb-3">Runtime Connectivity</p>
          <div className="glass-card rounded-lg px-5 py-4 flex items-center gap-6 flex-wrap">
            <div>
              <p className="text-terminal-muted text-[10px] uppercase tracking-wider mb-1">API Status</p>
              <p className={`font-mono font-bold text-sm uppercase ${health.status === 'ready' ? 'text-bull-default' : 'text-bear-default'}`}>
                {health.status}
              </p>
            </div>
            {Object.entries(health.checks).map(([svc, st]) => (
              <div key={svc}>
                <p className="text-terminal-muted text-[10px] uppercase tracking-wider mb-1 capitalize">{svc}</p>
                <p className={`font-mono font-bold text-sm uppercase ${st === 'ok' ? 'text-bull-default' : st === 'not_configured' ? 'text-terminal-muted' : 'text-bear-default'}`}>
                  {st}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
