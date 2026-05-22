'use client'

import { useCallback } from 'react'
import { adminApi, AiSummaryResponse, EdgeReport } from '@/lib/admin-api'
import { useAutoRefresh } from '@/lib/use-auto-refresh'
import { MetricCard } from '@/components/admin/metric-card'
import { Brain, Zap, AlertTriangle, CheckCircle } from 'lucide-react'

function pct(v: number | null | undefined, d = 1) {
  return v != null ? `${(v * 100).toFixed(d)}%` : '—'
}

function VerdictBar({ label, count, total }: { label: string; count: number; total: number }) {
  const w = total > 0 ? (count / total) * 100 : 0
  const isGood = label === 'claude_adds_value'
  return (
    <div className="flex items-center gap-3">
      <span className="text-terminal-muted text-xs font-mono w-48 truncate capitalize">
        {label.replace(/_/g, ' ')}
      </span>
      <div className="flex-1 h-1.5 bg-terminal-bright rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${isGood ? 'bg-bull-default' : 'bg-terminal-muted/50'}`}
          style={{ width: `${w}%` }}
        />
      </div>
      <span className="font-mono text-xs text-terminal-text w-12 text-right">{count}</span>
      <span className="font-mono text-xs text-terminal-muted w-12 text-right">{w.toFixed(0)}%</span>
    </div>
  )
}

