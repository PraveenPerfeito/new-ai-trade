'use client'

import { useCallback } from 'react'
import { adminApi, AiSummaryResponse } from '@/lib/admin-api'
import { useAutoRefresh } from '@/lib/use-auto-refresh'
import { Brain } from 'lucide-react'

function pct(v: number | null | undefined, d = 1) {
  return v != null ? `${(v * 100).toFixed(d)}%` : '—'
}

function VerdictBar({ label, count, total }: { label: string; count: number; total: number }) {
  const w = total > 0 ? (count / total) * 100 : 0
  const isGood = label === 'claude_adds_value'
  return (
    <div className="flex items-center gap-3">
      <span className="text-zinc-500 text-xs font-mono w-48 truncate capitalize">
        {label.replace(/_/g, ' ')}
      </span>
      <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${isGood ? 'bg-green-500' : 'bg-zinc-600'}`}
          style={{ width: `${w}%` }}
        />
      </div>
      <span className="font-mono text-xs text-white w-12 text-right">{count}</span>
      <span className="font-mono text-xs text-zinc-500 w-12 text-right">{w.toFixed(0)}%</span>
    </div>
  )
}

function StatCard({ label, value, sub, accent = 'default' }: {
  label: string; value: string | number; sub?: string
  accent?: 'good' | 'warn' | 'bad' | 'default'
}) {
  const colors = {
    good:    'text-green-400',
    warn:    'text-amber-400',
    bad:     'text-red-400',
    default: 'text-white',
  }
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
      <div className="text-xs text-zinc-500 mb-1">{label}</div>
      <div className={`text-xl font-bold ${colors[accent]}`}>{value}</div>
      {sub && <div className="text-xs text-zinc-600 mt-0.5">{sub}</div>}
    </div>
  )
}

const CONFIDENCE_THRESHOLDS = [
  { tier: 'High', range: '85–100%', description: 'Strong multi-timeframe confirmation, A/B grade risk', color: 'text-green-400' },
  { tier: 'Med-High', range: '75–84%', description: 'Standard qualification, at least 4/5 indicators aligned', color: 'text-blue-400' },
  { tier: 'Medium', range: '70–74%', description: 'Minimum for high_confidence mode, all other modes filtered', color: 'text-amber-400' },
  { tier: 'Low', range: '< 70%', description: 'Rejected — insufficient confirmation', color: 'text-red-400' },
]

export default function CalibrationPage() {
  // AI diagnostics only — Claude calls, latency, errors, verdict distribution.
  // Heavy metrics (AI calls count, cost, confidence bands, Claude effectiveness)
  // live on the System page and Analytics page respectively.
  const aiFetcher = useCallback(() => adminApi.analytics.ai(24), [])
  const { data: ai, loading: ail } = useAutoRefresh<AiSummaryResponse>(aiFetcher, 120_000)

  const verdicts  = ai?.verdicts ?? (ai as any)?.verdict_distribution ?? {}
  const totalVerd = Object.values(verdicts as Record<string, number>).reduce((a: number, b: number) => a + b, 0)
  const hasAiData = (ai?.total_calls ?? 0) > 0

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">

      <div className="flex items-center gap-3">
        <Brain className="w-6 h-6 text-blue-400" />
        <div>
          <h1 className="text-xl font-semibold text-white">AI Calibration</h1>
          <p className="text-sm text-zinc-400">
            Claude API diagnostics — 24h · toggle AI on Scanner page
          </p>
        </div>
      </div>

      {/* Warmup banner */}
      {!ail && !hasAiData && (
        <div className="rounded-xl px-5 py-4 bg-amber-500/5 border border-amber-500/20 flex items-start gap-3">
          <Brain className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-300 text-sm font-semibold">AI telemetry warming up</p>
            <p className="text-zinc-500 text-xs mt-1 leading-relaxed">
              No Claude API calls logged yet. Run a scan to populate calibration data.
            </p>
          </div>
        </div>
      )}

      {/* ── API Health ── */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <StatCard
          label="Success Rate"
          value={pct(ai?.success_rate)}
          sub="API calls OK (24h)"
          accent={ai?.success_rate != null ? (ai.success_rate >= 0.9 ? 'good' : ai.success_rate >= 0.7 ? 'warn' : 'bad') : 'default'}
        />
        <StatCard
          label="Avg Latency"
          value={ai?.avg_latency_ms != null ? `${ai.avg_latency_ms.toFixed(0)}ms` : '—'}
          sub="per call"
          accent={ai?.avg_latency_ms != null ? (ai.avg_latency_ms < 2000 ? 'good' : 'warn') : 'default'}
        />
        <StatCard
          label="Last Error"
          value={ai?.last_error ? 'See logs' : 'None'}
          sub={ai?.last_error ? ai.last_error.slice(0, 40) : 'All calls clean'}
          accent={ai?.last_error ? 'bad' : 'good'}
        />
      </div>

      {/* ── Verdict Distribution ── */}
      {totalVerd > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
          <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-4">
            Verdict Distribution — {totalVerd} calls (24h)
          </h2>
          <div className="space-y-3">
            {Object.entries(verdicts as Record<string, number>).map(([k, v]) => (
              <VerdictBar key={k} label={k} count={v} total={totalVerd} />
            ))}
          </div>
        </div>
      )}

      {/* ── Confidence Tier Reference ── */}
      <div className="pt-2">
        <p className="text-[9px] text-zinc-600 uppercase tracking-widest mb-3 flex items-center gap-2">
          <span className="h-px flex-1 bg-zinc-800" />Confidence Tiers — Reference<span className="h-px flex-1 bg-zinc-800" />
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {CONFIDENCE_THRESHOLDS.map((t) => (
            <div key={t.tier} className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2.5">
              <p className={`text-sm font-bold mb-0.5 ${t.color}`}>{t.tier}</p>
              <p className="text-zinc-400 font-mono text-xs">{t.range}</p>
              <p className="text-zinc-600 text-[10px] mt-1 leading-snug hidden sm:block">{t.description}</p>
            </div>
          ))}
        </div>
        <p className="text-zinc-700 text-[10px] mt-2">
          Full confidence calibration bands and Claude effectiveness: Analytics → Edge Validation tab
        </p>
      </div>
    </div>
  )
}
