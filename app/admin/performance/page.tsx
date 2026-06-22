'use client'

import { useCallback, useState, useEffect } from 'react'
import { adminApi, EdgeReport, IntelligenceSummary, IntelligencePerfRow } from '@/lib/admin-api'
import { useAutoRefresh } from '@/lib/use-auto-refresh'
import { formatTs } from '@/lib/utils'
import { analyticsWindowLabel, explicitWindowNote } from '@/lib/window-label'
import type { AttributionReport, AttributionDimension, EdgePattern, ThresholdRecommendation } from '@/types'

// ─── Shared primitives ────────────────────────────────────────────────────────

// asyncpg/Pydantic v2 serialises PostgreSQL NUMERIC columns as JSON strings.
function toNum(v: unknown): number | null {
  if (v == null) return null
  const n = Number(v)
  return isNaN(n) ? null : n
}

function StatPair({ label, value, accent = '' }: { label: string; value: string; accent?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-zinc-500 text-xs">{label}</span>
      <span className={`font-mono font-bold text-lg ${accent || 'text-zinc-200'}`}>{value}</span>
    </div>
  )
}

function pct(n: unknown): string {
  const v = toNum(n)
  return v != null ? `${(v * 100).toFixed(1)}%` : '—'
}
function exp(n: unknown): string {
  const v = toNum(n)
  if (v == null) return '—'
  return v > 0 ? `+${v.toFixed(2)}R` : `${v.toFixed(2)}R`
}
function rr(n: unknown): string {
  const v = toNum(n)
  return v != null ? `${v.toFixed(2)}R` : '—'
}

// ─── Edge Validation tab ──────────────────────────────────────────────────────

function CalibrationTable({ bands }: { bands: EdgeReport['confidence_calibration']['bands'] | null | undefined }) {
  if (!bands) return null
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs min-w-[380px]">
        <thead>
          <tr className="border-b border-zinc-800">
            <th className="text-zinc-500 text-xs text-left py-2 px-3 font-medium">Band</th>
            <th className="text-zinc-500 text-xs text-left py-2 px-3 font-medium">Signals</th>
            <th className="text-zinc-500 text-xs text-left py-2 px-3 font-medium">Win Rate</th>
            <th className="text-zinc-500 text-xs text-left py-2 px-3 font-medium hidden sm:table-cell">Expectancy</th>
            <th className="text-zinc-500 text-xs text-left py-2 px-3 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {bands.map(b => (
            <tr key={b.label} className="border-b border-zinc-800/30 hover:bg-zinc-700/10">
              <td className="py-2.5 px-3 font-mono text-zinc-200">{b.label}</td>
              <td className="py-2.5 px-3 font-mono text-zinc-500">{b.total}</td>
              <td className="py-2.5 px-3 font-mono">
                {b.insufficient_data || b.win_rate == null
                  ? <span className="text-zinc-500/40">—</span>
                  : <span className={b.win_rate >= 0.55 ? 'text-bull-default' : 'text-bear-default'}>
                      {(b.win_rate * 100).toFixed(1)}%
                    </span>
                }
              </td>
              <td className="py-2.5 px-3 font-mono hidden sm:table-cell">
                {b.insufficient_data || b.expectancy == null
                  ? <span className="text-zinc-500/40">—</span>
                  : <span className={Number(b.expectancy) > 0 ? 'text-bull-default' : 'text-bear-default'}>
                      {Number(b.expectancy) > 0 ? '+' : ''}{Number(b.expectancy).toFixed(2)}R
                    </span>
                }
              </td>
              <td className="py-2.5 px-3">
                {b.insufficient_data
                  ? <span className="text-[10px] text-zinc-500/40 border border-zinc-800 rounded px-1.5 py-0.5">WARMING</span>
                  : <span className="text-[10px] text-zinc-400/70 border border-zinc-700/50 rounded px-1.5 py-0.5">OK</span>
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
    <div className="flex items-center justify-between py-2 border-b border-zinc-800/20 last:border-0">
      <span className="text-zinc-500 text-xs w-44 shrink-0">{label}</span>
      <span className="text-zinc-500/40 text-xs font-mono">no data</span>
    </div>
  )
  const wr = row.win_rate
  return (
    <div className="flex items-center justify-between py-2 border-b border-zinc-800/20 last:border-0 gap-2 flex-wrap">
      <span className="text-zinc-500 text-xs w-44 shrink-0">{label}</span>
      <span className="text-zinc-200 text-xs font-medium flex-1 min-w-0 truncate">{row.label}</span>
      <div className="flex items-center gap-4 shrink-0">
        <span className={`font-mono text-xs font-bold ${wr != null && wr >= 0.4 ? 'text-bull-default' : wr != null && wr >= 0.3 ? 'text-signal-high' : 'text-bear-default'}`}>
          {wr != null ? `${(wr * 100).toFixed(1)}%` : '—'}
        </span>
        <span className="text-zinc-500 text-xs font-mono">
          {row.avg_rr != null ? `${Number(row.avg_rr).toFixed(2)}R` : '—'}
        </span>
        <span className="text-zinc-500/50 text-xs font-mono">n={row.n}</span>
      </div>
    </div>
  )
}

