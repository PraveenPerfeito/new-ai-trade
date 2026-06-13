'use client'

import { useCallback, useState, useEffect } from 'react'
import { adminApi, EdgeReport, IntelligenceSummary, IntelligencePerfRow } from '@/lib/admin-api'
import { useAutoRefresh } from '@/lib/use-auto-refresh'
import { formatTs } from '@/lib/utils'
import { analyticsWindowLabel, explicitWindowNote } from '@/lib/window-label'
import type { AttributionReport, AttributionDimension, EdgePattern, ThresholdRecommendation } from '@/types'

// â”€â”€â”€ Shared primitives â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// asyncpg/Pydantic v2 serialises PostgreSQL NUMERIC columns as JSON strings.
function toNum(v: unknown): number | null {
  if (v == null) return null
  const n = Number(v)
  return isNaN(n) ? null : n
}

function StatPair({ label, value, accent = '' }: { label: string; value: string; accent?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-terminal-muted text-xs uppercase tracking-wider">{label}</span>
      <span className={`font-mono font-bold text-lg ${accent || 'text-terminal-text'}`}>{value}</span>
    </div>
  )
}

function pct(n: unknown): string {
  const v = toNum(n)
  return v != null ? `${(v * 100).toFixed(1)}%` : 'â€”'
}
function exp(n: unknown): string {
  const v = toNum(n)
  if (v == null) return 'â€”'
  return v > 0 ? `+${v.toFixed(2)}R` : `${v.toFixed(2)}R`
}
function rr(n: unknown): string {
  const v = toNum(n)
  return v != null ? `${v.toFixed(2)}R` : 'â€”'
}

