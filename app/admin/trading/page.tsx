'use client'

import { useState, useCallback, useEffect, useRef, type ReactNode } from 'react'
import {
  Activity, Zap, ScanLine, Target, RefreshCw,
  Play, Square, ArrowRight, CheckCircle, CheckCircle2, XCircle,
  TrendingUp, TrendingDown, Minus, Clock,
  ShieldAlert, Wrench, Bot, Send, AlertTriangle,
  ChevronDown, BarChart2,
} from 'lucide-react'
import { adminApi } from '@/lib/admin-api'
import type { AuditEntry, HealthReady, ScanSummaryResponse, TrackRecordResponse } from '@/lib/admin-api'
import { useSharedPolling } from '@/lib/use-shared-polling'
import { useAutoRefresh } from '@/lib/use-auto-refresh'
import { cn } from '@/lib/utils'
import type { TacticalSignalRow, MarketRegime, ScannerMode, SignalLifecycleStage, RiskGrade } from '@/types'

// ── Types ─────────────────────────────────────────────────────────────────────

interface CeleryStatus {
  enabled: boolean; scanning: boolean; running_modes: string[]; last_scan_at: number | null
  next_scan_at?: Record<string, number | null>
  is_overdue?: boolean; last_scan_age_seconds?: number | null
}
interface RegimeData {
  regime: MarketRegime; btcRsi4h: number; btcTrend4h: string
  btcAtrPct: number; btc24hChange: number; computedAt: string
}
interface SignalCounts {
  signals_today: number; active_signals: number
  win_rate_7d: number; expectancy_7d: number; resolved_7d: number
  profit_factor_7d?: number; avg_rr_achieved_7d?: number
}
interface OpsFlags {
  emergency_stop: boolean; maintenance_mode: boolean
  telegram: boolean; ai_validation: boolean
}
interface ProviderStatus { name: string; healthy: boolean; latencyMs: number; error?: string; note?: string }
interface CacheTelemetry {
  quota: { creditsUsed: number; monthlyBudget: number; pctUsed: number } | null
  groups: Array<{ name: string; isStale: boolean; ageSeconds: number | null }>
}

// ── Constants ─────────────────────────────────────────────────────────────────

