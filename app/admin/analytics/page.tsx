'use client'

import { useCallback, useState, useEffect } from 'react'
import { adminApi, EdgeReport, IntelligenceSummary, IntelligencePerfRow } from '@/lib/admin-api'
import { useAutoRefresh } from '@/lib/use-auto-refresh'
import { formatTs } from '@/lib/utils'
import { analyticsWindowLabel, explicitWindowNote } from '@/lib/window-label'
import type { AttributionReport, AttributionDimension, EdgePattern, ThresholdRecommendation } from '@/types'

// ─── Shared primitives ────────────────────────────────────────────────────────

function StatPair({ label, value, accent = '' }: { label: string; value: string; accent?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-terminal-muted text-xs uppercase tracking-wider">{label}</span>
      <span className={`font-mono font-bold text-lg ${accent || 'text-terminal-text'}`}>{value}</span>
    </div>
  )
}

function pct(n: number | null): string {
  return n != null ? `${(n * 100).toFixed(1)}%` : '—'
}
function exp(n: number | null): string {
  if (n == null) return '—'
  return n > 0 ? `+${n.toFixed(2)}R` : `${n.toFixed(2)}R`
}
function rr(n: number | null): string {
  return n != null ? `${n.toFixed(2)}R` : '—'
}

// ─── Edge Validation tab ──────────────────────────────────────────────────────