function IntelligenceSection({ data, loading }: { data: IntelligenceSummary | null; loading: boolean }) {
  if (loading) return (
    <div className="glass-card rounded-lg p-5">
      <p className="text-zinc-500 text-xs uppercase tracking-wide mb-3">Intelligence Performance</p>
      <div className="space-y-2">{Array.from({ length: 7 }).map((_, i) => <div key={i} className="skeleton h-7 rounded" />)}</div>
    </div>
  )
  if (!data || data.insufficient_data) return (
    <div className="glass-card rounded-lg p-5">
      <p className="text-zinc-500 text-xs uppercase tracking-wide mb-2">Intelligence Performance</p>
      <p className="text-zinc-500/60 text-xs leading-relaxed">
        Intelligence breakdowns require at least 5 resolved outcomes per tier. Warming up — data populates as signals resolve.
        {data && ` Total resolved: ${data.total}.`}
      </p>
    </div>
  )
  return (
    <div>
      <p className="text-zinc-500 text-xs uppercase tracking-wide mb-3">Intelligence Performance — Best Tier per Dimension</p>
      <div className="glass-card rounded-lg p-5">
        <div className="flex items-center gap-4 mb-4 text-zinc-500/50 text-[10px] font-mono uppercase tracking-wider">
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
        <p className="text-zinc-500/30 text-xs font-mono mt-4 pt-3 border-t border-zinc-800/20">
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
    none: 'text-bear-default', insufficient_data: 'text-zinc-500',
  }

  return (
    <div className="space-y-6">
      {/* Edge verdict */}
      <div className="glass-card rounded-lg p-5">
        <p className="text-zinc-500 text-xs uppercase tracking-wide mb-4">Edge Verdict</p>
        {loading ? (
          <div className="space-y-2">
            <div className="skeleton h-6 w-48 rounded" />
            <div className="skeleton h-3 w-full rounded" />
          </div>
        ) : verdict?.confidence_level === 'insufficient_data' || !verdict ? (
          <div className="flex flex-col gap-2">
            <p className="text-signal-medium text-sm font-semibold">◌ Edge analytics warming up</p>
            <p className="text-zinc-500 text-xs leading-relaxed">
              Statistical edge verdicts require a minimum of 30 resolved signals (TP hit, SL hit, or timeout). Keep running scans — outcomes are resolved automatically as price reaches target or stop levels.
            </p>
            {edge && (
              <p className="text-zinc-500/50 text-xs font-mono mt-1">
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
            <p className="text-zinc-500 text-xs">{verdict.summary}</p>
          </>
        )}
      </div>

      {/* Overall stats */}
      <div>
        <p className="text-zinc-500 text-xs uppercase tracking-wide mb-3">
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
              <StatPair label="Win Rate"     value={overall?.win_rate != null ? `${(Number(overall.win_rate) * 100).toFixed(1)}%` : '—'} accent={overall?.win_rate && Number(overall.win_rate) >= 0.55 ? 'text-bull-default' : 'text-bear-default'} />
              <StatPair label="Expectancy"   value={overall?.expectancy != null ? `${Number(overall.expectancy) > 0 ? '+' : ''}${Number(overall.expectancy).toFixed(2)}R` : '—'} accent={overall?.expectancy && Number(overall.expectancy) > 0 ? 'text-bull-default' : 'text-bear-default'} />
              <StatPair label="Profit Factor" value={overall?.profit_factor != null ? Number(overall.profit_factor).toFixed(2) : '—'} accent={overall?.profit_factor && Number(overall.profit_factor) >= 1.5 ? 'text-bull-default' : 'text-zinc-200'} />
              <StatPair label="Max DD"       value={overall?.max_drawdown_r != null ? `${Number(overall.max_drawdown_r).toFixed(1)}R` : '—'} accent="text-bear-default" />
              <StatPair label="Sharpe"       value={overall?.sharpe_ratio != null ? Number(overall.sharpe_ratio).toFixed(2) : '—'} accent={overall?.sharpe_ratio && Number(overall.sharpe_ratio) > 1 ? 'text-bull-default' : 'text-zinc-200'} />
            </div>
          )}
          {!loading && (!overall || overall.total === 0) && (
            <p className="text-zinc-500/50 text-xs mt-4 pt-4 border-t border-zinc-800/50">
              No resolved signals yet — statistics will appear after signals reach their TP / SL targets.
            </p>
          )}
          {overall && overall.total > 0 && (
            <div className="mt-4 pt-4 border-t border-zinc-800/50 flex gap-6 text-xs font-mono text-zinc-500">
              <span>TP: <span className="text-bull-default">{overall.tp_hits}</span></span>
              <span>SL: <span className="text-bear-default">{overall.sl_hits}</span></span>
              <span>TO: <span className="text-amber-400">{overall.timeouts}</span></span>
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
          <p className="text-zinc-500 text-xs uppercase tracking-wide mb-3">Confidence Calibration</p>
          <p className="text-zinc-500/60 text-xs leading-relaxed">
            Calibration bands require resolved signals across multiple confidence tiers (70–100). Run scans in different modes to build a diverse signal pool.
          </p>
        </div>
      )}
      {cal && cal.calibration && (
        <div>
          <p className="text-zinc-500 text-xs uppercase tracking-wide mb-3">Confidence Calibration</p>
          <div className="glass-card rounded-lg overflow-hidden">
            <div className="px-5 py-3 border-b border-zinc-800 flex items-center gap-4 flex-wrap">
              <span className="text-zinc-500 text-xs">ECE:</span>
              <span className={`font-mono text-sm font-bold ${Number(cal.calibration.ece) < 0.05 ? 'text-bull-default' : Number(cal.calibration.ece) < 0.12 ? 'text-signal-high' : 'text-bear-default'}`}>
                {Number(cal.calibration.ece).toFixed(4)}
              </span>
              <span className="text-zinc-500 text-xs">Label:</span>
              <span className="text-zinc-200 text-xs font-mono">{cal.calibration.label.replace(/_/g, ' ')}</span>
              <span className="text-zinc-500 text-xs">Monotone:</span>
              <span className={`text-xs font-mono ${cal.calibration.is_monotone ? 'text-emerald-400' : 'text-red-400'}`}>
                {cal.calibration.is_monotone === null ? '—' : cal.calibration.is_monotone ? 'yes' : 'no'}
              </span>
              {cal.optimal_threshold != null && (
                <>
                  <span className="text-zinc-500 text-xs">Optimal threshold:</span>
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
          <p className="text-zinc-500 text-xs uppercase tracking-wide mb-3">
            Scanner Mode Performance — {analyticsWindowLabel(edge.window_hours)}
          </p>
          <div className="glass-card rounded-lg overflow-hidden overflow-x-auto">
            <table className="w-full text-xs min-w-[380px]">
              <thead>
                <tr className="border-b border-zinc-800">
                  {['Mode', 'Resolved', 'Win Rate', 'Expectancy', 'PF', 'Per Day'].map(h => (
                    <th key={h} className="text-zinc-500 text-xs text-left py-2 px-3 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(edge.scanner_mode_analysis.ranked_by_expectancy ?? []).map(mode => {
                  const m = edge.scanner_mode_analysis!.modes[mode]
                  if (!m) return null
                  const modeLabel = mode === 'high_confidence' ? 'High Conf' : mode.charAt(0).toUpperCase() + mode.slice(1)
                  return (
                    <tr key={mode} className="border-b border-zinc-800/30 hover:bg-zinc-700/10">
                      <td className="py-2 px-3 font-medium text-zinc-200">{modeLabel}</td>
                      <td className="py-2 px-3 font-mono text-zinc-500">{m.total}</td>
                      <td className="py-2 px-3 font-mono">
                        {m.win_rate != null
                          ? <span className={m.win_rate >= 0.55 ? 'text-bull-default' : m.win_rate >= 0.45 ? 'text-signal-high' : 'text-bear-default'}>
                              {(m.win_rate * 100).toFixed(1)}%
                            </span>
                          : <span className="text-zinc-500/40">—</span>}
                      </td>
                      <td className="py-2 px-3 font-mono">
                        {m.expectancy != null
                          ? <span className={Number(m.expectancy) > 0 ? 'text-bull-default' : 'text-bear-default'}>
                              {Number(m.expectancy) > 0 ? '+' : ''}{Number(m.expectancy).toFixed(2)}R
                            </span>
                          : <span className="text-zinc-500/40">—</span>}
                      </td>
                      <td className="py-2 px-3 font-mono text-zinc-500">
                        {m.profit_factor != null ? Number(m.profit_factor).toFixed(2) : '—'}
                      </td>
                      <td className="py-2 px-3 font-mono text-zinc-500">
                        {m.signals_per_day != null ? Number(m.signals_per_day).toFixed(1) : '—'}
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
          <p className="text-zinc-500 text-xs uppercase tracking-wide mb-3">
            Regime Performance — {analyticsWindowLabel(edge.window_hours)}
            {(edge.market_regime_analysis.recommended_avoid ?? []).length > 0 && (
              <span className="ml-2 text-bear-default normal-case">
                Avoid: {(edge.market_regime_analysis.recommended_avoid ?? []).join(', ')}
              </span>
            )}
          </p>
          <div className="glass-card rounded-lg overflow-hidden overflow-x-auto">
            <table className="w-full text-xs min-w-[340px]">
              <thead>
                <tr className="border-b border-zinc-800">
                  {['Regime', 'Resolved', 'Win Rate', 'Expectancy', 'PF'].map(h => (
                    <th key={h} className="text-zinc-500 text-xs text-left py-2 px-3 font-medium">{h}</th>
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
                    <tr key={regime} className="border-b border-zinc-800/30 hover:bg-zinc-700/10">
                      <td className="py-2 px-3 font-medium flex items-center gap-1.5">
                        <span className={isAvoid ? 'text-bear-default' : isPrefer ? 'text-bull-default' : 'text-zinc-200'}>
                          {regime.toUpperCase()}
                        </span>
                        {isAvoid  && <span className="text-[10px] text-bear-default/70 border border-bear-default/20 px-1 rounded">avoid</span>}
                        {isPrefer && <span className="text-[10px] text-bull-default/70 border border-bull-default/20 px-1 rounded">prefer</span>}
                      </td>
                      <td className="py-2 px-3 font-mono text-zinc-500">{r.total}</td>
                      <td className="py-2 px-3 font-mono">
                        {r.win_rate != null
                          ? <span className={r.win_rate >= 0.55 ? 'text-bull-default' : r.win_rate >= 0.45 ? 'text-signal-high' : 'text-bear-default'}>
                              {(r.win_rate * 100).toFixed(1)}%
                            </span>
                          : <span className="text-zinc-500/40">—</span>}
                      </td>
                      <td className="py-2 px-3 font-mono">
                        {r.expectancy != null
                          ? <span className={Number(r.expectancy) > 0 ? 'text-bull-default' : 'text-bear-default'}>
                              {Number(r.expectancy) > 0 ? '+' : ''}{Number(r.expectancy).toFixed(2)}R
                            </span>
                          : <span className="text-zinc-500/40">—</span>}
                      </td>
                      <td className="py-2 px-3 font-mono text-zinc-500">
                        {r.profit_factor != null ? Number(r.profit_factor).toFixed(2) : '—'}
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
          <p className="text-zinc-500 text-xs uppercase tracking-wide mb-3">
            Top Coins by Expectancy — {analyticsWindowLabel(edge.window_hours)}
            <span className="ml-2 text-zinc-500/50 normal-case font-normal">
              {edge.coin_performance.total_symbols_seen} symbols seen
            </span>
          </p>
          <div className="glass-card rounded-lg overflow-hidden overflow-x-auto">
            <table className="w-full text-xs min-w-[420px]">
              <thead>
                <tr className="border-b border-zinc-800">
                  {['Coin', 'Resolved', 'Win Rate', 'Expectancy', 'PF', 'Max DD'].map(h => (
                    <th key={h} className="text-zinc-500 text-xs text-left py-2 px-3 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(edge.coin_performance.best_by_expectancy ?? []).slice(0, 5).map(sym => {
                  const c = edge.coin_performance!.coins[sym]
                  if (!c) return null
                  const isBestWR  = (edge.coin_performance!.best_by_win_rate ?? []).includes(sym)
                  const isWorstDD = (edge.coin_performance!.worst_by_drawdown ?? []).includes(sym)
                  return (
                    <tr key={sym} className="border-b border-zinc-800/30 hover:bg-zinc-700/10">
                      <td className="py-2 px-3 font-medium font-mono">
                        <span className="text-zinc-200">{sym}</span>
                        {isBestWR  && <span className="ml-1.5 text-[10px] text-bull-default/70 border border-bull-default/20 px-1 rounded">top WR</span>}
                        {isWorstDD && <span className="ml-1.5 text-[10px] text-bear-default/70 border border-bear-default/20 px-1 rounded">high DD</span>}
                      </td>
                      <td className="py-2 px-3 font-mono text-zinc-500">{c.total}</td>
                      <td className="py-2 px-3 font-mono">
                        {c.win_rate != null
                          ? <span className={c.win_rate >= 0.55 ? 'text-bull-default' : c.win_rate >= 0.45 ? 'text-signal-high' : 'text-bear-default'}>
                              {(c.win_rate * 100).toFixed(1)}%
                            </span>
                          : <span className="text-zinc-500/40">—</span>}
                      </td>
                      <td className="py-2 px-3 font-mono">
                        {c.expectancy != null
                          ? <span className={Number(c.expectancy) > 0 ? 'text-bull-default' : 'text-bear-default'}>
                              {Number(c.expectancy) > 0 ? '+' : ''}{Number(c.expectancy).toFixed(2)}R
                            </span>
                          : <span className="text-zinc-500/40">—</span>}
                      </td>
                      <td className="py-2 px-3 font-mono text-zinc-500">
                        {c.profit_factor != null ? Number(c.profit_factor).toFixed(2) : '—'}
                      </td>
                      <td className="py-2 px-3 font-mono">
                        {c.max_drawdown_r != null
                          ? <span className={Number(c.max_drawdown_r) > 2 ? 'text-bear-default' : 'text-zinc-500'}>
                              {Number(c.max_drawdown_r).toFixed(2)}R
                            </span>
                          : <span className="text-zinc-500/40">—</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Intelligence Performance */}
      <IntelligenceSection data={intel} loading={intelLoading} />

      {edge && (
        <p className="text-zinc-500/40 text-xs font-mono">
          Generated {formatTs((edge as { report_date?: string }).report_date ?? edge.generated_at)} - {explicitWindowNote(edge.window_hours)}
        </p>
      )}
    </div>
  )
}

// ─── Attribution tab ──────────────────────────────────────────────────────────

function WrSparkBar({ wr }: { wr: number | null | undefined }) {
  if (wr == null) return <span className="text-zinc-500/40">—</span>
  const fill = Math.min(100, Math.max(0, wr * 100))
  const color = fill >= 55 ? 'bg-bull-default' : fill >= 45 ? 'bg-signal-high' : 'bg-bear-default'
  const textColor = fill >= 55 ? 'text-bull-default' : fill >= 45 ? 'text-signal-high' : 'text-bear-default'
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`font-mono ${textColor}`}>{pct(wr)}</span>
      <span className="w-10 h-1.5 rounded-full bg-zinc-800/40 overflow-hidden shrink-0">
        <span className={`block h-full rounded-full ${color}`} style={{ width: `${fill}%` }} />
      </span>
    </span>
  )
}

function DimTable({ title, rows }: { title: string; rows: AttributionDimension[] }) {
  const [expanded, setExpanded] = useState(false)
  if (!rows?.length) return null
  const visible = expanded ? rows : rows.slice(0, 3)
  return (
    <div>
      <p className="text-zinc-500 text-xs mb-2">{title}</p>
      <div className="glass-card rounded-lg overflow-hidden overflow-x-auto">
        <table className="w-full text-xs min-w-[320px]">
          <thead>
            <tr className="border-b border-zinc-800">
              <th className="text-zinc-500 text-xs text-left py-2 px-3 font-medium">Dimension</th>
              <th className="text-zinc-500 text-xs text-left py-2 px-3 font-medium">Signals</th>
              <th className="text-zinc-500 text-xs text-left py-2 px-3 font-medium">Win Rate</th>
              <th className="text-zinc-500 text-xs text-left py-2 px-3 font-medium hidden sm:table-cell">Avg RR</th>
              <th className="text-zinc-500 text-xs text-left py-2 px-3 font-medium hidden sm:table-cell">Expectancy</th>
            </tr>
          </thead>
          <tbody>
            {visible.map(d => (
              <tr key={d.key} className="border-b border-zinc-800/30 hover:bg-zinc-700/10">
                <td className="py-2 px-3 text-zinc-200 font-medium">{d.label}</td>
                <td className="py-2 px-3 font-mono text-zinc-500">{d.total}</td>
                <td className="py-2 px-3"><WrSparkBar wr={d.winRate} /></td>
                <td className="py-2 px-3 font-mono text-zinc-500 hidden sm:table-cell">{rr(d.avgRRAchieved)}</td>
                <td className="py-2 px-3 font-mono hidden sm:table-cell">
                  {d.expectancy != null
                    ? <span className={d.expectancy > 0 ? 'text-bull-default' : 'text-bear-default'}>{exp(d.expectancy)}</span>
                    : <span className="text-zinc-500/40">—</span>
                  }
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length > 3 && (
          <button
            type="button"
            onClick={() => setExpanded(v => !v)}
            className="w-full py-2 text-xs text-zinc-500 hover:text-zinc-200 border-t border-zinc-800/30 transition-colors text-center"
          >
            {expanded ? 'Show fewer' : `Show all ${rows.length} rows`}
          </button>
        )}
      </div>
    </div>
  )
}

function EdgePatternsSection({ patterns }: { patterns: EdgePattern[] }) {
  if (!patterns.length) return null
  return (
    <div>
      <p className="text-zinc-500 text-xs uppercase tracking-wide mb-2">Top Edge Patterns</p>
      <div className="glass-card rounded-lg overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-zinc-800">
              {['Rank', 'Pattern', 'Signals', 'Win Rate', 'Avg RR', 'Expectancy'].map(h => (
                <th key={h} className="text-zinc-500 text-xs text-left py-2 px-3 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {patterns.map(p => (
              <tr key={p.rank} className="border-b border-zinc-800/30 hover:bg-zinc-700/10">
                <td className="py-2 px-3 font-mono text-zinc-500">#{p.rank}</td>
                <td className="py-2 px-3 text-zinc-200 font-medium">{p.label}</td>
                <td className="py-2 px-3 font-mono text-zinc-500">{p.total}</td>
                <td className="py-2 px-3 font-mono">
                  <span className={p.winRate >= 0.55 ? 'text-bull-default' : p.winRate >= 0.45 ? 'text-signal-high' : 'text-bear-default'}>
                    {pct(p.winRate)}
                  </span>
                </td>
                <td className="py-2 px-3 font-mono text-zinc-500">{rr(p.avgRRAchieved)}</td>
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
  LOW: 'text-zinc-500 border-zinc-800',
}
const dirIcon: Record<string, string> = { RAISE: '↑', LOWER: '↓', MONITOR: '◎' }

function RecommendationsSection({ recs }: { recs: ThresholdRecommendation[] }) {
  return (
    <div>
      <p className="text-zinc-500 text-xs uppercase tracking-wide mb-2">Calibration Intelligence</p>
      <div className="space-y-2">
        {recs.map((r, i) => (
          <div key={i} className="glass-card rounded-lg p-4">
            <div className="flex items-start gap-3">
              <span className={`text-xs font-mono font-bold px-1.5 py-0.5 rounded border mt-0.5 shrink-0 ${impactColor[r.impact]}`}>
                {dirIcon[r.direction]} {r.impact}
              </span>
              <div className="min-w-0">
                <p className="text-zinc-200 text-xs font-semibold mb-0.5">{r.parameter}</p>
                <p className="text-zinc-500 text-xs leading-relaxed">{r.insight}</p>
                <p className="text-zinc-500/50 text-xs mt-1 font-mono">{r.basis}</p>
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
      <p className="text-zinc-500 text-xs uppercase tracking-wide mb-2">AI vs Heuristic Effectiveness</p>
      <div className="glass-card rounded-lg p-5">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-5">
          <div className="space-y-1">
            <p className="text-zinc-500 text-xs">AI Signals</p>
            <p className="font-mono font-bold text-zinc-200">{aiApproved.total}</p>
          </div>
          <div className="space-y-1">
            <p className="text-zinc-500 text-xs">AI Win Rate</p>
            <p className={`font-mono font-bold ${aiApproved.winRate != null && aiApproved.winRate >= 0.55 ? 'text-bull-default' : 'text-zinc-200'}`}>
              {pct(aiApproved.winRate)}
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-zinc-500 text-xs">Heuristic Signals</p>
            <p className="font-mono font-bold text-zinc-200">{heuristic.total}</p>
          </div>
          <div className="space-y-1">
            <p className="text-zinc-500 text-xs">Heuristic Win Rate</p>
            <p className={`font-mono font-bold ${heuristic.winRate != null && heuristic.winRate >= 0.55 ? 'text-bull-default' : 'text-zinc-200'}`}>
              {pct(heuristic.winRate)}
            </p>
          </div>
        </div>
        {aiEdgeDelta != null && aiApproved.total >= 5 && heuristic.total >= 5 && (
          <div className="mt-4 pt-4 border-t border-zinc-800/50">
            <span className={`text-xs font-mono font-bold ${aiEdgeDelta > 0 ? 'text-bull-default' : 'text-bear-default'}`}>
              {aiEdgeDelta > 0 ? '▲' : '▼'} AI {aiEdgeDelta > 0 ? '+' : ''}{(aiEdgeDelta * 100).toFixed(1)}% vs heuristic
            </span>
            <span className="text-zinc-500/50 text-xs ml-3">
              {aiEdgeDelta > 0.05 ? 'AI validation adding measurable edge' : aiEdgeDelta < -0.05 ? 'Heuristic outperforming — review AI prompt' : 'No significant difference'}
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
      <p className="text-zinc-500 text-xs uppercase tracking-wide mb-2">Risk Grade Analysis</p>
      <p className="text-zinc-500/60 text-xs">No resolved signals with grade data yet. Warms up as signals reach TP/SL.</p>
    </div>
  )
  const sorted = [...rows].sort((a, b) => a.key.localeCompare(b.key))
  return (
    <div>
      <p className="text-zinc-500 text-xs uppercase tracking-wide mb-3">Risk Grade Analysis — RISKGRADE.FIX.1 Validation</p>
      <div className="glass-card rounded-lg overflow-hidden overflow-x-auto">
        <table className="w-full text-xs min-w-[360px]">
          <thead>
            <tr className="border-b border-zinc-800">
              <th className="text-zinc-500 text-xs text-left py-2 px-3 font-medium">Grade</th>
              <th className="text-zinc-500 text-xs text-left py-2 px-3 font-medium">Signals</th>
              <th className="text-zinc-500 text-xs text-left py-2 px-3 font-medium">Win Rate</th>
              <th className="text-zinc-500 text-xs text-left py-2 px-3 font-medium hidden sm:table-cell">Expectancy</th>
              <th className="text-zinc-500 text-xs text-left py-2 px-3 font-medium hidden sm:table-cell">Avg RR</th>
              <th className="text-zinc-500 text-xs text-left py-2 px-3 font-medium">Target</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(d => {
              const gradeColor = GRADE_COLOR[d.label] ?? 'text-zinc-200'
              const targets: Record<string, string> = { 'Grade A': 'WR ≥ 42%', 'Grade B': 'WR ≥ 43%', 'Grade C': 'WR ≥ 50%' }
              const target = targets[d.label] ?? ''
              const wrOk = d.winRate != null && d.winRate >= 0.42
              return (
                <tr key={d.key} className="border-b border-zinc-800/30 hover:bg-zinc-700/10">
                  <td className={`py-2 px-3 font-mono font-bold ${gradeColor}`}>{d.label}</td>
                  <td className="py-2 px-3 font-mono text-zinc-500">{d.total}</td>
                  <td className="py-2 px-3 font-mono">
                    {d.winRate != null
                      ? <span className={d.winRate >= 0.42 ? 'text-bull-default' : 'text-bear-default'}>{pct(d.winRate)}</span>
                      : <span className="text-zinc-500/40">—</span>}
                  </td>
                  <td className="py-2 px-3 font-mono hidden sm:table-cell">
                    {d.expectancy != null
                      ? <span className={d.expectancy > 0 ? 'text-bull-default' : 'text-bear-default'}>{exp(d.expectancy)}</span>
                      : <span className="text-zinc-500/40">—</span>}
                  </td>
                  <td className="py-2 px-3 font-mono text-zinc-500 hidden sm:table-cell">{rr(d.avgRRAchieved)}</td>
                  <td className="py-2 px-3 font-mono text-zinc-500/50">
                    {target && <span className={wrOk ? 'text-zinc-500/60' : 'text-zinc-500/40'}>{target}</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <p className="px-3 py-2 text-zinc-500/30 text-[10px] font-mono border-t border-zinc-800/20">
          ALPHA.TRUTH.1: futures penalty removed (0.0) · NULL regime hard gate · spot min_confidence raised 80→85
        </p>
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
      <p className="text-zinc-500 text-xs uppercase tracking-wide mb-3">Founder Daily Report</p>
      <p className="text-zinc-500 text-xs mb-4 leading-relaxed">
        Sends a WhatsApp message with 24h regime performance, top edge pattern, AI vs heuristic breakdown, and calibration alerts.
      </p>
      <div className="flex items-center gap-4 flex-wrap">
        <button
          onClick={trigger}
          disabled={sending}
          className="text-xs font-mono px-3 py-1.5 rounded border border-zinc-800 text-zinc-200 hover:bg-zinc-700/10 disabled:opacity-40 transition-colors"
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

// ─── AI Calibration components ────────────────────────────────────────────────

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

function DriftChip({ drift }: { drift: number | null }) {
  if (drift == null) return <span className="text-zinc-600 font-mono text-xs">—</span>
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
          <span className="text-[10px] text-zinc-500 font-mono w-20 text-right">stated {s.mean_stated != null ? Number(s.mean_stated).toFixed(0) : '—'}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
            <div className={`h-full rounded-full ${(s.wr ?? 0) >= (s.mean_stated ?? 100) ? 'bg-emerald-500' : 'bg-purple-500'}`} style={{ width: `${wrW}%` }} />
          </div>
          <span className="text-[10px] text-purple-300 font-mono w-20 text-right">actual {s.wr != null ? Number(s.wr).toFixed(0) : '—'}%</span>
        </div>
      </div>
      <DriftChip drift={s.drift} />
      <span className={`text-[10px] font-mono w-14 text-right ${s.low_sample ? 'text-amber-500' : 'text-zinc-600'}`}>
        n={s.n}{s.low_sample ? '⚠' : ''}
      </span>
      <span className="text-[10px] font-mono text-zinc-500 w-16 text-right hidden sm:block">
        {s.exp != null ? `${Number(s.exp) > 0 ? '+' : ''}${Number(s.exp).toFixed(2)}R` : '—'}
      </span>
      <span className="text-[10px] font-mono text-zinc-500 w-12 text-right hidden sm:block">
        PF {s.pf != null ? Number(s.pf).toFixed(2) : '—'}
      </span>
    </div>
  )
}

function ConfidenceCalibrationSection() {
  const fetcher = useCallback(() => adminApi.analytics.confidenceCalibration().catch(() => null), [])
  const { data: cal } = useAutoRefresh<import('@/lib/admin-api').ConfidenceCalibrationResponse | null>(fetcher, 300_000)

  if (!cal || !cal.enabled) return null

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
      <p className="text-[10px] text-zinc-600 uppercase tracking-wide flex items-center gap-2">
        <span className="h-px flex-1 bg-zinc-800"/>Confidence Calibration — Empirical (read-only)<span className="h-px flex-1 bg-zinc-800"/>
      </p>

      {dq && dq.warnings.length > 0 && (
        <div className="space-y-1.5">
          {dq.warnings.map((w, i) => (
            <div key={i} className="rounded-lg px-3 py-2 bg-amber-500/5 border border-amber-500/20 text-amber-300/90 text-xs flex items-start gap-2">
              <span className="shrink-0">⚠</span><span>{w}</span>
            </div>
          ))}
        </div>
      )}

      {insightCards.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {insightCards.map(c => (
            <div key={c.label} className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2.5">
              <p className="text-[10px] text-zinc-500 uppercase tracking-wider">{c.label}</p>
              <p className={`text-lg font-bold font-mono ${c.color}`}>{c.v?.band}</p>
              <p className="text-[10px] text-zinc-500 font-mono">
                WR {c.v?.wr != null ? Number(c.v.wr).toFixed(0) : '—'}% · drift {c.v?.drift != null && Number(c.v.drift) > 0 ? '+' : ''}{c.v?.drift != null ? Number(c.v.drift).toFixed(0) : '—'} · n={c.v?.n}
              </p>
              <p className="text-[10px] text-zinc-600 mt-0.5">{c.desc}</p>
            </div>
          ))}
        </div>
      )}

      {cal.bands_regime_known && Object.keys(cal.bands_regime_known).length > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
          <h2 className="text-sm font-medium text-white mb-1">
            Stated vs Actual Win Rate — Regime-Known Cohort
          </h2>
          <p className="text-[10px] text-zinc-600 mb-3">
            Grey bar = average stated confidence · purple bar = measured WR · drift = actual − stated · ⚠ = n &lt; {dq?.min_reliable_n ?? 30}
          </p>
          <div className="divide-y divide-zinc-800/60">
            {Object.entries(cal.bands_regime_known).filter(([b]) => b !== 'NULL').map(([band, s]) => (
              <CalBandRow key={band} band={band} s={s} />
            ))}
          </div>
        </div>
      )}

      {cal.bands && Object.keys(cal.bands).length > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
          <h2 className="text-sm font-medium text-white mb-3">
            All Outcomes (includes pre-fix NULL-regime era)
          </h2>
          <div className="divide-y divide-zinc-800/60">
            {Object.entries(cal.bands).filter(([b]) => b !== 'NULL').map(([band, s]) => (
              <CalBandRow key={band} band={band} s={s} />
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {([['Regime', cal.drift_by_regime], ['Signal Type', cal.drift_by_type], ['Scanner Mode', cal.drift_by_mode]] as const).map(([title, dims]) => (
          <div key={title} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
            <p className="text-[10px] text-zinc-500 uppercase tracking-wide mb-2">Drift by {title}</p>
            <div className="space-y-1.5">
              {dims && Object.entries(dims).map(([value, bands]) => (
                Object.entries(bands).map(([band, s]) => (
                  <div key={`${value}-${band}`} className="flex items-center gap-2 text-[10px]">
                    <span className="text-zinc-500 font-mono truncate flex-1">{value === 'None' ? 'NULL' : value} · {band}</span>
                    <span className="text-zinc-400 font-mono">{s.wr != null ? Number(s.wr).toFixed(0) : '—'}%</span>
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
        {dq?.total_resolved ?? 0} resolved outcomes · {dq?.snapshot_generations ?? 0} snapshot generations ·
        empirical confidence is measurement only — production scoring unchanged
      </p>
    </div>
  )
}

function CalibrationHealthPanel({
  bands,
  byGrade,
}: {
  bands:   EdgeReport['confidence_calibration']['bands'] | undefined
  byGrade: AttributionDimension[] | undefined
}) {
  if (!bands?.length && !byGrade?.length) return null

  const gradeOrder = ['A', 'B', 'C', 'D', 'F']
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
      curr.winRate > prev.winRate + 0.02
    ) {
      gradeInversions.push(`${gradeRows[i - 1].key} (${(prev.winRate * 100).toFixed(0)}%) < ${gradeRows[i].key} (${(curr.winRate * 100).toFixed(0)}%)`)
    }
  }

  const populatedBands = (bands ?? []).filter(b => !b.insufficient_data && b.win_rate != null)
  const bandInversions: string[] = []
  for (let i = 1; i < populatedBands.length; i++) {
    const prev = populatedBands[i - 1]
    const curr = populatedBands[i]
    if (curr.win_rate! > prev.win_rate! + 0.02) {
      bandInversions.push(`${prev.label} (${(prev.win_rate! * 100).toFixed(0)}%) < ${curr.label} (${(curr.win_rate! * 100).toFixed(0)}%)`)
    }
  }

  const score = Math.max(0, 100 - gradeInversions.length * 20 - bandInversions.length * 15)
  const scoreColor = score >= 80 ? 'text-bull-default' : score >= 60 ? 'text-amber-400' : 'text-bear-default'
  const healthy = gradeInversions.length === 0 && bandInversions.length === 0

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-medium text-white">Calibration Health</h2>
        <span className={`font-mono font-bold text-lg ${scoreColor}`}>{score}/100</span>
      </div>

      {healthy && (
        <div className="flex items-center gap-2 text-xs text-zinc-400 mb-3">
          <span className="w-1.5 h-1.5 rounded-full bg-zinc-400"/>
          Grades monotonic · confidence bands monotonic — no inversions detected
        </div>
      )}

      {gradeInversions.length > 0 && (
        <div className="mb-3">
          <p className="text-[10px] text-amber-500 uppercase tracking-wide mb-1.5">Grade Inversions</p>
          <div className="space-y-1">
            {gradeInversions.map(inv => (
              <div key={inv} className="flex items-center gap-2 text-[10px] text-amber-400 font-mono">
                <span className="text-amber-500">⚠</span> {inv}
              </div>
            ))}
          </div>
        </div>
      )}

      {bandInversions.length > 0 && (
        <div className="mb-3">
          <p className="text-[10px] text-amber-500 uppercase tracking-wide mb-1.5">Confidence Band Inversions</p>
          <div className="space-y-1">
            {bandInversions.map(inv => (
              <div key={inv} className="flex items-center gap-2 text-[10px] text-amber-400 font-mono">
                <span className="text-amber-500">⚠</span> {inv}
              </div>
            ))}
          </div>
        </div>
      )}

      {gradeRows.length > 0 && (
        <div>
          <p className="text-[10px] text-zinc-500 uppercase tracking-wide mb-2">Grade Win Rates</p>
          <div className="flex flex-wrap gap-2">
            {gradeRows.map(g => (
              <div key={g.key} className="bg-zinc-800 rounded px-2.5 py-1.5 text-center min-w-[52px]">
                <p className="text-[10px] text-zinc-500">{g.key}</p>
                <p className={`font-mono text-xs font-bold ${g.winRate != null && g.winRate >= 0.5 ? 'text-bull-default' : 'text-bear-default'}`}>
                  {g.winRate != null ? `${(g.winRate * 100).toFixed(0)}%` : '—'}
                </p>
                <p className="text-[10px] text-zinc-600">n={g.total}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Grade Validation Table (from PerformanceVerificationSection) ─────────────

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
        <p className="text-[10px] text-zinc-500 uppercase tracking-wide">{title}</p>
        {inversions.length === 0
          ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">monotonic ✓</span>
          : <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/10 border border-red-500/20 text-red-400">{inversions.length} inversion{inversions.length > 1 ? 's' : ''}</span>}
      </div>
      <div className="space-y-1">
        {rows.map(g => (
          <div key={g.grade} className="flex items-center gap-3 text-xs font-mono">
            <span className="text-purple-300 font-bold w-7">{g.grade}</span>
            <span className="text-zinc-300 w-14">{g.wr != null ? Number(g.wr).toFixed(1) : '—'}%</span>
            <span className={`w-18 ${(Number(g.exp ?? 0) >= 0) ? 'text-emerald-400' : 'text-red-400'}`}>{g.exp != null ? `${Number(g.exp) >= 0 ? '+' : ''}${Number(g.exp).toFixed(3)}R` : '—'}</span>
            <span className="text-zinc-500 w-14">PF {g.pf != null ? Number(g.pf).toFixed(2) : '—'}</span>
            <span className="text-zinc-600">n={g.n}</span>
          </div>
        ))}
      </div>
      {inversions.map((v, i) => <p key={i} className="text-[10px] text-red-400/80 mt-1.5 font-mono">⚠ {v}</p>)}
    </div>
  )
}

// ─── Tab components ───────────────────────────────────────────────────────────

function TrackRecordTab({ data, loading }: { data: import('@/lib/admin-api').TrackRecordResponse | null; loading: boolean }) {
  if (loading) return <div className="text-zinc-500 text-sm py-8 text-center">Loading track record…</div>
  if (!data)   return <div className="text-zinc-500 text-sm py-8 text-center">No track record data available.</div>

  const w = (wr: number | null) => wr == null ? '—' : `${Number(wr).toFixed(1)}%`
  const e = (ex: number | null) => ex == null ? '—' : `${Number(ex) > 0 ? '+' : ''}${Number(ex).toFixed(2)}R`
  const p = (pf: number | null) => pf == null ? '—' : Number(pf).toFixed(2)
  const wrCls = (wr: number | null) => wr == null ? 'text-zinc-500' : wr >= 50 ? 'text-bull-default' : wr >= 40 ? 'text-blue-400' : wr >= 30 ? 'text-amber-400' : 'text-bear-default'
  const expCls = (ex: number | null) => ex == null ? 'text-zinc-500' : ex >= 0.5 ? 'text-bull-default' : ex >= 0.2 ? 'text-blue-400' : ex >= 0 ? 'text-amber-400' : 'text-bear-default'
  const pfCls  = (pf: number | null)  => pf  == null ? 'text-zinc-500' : pf  >= 2.0 ? 'text-bull-default' : pf  >= 1.5 ? 'text-blue-400' : pf  >= 1.0 ? 'text-amber-400' : 'text-bear-default'
  const modeLabel = (m: string) => m === 'high_confidence' ? 'High Conf' : m.charAt(0).toUpperCase() + m.slice(1)

  const windows = [
    { label: '7d',  w: data.windows.d7  },
    { label: '30d', w: data.windows.d30 },
    { label: '90d', w: data.windows.d90 },
  ] as const

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-zinc-200 font-semibold mb-0.5">Verified Track Record</h2>
        <p className="text-zinc-500 text-xs">Source: {data.source} · Outcome-resolved signals only · WR in % (0–100 scale; Edge tab uses 0–1)</p>
      </div>

      {/* Performance windows */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {windows.map(({ label, w: win }) => {
          const isGood = win.win_rate != null && win.win_rate >= 50
          const isWarn = win.win_rate != null && win.win_rate >= 40 && win.win_rate < 50
          const accentBorder = isGood ? 'border-emerald-900/60' : isWarn ? 'border-amber-900/50' : 'border-zinc-800'
          const accentBar    = isGood ? 'bg-emerald-500' : isWarn ? 'bg-amber-500' : 'bg-zinc-600'
          return (
          <div key={label} className={`glass-card rounded-xl overflow-hidden border ${accentBorder}`}>
            {/* Top accent line */}
            <div className={`h-[2px] w-full ${accentBar}`} />
            <div className="p-5">
              <div className="flex items-center justify-between mb-5">
                <span className="text-zinc-400 text-xs font-semibold tracking-wide">{label}</span>
                <span className="text-zinc-600 text-[10px] font-mono">{win.resolved} resolved</span>
              </div>
              {/* Primary metric — Win Rate */}
              <div className="mb-4">
                <p className={`font-mono font-bold text-3xl leading-none ${wrCls(win.win_rate)}`}>{w(win.win_rate)}</p>
                <p className="text-zinc-500 text-[10px] mt-1.5 uppercase tracking-wide">Win Rate</p>
              </div>
              {/* Secondary metrics */}
              <div className="grid grid-cols-2 gap-3 pt-3 border-t border-zinc-800/50">
                <div>
                  <p className={`font-mono font-semibold text-base leading-none ${expCls(win.expectancy)}`}>{e(win.expectancy)}</p>
                  <p className="text-zinc-600 text-[10px] mt-1">Expectancy</p>
                </div>
                <div>
                  <p className={`font-mono font-semibold text-base leading-none ${pfCls(win.pf)}`}>{p(win.pf)}</p>
                  <p className="text-zinc-600 text-[10px] mt-1">Prof Factor</p>
                </div>
              </div>
              <div className="mt-3 pt-2.5 border-t border-zinc-800/30 flex justify-between items-center">
                <span className="text-zinc-600 text-[10px]">Wins / Losses / Timeout</span>
                <span className="font-mono text-[10px] text-zinc-500">{win.wins}W · {win.losses}L{(win.timeouts ?? 0) > 0 ? ` · ${win.timeouts}TO` : ''}</span>
              </div>
            </div>
          </div>
          )
        })}
      </div>

      {/* By mode (30d) */}
      {(data.by_mode_30d ?? []).length > 0 && (
        <div className="glass-card rounded-xl p-5">
          <p className="text-zinc-500 text-xs uppercase tracking-wide mb-4 font-semibold">30d by Mode</p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-zinc-800">
                  <th className="text-zinc-500 text-xs text-left py-2 px-3 font-medium">Mode</th>
                  <th className="text-zinc-500 text-xs text-left py-2 px-3 font-medium">n</th>
                  <th className="text-zinc-500 text-xs text-left py-2 px-3 font-medium">Win Rate</th>
                  <th className="text-zinc-500 text-xs text-left py-2 px-3 font-medium">Expectancy</th>
                </tr>
              </thead>
              <tbody>
                {(data.by_mode_30d ?? []).map(m => (
                  <tr key={m.scanner_mode} className="border-b border-zinc-800/30 hover:bg-zinc-700/10">
                    <td className="py-2.5 px-3 font-mono text-zinc-200">{modeLabel(m.scanner_mode)}</td>
                    <td className="py-2.5 px-3 font-mono text-zinc-500">{m.n}</td>
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
          <p className="text-zinc-500 text-xs uppercase tracking-wide mb-4 font-semibold">Probability Engine Accuracy</p>
          {data.probability_accuracy.n < 10 ? (
            <p className="text-zinc-500 text-sm">Insufficient data — need ≥ 10 stamped outcomes (current: {data.probability_accuracy.n})</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <p className="text-zinc-500 text-xs mb-1">Sample</p>
                <p className="font-mono text-base text-zinc-200 font-bold">n={data.probability_accuracy.n}</p>
              </div>
              <div>
                <p className="text-zinc-500 text-xs mb-1">Predicted WR</p>
                <p className="font-mono text-base text-zinc-200 font-bold">
                  {data.probability_accuracy.avg_predicted_wr != null ? `${Number(data.probability_accuracy.avg_predicted_wr).toFixed(1)}%` : '—'}
                </p>
              </div>
              <div>
                <p className="text-zinc-500 text-xs mb-1">Actual WR</p>
                <p className={`font-mono text-base font-bold ${wrCls(data.probability_accuracy.realized_wr)}`}>
                  {data.probability_accuracy.realized_wr != null ? `${Number(data.probability_accuracy.realized_wr).toFixed(1)}%` : '—'}
                </p>
              </div>
              <div>
                <p className="text-zinc-500 text-xs mb-1">Mean Abs Error</p>
                <p className={`font-mono text-base font-bold ${
                  data.probability_accuracy.mean_abs_error == null ? 'text-zinc-500'
                  : data.probability_accuracy.mean_abs_error <= 0.1 ? 'text-bull-default'
                  : data.probability_accuracy.mean_abs_error <= 0.2 ? 'text-amber-400'
                  : 'text-bear-default'}`}>
                  {data.probability_accuracy.mean_abs_error != null ? `${(data.probability_accuracy.mean_abs_error * 100).toFixed(0)}pp` : '—'}
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function AttributionTab({
  data, loading, edge, ai, aiLoading,
}: {
  data: AttributionReport | null
  loading: boolean
  edge: EdgeReport | null
  ai: import('@/lib/admin-api').AiSummaryResponse | null
  aiLoading: boolean
}) {
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
        <p className="text-zinc-500 text-xs">Attribution data unavailable — ensure the attribution API route is deployed and the database migration has been run.</p>
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
          <p className="text-zinc-500 text-xs leading-relaxed">
            Most signals were generated before Phase 6.7. Regime, signal_state, and mcap_tier breakdowns reflect only the {dimensions.byRegime.reduce((s, d) => s + d.total, 0)} signals with full tactical data. Run new scans to build the attribution dataset.
          </p>
        </div>
      )}

      {insufficient ? (
        <div className="glass-card rounded-lg p-5 space-y-2">
          <p className="text-signal-medium text-sm font-semibold">◌ Attribution warming up</p>
          <p className="text-zinc-500 text-xs leading-relaxed">
            Outcome attribution requires at least 20 resolved signals (TP hit, SL hit, or timeout) in the {explicitWindowNote(windowHours)}. Currently: {resolvedRows} resolved. Keep running scans — attribution populates automatically as signals resolve.
          </p>
        </div>
      ) : (
        <>
          <DimTable title="Performance by Market Regime" rows={dimensions.byRegime} />
          <DimTable title="Performance by Signal State"  rows={dimensions.bySignalState} />
          <DimTable title="Performance by Market Cap Tier" rows={dimensions.byMcapTier} />
          <DimTable title="Performance by Extension Risk"  rows={dimensions.byExtensionRisk} />

          <EdgePatternsSection patterns={edgePatterns} />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <DimTable title="By Timeframe"    rows={dimensions.byTimeframe} />
            <DimTable title="By Scanner Mode" rows={dimensions.byScannerMode} />
          </div>

          <RiskGradeAnalysis rows={dimensions.byGrade} />

          <AIEffectivenessSection ai={aiEffectiveness} />

          <RecommendationsSection recs={recommendations} />
        </>
      )}

      <DailyReportTrigger />

      <p className="text-zinc-500/40 text-xs font-mono">
        Attribution - {resolvedRows} resolved signals - {explicitWindowNote(windowHours)}
      </p>

      {/* Calibration — collapsed section */}
      <details className="group">
        <summary className="cursor-pointer list-none select-none">
          <div className="flex items-center gap-3 py-3 border-t border-zinc-800">
            <span className="text-[10px] text-zinc-500 uppercase tracking-wide font-mono group-open:hidden">▶ Calibration &amp; AI Analysis</span>
            <span className="text-[10px] text-zinc-500 uppercase tracking-wide font-mono hidden group-open:inline">▼ Calibration &amp; AI Analysis</span>
          </div>
        </summary>
        <div className="space-y-6 pt-2">
          <CalibrationHealthPanel
            bands={edge?.confidence_calibration?.bands}
            byGrade={data?.dimensions?.byGrade}
          />

          {!aiLoading && (ai?.total_calls ?? 0) === 0 && (
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
              { label: 'Success Rate', value: ai?.success_rate != null ? `${(ai.success_rate * 100).toFixed(1)}%` : '—', sub: 'API calls OK (24h)', accent: ai?.success_rate != null ? (ai.success_rate >= 0.9 ? 'text-green-400' : ai.success_rate >= 0.7 ? 'text-amber-400' : 'text-red-400') : 'text-white' },
              { label: 'Avg Latency',  value: ai?.avg_latency_ms != null ? `${Number(ai.avg_latency_ms).toFixed(0)}ms` : '—', sub: 'per call', accent: ai?.avg_latency_ms != null ? (Number(ai.avg_latency_ms) < 2000 ? 'text-green-400' : 'text-amber-400') : 'text-white' },
              { label: 'Last Error',   value: ai?.last_error ? 'See logs' : 'None', sub: ai?.last_error ? ai.last_error.slice(0, 40) : 'All calls clean', accent: ai?.last_error ? 'text-red-400' : 'text-green-400' },
            ].map(c => (
              <div key={c.label} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                <div className="text-xs text-zinc-500 mb-1">{c.label}</div>
                <div className={`text-xl font-bold ${c.accent}`}>{c.value}</div>
                <div className="text-xs text-zinc-600 mt-0.5">{c.sub}</div>
              </div>
            ))}
          </div>

          {(() => {
            const verdicts = ai?.verdicts ?? ai?.verdict_distribution ?? {}
            const totalVerd = Object.values(verdicts as Record<string, number>).reduce((a: number, b: number) => a + b, 0)
            return totalVerd > 0 ? (
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
                <h2 className="text-sm font-medium text-white mb-4">Verdict Distribution — {totalVerd} calls (24h)</h2>
                <div className="space-y-3">
                  {Object.entries(verdicts as Record<string, number>).map(([k, v]) => (
                    <VerdictBar key={k} label={k} count={v} total={totalVerd} />
                  ))}
                </div>
              </div>
            ) : null
          })()}

          <ConfidenceCalibrationSection />
        </div>
      </details>
    </div>
  )
}

// ─── Page root ────────────────────────────────────────────────────────────────

type Tab = 'track-record' | 'edge' | 'attribution'

export default function PerformancePage() {
  const [tab, setTab] = useState<Tab>('track-record')

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab') as Tab | null
    if (t && ['track-record', 'edge', 'attribution'].includes(t)) setTab(t)
  }, [])

  const edgeFetcher  = useCallback(() => adminApi.analytics.edgeReport(), [])
  const intelFetcher = useCallback(() => adminApi.analytics.intelligence(), [])
  const aiFetcher    = useCallback(() => adminApi.analytics.ai(24), [])

  // REDIS.REDUCE.3: analytics data changes on hourly timescales — 300s is fine
  const { data: edge,   loading: edgeLoading  } = useAutoRefresh<EdgeReport>(edgeFetcher, 300_000)
  const { data: intel,  loading: intelLoading } = useAutoRefresh<IntelligenceSummary>(intelFetcher, 300_000)
  const { data: aiData, loading: aiLoading    } = useAutoRefresh<import('@/lib/admin-api').AiSummaryResponse>(aiFetcher, 300_000)

  const attrFetcher = useCallback(() =>
    fetch('/api/analytics/attribution?hours=720', { cache: 'no-store' })
      .then(r => r.json())
      .then((j: { success: boolean; report: AttributionReport }) => j.success ? j.report : null),
    []
  )
  const { data: attribution, loading: attrLoading } = useAutoRefresh<AttributionReport | null>(attrFetcher, 300_000)

  const trackRecordFetcher = useCallback(() => adminApi.analytics.trackRecord(), [])
  const { data: trackRecord, loading: trackLoading } = useAutoRefresh<import('@/lib/admin-api').TrackRecordResponse>(trackRecordFetcher, 300_000)

  const TABS = [
    { id: 'track-record' as Tab, label: 'Track Record' },
    { id: 'edge'         as Tab, label: 'Edge'         },
    { id: 'attribution'  as Tab, label: 'Attribution'  },
  ]

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-zinc-200 text-xl font-semibold">Performance</h1>
        <p className="text-zinc-500 text-sm mt-1">Track record · Edge validation · Attribution intelligence</p>
      </div>

      {/* Tab nav */}
      <div className="flex gap-1 border-b border-zinc-800 pb-0">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors ${
              tab === t.id
                ? 'border-zinc-200 text-zinc-200'
                : 'border-transparent text-zinc-500 hover:text-zinc-200/70'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'track-record' && <TrackRecordTab data={trackRecord ?? null} loading={trackLoading} />}
      {tab === 'edge'         && <EdgeValidationTab edge={edge ?? null} loading={edgeLoading} intel={intel ?? null} intelLoading={intelLoading} />}
      {tab === 'attribution'  && <AttributionTab data={attribution ?? null} loading={attrLoading} edge={edge ?? null} ai={aiData ?? null} aiLoading={aiLoading} />}
    </div>
  )
}
