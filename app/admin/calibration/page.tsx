'use client'

import { useCallback, useEffect, useState } from 'react'
import { adminApi, AiSummaryResponse, EdgeReport } from '@/lib/admin-api'
import { useAutoRefresh } from '@/lib/use-auto-refresh'
import { Brain, Zap, AlertTriangle, CheckCircle, Power } from 'lucide-react'

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
  const aiFetcher   = useCallback(() => adminApi.analytics.ai(24), [])
  const edgeFetcher = useCallback(() => adminApi.analytics.edgeReport(), [])

  const { data: ai, loading: ail }  = useAutoRefresh<AiSummaryResponse>(aiFetcher, 30_000)
  const { data: edge, loading: el } = useAutoRefresh<EdgeReport>(edgeFetcher, 120_000)

  const claude    = edge?.claude_effectiveness
  const verdicts  = ai?.verdicts ?? (ai as any)?.verdict_distribution ?? {}
  const totalVerd = Object.values(verdicts as Record<string, number>).reduce((a, b) => a + b, 0)
  const hasAiData = (ai?.total_calls ?? 0) > 0

  // ── AI enable/disable toggle ──────────────────────────────────────────────
  const [aiEnabled, setAiEnabled] = useState<boolean | null>(null)
  const [toggling, setToggling]   = useState(false)

  useEffect(() => {
    adminApi.settings.group('ai')
      .then(g => {
        const field = g.fields?.find((f: { key: string }) => f.key === 'enabled')
        setAiEnabled((field as any)?.value !== false)
      })
      .catch(() => setAiEnabled(true))
  }, [])

  const toggleAi = async () => {
    if (aiEnabled === null || toggling) return
    setToggling(true)
    try {
      await adminApi.settings.patch('ai', { enabled: !aiEnabled })
      setAiEnabled(!aiEnabled)
    } catch (e) {
      console.error('Failed to toggle AI', e)
    } finally {
      setToggling(false)
    }
  }

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">

      <div className="flex items-center gap-3">
        <Brain className="w-6 h-6 text-blue-400" />
        <div>
          <h1 className="text-xl font-semibold text-white">Calibration</h1>
          <p className="text-sm text-zinc-400">AI effectiveness · confidence thresholds · edge report</p>
        </div>
      </div>

      {/* ── Claude API master toggle ── */}
      <div className={`rounded-xl px-5 py-4 border flex items-center gap-4 ${
        aiEnabled === false
          ? 'bg-red-500/5 border-red-500/25'
          : 'bg-zinc-900 border-zinc-800'
      }`}>
        <Power className={`w-5 h-5 shrink-0 ${aiEnabled === false ? 'text-red-400' : 'text-green-400'}`} />
        <div className="flex-1">
          <p className={`text-sm font-semibold ${aiEnabled === false ? 'text-red-300' : 'text-white'}`}>
            Claude AI Validation — {aiEnabled === null ? '...' : aiEnabled ? 'ENABLED' : 'DISABLED'}
          </p>
          <p className="text-xs text-zinc-500 mt-0.5">
            {aiEnabled === false
              ? 'Disabled — scanner uses heuristic scoring only. Re-enable when API credits are available.'
              : 'Enabled — each signal is validated by Claude Haiku. Disable to conserve API credits.'}
          </p>
        </div>
        <button
          onClick={toggleAi}
          disabled={toggling || aiEnabled === null}
          className={`text-xs font-semibold px-4 py-2 rounded-lg border transition-all disabled:opacity-40 ${
            aiEnabled === false
              ? 'bg-green-500/15 border-green-500/30 text-green-300 hover:bg-green-500/25'
              : 'bg-red-500/15 border-red-500/30 text-red-300 hover:bg-red-500/25'
          }`}
        >
          {toggling ? '...' : aiEnabled === false ? '▶ Enable Claude' : '⏸ Disable Claude'}
        </button>
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

      {/* ── SECTION: CURRENT STATE ── */}
      <p className="text-[9px] text-zinc-600 uppercase tracking-widest flex items-center gap-2 pt-1">
        <span className="h-px flex-1 bg-zinc-800" />Current State<span className="h-px flex-1 bg-zinc-800" />
      </p>

      {/* Key metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="Total AI Calls"
          value={ai?.total_calls ?? 0}
          sub="last 24h"
        />
        <StatCard
          label="Success Rate"
          value={pct(ai?.success_rate)}
          sub="API calls OK"
          accent={ai?.success_rate != null ? (ai.success_rate >= 0.9 ? 'good' : ai.success_rate >= 0.7 ? 'warn' : 'bad') : 'default'}
        />
        <StatCard
          label="Avg Latency"
          value={ai?.avg_latency_ms != null ? `${ai.avg_latency_ms.toFixed(0)}ms` : '—'}
          sub="per call"
          accent={ai?.avg_latency_ms != null ? (ai.avg_latency_ms < 2000 ? 'good' : 'warn') : 'default'}
        />
        <StatCard
          label="Error Rate"
          value={pct(ai?.error_rate)}
          sub="fallback rate"
          accent={ai?.error_rate != null ? (ai.error_rate < 0.1 ? 'good' : ai.error_rate < 0.3 ? 'warn' : 'bad') : 'default'}
        />
      </div>

      {/* Validation source breakdown — Phase 7.2B.9 */}
      {hasAiData && (
        <div className="grid grid-cols-2 gap-3">
          <StatCard
            label="🤖 Claude Validated"
            value={ai?.claude_calls ?? 0}
            sub="Anthropic API calls"
            accent="good"
          />
          <StatCard
            label="⚡ Heuristic Validated"
            value={ai?.heuristic_calls ?? 0}
            sub="Claude OFF or low score"
            accent={(ai?.fallback_rate ?? 0) > 0.5 ? 'warn' : 'default'}
          />
        </div>
      )}

      {/* ── SECTION: PERFORMANCE ── */}
      <p className="text-[9px] text-zinc-600 uppercase tracking-widest flex items-center gap-2 pt-1">
        <span className="h-px flex-1 bg-zinc-800" />Performance<span className="h-px flex-1 bg-zinc-800" />
      </p>

      {/* Verdict distribution */}
      {totalVerd > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
          <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-4">Verdict Distribution</h2>
          <div className="space-y-3">
            {Object.entries(verdicts as Record<string, number>).map(([k, v]) => (
              <VerdictBar key={k} label={k} count={v} total={totalVerd} />
            ))}
          </div>
        </div>
      )}

      {/* Claude effectiveness */}
      {claude && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
          <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-4">Claude Effectiveness</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {[
              { label: 'Signals Logged', value: claude.total_with_ai_log },
              { label: 'Verdict',        value: claude.verdict?.replace(/_/g, ' ') ?? '—' },
              ...Object.entries(claude.heuristic ?? {}).map(([k, v]) => ({ label: k.replace(/_/g, ' '), value: String(v) })),
            ].map(({ label, value }) => (
              <div key={label}>
                <div className="text-xs text-zinc-500 mb-0.5 capitalize">{label}</div>
                <div className="text-sm font-semibold text-white capitalize">{value}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── SECTION: HISTORICAL PERFORMANCE ── */}
      <div className="pt-2">
        <p className="text-[9px] text-zinc-600 uppercase tracking-widest mb-3 flex items-center gap-2">
          <span className="h-px flex-1 bg-zinc-800" />Historical Performance<span className="h-px flex-1 bg-zinc-800" />
        </p>

        {/* Live confidence bands */}
        {edge?.confidence_calibration?.bands && edge.confidence_calibration.bands.length > 0 ? (
          <div className="space-y-1.5">
            {edge.confidence_calibration.bands.map((b) => (
              <div key={b.label} className="bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-2.5 flex items-center gap-3">
                <span className="text-zinc-300 font-mono text-xs w-16 shrink-0">{b.label}</span>
                <span className="text-zinc-500 text-xs w-12 shrink-0">{b.total} sig</span>
                <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                  {!b.insufficient_data && b.win_rate != null && (
                    <div className="h-full rounded-full transition-all"
                      style={{
                        width: `${(b.win_rate * 100).toFixed(0)}%`,
                        backgroundColor: b.win_rate >= 0.6 ? '#22c55e' : b.win_rate >= 0.5 ? '#f59e0b' : '#ef4444',
                      }} />
                  )}
                </div>
                <span className={`text-xs font-mono font-semibold w-12 text-right shrink-0 ${
                  b.insufficient_data || b.win_rate == null ? 'text-zinc-600' :
                  b.win_rate >= 0.6 ? 'text-green-400' : b.win_rate >= 0.5 ? 'text-amber-400' : 'text-red-400'
                }`}>
                  {b.insufficient_data || b.win_rate == null ? '—' : `${(b.win_rate * 100).toFixed(1)}%`}
                </span>
                <span className="text-zinc-600 font-mono text-xs w-14 text-right shrink-0 hidden sm:block">
                  {b.expectancy != null ? `${b.expectancy > 0 ? '+' : ''}${b.expectancy.toFixed(2)}R` : '—'}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-zinc-600 text-xs">No resolved signals yet — run scans to populate confidence performance.</p>
        )}
      </div>

      {/* ── SECTION: REFERENCE ── */}
      <div className="pt-2">
        <p className="text-[9px] text-zinc-600 uppercase tracking-widest mb-3 flex items-center gap-2">
          <span className="h-px flex-1 bg-zinc-800" />Confidence Tiers<span className="h-px flex-1 bg-zinc-800" />
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
      </div>
    </div>
  )
}