function CalibrationTable({ bands }: { bands: EdgeReport['confidence_calibration']['bands'] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs min-w-[380px]">
        <thead>
          <tr className="border-b border-terminal-border">
            <th className="text-terminal-muted text-xs uppercase tracking-wider text-left py-2 px-3 font-semibold">Band</th>
            <th className="text-terminal-muted text-xs uppercase tracking-wider text-left py-2 px-3 font-semibold">Signals</th>
            <th className="text-terminal-muted text-xs uppercase tracking-wider text-left py-2 px-3 font-semibold">Win Rate</th>
            <th className="text-terminal-muted text-xs uppercase tracking-wider text-left py-2 px-3 font-semibold hidden sm:table-cell">Expectancy</th>
            <th className="text-terminal-muted text-xs uppercase tracking-wider text-left py-2 px-3 font-semibold">Status</th>
          </tr>
        </thead>
        <tbody>
          {bands.map(b => (
            <tr key={b.label} className="border-b border-terminal-border/30 hover:bg-terminal-bright/10">
              <td className="py-2.5 px-3 font-mono text-terminal-text">{b.label}</td>
              <td className="py-2.5 px-3 font-mono text-terminal-muted">{b.total}</td>
              <td className="py-2.5 px-3 font-mono">
                {b.insufficient_data || b.win_rate == null
                  ? <span className="text-terminal-muted/40">—</span>
                  : <span className={b.win_rate >= 0.55 ? 'text-bull-default' : 'text-bear-default'}>
                      {(b.win_rate * 100).toFixed(1)}%
                    </span>
                }
              </td>
              <td className="py-2.5 px-3 font-mono hidden sm:table-cell">
                {b.insufficient_data || b.expectancy == null
                  ? <span className="text-terminal-muted/40">—</span>
                  : <span className={b.expectancy > 0 ? 'text-bull-default' : 'text-bear-default'}>
                      {b.expectancy > 0 ? '+' : ''}{b.expectancy.toFixed(2)}R
                    </span>
                }
              </td>
              <td className="py-2.5 px-3">
                {b.insufficient_data
                  ? <span className="text-[10px] text-terminal-muted/40 border border-terminal-border rounded px-1.5 py-0.5">WARMING</span>
                  : <span className="text-[10px] text-bull-default/70 border border-bull-default/20 rounded px-1.5 py-0.5">OK</span>
                }
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── Intelligence Performance section ────────────────────────────────────────

function IntelRow({ label, row }: { label: string; row: IntelligencePerfRow | null }) {
  if (!row) return (
    <div className="flex items-center justify-between py-2 border-b border-terminal-border/20 last:border-0">
      <span className="text-terminal-muted text-xs w-44 shrink-0">{label}</span>
      <span className="text-terminal-muted/40 text-xs font-mono">no data</span>
    </div>
  )
  const wr = row.win_rate
  return (
    <div className="flex items-center justify-between py-2 border-b border-terminal-border/20 last:border-0 gap-2 flex-wrap">
      <span className="text-terminal-muted text-xs w-44 shrink-0">{label}</span>
      <span className="text-terminal-text text-xs font-medium flex-1 min-w-0 truncate">{row.label}</span>
      <div className="flex items-center gap-4 shrink-0">
        <span className={`font-mono text-xs font-bold ${wr != null && wr >= 0.4 ? 'text-bull-default' : wr != null && wr >= 0.3 ? 'text-signal-high' : 'text-bear-default'}`}>
          {wr != null ? `${(wr * 100).toFixed(1)}%` : '—'}
        </span>
        <span className="text-terminal-muted text-xs font-mono">
          {row.avg_rr != null ? `${row.avg_rr.toFixed(2)}R` : '—'}
        </span>
        <span className="text-terminal-muted/50 text-xs font-mono">n={row.n}</span>
      </div>
    </div>
  )
}

function IntelligenceSection({ data, loading }: { data: IntelligenceSummary | null; loading: boolean }) {
  if (loading) return (
    <div className="glass-card rounded-lg p-5">
      <p className="text-terminal-muted text-xs uppercase tracking-wider mb-3">Intelligence Performance</p>
      <div className="space-y-2">{Array.from({ length: 7 }).map((_, i) => <div key={i} className="skeleton h-7 rounded" />)}</div>
    </div>
  )
  if (!data || data.insufficient_data) return (
    <div className="glass-card rounded-lg p-5">
      <p className="text-terminal-muted text-xs uppercase tracking-wider mb-2">Intelligence Performance</p>
      <p className="text-terminal-muted/60 text-xs leading-relaxed">
        Intelligence breakdowns require at least 5 resolved outcomes per tier. Warming up — data populates as signals resolve.
        {data && ` Total resolved: ${data.total}.`}
      </p>
    </div>
  )
  return (
    <div>
      <p className="text-terminal-muted text-xs uppercase tracking-wider mb-3">Intelligence Performance — Best Tier per Dimension</p>
      <div className="glass-card rounded-lg p-5">
        <div className="flex items-center gap-4 mb-4 text-terminal-muted/50 text-[10px] font-mono uppercase tracking-wider">
          <span className="w-44 shrink-0">Dimension</span>
          <span className="flex-1">Best Value</span>
          <span className="w-12 text-right">Win Rate</span>
          <span className="w-12 text-right">Avg RR</span>
          <span className="w-12 text-right">n</span>
        </div>
        <IntelRow label="TrendScore Tier"     row={data.best_trend_score_tier} />
        <IntelRow label="Sector Status"        row={data.best_sector_status} />
        <IntelRow label="Breakout Type"        row={data.best_breakout_type} />
        <IntelRow label="Breakout Strength"    row={data.best_breakout_strength} />
        <IntelRow label="OI Interpretation"    row={data.best_oi_interpretation} />
        <IntelRow label="Funding Trend"        row={data.best_funding_trend} />
        <IntelRow label="Positioning Context"  row={data.best_positioning_context} />
        <p className="text-terminal-muted/30 text-xs font-mono mt-4 pt-3 border-t border-terminal-border/20">
          {data.total} resolved - {explicitWindowNote(data.window_hours)} - min 5 signals/tier
        </p>
      </div>
    </div>
  )
}

function EdgeValidationTab({ edge, loading, intel, intelLoading }: {
  edge: EdgeReport | null; loading: boolean
  intel: IntelligenceSummary | null; intelLoading: boolean
}) {
  const overall = edge?.overall
  const verdict = edge?.edge_verdict
  const cal     = edge?.confidence_calibration

  const confidenceLevelColor: Record<string, string> = {
    strong: 'text-bull-default', moderate: 'text-signal-high', weak: 'text-signal-medium',
    none: 'text-bear-default', insufficient_data: 'text-terminal-muted',
  }

  return (
    <div className="space-y-6">
      {/* Edge verdict */}
      <div className="glass-card rounded-lg p-5">
        <p className="text-terminal-muted text-xs uppercase tracking-wider mb-4">Edge Verdict</p>
        {loading ? (
          <div className="space-y-2">
            <div className="skeleton h-6 w-48 rounded" />
            <div className="skeleton h-3 w-full rounded" />
          </div>
        ) : verdict?.confidence_level === 'insufficient_data' || !verdict ? (
          <div className="flex flex-col gap-2">
            <p className="text-signal-medium text-sm font-semibold">◌ Edge analytics warming up</p>
            <p className="text-terminal-muted text-xs leading-relaxed">
              Statistical edge verdicts require a minimum of 30 resolved signals (TP hit, SL hit, or timeout). Keep running scans — outcomes are resolved automatically as price reaches target or stop levels.
            </p>
            {edge && (
              <p className="text-terminal-muted/50 text-xs font-mono mt-1">
                {explicitWindowNote(edge.window_hours)} - Total signals tracked: {edge.overall?.total ?? 0}
              </p>
            )}
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3 mb-3 flex-wrap">
              <span className={`font-mono font-bold text-xl uppercase ${confidenceLevelColor[verdict.confidence_level]}`}>
                {verdict.confidence_level.replace(/_/g, ' ')}
              </span>
              {verdict.has_edge != null && (
                <span className={`text-xs px-2 py-0.5 rounded border font-bold uppercase ${
                  verdict.has_edge ? 'bg-bull-default/10 text-bull-default border-bull-default/20' : 'bg-bear-default/10 text-bear-default border-bear-default/20'
                }`}>
                  {verdict.has_edge ? 'EDGE CONFIRMED' : 'NO EDGE'}
                </span>
              )}
            </div>
            <p className="text-terminal-muted text-xs">{verdict.summary}</p>
          </>
        )}
      </div>

      {/* Overall stats */}
      <div>
        <p className="text-terminal-muted text-xs uppercase tracking-wider mb-3">
          Overall Statistics - {analyticsWindowLabel(edge?.window_hours ?? 720)}
        </p>
        <div className="glass-card rounded-lg p-5">
          {loading ? (
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="space-y-1">
                  <div className="skeleton h-2.5 w-16 rounded" />
                  <div className="skeleton h-6 w-12 rounded" />
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-4">
              <StatPair label="Signals"      value={String(overall?.total ?? 0)} />
              <StatPair label="Win Rate"     value={overall?.win_rate != null ? `${(overall.win_rate * 100).toFixed(1)}%` : '—'} accent={overall?.win_rate && overall.win_rate >= 0.55 ? 'text-bull-default' : 'text-bear-default'} />
              <StatPair label="Expectancy"   value={overall?.expectancy != null ? `${overall.expectancy > 0 ? '+' : ''}${overall.expectancy.toFixed(2)}R` : '—'} accent={overall?.expectancy && overall.expectancy > 0 ? 'text-bull-default' : 'text-bear-default'} />
              <StatPair label="Profit Factor" value={overall?.profit_factor?.toFixed(2) ?? '—'} accent={overall?.profit_factor && overall.profit_factor >= 1.5 ? 'text-bull-default' : 'text-terminal-text'} />
              <StatPair label="Max DD"       value={overall?.max_drawdown_r != null ? `${overall.max_drawdown_r.toFixed(1)}R` : '—'} accent="text-bear-default" />
              <StatPair label="Sharpe"       value={overall?.sharpe?.toFixed(2) ?? '—'} accent={overall?.sharpe && overall.sharpe > 1 ? 'text-bull-default' : 'text-terminal-text'} />
            </div>
          )}
          {!loading && (!overall || overall.total === 0) && (
            <p className="text-terminal-muted/50 text-xs mt-4 pt-4 border-t border-terminal-border/50">
              No resolved signals yet — statistics will appear after signals reach their TP / SL targets.
            </p>
          )}
          {overall && overall.total > 0 && (
            <div className="mt-4 pt-4 border-t border-terminal-border/50 flex gap-6 text-xs font-mono text-terminal-muted">
              <span>TP: <span className="text-bull-default">{overall.tp_hits}</span></span>
              <span>SL: <span className="text-bear-default">{overall.sl_hits}</span></span>
              <span>TO: <span className="text-terminal-text">{overall.timeouts}</span></span>
              {overall.win_rate_ci && (
                <span>95% CI: [{(overall.win_rate_ci[0] * 100).toFixed(1)}%, {(overall.win_rate_ci[1] * 100).toFixed(1)}%]</span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Calibration */}
      {!loading && (!cal || !cal.calibration) && (
        <div className="glass-card rounded-lg p-5">
          <p className="text-terminal-muted text-xs uppercase tracking-wider mb-3">Confidence Calibration</p>
          <p className="text-terminal-muted/60 text-xs leading-relaxed">
            Calibration bands require resolved signals across multiple confidence tiers (70–100). Run scans in different modes to build a diverse signal pool.
          </p>
        </div>
      )}
      {cal && cal.calibration && (
        <div>
          <p className="text-terminal-muted text-xs uppercase tracking-wider mb-3">Confidence Calibration</p>
          <div className="glass-card rounded-lg overflow-hidden">
            <div className="px-5 py-3 border-b border-terminal-border flex items-center gap-4 flex-wrap">
              <span className="text-terminal-muted text-xs">ECE:</span>
              <span className={`font-mono text-sm font-bold ${cal.calibration.ece < 0.05 ? 'text-bull-default' : cal.calibration.ece < 0.12 ? 'text-signal-high' : 'text-bear-default'}`}>
                {cal.calibration.ece.toFixed(4)}
              </span>
              <span className="text-terminal-muted text-xs">Label:</span>
              <span className="text-terminal-text text-xs font-mono">{cal.calibration.label.replace(/_/g, ' ')}</span>
              <span className="text-terminal-muted text-xs">Monotone:</span>
              <span className={`text-xs font-mono ${cal.calibration.is_monotone ? 'text-bull-default' : 'text-bear-default'}`}>
                {cal.calibration.is_monotone === null ? '—' : cal.calibration.is_monotone ? 'yes' : 'no'}
              </span>
              {cal.optimal_threshold != null && (
                <>
                  <span className="text-terminal-muted text-xs">Optimal threshold:</span>
                  <span className="text-signal-high font-mono text-xs">{cal.optimal_threshold}</span>
                </>
              )}
            </div>
            <CalibrationTable bands={cal.bands} />
          </div>
        </div>
      )}

      {/* Intelligence Performance */}
      <IntelligenceSection data={intel} loading={intelLoading} />

      {edge && (
        <p className="text-terminal-muted/40 text-xs font-mono">
          Generated {formatTs(edge.generated_at)} - {explicitWindowNote(edge.window_hours)}
        </p>
      )}
    </div>
  )
}

// ─── Attribution tab ──────────────────────────────────────────────────────────

function DimTable({ title, rows }: { title: string; rows: AttributionDimension[] }) {
  if (!rows.length) return null
  return (
    <div>
      <p className="text-terminal-muted text-xs uppercase tracking-wider mb-2">{title}</p>
      <div className="glass-card rounded-lg overflow-hidden overflow-x-auto">
        <table className="w-full text-xs min-w-[320px]">
          <thead>
            <tr className="border-b border-terminal-border">
              <th className="text-terminal-muted text-xs uppercase tracking-wider text-left py-2 px-3 font-semibold">Dimension</th>
              <th className="text-terminal-muted text-xs uppercase tracking-wider text-left py-2 px-3 font-semibold">Signals</th>
              <th className="text-terminal-muted text-xs uppercase tracking-wider text-left py-2 px-3 font-semibold">Win Rate</th>
              <th className="text-terminal-muted text-xs uppercase tracking-wider text-left py-2 px-3 font-semibold hidden sm:table-cell">Avg RR</th>
              <th className="text-terminal-muted text-xs uppercase tracking-wider text-left py-2 px-3 font-semibold hidden sm:table-cell">Expectancy</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(d => (
              <tr key={d.key} className="border-b border-terminal-border/30 hover:bg-terminal-bright/10">
                <td className="py-2 px-3 text-terminal-text font-medium">{d.label}</td>
                <td className="py-2 px-3 font-mono text-terminal-muted">{d.total}</td>
                <td className="py-2 px-3 font-mono">
                  {d.winRate != null
                    ? <span className={d.winRate >= 0.55 ? 'text-bull-default' : d.winRate >= 0.45 ? 'text-signal-high' : 'text-bear-default'}>{pct(d.winRate)}</span>
                    : <span className="text-terminal-muted/40">—</span>
                  }
                </td>
                <td className="py-2 px-3 font-mono text-terminal-muted hidden sm:table-cell">{rr(d.avgRRAchieved)}</td>
                <td className="py-2 px-3 font-mono hidden sm:table-cell">
                  {d.expectancy != null
                    ? <span className={d.expectancy > 0 ? 'text-bull-default' : 'text-bear-default'}>{exp(d.expectancy)}</span>
                    : <span className="text-terminal-muted/40">—</span>
                  }
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function EdgePatternsSection({ patterns }: { patterns: EdgePattern[] }) {
  if (!patterns.length) return null
  return (
    <div>
      <p className="text-terminal-muted text-xs uppercase tracking-wider mb-2">Top Edge Patterns</p>
      <div className="glass-card rounded-lg overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-terminal-border">
              {['Rank', 'Pattern', 'Signals', 'Win Rate', 'Avg RR', 'Expectancy'].map(h => (
                <th key={h} className="text-terminal-muted text-xs uppercase tracking-wider text-left py-2 px-3 font-semibold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {patterns.map(p => (
              <tr key={p.rank} className="border-b border-terminal-border/30 hover:bg-terminal-bright/10">
                <td className="py-2 px-3 font-mono text-terminal-muted">#{p.rank}</td>
                <td className="py-2 px-3 text-terminal-text font-medium">{p.label}</td>
                <td className="py-2 px-3 font-mono text-terminal-muted">{p.total}</td>
                <td className="py-2 px-3 font-mono">
                  <span className={p.winRate >= 0.55 ? 'text-bull-default' : p.winRate >= 0.45 ? 'text-signal-high' : 'text-bear-default'}>
                    {pct(p.winRate)}
                  </span>
                </td>
                <td className="py-2 px-3 font-mono text-terminal-muted">{rr(p.avgRRAchieved)}</td>
                <td className="py-2 px-3 font-mono">
                  <span className={p.expectancy > 0 ? 'text-bull-default' : 'text-bear-default'}>{exp(p.expectancy)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const impactColor: Record<string, string> = {
  HIGH: 'text-bear-default border-bear-default/30',
  MEDIUM: 'text-signal-high border-signal-high/30',
  LOW: 'text-terminal-muted border-terminal-border',
}
const dirIcon: Record<string, string> = { RAISE: '↑', LOWER: '↓', MONITOR: '◎' }

function RecommendationsSection({ recs }: { recs: ThresholdRecommendation[] }) {
  return (
    <div>
      <p className="text-terminal-muted text-xs uppercase tracking-wider mb-2">Calibration Intelligence</p>
      <div className="space-y-2">
        {recs.map((r, i) => (
          <div key={i} className="glass-card rounded-lg p-4">
            <div className="flex items-start gap-3">
              <span className={`text-xs font-mono font-bold px-1.5 py-0.5 rounded border mt-0.5 shrink-0 ${impactColor[r.impact]}`}>
                {dirIcon[r.direction]} {r.impact}
              </span>
              <div className="min-w-0">
                <p className="text-terminal-text text-xs font-semibold mb-0.5">{r.parameter}</p>
                <p className="text-terminal-muted text-xs leading-relaxed">{r.insight}</p>
                <p className="text-terminal-muted/50 text-xs mt-1 font-mono">{r.basis}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function AIEffectivenessSection({ ai }: { ai: AttributionReport['aiEffectiveness'] }) {
  const { aiApproved, heuristic, aiEdgeDelta } = ai
  return (
    <div>
      <p className="text-terminal-muted text-xs uppercase tracking-wider mb-2">AI vs Heuristic Effectiveness</p>
      <div className="glass-card rounded-lg p-5">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-5">
          <div className="space-y-1">
            <p className="text-terminal-muted text-xs">AI Signals</p>
            <p className="font-mono font-bold text-terminal-text">{aiApproved.total}</p>
          </div>
          <div className="space-y-1">
            <p className="text-terminal-muted text-xs">AI Win Rate</p>
            <p className={`font-mono font-bold ${aiApproved.winRate != null && aiApproved.winRate >= 0.55 ? 'text-bull-default' : 'text-terminal-text'}`}>
              {pct(aiApproved.winRate)}
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-terminal-muted text-xs">Heuristic Signals</p>
            <p className="font-mono font-bold text-terminal-text">{heuristic.total}</p>
          </div>
          <div className="space-y-1">
            <p className="text-terminal-muted text-xs">Heuristic Win Rate</p>
            <p className={`font-mono font-bold ${heuristic.winRate != null && heuristic.winRate >= 0.55 ? 'text-bull-default' : 'text-terminal-text'}`}>
              {pct(heuristic.winRate)}
            </p>
          </div>
        </div>
        {aiEdgeDelta != null && aiApproved.total >= 5 && heuristic.total >= 5 && (
          <div className="mt-4 pt-4 border-t border-terminal-border/50">
            <span className={`text-xs font-mono font-bold ${aiEdgeDelta > 0 ? 'text-bull-default' : 'text-bear-default'}`}>
              {aiEdgeDelta > 0 ? '▲' : '▼'} AI {aiEdgeDelta > 0 ? '+' : ''}{(aiEdgeDelta * 100).toFixed(1)}% vs heuristic
            </span>
            <span className="text-terminal-muted/50 text-xs ml-3">
              {aiEdgeDelta > 0.05 ? 'AI validation adding measurable edge' : aiEdgeDelta < -0.05 ? 'Heuristic outperforming — review AI prompt' : 'No significant difference'}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

function DailyReportTrigger() {
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  async function trigger() {
    setSending(true)
    setResult(null)
    try {
      const res = await fetch('/api/analytics/daily-report', { method: 'POST', cache: 'no-store' })
      const json = await res.json()
      setResult(json.success ? `Sent (${json.dataRows ?? 0} resolved signals)` : `Failed: ${json.error ?? 'unknown error'}`)
    } catch {
      setResult('Network error — could not trigger report')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="glass-card rounded-lg p-5">
      <p className="text-terminal-muted text-xs uppercase tracking-wider mb-3">Founder Daily Report</p>
      <p className="text-terminal-muted text-xs mb-4 leading-relaxed">
        Sends a Telegram message with 24h regime performance, top edge pattern, AI vs heuristic breakdown, and calibration alerts.
      </p>
      <div className="flex items-center gap-4 flex-wrap">
        <button
          onClick={trigger}
          disabled={sending}
          className="text-xs font-mono px-3 py-1.5 rounded border border-terminal-border text-terminal-text hover:bg-terminal-bright/10 disabled:opacity-40 transition-colors"
        >
          {sending ? '◌ Sending…' : '▶ Send Daily Report'}
        </button>
        {result && (
          <span className={`text-xs font-mono ${result.startsWith('Sent') ? 'text-bull-default' : 'text-bear-default'}`}>
            {result}
          </span>
        )}
      </div>
    </div>
  )
}

function AttributionTab({ data, loading }: { data: AttributionReport | null; loading: boolean }) {
  if (loading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="glass-card rounded-lg p-5 space-y-3">
            <div className="skeleton h-3 w-40 rounded" />
            <div className="skeleton h-24 w-full rounded" />
          </div>
        ))}
      </div>
    )
  }

  if (!data) {
    return (
      <div className="glass-card rounded-lg p-5">
        <p className="text-terminal-muted text-xs">Attribution data unavailable — ensure the attribution API route is deployed and the database migration has been run.</p>
      </div>
    )
  }

  const { dimensions, edgePatterns, recommendations, aiEffectiveness, dataGap, insufficient, resolvedRows, windowHours } = data

  return (
    <div className="space-y-6">
      {/* Data status banner */}
      {dataGap && (
        <div className="glass-card rounded-lg p-4 border border-signal-medium/20">
          <p className="text-signal-medium text-xs font-semibold mb-1">Limited Tactical Data</p>
          <p className="text-terminal-muted text-xs leading-relaxed">
            Most signals were generated before Phase 6.7. Regime, signal_state, and mcap_tier breakdowns reflect only the {dimensions.byRegime.reduce((s, d) => s + d.total, 0)} signals with full tactical data. Run new scans to build the attribution dataset.
          </p>
        </div>
      )}

      {insufficient ? (
        <div className="glass-card rounded-lg p-5 space-y-2">
          <p className="text-signal-medium text-sm font-semibold">◌ Attribution warming up</p>
          <p className="text-terminal-muted text-xs leading-relaxed">
            Outcome attribution requires at least 20 resolved signals (TP hit, SL hit, or timeout) in the {explicitWindowNote(windowHours)}. Currently: {resolvedRows} resolved. Keep running scans — attribution populates automatically as signals resolve.
          </p>
        </div>
      ) : (
        <>
          {/* Tactical dimensions */}
          <DimTable title="Performance by Market Regime" rows={dimensions.byRegime} />
          <DimTable title="Performance by Signal State"  rows={dimensions.bySignalState} />
          <DimTable title="Performance by Market Cap Tier" rows={dimensions.byMcapTier} />
          <DimTable title="Performance by Extension Risk"  rows={dimensions.byExtensionRisk} />

          {/* Edge patterns */}
          <EdgePatternsSection patterns={edgePatterns} />

          {/* Timeframe + Mode (always available) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <DimTable title="By Timeframe"    rows={dimensions.byTimeframe} />
            <DimTable title="By Scanner Mode" rows={dimensions.byScannerMode} />
          </div>

          {/* AI effectiveness */}
          <AIEffectivenessSection ai={aiEffectiveness} />

          {/* Recommendations */}
          <RecommendationsSection recs={recommendations} />
        </>
      )}

      {/* Daily report trigger */}
      <DailyReportTrigger />

      <p className="text-terminal-muted/40 text-xs font-mono">
        Attribution - {resolvedRows} resolved signals - {explicitWindowNote(windowHours)}
      </p>
    </div>
  )
}

// ─── AI Calibration tab ───────────────────────────────────────────────────────

function VerdictBar({ label, count, total }: { label: string; count: number; total: number }) {
  const w = total > 0 ? (count / total) * 100 : 0
  const isGood = label === 'claude_adds_value'
  return (
    <div className="flex items-center gap-3">
      <span className="text-zinc-500 text-xs font-mono w-48 truncate capitalize">{label.replace(/_/g, ' ')}</span>
      <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${isGood ? 'bg-green-500' : 'bg-zinc-600'}`} style={{ width: `${w}%` }} />
      </div>
      <span className="font-mono text-xs text-white w-12 text-right">{count}</span>
      <span className="font-mono text-xs text-zinc-500 w-12 text-right">{w.toFixed(0)}%</span>
    </div>
  )
}

const CONFIDENCE_THRESHOLDS = [
  { tier: 'High',     range: '85–100%', description: 'Strong multi-timeframe confirmation, A/B grade risk',  color: 'text-green-400' },
  { tier: 'Med-High', range: '75–84%',  description: 'Standard qualification, at least 4/5 indicators aligned', color: 'text-blue-400' },
  { tier: 'Medium',   range: '70–74%',  description: 'Minimum for high_confidence mode, all other modes filtered', color: 'text-amber-400' },
  { tier: 'Low',      range: '< 70%',   description: 'Rejected — insufficient confirmation', color: 'text-red-400' },
]

function CalibrationTabContent({ ai, loading }: { ai: import('@/lib/admin-api').AiSummaryResponse | null; loading: boolean }) {
  function aiPct(v: number | null | undefined, d = 1) { return v != null ? `${(v * 100).toFixed(d)}%` : '—' }
  const verdicts  = ai?.verdicts ?? (ai as unknown as { verdict_distribution?: Record<string, number> })?.verdict_distribution ?? {}
  const totalVerd = Object.values(verdicts as Record<string, number>).reduce((a: number, b: number) => a + b, 0)
  const hasAiData = (ai?.total_calls ?? 0) > 0

  return (
    <div className="space-y-6 max-w-5xl">
      {!loading && !hasAiData && (
        <div className="rounded-xl px-5 py-4 bg-amber-500/5 border border-amber-500/20 flex items-start gap-3">
          <span className="text-amber-400 mt-0.5 shrink-0">⚠</span>
          <div>
            <p className="text-amber-300 text-sm font-semibold">AI telemetry warming up</p>
            <p className="text-zinc-500 text-xs mt-1 leading-relaxed">No Claude API calls logged yet. Run a scan to populate calibration data.</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {[
          { label: 'Success Rate', value: aiPct(ai?.success_rate), sub: 'API calls OK (24h)',    accent: ai?.success_rate != null ? (ai.success_rate >= 0.9 ? 'text-green-400' : ai.success_rate >= 0.7 ? 'text-amber-400' : 'text-red-400') : 'text-white' },
          { label: 'Avg Latency',  value: ai?.avg_latency_ms != null ? `${ai.avg_latency_ms.toFixed(0)}ms` : '—', sub: 'per call', accent: ai?.avg_latency_ms != null ? (ai.avg_latency_ms < 2000 ? 'text-green-400' : 'text-amber-400') : 'text-white' },
          { label: 'Last Error',   value: ai?.last_error ? 'See logs' : 'None', sub: ai?.last_error ? ai.last_error.slice(0, 40) : 'All calls clean', accent: ai?.last_error ? 'text-red-400' : 'text-green-400' },
        ].map(c => (
          <div key={c.label} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
            <div className="text-xs text-zinc-500 mb-1">{c.label}</div>
            <div className={`text-xl font-bold ${c.accent}`}>{c.value}</div>
            <div className="text-xs text-zinc-600 mt-0.5">{c.sub}</div>
          </div>
        ))}
      </div>

      {totalVerd > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
          <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-4">Verdict Distribution — {totalVerd} calls (24h)</h2>
          <div className="space-y-3">
            {Object.entries(verdicts as Record<string, number>).map(([k, v]) => (
              <VerdictBar key={k} label={k} count={v} total={totalVerd} />
            ))}
          </div>
        </div>
      )}

      <div className="pt-2">
        <p className="text-[9px] text-zinc-600 uppercase tracking-widest mb-3 flex items-center gap-2">
          <span className="h-px flex-1 bg-zinc-800"/>Confidence Tiers — Reference<span className="h-px flex-1 bg-zinc-800"/>
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {CONFIDENCE_THRESHOLDS.map(t => (
            <div key={t.tier} className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2.5">
              <p className={`text-sm font-bold mb-0.5 ${t.color}`}>{t.tier}</p>
              <p className="text-zinc-400 font-mono text-xs">{t.range}</p>
              <p className="text-zinc-600 text-[10px] mt-1 leading-snug hidden sm:block">{t.description}</p>
            </div>
          ))}
        </div>
        <p className="text-zinc-700 text-[10px] mt-2">Full confidence calibration bands and Claude effectiveness: Edge Validation tab</p>
      </div>
    </div>
  )
}

// ─── Page root ────────────────────────────────────────────────────────────────

type Tab = 'edge' | 'attribution' | 'calibration'

export default function AnalyticsPage() {
  const [tab, setTab] = useState<Tab>('edge')

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab') as Tab | null
    if (t && ['edge', 'attribution', 'calibration'].includes(t)) setTab(t)
  }, [])

  const edgeFetcher  = useCallback(() => adminApi.analytics.edgeReport(), [])
  const intelFetcher = useCallback(() => adminApi.analytics.intelligence(), [])
  const aiFetcher    = useCallback(() => adminApi.analytics.ai(24), [])

  const { data: edge,        loading: edgeLoading  } = useAutoRefresh<EdgeReport>(edgeFetcher, 120_000)
  const { data: intel,       loading: intelLoading } = useAutoRefresh<IntelligenceSummary>(intelFetcher, 120_000)
  const { data: aiData,      loading: aiLoading    } = useAutoRefresh<import('@/lib/admin-api').AiSummaryResponse>(aiFetcher, 120_000)

  const attrFetcher = useCallback(() =>
    fetch('/api/analytics/attribution?hours=720', { cache: 'no-store' })
      .then(r => r.json())
      .then((j: { success: boolean; report: AttributionReport }) => j.success ? j.report : null),
    []
  )
  const { data: attribution, loading: attrLoading } = useAutoRefresh<AttributionReport | null>(attrFetcher, 300_000)

  const tabs: { id: Tab; label: string }[] = [
    { id: 'edge',        label: 'Edge Validation' },
    { id: 'attribution', label: 'Attribution'     },
    { id: 'calibration', label: 'AI Calibration'  },
  ]

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-terminal-text text-xl font-semibold">Quantitative Analytics</h1>
        <p className="text-terminal-muted text-sm mt-1">Edge validation · Attribution intelligence · AI calibration</p>
      </div>

      {/* Tab nav */}
      <div className="flex gap-1 border-b border-terminal-border pb-0">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-xs font-mono uppercase tracking-wider border-b-2 transition-colors ${
              tab === t.id
                ? 'border-terminal-text text-terminal-text'
                : 'border-transparent text-terminal-muted hover:text-terminal-text/70'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'edge'        && <EdgeValidationTab edge={edge ?? null} loading={edgeLoading} intel={intel ?? null} intelLoading={intelLoading} />}
      {tab === 'attribution' && <AttributionTab data={attribution ?? null} loading={attrLoading} />}
      {tab === 'calibration' && <CalibrationTabContent ai={aiData ?? null} loading={aiLoading} />}
    </div>
  )
}