export default function AiPage() {
  const aiFetcher   = useCallback(() => adminApi.analytics.ai(24), [])
  const edgeFetcher = useCallback(() => adminApi.analytics.edgeReport(), [])

  const { data: ai, loading: ail }   = useAutoRefresh<AiSummaryResponse>(aiFetcher, 30_000)
  const { data: edge, loading: el }  = useAutoRefresh<EdgeReport>(edgeFetcher, 120_000)

  const claude    = edge?.claude_effectiveness
  const verdicts  = ai?.verdicts ?? ai?.verdict_distribution ?? {}
  const totalVerd = Object.values(verdicts).reduce((a, b) => a + b, 0)
  const hasAiData = (ai?.total_calls ?? 0) > 0

  const claudeVerdictColors: Record<string, string> = {
    claude_adds_value:        'text-bull-default',
    no_significant_difference:'text-signal-medium',
    insufficient_data:         'text-terminal-muted',
    heuristic_outperforms:    'text-bear-default',
    unclear:                  'text-signal-high',
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-terminal-text text-xl font-semibold">AI Intelligence</h1>
        <p className="text-terminal-muted text-sm mt-1">Claude API health · Effectiveness measurement · Confidence analysis</p>
      </div>

      {/* Warmup banner — shown until AI calls are logged */}
      {!ail && !hasAiData && (
        <div className="rounded-lg px-5 py-4 bg-signal-medium/5 border border-signal-medium/20 flex items-start gap-3">
          <Brain size={14} className="text-signal-medium mt-0.5 shrink-0" />
          <div>
            <p className="text-signal-medium text-sm font-semibold">AI telemetry warming up</p>
            <p className="text-terminal-muted text-xs mt-1 leading-relaxed">
              No Claude API calls logged yet. Run a scan — every signal validation attempt (both Claude and heuristic fallback) is persisted to the AI call log. Metrics will populate after the first scan run.
            </p>
          </div>
        </div>
      )}

      {/* Key metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard
          label="Total AI Calls"
          value={ai?.total_calls ?? 0}
          sub="last 24h"
          accent="info"
          icon={<Brain size={13} />}
          loading={ail}
        />
        <MetricCard
          label="Success Rate"
          value={hasAiData ? pct(ai?.success_rate) : '—'}
          sub={hasAiData ? 'API calls OK' : 'no calls yet'}
          accent={!hasAiData ? 'neutral' : (ai?.success_rate ?? 0) >= 0.95 ? 'bull' : 'warning'}
          icon={<CheckCircle size={13} />}
          loading={ail}
        />
        <MetricCard
          label="Error Rate"
          value={hasAiData ? pct(ai?.error_rate) : '—'}
          sub={hasAiData ? 'API failures' : 'no calls yet'}
          accent={!hasAiData ? 'neutral' : (ai?.error_rate ?? 0) >= 0.15 ? 'bear' : (ai?.error_rate ?? 0) >= 0.08 ? 'warning' : 'bull'}
          icon={<AlertTriangle size={13} />}
          loading={ail}
        />
        <MetricCard
          label="Fallback Rate"
          value={hasAiData ? pct(ai?.fallback_rate) : '—'}
          sub={hasAiData ? 'heuristic used' : 'no calls yet'}
          accent={!hasAiData ? 'neutral' : (ai?.fallback_rate ?? 0) >= 0.40 ? 'warning' : 'bull'}
          icon={<Zap size={13} />}
          loading={ail}
        />
      </div>

      {/* Claude effectiveness */}
      <div>
        <p className="text-terminal-muted text-xs uppercase tracking-wider mb-3">Claude Effectiveness (30d)</p>
        <div className="glass-card rounded-lg p-5">
          {el ? (
            <div className="space-y-2">
              <div className="skeleton h-6 w-48 rounded" />
              <div className="skeleton h-3 w-full rounded" />
            </div>
          ) : claude && claude.verdict !== 'insufficient_data' ? (
            <>
              <div className="flex items-center gap-3 mb-4 flex-wrap">
                <span className={`font-mono font-bold text-xl uppercase ${claudeVerdictColors[claude.verdict] ?? 'text-terminal-text'}`}>
                  {claude.verdict.replace(/_/g, ' ')}
                </span>
                <span className="text-terminal-muted text-xs">
                  {claude.total_with_ai_log} signals with AI log
                </span>
              </div>
              {claude.heuristic && (
                <div className="flex gap-6 text-xs font-mono text-terminal-muted">
                  {Object.entries(claude.heuristic).map(([k, v]) => (
                    <span key={k}>{k}: <span className="text-terminal-text">{String(v)}</span></span>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-col gap-1">
              <p className="text-terminal-muted text-sm font-medium">AI effectiveness analytics warming up</p>
              <p className="text-terminal-muted/60 text-xs leading-relaxed">
                Requires 30+ resolved signals to compare Claude vs. heuristic performance. Both validation paths are already being logged — this section will populate automatically as signals resolve.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Verdict distribution */}
      {Object.keys(verdicts).length > 0 && (
        <div>
          <p className="text-terminal-muted text-xs uppercase tracking-wider mb-3">Verdict Distribution (24h)</p>
          <div className="glass-card rounded-lg p-5 space-y-2.5">
            {Object.entries(verdicts)
              .sort(([, a], [, b]) => b - a)
              .map(([label, count]) => (
                <VerdictBar key={label} label={label} count={count} total={totalVerd} />
              ))}
          </div>
        </div>
      )}

      {/* Latency */}
      {ai?.avg_latency_ms != null && (
        <div>
          <p className="text-terminal-muted text-xs uppercase tracking-wider mb-3">API Performance</p>
          <div className="glass-card rounded-lg px-5 py-4 flex items-center gap-8">
            <div>
              <p className="text-terminal-muted text-xs uppercase tracking-wider mb-1">Avg Latency</p>
              <p className={`font-mono font-bold text-2xl ${ai.avg_latency_ms > 5000 ? 'text-signal-high' : 'text-bull-default'}`}>
                {ai.avg_latency_ms < 1000
                  ? `${ai.avg_latency_ms.toFixed(0)}ms`
                  : `${(ai.avg_latency_ms / 1000).toFixed(1)}s`}
              </p>
            </div>
            <div>
              <p className="text-terminal-muted text-xs uppercase tracking-wider mb-1">Window</p>
              <p className="font-mono text-terminal-text text-lg">{ai.window_hours}h</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