// â”€â”€â”€ Edge Validation tab â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function CalibrationTable({ bands }: { bands: EdgeReport['confidence_calibration']['bands'] | null | undefined }) {
  if (!bands) return null
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
                  ? <span className="text-terminal-muted/40">â€”</span>
                  : <span className={b.win_rate >= 0.55 ? 'text-bull-default' : 'text-bear-default'}>
                      {(b.win_rate * 100).toFixed(1)}%
                    </span>
                }
              </td>
              <td className="py-2.5 px-3 font-mono hidden sm:table-cell">
                {b.insufficient_data || b.expectancy == null
                  ? <span className="text-terminal-muted/40">â€”</span>
                  : <span className={Number(b.expectancy) > 0 ? 'text-bull-default' : 'text-bear-default'}>
                      {Number(b.expectancy) > 0 ? '+' : ''}{Number(b.expectancy).toFixed(2)}R
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

// â”€â”€â”€ Intelligence Performance section â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
          {wr != null ? `${(wr * 100).toFixed(1)}%` : 'â€”'}
        </span>
        <span className="text-terminal-muted text-xs font-mono">
          {row.avg_rr != null ? `${Number(row.avg_rr).toFixed(2)}R` : 'â€”'}
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
        Intelligence breakdowns require at least 5 resolved outcomes per tier. Warming up â€” data populates as signals resolve.
        {data && ` Total resolved: ${data.total}.`}
      </p>
    </div>
  )
  return (
    <div>
      <p className="text-terminal-muted text-xs uppercase tracking-wider mb-3">Intelligence Performance â€” Best Tier per Dimension</p>
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


// â”€â”€â”€ Attribution tab â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
                    : <span className="text-terminal-muted/40">â€”</span>
                  }
                </td>
                <td className="py-2 px-3 font-mono text-terminal-muted hidden sm:table-cell">{rr(d.avgRRAchieved)}</td>
                <td className="py-2 px-3 font-mono hidden sm:table-cell">
                  {d.expectancy != null
                    ? <span className={d.expectancy > 0 ? 'text-bull-default' : 'text-bear-default'}>{exp(d.expectancy)}</span>
                    : <span className="text-terminal-muted/40">â€”</span>
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
const dirIcon: Record<string, string> = { RAISE: 'â†‘', LOWER: 'â†“', MONITOR: 'â—Ž' }

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
              {aiEdgeDelta > 0 ? 'â–²' : 'â–¼'} AI {aiEdgeDelta > 0 ? '+' : ''}{(aiEdgeDelta * 100).toFixed(1)}% vs heuristic
            </span>
            <span className="text-terminal-muted/50 text-xs ml-3">
              {aiEdgeDelta > 0.05 ? 'AI validation adding measurable edge' : aiEdgeDelta < -0.05 ? 'Heuristic outperforming â€” review AI prompt' : 'No significant difference'}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

const GRADE_COLOR: Record<string, string> = {
  'Grade A': 'text-green-400', 'Grade B': 'text-blue-400', 'Grade C': 'text-amber-400',
  'Grade D': 'text-orange-400', 'Grade F': 'text-red-400',
}

function RiskGradeAnalysis({ rows }: { rows: AttributionDimension[] }) {
  if (!rows.length) return (
    <div className="glass-card rounded-lg p-5">
      <p className="text-terminal-muted text-xs uppercase tracking-wider mb-2">Risk Grade Analysis</p>
      <p className="text-terminal-muted/60 text-xs">No resolved signals with grade data yet. Warms up as signals reach TP/SL.</p>
    </div>
  )
  const sorted = [...rows].sort((a, b) => a.key.localeCompare(b.key))
  return (
    <div>
      <p className="text-terminal-muted text-xs uppercase tracking-wider mb-3">Risk Grade Analysis â€” RISKGRADE.FIX.1 Validation</p>
      <div className="glass-card rounded-lg overflow-hidden overflow-x-auto">
        <table className="w-full text-xs min-w-[360px]">
          <thead>
            <tr className="border-b border-terminal-border">
              <th className="text-terminal-muted text-xs uppercase tracking-wider text-left py-2 px-3 font-semibold">Grade</th>
              <th className="text-terminal-muted text-xs uppercase tracking-wider text-left py-2 px-3 font-semibold">Signals</th>
              <th className="text-terminal-muted text-xs uppercase tracking-wider text-left py-2 px-3 font-semibold">Win Rate</th>
              <th className="text-terminal-muted text-xs uppercase tracking-wider text-left py-2 px-3 font-semibold hidden sm:table-cell">Expectancy</th>
              <th className="text-terminal-muted text-xs uppercase tracking-wider text-left py-2 px-3 font-semibold hidden sm:table-cell">Avg RR</th>
              <th className="text-terminal-muted text-xs uppercase tracking-wider text-left py-2 px-3 font-semibold">Target</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(d => {
              const gradeColor = GRADE_COLOR[d.label] ?? 'text-terminal-text'
              const targets: Record<string, string> = { 'Grade A': 'WR â‰¥ 42%', 'Grade B': 'WR â‰¥ 43%', 'Grade C': 'WR â‰¥ 50%' }
              const target = targets[d.label] ?? ''
              const wrOk = d.winRate != null && d.winRate >= 0.42
              return (
                <tr key={d.key} className="border-b border-terminal-border/30 hover:bg-terminal-bright/10">
                  <td className={`py-2 px-3 font-mono font-bold ${gradeColor}`}>{d.label}</td>
                  <td className="py-2 px-3 font-mono text-terminal-muted">{d.total}</td>
                  <td className="py-2 px-3 font-mono">
                    {d.winRate != null
                      ? <span className={d.winRate >= 0.42 ? 'text-bull-default' : 'text-bear-default'}>{pct(d.winRate)}</span>
                      : <span className="text-terminal-muted/40">â€”</span>}
                  </td>
                  <td className="py-2 px-3 font-mono hidden sm:table-cell">
                    {d.expectancy != null
                      ? <span className={d.expectancy > 0 ? 'text-bull-default' : 'text-bear-default'}>{exp(d.expectancy)}</span>
                      : <span className="text-terminal-muted/40">â€”</span>}
                  </td>
                  <td className="py-2 px-3 font-mono text-terminal-muted hidden sm:table-cell">{rr(d.avgRRAchieved)}</td>
                  <td className="py-2 px-3 font-mono text-terminal-muted/50">
                    {target && <span className={wrOk ? 'text-bull-default/60' : 'text-terminal-muted/40'}>{target}</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <p className="px-3 py-2 text-terminal-muted/30 text-[10px] font-mono border-t border-terminal-border/20">
          RISKGRADE.FIX.1: futures penalty +5â†’+2 Â· breakout bonus HIGH_MOM +15 Â· regime quality Â±5/âˆ’10 for NULL
        </p>
      </div>
    </div>
  )
}

const POSTFIX_ITEMS = [
  { key: 'CONFIDENCE.POSTFIX.1',       label: 'Confidence Calibration Validation', desc: 'Verify ECE improvement after threshold recalibration.' },
  { key: 'RISKGRADE.POSTFIX.1',        label: 'Risk Grade Validation',             desc: 'Confirm Grade A WR â‰¥ 42%, Grade C shrinks to residual.' },
  { key: 'MARKET_STRUCTURE.POSTFIX.1', label: 'Market Structure Validation',       desc: 'ms_sr_rejection + ms_trend_exhaustion counts decrease; newly unblocked signals WR â‰¥ 48%.' },
  { key: 'ALPHA.POSTFIX.1',            label: 'Alpha Attribution Validation',      desc: 'Sector intelligence and breakout strength attribution confirmed.' },
]

function IntelligenceValidationSection() {
  return (
    <div>
      <p className="text-terminal-muted text-xs uppercase tracking-wider mb-3">Intelligence Validation â€” POSTFIX.1 Staging</p>
      <div className="space-y-2">
        {POSTFIX_ITEMS.map(item => (
          <div key={item.key} className="glass-card rounded-lg px-4 py-3 flex items-start gap-3">
            <span className="text-terminal-muted/30 font-mono text-[10px] w-4 mt-0.5 shrink-0">â—Œ</span>
            <div className="min-w-0">
              <p className="text-terminal-text text-xs font-semibold">{item.label}</p>
              <p className="text-terminal-muted/60 text-xs mt-0.5">{item.desc}</p>
            </div>
            <span className="ml-auto text-[9px] font-mono font-bold text-terminal-muted/30 uppercase tracking-widest shrink-0 mt-0.5">PENDING</span>
          </div>
        ))}
      </div>
      <p className="text-terminal-muted/30 text-[10px] font-mono mt-2">Validation gates populate after 7 days post-deployment</p>
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
      setResult('Network error â€” could not trigger report')
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
          {sending ? 'â—Œ Sendingâ€¦' : 'â–¶ Send Daily Report'}
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
        <p className="text-terminal-muted text-xs">Attribution data unavailable â€” ensure the attribution API route is deployed and the database migration has been run.</p>
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
          <p className="text-signal-medium text-sm font-semibold">â—Œ Attribution warming up</p>
          <p className="text-terminal-muted text-xs leading-relaxed">
            Outcome attribution requires at least 20 resolved signals (TP hit, SL hit, or timeout) in the {explicitWindowNote(windowHours)}. Currently: {resolvedRows} resolved. Keep running scans â€” attribution populates automatically as signals resolve.
          </p>
        </div>
      ) : (
        <>
          {/* Tactical dimensions â€” regime and mcap tier kept; signal state, extension risk removed */}
          <DimTable title="Performance by Market Regime" rows={dimensions.byRegime} />
          <DimTable title="Performance by Market Cap Tier" rows={dimensions.byMcapTier} />

          {/* Edge patterns */}
          <EdgePatternsSection patterns={edgePatterns} />

          {/* Timeframe only (scanner mode duplicate removed) */}
          <DimTable title="By Timeframe" rows={dimensions.byTimeframe} />

          {/* Risk Grade Analysis â€” RISKGRADE.FIX.1 validation */}
          <RiskGradeAnalysis rows={dimensions.byGrade} />

          {/* AI effectiveness â€” collapsed by default */}
          <details className="mt-4">
            <summary className="cursor-pointer text-xs text-zinc-500 hover:text-zinc-400 font-semibold uppercase tracking-wide py-1 px-2 rounded hover:bg-zinc-800/50">
              AI vs Heuristic Analysis â–¸
            </summary>
            <div className="mt-3">
              <AIEffectivenessSection ai={aiEffectiveness} />
            </div>
          </details>

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

// â”€â”€â”€ AI Calibration tab â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
  { tier: 'High',     range: '85â€“100%', description: 'Strong multi-timeframe confirmation, A/B grade risk',  color: 'text-green-400' },
  { tier: 'Med-High', range: '75â€“84%',  description: 'Standard qualification, at least 4/5 indicators aligned', color: 'text-blue-400' },
  { tier: 'Medium',   range: '70â€“74%',  description: 'Minimum for high_confidence mode, all other modes filtered', color: 'text-amber-400' },
  { tier: 'Low',      range: '< 70%',   description: 'Rejected â€” insufficient confirmation', color: 'text-red-400' },
]

// â”€â”€â”€ CONFIDENCE.CALIBRATION.2 â€” read-only empirical confidence analytics â”€â”€â”€â”€â”€
// Rendered only when FeatureFlags.confidence_calibration_v2 is ON (API returns
// enabled:false otherwise â†’ section hidden, zero UI change). Never affects
// scoring, gating, or delivery.

function DriftChip({ drift }: { drift: number | null }) {
  if (drift == null) return <span className="text-zinc-600 font-mono text-xs">â€”</span>
  const d = Number(drift)
  const cls = d >= -5 ? 'text-emerald-400' : d >= -25 ? 'text-amber-400' : 'text-red-400'
  return <span className={`font-mono text-xs font-bold ${cls}`}>{d > 0 ? '+' : ''}{d.toFixed(0)}</span>
}

function CalBandRow({ band, s }: { band: string; s: import('@/lib/admin-api').CalibrationBandStats }) {
  const wrW  = Math.min(100, s.wr ?? 0)
  const stW  = Math.min(100, s.mean_stated ?? 0)
  return (
    <div className="flex items-center gap-3 py-1">
      <span className="text-zinc-400 font-mono text-xs w-14 shrink-0">{band}</span>
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
            <div className="h-full bg-zinc-500 rounded-full" style={{ width: `${stW}%` }} />
          </div>
          <span className="text-[10px] text-zinc-500 font-mono w-20 text-right">stated {s.mean_stated != null ? Number(s.mean_stated).toFixed(0) : 'â€”'}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
            <div className={`h-full rounded-full ${(s.wr ?? 0) >= (s.mean_stated ?? 100) ? 'bg-emerald-500' : 'bg-purple-500'}`} style={{ width: `${wrW}%` }} />
          </div>
          <span className="text-[10px] text-purple-300 font-mono w-20 text-right">actual {s.wr != null ? Number(s.wr).toFixed(0) : 'â€”'}%</span>
        </div>
      </div>
      <DriftChip drift={s.drift} />
      <span className={`text-[10px] font-mono w-14 text-right ${s.low_sample ? 'text-amber-500' : 'text-zinc-600'}`}>
        n={s.n}{s.low_sample ? 'âš ' : ''}
      </span>
      <span className="text-[10px] font-mono text-zinc-500 w-16 text-right hidden sm:block">
        {s.exp != null ? `${Number(s.exp) > 0 ? '+' : ''}${Number(s.exp).toFixed(2)}R` : 'â€”'}
      </span>
      <span className="text-[10px] font-mono text-zinc-500 w-12 text-right hidden sm:block">
        PF {s.pf != null ? Number(s.pf).toFixed(2) : 'â€”'}
      </span>
    </div>
  )
}

function ConfidenceCalibrationSection() {
  const fetcher = useCallback(() => adminApi.analytics.confidenceCalibration().catch(() => null), [])
  const { data: cal } = useAutoRefresh<import('@/lib/admin-api').ConfidenceCalibrationResponse | null>(fetcher, 300_000)

  if (!cal || !cal.enabled) return null   // flag OFF â†’ zero UI change

  const insights = cal.insights
  const dq = cal.data_quality
  const insightCards = insights && !insights.insufficient_data ? [
    { label: 'Most Overrated',  v: insights.most_overrated,  color: 'text-red-400',     desc: 'largest negative drift' },
    { label: 'Most Underrated', v: insights.most_underrated, color: 'text-emerald-400', desc: 'largest positive drift' },
    { label: 'Best Actual WR',  v: insights.best_actual,     color: 'text-emerald-400', desc: 'highest measured WR' },
    { label: 'Worst Actual WR', v: insights.worst_actual,    color: 'text-red-400',     desc: 'lowest measured WR' },
  ] : []

  return (
    <div className="space-y-5">
      <p className="text-[9px] text-zinc-600 uppercase tracking-widest flex items-center gap-2">
        <span className="h-px flex-1 bg-zinc-800"/>Confidence Calibration â€” Empirical (read-only)<span className="h-px flex-1 bg-zinc-800"/>
      </p>

      {/* Data quality warnings */}
      {dq && dq.warnings.length > 0 && (
        <div className="space-y-1.5">
          {dq.warnings.map((w, i) => (
            <div key={i} className="rounded-lg px-3 py-2 bg-amber-500/5 border border-amber-500/20 text-amber-300/90 text-xs flex items-start gap-2">
              <span className="shrink-0">âš </span><span>{w}</span>
            </div>
          ))}
        </div>
      )}

      {/* Founder insights */}
      {insightCards.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {insightCards.map(c => (
            <div key={c.label} className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2.5">
              <p className="text-[9px] text-zinc-500 uppercase tracking-wider">{c.label}</p>
              <p className={`text-lg font-bold font-mono ${c.color}`}>{c.v?.band}</p>
              <p className="text-[10px] text-zinc-500 font-mono">
                WR {c.v?.wr != null ? Number(c.v.wr).toFixed(0) : 'â€”'}% Â· drift {c.v?.drift != null && Number(c.v.drift) > 0 ? '+' : ''}{c.v?.drift != null ? Number(c.v.drift).toFixed(0) : 'â€”'} Â· n={c.v?.n}
              </p>
              <p className="text-[9px] text-zinc-600 mt-0.5">{c.desc}</p>
            </div>
          ))}
        </div>
      )}

      {/* Stated vs actual â€” regime-known cohort (clean) */}
      {cal.bands_regime_known && Object.keys(cal.bands_regime_known).length > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
          <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-1">
            Stated vs Actual Win Rate â€” Regime-Known Cohort
          </h2>
          <p className="text-[10px] text-zinc-600 mb-3">
            Grey bar = average stated confidence Â· purple bar = measured WR Â· drift = actual âˆ’ stated Â· âš  = n &lt; {dq?.min_reliable_n ?? 30}
          </p>
          <div className="divide-y divide-zinc-800/60">
            {Object.entries(cal.bands_regime_known).filter(([b]) => b !== 'NULL').map(([band, s]) => (
              <CalBandRow key={band} band={band} s={s} />
            ))}
          </div>
        </div>
      )}

      {/* All outcomes (incl. NULL-regime era) */}
      {cal.bands && Object.keys(cal.bands).length > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
          <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-3">
            All Outcomes (includes pre-fix NULL-regime era)
          </h2>
          <div className="divide-y divide-zinc-800/60">
            {Object.entries(cal.bands).filter(([b]) => b !== 'NULL').map(([band, s]) => (
              <CalBandRow key={band} band={band} s={s} />
            ))}
          </div>
        </div>
      )}

      {/* Drift by dimension */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {([['Regime', cal.drift_by_regime], ['Signal Type', cal.drift_by_type], ['Scanner Mode', cal.drift_by_mode]] as const).map(([title, dims]) => (
          <div key={title} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
            <p className="text-[9px] text-zinc-500 uppercase tracking-widest mb-2">Drift by {title}</p>
            <div className="space-y-1.5">
              {dims && Object.entries(dims).map(([value, bands]) => (
                Object.entries(bands).map(([band, s]) => (
                  <div key={`${value}-${band}`} className="flex items-center gap-2 text-[10px]">
                    <span className="text-zinc-500 font-mono truncate flex-1">{value === 'None' ? 'NULL' : value} Â· {band}</span>
                    <span className="text-zinc-400 font-mono">{s.wr != null ? Number(s.wr).toFixed(0) : 'â€”'}%</span>
                    <DriftChip drift={s.drift} />
                    <span className="text-zinc-600 font-mono w-12 text-right">n={s.n}</span>
                  </div>
                ))
              ))}
            </div>
          </div>
        ))}
      </div>

      <p className="text-zinc-700 text-[10px] font-mono">
        {dq?.total_resolved ?? 0} resolved outcomes Â· {dq?.snapshot_generations ?? 0} snapshot generations Â·
        empirical confidence is measurement only â€” production scoring unchanged
      </p>
    </div>
  )
}

// â”€â”€â”€ AUTO_CALIBRATION.READY.1 â€” reads already-fetched edge+attribution data â”€â”€â”€â”€â”€

function CalibrationHealthPanel({
  bands,
  byGrade,
}: {
  bands:   EdgeReport['confidence_calibration']['bands'] | undefined
  byGrade: AttributionDimension[] | undefined
}) {
  if (!bands?.length && !byGrade?.length) return null

  // Grade monotonicity â€” A should outperform B, B > C, C > D (win rate)
  const gradeOrder = ['A+', 'A', 'B+', 'B', 'C', 'D']
  const gradeRows = gradeOrder
    .map(g => byGrade?.find(d => d.key === g))
    .filter(Boolean) as AttributionDimension[]

  const gradeInversions: string[] = []
  for (let i = 1; i < gradeRows.length; i++) {
    const prev = gradeRows[i - 1]
    const curr = gradeRows[i]
    if (
      prev.winRate != null && curr.winRate != null &&
      prev.total >= 10 && curr.total >= 10 &&
      curr.winRate > prev.winRate + 0.02          // 2pp tolerance
    ) {
      gradeInversions.push(`${gradeRows[i - 1].key} (${(prev.winRate * 100).toFixed(0)}%) < ${gradeRows[i].key} (${(curr.winRate * 100).toFixed(0)}%)`)
    }
  }

  // Confidence band monotonicity â€” higher band should have higher win rate
  const populatedBands = (bands ?? []).filter(b => !b.insufficient_data && b.win_rate != null)
  const bandInversions: string[] = []
  for (let i = 1; i < populatedBands.length; i++) {
    const prev = populatedBands[i - 1]
    const curr = populatedBands[i]
    if (curr.win_rate! > prev.win_rate! + 0.02) {
      bandInversions.push(`${prev.label} (${(prev.win_rate! * 100).toFixed(0)}%) < ${curr.label} (${(curr.win_rate! * 100).toFixed(0)}%)`)
    }
  }

  // Health score: start 100, deduct for each inversion
  const score = Math.max(0, 100 - gradeInversions.length * 20 - bandInversions.length * 15)
  const scoreColor = score >= 80 ? 'text-bull-default' : score >= 60 ? 'text-amber-400' : 'text-bear-default'
  const healthy = gradeInversions.length === 0 && bandInversions.length === 0

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest">Calibration Health</h2>
        <span className={`font-mono font-bold text-lg ${scoreColor}`}>{score}/100</span>
      </div>

      {healthy && (
        <div className="flex items-center gap-2 text-xs text-bull-default/80 mb-3">
          <span className="w-1.5 h-1.5 rounded-full bg-bull-default"/>
          Grades monotonic Â· confidence bands monotonic â€” no inversions detected
        </div>
      )}

      {gradeInversions.length > 0 && (
        <div className="mb-3">
          <p className="text-[9px] text-amber-500 uppercase tracking-widest mb-1.5">Grade Inversions</p>
          <div className="space-y-1">
            {gradeInversions.map(inv => (
              <div key={inv} className="flex items-center gap-2 text-[10px] text-amber-400 font-mono">
                <span className="text-amber-500">âš </span> {inv}
              </div>
            ))}
          </div>
        </div>
      )}

      {bandInversions.length > 0 && (
        <div className="mb-3">
          <p className="text-[9px] text-amber-500 uppercase tracking-widest mb-1.5">Confidence Band Inversions</p>
          <div className="space-y-1">
            {bandInversions.map(inv => (
              <div key={inv} className="flex items-center gap-2 text-[10px] text-amber-400 font-mono">
                <span className="text-amber-500">âš </span> {inv}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Grade WR strip */}
      {gradeRows.length > 0 && (
        <div>
          <p className="text-[9px] text-zinc-500 uppercase tracking-widest mb-2">Grade Win Rates</p>
          <div className="flex flex-wrap gap-2">
            {gradeRows.map(g => (
              <div key={g.key} className="bg-zinc-800 rounded px-2.5 py-1.5 text-center min-w-[52px]">
                <p className="text-[9px] text-zinc-500">{g.key}</p>
                <p className={`font-mono text-xs font-bold ${g.winRate != null && g.winRate >= 0.5 ? 'text-bull-default' : 'text-bear-default'}`}>
                  {g.winRate != null ? `${(g.winRate * 100).toFixed(0)}%` : 'â€”'}
                </p>
                <p className="text-[9px] text-zinc-600">n={g.total}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function CalibrationTabContent({
  ai,
  loading,
  edge,
  attribution,
}: {
  ai: import('@/lib/admin-api').AiSummaryResponse | null
  loading: boolean
  edge: EdgeReport | null
  attribution: AttributionReport | null | undefined
}) {
  function aiPct(v: number | null | undefined, d = 1) { return v != null ? `${(v * 100).toFixed(d)}%` : 'â€”' }
  const verdicts  = ai?.verdicts ?? (ai as unknown as { verdict_distribution?: Record<string, number> })?.verdict_distribution ?? {}
  const totalVerd = Object.values(verdicts as Record<string, number>).reduce((a: number, b: number) => a + b, 0)
  const hasAiData = (ai?.total_calls ?? 0) > 0

  return (
    <div className="space-y-6 max-w-5xl">
      <CalibrationHealthPanel
        bands={edge?.confidence_calibration?.bands}
        byGrade={attribution?.dimensions?.byGrade}
      />

      {!loading && !hasAiData && (
        <div className="rounded-xl px-5 py-4 bg-amber-500/5 border border-amber-500/20 flex items-start gap-3">
          <span className="text-amber-400 mt-0.5 shrink-0">âš </span>
          <div>
            <p className="text-amber-300 text-sm font-semibold">AI telemetry warming up</p>
            <p className="text-zinc-500 text-xs mt-1 leading-relaxed">No Claude API calls logged yet. Run a scan to populate calibration data.</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {[
          { label: 'Success Rate', value: aiPct(ai?.success_rate), sub: 'API calls OK (24h)',    accent: ai?.success_rate != null ? (ai.success_rate >= 0.9 ? 'text-green-400' : ai.success_rate >= 0.7 ? 'text-amber-400' : 'text-red-400') : 'text-white' },
          { label: 'Avg Latency',  value: ai?.avg_latency_ms != null ? `${Number(ai.avg_latency_ms).toFixed(0)}ms` : 'â€”', sub: 'per call', accent: ai?.avg_latency_ms != null ? (Number(ai.avg_latency_ms) < 2000 ? 'text-green-400' : 'text-amber-400') : 'text-white' },
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
          <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-4">Verdict Distribution â€” {totalVerd} calls (24h)</h2>
          <div className="space-y-3">
            {Object.entries(verdicts as Record<string, number>).map(([k, v]) => (
              <VerdictBar key={k} label={k} count={v} total={totalVerd} />
            ))}
          </div>
        </div>
      )}

      <div className="pt-2">
        <p className="text-[9px] text-zinc-600 uppercase tracking-widest mb-3 flex items-center gap-2">
          <span className="h-px flex-1 bg-zinc-800"/>Confidence Tiers â€” Reference<span className="h-px flex-1 bg-zinc-800"/>
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

      {/* CONFIDENCE.CALIBRATION.2 â€” hidden unless confidence_calibration_v2 flag is ON */}
      <ConfidenceCalibrationSection />
    </div>
  )
}

// â”€â”€â”€ Phase D â€” Track Record tab â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function TrackRecordTab({ data, loading }: { data: import('@/lib/admin-api').TrackRecordResponse | null; loading: boolean }) {
  if (loading) return <div className="text-terminal-muted text-sm py-8 text-center">Loading track recordâ€¦</div>
  if (!data)   return <div className="text-terminal-muted text-sm py-8 text-center">No track record data available.</div>

  const w = (wr: number | null) => wr == null ? 'â€”' : `${wr}%`
  const e = (ex: number | null) => ex == null ? 'â€”' : `${Number(ex) > 0 ? '+' : ''}${Number(ex).toFixed(2)}R`
  const p = (pf: number | null) => pf == null ? 'â€”' : Number(pf).toFixed(2)
  const wrCls = (wr: number | null) => wr == null ? 'text-terminal-muted' : wr >= 50 ? 'text-bull-default' : wr >= 40 ? 'text-blue-400' : wr >= 30 ? 'text-amber-400' : 'text-bear-default'
  const expCls = (exp: number | null) => exp == null ? 'text-terminal-muted' : exp >= 0.5 ? 'text-bull-default' : exp >= 0.2 ? 'text-blue-400' : exp >= 0 ? 'text-amber-400' : 'text-bear-default'
  const pfCls  = (pf: number | null)  => pf  == null ? 'text-terminal-muted' : pf  >= 2.0 ? 'text-bull-default' : pf  >= 1.5 ? 'text-blue-400' : pf  >= 1.0 ? 'text-amber-400' : 'text-bear-default'
  const modeLabel = (m: string) => m === 'high_confidence' ? 'High Conf' : m.charAt(0).toUpperCase() + m.slice(1)

  const windows = [
    { label: '7d',  w: data.windows.d7  },
    { label: '30d', w: data.windows.d30 },
    { label: '90d', w: data.windows.d90 },
  ] as const

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-terminal-text font-semibold mb-0.5">Verified Track Record</h2>
        <p className="text-terminal-muted text-xs">Source: {data.source} Â· Outcome-resolved signals only</p>
      </div>

      {/* Performance windows */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {windows.map(({ label, w: win }) => (
          <div key={label} className="glass-card rounded-xl p-5">
            <p className="text-terminal-muted text-xs uppercase tracking-widest mb-3 font-semibold">{label} Window Â· {win.resolved} resolved</p>
            <div className="space-y-2.5">
              <div className="flex justify-between items-center">
                <span className="text-terminal-muted text-xs">Win Rate</span>
                <span className={`font-mono font-bold text-base ${wrCls(win.win_rate)}`}>{w(win.win_rate)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-terminal-muted text-xs">Expectancy</span>
                <span className={`font-mono font-bold text-base ${expCls(win.expectancy)}`}>{e(win.expectancy)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-terminal-muted text-xs">Profit Factor</span>
                <span className={`font-mono font-bold text-base ${pfCls(win.pf)}`}>{p(win.pf)}</span>
              </div>
              <div className="flex justify-between items-center border-t border-terminal-border/40 pt-2">
                <span className="text-terminal-muted text-xs">Wins / Losses</span>
                <span className="font-mono text-xs text-terminal-muted">{win.wins}W / {win.losses}L</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* By mode (30d) */}
      {(data.by_mode_30d ?? []).length > 0 && (
        <div className="glass-card rounded-xl p-5">
          <p className="text-terminal-muted text-xs uppercase tracking-widest mb-4 font-semibold">30d by Mode</p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-terminal-border">
                  <th className="text-terminal-muted text-xs uppercase tracking-wider text-left py-2 px-3 font-semibold">Mode</th>
                  <th className="text-terminal-muted text-xs uppercase tracking-wider text-left py-2 px-3 font-semibold">n</th>
                  <th className="text-terminal-muted text-xs uppercase tracking-wider text-left py-2 px-3 font-semibold">Win Rate</th>
                  <th className="text-terminal-muted text-xs uppercase tracking-wider text-left py-2 px-3 font-semibold">Expectancy</th>
                </tr>
              </thead>
              <tbody>
                {(data.by_mode_30d ?? []).map(m => (
                  <tr key={m.scanner_mode} className="border-b border-terminal-border/30 hover:bg-terminal-bright/10">
                    <td className="py-2.5 px-3 font-mono text-terminal-text">{modeLabel(m.scanner_mode)}</td>
                    <td className="py-2.5 px-3 font-mono text-terminal-muted">{m.n}</td>
                    <td className={`py-2.5 px-3 font-mono font-semibold ${wrCls(m.wr)}`}>{w(m.wr)}</td>
                    <td className={`py-2.5 px-3 font-mono font-semibold ${expCls(m.exp)}`}>{e(m.exp)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Probability accuracy */}
      {data.probability_accuracy && (
        <div className="glass-card rounded-xl p-5">
          <p className="text-terminal-muted text-xs uppercase tracking-widest mb-4 font-semibold">Probability Engine Accuracy</p>
          {data.probability_accuracy.n < 10 ? (
            <p className="text-terminal-muted text-sm">Insufficient data â€” need â‰¥ 10 stamped outcomes (current: {data.probability_accuracy.n})</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <p className="text-terminal-muted text-xs mb-1">Sample</p>
                <p className="font-mono text-base text-terminal-text font-bold">n={data.probability_accuracy.n}</p>
              </div>
              <div>
                <p className="text-terminal-muted text-xs mb-1">Predicted WR</p>
                <p className="font-mono text-base text-terminal-text font-bold">
                  {data.probability_accuracy.avg_predicted_wr != null ? `${Number(data.probability_accuracy.avg_predicted_wr).toFixed(1)}%` : 'â€”'}
                </p>
              </div>
              <div>
                <p className="text-terminal-muted text-xs mb-1">Actual WR</p>
                <p className={`font-mono text-base font-bold ${wrCls(data.probability_accuracy.realized_wr)}`}>
                  {data.probability_accuracy.realized_wr != null ? `${Number(data.probability_accuracy.realized_wr).toFixed(1)}%` : 'â€”'}
                </p>
              </div>
              <div>
                <p className="text-terminal-muted text-xs mb-1">Mean Abs Error</p>
                <p className={`font-mono text-base font-bold ${
                  data.probability_accuracy.mean_abs_error == null ? 'text-terminal-muted'
                  : data.probability_accuracy.mean_abs_error <= 0.1 ? 'text-bull-default'
                  : data.probability_accuracy.mean_abs_error <= 0.2 ? 'text-amber-400'
                  : 'text-bear-default'}`}>
                  {data.probability_accuracy.mean_abs_error != null ? `${(data.probability_accuracy.mean_abs_error * 100).toFixed(0)}pp` : 'â€”'}
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// â”€â”€â”€ Page root â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

type Tab = 'trackRecord' | 'edge' | 'attribution'

// â”€â”€â”€ PHASE.9.P1 â€” Probability tab â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function EdgeCellRow({ c }: { c: import('@/lib/admin-api').EdgeMatrixCell }) {
  const expCls = (c.exp ?? 0) >= 0.6 ? 'text-emerald-400' : (c.exp ?? 0) >= 0.15 ? 'text-blue-400' : (c.exp ?? 0) >= 0 ? 'text-amber-400' : 'text-red-400'
  return (
    <tr className="border-b border-zinc-800/40 hover:bg-zinc-800/20">
      <td className="py-1.5 px-3 font-mono text-[10px] text-zinc-500">{c.dim_key}</td>
      <td className="py-1.5 px-3 font-mono text-xs text-zinc-200">{c.dim_value.replace(/\|/g, ' Â· ')}</td>
      <td className="py-1.5 px-3 font-mono text-xs text-right text-zinc-300">{Number(c.wr).toFixed(1)}%</td>
      <td className="py-1.5 px-3 font-mono text-[10px] text-right text-zinc-600">[{c.ci[0]}â€“{c.ci[1]}]</td>
      <td className={`py-1.5 px-3 font-mono text-xs text-right font-semibold ${expCls}`}>{c.exp != null ? `${Number(c.exp) >= 0 ? '+' : ''}${Number(c.exp).toFixed(3)}R` : 'â€”'}</td>
      <td className="py-1.5 px-3 font-mono text-xs text-right text-zinc-400">{c.pf != null ? Number(c.pf).toFixed(2) : 'â€”'}</td>
      <td className="py-1.5 px-3 font-mono text-xs text-right text-zinc-500">{c.n}</td>
    </tr>
  )
}

function ProbabilityTabContent() {
  const edgeFetcher  = useCallback(() => adminApi.analytics.edgeMatrix().catch(() => null), [])
  const trackFetcher = useCallback(() => adminApi.analytics.trackRecord().catch(() => null), [])
  const { data: matrix } = useAutoRefresh<import('@/lib/admin-api').EdgeMatrixResponse | null>(edgeFetcher, 300_000)
  const { data: track }  = useAutoRefresh<import('@/lib/admin-api').TrackRecordResponse | null>(trackFetcher, 300_000)

  const acc = track?.probability_accuracy

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Track record (Phase G foundation) */}
      {track && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {([['7d', track.windows.d7], ['30d', track.windows.d30], ['90d', track.windows.d90]] as const).map(([label, w]) => (
            <div key={label} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
              <p className="text-[9px] text-zinc-500 uppercase tracking-widest mb-1">Track Record Â· {label}</p>
              <p className="text-xl font-bold font-mono text-white">{w.win_rate != null ? `${Number(w.win_rate).toFixed(1)}%` : 'â€”'} <span className="text-xs text-zinc-500 font-normal">WR</span></p>
              <p className="text-[11px] font-mono text-zinc-400 mt-1">
                {w.expectancy != null ? `${w.expectancy >= 0 ? '+' : ''}${Number(w.expectancy).toFixed(3)}R` : 'â€”'} Â· PF {w.pf != null ? Number(w.pf).toFixed(2) : 'â€”'} Â· n={w.resolved}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Probability accuracy â€” predicted vs realized */}
      {acc && acc.n > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
          <p className="text-[9px] text-zinc-500 uppercase tracking-widest mb-2">Probability Accuracy â€” stamped prediction vs realized outcome</p>
          <div className="flex gap-6 flex-wrap text-sm font-mono">
            <span className="text-zinc-400">Predicted avg: <span className="text-purple-300 font-bold">{acc.avg_predicted_wr != null ? Number(acc.avg_predicted_wr).toFixed(1) : 'â€”'}%</span></span>
            <span className="text-zinc-400">Realized: <span className="text-emerald-400 font-bold">{acc.realized_wr != null ? Number(acc.realized_wr).toFixed(1) : 'â€”'}%</span></span>
            <span className="text-zinc-400">Mean abs error: <span className="text-zinc-200 font-bold">{acc.mean_abs_error != null ? Number(acc.mean_abs_error).toFixed(3) : 'â€”'}</span></span>
            <span className="text-zinc-600">n={acc.n} resolved stamped signals</span>
          </div>
        </div>
      )}

      {/* Edge Matrix */}
      {matrix && matrix.top.length > 0 ? (
        <>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 overflow-x-auto">
            <p className="text-[9px] text-zinc-500 uppercase tracking-widest mb-2">
              Edge Matrix â€” Top combinations by expectancy (30d snapshots, n â‰¥ {matrix.min_n}, Wilson 95% CI)
            </p>
            <table className="w-full text-xs min-w-[640px]">
              <thead>
                <tr className="border-b border-zinc-700 text-[9px] uppercase tracking-wider text-zinc-500">
                  <th className="text-left py-1.5 px-3">Dimension</th><th className="text-left py-1.5 px-3">Cohort</th>
                  <th className="text-right py-1.5 px-3">WR</th><th className="text-right py-1.5 px-3">CI</th>
                  <th className="text-right py-1.5 px-3">Exp</th><th className="text-right py-1.5 px-3">PF</th>
                  <th className="text-right py-1.5 px-3">n</th>
                </tr>
              </thead>
              <tbody>{matrix.top.slice(0, 25).map((c, i) => <EdgeCellRow key={i} c={c} />)}</tbody>
            </table>
          </div>
          <div className="bg-zinc-900 border border-red-900/30 rounded-xl p-4 overflow-x-auto">
            <p className="text-[9px] text-red-400/70 uppercase tracking-widest mb-2">Worst cohorts â€” avoid / gate these</p>
            <table className="w-full text-xs min-w-[640px]">
              <tbody>{matrix.bottom.map((c, i) => <EdgeCellRow key={i} c={c} />)}</tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-8 text-center text-zinc-600 text-sm">
          Edge Matrix populates from nightly attribution snapshots â€” first generation after 00:15 UTC.
        </div>
      )}

      {/* PERFORMANCE.VERIFICATION.1 â€” read-only validation */}
      <PerformanceVerificationSection />

      <p className="text-zinc-700 text-[10px] font-mono">
        Derived entirely from signal_outcomes via attribution snapshots Â· no ML Â· empirical grades: A+ â‰¥1.0R Â· A â‰¥0.6 Â· B+ â‰¥0.35 Â· B â‰¥0.15 Â· C â‰¥0 Â· D &lt;0
      </p>
    </div>
  )
}

// â”€â”€â”€ PERFORMANCE.VERIFICATION.1 â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

type VerifyResponse = {
  accuracy: {
    overall: { n: number; predicted_wr: number; actual_wr: number; drift: number; mean_abs_error: number } | null
    by_regime: Array<{ value: string; n: number; predicted_wr: number; actual_wr: number; drift: number; ci: [number, number]; calibrated: boolean; low_sample: boolean }>
    by_grade: VerifyResponse['accuracy']['by_regime']
    by_breakout: VerifyResponse['accuracy']['by_regime']
    by_type: VerifyResponse['accuracy']['by_regime']
    by_mode: VerifyResponse['accuracy']['by_regime']
  }
  grades: {
    empirical: Array<{ grade: string; n: number; wr: number | null; exp: number | null; pf: number | null }>
    empirical_inversions_wr: string[]
    empirical_inversions_exp: string[]
    heuristic: VerifyResponse['grades']['empirical']
    heuristic_inversions_wr: string[]
  }
  stability: {
    overlap_7v30: { jaccard: number | null; top3_retained: number }
    overlap_30v90: { jaccard: number | null; top3_retained: number }
    regime_distribution: Record<string, Record<string, number>>
  }
  sample_quality: { stamped_total: number; stamped_resolved: number; graded_total: number; warnings: string[] }
}

function GradeValidationTable({ title, rows, inversions }: {
  title: string
  rows: VerifyResponse['grades']['empirical']
  inversions: string[]
}) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-2">
        <p className="text-[9px] text-zinc-500 uppercase tracking-widest">{title}</p>
        {inversions.length === 0
          ? <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">monotonic âœ“</span>
          : <span className="text-[9px] px-1.5 py-0.5 rounded bg-red-500/10 border border-red-500/20 text-red-400">{inversions.length} inversion{inversions.length > 1 ? 's' : ''}</span>}
      </div>
      <div className="space-y-1">
        {rows.map(g => (
          <div key={g.grade} className="flex items-center gap-3 text-xs font-mono">
            <span className="text-purple-300 font-bold w-7">{g.grade}</span>
            <span className="text-zinc-300 w-14">{g.wr != null ? Number(g.wr).toFixed(1) : 'â€”'}%</span>
            <span className={`w-18 ${(Number(g.exp ?? 0) >= 0) ? 'text-emerald-400' : 'text-red-400'}`}>{g.exp != null ? `${Number(g.exp) >= 0 ? '+' : ''}${Number(g.exp).toFixed(3)}R` : 'â€”'}</span>
            <span className="text-zinc-500 w-14">PF {g.pf != null ? Number(g.pf).toFixed(2) : 'â€”'}</span>
            <span className="text-zinc-600">n={g.n}</span>
          </div>
        ))}
      </div>
      {inversions.map((v, i) => <p key={i} className="text-[10px] text-red-400/80 mt-1.5 font-mono">âš  {v}</p>)}
    </div>
  )
}

function PerformanceVerificationSection() {
  const fetcher = useCallback(() =>
    adminApi.analytics.performanceVerification<VerifyResponse>().catch(() => null), [])
  const { data: v } = useAutoRefresh<VerifyResponse | null>(fetcher, 300_000)
  if (!v) return null

  const acc = v.accuracy.overall
  const dims: Array<[string, VerifyResponse['accuracy']['by_regime']]> = [
    ['Regime', v.accuracy.by_regime], ['Grade', v.accuracy.by_grade],
    ['Breakout', v.accuracy.by_breakout], ['Type', v.accuracy.by_type], ['Mode', v.accuracy.by_mode],
  ]

  return (
    <div className="space-y-4">
      <p className="text-[9px] text-zinc-600 uppercase tracking-widest flex items-center gap-2">
        <span className="h-px flex-1 bg-zinc-800"/>Performance Verification â€” read-only<span className="h-px flex-1 bg-zinc-800"/>
      </p>

      {v.sample_quality.warnings.map((w, i) => (
        <div key={i} className="rounded-lg px-3 py-2 bg-amber-500/5 border border-amber-500/20 text-amber-300/90 text-xs flex items-start gap-2">
          <span className="shrink-0">âš </span><span>{w}</span>
        </div>
      ))}

      {/* Probability accuracy */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
        <p className="text-[9px] text-zinc-500 uppercase tracking-widest mb-2">Probability Accuracy â€” predicted vs realized (out-of-sample, accumulating)</p>
        {acc ? (
          <>
            <div className="flex gap-5 flex-wrap text-sm font-mono mb-3">
              <span className="text-zinc-400">Predicted: <span className="text-purple-300 font-bold">{acc.predicted_wr}%</span></span>
              <span className="text-zinc-400">Actual: <span className="text-emerald-400 font-bold">{acc.actual_wr}%</span></span>
              <span className="text-zinc-400">Drift: <span className={`font-bold ${Math.abs(acc.drift) <= 10 ? 'text-emerald-400' : 'text-amber-400'}`}>{acc.drift > 0 ? '+' : ''}{acc.drift}</span></span>
              <span className="text-zinc-400">MAE: <span className="text-zinc-200 font-bold">{acc.mean_abs_error}</span></span>
              <span className="text-zinc-600">n={acc.n} / 200 target</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
              {dims.map(([label, rows]) => rows.length > 0 && (
                <div key={label} className="rounded-lg border border-zinc-800/60 p-2.5">
                  <p className="text-[9px] text-zinc-600 uppercase tracking-wider mb-1">{label}</p>
                  {rows.map(r => (
                    <div key={r.value} className="flex items-center gap-2 text-[10px] font-mono">
                      <span className="text-zinc-400 truncate flex-1">{r.value}</span>
                      <span className="text-purple-300">{r.predicted_wr}%</span>
                      <span className="text-zinc-500">â†’</span>
                      <span className="text-zinc-200">{r.actual_wr}%</span>
                      <span className={r.calibrated ? 'text-emerald-500' : 'text-red-400'}>{r.calibrated ? 'âœ“' : 'âœ—'}</span>
                      <span className={`${r.low_sample ? 'text-amber-500' : 'text-zinc-600'}`}>n={r.n}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </>
        ) : <p className="text-zinc-600 text-xs">No resolved stamped signals yet â€” predictions began accumulating with the Probability Engine deploy.</p>}
      </div>

      {/* Grade validation */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <GradeValidationTable title="RiskGrade 2.0 (empirical) â€” actual performance"
          rows={v.grades.empirical}
          inversions={[...v.grades.empirical_inversions_wr, ...v.grades.empirical_inversions_exp]} />
        <GradeValidationTable title="Heuristic Aâ€“F â€” actual performance"
          rows={v.grades.heuristic}
          inversions={v.grades.heuristic_inversions_wr} />
      </div>

      {/* Edge stability */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
        <p className="text-[9px] text-zinc-500 uppercase tracking-widest mb-2">Edge Stability â€” top-cohort retention across windows</p>
        <div className="flex gap-6 flex-wrap text-xs font-mono mb-2">
          <span className="text-zinc-400">7d vs 30d: <span className="text-zinc-200 font-bold">J={v.stability.overlap_7v30.jaccard ?? 'â€”'}</span> Â· top3 kept {v.stability.overlap_7v30.top3_retained}/3</span>
          <span className="text-zinc-400">30d vs 90d: <span className="text-zinc-200 font-bold">J={v.stability.overlap_30v90.jaccard ?? 'â€”'}</span> Â· top3 kept {v.stability.overlap_30v90.top3_retained}/3</span>
        </div>
        <div className="flex gap-4 flex-wrap">
          {Object.entries(v.stability.regime_distribution).map(([win, dist]) => (
            <div key={win} className="text-[10px] font-mono text-zinc-500">
              <span className="text-zinc-400 uppercase">{win}:</span>{' '}
              {Object.entries(dist).map(([r, n]) => `${r} ${n}`).join(' Â· ')}
            </div>
          ))}
        </div>
        <p className="text-[10px] text-zinc-600 mt-2 leading-relaxed">
          Low 7d-vs-30d overlap reflects the regime mix shifting (cohort rankings are regime-conditional by design) â€”
          not cohort decay. 30d-vs-90d is trivially identical until outcome history exceeds 30 days.
        </p>
      </div>
    </div>
  )
}

// â”€â”€â”€ Track Record tab (with CalibrationHealthPanel appended) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function TrackRecordWithCalibration({
  data,
  loading,
  edge,
  attribution,
}: {
  data: import('@/lib/admin-api').TrackRecordResponse | null
  loading: boolean
  edge: EdgeReport | null
  attribution: AttributionReport | null | undefined
}) {
  return (
    <div className="space-y-6">
      <TrackRecordTab data={data} loading={loading} />
      <CalibrationHealthPanel
        bands={edge?.confidence_calibration?.bands}
        byGrade={attribution?.dimensions?.byGrade}
      />
    </div>
  )
}

// â”€â”€â”€ Edge tab (with Edge Matrix appended, Intelligence/Confidence Tiers removed) â”€

function EdgeMatrixSection() {
  const edgeFetcher = useCallback(() => adminApi.analytics.edgeMatrix().catch(() => null), [])
  const { data: matrix } = useAutoRefresh<import('@/lib/admin-api').EdgeMatrixResponse | null>(edgeFetcher, 300_000)

  if (!matrix || matrix.top.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-8 text-center text-zinc-600 text-sm">
        Edge Matrix populates from nightly attribution snapshots â€” first generation after 00:15 UTC.
      </div>
    )
  }

  return (
    <>
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 overflow-x-auto">
        <p className="text-[9px] text-zinc-500 uppercase tracking-widest mb-2">
          Edge Matrix â€” Top combinations by expectancy (30d snapshots, n â‰¥ {matrix.min_n}, Wilson 95% CI)
        </p>
        <table className="w-full text-xs min-w-[640px]">
          <thead>
            <tr className="border-b border-zinc-700 text-[9px] uppercase tracking-wider text-zinc-500">
              <th className="text-left py-1.5 px-3">Dimension</th><th className="text-left py-1.5 px-3">Cohort</th>
              <th className="text-right py-1.5 px-3">WR</th><th className="text-right py-1.5 px-3">CI</th>
              <th className="text-right py-1.5 px-3">Exp</th><th className="text-right py-1.5 px-3">PF</th>
              <th className="text-right py-1.5 px-3">n</th>
            </tr>
          </thead>
          <tbody>{matrix.top.slice(0, 25).map((c, i) => <EdgeCellRow key={i} c={c} />)}</tbody>
        </table>
      </div>
      <div className="bg-zinc-900 border border-red-900/30 rounded-xl p-4 overflow-x-auto">
        <p className="text-[9px] text-red-400/70 uppercase tracking-widest mb-2">Worst cohorts â€” avoid / gate these</p>
        <table className="w-full text-xs min-w-[640px]">
          <tbody>{matrix.bottom.map((c, i) => <EdgeCellRow key={i} c={c} />)}</tbody>
        </table>
      </div>
      <p className="text-zinc-700 text-[10px] font-mono">
        Derived entirely from signal_outcomes via attribution snapshots Â· no ML Â· empirical grades: A+ â‰¥1.0R Â· A â‰¥0.6 Â· B+ â‰¥0.35 Â· B â‰¥0.15 Â· C â‰¥0 Â· D &lt;0
      </p>
    </>
  )
}

function EdgeTab({ edge, loading }: {
  edge: EdgeReport | null; loading: boolean
  matrix?: import('@/lib/admin-api').EdgeMatrixResponse | null
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
            <p className="text-signal-medium text-sm font-semibold">â—Œ Edge analytics warming up</p>
            <p className="text-terminal-muted text-xs leading-relaxed">
              Statistical edge verdicts require a minimum of 30 resolved signals (TP hit, SL hit, or timeout). Keep running scans â€” outcomes are resolved automatically as price reaches target or stop levels.
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
              <StatPair label="Win Rate"     value={overall?.win_rate != null ? `${(Number(overall.win_rate) * 100).toFixed(1)}%` : 'â€”'} accent={overall?.win_rate && Number(overall.win_rate) >= 0.55 ? 'text-bull-default' : 'text-bear-default'} />
              <StatPair label="Expectancy"   value={overall?.expectancy != null ? `${Number(overall.expectancy) > 0 ? '+' : ''}${Number(overall.expectancy).toFixed(2)}R` : 'â€”'} accent={overall?.expectancy && Number(overall.expectancy) > 0 ? 'text-bull-default' : 'text-bear-default'} />
              <StatPair label="Profit Factor" value={overall?.profit_factor != null ? Number(overall.profit_factor).toFixed(2) : 'â€”'} accent={overall?.profit_factor && Number(overall.profit_factor) >= 1.5 ? 'text-bull-default' : 'text-terminal-text'} />
              <StatPair label="Max DD"       value={overall?.max_drawdown_r != null ? `${Number(overall.max_drawdown_r).toFixed(1)}R` : 'â€”'} accent="text-bear-default" />
              <StatPair label="Sharpe"       value={overall?.sharpe != null ? Number(overall.sharpe).toFixed(2) : 'â€”'} accent={overall?.sharpe && Number(overall.sharpe) > 1 ? 'text-bull-default' : 'text-terminal-text'} />
            </div>
          )}
          {!loading && (!overall || overall.total === 0) && (
            <p className="text-terminal-muted/50 text-xs mt-4 pt-4 border-t border-terminal-border/50">
              No resolved signals yet â€” statistics will appear after signals reach their TP / SL targets.
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
            Calibration bands require resolved signals across multiple confidence tiers (70â€“100). Run scans in different modes to build a diverse signal pool.
          </p>
        </div>
      )}
      {cal && cal.calibration && (
        <div>
          <p className="text-terminal-muted text-xs uppercase tracking-wider mb-3">Confidence Calibration</p>
          <div className="glass-card rounded-lg overflow-hidden">
            <div className="px-5 py-3 border-b border-terminal-border flex items-center gap-4 flex-wrap">
              <span className="text-terminal-muted text-xs">ECE:</span>
              <span className={`font-mono text-sm font-bold ${Number(cal.calibration.ece) < 0.05 ? 'text-bull-default' : Number(cal.calibration.ece) < 0.12 ? 'text-signal-high' : 'text-bear-default'}`}>
                {Number(cal.calibration.ece).toFixed(4)}
              </span>
              <span className="text-terminal-muted text-xs">Label:</span>
              <span className="text-terminal-text text-xs font-mono">{cal.calibration.label.replace(/_/g, ' ')}</span>
              <span className="text-terminal-muted text-xs">Monotone:</span>
              <span className={`text-xs font-mono ${cal.calibration.is_monotone ? 'text-bull-default' : 'text-bear-default'}`}>
                {cal.calibration.is_monotone === null ? 'â€”' : cal.calibration.is_monotone ? 'yes' : 'no'}
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

      {/* Scanner Mode Performance */}
      {edge?.scanner_mode_analysis && !edge.scanner_mode_analysis.insufficient_data && (
        <div>
          <p className="text-terminal-muted text-xs uppercase tracking-wider mb-3">
            Scanner Mode Performance â€” {analyticsWindowLabel(edge.window_hours)}
          </p>
          <div className="glass-card rounded-lg overflow-hidden overflow-x-auto">
            <table className="w-full text-xs min-w-[380px]">
              <thead>
                <tr className="border-b border-terminal-border">
                  {['Mode', 'Resolved', 'Win Rate', 'Expectancy', 'PF', 'Per Day'].map(h => (
                    <th key={h} className="text-terminal-muted text-xs uppercase tracking-wider text-left py-2 px-3 font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(edge.scanner_mode_analysis.ranked_by_expectancy ?? []).map(mode => {
                  const m = edge.scanner_mode_analysis!.modes[mode]
                  if (!m) return null
                  const modeLabel = mode === 'high_confidence' ? 'High Conf' : mode.charAt(0).toUpperCase() + mode.slice(1)
                  return (
                    <tr key={mode} className="border-b border-terminal-border/30 hover:bg-terminal-bright/10">
                      <td className="py-2 px-3 font-medium text-terminal-text">{modeLabel}</td>
                      <td className="py-2 px-3 font-mono text-terminal-muted">{m.total}</td>
                      <td className="py-2 px-3 font-mono">
                        {m.win_rate != null
                          ? <span className={m.win_rate >= 0.55 ? 'text-bull-default' : m.win_rate >= 0.45 ? 'text-signal-high' : 'text-bear-default'}>
                              {(m.win_rate * 100).toFixed(1)}%
                            </span>
                          : <span className="text-terminal-muted/40">â€”</span>}
                      </td>
                      <td className="py-2 px-3 font-mono">
                        {m.expectancy != null
                          ? <span className={Number(m.expectancy) > 0 ? 'text-bull-default' : 'text-bear-default'}>
                              {Number(m.expectancy) > 0 ? '+' : ''}{Number(m.expectancy).toFixed(2)}R
                            </span>
                          : <span className="text-terminal-muted/40">â€”</span>}
                      </td>
                      <td className="py-2 px-3 font-mono text-terminal-muted">
                        {m.profit_factor != null ? Number(m.profit_factor).toFixed(2) : 'â€”'}
                      </td>
                      <td className="py-2 px-3 font-mono text-terminal-muted">
                        {m.signals_per_day != null ? Number(m.signals_per_day).toFixed(1) : 'â€”'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Market Regime Performance */}
      {edge?.market_regime_analysis && !edge.market_regime_analysis.insufficient_data && (
        <div>
          <p className="text-terminal-muted text-xs uppercase tracking-wider mb-3">
            Regime Performance â€” {analyticsWindowLabel(edge.window_hours)}
            {(edge.market_regime_analysis.recommended_avoid ?? []).length > 0 && (
              <span className="ml-2 text-bear-default normal-case">
                Avoid: {(edge.market_regime_analysis.recommended_avoid ?? []).join(', ')}
              </span>
            )}
          </p>
          <div className="glass-card rounded-lg overflow-hidden overflow-x-auto">
            <table className="w-full text-xs min-w-[340px]">
              <thead>
                <tr className="border-b border-terminal-border">
                  {['Regime', 'Resolved', 'Win Rate', 'Expectancy', 'PF'].map(h => (
                    <th key={h} className="text-terminal-muted text-xs uppercase tracking-wider text-left py-2 px-3 font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(edge.market_regime_analysis.ranked_by_expectancy ?? []).map(regime => {
                  const r = edge.market_regime_analysis!.regimes[regime]
                  if (!r) return null
                  const isAvoid  = (edge.market_regime_analysis!.recommended_avoid ?? []).includes(regime)
                  const isPrefer = (edge.market_regime_analysis!.recommended_prefer ?? []).includes(regime)
                  return (
                    <tr key={regime} className="border-b border-terminal-border/30 hover:bg-terminal-bright/10">
                      <td className="py-2 px-3 font-medium flex items-center gap-1.5">
                        <span className={isAvoid ? 'text-bear-default' : isPrefer ? 'text-bull-default' : 'text-terminal-text'}>
                          {regime.toUpperCase()}
                        </span>
                        {isAvoid  && <span className="text-[9px] text-bear-default/70 border border-bear-default/20 px-1 rounded">avoid</span>}
                        {isPrefer && <span className="text-[9px] text-bull-default/70 border border-bull-default/20 px-1 rounded">prefer</span>}
                      </td>
                      <td className="py-2 px-3 font-mono text-terminal-muted">{r.total}</td>
                      <td className="py-2 px-3 font-mono">
                        {r.win_rate != null
                          ? <span className={r.win_rate >= 0.55 ? 'text-bull-default' : r.win_rate >= 0.45 ? 'text-signal-high' : 'text-bear-default'}>
                              {(r.win_rate * 100).toFixed(1)}%
                            </span>
                          : <span className="text-terminal-muted/40">â€”</span>}
                      </td>
                      <td className="py-2 px-3 font-mono">
                        {r.expectancy != null
                          ? <span className={Number(r.expectancy) > 0 ? 'text-bull-default' : 'text-bear-default'}>
                              {Number(r.expectancy) > 0 ? '+' : ''}{Number(r.expectancy).toFixed(2)}R
                            </span>
                          : <span className="text-terminal-muted/40">â€”</span>}
                      </td>
                      <td className="py-2 px-3 font-mono text-terminal-muted">
                        {r.profit_factor != null ? Number(r.profit_factor).toFixed(2) : 'â€”'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Per-Coin Performance */}
      {edge?.coin_performance && !edge.coin_performance.insufficient_data && (
        <div>
          <p className="text-terminal-muted text-xs uppercase tracking-wider mb-3">
            Top Coins by Expectancy â€” {analyticsWindowLabel(edge.window_hours)}
            <span className="ml-2 text-terminal-muted/50 normal-case font-normal">
              {edge.coin_performance.total_symbols_seen} symbols seen
            </span>
          </p>
          <div className="glass-card rounded-lg overflow-hidden overflow-x-auto">
            <table className="w-full text-xs min-w-[420px]">
              <thead>
                <tr className="border-b border-terminal-border">
                  {['Coin', 'Resolved', 'Win Rate', 'Expectancy', 'PF', 'Max DD'].map(h => (
                    <th key={h} className="text-terminal-muted text-xs uppercase tracking-wider text-left py-2 px-3 font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(edge.coin_performance.best_by_expectancy ?? []).slice(0, 10).map(sym => {
                  const c = edge.coin_performance!.coins[sym]
                  if (!c) return null
                  const isBestWR  = (edge.coin_performance!.best_by_win_rate ?? []).includes(sym)
                  const isWorstDD = (edge.coin_performance!.worst_by_drawdown ?? []).includes(sym)
                  return (
                    <tr key={sym} className="border-b border-terminal-border/30 hover:bg-terminal-bright/10">
                      <td className="py-2 px-3 font-medium font-mono">
                        <span className="text-terminal-text">{sym}</span>
                        {isBestWR  && <span className="ml-1.5 text-[9px] text-bull-default/70 border border-bull-default/20 px-1 rounded">top WR</span>}
                        {isWorstDD && <span className="ml-1.5 text-[9px] text-bear-default/70 border border-bear-default/20 px-1 rounded">high DD</span>}
                      </td>
                      <td className="py-2 px-3 font-mono text-terminal-muted">{c.total}</td>
                      <td className="py-2 px-3 font-mono">
                        {c.win_rate != null
                          ? <span className={c.win_rate >= 0.55 ? 'text-bull-default' : c.win_rate >= 0.45 ? 'text-signal-high' : 'text-bear-default'}>
                              {(c.win_rate * 100).toFixed(1)}%
                            </span>
                          : <span className="text-terminal-muted/40">â€”</span>}
                      </td>
                      <td className="py-2 px-3 font-mono">
                        {c.expectancy != null
                          ? <span className={Number(c.expectancy) > 0 ? 'text-bull-default' : 'text-bear-default'}>
                              {Number(c.expectancy) > 0 ? '+' : ''}{Number(c.expectancy).toFixed(2)}R
                            </span>
                          : <span className="text-terminal-muted/40">â€”</span>}
                      </td>
                      <td className="py-2 px-3 font-mono text-terminal-muted">
                        {c.profit_factor != null ? Number(c.profit_factor).toFixed(2) : 'â€”'}
                      </td>
                      <td className="py-2 px-3 font-mono">
                        {c.max_drawdown_r != null
                          ? <span className={Number(c.max_drawdown_r) > 2 ? 'text-bear-default' : 'text-terminal-muted'}>
                              {Number(c.max_drawdown_r).toFixed(2)}R
                            </span>
                          : <span className="text-terminal-muted/40">â€”</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {edge && (
        <p className="text-terminal-muted/40 text-xs font-mono">
          Generated {formatTs(edge.generated_at)} - {explicitWindowNote(edge.window_hours)}
        </p>
      )}

      {/* Edge Matrix (moved from Probability tab) */}
      <EdgeMatrixSection />
    </div>
  )
}

export default function AnalyticsPage() {
  const [tab, setTab] = useState<Tab>('trackRecord')

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab') as Tab | null
    if (t && ['trackRecord', 'edge', 'attribution'].includes(t)) setTab(t)
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

  const trackRecordFetcher = useCallback(() => adminApi.analytics.trackRecord(), [])
  const { data: trackRecord, loading: trackLoading } = useAutoRefresh<import('@/lib/admin-api').TrackRecordResponse>(trackRecordFetcher, 300_000)

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-terminal-text text-xl font-semibold">Quantitative Analytics</h1>
        <p className="text-terminal-muted text-sm mt-1">Edge validation Â· Attribution intelligence Â· AI calibration</p>
      </div>

      {/* Tab nav */}
      <div className="flex gap-1 border-b border-terminal-border pb-0">
        <button
          onClick={() => setTab('trackRecord')}
          className={`px-4 py-2 text-xs font-mono uppercase tracking-wider border-b-2 transition-colors ${
            tab === 'trackRecord'
              ? 'border-terminal-text text-terminal-text'
              : 'border-transparent text-terminal-muted hover:text-terminal-text/70'
          }`}
        >
          Track Record
        </button>
        <button
          onClick={() => setTab('edge')}
          className={`px-4 py-2 text-xs font-mono uppercase tracking-wider border-b-2 transition-colors ${
            tab === 'edge'
              ? 'border-terminal-text text-terminal-text'
              : 'border-transparent text-terminal-muted hover:text-terminal-text/70'
          }`}
        >
          Edge
        </button>
        <button
          onClick={() => setTab('attribution')}
          className={`px-4 py-2 text-xs font-mono uppercase tracking-wider border-b-2 transition-colors ${
            tab === 'attribution'
              ? 'border-terminal-text text-terminal-text'
              : 'border-transparent text-terminal-muted hover:text-terminal-text/70'
          }`}
        >
          Attribution
        </button>
      </div>

      {tab === 'trackRecord' && <TrackRecordWithCalibration data={trackRecord ?? null} loading={trackLoading} edge={edge ?? null} attribution={attribution} />}
      {tab === 'edge'        && <EdgeTab edge={edge ?? null} loading={edgeLoading} matrix={null} />}
      {tab === 'attribution' && <AttributionTab data={attribution ?? null} loading={attrLoading} />}
    </div>
  )
}