const REGIME_COLOR: Record<string, string> = {
  BULL_TREND: 'text-green-400', BEAR_TREND: 'text-red-400', SIDEWAYS: 'text-zinc-400',
  HIGH_VOLATILITY: 'text-amber-400', EUPHORIA: 'text-purple-400', CAPITULATION: 'text-rose-400',
}
const REGIME_LABEL: Record<string, string> = {
  BULL_TREND: 'Bull Trend', BEAR_TREND: 'Bear Trend', SIDEWAYS: 'Sideways',
  HIGH_VOLATILITY: 'High Volatility', EUPHORIA: 'Euphoria', CAPITULATION: 'Capitulation',
}
const REGIME_BORDER: Record<string, string> = {
  BULL_TREND: 'border-green-500/25', BEAR_TREND: 'border-red-500/25',
  SIDEWAYS: 'border-zinc-600/30', HIGH_VOLATILITY: 'border-amber-500/25',
  EUPHORIA: 'border-purple-500/25', CAPITULATION: 'border-rose-500/25',
}
const REGIME_META: Record<string, { desc: string; implication: string }> = {
  BULL_TREND:      { desc: 'BTC 4h EMA bullish with sustained momentum', implication: 'Increase signal confidence thresholds — setups resolve faster in trending conditions' },
  BEAR_TREND:      { desc: 'BTC 4h EMA bearish with sustained selling pressure', implication: 'Tighten stop-losses — strong downtrend increases invalidation risk' },
  SIDEWAYS:        { desc: 'No clear directional bias — price consolidating', implication: 'Range-bound setups preferred — avoid breakout plays without volume confirmation' },
  HIGH_VOLATILITY: { desc: 'ATR above normal — increased whipsaw risk', implication: 'Widen stops or reduce position size — ATR spike increases noise in all setups' },
  EUPHORIA:        { desc: 'Overbought — RSI > 78, extreme greed territory', implication: 'Avoid new long entries — mean-reversion risk high; favor shorts or cash' },
  CAPITULATION:    { desc: 'Extreme fear — RSI < 22, mass selling', implication: 'High-conviction long setups may be viable — capitulation often precedes reversals' },
}
const MODE_COLORS: Record<string, string> = {
  spot:            'text-sky-400     border-sky-400/20     bg-sky-400/5',
  futures:         'text-purple-400  border-purple-400/20  bg-purple-400/5',
  high_confidence: 'text-emerald-400 border-emerald-400/20 bg-emerald-400/5',
  trending:        'text-amber-400   border-amber-400/20   bg-amber-400/5',
}
const MODES: ScannerMode[] = ['spot', 'futures', 'high_confidence', 'trending']
const MODE_FIRE_MINUTES: Record<string, number[]> = {
  spot: [0,15,30,45], futures: [10,40], high_confidence: [5,35], trending: [20,50],
}
const STAGE_META: Record<string, { label: string; color: string }> = {
  VALIDATED:     { label: 'Validated',   color: 'text-zinc-400    bg-zinc-500/10    border-zinc-500/20'    },
  AI_APPROVED:   { label: 'AI Approved', color: 'text-purple-400  bg-purple-500/10  border-purple-500/20'  },
  SCREENED:      { label: 'Screened',    color: 'text-sky-400     bg-sky-500/10     border-sky-500/20'     },
  TELEGRAM_SENT: { label: 'Sent',        color: 'text-blue-400   bg-blue-500/10   border-blue-500/20'   },
  ACTIVE:        { label: 'Active',      color: 'text-green-400   bg-green-500/10   border-green-500/20'   },
  STALE:         { label: 'Stale',       color: 'text-amber-400   bg-amber-500/10   border-amber-500/20'   },
  TP_HIT:        { label: 'TP Hit',      color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' },
  SL_HIT:        { label: 'SL Hit',      color: 'text-red-400     bg-red-500/10     border-red-500/20'     },
  CLOSED:        { label: 'Closed',      color: 'text-zinc-500    bg-zinc-500/10    border-zinc-600/20'    },
  ANALYZED:      { label: 'Analyzed',    color: 'text-indigo-400  bg-indigo-500/10  border-indigo-500/20'  },
}
const STAGE_TIPS: Record<string, string> = {
  VALIDATED:     'Passed all 11 scanner gates — queued for AI or heuristic review',
  AI_APPROVED:   'Claude AI reviewed & approved · confidence ≥ 80%',
  SCREENED:      'Heuristic rules approved · fires when AI is disabled or setup score < 78',
  TELEGRAM_SENT: 'Alert delivered to Telegram channel',
  ACTIVE:        'Signal is live within its trading window · 1h → 8h · 4h → 24h · 1d → 72h',
  STALE:         'Trading window expired — TP/SL not hit · no longer actionable',
  TP_HIT:        'Take-profit target reached · winning trade · outcome recorded',
  SL_HIT:        'Stop-loss triggered · losing trade · outcome recorded',
  CLOSED:        'Timed out without hitting TP or SL',
  ANALYZED:      'Outcome included in attribution & edge analytics',
}
function StageLegend() {
  return (
    <div className="flex items-center gap-2 flex-wrap py-2 px-3 rounded-lg bg-zinc-900/50 border border-zinc-800">
      <span className="text-[10px] text-zinc-600 font-semibold uppercase tracking-wider shrink-0 mr-1">Stage key</span>
      {(Object.entries(STAGE_META) as [string, {label:string;color:string}][]).map(([key,meta])=>(
        <div key={key} className="relative group">
          <span className={`text-[10px] px-1.5 py-0.5 rounded border cursor-default select-none ${meta.color}`}>{meta.label}</span>
          {STAGE_TIPS[key] && (
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 hidden group-hover:block w-56 px-2.5 py-2 bg-zinc-800 border border-zinc-700 rounded-lg pointer-events-none shadow-xl">
              <p className={`text-[10px] font-semibold mb-0.5 ${meta.color.split(' ')[0]}`}>{meta.label}</p>
              <p className="text-[10px] text-zinc-400 leading-snug whitespace-normal">{STAGE_TIPS[key]}</p>
              <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-zinc-700"/>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
const GRADE_STYLE: Record<string, string> = {
  A: 'text-emerald-300 bg-emerald-500/15 border-emerald-500/30',
  B: 'text-blue-300    bg-blue-500/15    border-blue-500/30',
  C: 'text-amber-300   bg-amber-500/15   border-amber-500/30',
  D: 'text-red-300     bg-red-500/15     border-red-500/30',
  F: 'text-red-400     bg-red-500/20     border-red-500/40',
}
const GRADE_RANK: Record<string, number> = { A: 0, B: 1, C: 2, D: 3, F: 4 }
// Preset display info for preview modal
const PRESET_DISPLAY: Record<string, { label: string; changes: string[] }> = {
  conservative: { label: 'Conservative', changes: ['Min confidence: ~87', 'Min RR: 2.5:1', 'Fewer signals / scan'] },
  balanced:     { label: 'Balanced',     changes: ['Min confidence: ~82', 'Min RR: 2.0:1', 'Standard volume']     },
  aggressive:   { label: 'Aggressive',   changes: ['Min confidence: ~78', 'Min RR: 1.8:1', 'More signals / scan'] },
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number | null | undefined, d = 2) {
  if (n == null || isNaN(n as number)) return '—'
  return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
}
// asyncpg/Pydantic v2 serialises PostgreSQL NUMERIC columns as JSON strings.
// toNum() coerces safely so .toFixed() / arithmetic never crash.
function toNum(v: unknown): number | null {
  if (v == null) return null
  const n = Number(v)
  return isNaN(n) ? null : n
}
function timeAgo(ts: number | null | string) {
  if (!ts) return '—'
  const ms = typeof ts === 'string' ? new Date(ts).getTime() : ts * 1000
  const s = Math.floor((Date.now() - ms) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  return `${Math.floor(s / 3600)}h ago`
}
function fmtCd(secs: number) {
  if (secs <= 0) return 'now'
  const m = Math.floor(secs / 60), s = secs % 60
  return m > 0 ? `${m}m ${s.toString().padStart(2, '0')}s` : `${s}s`
}
function fmtPx(p: number | null | undefined): string {
  if (p == null || isNaN(p as number) || p === 0) return '—'
  if (p >= 10000) return p.toLocaleString('en-US', { maximumFractionDigits: 0 })
  if (p >= 100)   return p.toLocaleString('en-US', { maximumFractionDigits: 2 })
  if (p >= 1)     return p.toFixed(4)
  if (p >= 0.01)  return p.toFixed(5)
  return p.toFixed(8)
}
/** Distance from entry to price as a signed percentage string (+3.1% / -1.8%). */
function fmtDistPct(entry: number, price: number, dir: 'BUY' | 'SELL', role: 'tp' | 'sl'): string {
  if (!entry || !price) return ''
  const raw = role === 'tp'
    ? (dir === 'BUY' ? (price - entry) / entry : (entry - price) / entry)
    : (dir === 'BUY' ? (entry - price) / entry : (price - entry) / entry)
  return `${raw >= 0 ? '+' : ''}${(raw * 100).toFixed(1)}%`
}
function nextFire(mode: string) {
  const mins = MODE_FIRE_MINUTES[mode] ?? [0,15,30,45]
  const now = new Date(), cur = now.getMinutes()
  for (const m of [...mins].sort((a,b)=>a-b)) {
    if (cur < m) { const n=new Date(now); n.setMinutes(m,0,0); return Math.max(0,Math.floor((n.getTime()-Date.now())/1000)) }
  }
  const n=new Date(now); n.setHours(now.getHours()+1,[...mins].sort((a,b)=>a-b)[0],0,0)
  return Math.max(0,Math.floor((n.getTime()-Date.now())/1000))
}
function computeRegimeAlignment(signalType: string, regime: MarketRegime | undefined | null): 'aligned' | 'contra' | 'neutral' {
  if (!regime || regime === 'SIDEWAYS' || regime === 'HIGH_VOLATILITY') return 'neutral'
  if (signalType === 'BUY'  && (regime === 'BULL_TREND' || regime === 'EUPHORIA'))     return 'aligned'
  if (signalType === 'SELL' && (regime === 'BEAR_TREND' || regime === 'CAPITULATION')) return 'aligned'
  if (signalType === 'BUY'  && (regime === 'BEAR_TREND' || regime === 'CAPITULATION')) return 'contra'
  if (signalType === 'SELL' && (regime === 'BULL_TREND' || regime === 'EUPHORIA'))     return 'contra'
  return 'neutral'
}
function trendScoreLabel(score: number) {
  if (score >= 80) return `ELITE ${score}`
  if (score >= 65) return `STRONG ${score}`
  if (score >= 50) return `GOOD ${score}`
  return `WEAK ${score}`
}
function trendScoreColor(score: number) {
  if (score >= 80) return 'text-purple-400'
  if (score >= 65) return 'text-emerald-400'
  if (score >= 50) return 'text-blue-400'
  return 'text-amber-400'
}
function breakoutColor(strength: string) {
  if (strength.includes('HIGH_MOMENTUM')) return 'text-emerald-400'
  if (strength.includes('CONFIRMED'))     return 'text-blue-400'
  return 'text-amber-400'
}
function oiColor(oi: string) {
  if (oi === 'NEW_LONGS')        return 'text-emerald-400'
  if (oi === 'NEW_SHORTS')       return 'text-red-400'
  if (oi === 'SHORT_COVERING')   return 'text-amber-400'
  if (oi === 'LONG_LIQUIDATION') return 'text-red-400'
  return 'text-zinc-400'
}
function posColor(pos: string) {
  if (pos === 'EXTREME_SHORT') return 'text-emerald-400'
  if (pos === 'SHORT_HEAVY')   return 'text-green-400'
  if (pos === 'EXTREME_LONG')  return 'text-red-400'
  if (pos === 'LONG_HEAVY')    return 'text-amber-400'
  return 'text-zinc-400'
}
function shortLabel(s: string) { return s.replace(/_/g,' ') }
function gradeRank(g: RiskGrade | undefined): number { return g ? (GRADE_RANK[g] ?? 5) : 5 }

// ── Track record helpers ───────────────────────────────────────────────────────

function wrColor(wr: number | null): string {
  if (wr == null) return 'text-zinc-500'
  return wr >= 50 ? 'text-emerald-400' : wr >= 40 ? 'text-blue-400' : wr >= 30 ? 'text-amber-400' : 'text-red-400'
}
function expColor(exp: number | null): string {
  if (exp == null) return 'text-zinc-500'
  return exp >= 0.5 ? 'text-emerald-400' : exp >= 0.2 ? 'text-blue-400' : exp >= 0 ? 'text-amber-400' : 'text-red-400'
}
function pfColor(pf: number | null): string {
  if (pf == null) return 'text-zinc-500'
  return pf >= 2 ? 'text-emerald-400' : pf >= 1.5 ? 'text-blue-400' : pf >= 1.0 ? 'text-amber-400' : 'text-red-400'
}
function modeDisplayLabel(m: string): string {
  if (m === 'high_confidence') return 'High Conf'
  return m.charAt(0).toUpperCase() + m.slice(1)
}

// ── Signal freshness window (matches signal-lifecycle.ts LIFETIME_MS) ─────────

const FRESHNESS_WINDOW_H: Record<string, number> = { '15m': 2, '1h': 8, '4h': 24, '1d': 72 }

// ── Micro components ───────────────────────────────────────────────────────────

function GradeBadge({ grade }: { grade: RiskGrade }) {
  return (
    <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded border shrink-0', GRADE_STYLE[grade] ?? 'text-zinc-500 border-zinc-700 bg-zinc-800')}>
      {grade}
    </span>
  )
}

function ConfBar({ confidence }: { confidence: number }) {
  const pct = Math.min(100, Math.max(0, confidence))
  const color = pct >= 90 ? 'bg-emerald-400' : pct >= 80 ? 'bg-blue-400' : pct >= 70 ? 'bg-amber-400' : 'bg-red-400'
  return (
    <div className="w-14 h-1 bg-zinc-700 rounded-full overflow-hidden shrink-0 hidden sm:block">
      <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
    </div>
  )
}

function RegimeAlignDot({ alignment }: { alignment: 'aligned' | 'contra' | 'neutral' }) {
  if (alignment === 'aligned') return (
    <span title="Regime aligned" className="shrink-0 flex items-center gap-0.5 text-[10px] text-emerald-400 hidden sm:flex">
      <CheckCircle2 className="w-3 h-3" />
    </span>
  )
  if (alignment === 'contra') return (
    <span title="Contra-regime" className="shrink-0 flex items-center gap-0.5 text-[10px] text-amber-400 hidden sm:flex">
      <XCircle className="w-3 h-3" />
    </span>
  )
  return <span className="w-3 h-3 shrink-0 hidden sm:block" />
}

// ── Phase J — Signal freshness for ACTIVE signals ────────────────────────────

function FreshnessTag({ sig }: { sig: TacticalSignalRow }) {
  if (sig.lifecycleStage !== 'ACTIVE') return null
  const windowH = FRESHNESS_WINDOW_H[sig.timeframe] ?? 8
  const createdMs = sig.createdAt ? new Date(String(sig.createdAt)).getTime() : null
  if (!createdMs) return null
  const elapsedH = (Date.now() - createdMs) / 3_600_000
  const remainH  = Math.max(0, windowH - elapsedH)
  if (remainH <= 0) return null
  const pct   = remainH / windowH
  const color = pct > 0.5 ? 'text-green-400 border-green-500/30 bg-green-500/5'
    : pct > 0.25 ? 'text-amber-400 border-amber-500/30 bg-amber-500/5'
    : 'text-red-400 border-red-500/30 bg-red-500/5'
  const label = remainH >= 1 ? `${remainH.toFixed(0)}h left` : `${Math.round(remainH * 60)}m left`
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded border font-mono shrink-0 hidden sm:inline ${color}`}
      title={`Signal active — ${windowH}h window`}>
      ⏱ {label}
    </span>
  )
}

// ── Phase A — Founder Command Center ─────────────────────────────────────────

function FounderCommandCenter({ trackRecord }: { trackRecord: TrackRecordResponse | null }) {
  if (!trackRecord || !trackRecord.windows) return null
  const d7  = trackRecord.windows.d7
  const d30 = trackRecord.windows.d30
  const d90 = trackRecord.windows.d90
  if (!d7 || !d30 || !d90) return null
  const windows = [
    { label: '7d',  w: d7  },
    { label: '30d', w: d30 },
    { label: '90d', w: d90 },
  ] as const
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-4">
      <div className="flex items-center gap-2 mb-3">
        <BarChart2 className="w-3.5 h-3.5 text-zinc-500" />
        <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-widest">Verified Performance</span>
        <span className="text-[10px] text-zinc-600 font-mono ml-auto">{trackRecord.source}</span>
      </div>
      <div className="grid grid-cols-3 gap-3 mb-4">
        {windows.map(({ label, w }) => {
          const exp = toNum(w.expectancy)
          const pf  = toNum(w.pf)
          const wr  = toNum(w.win_rate)
          return (
          <div key={label} className="bg-zinc-800/50 rounded-lg px-3 py-2.5">
            <p className="text-[9px] text-zinc-500 uppercase tracking-widest mb-2">{label} · {w.resolved} resolved</p>
            <div className="space-y-1.5">
              <div className="flex justify-between items-center">
                <span className="text-[10px] text-zinc-500">Win Rate</span>
                <span className={`text-[11px] font-mono font-bold ${wrColor(wr)}`}>
                  {wr != null ? `${wr}%` : '—'}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[10px] text-zinc-500">Expectancy</span>
                <span className={`text-[11px] font-mono font-bold ${expColor(exp)}`}>
                  {exp != null ? `${exp > 0 ? '+' : ''}${exp.toFixed(2)}R` : '—'}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[10px] text-zinc-500">Prof Factor</span>
                <span className={`text-[11px] font-mono font-bold ${pfColor(pf)}`}>
                  {pf != null ? pf.toFixed(2) : '—'}
                </span>
              </div>
            </div>
          </div>
        )})}
      </div>
      {(trackRecord.by_mode_30d ?? []).length > 0 && (
        <div className="mb-3">
          <p className="text-[9px] text-zinc-500 uppercase tracking-widest mb-2">By Mode · 30d</p>
          <div className="flex flex-wrap gap-2">
            {(trackRecord.by_mode_30d ?? []).map(m => {
              const mExp = toNum(m.exp)
              const mWr  = toNum(m.wr)
              return (
              <div key={m.scanner_mode} className={`flex items-center gap-1.5 text-[10px] px-2 py-1 rounded border bg-zinc-800/40 ${MODE_COLORS[m.scanner_mode] ?? 'text-zinc-400 border-zinc-700'}`}>
                <span className="font-semibold">{modeDisplayLabel(m.scanner_mode)}</span>
                <span className="text-zinc-600">·</span>
                <span className={wrColor(mWr)}>{mWr != null ? `${mWr}% WR` : '—'}</span>
                {mExp != null && <span className={expColor(mExp)}>{mExp > 0 ? '+' : ''}{mExp.toFixed(2)}R</span>}
                <span className="text-zinc-600">n={m.n}</span>
              </div>
            )})}
          </div>
        </div>
      )}
      {trackRecord.probability_accuracy != null && trackRecord.probability_accuracy.n >= 10 && (
        <div className="border-t border-zinc-800 pt-2 mt-1 flex flex-wrap gap-x-5 gap-y-1 text-[10px]">
          <span className="text-zinc-500">Probability Engine · n={trackRecord.probability_accuracy.n}</span>
          {toNum(trackRecord.probability_accuracy.avg_predicted_wr) != null && (
            <span>Predicted <span className="text-zinc-300 font-mono">{toNum(trackRecord.probability_accuracy.avg_predicted_wr)!.toFixed(0)}%</span></span>
          )}
          {toNum(trackRecord.probability_accuracy.realized_wr) != null && (
            <span>Actual <span className="text-zinc-300 font-mono">{toNum(trackRecord.probability_accuracy.realized_wr)!.toFixed(0)}%</span></span>
          )}
          {toNum(trackRecord.probability_accuracy.mean_abs_error) != null && (() => {
            const mae = toNum(trackRecord.probability_accuracy.mean_abs_error)!
            return (
              <span>MAE <span className={`font-mono ${mae <= 0.1 ? 'text-emerald-400' : mae <= 0.2 ? 'text-amber-400' : 'text-red-400'}`}>
                {(mae * 100).toFixed(0)}pp
              </span></span>
            )
          })()}
        </div>
      )}
    </div>
  )
}

// ── Phase F — Grade Validation Strip ─────────────────────────────────────────

function GradeValidationStrip() {
  type GradeRow = { grade: string; n: number; wr: number | null; exp: number | null; pf: number | null }
  type VerifyData = { grades?: { heuristic?: GradeRow[]; empirical?: GradeRow[] } }
  const fetcher = useCallback(() => adminApi.analytics.performanceVerification<VerifyData>().catch(() => null), [])
  const { data } = useAutoRefresh<VerifyData | null>(fetcher, 300_000)
  const empirical = (data?.grades?.empirical ?? []).filter(g => g.n >= 10)
  const heuristic = (data?.grades?.heuristic ?? []).filter(g => g.n >= 10)
  if (empirical.length === 0 && heuristic.length === 0) return null
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-3">
      <p className="text-[9px] text-zinc-500 uppercase tracking-widest mb-2.5">Grade Validation · Historical Win Rates</p>
      <div className="space-y-2">
        {empirical.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[9px] text-emerald-500 uppercase tracking-wider shrink-0 w-14">Empirical</span>
            {empirical.map(g => (
              <span key={g.grade ?? 'unknown'} className={cn('text-[10px] px-2 py-0.5 rounded border font-mono', GRADE_STYLE[g.grade?.charAt(0) ?? ''] ?? 'text-zinc-400 border-zinc-700 bg-zinc-800')}
                title={`n=${g.n} · Exp: ${g.exp != null ? (g.exp > 0 ? '+' : '') + g.exp.toFixed(2) + 'R' : '—'} · PF: ${g.pf?.toFixed(1) ?? '—'}`}>
                {g.grade} {g.wr != null ? `${g.wr.toFixed(0)}% WR` : '—'}
              </span>
            ))}
          </div>
        )}
        {heuristic.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[9px] text-zinc-500 uppercase tracking-wider shrink-0 w-14">Heuristic</span>
            {heuristic.map(g => (
              <span key={g.grade} className="text-[10px] px-2 py-0.5 rounded border font-mono text-zinc-400 border-zinc-700"
                title={`n=${g.n} · Exp: ${g.exp != null ? (g.exp > 0 ? '+' : '') + g.exp.toFixed(2) + 'R' : '—'}`}>
                {g.grade} {g.wr != null ? `${g.wr.toFixed(0)}% WR` : '—'}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function IntelligencePanel({ sig }: { sig: TacticalSignalRow }) {
  type IntelField = { label: string; value: string; color?: string }
  // Extract ADX from setup description ("... | ADX: 35") before it gets stripped
  const adxMatch = sig.setupDescription?.match(/\|\s*ADX:\s*(\d+(?:\.\d+)?)/i)
  const adxValue = adxMatch ? parseFloat(adxMatch[1]) : null

  const fields: IntelField[] = [
    ...(sig.trendScore != null ? [{ label: 'TrendScore', value: trendScoreLabel(sig.trendScore), color: trendScoreColor(sig.trendScore) }] : []),
    ...(sig.sectorStatus ? [{ label: 'Sector', value: shortLabel(sig.sectorStatus) }] : []),
    ...(sig.breakoutStrength ? [{
      label: 'Breakout',
      value: shortLabel(sig.breakoutStrength) + (sig.breakoutType ? ` · ${sig.breakoutType.replace(/_/g,' ')}` : ''),
      color: breakoutColor(sig.breakoutStrength),
    }] : []),
    ...(sig.oiInterpretation ? [{ label: 'OI', value: shortLabel(sig.oiInterpretation), color: oiColor(sig.oiInterpretation) }] : []),
    ...(sig.fundingTrend ? [{
      label: 'Funding',
      value: sig.fundingTrend + (sig.fundingTrend === 'RISING' ? ' ↗' : sig.fundingTrend === 'FALLING' ? ' ↘' : ' →'),
      color: sig.fundingTrend === 'RISING' ? 'text-amber-400' : sig.fundingTrend === 'FALLING' ? 'text-emerald-400' : 'text-zinc-400',
    }] : []),
    ...(sig.positioningContext ? [{ label: 'Positioning', value: shortLabel(sig.positioningContext), color: posColor(sig.positioningContext) }] : []),
    ...(sig.marketRegime ? [{ label: 'Regime', value: shortLabel(sig.marketRegime) }] : []),
    ...(adxValue != null ? [{ label: 'ADX', value: adxValue.toFixed(0), color: adxValue >= 40 ? 'text-emerald-400' : adxValue >= 30 ? 'text-blue-400' : adxValue < 18 ? 'text-red-400' : 'text-zinc-300' }] : []),
    ...(sig.mcapTier ? [{ label: 'MCap', value: sig.mcapTier.charAt(0).toUpperCase() + sig.mcapTier.slice(1) }] : []),
    ...(sig.extensionRisk && sig.extensionRisk !== 'LOW' ? [{ label: 'Ext Risk', value: sig.extensionRisk, color: sig.extensionRisk === 'HIGH' ? 'text-red-400' : 'text-amber-400' }] : []),
    ...(sig.pullbackQuality ? [{ label: 'Pullback', value: shortLabel(String(sig.pullbackQuality)) }] : []),
  ]

  const hasAI = !!(sig.aiReasoning)
  const hasSetup = !!(sig.setupDescription)
  const qs = sig.qualityScore
  const rs = sig.riskScore

  // Phase B: why this signal
  const contProb = sig.continuation?.continuationProbability ?? null
  const contCase = sig.continuation?.reasons?.[0] ?? null
  const iq       = sig.entryQualityScore
  const iScore   = sig.institutionalScore
  const ras      = sig.regimeAlignmentScore
  const hasWhySection = contProb != null || iq != null || iScore != null || ras != null

  // Phase C: empirical trust
  const hasEmpiricalData = sig.empiricalWr != null

  // Phase G: technical indicators
  const rsi         = sig.indicators?.rsi
  const volumeSpike = sig.indicators?.volumeSpike
  const hasTechnical = (rsi != null && rsi > 0) || (volumeSpike != null && volumeSpike > 0)

  // Phase H: futures data
  const fd           = sig.futuresData
  const hasFutures   = !!fd && (sig.scannerMode === 'futures' || sig.scannerMode === 'high_confidence')

  // Extended technical (Python-side fields not in TS type — cast to access)
  const indRaw     = sig.indicators as unknown as Record<string, unknown>
  const ema200Raw  = indRaw?.ema200 as number | null | undefined
  const ema200Pos  = ema200Raw && sig.indicators.currentPrice
    ? (sig.indicators.currentPrice > ema200Raw ? 'ABOVE' : 'BELOW') : null
  const candlePat  = (indRaw?.candle_pattern as string | null | undefined) ?? null
  const bbRaw      = indRaw?.bb as Record<string, unknown> | null | undefined
  const bbSqueeze  = bbRaw?.squeeze as boolean | null | undefined
  const hasExtTech = !!(ema200Pos || (candlePat && candlePat !== 'NONE') || bbSqueeze)

  // AI explainability fields
  const aiExp            = sig.aiExplainability
  const aiSummary        = aiExp?.summary ?? null
  const aiContCase       = aiExp?.continuationCase ?? null
  const aiCautionCase    = aiExp?.cautionCase ?? null
  const hasAiExpl        = !!(aiSummary || aiContCase || aiCautionCase)
  const hasRisksStrengths = ((sig.strengths?.length ?? 0) > 0) || ((sig.risks?.length ?? 0) > 0)

  const slDistPct = sig.entryPrice && sig.stopLoss
    ? fmtDistPct(sig.entryPrice, sig.stopLoss, sig.type as 'BUY' | 'SELL', 'sl')
    : null
  const tpDistPct = sig.entryPrice && sig.targetPrice
    ? fmtDistPct(sig.entryPrice, sig.targetPrice, sig.type as 'BUY' | 'SELL', 'tp')
    : null

  if (fields.length === 0 && !hasAI && !hasSetup && qs == null && !hasEmpiricalData) {
    return (
      <div className="border-t border-zinc-800 px-4 py-3 text-[11px] text-zinc-600">
        No intelligence data available for this signal.
      </div>
    )
  }

  return (
    <div className="border-t border-zinc-800 px-4 py-3 space-y-2.5">
      {/* Phase C — Empirical Trust Layer */}
      {hasEmpiricalData && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 rounded-lg bg-zinc-800/40 border border-zinc-700/50">
          <span className="text-[10px] text-zinc-500 uppercase tracking-widest shrink-0">Empirical</span>
          {sig.empiricalWr != null && (
            <span className={`text-[11px] font-mono font-bold ${sig.empiricalWr >= 55 ? 'text-emerald-400' : sig.empiricalWr >= 45 ? 'text-blue-400' : 'text-amber-400'}`}>
              {sig.empiricalWr.toFixed(0)}% WR
            </span>
          )}
          {sig.empiricalN != null && (
            <span className="text-[10px] text-zinc-500 font-mono">n={sig.empiricalN}</span>
          )}
          {sig.empiricalGrade && (
            <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded border', GRADE_STYLE[sig.empiricalGrade.charAt(0)] ?? 'text-zinc-500 border-zinc-700 bg-zinc-800')}>
              Emp {sig.empiricalGrade}
            </span>
          )}
        </div>
      )}
      {/* Quality + Risk scores + trade distances */}
      {(qs != null || rs != null || slDistPct || tpDistPct) && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
          {qs != null && (
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Quality</span>
              <div className="flex items-center gap-1.5">
                <div className="w-14 h-1 bg-zinc-700 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${qs >= 70 ? 'bg-emerald-400' : qs >= 50 ? 'bg-blue-400' : 'bg-amber-400'}`}
                    style={{ width: `${Math.min(100, qs)}%` }} />
                </div>
                <span className={`text-[11px] font-mono font-semibold ${qs >= 70 ? 'text-emerald-400' : qs >= 50 ? 'text-blue-400' : 'text-amber-400'}`}>
                  {Math.round(qs)}/100
                </span>
              </div>
            </div>
          )}
          {rs != null && (
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Risk</span>
              <span className={`text-[11px] font-mono font-semibold ${rs <= 25 ? 'text-emerald-400' : rs <= 45 ? 'text-blue-400' : rs <= 60 ? 'text-amber-400' : 'text-red-400'}`}>
                {Math.round(rs)}/100
              </span>
            </div>
          )}
          {tpDistPct && (
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-zinc-500 uppercase tracking-wider">TP dist</span>
              <span className="text-[11px] font-mono font-semibold text-emerald-400">{tpDistPct}</span>
            </div>
          )}
          {slDistPct && (
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-zinc-500 uppercase tracking-wider">SL dist</span>
              <span className="text-[11px] font-mono font-semibold text-red-400">{slDistPct}</span>
            </div>
          )}
        </div>
      )}
      {/* Intelligence fields */}
      {fields.length > 0 && (
        <div className="flex flex-wrap gap-x-5 gap-y-1.5">
          {fields.map((f, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <span className="text-[10px] text-zinc-500 uppercase tracking-wider">{f.label}</span>
              <span className={cn('text-[11px] font-mono font-semibold', f.color ?? 'text-zinc-300')}>{f.value}</span>
            </div>
          ))}
        </div>
      )}
      {/* Phase G — Technical Context */}
      {hasTechnical && (
        <div className="flex flex-wrap gap-x-5 gap-y-1.5">
          {rsi != null && rsi > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-zinc-500 uppercase tracking-wider">RSI 1h</span>
              <span className={`text-[11px] font-mono font-semibold ${rsi >= 70 ? 'text-red-400' : rsi >= 60 ? 'text-amber-400' : rsi <= 30 ? 'text-green-400' : rsi <= 40 ? 'text-emerald-400' : 'text-zinc-300'}`}>
                {rsi.toFixed(1)}
              </span>
            </div>
          )}
          {volumeSpike != null && volumeSpike > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Vol Spike</span>
              <span className={`text-[11px] font-mono font-semibold ${volumeSpike >= 2.5 ? 'text-emerald-400' : volumeSpike >= 1.5 ? 'text-blue-400' : volumeSpike < 0.8 ? 'text-red-400' : 'text-zinc-300'}`}>
                {volumeSpike.toFixed(1)}×
              </span>
            </div>
          )}
        </div>
      )}
      {/* Phase H — Futures Intelligence */}
      {hasFutures && fd && (
        <div className="flex flex-wrap gap-x-5 gap-y-1.5">
          {fd.fundingRate != null && (
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Funding Rate</span>
              <span className={`text-[11px] font-mono font-semibold ${Math.abs(fd.fundingRate) > 0.0005 ? 'text-amber-400' : 'text-zinc-300'}`}>
                {fd.fundingRate >= 0 ? '+' : ''}{(fd.fundingRate * 100).toFixed(4)}%
              </span>
            </div>
          )}
          {fd.fundingRateAnnualized != null && Math.abs(fd.fundingRateAnnualized) > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Annualized</span>
              <span className={`text-[11px] font-mono font-semibold ${Math.abs(fd.fundingRateAnnualized) > 50 ? 'text-red-400' : Math.abs(fd.fundingRateAnnualized) > 20 ? 'text-amber-400' : 'text-zinc-300'}`}>
                {fd.fundingRateAnnualized >= 0 ? '+' : ''}{fd.fundingRateAnnualized.toFixed(1)}%
              </span>
            </div>
          )}
          {fd.fundingBias && fd.fundingBias !== 'NEUTRAL' && (
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Fund Bias</span>
              <span className={`text-[11px] font-mono font-semibold ${fd.fundingBias === 'SHORT_HEAVY' ? 'text-emerald-400' : 'text-amber-400'}`}>
                {fd.fundingBias.replace('_', ' ')}
              </span>
            </div>
          )}
          {fd.oiTrend && (
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-zinc-500 uppercase tracking-wider">OI Trend</span>
              <span className={`text-[11px] font-mono font-semibold ${fd.oiTrend === 'RISING' ? 'text-emerald-400' : fd.oiTrend === 'FALLING' ? 'text-red-400' : 'text-zinc-400'}`}>
                {fd.oiTrend}
              </span>
            </div>
          )}
          {fd.oiChange24h != null && (
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-zinc-500 uppercase tracking-wider">OI 24h</span>
              <span className={`text-[11px] font-mono font-semibold ${fd.oiChange24h > 5 ? 'text-emerald-400' : fd.oiChange24h < -5 ? 'text-red-400' : 'text-zinc-300'}`}>
                {fd.oiChange24h > 0 ? '+' : ''}{fd.oiChange24h.toFixed(1)}%
              </span>
            </div>
          )}
          {fd.longShortRatio != null && (
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-zinc-500 uppercase tracking-wider">L/S Ratio</span>
              <span className="text-[11px] font-mono font-semibold text-zinc-300">{fd.longShortRatio.toFixed(2)}</span>
            </div>
          )}
          {fd.momentumScore != null && fd.momentumScore > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Momentum</span>
              <span className={`text-[11px] font-mono font-semibold ${fd.momentumScore >= 70 ? 'text-emerald-400' : fd.momentumScore >= 50 ? 'text-blue-400' : 'text-amber-400'}`}>
                {fd.momentumScore}/100
              </span>
            </div>
          )}
          {sig.maxSafeLeverage != null && sig.maxSafeLeverage > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Max Lev</span>
              <span className="text-[11px] font-mono font-semibold text-zinc-300">{sig.maxSafeLeverage}×</span>
            </div>
          )}
        </div>
      )}
      {/* Liquidation Zones */}
      {hasFutures && fd && fd.liquidationZones && fd.liquidationZones.length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] text-zinc-500 uppercase tracking-wider">Liquidation Zones</p>
          <div className="flex flex-wrap gap-1.5">
            {fd.liquidationZones.slice(0, 4).map((z, i) => (
              <span
                key={i}
                className={`text-[10px] font-mono px-2 py-0.5 rounded border ${
                  z.side === 'LONG_LIQ'
                    ? 'text-red-400 border-red-500/20 bg-red-500/5'
                    : 'text-emerald-400 border-emerald-500/20 bg-emerald-500/5'
                }`}
              >
                {z.side === 'LONG_LIQ' ? '↓' : '↑'} ${z.price.toFixed(2)} · {z.distancePct.toFixed(1)}% away
                {z.strength !== 'WEAK' && <span className="ml-1 opacity-60">({z.strength.toLowerCase()})</span>}
              </span>
            ))}
          </div>
        </div>
      )}
      {/* Extended Technical Context — ema200 position, candle pattern, BB squeeze */}
      {hasExtTech && (
        <div className="flex flex-wrap gap-x-5 gap-y-1.5 items-center">
          {ema200Pos && (
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-zinc-500 uppercase tracking-wider">EMA200</span>
              <span className={`text-[11px] font-mono font-semibold ${ema200Pos === 'ABOVE' ? 'text-emerald-400' : 'text-red-400'}`}>
                {ema200Pos} {ema200Pos === 'ABOVE' ? '↑' : '↓'}
              </span>
            </div>
          )}
          {candlePat && candlePat !== 'NONE' && (
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Pattern</span>
              <span className="text-[11px] font-mono font-semibold text-blue-400">
                {candlePat.replace(/_/g, ' ')}
              </span>
            </div>
          )}
          {bbSqueeze && (
            <span className="text-[10px] font-semibold text-purple-400 border border-purple-500/30 bg-purple-500/10 px-1.5 py-0.5 rounded">
              ⚡ BB SQUEEZE
            </span>
          )}
        </div>
      )}
      {/* Phase B — Why This Signal */}
      {hasWhySection && (
        <div className="flex flex-wrap gap-x-5 gap-y-1.5">
          {contProb != null && (
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Continuation</span>
              <span className={`text-[11px] font-mono font-semibold ${contProb >= 60 ? 'text-emerald-400' : contProb >= 40 ? 'text-amber-400' : 'text-red-400'}`}>
                {contProb}%
              </span>
            </div>
          )}
          {iq != null && (
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Entry Quality</span>
              <span className={`text-[11px] font-mono font-semibold ${iq >= 70 ? 'text-emerald-400' : iq >= 50 ? 'text-blue-400' : 'text-amber-400'}`}>
                {Math.round(iq)}/100
              </span>
            </div>
          )}
          {iScore != null && (
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Institutional</span>
              <span className={`text-[11px] font-mono font-semibold ${iScore >= 70 ? 'text-emerald-400' : iScore >= 50 ? 'text-blue-400' : 'text-amber-400'}`}>
                {Math.round(iScore)}/100
              </span>
            </div>
          )}
          {ras != null && (
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Regime Adj</span>
              <span className={`text-[11px] font-mono font-semibold ${ras >= 5 ? 'text-emerald-400' : ras >= 0 ? 'text-zinc-300' : 'text-amber-400'}`}>
                {ras > 0 ? '+' : ''}{Math.round(ras)}
              </span>
            </div>
          )}
        </div>
      )}
      {contCase && (
        <p className="text-[10px] text-zinc-500 leading-relaxed border-l-2 border-zinc-800 pl-2.5 italic">
          {contCase}
        </p>
      )}
      {/* AI Explainability — summary, continuation case, caution case */}
      {hasAiExpl && (
        <div className="space-y-1.5">
          {aiSummary && (
            <p className="text-[11px] text-zinc-300 font-medium leading-snug">
              {aiSummary}
            </p>
          )}
          {aiContCase && (
            <p className="text-[10px] text-emerald-400/75 leading-relaxed border-l-2 border-emerald-600/30 pl-2.5">
              ↗ {aiContCase}
            </p>
          )}
          {aiCautionCase && (
            <p className="text-[10px] text-amber-400/75 leading-relaxed border-l-2 border-amber-600/30 pl-2.5">
              ⚠ {aiCautionCase}
            </p>
          )}
        </div>
      )}
      {/* Risks & Strengths from AI validation */}
      {hasRisksStrengths && (
        <div className="space-y-1">
          {(sig.strengths?.length ?? 0) > 0 && (
            <div className="flex flex-wrap gap-1">
              {sig.strengths!.slice(0, 3).map((s, i) => (
                <span key={i} className="text-[9px] text-emerald-400/80 border border-emerald-500/20 bg-emerald-500/5 px-1.5 py-0.5 rounded">
                  ✓ {s}
                </span>
              ))}
            </div>
          )}
          {(sig.risks?.length ?? 0) > 0 && (
            <div className="flex flex-wrap gap-1">
              {sig.risks!.slice(0, 3).map((r, i) => (
                <span key={i} className="text-[9px] text-red-400/80 border border-red-500/20 bg-red-500/5 px-1.5 py-0.5 rounded">
                  ⚠ {r}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
      {/* Setup description */}
      {hasSetup && (
        <p className="text-[10px] text-zinc-500 leading-relaxed border-l-2 border-zinc-800 pl-2.5 font-mono">
          {sig.setupDescription!.replace(/\s*\|\s*ADX:.*$/i, '')}
        </p>
      )}
      {/* AI reasoning — full, no truncation (Phase B) */}
      {hasAI && (
        <p className="text-[11px] text-zinc-400 leading-relaxed border-l-2 border-zinc-700 pl-2.5 italic">
          &ldquo;{sig.aiReasoning!}&rdquo;
        </p>
      )}
    </div>
  )
}

// ── Shared sub-components ──────────────────────────────────────────────────────

function MetricTile({ label, value, sub, accent = 'default' }: {
  label: string; value: ReactNode; sub?: string
  accent?: 'green' | 'red' | 'amber' | 'blue' | 'default'
}) {
  const colors = { green:'text-green-400', red:'text-red-400', amber:'text-amber-400', blue:'text-blue-400', default:'text-white' }
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3">
      <div className="text-[10px] text-zinc-500 uppercase tracking-widest mb-1">{label}</div>
      <div className={`text-xl font-bold font-mono ${colors[accent]}`}>{value}</div>
      {sub && <div className="text-[11px] text-zinc-600 mt-0.5">{sub}</div>}
    </div>
  )
}

function OpsToggle({ label, description, enabled, loading, icon, onEnable, onDisable, inverse }: {
  label: string; description: string; enabled: boolean | null; loading: boolean
  icon: React.ReactNode; onEnable: () => void; onDisable: () => void; inverse?: boolean
}) {
  const isActive = enabled === true
  return (
    <div className={cn('glass-card rounded-xl p-4 flex items-start sm:items-center gap-4 flex-col sm:flex-row transition-colors', inverse && isActive ? 'border-red-500/40 bg-red-900/10' : '')}>
      <div className={cn('p-2.5 rounded-lg shrink-0', inverse && isActive ? 'bg-red-500/20 text-red-400' : isActive ? 'bg-emerald-500/15 text-emerald-400' : 'bg-zinc-800 text-zinc-500')}>{icon}</div>
      <div className="flex-1 min-w-0">
        <p className="text-terminal-text font-semibold text-sm">{label}</p>
        <p className="text-terminal-muted text-xs mt-0.5 leading-relaxed">{description}</p>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <span className={cn('text-xs font-mono px-2 py-0.5 rounded-md border',
          enabled===null ? 'text-zinc-500 border-zinc-700 bg-zinc-800'
          : inverse && isActive ? 'text-red-300 border-red-500/30 bg-red-500/10'
          : isActive ? 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10'
          : 'text-zinc-400 border-zinc-700 bg-zinc-800')}>
          {enabled===null ? '…' : inverse ? (isActive ? 'ACTIVE' : 'CLEAR') : (isActive ? 'ON' : 'OFF')}
        </span>
        {inverse ? (
          isActive
            ? <button onClick={onDisable} disabled={loading||enabled===null} className="text-xs px-3 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-300 hover:bg-zinc-700 disabled:opacity-40 transition-colors">Clear Stop</button>
            : <button onClick={onEnable}  disabled={loading||enabled===null} className="text-xs px-3 py-1.5 rounded-lg bg-red-500/20 border border-red-500/40 text-red-300 hover:bg-red-500/30 disabled:opacity-40 transition-colors font-semibold">Activate</button>
        ) : (
          isActive
            ? <button onClick={onDisable} disabled={loading||enabled===null} className="text-xs px-3 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-300 hover:bg-zinc-700 disabled:opacity-40 transition-colors">Disable</button>
            : <button onClick={onEnable}  disabled={loading||enabled===null} className="text-xs px-3 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-40 transition-colors">Enable</button>
        )}
      </div>
    </div>
  )
}

// ── Signal Quality Scorecard ───────────────────────────────────────────────────

type KpiLevel = 'green' | 'amber' | 'red' | 'dim'
function kpiColor(level: KpiLevel) {
  if (level === 'green') return 'text-emerald-400'
  if (level === 'amber') return 'text-amber-400'
  if (level === 'red')   return 'text-red-400'
  return 'text-zinc-500'
}
function dotColor(level: KpiLevel) {
  if (level === 'green') return 'bg-emerald-400'
  if (level === 'amber') return 'bg-amber-400'
  if (level === 'red')   return 'bg-red-400'
  return 'bg-zinc-600'
}

function ScorecardCell({ label, value, level, sub }: { label: string; value: string; level: KpiLevel; sub?: string }) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <span className="text-[9px] text-zinc-500 uppercase tracking-widest leading-none">{label}</span>
      <div className="flex items-center gap-1.5">
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotColor(level)}`} />
        <span className={`text-base font-bold font-mono leading-none ${kpiColor(level)}`}>{value}</span>
      </div>
      {sub && <span className="text-[9px] text-zinc-600 leading-none">{sub}</span>}
    </div>
  )
}

function SignalQualityScorecard({ counts, gradeAPct }: { counts: SignalCounts | null; gradeAPct: number | null }) {
  if (!counts || counts.resolved_7d === 0) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-3">
        <p className="text-[10px] text-zinc-500 uppercase tracking-widest mb-2">Signal Quality Scorecard</p>
        <p className="text-zinc-600 text-xs">No resolved signals yet — scorecard updates after first resolved trade.</p>
      </div>
    )
  }
  const wr = counts.win_rate_7d
  const exp = counts.expectancy_7d
  const pf = counts.profit_factor_7d ?? 0
  const rr = counts.avg_rr_achieved_7d ?? 0

  const wrLevel: KpiLevel  = wr >= 48 ? 'green' : wr >= 38 ? 'amber' : 'red'
  const expLevel: KpiLevel = exp >= 0.35 ? 'green' : exp >= 0.05 ? 'amber' : 'red'
  const pfLevel: KpiLevel  = pf >= 1.5 ? 'green' : pf >= 1.0 ? 'amber' : pf > 0 ? 'red' : 'dim'
  const rrLevel: KpiLevel  = rr >= 2.0 ? 'green' : rr >= 1.5 ? 'amber' : rr > 0 ? 'red' : 'dim'
  const gaLevel: KpiLevel  = gradeAPct != null ? (gradeAPct >= 55 ? 'green' : gradeAPct >= 40 ? 'amber' : 'red') : 'dim'

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-3">
      <p className="text-[9px] text-zinc-500 uppercase tracking-widest mb-3">Signal Quality Scorecard · 7d · {counts.resolved_7d} resolved</p>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <ScorecardCell label="Win Rate"       value={`${wr}%`}    level={wrLevel}  />
        <ScorecardCell label="Expectancy"     value={`${exp > 0 ? '+' : ''}${exp}R`} level={expLevel} />
        <ScorecardCell label="Profit Factor"  value={pf > 0 ? fmt(pf) : '—'} level={pfLevel} />
        <ScorecardCell label="Avg RR Hit"     value={rr > 0 ? `${fmt(rr)}:1` : '—'} level={rrLevel} />
        <ScorecardCell label="Grade A %"      value={gradeAPct != null ? `${gradeAPct}%` : '—'} level={gaLevel} sub="of graded signals" />
      </div>
    </div>
  )
}

// ── System Status Banner ───────────────────────────────────────────────────────

function SystemStatusBanner({ celery, flags, providers }: {
  celery: CeleryStatus | null; flags: OpsFlags | null; providers: ProviderStatus[]
}) {
  const issues: string[] = []
  if (flags?.emergency_stop)  issues.push('Emergency Stop ACTIVE')
  if (flags?.maintenance_mode) issues.push('Maintenance Mode ON')
  if (celery?.is_overdue && celery?.enabled) issues.push('Scanner overdue')
  if (!celery?.enabled) issues.push('Scanner paused')
  const unhealthy = providers.filter(p => !p.healthy)
  if (unhealthy.length > 0) issues.push(`${unhealthy.length} provider${unhealthy.length > 1 ? 's' : ''} unhealthy`)

  const ok = issues.length === 0
  return (
    <div className={cn('rounded-lg px-4 py-2.5 flex items-center gap-3 text-sm',
      ok ? 'bg-emerald-500/5 border border-emerald-500/20' : 'bg-amber-500/5 border border-amber-500/25')}>
      <span className={`w-2 h-2 rounded-full shrink-0 ${ok ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'}`} />
      <span className={ok ? 'text-emerald-300' : 'text-amber-300'}>
        {ok ? 'All Systems Operational' : `${issues.length} Issue${issues.length > 1 ? 's' : ''} Detected: ${issues.join(' · ')}`}
      </span>
    </div>
  )
}

// ── Provider Health Row ────────────────────────────────────────────────────────

function ProviderHealthRow({ providers }: { providers: ProviderStatus[] }) {
  if (providers.length === 0) return null
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-3">
      <p className="text-[9px] text-zinc-500 uppercase tracking-widest mb-2.5">Provider Health</p>
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {providers.map(p => (
          <div key={p.name} className="flex items-center gap-2">
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${p.healthy ? 'bg-emerald-400' : 'bg-red-400 animate-pulse'}`} />
            <span className={`text-xs font-medium ${p.healthy ? 'text-zinc-300' : 'text-red-300'}`}>{p.name}</span>
            {p.latencyMs > 0 && <span className="text-[10px] text-zinc-600 font-mono">{p.latencyMs}ms</span>}
            {p.note && <span className="text-[10px] text-zinc-600">{p.note}</span>}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Overview tab ───────────────────────────────────────────────────────────────

function OverviewTab({ celery, regime, signalCounts, providers, cache, signals, countdown, flags, onPause, pausing, trackRecord }: {
  celery: CeleryStatus | null; regime: RegimeData | null; signalCounts: SignalCounts | null
  providers: ProviderStatus[]; cache: CacheTelemetry | null; flags: OpsFlags | null
  signals: TacticalSignalRow[]; countdown: number | null
  onPause: () => void; pausing: boolean; trackRecord: TrackRecordResponse | null
}) {
  const lc = signals.reduce<Record<string,number>>((a,s)=>{ a[s.lifecycleStage]=(a[s.lifecycleStage]??0)+1; return a }, {})
  const currentRegime = regime?.regime ?? null

  // Grade A% from recent signals (sample indicator)
  const withGrade = signals.filter(s => s.riskGrade != null)
  const gradeAPct = withGrade.length >= 3
    ? Math.round(withGrade.filter(s => s.riskGrade === 'A').length / withGrade.length * 100)
    : null

  return (
    <div className="space-y-4">
      {/* System Status Banner */}
      <SystemStatusBanner celery={celery} flags={flags} providers={providers} />

      {/* Hero row: Scanner + Regime */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <div className={`lg:col-span-3 rounded-xl border p-5 ${
          !celery?.enabled ? 'bg-zinc-900 border-zinc-700' :
          celery.scanning  ? 'bg-blue-500/5 border-blue-500/25' :
          celery.is_overdue ? 'bg-amber-500/5 border-amber-500/25' : 'bg-zinc-900 border-zinc-800'
        }`}>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                celery?.scanning ? 'bg-blue-400 animate-pulse' :
                celery?.enabled && celery?.is_overdue ? 'bg-amber-400 animate-pulse' :
                celery?.enabled ? 'bg-green-400 animate-pulse' : 'bg-zinc-600'
              }`} />
              <span className={`text-sm font-semibold ${celery?.is_overdue && celery?.enabled ? 'text-amber-300' : 'text-white'}`}>
                {celery===null ? 'Connecting…' : celery.scanning ? `Scanning — ${celery.running_modes.join(', ')||'standard'}` :
                 celery.enabled && celery.is_overdue ? 'Auto-scan Overdue' : celery.enabled ? 'Auto-scan Active' : 'Auto-scan Paused'}
              </span>
            </div>
            <button onClick={onPause} disabled={pausing||celery===null}
              className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors disabled:opacity-40 ${
                celery?.enabled ? 'bg-red-500/10 border-red-500/30 text-red-400 hover:bg-red-500/20' : 'bg-green-500/10 border-green-500/30 text-green-400 hover:bg-green-500/20'
              }`}>
              {celery?.enabled ? <><Square className="w-3 h-3"/>Pause</> : <><Play className="w-3 h-3"/>Resume</>}
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-zinc-800/60 rounded-lg px-3 py-2.5">
              <p className="text-[9px] text-zinc-500 uppercase tracking-wider mb-1">Last Scan</p>
              <p className="text-sm font-mono font-semibold text-white">{celery?.last_scan_at ? timeAgo(celery.last_scan_at) : '—'}</p>
            </div>
            <div className="bg-zinc-800/60 rounded-lg px-3 py-2.5">
              <p className="text-[9px] text-zinc-500 uppercase tracking-wider mb-1">Next Scan</p>
              <p className={`text-sm font-mono font-semibold ${celery?.scanning ? 'text-blue-400' : celery?.is_overdue && celery?.enabled ? 'text-amber-400' : 'text-white'}`}>
                {celery?.scanning ? 'Running now' : celery?.enabled && celery?.is_overdue ? 'Overdue' : celery?.enabled && countdown!==null ? fmtCd(countdown) : '—'}
              </p>
            </div>
          </div>
          {signals.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {(lc['ACTIVE']??0) > 0 && <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400"><span className="w-1 h-1 rounded-full bg-blue-400"/>{lc['ACTIVE']} Active</span>}
              {((lc['TELEGRAM_SENT']??0)+(lc['AI_APPROVED']??0)+(lc['SCREENED']??0)) > 0 && <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-purple-500/10 border border-purple-500/20 text-purple-400"><Zap className="w-2.5 h-2.5"/>{(lc['TELEGRAM_SENT']??0)+(lc['AI_APPROVED']??0)+(lc['SCREENED']??0)} Sent</span>}
              {(lc['TP_HIT']??0) > 0 && <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400"><CheckCircle2 className="w-2.5 h-2.5"/>{lc['TP_HIT']} TP</span>}
              {(lc['SL_HIT']??0) > 0 && <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-red-500/10 border border-red-500/20 text-red-400"><XCircle className="w-2.5 h-2.5"/>{lc['SL_HIT']} SL</span>}
            </div>
          )}
        </div>
        {/* Regime card */}
        {regime ? (
          <div className={`lg:col-span-2 rounded-xl border p-5 bg-zinc-900 h-full ${REGIME_BORDER[regime.regime]}`}>
            <div className="flex items-center gap-1.5 mb-3">
              <Activity className="w-3.5 h-3.5 text-zinc-500"/>
              <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-widest">Market Regime</span>
            </div>
            <div className={`text-2xl font-bold mb-1.5 ${REGIME_COLOR[regime.regime]}`}>{REGIME_LABEL[regime.regime]}</div>
            {REGIME_META[regime.regime] && (
              <p className="text-[10px] text-zinc-500 leading-snug mb-3">
                {REGIME_META[regime.regime].implication}
              </p>
            )}
            <div className="grid grid-cols-3 gap-2">
              <div><p className="text-[9px] text-zinc-500 mb-0.5">RSI 4h</p><p className={`text-sm font-bold font-mono ${regime.btcRsi4h>70?'text-red-400':regime.btcRsi4h<30?'text-green-400':'text-white'}`}>{fmt(regime.btcRsi4h,1)}</p></div>
              <div><p className="text-[9px] text-zinc-500 mb-0.5">BTC 24h</p><p className={`text-sm font-bold font-mono ${regime.btc24hChange>=0?'text-green-400':'text-red-400'}`}>{regime.btc24hChange>=0?'+':''}{fmt(regime.btc24hChange,1)}%</p></div>
              <div><p className="text-[9px] text-zinc-500 mb-0.5">4h Trend</p>
                <p className={`text-sm font-bold flex items-center gap-0.5 ${regime.btcTrend4h==='BULLISH'?'text-green-400':regime.btcTrend4h==='BEARISH'?'text-red-400':'text-zinc-400'}`}>
                  {regime.btcTrend4h==='BULLISH' && <TrendingUp className="w-3.5 h-3.5"/>}
                  {regime.btcTrend4h==='BEARISH' && <TrendingDown className="w-3.5 h-3.5"/>}
                  {!['BULLISH','BEARISH'].includes(regime.btcTrend4h) && <Minus className="w-3.5 h-3.5"/>}
                  <span className="text-[11px]">{regime.btcTrend4h}</span>
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="lg:col-span-2 rounded-xl border border-zinc-800 bg-zinc-900 p-5 h-full flex items-center justify-center text-zinc-600 text-sm">Loading regime…</div>
        )}
      </div>

      {/* Signal Quality Scorecard */}
      <SignalQualityScorecard counts={signalCounts} gradeAPct={gradeAPct} />

      {/* Phase A — Founder Command Center */}
      <FounderCommandCenter trackRecord={trackRecord} />

      {/* Phase F — Grade Validation Strip */}
      <GradeValidationStrip />

      {/* Provider Health Row */}
      <ProviderHealthRow providers={providers} />

      {/* Recent signals */}
      {signals.length > 0 && (
        <div>
          <div className="flex items-center gap-3 mb-2">
            <p className="text-xs font-semibold text-zinc-500 uppercase tracking-widest">Recent Signals</p>
            <div className="flex items-center gap-1.5 ml-auto">
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/10 border border-green-500/20 text-green-400">{signals.filter(s=>s.type==='BUY').length} BUY</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/10 border border-red-500/20 text-red-400">{signals.filter(s=>s.type==='SELL').length} SELL</span>
            </div>
          </div>
          <div className="space-y-1.5">
            {signals.slice(0,6).map((sig,i)=>{
              const alignment = computeRegimeAlignment(sig.type, currentRegime ?? sig.marketRegime)
              return (
                <div key={sig.id??i} className="bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-2.5 hover:border-zinc-700 transition-colors">
                  <div className="flex items-center gap-3">
                    <span className="font-semibold text-sm text-white w-16 shrink-0">{sig.symbol}</span>
                    <span className={`text-xs font-semibold w-8 shrink-0 ${sig.type==='BUY'?'text-green-400':'text-red-400'}`}>{sig.type}</span>
                    {sig.riskGrade && <GradeBadge grade={sig.riskGrade} />}
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border shrink-0 ${STAGE_META[sig.lifecycleStage]?.color??'text-zinc-500 border-zinc-700 bg-zinc-800'}`}>{STAGE_META[sig.lifecycleStage]?.label ?? (sig.lifecycleStage??'').replace(/_/g,' ')}</span>
                    <FreshnessTag sig={sig} />
                    <div className="ml-auto flex items-center gap-3">
                      <RegimeAlignDot alignment={alignment} />
                      <ConfBar confidence={sig.confidence} />
                      <span className="text-xs font-mono text-zinc-300 hidden sm:block">{sig.confidence}%</span>
                      <span className="text-xs font-mono text-zinc-500 hidden sm:block">{sig.rrRatio?.toFixed(1) ?? '—'}:1</span>
                      <span className="text-[11px] text-zinc-600 tabular-nums">{sig.createdAt?timeAgo(String(sig.createdAt)):'—'}</span>
                    </div>
                  </div>
                  {(sig.entryPrice > 0 || sig.targetPrice > 0 || sig.stopLoss > 0) && (
                    <div className="flex items-center gap-3 mt-1 flex-wrap">
                      {sig.entryPrice  > 0 && <span className="text-[10px] text-zinc-600">Entry <span className="text-zinc-300 font-mono">${fmtPx(sig.entryPrice)}</span></span>}
                      {sig.targetPrice > 0 && (
                        <span className="text-[10px] text-zinc-600">
                          TP <span className="text-emerald-400 font-mono">${fmtPx(sig.targetPrice)}</span>
                          {sig.entryPrice > 0 && <span className="text-emerald-600 ml-1">{fmtDistPct(sig.entryPrice, sig.targetPrice, sig.type as 'BUY'|'SELL', 'tp')}</span>}
                        </span>
                      )}
                      {sig.stopLoss > 0 && (
                        <span className="text-[10px] text-zinc-600">
                          SL <span className="text-red-400 font-mono">${fmtPx(sig.stopLoss)}</span>
                          {sig.entryPrice > 0 && <span className="text-red-600 ml-1">{fmtDistPct(sig.entryPrice, sig.stopLoss, sig.type as 'BUY'|'SELL', 'sl')}</span>}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Cache strip — moved below fold, compact */}
      {cache && (
        <div className="flex items-center gap-3 text-[10px] text-zinc-600">
          <span>Cache: {(cache.groups ?? []).filter(g=>!g.isStale).length}/{(cache.groups ?? []).length} fresh</span>
          {cache.quota && <span>CMC {Math.round(cache.quota.pctUsed)}% quota</span>}
        </div>
      )}
    </div>
  )
}

// ── Scanner tab ────────────────────────────────────────────────────────────────

function LastChangeAudit({ entries }: { entries: AuditEntry[] | null | undefined }) {
  if (!entries || entries.length === 0) return null
  return (
    <div>
      <p className="text-terminal-muted text-xs uppercase tracking-wider mb-2 font-semibold">Last Changes</p>
      <div className="glass-card rounded-xl divide-y divide-zinc-800">
        {entries.slice(0, 5).map((e, i) => {
          const changedKeys = Object.keys(e.changed_fields)
          const summary = changedKeys.slice(0, 2).map(k => {
            const cf = e.changed_fields[k]
            return `${k.replace(/_/g,' ')}: ${String(cf.old)} → ${String(cf.new)}`
          }).join(' · ')
          return (
            <div key={e.id ?? i} className="flex items-start gap-3 px-4 py-2.5">
              <div className="flex-1 min-w-0">
                <p className="text-xs text-zinc-300 font-mono truncate">{e.group_name} · {summary}</p>
              </div>
              <span className="text-[10px] text-zinc-600 shrink-0 tabular-nums">{timeAgo(e.updated_at)}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * TELEGRAM.RELIABILITY.1 WS5 — delivery funnel ground truth.
 * Shadowed = dedup-suppressed (same coin+direction already alerted within 1h
 * by another scan mode) — visible here so it stops reading as "lost signals".
 */
function TelegramDeliveryCard() {
  const fetcher = useCallback(() => adminApi.analytics.telegramDelivery().catch(() => null), [])
  const { data } = useAutoRefresh<import('@/lib/admin-api').TelegramDeliveryResponse | null>(fetcher, 120_000)
  if (!data) return null

  const rows: Array<[string, import('@/lib/admin-api').TelegramDeliveryWindow]> = [
    ['24h', data.h24], ['7d', data.d7],
  ]
  return (
    <div className="glass-card rounded-xl p-4 sm:p-5">
      <p className="text-terminal-muted text-xs uppercase tracking-wider mb-3 font-semibold flex items-center gap-2">
        <Send className="w-3.5 h-3.5" />Telegram Delivery
      </p>
      <div className="space-y-2">
        {rows.map(([label, w]) => (
          <div key={label} className="flex items-center gap-2 flex-wrap text-[11px]">
            <span className="text-zinc-500 font-mono w-8 shrink-0">{label}</span>
            <span className="px-2 py-0.5 rounded border border-zinc-700 text-zinc-300 font-mono">Gen {w.generated}</span>
            <span className="px-2 py-0.5 rounded border border-zinc-700 text-zinc-400 font-mono" title="Confidence ≥ 85">Elig {w.eligible}</span>
            <span className="px-2 py-0.5 rounded border border-blue-500/30 bg-blue-500/10 text-blue-300 font-mono" title="Enqueued for delivery (telegram_sent)">Queued {w.queued}</span>
            <span className="px-2 py-0.5 rounded border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 font-mono" title="Telegram API confirmed 200">✓ Delivered {w.delivered}</span>
            {w.failed > 0 && (
              <span className="px-2 py-0.5 rounded border border-red-500/40 bg-red-500/10 text-red-300 font-mono" title="Send failed after retries">✗ Failed {w.failed}</span>
            )}
            {w.unresolved > 0 && (
              <span className="px-2 py-0.5 rounded border border-zinc-600 text-zinc-500 font-mono" title="Queued before delivery receipts existed (pre-migration) or still draining">? {w.unresolved}</span>
            )}
            <span className="px-2 py-0.5 rounded border border-amber-500/30 bg-amber-500/10 text-amber-300 font-mono"
              title="Dedup-suppressed: same coin+direction already alerted within 1h by another scan mode — intentional, not lost">
              Shadowed {w.shadowed}
            </span>
            {w.suppressed_other > 0 && (
              <span className="px-2 py-0.5 rounded border border-zinc-600 text-zinc-400 font-mono" title="Rate cap / probability gate / pre-fix tail loss">Other {w.suppressed_other}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function ScannerTab({ celery, flags, aiEnabled, loading, error, scanning, scanDone, scanMode,
  setScanMode, onEnable, onDisable, onScanNow, onPatchFlag, onClearError, countdown, scanStats,
  auditEntries, healthReady }: {
  celery: CeleryStatus | null; flags: OpsFlags | null; aiEnabled: boolean | null
  loading: boolean; error: string | null; scanning: boolean; scanDone: boolean
  scanMode: ScannerMode; setScanMode: (m: ScannerMode) => void
  onEnable: () => void; onDisable: () => void; onScanNow: () => void
  onPatchFlag: (g: string, k: string, v: boolean) => void
  onClearError: () => void; countdown: number | null
  scanStats: ScanSummaryResponse | null
  auditEntries: AuditEntry[] | null
  healthReady: HealthReady | null
}) {
  const emergencyOn = flags?.emergency_stop ?? false
  const rawDurS  = scanStats?.avg_duration_s
  const rawDurMs = scanStats?.avg_duration_ms
  const durationS = rawDurS != null ? rawDurS.toFixed(1) : rawDurMs != null ? (rawDurMs / 1000).toFixed(1) : null
  const workerOk = healthReady?.checks?.celery_worker === 'ok'
  const workerStatus = healthReady == null ? null : workerOk ? 'ALIVE' : 'DOWN'

  return (
    <div className="space-y-5 max-w-5xl">
      {emergencyOn && (
        <div className="p-4 rounded-xl bg-red-900/25 border border-red-500/50 text-red-200 flex items-center gap-3">
          <ShieldAlert className="w-5 h-5 shrink-0 text-red-400"/>
          <div className="flex-1">
            <p className="font-semibold text-sm">Emergency Stop is ACTIVE</p>
            <p className="text-xs text-red-300 mt-0.5">All scans, signal generation, and Telegram output are blocked.</p>
          </div>
          <button onClick={()=>onPatchFlag('features','emergency_stop',false)} disabled={loading}
            className="text-xs px-3 py-1.5 rounded-lg bg-red-500/30 border border-red-500/50 text-red-200 hover:bg-red-500/40 transition-colors disabled:opacity-40 font-semibold">
            Clear Stop
          </button>
        </div>
      )}
      {error && (
        <div className="p-3 rounded-lg bg-red-900/20 border border-red-800 text-red-300 text-sm flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0"/><span className="flex-1">{error}</span>
          <button onClick={onClearError}>✕</button>
        </div>
      )}
      {scanDone && (
        <div className="p-3 rounded-lg bg-emerald-900/20 border border-emerald-700/50 text-emerald-300 text-sm flex items-center gap-3 flex-wrap">
          <CheckCircle className="w-4 h-4 shrink-0"/><span className="flex-1">Scan queued — results appear in Signals within ~60s</span>
        </div>
      )}

      {/* CRITICAL CONTROLS */}
      <div>
        <p className="text-[10px] font-bold text-red-400/70 uppercase tracking-widest mb-2">Critical Controls</p>
        <div className="space-y-2">
          <OpsToggle label="Emergency Stop" description="Immediately halts ALL scans, signal generation, and Telegram output. Overrides every other switch."
            enabled={flags?.emergency_stop??null} loading={loading} icon={<ShieldAlert className="w-4 h-4"/>} inverse
            onEnable={()=>onPatchFlag('features','emergency_stop',true)} onDisable={()=>onPatchFlag('features','emergency_stop',false)}/>
          <OpsToggle label="Maintenance Mode" description="Blocks all scans and Telegram sends. Read-only API calls still work."
            enabled={flags?.maintenance_mode??null} loading={loading} icon={<Wrench className="w-4 h-4"/>} inverse
            onEnable={()=>onPatchFlag('features','maintenance_mode',true)} onDisable={()=>onPatchFlag('features','maintenance_mode',false)}/>
        </div>
      </div>

      {/* Scheduler status */}
      <div className="glass-card rounded-xl p-4 sm:p-5">
        <p className="text-terminal-muted text-xs uppercase tracking-wider mb-3 font-semibold">Scheduler Status</p>
        <div className="flex items-start gap-3">
          <div className={cn('w-3 h-3 rounded-full shrink-0 mt-0.5',
            celery===null ? 'bg-zinc-500 animate-pulse' : emergencyOn ? 'bg-red-400' :
            celery?.enabled && celery?.scanning ? 'bg-blue-400 animate-pulse' :
            celery?.enabled && celery?.is_overdue ? 'bg-amber-400 animate-pulse' :
            celery?.enabled ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-600')}/>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm text-terminal-text">
              {celery===null?'Connecting…':emergencyOn?'Emergency Stop — blocked':
               celery.enabled&&celery.scanning?`Scanning — ${celery.running_modes.join(', ')||'standard'}`:
               celery.enabled&&celery.is_overdue?'Overdue — Beat may be down':celery.enabled?'Active':'Paused'}
            </p>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1">
              <span className="text-terminal-muted text-xs">Last: <span className="text-terminal-text">{timeAgo(celery?.last_scan_at??null)}</span></span>
              {celery?.enabled && !emergencyOn && !celery.scanning && !celery.is_overdue && countdown!==null && (
                <span className="flex items-center gap-1 text-xs text-terminal-muted"><Clock className="w-3 h-3"/>Next: <span className="text-white font-semibold font-mono ml-0.5">{fmtCd(countdown)}</span></span>
              )}
              {durationS && <span className="text-terminal-muted text-xs">Avg duration: <span className="text-terminal-text font-mono">{durationS}s</span></span>}
              {workerStatus && (
                <span className={`flex items-center gap-1 text-xs ${workerStatus==='ALIVE'?'text-emerald-400':'text-red-400'}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${workerStatus==='ALIVE'?'bg-emerald-400':'bg-red-400 animate-pulse'}`}/>
                  Worker {workerStatus}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Telegram delivery funnel (TELEGRAM.RELIABILITY.1) */}
      <TelegramDeliveryCard />

      {/* NORMAL CONTROLS */}
      <div>
        <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2">Operational Controls</p>
        <div className="space-y-2">
          <OpsToggle label="Scanner (Celery Scheduler)" description="Enables/disables the 15-min auto-scan cycle."
            enabled={celery?.enabled??null} loading={loading} icon={<ScanLine className="w-4 h-4"/>}
            onEnable={onEnable} onDisable={onDisable}/>
          <OpsToggle label="Claude AI Validation" description="When OFF, signals use heuristic scoring instead of Claude Haiku."
            enabled={aiEnabled} loading={loading} icon={<Bot className="w-4 h-4"/>}
            onEnable={()=>onPatchFlag('ai','enabled',true)} onDisable={()=>onPatchFlag('ai','enabled',false)}/>
          <OpsToggle label="Telegram Alerts" description="Master switch for all outgoing Telegram messages."
            enabled={flags?.telegram??null} loading={loading} icon={<Send className="w-4 h-4"/>}
            onEnable={()=>onPatchFlag('features','telegram',true)} onDisable={()=>onPatchFlag('features','telegram',false)}/>
        </div>
      </div>

      {/* Manual scan */}
      <div className="glass-card rounded-xl p-4 sm:p-5">
        <p className="text-terminal-muted text-xs uppercase tracking-wider mb-3 font-semibold">Manual Scan</p>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1">
            {MODES.map(m=>(
              <button key={m} onClick={()=>setScanMode(m)}
                className={cn('text-sm px-3 py-2 rounded-lg border transition-colors font-medium', scanMode===m?MODE_COLORS[m]:'border-transparent text-terminal-muted hover:text-terminal-text')}>
                {m.replace('_',' ')}
              </button>
            ))}
          </div>
          <button onClick={onScanNow} disabled={scanning||emergencyOn||flags?.maintenance_mode||celery?.enabled===false}
            className="flex items-center gap-2 text-sm px-4 py-2 rounded-lg bg-blue-500/15 border border-blue-500/30 text-blue-300 hover:bg-blue-500/25 transition-colors disabled:opacity-40 ml-auto">
            {scanning ? <><RefreshCw className="w-4 h-4 animate-spin"/>Queuing…</> : <><ScanLine className="w-4 h-4"/>Scan Now</>}
          </button>
        </div>
        <p className="text-terminal-muted/40 text-xs mt-3 font-mono">Auto: standard 15m · high_conf 30m (:05,:35) · futures 30m (:10,:40)</p>
      </div>

      {/* Gate stats */}
      {scanStats && scanStats.total_scans > 0 && (() => {
        const total    = Math.round((scanStats.avg_coins_scanned??0)*scanStats.total_scans)
        const accepted = Math.round((scanStats.avg_signals_found??0)*scanStats.total_scans)
        const rejected = Math.max(0, total-accepted)
        const rate     = total > 0 ? ((accepted/total)*100).toFixed(1) : '0.0'
        const gates    = scanStats.gate_rejections??{}
        const totalGate = Object.values(gates).reduce((s,n)=>s+n,0)
        const topGates  = Object.entries(gates).filter(([,n])=>n>0).sort(([,a],[,b])=>b-a).slice(0,8)
        return (
          <div>
            <p className="text-terminal-muted text-xs uppercase tracking-wider mb-3 font-semibold">Last 24h — Scan Summary</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              {[{label:'Scanned',value:total,color:'text-terminal-text'},{label:'Signals',value:accepted,color:'text-emerald-400'},{label:'Rejected',value:rejected,color:'text-red-400'},{label:'Accept Rate',value:`${rate}%`,color:'text-blue-400'}].map(c=>(
                <div key={c.label} className="glass-card rounded-xl px-4 py-3">
                  <p className="text-terminal-muted text-[10px] uppercase tracking-widest mb-1">{c.label}</p>
                  <p className={`text-xl font-bold font-mono ${c.color}`}>{c.value}</p>
                </div>
              ))}
            </div>
            {topGates.length > 0 && (
              <div className="glass-card rounded-xl p-4">
                <p className="text-terminal-muted text-xs uppercase tracking-wider mb-3">Gate Rejections ({scanStats.total_scans} scans)</p>
                <div className="space-y-2.5">
                  {topGates.map(([gate,count])=>{
                    const pct = totalGate>0?Math.round(count/totalGate*100):0
                    return (
                      <div key={gate}>
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="text-terminal-text text-sm capitalize">{gate.replace(/_/g,' ').toLowerCase()}</span>
                          <span className="text-terminal-muted text-xs font-mono">{count} · {pct}%</span>
                        </div>
                        <div className="h-1 bg-zinc-800 rounded-full overflow-hidden">
                          <div className="h-full rounded-full bg-blue-400/40" style={{width:`${pct}%`}}/>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )
      })()}

      {/* Last change audit */}
      <LastChangeAudit entries={auditEntries} />
    </div>
  )
}

// ── Signals tab ────────────────────────────────────────────────────────────────

const SIG_PAGE_SIZE = 20

function SignalsTab({ currentRegime }: { currentRegime: MarketRegime | null }) {
  const [typeFilter,  setTypeFilter]  = useState<'all'|'BUY'|'SELL'>('all')
  const [modeFilter,  setModeFilter]  = useState<string>('all')
  const [sortBy,      setSortBy]      = useState<'confidence'|'grade'|'rr'|'time'>('confidence')
  const [expandedId,  setExpandedId]  = useState<string|null>(null)
  const [search,      setSearch]      = useState('')
  const [page,        setPage]        = useState(0)

  useEffect(() => { setPage(0) }, [typeFilter, modeFilter, sortBy, search])

  // REDIS.OPTIMIZATION.2: one shared tactical feed for SignalsTab + TacticalTab
  // + Overview (was 3 separate polls of the same endpoint at 60-120s)
  const fetcher = useCallback(() =>
    fetch('/api/signals/tactical?limit=100&lifecycleStage=all')
      .then(r=>r.json()).then(j=>j.signals??[]).catch(()=>[]), [])
  const { data: signals, loading } = useSharedPolling<TacticalSignalRow[]>('trading:tactical-feed', fetcher, 120_000)

  const filtered = (signals??[]).filter(s=>
    (typeFilter==='all'||s.type===typeFilter) &&
    (modeFilter==='all'||s.scannerMode===modeFilter) &&
    (search===''||s.symbol.toUpperCase().includes(search.toUpperCase()))
  )

  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === 'confidence') return b.confidence - a.confidence
    if (sortBy === 'grade')      return gradeRank(a.riskGrade) - gradeRank(b.riskGrade)
    if (sortBy === 'rr')         return (b.rrRatio??0) - (a.rrRatio??0)
    if (sortBy === 'time')       return new Date(String(b.createdAt)).getTime() - new Date(String(a.createdAt)).getTime()
    return 0
  })
  const paginated = sorted.slice(page * SIG_PAGE_SIZE, (page + 1) * SIG_PAGE_SIZE)

  return (
    <div className="space-y-4 max-w-5xl">
      {/* Controls row */}
      <div className="flex flex-wrap gap-2 items-center">
        {/* Symbol search */}
        <input
          type="text" placeholder="Symbol…" value={search}
          onChange={e => setSearch(e.target.value)}
          className="text-xs px-3 py-1.5 rounded-lg border border-zinc-700 bg-zinc-900 text-zinc-300 placeholder-zinc-600 focus:outline-none focus:border-zinc-500 w-24"
        />
        <div className="w-px bg-zinc-800 h-4"/>
        {/* Sort */}
        <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Sort:</span>
        {(['confidence','grade','rr','time'] as const).map(s=>(
          <button key={s} onClick={()=>setSortBy(s)}
            className={`text-xs px-2.5 py-1 rounded border transition-colors ${sortBy===s?'bg-zinc-700 border-zinc-600 text-white':'border-transparent text-zinc-500 hover:text-zinc-300'}`}>
            {s==='confidence'?'Conf':s==='grade'?'Grade':s==='rr'?'RR':'Time'}
          </button>
        ))}
        <div className="w-px bg-zinc-800 h-4 mx-1"/>
        {/* Type filter */}
        {(['all','BUY','SELL'] as const).map(f=>(
          <button key={f} onClick={()=>setTypeFilter(f)}
            className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${typeFilter===f?'bg-zinc-700 border-zinc-600 text-white':'border-transparent text-zinc-500 hover:text-zinc-300'}`}>
            {f}
          </button>
        ))}
        <div className="w-px bg-zinc-800 h-4 mx-1"/>
        {/* Mode filter */}
        {(['all',...MODES] as const).map(m=>(
          <button key={m} onClick={()=>setModeFilter(m)}
            className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${modeFilter===m?(MODE_COLORS[m]||'bg-zinc-700 border-zinc-600 text-white'):'border-transparent text-zinc-500 hover:text-zinc-300'}`}>
            {m==='all'?'All Modes':m.replace('_',' ')}
          </button>
        ))}
      </div>

      <StageLegend />

      {/* Confidence distribution + BUY/SELL balance */}
      {sorted.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[10px]">
          <div className="flex items-center gap-2 text-zinc-600">
            <span className="uppercase tracking-wider">Confidence:</span>
            {[{label:'90+',min:90,max:101,color:'text-emerald-400'},{label:'85-89',min:85,max:90,color:'text-blue-400'},{label:'80-84',min:80,max:85,color:'text-amber-400'},{label:'<80',min:0,max:80,color:'text-zinc-500'}]
              .map(b=>({...b,n:sorted.filter(s=>s.confidence>=b.min&&s.confidence<b.max).length}))
              .filter(b=>b.n>0)
              .map(b=>(
                <span key={b.label} className={`font-mono ${b.color}`}>{b.label}: {b.n}</span>
              ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/10 border border-green-500/20 text-green-400">
              {sorted.filter(s=>s.type==='BUY').length} BUY
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/10 border border-red-500/20 text-red-400">
              {sorted.filter(s=>s.type==='SELL').length} SELL
            </span>
            <div className="w-px bg-zinc-800 h-3"/>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/10 border border-purple-500/20 text-purple-400" title="Claude AI validated">
              AI: {sorted.filter(s=>s.validationSource==='CLAUDE').length}
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-500/10 border border-sky-500/20 text-sky-400" title="Heuristic-validated — AI toggle disabled or setup score below the AI threshold (78)">
              Screened: {sorted.filter(s=>s.validationSource==='HEURISTIC'||!s.validationSource).length}
            </span>
          </div>
        </div>
      )}

      {loading && <div className="space-y-2">{Array.from({length:5}).map((_,i)=><div key={i} className="skeleton h-14 rounded-xl"/>)}</div>}
      {!loading && sorted.length === 0 && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-8 text-center text-zinc-600 text-sm">No signals match the current filters</div>
      )}

      <div className="space-y-1.5">
        {paginated.map((sig,i)=>{
          const rowId = sig.id ?? String(i)
          const isExpanded = expandedId === rowId
          const alignment = computeRegimeAlignment(sig.type, currentRegime ?? sig.marketRegime)
          const isBuy = sig.type === 'BUY'
          return (
            <div key={rowId} className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden hover:border-zinc-700 transition-colors">
              {/* Main row — clickable to expand */}
              <div className="px-4 pt-3 pb-2 flex items-center gap-3 cursor-pointer select-none"
                onClick={()=>setExpandedId(isExpanded ? null : rowId)}>
                <span className="font-semibold text-sm text-white w-20 shrink-0">{sig.symbol}</span>
                <span className={`text-xs font-semibold w-8 shrink-0 ${isBuy?'text-green-400':'text-red-400'}`}>{sig.type}</span>
                {sig.riskGrade && <GradeBadge grade={sig.riskGrade} />}
                <span className={`text-[10px] px-1.5 py-0.5 rounded border shrink-0 ${STAGE_META[sig.lifecycleStage]?.color??'text-zinc-500 border-zinc-700 bg-zinc-800'}`}>
                  {STAGE_META[sig.lifecycleStage]?.label ?? (sig.lifecycleStage??'').replace(/_/g,' ')}
                </span>
                <FreshnessTag sig={sig} />
                {sig.scannerMode && (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded border shrink-0 hidden sm:inline ${MODE_COLORS[sig.scannerMode]??'text-zinc-400 border-zinc-600'}`}>
                    {sig.scannerMode.replace('_',' ')}
                  </span>
                )}
                <div className="ml-auto flex items-center gap-2.5 shrink-0">
                  <RegimeAlignDot alignment={alignment} />
                  {sig.empiricalWr != null && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border font-mono hidden md:inline ${
                      sig.empiricalWr >= 55 ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/5'
                      : sig.empiricalWr >= 45 ? 'text-blue-400 border-blue-500/30 bg-blue-500/5'
                      : 'text-red-400 border-red-500/30 bg-red-500/5'}`}
                      title={`Outcome-derived probability: this signal's cohort won ${sig.empiricalWr.toFixed(0)}% historically (n=${sig.empiricalN}). Primary over stated confidence.`}>
                      P {sig.empiricalWr.toFixed(0)}%
                    </span>
                  )}
                  <ConfBar confidence={sig.confidence} />
                  <span className="text-xs font-mono text-zinc-300 hidden sm:block w-8 text-right">{sig.confidence}%</span>
                  <span className="text-xs font-mono text-zinc-500 hidden sm:block">{sig.rrRatio?.toFixed(1) ?? '—'}:1</span>
                  <span className="text-[11px] text-zinc-600 tabular-nums">{sig.createdAt?timeAgo(String(sig.createdAt)):'—'}</span>
                  <ChevronDown className={`w-3.5 h-3.5 text-zinc-600 transition-transform shrink-0 ${isExpanded?'rotate-180':''}`} />
                </div>
              </div>
              {/* Price levels — always visible */}
              {(sig.entryPrice > 0 || sig.targetPrice > 0 || sig.stopLoss > 0) && (
                <div className="px-4 pb-2.5 flex items-center gap-3 flex-wrap">
                  {sig.entryPrice  > 0 && <span className="text-[10px] text-zinc-600">Entry <span className="text-zinc-300 font-mono">${fmtPx(sig.entryPrice)}</span></span>}
                  {sig.targetPrice > 0 && (
                    <span className="text-[10px] text-zinc-600">
                      TP <span className="text-emerald-400 font-mono">${fmtPx(sig.targetPrice)}</span>
                      {sig.entryPrice > 0 && <span className="text-emerald-600 ml-1">{fmtDistPct(sig.entryPrice, sig.targetPrice, sig.type as 'BUY'|'SELL', 'tp')}</span>}
                    </span>
                  )}
                  {sig.stopLoss > 0 && (
                    <span className="text-[10px] text-zinc-600">
                      SL <span className="text-red-400 font-mono">${fmtPx(sig.stopLoss)}</span>
                      {sig.entryPrice > 0 && <span className="text-red-600 ml-1">{fmtDistPct(sig.entryPrice, sig.stopLoss, sig.type as 'BUY'|'SELL', 'sl')}</span>}
                    </span>
                  )}
                  {sig.rrRatio != null && sig.rrRatio > 0 && (
                    <span className={`text-[10px] font-mono font-semibold ${sig.rrRatio >= 2.5 ? 'text-emerald-400' : sig.rrRatio >= 2.0 ? 'text-blue-400' : 'text-amber-400'}`}>
                      RR {sig.rrRatio.toFixed(1)}:1
                    </span>
                  )}
                </div>
              )}
              {isExpanded && <IntelligencePanel sig={sig} />}
            </div>
          )
        })}
      </div>

      {/* Pagination */}
      {sorted.length > SIG_PAGE_SIZE && (
        <div className="flex items-center justify-between pt-1">
          <span className="text-xs text-zinc-500">
            {page * SIG_PAGE_SIZE + 1}–{Math.min((page + 1) * SIG_PAGE_SIZE, sorted.length)} of {sorted.length}
          </span>
          <div className="flex gap-2">
            <button disabled={page === 0} onClick={()=>setPage(p=>p-1)}
              className="text-xs px-3 py-1.5 rounded border border-zinc-700 text-zinc-400 disabled:opacity-30 hover:border-zinc-600 hover:text-zinc-300 transition-colors">
              Prev
            </button>
            <button disabled={(page+1)*SIG_PAGE_SIZE>=sorted.length} onClick={()=>setPage(p=>p+1)}
              className="text-xs px-3 py-1.5 rounded border border-zinc-700 text-zinc-400 disabled:opacity-30 hover:border-zinc-600 hover:text-zinc-300 transition-colors">
              Next
            </button>
          </div>
        </div>
      )}

      {/* Phase I — Alpha Watchlist */}
      <AlphaWatchlist />
    </div>
  )
}

// ── Phase I — Alpha Promotion Watchlist ────────────────────────────────────────

interface WatchlistSignal {
  id: string; symbol: string; type: string; scanner_mode: string; timeframe: string
  confidence: number; rr_ratio: number; risk_grade: string | null
  empirical_wr: number | null; empirical_n: number | null; empirical_grade: string | null
  market_regime: string | null; breakout_strength: string | null; created_at: string
}

function AlphaWatchlist() {
  const fetcher = useCallback(
    () => fetch('/api/signals/watchlist?limit=15&hours=48').then(r=>r.json()).then(j=>j.signals??[]).catch(()=>[]),
    []
  )
  const { data, loading } = useAutoRefresh<WatchlistSignal[]>(fetcher, 120_000)
  const signals = data ?? []

  return (
    <div className="mt-2">
      <div className="flex items-center gap-2 mb-2">
        <p className="text-xs font-semibold text-zinc-500 uppercase tracking-widest">Alpha Watchlist</p>
        <span className="text-[10px] text-zinc-600">Validated · not yet alerted · sorted by empirical WR</span>
        {signals.length > 0 && (
          <span className="ml-auto text-[10px] text-zinc-600">{signals.length} signals</span>
        )}
      </div>
      {loading && <div className="text-xs text-zinc-600 py-2">Loading…</div>}
      {!loading && signals.length === 0 && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-4 py-3 text-xs text-zinc-600">
          No near-miss signals in the last 48h.
        </div>
      )}
      {signals.length > 0 && (
        <div className="space-y-1">
          {signals.map(s => (
            <div key={s.id} className="bg-zinc-900/60 border border-zinc-800/70 rounded-lg px-4 py-2 flex items-center gap-3 flex-wrap text-[11px]">
              <span className="font-semibold text-white w-20 shrink-0">{s.symbol}</span>
              <span className={`font-semibold w-8 shrink-0 ${s.type==='BUY'?'text-green-400':'text-red-400'}`}>{s.type}</span>
              {s.risk_grade && (
                <span className={cn('px-1.5 py-0.5 rounded border font-bold text-[10px]', GRADE_STYLE[s.risk_grade] ?? 'text-zinc-500 border-zinc-700 bg-zinc-800')}>{s.risk_grade}</span>
              )}
              <span className="font-mono text-zinc-300">{s.confidence}%</span>
              {s.empirical_wr != null && (
                <span className={`px-1.5 py-0.5 rounded border font-mono text-[10px] ${s.empirical_wr >= 55 ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/5' : s.empirical_wr >= 45 ? 'text-blue-400 border-blue-500/30 bg-blue-500/5' : 'text-amber-400 border-amber-500/30 bg-amber-500/5'}`}
                  title={`Empirical WR (n=${s.empirical_n ?? '?'})`}>
                  P {s.empirical_wr.toFixed(0)}%
                </span>
              )}
              {s.breakout_strength && (
                <span className={`text-[10px] ${breakoutColor(s.breakout_strength)}`}>{shortLabel(s.breakout_strength)}</span>
              )}
              <span className="ml-auto text-[10px] text-zinc-600 tabular-nums">{s.created_at ? timeAgo(s.created_at) : '—'}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Tactical tab ───────────────────────────────────────────────────────────────

function LifecycleFunnel({ signals }: { signals: TacticalSignalRow[] }) {
  if (signals.length === 0) return null
  const counts: Record<string, number> = {}
  for (const s of signals) counts[s.lifecycleStage] = (counts[s.lifecycleStage]??0)+1

  const generated = signals.length
  // Every persisted signal is validated (AI or heuristic), so an "Approved" step
  // is always ~100% — show the AI vs Screened split instead.
  const aiCount   = signals.filter(s => s.validationSource === 'CLAUDE' || s.lifecycleStage === 'AI_APPROVED').length
  const scrCount  = signals.filter(s => s.validationSource === 'HEURISTIC' || s.lifecycleStage === 'SCREENED').length
  // Sent = actually delivered to Telegram. Outcomes register for ALL accepted
  // signals, so inferring "sent" from outcome stages overcounts — use the boolean.
  const sent      = signals.filter(s => s.telegramSent).length
  const active    = (counts['ACTIVE'] ?? 0) + (counts['TELEGRAM_SENT'] ?? 0)
  const won       = counts['TP_HIT'] ?? 0
  const lost      = counts['SL_HIT'] ?? 0
  const expired   = (counts['STALE']??0) + (counts['CLOSED']??0)

  const convColor = (n: number, d: number) => {
    if (d === 0) return 'text-zinc-500'
    const r = n / d
    if (r >= 0.8) return 'text-emerald-400'
    if (r >= 0.6) return 'text-green-400'
    if (r >= 0.4) return 'text-amber-400'
    return 'text-red-400'
  }

  const steps = [
    { label: 'Generated', count: generated },
    { label: 'Sent',      count: sent      },
    { label: 'Active',    count: active    },
  ]
  const resolved = won + lost
  const winRate = resolved > 0 ? Math.round(won / resolved * 100) : null

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-y-1">
        <p className="text-[9px] text-zinc-500 uppercase tracking-widest flex items-center gap-1.5">
          <BarChart2 className="w-3 h-3"/>Pipeline · last {signals.length} signals
        </p>
        <div className="flex items-center gap-2">
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/10 border border-purple-500/20 text-purple-400" title="Claude AI validated">
            AI: {aiCount}
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-500/10 border border-sky-500/20 text-sky-400" title="Heuristic-validated (AI disabled or setup score below AI threshold)">
            Screened: {scrCount}
          </span>
          {winRate !== null && (
            <span className="text-xs font-mono font-bold text-emerald-400">{winRate}% WR <span className="text-zinc-500 font-normal">(n={resolved})</span></span>
          )}
        </div>
      </div>

      {/* Funnel step cards */}
      <div className="flex items-stretch gap-0">
        {steps.map((step, idx) => {
          const prev = idx > 0 ? steps[idx-1].count : 0
          const conv = idx > 0 && prev > 0 ? Math.round(step.count / prev * 100) : null
          return (
            <div key={step.label} className="flex items-center flex-1 min-w-0">
              <div className="flex-1 min-w-0 bg-zinc-800/50 border border-zinc-700/40 rounded-lg px-2 py-2.5 text-center">
                <div className="text-xl font-bold font-mono text-white leading-none">{step.count}</div>
                <div className="text-[9px] text-zinc-500 uppercase tracking-wider mt-1 leading-tight">{step.label}</div>
                {conv !== null && (
                  <div className={`text-[10px] font-semibold mt-0.5 ${convColor(step.count, prev)}`}>{conv}%</div>
                )}
              </div>
              {idx < steps.length - 1 && <ArrowRight className="w-3 h-3 text-zinc-700 shrink-0 mx-1"/>}
            </div>
          )
        })}
      </div>

      {/* Outcomes row */}
      <div className="flex items-center gap-3 pt-2.5 border-t border-zinc-800/60 flex-wrap">
        <span className="text-[9px] text-zinc-600 uppercase tracking-wider font-semibold shrink-0">Outcomes</span>
        <div className="flex items-center gap-4 flex-1 flex-wrap">
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0"/>
            <span className="text-sm font-bold font-mono text-emerald-400">{won}</span>
            <span className="text-[9px] text-zinc-500">Won</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-red-400 shrink-0"/>
            <span className="text-sm font-bold font-mono text-red-400">{lost}</span>
            <span className="text-[9px] text-zinc-500">Lost</span>
          </div>
          {expired > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-zinc-500 shrink-0"/>
              <span className="text-sm font-bold font-mono text-zinc-400">{expired}</span>
              <span className="text-[9px] text-zinc-500">Expired</span>
            </div>
          )}
        </div>
        {winRate !== null && (
          <div className="flex items-center gap-2 shrink-0">
            <div className="w-20 h-1.5 bg-zinc-700 rounded-full overflow-hidden">
              <div className="h-full bg-emerald-400 rounded-full" style={{width:`${winRate}%`}}/>
            </div>
            <span className="text-[10px] text-zinc-400 font-mono tabular-nums">{winRate}%</span>
          </div>
        )}
      </div>
    </div>
  )
}

function TradeStructureBar({ sig }: { sig: TacticalSignalRow }) {
  const { entryPrice, targetPrice, stopLoss, type } = sig
  if (!entryPrice || !targetPrice || !stopLoss) return null

  const isBuy = type === 'BUY'
  const tpDistPct = Math.max(0, isBuy
    ? ((targetPrice - entryPrice) / entryPrice * 100)
    : ((entryPrice - targetPrice) / entryPrice * 100))
  const slDistPct = Math.max(0, isBuy
    ? ((entryPrice - stopLoss) / entryPrice * 100)
    : ((stopLoss - entryPrice) / entryPrice * 100))
  const total = tpDistPct + slDistPct
  if (total <= 0) return null

  // Proportional scaling so the bar visually reflects the true RR ratio
  const slW = (slDistPct / total) * 100
  const tpW = (tpDistPct / total) * 100

  return (
    <div className="mt-1.5 space-y-0.5">
      <div className="flex items-center gap-2 text-[10px] text-zinc-500">
        <span>Entry <span className="text-zinc-300 font-mono">${fmtPx(entryPrice)}</span></span>
        <span className="text-emerald-400">TP +{tpDistPct.toFixed(1)}%</span>
        <span className="text-red-400">SL -{slDistPct.toFixed(1)}%</span>
        {slDistPct > 0 && (
          <span className="text-zinc-600 font-mono">RR {(tpDistPct / slDistPct).toFixed(1)}:1</span>
        )}
      </div>
      <div className="relative h-1.5 bg-zinc-800 rounded-full overflow-hidden w-full">
        {/* SL zone (red, from left) */}
        <div className="absolute left-0 top-0 h-full bg-red-500/50 rounded-l-full"
          style={{ width: `${slW}%` }} />
        {/* Entry marker */}
        <div className="absolute top-0 h-full w-0.5 bg-zinc-400"
          style={{ left: `${slW}%` }} />
        {/* TP zone (green, entry → right edge) */}
        <div className="absolute top-0 h-full bg-emerald-500/50 rounded-r-full"
          style={{ left: `${slW}%`, width: `${tpW}%` }} />
      </div>
    </div>
  )
}

function TacticalTab({ currentRegime }: { currentRegime: MarketRegime | null }) {
  const [preset, setPreset] = useState<'active'|'won'|'lost'|'expired'|'all'>('active')

  const stageMap: Record<string, SignalLifecycleStage[]> = {
    active:  ['ACTIVE','AI_APPROVED','SCREENED','TELEGRAM_SENT'],
    won:     ['TP_HIT'],
    lost:    ['SL_HIT'],
    expired: ['STALE','CLOSED'],
  }

  // REDIS.OPTIMIZATION.2: shares the SignalsTab feed (same key, same fetcher)
  const fetcher = useCallback(()=>
    fetch('/api/signals/tactical?limit=100&lifecycleStage=all')
      .then(r=>r.json()).then(j=>j.signals??[]).catch(()=>[]), [])
  const { data: allSigs, loading } = useSharedPolling<TacticalSignalRow[]>('trading:tactical-feed', fetcher, 120_000)

  const stages = preset==='all' ? null : (stageMap[preset] ?? null)
  const signals = (allSigs??[]).filter(s=>!stages||stages.includes(s.lifecycleStage))

  const presets: { id: string; label: string; cls: string }[] = [
    {id:'active',  label:'Active',     cls:'bg-green-500/10 border-green-500/30 text-green-300'},
    {id:'won',     label:'✓ Won',      cls:'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'},
    {id:'lost',    label:'✗ Lost',     cls:'bg-red-500/10 border-red-500/30 text-red-300'},
    {id:'expired', label:'Expired',    cls:'bg-zinc-500/10 border-zinc-600/30 text-zinc-400'},
    {id:'all',     label:'All',        cls:'border-zinc-600 text-zinc-300'},
  ]

  const getCount = (id: string) => {
    if (!allSigs) return 0
    const map = stageMap[id]
    return map ? allSigs.filter(s => map.includes(s.lifecycleStage)).length : allSigs.length
  }

  return (
    <div className="space-y-4 max-w-5xl">
      {/* Lifecycle Funnel */}
      <LifecycleFunnel signals={allSigs??[]} />

      {/* Preset buttons */}
      <div className="flex gap-2 flex-wrap">
        {presets.map(p=>(
          <button key={p.id} onClick={()=>setPreset(p.id as typeof preset)}
            className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${preset===p.id?p.cls:'border-transparent text-zinc-500 hover:text-zinc-300'}`}>
            {p.label} {allSigs?`(${getCount(p.id)})` :''}
          </button>
        ))}
      </div>

      <StageLegend />

      {loading && <div className="space-y-2">{Array.from({length:4}).map((_,i)=><div key={i} className="skeleton h-20 rounded-xl"/>)}</div>}
      {!loading && signals.length === 0 && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-8 text-center text-zinc-600 text-sm">No signals in this stage</div>
      )}

      <div className="space-y-2">
        {signals.map((sig,i)=>{
          const meta   = STAGE_META[sig.lifecycleStage]
          const isBuy  = sig.type==='BUY'
          const alignment = computeRegimeAlignment(sig.type, currentRegime ?? sig.marketRegime)
          const isActive = sig.lifecycleStage === 'ACTIVE' || sig.lifecycleStage === 'TELEGRAM_SENT'
          const isResolved = sig.lifecycleStage === 'TP_HIT' || sig.lifecycleStage === 'SL_HIT' || sig.lifecycleStage === 'CLOSED'
          return (
            <div key={sig.id??i} className={`bg-zinc-900 border rounded-xl overflow-hidden flex`}>
              <div className={`w-1 shrink-0 ${isBuy?'bg-green-500':'bg-red-500'}`}/>
              <div className="flex-1 px-4 py-3">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="font-bold text-white">{sig.symbol}</span>
                  <span className={`text-xs font-semibold ${isBuy?'text-green-400':'text-red-400'}`}>{sig.type}</span>
                  {sig.riskGrade && <GradeBadge grade={sig.riskGrade} />}
                  {meta && <span className={`text-[10px] px-1.5 py-0.5 rounded border ${meta.color}`}>{meta.label}</span>}
                  {sig.scannerMode && <span className={`text-[10px] px-1.5 py-0.5 rounded border ${MODE_COLORS[sig.scannerMode]??'text-zinc-400 border-zinc-600'}`}>{sig.scannerMode.replace('_',' ')}</span>}
                  <RegimeAlignDot alignment={alignment} />
                  <span className="ml-auto text-xs text-zinc-500">{sig.createdAt?timeAgo(String(sig.createdAt)):'—'}</span>
                </div>
                <div className="flex gap-4 mt-1.5 flex-wrap">
                  <span className="text-[11px] text-zinc-500">Conf: <span className="text-zinc-300 font-mono">{sig.confidence}%</span></span>
                  {sig.empiricalWr != null && (
                    <span className="text-[11px] text-zinc-500" title={`Cohort win rate (n=${sig.empiricalN})${sig.empiricalGrade ? ` · empirical grade ${sig.empiricalGrade}` : ''}`}>
                      Prob: <span className={`font-mono font-semibold ${sig.empiricalWr >= 55 ? 'text-emerald-400' : sig.empiricalWr >= 45 ? 'text-blue-400' : 'text-red-400'}`}>{sig.empiricalWr.toFixed(0)}%</span>
                      {sig.empiricalGrade && <span className="ml-1 text-purple-300 font-mono">{sig.empiricalGrade}</span>}
                    </span>
                  )}
                  <span className={`text-[11px] font-mono font-semibold ${(sig.rrRatio??0) >= 2.5 ? 'text-emerald-400' : (sig.rrRatio??0) >= 2.0 ? 'text-blue-400' : 'text-amber-400'}`}>
                    RR {sig.rrRatio?.toFixed(1) ?? '—'}:1
                  </span>
                  {sig.qualityScore != null && (
                    <span className="text-[11px] text-zinc-500">
                      Q: <span className={`font-mono font-semibold ${sig.qualityScore >= 70 ? 'text-emerald-400' : sig.qualityScore >= 50 ? 'text-blue-400' : 'text-amber-400'}`}>
                        {Math.round(sig.qualityScore)}
                      </span>
                    </span>
                  )}
                  {sig.entryPrice > 0 && <span className="text-[11px] text-zinc-500">Entry: <span className="text-zinc-300 font-mono">${fmtPx(sig.entryPrice)}</span></span>}
                  {sig.targetPrice > 0 && (
                    <span className="text-[11px] text-zinc-500">
                      TP: <span className={`font-mono ${isBuy?'text-green-400':'text-red-400'}`}>${fmtPx(sig.targetPrice)}</span>
                      {sig.entryPrice > 0 && <span className={`ml-1 text-[10px] ${isBuy?'text-green-600':'text-red-600'}`}>{fmtDistPct(sig.entryPrice, sig.targetPrice, sig.type as 'BUY'|'SELL', 'tp')}</span>}
                    </span>
                  )}
                  {sig.stopLoss > 0 && (
                    <span className="text-[11px] text-zinc-500">
                      SL: <span className="text-red-400 font-mono">${fmtPx(sig.stopLoss)}</span>
                      {sig.entryPrice > 0 && <span className="text-red-600 ml-1 text-[10px]">{fmtDistPct(sig.entryPrice, sig.stopLoss, sig.type as 'BUY'|'SELL', 'sl')}</span>}
                    </span>
                  )}
                </div>
                {isActive && <TradeStructureBar sig={sig} />}
                {isResolved && (sig.rrAchieved != null || sig.pnlPct != null) && (
                  <div className="mt-1.5 flex items-center gap-3 text-[11px] flex-wrap">
                    <span className="text-[9px] text-zinc-600 uppercase tracking-wider font-semibold">Result</span>
                    {sig.rrAchieved != null && (
                      <span className={`font-mono font-semibold ${sig.rrAchieved >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {sig.rrAchieved >= 0 ? '+' : ''}{sig.rrAchieved.toFixed(2)}R
                      </span>
                    )}
                    {sig.pnlPct != null && (
                      <span className={`font-mono ${sig.pnlPct >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                        {sig.pnlPct >= 0 ? '+' : ''}{sig.pnlPct.toFixed(2)}%
                      </span>
                    )}
                    {sig.durationHours != null && (
                      <span className="text-zinc-500">
                        in <span className="text-zinc-400 font-mono">{sig.durationHours < 1 ? `${Math.round(sig.durationHours * 60)}m` : `${sig.durationHours.toFixed(1)}h`}</span>
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Regime tab ─────────────────────────────────────────────────────────────────

function RegimePreviewModal({ targetPreset, regimeLabel, onConfirm, onClose }: {
  targetPreset: string; regimeLabel: string; onConfirm: () => void; onClose: () => void
}) {
  const [loading,       setLoading]       = useState(true)
  const [currentPreset, setCurrentPreset] = useState('—')

  useEffect(() => {
    adminApi.settings.group('scanner')
      .then(res => {
        const f = res.fields.find(f => f.key === 'preset')
        setCurrentPreset(f ? String(f.value) : '—')
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const display = PRESET_DISPLAY[targetPreset]
  const isSame  = currentPreset === targetPreset

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-6 w-full max-w-sm shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-white font-semibold">Apply Regime Settings</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 text-lg leading-none">×</button>
        </div>

        {loading ? (
          <p className="text-zinc-500 text-sm py-4 text-center">Loading current settings…</p>
        ) : (
          <>
            <div className="space-y-3 mb-5">
              <div className="flex items-center justify-between text-sm">
                <span className="text-zinc-400">Current preset</span>
                <span className="font-mono text-zinc-200">{currentPreset}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-zinc-400">Recommended for {regimeLabel}</span>
                <span className={`font-mono font-semibold ${isSame ? 'text-zinc-400' : 'text-blue-300'}`}>{targetPreset}</span>
              </div>
            </div>

            {isSame ? (
              <div className="rounded-lg bg-zinc-800 px-4 py-3 text-center text-sm text-zinc-400 mb-5">
                Already on <span className="font-mono text-zinc-300">{targetPreset}</span> preset. No changes needed.
              </div>
            ) : display ? (
              <div className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-4 mb-5">
                <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2">{display.label} Profile</p>
                <ul className="space-y-1">
                  {display.changes.map((c, i) => (
                    <li key={i} className="text-xs text-zinc-300 flex items-center gap-2">
                      <span className="w-1 h-1 rounded-full bg-blue-400 shrink-0"/>
                      {c}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="flex gap-3">
              <button onClick={onClose}
                className="flex-1 text-sm py-2 rounded-lg border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 transition-colors">
                Cancel
              </button>
              {!isSame && (
                <button onClick={()=>{ onConfirm(); onClose() }}
                  className="flex-1 text-sm py-2 rounded-lg bg-blue-500/20 border border-blue-500/40 text-blue-300 hover:bg-blue-500/30 transition-colors font-semibold">
                  Confirm Apply
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/**
 * REGIME.HARD.GATE.V2 — status + telemetry card.
 * Contra-regime signals (BUY in bear, SELL in bull) are hard-rejected unless
 * backed by HIGH_MOMENTUM_BREAKOUT or aligned OI. Avoided-loss estimate uses
 * the audited contra-regime expectancy of −0.405R per trade (PHASE.9, n=200).
 */
function RegimeHardGateCard({ counts24h }: { counts24h: Record<string, number> }) {
  const [enabled,  setEnabled]  = useState<boolean | null>(null)
  const [patching, setPatching] = useState(false)
  const [count7d,  setCount7d]  = useState<number | null>(null)

  useEffect(() => {
    adminApi.settings.group('features')
      .then(res => {
        const f = res.fields.find(f => f.key === 'regime_hard_gate_v2')
        setEnabled(f ? Boolean(f.value) : false)
      })
      .catch(() => setEnabled(null))
    adminApi.analytics.scans(168)
      .then(res => setCount7d(res.gate_rejections?.['CONTRA_REGIME_REJECTION'] ?? 0))
      .catch(() => setCount7d(null))
  }, [])

  async function toggle() {
    if (enabled === null || patching) return
    setPatching(true)
    try {
      await adminApi.settings.patch('features', { regime_hard_gate_v2: !enabled })
      setEnabled(!enabled)
    } catch { /* keep prior state on failure */ }
    finally { setPatching(false) }
  }

  const rej24h = counts24h['CONTRA_REGIME_REJECTION'] ?? 0
  const avoided7d = count7d != null ? count7d * 0.405 : null

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-zinc-500"/>
          <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-widest">Regime Hard Gate V2</p>
          <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold ${
            enabled === null ? 'text-zinc-500 border-zinc-700'
            : enabled ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10'
            : 'text-zinc-400 border-zinc-600 bg-zinc-800'}`}>
            {enabled === null ? '…' : enabled ? 'Enabled' : 'Disabled'}
          </span>
        </div>
        <button onClick={toggle} disabled={enabled === null || patching}
          className={`text-xs px-3 py-1.5 rounded-lg border transition-colors disabled:opacity-40 ${
            enabled ? 'border-zinc-600 text-zinc-300 hover:bg-zinc-800' : 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/25'}`}>
          {patching ? 'Saving…' : enabled ? 'Disable' : 'Enable'}
        </button>
      </div>
      <p className="text-xs text-zinc-500 leading-relaxed mb-3">
        Rejects BUY in BEAR/CAPITULATION and SELL in BULL/EUPHORIA unless backed by a
        high-momentum breakout or aligned OI flow. Contra-regime trades ran 19% WR / −0.405R (n=200, 30d audit).
        When disabled, the legacy unconditional BUY-in-bear gate applies.
      </p>
      <div className="flex gap-6 flex-wrap">
        <div>
          <p className="text-[9px] text-zinc-500 uppercase tracking-wider mb-0.5">24h Rejections</p>
          <p className="text-lg font-bold font-mono text-red-400">{rej24h}</p>
        </div>
        <div>
          <p className="text-[9px] text-zinc-500 uppercase tracking-wider mb-0.5">7d Rejections</p>
          <p className="text-lg font-bold font-mono text-red-400">{count7d ?? '—'}</p>
        </div>
        <div>
          <p className="text-[9px] text-zinc-500 uppercase tracking-wider mb-0.5">Est. Avoided Loss (7d)</p>
          <p className="text-lg font-bold font-mono text-emerald-400">
            {avoided7d != null ? `+${avoided7d.toFixed(1)}R` : '—'}
          </p>
        </div>
      </div>
    </div>
  )
}

function RegimeTab({ regime, scanStats, regimePerfData }: {
  regime: RegimeData | null
  scanStats: ScanSummaryResponse | null
  regimePerfData: Record<string, unknown> | null
}) {
  const [applying,     setApplying]     = useState(false)
  const [applyResult,  setApplyResult]  = useState<string|null>(null)
  const [previewOpen,  setPreviewOpen]  = useState(false)

  const REGIME_PROFILE: Record<string, string> = {
    BULL_TREND: 'aggressive', BEAR_TREND: 'conservative', SIDEWAYS: 'balanced',
    HIGH_VOLATILITY: 'conservative', EUPHORIA: 'conservative', CAPITULATION: 'balanced',
  }

  async function applyRegimeSettings() {
    if (!regime) return
    setApplying(true); setApplyResult(null)
    try {
      const profile = REGIME_PROFILE[regime.regime] ?? 'balanced'
      await adminApi.settings.patch('scanner', { preset: profile })
      setApplyResult(`Applied ${profile} preset for ${REGIME_LABEL[regime.regime]}`)
    } catch {
      setApplyResult('Failed to apply settings')
    } finally { setApplying(false) }
  }

  if (!regime) return <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-8 text-center text-zinc-600">Loading regime…</div>

  const meta = REGIME_META[regime.regime]
  const targetPreset = REGIME_PROFILE[regime.regime] ?? 'balanced'

  // Gate effectiveness from scan stats
  const gateRejections = scanStats?.gate_rejections ?? {}
  const regimeBlocked  = gateRejections['REGIME_REJECTION'] ?? gateRejections['btc_context'] ?? 0
  const nullBlocked    = gateRejections['NULL_REGIME'] ?? 0
  const totalAllowed   = Math.round((scanStats?.avg_signals_found ?? 0) * (scanStats?.total_scans ?? 0))

  // Regime performance from analytics data
  type RegimePerfRow = { regime: string; n?: number; win_rate?: number | null; expectancy?: number | null }
  const perfRows = Array.isArray((regimePerfData as { by_regime?: unknown[] } | null)?.by_regime)
    ? (regimePerfData as { by_regime: RegimePerfRow[] }).by_regime
    : []
  const currentPerfRow = perfRows.find(r => r.regime === regime.regime)

  return (
    <>
      {previewOpen && (
        <RegimePreviewModal
          targetPreset={targetPreset}
          regimeLabel={REGIME_LABEL[regime.regime]}
          onConfirm={applyRegimeSettings}
          onClose={()=>setPreviewOpen(false)}
        />
      )}

      <div className="space-y-4 max-w-3xl">
        {/* Current Regime Card */}
        <div className={`rounded-xl border p-6 bg-zinc-900 ${REGIME_BORDER[regime.regime]}`}>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Target className="w-4 h-4 text-zinc-500"/>
              <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-widest">Current Regime</span>
            </div>
            <span className="text-[10px] text-zinc-600 font-mono">{new Date(regime.computedAt).toLocaleTimeString()}</span>
          </div>
          <div className={`text-3xl font-bold mt-2 mb-3 ${REGIME_COLOR[regime.regime]}`}>{REGIME_LABEL[regime.regime]}</div>
          {meta && (
            <>
              <p className="text-zinc-400 text-sm leading-relaxed mb-2">{meta.desc}</p>
              <p className="text-zinc-500 text-xs leading-relaxed border-l-2 border-zinc-700 pl-3">{meta.implication}</p>
            </>
          )}
          {currentPerfRow && (
            <div className="mt-3 pt-3 border-t border-zinc-800 flex gap-5 flex-wrap">
              <div>
                <p className="text-[9px] text-zinc-500 uppercase tracking-wider mb-0.5">Win Rate (7d)</p>
                <p className={`text-sm font-bold font-mono ${(currentPerfRow.win_rate??0)>=0.48?'text-emerald-400':(currentPerfRow.win_rate??0)>=0.38?'text-amber-400':'text-red-400'}`}>
                  {currentPerfRow.win_rate != null ? `${Math.round(currentPerfRow.win_rate*100)}%` : '—'}
                </p>
              </div>
              <div>
                <p className="text-[9px] text-zinc-500 uppercase tracking-wider mb-0.5">Expectancy</p>
                <p className={`text-sm font-bold font-mono ${(currentPerfRow.expectancy??0)>0?'text-emerald-400':(currentPerfRow.expectancy??0)>-0.1?'text-amber-400':'text-red-400'}`}>
                  {currentPerfRow.expectancy != null ? `${currentPerfRow.expectancy>0?'+':''}${currentPerfRow.expectancy.toFixed(2)}R` : '—'}
                </p>
              </div>
              {currentPerfRow.n != null && (
                <div>
                  <p className="text-[9px] text-zinc-500 uppercase tracking-wider mb-0.5">Sample</p>
                  <p className="text-sm font-bold font-mono text-zinc-300">n={currentPerfRow.n}</p>
                </div>
              )}
            </div>
          )}
          <div className="grid grid-cols-3 gap-4 mt-4 pt-4 border-t border-zinc-800">
            <div><p className="text-[10px] text-zinc-600 uppercase tracking-wider mb-1">RSI 4h</p><p className={`text-xl font-bold font-mono ${regime.btcRsi4h>70?'text-red-400':regime.btcRsi4h<30?'text-green-400':'text-white'}`}>{fmt(regime.btcRsi4h,1)}</p></div>
            <div><p className="text-[10px] text-zinc-600 uppercase tracking-wider mb-1">BTC 24h</p><p className={`text-xl font-bold font-mono ${regime.btc24hChange>=0?'text-green-400':'text-red-400'}`}>{regime.btc24hChange>=0?'+':''}{fmt(regime.btc24hChange,1)}%</p></div>
            <div><p className="text-[10px] text-zinc-600 uppercase tracking-wider mb-1">ATR %</p><p className="text-xl font-bold font-mono text-white">{fmt(regime.btcAtrPct,2)}%</p></div>
          </div>
        </div>

        {/* Regime Gate Effectiveness */}
        {scanStats && scanStats.total_scans > 0 && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
            <p className="text-[9px] text-zinc-500 uppercase tracking-widest mb-3">Regime Gate · Last 24h ({scanStats.total_scans} scans)</p>
            <div className="flex flex-wrap gap-5">
              {regimeBlocked > 0 && (
                <div>
                  <p className="text-[9px] text-zinc-500 uppercase tracking-wider mb-0.5">Blocked (contra-regime)</p>
                  <p className="text-lg font-bold font-mono text-red-400">{regimeBlocked}</p>
                </div>
              )}
              {totalAllowed > 0 && (
                <div>
                  <p className="text-[9px] text-zinc-500 uppercase tracking-wider mb-0.5">Allowed</p>
                  <p className="text-lg font-bold font-mono text-emerald-400">{totalAllowed}</p>
                </div>
              )}
              {nullBlocked > 0 && (
                <div>
                  <p className="text-[9px] text-zinc-500 uppercase tracking-wider mb-0.5">NULL Regime Rejected</p>
                  <p className="text-lg font-bold font-mono text-amber-400">{nullBlocked}</p>
                </div>
              )}
              {regimeBlocked === 0 && nullBlocked === 0 && (
                <p className="text-zinc-600 text-sm">No regime rejections recorded in the last 24h scan window.</p>
              )}
            </div>
          </div>
        )}

        {/* REGIME.HARD.GATE.V2 */}
        <RegimeHardGateCard counts24h={gateRejections} />

        {/* Apply Regime Settings */}
        <div className="glass-card rounded-xl p-4 flex items-start sm:items-center justify-between gap-4 flex-col sm:flex-row">
          <div>
            <p className="text-terminal-text text-sm font-semibold">Apply Regime Settings</p>
            <p className="text-terminal-muted text-xs mt-0.5">
              Sets scanner to <span className="font-mono text-zinc-300">{targetPreset}</span> preset for {REGIME_LABEL[regime.regime]}
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {applyResult && (
              <span className={`text-xs font-mono ${applyResult.startsWith('Applied')?'text-green-400':'text-red-400'}`}>{applyResult}</span>
            )}
            <button onClick={()=>setPreviewOpen(true)} disabled={applying}
              className="flex items-center gap-1.5 text-xs px-4 py-2 rounded-lg bg-blue-500/15 border border-blue-500/30 text-blue-300 hover:bg-blue-500/25 transition-colors disabled:opacity-40">
              {applying ? <><RefreshCw className="w-3 h-3 animate-spin"/>Applying…</> : <>Preview &amp; Apply<ArrowRight className="w-3 h-3"/></>}
            </button>
          </div>
        </div>

        {/* Regime History — distribution from performance data */}
        {perfRows.length > 0 && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
            <p className="text-[9px] text-zinc-500 uppercase tracking-widest mb-3">Regime Distribution · 7d Signal Sample</p>
            <div className="space-y-2">
              {perfRows.map(row => {
                const totalPerfRows = perfRows.reduce((s, r) => s + (r.n ?? 0), 0)
                const rowPct = totalPerfRows > 0 && row.n != null ? Math.round(row.n / totalPerfRows * 100) : 0
                const color = REGIME_COLOR[row.regime] ?? 'text-zinc-400'
                return (
                  <div key={row.regime}>
                    <div className="flex items-center justify-between mb-0.5">
                      <span className={`text-xs ${color}`}>{REGIME_LABEL[row.regime] ?? row.regime}</span>
                      <span className="text-[10px] text-zinc-500 font-mono">
                        {row.n != null ? `n=${row.n}` : ''}{row.win_rate != null ? ` · WR ${Math.round(row.win_rate*100)}%` : ''}
                      </span>
                    </div>
                    <div className="h-1 bg-zinc-800 rounded-full overflow-hidden">
                      <div className="h-full rounded-full bg-zinc-600/60" style={{width:`${rowPct}%`}}/>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────

type Tab = 'overview' | 'scanner' | 'signals' | 'tactical' | 'regime'

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview'  },
  { id: 'scanner',  label: 'Scanner'   },
  { id: 'signals',  label: 'Signals'   },
  { id: 'tactical', label: 'Tactical'  },
  { id: 'regime',   label: 'Regime'    },
]

export default function TradingOperationsPage() {
  const [tab, setTab] = useState<Tab>('overview')

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab') as Tab | null
    if (t && TABS.some(x => x.id === t)) setTab(t)
  }, [])

  // ── Shared data polling (singleton registry) ───────────────────────────────
  const celeryFetcher  = useCallback(()=>adminApi.scheduler.status().then(r=>r.success?r.data:null), [])
  const regimeFetcher  = useCallback(()=>fetch('/api/market/intelligence').then(r=>r.json()).then(j=>j.regime??null), [])
  const countsFetcher  = useCallback(()=>fetch('/api/signals/counts').then(r=>r.json()), [])
  const cacheFetcher   = useCallback(()=>fetch('/api/cache/intelligence').then(r=>r.json()).then(j=>j.telemetry??null), [])
  const provFetcher    = useCallback(()=>fetch('/api/health/providers').then(r=>r.json()).then(j=>j.providers??[]).catch(()=>[]), [])
  // REDIS.OPTIMIZATION.2: same shared feed as SignalsTab/TacticalTab; overview slices 6
  const sigFetcher     = useCallback(()=>fetch('/api/signals/tactical?limit=100&lifecycleStage=all').then(r=>r.json()).then(j=>j.signals??[]).catch(()=>[]), [])
  const flagsFetcher   = useCallback(async ()=>{
    const [featRes,aiRes] = await Promise.all([adminApi.settings.group('features'),adminApi.settings.group('ai')])
    const field = (res: { fields: {key:string;value:unknown}[] }, k: string) => res.fields.find(f=>f.key===k)?.value
    return {
      emergency_stop:   Boolean(field(featRes,'emergency_stop')),
      maintenance_mode: Boolean(field(featRes,'maintenance_mode')),
      telegram:         Boolean(field(featRes,'telegram')),
      ai_validation:    Boolean(field(featRes,'ai_validation')),
      _aiEnabled:       Boolean(field(aiRes,'enabled')),
    }
  }, [])
  const scansFetcher       = useCallback(()=>adminApi.analytics.scans(24).catch(()=>null), [])
  const auditFetcher       = useCallback(()=>adminApi.settings.audit(5).then(r=>r.entries).catch(()=>null), [])
  const healthReadyFetcher = useCallback(()=>adminApi.health.ready().catch(()=>null), [])
  const regimePerfFetcher  = useCallback(()=>adminApi.analytics.regime(168).catch(()=>null), [])
  const trackRecordFetcher = useCallback(()=>adminApi.analytics.trackRecord().catch(()=>null), [])

  const { data: celery,      refresh: refreshCelery  } = useSharedPolling<CeleryStatus|null>('trading:celery',      celeryFetcher,       120_000)
  const { data: regime }                                = useSharedPolling<RegimeData|null>  ('trading:regime',      regimeFetcher,       120_000)
  const { data: signalCounts }                          = useSharedPolling<SignalCounts|null>('trading:counts',      countsFetcher,       120_000)
  const { data: cache }                                 = useSharedPolling<CacheTelemetry|null>('trading:cache',     cacheFetcher,        120_000)
  const { data: providers }                             = useSharedPolling<ProviderStatus[]> ('trading:providers',   provFetcher,         120_000)
  const { data: recentFeed }                            = useSharedPolling<TacticalSignalRow[]>('trading:tactical-feed',sigFetcher,       120_000)
  const recentSignals = recentFeed ? recentFeed.slice(0, 6) : null
  const { data: flagsData,  refresh: refreshFlags }     = useSharedPolling<{emergency_stop:boolean;maintenance_mode:boolean;telegram:boolean;ai_validation:boolean;_aiEnabled:boolean}|null>('trading:flags', flagsFetcher, 120_000)
  const { data: scanStats }                             = useSharedPolling<ScanSummaryResponse|null>('trading:scans',scansFetcher,        120_000)
  const { data: auditEntries }                          = useSharedPolling<AuditEntry[]|null>('trading:audit',       auditFetcher,        120_000)
  const { data: healthReady }                           = useSharedPolling<HealthReady|null> ('trading:health-ready',healthReadyFetcher,  120_000)
  const { data: regimePerfData }                        = useSharedPolling<Record<string,unknown>|null>('trading:regime-perf', regimePerfFetcher, 120_000)
  const { data: trackRecord }                           = useSharedPolling<TrackRecordResponse|null>('trading:track-record',  trackRecordFetcher,  300_000)

  // ── Scanner countdown ──────────────────────────────────────────────────────
  const [countdown, setCountdown] = useState<number|null>(null)
  const [scanMode,  setScanMode]  = useState<ScannerMode>('spot')

  useEffect(()=>{
    const tick=()=>{
      if (!celery) { setCountdown(null); return }
      if (celery.is_overdue) { setCountdown(null); return }
      const modeNext = celery.next_scan_at?.[scanMode]??null
      const diff = modeNext ? Math.floor(modeNext-Date.now()/1000) : -1
      setCountdown(diff>0 ? diff : nextFire(scanMode))
    }
    tick(); const t=setInterval(tick,1000); return ()=>clearInterval(t)
  }, [celery, scanMode])

  // ── Scanner actions ────────────────────────────────────────────────────────
  const [opLoading,  setOpLoading]  = useState(false)
  const [opError,    setOpError]    = useState<string|null>(null)
  const [scanning,   setScanning]   = useState(false)
  const [scanDone,   setScanDone]   = useState(false)
  const [pausing,    setPausing]    = useState(false)
  const scanDoneTimer = useRef<ReturnType<typeof setTimeout>|null>(null)

  const flags: OpsFlags|null = flagsData ? { emergency_stop: flagsData.emergency_stop, maintenance_mode: flagsData.maintenance_mode, telegram: flagsData.telegram, ai_validation: flagsData.ai_validation } : null
  const aiEnabled = flagsData?._aiEnabled ?? null

  async function handleEnable()  { setOpLoading(true); setOpError(null); try { await adminApi.scheduler.start(); refreshCelery() } catch(e) { setOpError(e instanceof Error?e.message:'Failed') } finally { setOpLoading(false) } }
  async function handleDisable() { setOpLoading(true); setOpError(null); try { await adminApi.scheduler.stop();  refreshCelery() } catch(e) { setOpError(e instanceof Error?e.message:'Failed') } finally { setOpLoading(false) } }
  async function handlePatchFlag(group: string, key: string, value: boolean) {
    setOpLoading(true); setOpError(null)
    try { await adminApi.settings.patch(group,{[key]:value}); refreshFlags() }
    catch(e) { setOpError(e instanceof Error?e.message:'Failed') }
    finally { setOpLoading(false) }
  }
  async function handleScanNow() {
    setScanning(true); setScanDone(false); setOpError(null)
    if (scanDoneTimer.current) clearTimeout(scanDoneTimer.current)
    try {
      const res  = await fetch('/api/scanner/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:scanMode})})
      const json = await res.json()
      if (res.status===423) { setOpError('A scan is already running.'); return }
      if (res.status===503) { setOpError(json.detail??'Scanner is disabled or blocked.'); return }
      if (!json.success) { setOpError(json.error??'Scan failed'); return }
      setScanDone(true); scanDoneTimer.current=setTimeout(()=>setScanDone(false),30_000); refreshCelery()
    } catch(e) { setOpError(e instanceof Error?e.message:'Network error') }
    finally { setScanning(false) }
  }
  async function handlePause() {
    if (!celery||pausing) return; setPausing(true)
    try { if (celery.enabled) await adminApi.scheduler.stop(); else await adminApi.scheduler.start(); refreshCelery() }
    finally { setPausing(false) }
  }

  const currentRegime = regime?.regime ?? null

  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-6xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-lg sm:text-xl font-semibold text-white">Trading Operations</h1>
        <p className="text-xs text-zinc-500 mt-0.5">Overview · Scanner · Signals · Tactical · Regime</p>
      </div>

      {/* Tab nav */}
      <div className="flex gap-0 border-b border-zinc-800 -mx-1">
        {TABS.map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)}
            className={`px-4 py-2 text-xs font-mono uppercase tracking-wider border-b-2 transition-colors ${
              tab===t.id ? 'border-white text-white' : 'border-transparent text-zinc-500 hover:text-zinc-300'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab==='overview' && (
        <OverviewTab
          celery={celery??null} regime={regime??null} signalCounts={signalCounts??null}
          providers={providers??[]} cache={cache??null} signals={recentSignals??[]}
          flags={flags} countdown={countdown} onPause={handlePause} pausing={pausing}
          trackRecord={trackRecord??null}
        />
      )}
      {tab==='scanner' && (
        <ScannerTab
          celery={celery??null} flags={flags} aiEnabled={aiEnabled}
          loading={opLoading} error={opError} scanning={scanning} scanDone={scanDone}
          scanMode={scanMode} setScanMode={setScanMode}
          onEnable={handleEnable} onDisable={handleDisable} onScanNow={handleScanNow}
          onPatchFlag={handlePatchFlag} onClearError={()=>setOpError(null)}
          countdown={countdown} scanStats={scanStats??null}
          auditEntries={auditEntries??null}
          healthReady={healthReady??null}
        />
      )}
      {tab==='signals'  && <SignalsTab  currentRegime={currentRegime} />}
      {tab==='tactical' && <TacticalTab currentRegime={currentRegime} />}
      {tab==='regime'   && (
        <RegimeTab
          regime={regime??null}
          scanStats={scanStats??null}
          regimePerfData={regimePerfData??null}
        />
      )}
    </div>
  )
}
