'use client'

import { useState, useCallback, useEffect, useRef, type ReactNode } from 'react'
import {
  Activity, Zap, Target, RefreshCw,
  Play, Square, ArrowRight, CheckCircle2, XCircle,
  TrendingUp, TrendingDown, Minus, Clock,
  ShieldAlert, AlertTriangle,
  ChevronDown, BarChart2,
} from 'lucide-react'
import { adminApi } from '@/lib/admin-api'
import type { AuditEntry, HealthReady, ScanSummaryResponse, TrackRecordResponse } from '@/lib/admin-api'
import { isActiveStage } from '@/lib/signal-lifecycle'
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
  spot:            'text-zinc-400   border-zinc-700     bg-zinc-800/50',
  futures:         'text-blue-400   border-blue-500/30  bg-blue-500/10',
  high_confidence: 'text-amber-400  border-amber-500/30 bg-amber-500/10',
  trending:        'text-emerald-400 border-emerald-500/30 bg-emerald-500/10',
}
const MODES: ScannerMode[] = ['spot', 'futures', 'high_confidence', 'trending']
const MODE_FIRE_MINUTES: Record<string, number[]> = {
  spot: [0,15,30,45], futures: [10,40], high_confidence: [5,35], trending: [20,50],
}
const STAGE_META: Record<string, { label: string; color: string }> = {
  AI_APPROVED:   { label: 'AI Approved', color: 'text-violet-400 bg-violet-500/10 border-violet-500/25'  },
  SCREENED:      { label: 'Screened',    color: 'text-sky-400    bg-sky-500/10    border-sky-500/20'     },
  TELEGRAM_SENT: { label: 'Sent',        color: 'text-blue-400   bg-blue-500/10   border-blue-500/20'    },
  ACTIVE:        { label: 'Active',      color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' },
  STALE:         { label: 'Stale',       color: 'text-zinc-500   bg-zinc-500/10   border-zinc-600/20'    },
  TP_HIT:        { label: 'TP Hit',      color: 'text-emerald-300 bg-emerald-500/15 border-emerald-500/30' },
  SL_HIT:        { label: 'SL Hit',      color: 'text-red-400    bg-red-500/10    border-red-500/20'     },
  CLOSED:        { label: 'Closed',      color: 'text-zinc-500   bg-zinc-500/10   border-zinc-600/20'    },
}
const STAGE_TIPS: Record<string, string> = {
  AI_APPROVED:   'Claude AI reviewed & approved · confidence ≥ 80%',
  SCREENED:      'Heuristic rules approved · fires when AI is disabled or setup score < 78',
  TELEGRAM_SENT: 'Alert delivered via WhatsApp · first 30 min after send',
  ACTIVE:        'Signal is live within its trading window · 1h → 8h · 4h → 24h · 1d → 72h',
  STALE:         'Trading window expired — not a loss, just outside the signal\'s time window',
  TP_HIT:        'Take-profit target reached · winning trade · outcome recorded',
  SL_HIT:        'Stop-loss triggered · losing trade · outcome recorded',
  CLOSED:        'Timed out without hitting TP or SL',
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
function ConfidenceBar({ signals }: { signals: TacticalSignalRow[] }) {
  const t90  = signals.filter(s => (s.confidence ?? 0) >= 90).length
  const t85  = signals.filter(s => (s.confidence ?? 0) >= 85 && (s.confidence ?? 0) < 90).length
  const t80  = signals.filter(s => (s.confidence ?? 0) >= 80 && (s.confidence ?? 0) < 85).length
  const tLow = signals.filter(s => (s.confidence ?? 0) < 80).length
  const total = signals.length
  if (total === 0) return null
  const pct = (n: number) => Math.round((n / total) * 100)
  return (
    <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-zinc-900/50 border border-zinc-800">
      <span className="text-[10px] text-zinc-600 font-medium uppercase tracking-wide shrink-0 mr-1">Confidence <span className="normal-case font-normal">(filtered)</span></span>
      <div className="flex-1 flex h-1.5 rounded-full overflow-hidden gap-px">
        {t90  > 0 && <div className="bg-emerald-500"   style={{ width: `${pct(t90)}%` }} title={`90+: ${t90}`}  />}
        {t85  > 0 && <div className="bg-blue-500"      style={{ width: `${pct(t85)}%` }} title={`85-89: ${t85}`}/>}
        {t80  > 0 && <div className="bg-amber-500"     style={{ width: `${pct(t80)}%` }} title={`80-84: ${t80}`}/>}
        {tLow > 0 && <div className="bg-zinc-600"      style={{ width: `${pct(tLow)}%`}} title={`<80: ${tLow}`} />}
      </div>
      <div className="flex items-center gap-3 shrink-0">
        {t90  > 0 && <span className="text-[10px] text-emerald-400 font-mono">90+ <span className="text-zinc-500">({t90})</span></span>}
        {t85  > 0 && <span className="text-[10px] text-blue-400 font-mono">85-89 <span className="text-zinc-500">({t85})</span></span>}
        {t80  > 0 && <span className="text-[10px] text-amber-400 font-mono">80-84 <span className="text-zinc-500">({t80})</span></span>}
        {tLow > 0 && <span className="text-[10px] text-zinc-500 font-mono">&lt;80 <span className="text-zinc-600">({tLow})</span></span>}
      </div>
    </div>
  )
}
const GRADE_STYLE: Record<string, string> = {
  'A+': 'text-emerald-300 bg-emerald-500/15 border-emerald-500/35',
  A:    'text-green-300   bg-green-500/12   border-green-500/30',
  'B+': 'text-blue-300   bg-blue-500/15    border-blue-500/30',
  B:    'text-amber-300  bg-amber-500/12   border-amber-500/30',
  C:    'text-zinc-300   bg-zinc-500/10    border-zinc-600/20',
  D:    'text-red-300    bg-red-500/15     border-red-500/30',
  F:    'text-red-400    bg-red-500/20     border-red-500/40',
}
const GRADE_RANK: Record<string, number> = { 'A+': 0, A: 1, 'B+': 2, B: 3, C: 4, D: 5, F: 6 }
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
  if (!trackRecord || !trackRecord.windows) return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-4 text-xs text-zinc-500">
      No performance data yet — resolved outcomes appear here once signals close.
    </div>
  )
  const d7  = trackRecord.windows.d7
  const d30 = trackRecord.windows.d30
  const d90 = trackRecord.windows.d90
  if (!d7 && !d30 && !d90) return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-4 text-xs text-zinc-500">
      No resolved signals yet — performance metrics appear once outcomes are recorded.
    </div>
  )
  const windows = [
    { label: '7d',  w: d7  },
    { label: '30d', w: d30 },
    { label: '90d', w: d90 },
  ] as const
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-4">
      <div className="flex items-center gap-2 mb-3">
        <BarChart2 className="w-3.5 h-3.5 text-zinc-500" />
        <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wide">Verified Performance</span>
        <span className="text-[10px] text-zinc-600 font-mono ml-auto">{trackRecord.source}</span>
      </div>
      <div className="grid grid-cols-3 gap-3 mb-4">
        {windows.map(({ label, w }) => {
          const exp = toNum(w.expectancy)
          const pf  = toNum(w.pf)
          const wr  = toNum(w.win_rate)
          return (
          <div key={label} className="bg-zinc-800/50 rounded-lg px-3 py-2.5">
            <p className="text-[10px] text-zinc-500 uppercase tracking-wide mb-2">{label} · {w.resolved} resolved</p>
            <div className="space-y-1.5">
              <div className="flex justify-between items-center">
                <span className="text-[10px] text-zinc-500">Win Rate</span>
                <span className={`text-xs font-mono font-bold ${wrColor(wr)}`}>
                  {wr != null ? `${wr}%` : '—'}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[10px] text-zinc-500">Expectancy</span>
                <span className={`text-xs font-mono font-bold ${expColor(exp)}`}>
                  {exp != null ? `${exp > 0 ? '+' : ''}${exp.toFixed(2)}R` : '—'}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[10px] text-zinc-500">Prof Factor</span>
                <span className={`text-xs font-mono font-bold ${pfColor(pf)}`}>
                  {pf != null ? pf.toFixed(2) : '—'}
                </span>
              </div>
            </div>
          </div>
        )})}
      </div>
      {(trackRecord.by_mode_30d ?? []).length > 0 && (
        <div className="mb-3">
          <p className="text-[10px] text-zinc-500 uppercase tracking-wide mb-2">By Mode · 30d</p>
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
      <p className="text-[10px] text-zinc-500 uppercase tracking-wide mb-2.5">Grade Validation · Historical Win Rates</p>
      <div className="space-y-2">
        {empirical.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] text-emerald-500 shrink-0 w-14">Empirical</span>
            {empirical.map(g => (
              <span key={g.grade ?? 'unknown'} className={cn('text-[10px] px-2 py-0.5 rounded border font-mono', GRADE_STYLE[g.grade?.charAt(0) ?? ''] ?? 'text-zinc-400 border-zinc-700 bg-zinc-800')}
                title={`n=${g.n} · Exp: ${g.exp != null ? (Number(g.exp) > 0 ? '+' : '') + Number(g.exp).toFixed(2) + 'R' : '—'} · PF: ${g.pf != null ? Number(g.pf).toFixed(1) : '—'}`}>
                {g.grade} {g.wr != null ? `${Number(g.wr).toFixed(0)}% WR` : '—'}
              </span>
            ))}
          </div>
        )}
        {heuristic.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] text-zinc-500 shrink-0 w-14">Heuristic</span>
            {heuristic.map(g => (
              <span key={g.grade} className="text-[10px] px-2 py-0.5 rounded border font-mono text-zinc-400 border-zinc-700"
                title={`n=${g.n} · Exp: ${g.exp != null ? (Number(g.exp) > 0 ? '+' : '') + Number(g.exp).toFixed(2) + 'R' : '—'}`}>
                {g.grade} {g.wr != null ? `${Number(g.wr).toFixed(0)}% WR` : '—'}
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
  const adxMatch = sig.setupDescription?.match(/\|\s*ADX:\s*(\d+(?:\.\d+)?)/i)
  const adxValue = adxMatch ? parseFloat(adxMatch[1]) : null

  // Primary intel chips — most actionable for trade decision
  const primaryFields: IntelField[] = [
    ...(sig.breakoutStrength ? [{
      label: 'Breakout',
      value: shortLabel(sig.breakoutStrength) + (sig.breakoutType ? ` · ${sig.breakoutType.replace(/_/g,' ')}` : ''),
      color: breakoutColor(sig.breakoutStrength),
    }] : []),
    ...(sig.oiInterpretation ? [{ label: 'OI', value: shortLabel(sig.oiInterpretation), color: oiColor(sig.oiInterpretation) }] : []),
    ...(sig.marketRegime ? [{ label: 'Regime', value: shortLabel(sig.marketRegime) }] : []),
    ...(adxValue != null ? [{ label: 'ADX', value: adxValue.toFixed(0), color: adxValue >= 40 ? 'text-emerald-400' : adxValue >= 30 ? 'text-blue-400' : adxValue < 18 ? 'text-red-400' : 'text-zinc-300' }] : []),
  ]

  // Secondary intel chips — context/detail, shown in More Details
  const secondaryFields: IntelField[] = [
    ...(sig.trendScore != null ? [{ label: 'TrendScore', value: trendScoreLabel(sig.trendScore), color: trendScoreColor(sig.trendScore) }] : []),
    ...(sig.sectorStatus ? [{ label: 'Sector', value: shortLabel(sig.sectorStatus) }] : []),
    ...(sig.fundingTrend ? [{
      label: 'Funding',
      value: sig.fundingTrend + (sig.fundingTrend === 'RISING' ? ' ↗' : sig.fundingTrend === 'FALLING' ? ' ↘' : ' →'),
      color: sig.fundingTrend === 'RISING' ? 'text-amber-400' : sig.fundingTrend === 'FALLING' ? 'text-emerald-400' : 'text-zinc-400',
    }] : []),
    ...(sig.positioningContext ? [{ label: 'Positioning', value: shortLabel(sig.positioningContext), color: posColor(sig.positioningContext) }] : []),
    ...(sig.mcapTier ? [{ label: 'MCap', value: sig.mcapTier.charAt(0).toUpperCase() + sig.mcapTier.slice(1) }] : []),
    ...(sig.extensionRisk && sig.extensionRisk !== 'LOW' ? [{ label: 'Ext Risk', value: sig.extensionRisk, color: sig.extensionRisk === 'HIGH' ? 'text-red-400' : 'text-amber-400' }] : []),
    ...(sig.pullbackQuality ? [{ label: 'Pullback', value: shortLabel(String(sig.pullbackQuality)) }] : []),
  ]

  const hasAI = !!(sig.aiReasoning)
  const hasSetup = !!(sig.setupDescription)
  const qs = sig.qualityScore
  const rs = sig.riskScore

  const contProb = sig.continuation?.continuationProbability ?? null
  const contCase = sig.continuation?.reasons?.[0] ?? null
  const iq       = sig.entryQualityScore
  const iScore   = sig.institutionalScore
  const ras      = sig.regimeAlignmentScore
  const hasWhySection = contProb != null || iq != null || iScore != null || ras != null

  const hasEmpiricalData = sig.empiricalWr != null

  const rsi         = sig.indicators?.rsi
  const volumeSpike = sig.indicators?.volumeSpike
  const hasTechnical = (rsi != null && rsi > 0) || (volumeSpike != null && volumeSpike > 0)

  const fd         = sig.futuresData
  const hasFutures = !!fd && (sig.scannerMode === 'futures' || sig.scannerMode === 'high_confidence')

  const ind       = sig.indicators
  const ema200Raw = ind?.ema200
  const ema200Pos = ema200Raw && ind.currentPrice
    ? (ind.currentPrice > ema200Raw ? 'ABOVE' : 'BELOW') : null
  const candlePat = ind?.candle_pattern ?? null
  const bbSqueeze = ind?.bb?.squeeze ?? null
  const hasExtTech = !!(ema200Pos || (candlePat && candlePat !== 'NONE') || bbSqueeze)

  const aiExp         = sig.aiExplainability
  const aiSummary     = aiExp?.summary ?? null
  const aiContCase    = aiExp?.continuationCase ?? null
  const aiCautionCase = aiExp?.cautionCase ?? null
  const hasRisksStrengths = ((sig.strengths?.length ?? 0) > 0) || ((sig.risks?.length ?? 0) > 0)

  const slDistPct = sig.entryPrice && sig.stopLoss
    ? fmtDistPct(sig.entryPrice, sig.stopLoss, sig.type as 'BUY' | 'SELL', 'sl')
    : null
  const tpDistPct = sig.entryPrice && sig.targetPrice
    ? fmtDistPct(sig.entryPrice, sig.targetPrice, sig.type as 'BUY' | 'SELL', 'tp')
    : null

  const hasMoreDetails = secondaryFields.length > 0 || hasTechnical || hasFutures || hasExtTech ||
    !!(aiContCase || aiCautionCase || hasAI || contCase)

  const hasIntelSection = primaryFields.length > 0 || secondaryFields.length > 0
  const hasTechSection  = hasTechnical || hasExtTech || hasFutures || hasSetup
  const hasAiSection    = !!(aiContCase || aiCautionCase || hasAI || contCase)
  const hasQualitySection = hasEmpiricalData || qs != null || rs != null || slDistPct != null || tpDistPct != null || hasWhySection || aiSummary || hasRisksStrengths

  if (!hasQualitySection && !hasIntelSection && !hasTechSection && !hasAiSection) {
    return (
      <div className="border-t border-zinc-800 px-4 py-3 text-xs text-zinc-600">
        No intelligence data available for this signal.
      </div>
    )
  }

  return (
    <div className="border-t border-zinc-800 px-4 py-3 space-y-3 divide-y divide-zinc-800/60">

      {/* ── Section 1: Signal Quality (always open) ── */}
      {hasQualitySection && (
        <div className="space-y-2 pt-1 first:pt-0">
          <p className="text-[10px] font-medium text-zinc-500 uppercase tracking-wide">Signal Quality</p>

          {/* Empirical trust row */}
          {hasEmpiricalData && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-1.5 rounded-lg bg-zinc-800/40 border border-zinc-700/50">
              <span className="text-[10px] text-zinc-500">Empirical</span>
              {sig.empiricalWr != null && (
                <span className={`text-xs font-mono font-bold ${sig.empiricalWr >= 55 ? 'text-emerald-400' : sig.empiricalWr >= 45 ? 'text-blue-400' : 'text-amber-400'}`}>
                  {sig.empiricalWr.toFixed(0)}% WR
                </span>
              )}
              {sig.empiricalN != null && <span className="text-[10px] text-zinc-500 font-mono">n={sig.empiricalN}</span>}
              {sig.empiricalGrade && (
                <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded border', GRADE_STYLE[sig.empiricalGrade.charAt(0)] ?? 'text-zinc-500 border-zinc-700 bg-zinc-800')}>
                  Emp {sig.empiricalGrade}
                </span>
              )}
            </div>
          )}

          {/* Quality / Risk / TP-SL dist */}
          {(qs != null || rs != null || slDistPct || tpDistPct) && (
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
              {qs != null && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-zinc-500">Quality</span>
                  <div className="w-14 h-1 bg-zinc-700 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${qs >= 70 ? 'bg-emerald-400' : qs >= 50 ? 'bg-blue-400' : 'bg-amber-400'}`} style={{ width: `${Math.min(100, qs)}%` }} />
                  </div>
                  <span className={`text-xs font-mono font-semibold ${qs >= 70 ? 'text-emerald-400' : qs >= 50 ? 'text-blue-400' : 'text-amber-400'}`}>{Math.round(qs)}/100</span>
                </div>
              )}
              {rs != null && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-zinc-500">Risk</span>
                  <span className={`text-xs font-mono font-semibold ${rs <= 25 ? 'text-emerald-400' : rs <= 45 ? 'text-blue-400' : rs <= 60 ? 'text-amber-400' : 'text-red-400'}`}>{Math.round(rs)}/100</span>
                </div>
              )}
              {tpDistPct && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-zinc-500">TP dist</span>
                  <span className="text-xs font-mono font-semibold text-emerald-400">{tpDistPct}</span>
                </div>
              )}
              {slDistPct && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-zinc-500">SL dist</span>
                  <span className="text-xs font-mono font-semibold text-red-400">{slDistPct}</span>
                </div>
              )}
            </div>
          )}

          {/* Why scores */}
          {hasWhySection && (
            <div className="flex flex-wrap gap-x-5 gap-y-1.5">
              {contProb != null && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-zinc-500">Continuation</span>
                  <span className={`text-xs font-mono font-semibold ${contProb >= 60 ? 'text-emerald-400' : contProb >= 40 ? 'text-amber-400' : 'text-red-400'}`}>{contProb}%</span>
                </div>
              )}
              {iq != null && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-zinc-500">Entry Quality</span>
                  <span className={`text-xs font-mono font-semibold ${iq >= 70 ? 'text-emerald-400' : iq >= 50 ? 'text-blue-400' : 'text-amber-400'}`}>{Math.round(iq)}/100</span>
                </div>
              )}
              {iScore != null && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-zinc-500">Institutional</span>
                  <span className={`text-xs font-mono font-semibold ${iScore >= 70 ? 'text-emerald-400' : iScore >= 50 ? 'text-blue-400' : 'text-amber-400'}`}>{Math.round(iScore)}/100</span>
                </div>
              )}
              {ras != null && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-zinc-500">Regime Adj</span>
                  <span className={`text-xs font-mono font-semibold ${ras >= 5 ? 'text-emerald-400' : ras >= 0 ? 'text-zinc-300' : 'text-amber-400'}`}>{ras > 0 ? '+' : ''}{Math.round(ras)}</span>
                </div>
              )}
            </div>
          )}

          {/* AI summary + strengths / risks */}
          {(aiSummary || hasRisksStrengths) && (
            <div className="space-y-1.5">
              {aiSummary && <p className="text-xs text-zinc-300 font-medium leading-snug">{aiSummary}</p>}
              {hasRisksStrengths && (
                <div className="space-y-1">
                  {(sig.strengths?.length ?? 0) > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {sig.strengths!.slice(0, 2).map((s, i) => (
                        <span key={i} className="text-[10px] text-emerald-400/80 border border-emerald-500/20 bg-emerald-500/5 px-1.5 py-0.5 rounded">✓ {s}</span>
                      ))}
                    </div>
                  )}
                  {(sig.risks?.length ?? 0) > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {sig.risks!.slice(0, 2).map((r, i) => (
                        <span key={i} className="text-[10px] text-red-400/80 border border-red-500/20 bg-red-500/5 px-1.5 py-0.5 rounded">⚠ {r}</span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Section 2: Intelligence (collapsible, default open) ── */}
      {hasIntelSection && (
        <details open className="group pt-2.5">
          <summary className="list-none flex items-center justify-between cursor-pointer select-none mb-1.5">
            <span className="text-[10px] font-medium text-zinc-500 uppercase tracking-wide">Intelligence</span>
            <span className="text-[10px] text-zinc-600 group-open:hidden">▸ show</span>
            <span className="text-[10px] text-zinc-600 hidden group-open:block">▾ hide</span>
          </summary>
          <div className="space-y-1.5">
            {primaryFields.length > 0 && (
              <div className="flex flex-wrap gap-x-5 gap-y-1.5">
                {primaryFields.map((f, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <span className="text-[10px] text-zinc-500">{f.label}</span>
                    <span className={cn('text-xs font-mono font-semibold', f.color ?? 'text-zinc-300')}>{f.value}</span>
                  </div>
                ))}
              </div>
            )}
            {secondaryFields.length > 0 && (
              <div className="flex flex-wrap gap-x-5 gap-y-1.5">
                {secondaryFields.map((f, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <span className="text-[10px] text-zinc-500">{f.label}</span>
                    <span className={cn('text-xs font-mono font-semibold', f.color ?? 'text-zinc-300')}>{f.value}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </details>
      )}

      {/* ── Section 3: Technical (collapsible, default closed) ── */}
      {hasTechSection && (
        <details className="group pt-2.5">
          <summary className="list-none flex items-center justify-between cursor-pointer select-none mb-1.5">
            <span className="text-[10px] font-medium text-zinc-500 uppercase tracking-wide">Technical</span>
            <span className="text-[10px] text-zinc-600 group-open:hidden">▸ show</span>
            <span className="text-[10px] text-zinc-600 hidden group-open:block">▾ hide</span>
          </summary>
          <div className="space-y-2">
            {hasTechnical && (
              <div className="flex flex-wrap gap-x-5 gap-y-1.5">
                {rsi != null && rsi > 0 && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-zinc-500">RSI 1h</span>
                    <span className={`text-xs font-mono font-semibold ${rsi >= 70 ? 'text-red-400' : rsi >= 60 ? 'text-amber-400' : rsi <= 30 ? 'text-green-400' : rsi <= 40 ? 'text-emerald-400' : 'text-zinc-300'}`}>{rsi.toFixed(1)}</span>
                  </div>
                )}
                {volumeSpike != null && volumeSpike > 0 && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-zinc-500">Vol Spike</span>
                    <span className={`text-xs font-mono font-semibold ${volumeSpike >= 2.5 ? 'text-emerald-400' : volumeSpike >= 1.5 ? 'text-blue-400' : volumeSpike < 0.8 ? 'text-red-400' : 'text-zinc-300'}`}>{volumeSpike.toFixed(1)}×</span>
                  </div>
                )}
              </div>
            )}
            {hasExtTech && (
              <div className="flex flex-wrap gap-x-5 gap-y-1.5 items-center">
                {ema200Pos && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-zinc-500">EMA200</span>
                    <span className={`text-xs font-mono font-semibold ${ema200Pos === 'ABOVE' ? 'text-emerald-400' : 'text-red-400'}`}>{ema200Pos} {ema200Pos === 'ABOVE' ? '↑' : '↓'}</span>
                  </div>
                )}
                {candlePat && candlePat !== 'NONE' && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-zinc-500">Pattern</span>
                    <span className="text-xs font-mono font-semibold text-blue-400">{candlePat.replace(/_/g, ' ')}</span>
                  </div>
                )}
                {bbSqueeze && (
                  <span className="text-[10px] font-semibold text-purple-400 border border-purple-500/30 bg-purple-500/10 px-1.5 py-0.5 rounded">⚡ BB SQUEEZE</span>
                )}
              </div>
            )}
            {hasFutures && fd && (
              <div className="flex flex-wrap gap-x-5 gap-y-1.5">
                {fd.fundingRate != null && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-zinc-500">Funding Rate</span>
                    <span className={`text-xs font-mono font-semibold ${Math.abs(fd.fundingRate) > 0.0005 ? 'text-amber-400' : 'text-zinc-300'}`}>
                      {fd.fundingRate >= 0 ? '+' : ''}{(fd.fundingRate * 100).toFixed(4)}%
                    </span>
                  </div>
                )}
                {fd.fundingRateAnnualized != null && Math.abs(fd.fundingRateAnnualized) > 0 && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-zinc-500">Annualized</span>
                    <span className={`text-xs font-mono font-semibold ${Math.abs(fd.fundingRateAnnualized) > 50 ? 'text-red-400' : Math.abs(fd.fundingRateAnnualized) > 20 ? 'text-amber-400' : 'text-zinc-300'}`}>
                      {fd.fundingRateAnnualized >= 0 ? '+' : ''}{fd.fundingRateAnnualized.toFixed(1)}%
                    </span>
                  </div>
                )}
                {fd.fundingBias && fd.fundingBias !== 'NEUTRAL' && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-zinc-500">Fund Bias</span>
                    <span className={`text-xs font-mono font-semibold ${fd.fundingBias === 'SHORT_HEAVY' ? 'text-emerald-400' : 'text-amber-400'}`}>{fd.fundingBias.replace('_', ' ')}</span>
                  </div>
                )}
                {fd.oiTrend && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-zinc-500">OI Trend</span>
                    <span className={`text-xs font-mono font-semibold ${fd.oiTrend === 'RISING' ? 'text-emerald-400' : fd.oiTrend === 'FALLING' ? 'text-red-400' : 'text-zinc-400'}`}>{fd.oiTrend}</span>
                  </div>
                )}
                {fd.oiChange24h != null && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-zinc-500">OI 24h</span>
                    <span className={`text-xs font-mono font-semibold ${fd.oiChange24h > 5 ? 'text-emerald-400' : fd.oiChange24h < -5 ? 'text-red-400' : 'text-zinc-300'}`}>
                      {fd.oiChange24h > 0 ? '+' : ''}{fd.oiChange24h.toFixed(1)}%
                    </span>
                  </div>
                )}
                {fd.longShortRatio != null && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-zinc-500">L/S Ratio</span>
                    <span className="text-xs font-mono font-semibold text-zinc-300">{fd.longShortRatio.toFixed(2)}</span>
                  </div>
                )}
                {fd.momentumScore != null && fd.momentumScore > 0 && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-zinc-500">Momentum</span>
                    <span className={`text-xs font-mono font-semibold ${fd.momentumScore >= 70 ? 'text-emerald-400' : fd.momentumScore >= 50 ? 'text-blue-400' : 'text-amber-400'}`}>{fd.momentumScore}/100</span>
                  </div>
                )}
                {sig.maxSafeLeverage != null && sig.maxSafeLeverage > 0 && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-zinc-500">Max Lev</span>
                    <span className="text-xs font-mono font-semibold text-zinc-300">{sig.maxSafeLeverage}×</span>
                  </div>
                )}
              </div>
            )}
            {hasFutures && fd && (fd.liquidationZones?.length ?? 0) > 0 && (
              <div className="space-y-1">
                <p className="text-[10px] text-zinc-500">Liquidation Zones</p>
                <div className="flex flex-wrap gap-1.5">
                  {fd.liquidationZones!.slice(0, 4).map((z, i) => (
                    <span key={i} className={`text-[10px] font-mono px-2 py-0.5 rounded border ${z.side === 'LONG_LIQ' ? 'text-red-400 border-red-500/20 bg-red-500/5' : 'text-emerald-400 border-emerald-500/20 bg-emerald-500/5'}`}>
                      {z.side === 'LONG_LIQ' ? '↓' : '↑'} ${z.price.toFixed(2)} · {z.distancePct.toFixed(1)}% away
                      {z.strength !== 'WEAK' && <span className="ml-1 opacity-60">({z.strength.toLowerCase()})</span>}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {hasSetup && (
              <p className="text-[10px] text-zinc-500 leading-relaxed border-l-2 border-zinc-800 pl-2.5 font-mono">
                {sig.setupDescription!.replace(/\s*\|\s*ADX:.*$/i, '')}
              </p>
            )}
          </div>
        </details>
      )}

      {/* ── Section 4: AI Analysis (collapsible, default open) ── */}
      {hasAiSection && (
        <details open className="group pt-2.5">
          <summary className="list-none flex items-center justify-between cursor-pointer select-none mb-1.5">
            <span className="text-[10px] font-medium text-zinc-500 uppercase tracking-wide">AI Analysis</span>
            <span className="text-[10px] text-zinc-600 group-open:hidden">▸ show</span>
            <span className="text-[10px] text-zinc-600 hidden group-open:block">▾ hide</span>
          </summary>
          <div className="space-y-1.5">
            {contCase && (
              <p className="text-[10px] text-zinc-500 leading-relaxed border-l-2 border-zinc-800 pl-2.5 italic">{contCase}</p>
            )}
            {(aiContCase || aiCautionCase) && (
              <div className="space-y-1.5">
                {aiContCase && <p className="text-[10px] text-emerald-400/75 leading-relaxed border-l-2 border-emerald-600/30 pl-2.5">↗ {aiContCase}</p>}
                {aiCautionCase && <p className="text-[10px] text-amber-400/75 leading-relaxed border-l-2 border-amber-600/30 pl-2.5">⚠ {aiCautionCase}</p>}
              </div>
            )}
            {hasAI && (
              <p className="text-xs text-zinc-400 leading-relaxed border-l-2 border-zinc-700 pl-2.5 italic">
                &ldquo;{sig.aiReasoning!}&rdquo;
              </p>
            )}
          </div>
        </details>
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
      <div className="text-[10px] text-zinc-500 uppercase tracking-wide mb-1">{label}</div>
      <div className={`text-xl font-bold font-mono ${colors[accent]}`}>{value}</div>
      {sub && <div className="text-[10px] text-zinc-600 mt-0.5">{sub}</div>}
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
        <p className="text-zinc-200 font-semibold text-sm">{label}</p>
        <p className="text-zinc-500 text-xs mt-0.5 leading-relaxed">{description}</p>
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
      <span className="text-[10px] text-zinc-500 uppercase tracking-wide leading-none">{label}</span>
      <div className="flex items-center gap-1.5">
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotColor(level)}`} />
        <span className={`text-base font-bold font-mono leading-none ${kpiColor(level)}`}>{value}</span>
      </div>
      {sub && <span className="text-[10px] text-zinc-600 leading-none">{sub}</span>}
    </div>
  )
}

function SignalQualityScorecard({ counts, gradeAPct }: { counts: SignalCounts | null; gradeAPct: number | null }) {
  if (!counts || counts.resolved_7d === 0) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-3">
        <p className="text-[10px] text-zinc-500 uppercase tracking-wide mb-2">Signal Quality Scorecard</p>
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
      <p className="text-[10px] text-zinc-500 uppercase tracking-wide mb-3">Signal Quality Scorecard · 7d · {counts.resolved_7d} resolved</p>
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
  if (flags?.emergency_stop)   issues.push('🛑 Emergency Stop ACTIVE')
  if (flags?.maintenance_mode) issues.push('🔧 Maintenance Mode ON')
  if (flags !== null && !flags.telegram)     issues.push('📵 WhatsApp OFF — no alerts sending')
  if (flags !== null && !flags.ai_validation) issues.push('🤖 AI Validation OFF')
  if (celery?.is_overdue && celery?.enabled) issues.push('⏰ Scanner overdue')
  if (celery !== null && !celery.enabled)    issues.push('⏸ Scanner paused')
  const unhealthy = providers.filter(p => !p.healthy)
  if (unhealthy.length > 0) issues.push(`⚠ ${unhealthy.length} provider${unhealthy.length > 1 ? 's' : ''} down`)

  const ok = issues.length === 0
  return (
    <div className={cn('rounded-lg px-4 py-2.5 flex items-start gap-3',
      ok ? 'border border-zinc-800' : 'bg-amber-500/5 border border-amber-500/25')}>
      <span className={`w-2 h-2 rounded-full shrink-0 mt-1 ${ok ? 'bg-zinc-600' : 'bg-amber-400 animate-pulse'}`} />
      <span className={`text-sm ${ok ? 'text-zinc-500' : 'text-amber-300'}`}>
        {ok ? 'All Systems Operational — scanner active, WhatsApp enabled' : issues.join('  ·  ')}
      </span>
    </div>
  )
}

// ── Provider Health Row ────────────────────────────────────────────────────────

function ProviderHealthRow({ providers }: { providers: ProviderStatus[] }) {
  if (providers.length === 0) return null
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-3">
      <p className="text-[10px] text-zinc-500 uppercase tracking-wide mb-2.5">Provider Health</p>
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

function OverviewTab({ celery, regime, signalCounts, providers, cache, signals, countdown, flags, trackRecord,
  scanMode, onScanModeChange, onScanNow, scanning, scanDone, scanError,
  onTogglePause, pausing }: {
  celery: CeleryStatus | null; regime: RegimeData | null; signalCounts: SignalCounts | null
  providers: ProviderStatus[]; cache: CacheTelemetry | null; flags: OpsFlags | null
  signals: TacticalSignalRow[]; countdown: number | null; trackRecord: TrackRecordResponse | null
  scanMode: ScannerMode; onScanModeChange: (m: ScannerMode) => void
  onScanNow: () => void; scanning: boolean; scanDone: boolean; scanError: string | null
  onTogglePause: () => void; pausing: boolean
}) {
  const lc = signals.reduce<Record<string,number>>((a,s)=>{ a[s.lifecycleStage]=(a[s.lifecycleStage]??0)+1; return a }, {})
  const currentRegime = regime?.regime ?? null

  // Grade A% from recent signals (sample indicator)
  const withGrade = signals.filter(s => s.riskGrade != null)
  const gradeAPct = withGrade.length >= 3
    ? Math.round(withGrade.filter(s => s.riskGrade === 'A').length / withGrade.length * 100)
    : null

  return (
    <div className="space-y-6">
      {/* System Status Banner */}
      <SystemStatusBanner celery={celery} flags={flags} providers={providers} />

      {/* Hero row: Scanner + Regime */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <div className={`lg:col-span-3 rounded-xl border p-5 ${
          !celery?.enabled ? 'bg-zinc-900 border-zinc-700' :
          celery.scanning  ? 'bg-blue-500/5 border-blue-500/25' :
          celery.is_overdue ? 'bg-amber-500/5 border-amber-500/25' : 'bg-zinc-900 border-zinc-800'
        }`}>
          <div className="flex items-center justify-between gap-2 mb-4">
            <div className="flex items-center gap-2 min-w-0">
              <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                celery?.scanning ? 'bg-blue-400 animate-pulse' :
                celery?.enabled && celery?.is_overdue ? 'bg-amber-400 animate-pulse' :
                celery?.enabled ? 'bg-green-400 animate-pulse' : 'bg-zinc-600'
              }`} />
              <span className={`text-sm font-semibold truncate ${
                celery?.is_overdue && celery?.enabled ? 'text-amber-300' :
                !celery?.enabled ? 'text-zinc-500' : 'text-white'
              }`}>
                {celery===null ? 'Connecting…' : celery.scanning ? `Scanning — ${celery.running_modes.join(', ')||'standard'}` :
                 celery.enabled && celery.is_overdue ? 'Auto-scan Overdue' : celery.enabled ? 'Auto-scan Active' : 'Auto-scan Stopped'}
              </span>
            </div>
            <button onClick={onTogglePause} disabled={pausing || celery===null}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors shrink-0 ${
                pausing ? 'text-zinc-500 border-zinc-700 bg-zinc-800 cursor-not-allowed'
                : celery?.enabled
                ? 'text-red-400 border-red-500/40 bg-red-500/10 hover:bg-red-500/20'
                : 'text-emerald-400 border-emerald-500/40 bg-emerald-500/15 hover:bg-emerald-500/25'
              }`}>
              {pausing
                ? <><span className="w-2 h-2 rounded-full border-2 border-zinc-500 border-t-transparent animate-spin inline-block"/> Working…</>
                : celery?.enabled
                ? <><Square className="w-3 h-3 fill-current"/> Stop Scanner</>
                : <><Play className="w-3 h-3 fill-current"/> Start Scanner</>}
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-zinc-800/60 rounded-lg px-3 py-2.5">
              <p className="text-[10px] text-zinc-500 mb-1">Last Scan</p>
              <p className="text-sm font-mono font-semibold text-white">{celery?.last_scan_at ? timeAgo(celery.last_scan_at) : '—'}</p>
            </div>
            <div className="bg-zinc-800/60 rounded-lg px-3 py-2.5">
              <p className="text-[10px] text-zinc-500 mb-1">Next Scan</p>
              <p className={`text-sm font-mono font-semibold ${celery?.scanning ? 'text-blue-400' : celery?.is_overdue && celery?.enabled ? 'text-amber-400' : 'text-white'}`}>
                {celery?.scanning ? 'Running now' : celery?.enabled && celery?.is_overdue ? 'Overdue' : celery?.enabled && countdown!==null ? fmtCd(countdown) : '—'}
              </p>
            </div>
          </div>

          {/* Manual scan — single row: label + mode chips + trigger */}
          <div className="mt-2 pt-2 border-t border-zinc-800/60 flex items-center gap-2 flex-wrap">
            <span className="text-[10px] text-zinc-500 shrink-0">Manual Scan</span>
            {MODES.map(m => (
              <button key={m} onClick={() => onScanModeChange(m)}
                className={`text-[10px] px-2.5 py-1 rounded-md border font-semibold transition-colors ${
                  scanMode === m
                    ? MODE_COLORS[m] + ' opacity-100'
                    : 'text-zinc-500 border-zinc-700 bg-transparent hover:text-zinc-300 hover:border-zinc-600'
                }`}>
                {modeDisplayLabel(m)}
              </button>
            ))}
            <button onClick={onScanNow} disabled={scanning || celery?.scanning}
              className={`ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                scanDone
                  ? 'bg-blue-500/10 border border-blue-500/30 text-blue-400'
                  : scanning || celery?.scanning
                  ? 'bg-zinc-800 border border-zinc-700 text-zinc-500 cursor-not-allowed'
                  : 'bg-blue-500/10 border border-blue-500/30 text-blue-400 hover:bg-blue-500/20'
              }`}>
              {scanning ? <><span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse"/> Queuing…</>
               : scanDone ? <><CheckCircle2 className="w-3 h-3"/> Queued ✓</>
               : <><Play className="w-3 h-3"/> Scan Now</>}
            </button>
            {scanError && <p className="text-[10px] text-red-400 w-full mt-0.5">{scanError}</p>}
          </div>

          {signals.length > 0 && (
            <div className="mt-2 pt-2 border-t border-zinc-800/60 grid grid-cols-4 gap-1.5">
              {[
                { label: 'Active',  value: signals.filter(s => isActiveStage(s.lifecycleStage)).length, color: 'text-blue-400' },
                { label: 'Sent',    value: signals.filter(s => s.telegramSent || ['TELEGRAM_SENT','ACTIVE','STALE','TP_HIT','SL_HIT','CLOSED'].includes(s.lifecycleStage)).length, color: 'text-purple-400' },
                { label: 'TP Hit',  value: lc['TP_HIT']??0,  color: 'text-emerald-400' },
                { label: 'SL Hit',  value: lc['SL_HIT']??0,  color: 'text-red-400' },
              ].map(({ label, value, color }) => (
                <div key={label} className="bg-zinc-800/50 rounded-lg px-2 py-2 text-center">
                  <div className={`text-base font-bold font-mono leading-none ${color}`}>{value}</div>
                  <div className="text-[10px] text-zinc-500 mt-1 leading-none">{label}</div>
                </div>
              ))}
            </div>
          )}
        </div>
        {/* Regime card */}
        {regime ? (
          <div className={`lg:col-span-2 rounded-xl border p-5 bg-zinc-900 h-full ${REGIME_BORDER[regime.regime]}`}>
            <div className="flex items-center gap-1.5 mb-3">
              <Activity className="w-3.5 h-3.5 text-zinc-500"/>
              <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wide">Market Regime</span>
            </div>
            <div className={`text-2xl font-bold mb-1.5 ${REGIME_COLOR[regime.regime]}`}>{REGIME_LABEL[regime.regime]}</div>
            {REGIME_META[regime.regime] && (
              <p className="text-[10px] text-zinc-500 leading-snug mb-3">
                {REGIME_META[regime.regime].implication}
              </p>
            )}
            <div className="grid grid-cols-3 gap-2">
              <div><p className="text-[10px] text-zinc-500 mb-0.5">RSI 4h</p><p className={`text-sm font-bold font-mono ${regime.btcRsi4h>70?'text-red-400':regime.btcRsi4h<30?'text-green-400':'text-white'}`}>{fmt(regime.btcRsi4h,1)}</p></div>
              <div><p className="text-[10px] text-zinc-500 mb-0.5">BTC 24h</p><p className={`text-sm font-bold font-mono ${regime.btc24hChange>=0?'text-green-400':'text-red-400'}`}>{regime.btc24hChange>=0?'+':''}{fmt(regime.btc24hChange,1)}%</p></div>
              <div><p className="text-[10px] text-zinc-500 mb-0.5">4h Trend</p>
                <p className={`text-sm font-bold flex items-center gap-0.5 ${regime.btcTrend4h==='BULLISH'?'text-green-400':regime.btcTrend4h==='BEARISH'?'text-red-400':'text-zinc-400'}`}>
                  {regime.btcTrend4h==='BULLISH' && <TrendingUp className="w-3.5 h-3.5"/>}
                  {regime.btcTrend4h==='BEARISH' && <TrendingDown className="w-3.5 h-3.5"/>}
                  {!['BULLISH','BEARISH'].includes(regime.btcTrend4h) && <Minus className="w-3.5 h-3.5"/>}
                  <span className="text-xs">{regime.btcTrend4h}</span>
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
            <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wide">Recent Signals</p>
            <div className="flex items-center gap-1.5 ml-auto">
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/10 border border-green-500/20 text-green-400">{signals.filter(s=>s.type==='BUY').length} BUY</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/10 border border-red-500/20 text-red-400">{signals.filter(s=>s.type==='SELL').length} SELL</span>
            </div>
          </div>
          <div className="space-y-1.5">
            {signals.slice(0,6).map((sig,i)=>{
              const alignment = computeRegimeAlignment(sig.type, currentRegime ?? sig.marketRegime)
              const isOverviewBuy = sig.type === 'BUY'
              return (
                <div key={sig.id??i} className={`rounded-xl px-4 py-2.5 transition-colors relative overflow-hidden border ${isOverviewBuy ? 'bg-zinc-900 border-emerald-900/50 hover:border-emerald-800/70' : 'bg-zinc-900 border-red-900/50 hover:border-red-800/70'}`}>
                  <div className={`absolute inset-y-0 left-0 w-[3px] ${isOverviewBuy ? 'bg-emerald-500/70' : 'bg-red-500/70'}`} />
                  <div className="flex items-center gap-3">
                    <span className="font-semibold text-sm text-white w-16 shrink-0">{sig.symbol}</span>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border shrink-0 ${sig.type==='BUY' ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/25' : 'text-red-400 bg-red-500/10 border-red-500/25'}`}>{sig.type}</span>
                    {sig.riskGrade && <GradeBadge grade={sig.riskGrade} />}
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border shrink-0 ${STAGE_META[sig.lifecycleStage]?.color??'text-zinc-500 border-zinc-700 bg-zinc-800'}`}>{STAGE_META[sig.lifecycleStage]?.label ?? (sig.lifecycleStage??'').replace(/_/g,' ')}</span>
                    <FreshnessTag sig={sig} />
                    <div className="ml-auto flex items-center gap-3">
                      <RegimeAlignDot alignment={alignment} />
                      <ConfBar confidence={sig.confidence} />
                      <span className="text-xs font-mono text-zinc-300 hidden sm:block">{sig.confidence}%</span>
                      <span className="text-xs font-mono text-zinc-500 hidden sm:block">{sig.rrRatio?.toFixed(1) ?? '—'}:1</span>
                      <span className="text-xs text-zinc-600 tabular-nums">{sig.createdAt?timeAgo(String(sig.createdAt)):'—'}</span>
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

const SIG_PAGE_SIZE = 20

function SignalsTab({ currentRegime }: { currentRegime: MarketRegime | null }) {
  const [typeFilter,      setTypeFilter]      = useState<'all'|'BUY'|'SELL'>('all')
  const [modeFilter,      setModeFilter]      = useState<string>('all')
  const [gradeFilter,     setGradeFilter]     = useState<string>('all')
  const [timeframeFilter, setTimeframeFilter] = useState<string>('all')
  const [confFilter,      setConfFilter]      = useState<string>('all')
  const [sortBy,          setSortBy]          = useState<'confidence'|'grade'|'rr'|'time'>('time')
  const [expandedId,      setExpandedId]      = useState<string|null>(null)
  const [search,          setSearch]          = useState('')
  const [page,            setPage]            = useState(0)
  const [preset, setPreset] = useState<'active'|'sent'|'won'|'lost'|'expired'|'all'>('active')
  const stageMap: Record<string, SignalLifecycleStage[]> = {
    active:  ['ACTIVE','TELEGRAM_SENT'],
    sent:    ['TELEGRAM_SENT'],
    won:     ['TP_HIT'],
    lost:    ['SL_HIT'],
    expired: ['STALE','CLOSED'],
  }

  useEffect(() => { setPage(0) }, [typeFilter, modeFilter, gradeFilter, timeframeFilter, confFilter, sortBy, search, preset])

  // REDIS.OPTIMIZATION.2: one shared tactical feed for SignalsTab + TacticalTab
  // + Overview (was 3 separate polls of the same endpoint at 60-120s)
  const fetcher = useCallback(() =>
    fetch('/api/signals/tactical?limit=200&lifecycleStage=all')
      .then(r=>r.json()).then(j=>({ signals: j.signals??[], dbTotal: j.dbTotal??null })).catch(()=>({ signals: [], dbTotal: null })), [])
  const { data: feed, loading } = useSharedPolling<{ signals: TacticalSignalRow[]; dbTotal: number|null }>('trading:tactical-feed', fetcher, 120_000)
  const signals = feed?.signals ?? null
  const dbTotal = feed?.dbTotal ?? null

  const presetStages = preset === 'all' ? null : (stageMap[preset] ?? null)
  const filtered = (signals??[]).filter(s=>
    (!presetStages || presetStages.includes(s.lifecycleStage)) &&
    (typeFilter==='all'||s.type===typeFilter) &&
    (modeFilter==='all'||s.scannerMode===modeFilter) &&
    (gradeFilter==='all'||(s.empiricalGrade ?? s.riskGrade ?? '')===gradeFilter) &&
    (timeframeFilter==='all'||s.timeframe===timeframeFilter) &&
    (confFilter==='all'||
      (confFilter==='90+'  && (s.confidence??0)>=90) ||
      (confFilter==='85-89'&& (s.confidence??0)>=85 && (s.confidence??0)<90) ||
      (confFilter==='80-84'&& (s.confidence??0)>=80 && (s.confidence??0)<85)) &&
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

  const presetDefs = [
    {id:'active',  label:'Active'},
    {id:'sent',    label:'Sent'},
    {id:'won',     label:'Won'},
    {id:'lost',    label:'Lost'},
    {id:'expired', label:'Expired'},
    {id:'all',     label:'All'},
  ]
  const getPresetCount = (id: string) => {
    if (!signals) return 0
    const map = stageMap[id]
    return map ? (signals).filter(s => map.includes(s.lifecycleStage)).length : (signals??[]).length
  }

  return (
    <div className="space-y-6">
      {/* Lifecycle funnel */}
      <LifecycleFunnel signals={signals??[]} dbTotal={dbTotal} />

      {/* Preset pills */}
      <div className="flex gap-1.5 flex-wrap">
        {presetDefs.map(p=>(
          <button key={p.id} onClick={()=>setPreset(p.id as typeof preset)}
            className={`text-xs px-3 py-1.5 rounded-full transition-all ${
              preset===p.id
                ? 'bg-zinc-700 border border-zinc-600 text-zinc-100 font-medium'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}>
            {p.label}{signals ? ` (${getPresetCount(p.id)})` : ''}
          </button>
        ))}
      </div>

      {/* Controls row */}
      <div className="flex flex-wrap gap-2 items-center">
        {/* Symbol search */}
        <input
          type="text" placeholder="Symbol… (local)" value={search}
          onChange={e => setSearch(e.target.value)}
          className="text-xs px-3 py-1.5 rounded-lg border border-zinc-700 bg-zinc-900 text-zinc-300 placeholder-zinc-600 focus:outline-none focus:border-zinc-500 w-24"
        />
        <div className="w-px bg-zinc-800 h-4"/>
        {/* Sort */}
        <span className="text-[10px] text-zinc-500">Sort:</span>
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
        <div className="w-px bg-zinc-800 h-4 mx-1"/>
        {/* Timeframe filter */}
        <span className="text-[10px] text-zinc-500">TF:</span>
        {(['all','1h','4h','1d'] as const).map(tf=>(
          <button key={tf} onClick={()=>setTimeframeFilter(tf)}
            className={`text-xs px-2.5 py-1 rounded border transition-colors ${timeframeFilter===tf?'bg-zinc-700 border-zinc-600 text-white':'border-transparent text-zinc-500 hover:text-zinc-300'}`}>
            {tf==='all'?'All':tf}
          </button>
        ))}
        <div className="w-px bg-zinc-800 h-4 mx-1"/>
        {/* Grade filter */}
        <span className="text-[10px] text-zinc-500">Grade:</span>
        {(['all','A+','A','B+','B','C','D'] as const).map(g=>(
          <button key={g} onClick={()=>setGradeFilter(g)}
            className={`text-[10px] px-2 py-1 rounded border transition-colors font-semibold ${gradeFilter===g?(GRADE_STYLE[g]??'bg-zinc-700 border-zinc-600 text-white'):'border-transparent text-zinc-500 hover:text-zinc-300'}`}>
            {g}
          </button>
        ))}
        <div className="w-px bg-zinc-800 h-4 mx-1"/>
        {/* Confidence band filter */}
        <span className="text-[10px] text-zinc-500">Conf:</span>
        {(['all','90+','85-89','80-84'] as const).map(c=>(
          <button key={c} onClick={()=>setConfFilter(c)}
            className={`text-[10px] px-2 py-1 rounded border transition-colors ${confFilter===c?
              (c==='90+'?'bg-emerald-500/20 border-emerald-500/50 text-emerald-300':c==='85-89'?'bg-blue-500/20 border-blue-500/50 text-blue-300':'bg-amber-500/20 border-amber-500/50 text-amber-300')
              :'border-transparent text-zinc-500 hover:text-zinc-300'}`}>
            {c==='all'?'All':c}
          </button>
        ))}
      </div>

      <StageLegend />
      <ConfidenceBar signals={sorted} />

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
            <div key={rowId} className={`rounded-xl overflow-hidden transition-colors relative border ${isBuy ? 'bg-zinc-900 border-emerald-900/50 hover:border-emerald-800/70' : 'bg-zinc-900 border-red-900/50 hover:border-red-800/70'}`}>
              {/* Direction accent bar */}
              <div className={`absolute inset-y-0 left-0 w-[3px] ${isBuy ? 'bg-emerald-500/70' : 'bg-red-500/70'}`} />
              {/* Main row — clickable to expand */}
              <div className="px-4 pt-3 pb-2 flex items-center gap-3 cursor-pointer select-none"
                onClick={()=>setExpandedId(isExpanded ? null : rowId)}>
                <span className="font-semibold text-sm text-white w-20 shrink-0">{sig.symbol}</span>
                <span className={`text-xs font-bold px-2 py-0.5 rounded border shrink-0 ${isBuy ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/25' : 'text-red-400 bg-red-500/10 border-red-500/25'}`}>{sig.type}</span>
                {sig.riskGrade && <GradeBadge grade={sig.riskGrade} />}
                <span className={`text-[10px] px-1.5 py-0.5 rounded border shrink-0 ${STAGE_META[sig.lifecycleStage]?.color??'text-zinc-500 border-zinc-700 bg-zinc-800'}`}>
                  {STAGE_META[sig.lifecycleStage]?.label ?? (sig.lifecycleStage??'').replace(/_/g,' ')}
                </span>
                {sig.scannerMode && (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded border shrink-0 hidden sm:inline ${MODE_COLORS[sig.scannerMode]??'text-zinc-400 border-zinc-600'}`}>
                    {sig.scannerMode.replace('_',' ')}
                  </span>
                )}
                <div className="ml-auto flex items-center gap-2.5 shrink-0">
                  {sig.empiricalWr != null && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border font-mono hidden md:inline ${
                      sig.empiricalWr >= 70 ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10'
                      : sig.empiricalWr >= 55 ? 'text-blue-400 border-blue-500/30 bg-blue-500/10'
                      : sig.empiricalWr >= 40 ? 'text-amber-400 border-amber-500/30 bg-amber-500/10'
                      : 'text-red-400 border-red-500/30 bg-red-500/10'}`}
                      title={`Outcome-derived probability: this signal's cohort won ${sig.empiricalWr.toFixed(0)}% historically (n=${sig.empiricalN}). Primary over stated confidence.`}>
                      P {sig.empiricalWr.toFixed(0)}%
                    </span>
                  )}
                  <span className="text-xs font-mono text-zinc-300 hidden sm:block w-8 text-right">{sig.confidence}%</span>
                  <span className="text-xs font-mono text-zinc-500 hidden sm:block">{sig.rrRatio?.toFixed(1) ?? '—'}:1</span>
                  <span className="text-xs text-zinc-600 tabular-nums">{sig.createdAt?timeAgo(String(sig.createdAt)):'—'}</span>
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
            {page * SIG_PAGE_SIZE + 1}–{Math.min((page + 1) * SIG_PAGE_SIZE, sorted.length)} of {sorted.length} shown
            {dbTotal !== null ? <span className="text-zinc-600"> · {dbTotal} in DB</span> : null}
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

      {/* Coin Watchlist — manual coin tracker */}
      <details className="group" open>
        <summary className="text-xs text-zinc-400 cursor-pointer hover:text-zinc-200 select-none list-none flex items-center gap-1.5 font-medium">
          <span className="group-open:rotate-90 transition-transform inline-block">▶</span> My Watchlist
          <span className="text-zinc-600 font-normal">(manually tracked coins)</span>
        </summary>
        <div className="mt-2">
          <CoinWatchlist signals={signals??[]} />
        </div>
      </details>

      {/* Alpha Watchlist — collapsed by default */}
      <details className="group">
        <summary className="text-xs text-zinc-500 cursor-pointer hover:text-zinc-300 select-none list-none flex items-center gap-1.5">
          <span className="group-open:rotate-90 transition-transform inline-block">▶</span> Alpha Watchlist
          <span className="text-zinc-600 text-[10px] font-normal">(auto — validated signals not sent)</span>
        </summary>
        <div className="mt-2">
          <AlphaWatchlist />
        </div>
      </details>
    </div>
  )
}

// ── Manual Coin Watchlist ───────────────────────────────────────────────────────

function CoinWatchlist({ signals }: { signals: TacticalSignalRow[] }) {
  const STORAGE_KEY = 'signals:watchlist-coins'
  const [coins, setCoins] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') } catch { return [] }
  })
  const [input, setInput] = useState('')

  const persist = (next: string[]) => {
    setCoins(next)
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)) } catch { /* */ }
  }

  const add = () => {
    const sym = input.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
    if (!sym || coins.includes(sym)) { setInput(''); return }
    persist([...coins, sym])
    setInput('')
  }

  const remove = (sym: string) => persist(coins.filter(c => c !== sym))

  // Build a quick lookup: symbol → most recent signal
  const sigBySymbol = new Map<string, TacticalSignalRow>()
  for (const s of signals) {
    const existing = sigBySymbol.get(s.symbol)
    if (!existing || s.createdAt > existing.createdAt) {
      sigBySymbol.set(s.symbol, s)
    }
  }

  const STAGE_DOT: Record<string, string> = {
    ACTIVE: 'bg-blue-400', TELEGRAM_SENT: 'bg-purple-400', AI_APPROVED: 'bg-purple-400',
    SCREENED: 'bg-sky-400', TP_HIT: 'bg-emerald-400', SL_HIT: 'bg-red-400',
    STALE: 'bg-zinc-600', CLOSED: 'bg-zinc-600', ANALYZED: 'bg-zinc-600', VALIDATED: 'bg-zinc-600',
  }

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 space-y-3">
      {/* Add coin input */}
      <div className="flex gap-2">
        <input
          value={input}
          onChange={e => setInput(e.target.value.toUpperCase())}
          onKeyDown={e => e.key === 'Enter' && add()}
          placeholder="Add coin symbol e.g. BTC"
          className="flex-1 bg-zinc-800/80 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
        />
        <button onClick={add}
          className="px-3 py-1.5 rounded-lg bg-blue-500/10 border border-blue-500/30 text-blue-400 text-xs font-semibold hover:bg-blue-500/20 transition-colors">
          + Add
        </button>
      </div>

      {coins.length === 0 ? (
        <p className="text-[10px] text-zinc-600 text-center py-2">No coins yet — type a symbol above and press Enter</p>
      ) : (
        <div className="space-y-1.5">
          {coins.map(sym => {
            const sig = sigBySymbol.get(sym)
            return (
              <div key={sym} className="flex items-center gap-2 rounded-lg bg-zinc-800/50 px-3 py-2">
                <span className="text-xs font-semibold text-white w-16 shrink-0">{sym}</span>
                {sig ? (
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${STAGE_DOT[sig.lifecycleStage] ?? 'bg-zinc-600'}`}/>
                    <span className={`text-[10px] font-semibold shrink-0 ${sig.type === 'BUY' ? 'text-emerald-400' : 'text-red-400'}`}>{sig.type}</span>
                    <span className="text-[10px] text-zinc-500 shrink-0">{sig.scannerMode}</span>
                    <span className="text-[10px] text-zinc-400 shrink-0">{sig.confidence}%</span>
                    {sig.riskGrade && <span className="text-[10px] text-zinc-500 shrink-0">Gr.{sig.riskGrade}</span>}
                    <span className="text-[10px] text-zinc-600 truncate">{timeAgo(typeof sig.createdAt === 'string' ? sig.createdAt : sig.createdAt.toISOString())}</span>
                  </div>
                ) : (
                  <span className="text-[10px] text-zinc-600 flex-1">No recent signal</span>
                )}
                <button onClick={() => remove(sym)}
                  className="ml-auto text-zinc-700 hover:text-zinc-400 text-xs shrink-0 transition-colors">✕</button>
              </div>
            )
          })}
        </div>
      )}
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
        <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wide">Alpha Watchlist</p>
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
            <div key={s.id} className="bg-zinc-900/60 border border-zinc-800/70 rounded-lg px-4 py-2 flex items-center gap-3 flex-wrap text-xs">
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

function LifecycleFunnel({ signals, dbTotal }: { signals: TacticalSignalRow[]; dbTotal?: number | null }) {
  if (signals.length === 0) return null
  const counts: Record<string, number> = {}
  for (const s of signals) counts[s.lifecycleStage] = (counts[s.lifecycleStage]??0)+1

  // P0-NEW-02: use DB total when available so funnel isn't capped at client limit=200
  const generated = dbTotal ?? signals.length
  // Every persisted signal is validated (AI or heuristic), so an "Approved" step
  // is always ~100% — show the AI vs Screened split instead.
  const aiCount  = signals.filter(s => s.validationSource === 'CLAUDE' || s.lifecycleStage === 'AI_APPROVED').length
  const scrCount = signals.length - aiCount  // all non-AI signals, including null validationSource
  // PCT-02: use telegram_sent bool only (stage inference double-counts)
  const sent   = signals.filter(s => s.telegramSent).length
  // P0-NEW-03: TELEGRAM_SENT must not be in active — it's already counted in sent; Active > Sent paradox otherwise
  const active = signals.filter(s => s.lifecycleStage === 'ACTIVE').length
  // PCT-05: null validationSource falls through to Screened (D-03 intentional default —
  // pre-migration rows default to SCREENED to avoid false AI_APPROVED badges)
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
    { label: 'Generated', count: generated, tip: '' },
    { label: 'Sent',      count: sent,      tip: 'Delivered via WhatsApp' },
    { label: 'Active',    count: active,    tip: 'Live within trading window · Signals that expire (STALE) are not losses — just outside the time window' },
  ]
  const resolved = won + lost
  const winRate = resolved > 0 ? Math.round(won / resolved * 100) : null

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-y-1">
        <p className="text-[10px] text-zinc-500 uppercase tracking-wide flex items-center gap-1.5">
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
              <div className="flex-1 min-w-0 bg-zinc-800/50 border border-zinc-700/40 rounded-lg px-2 py-2.5 text-center" title={step.tip || undefined}>
                <div className="text-xl font-bold font-mono text-white leading-none">{step.count}</div>
                <div className="text-[10px] text-zinc-500 mt-1 leading-tight">{step.label}</div>
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
        <span className="text-[10px] text-zinc-600 font-semibold shrink-0">Outcomes</span>
        <div className="flex items-center gap-4 flex-1 flex-wrap">
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0"/>
            <span className="text-sm font-bold font-mono text-emerald-400">{won}</span>
            <span className="text-[10px] text-zinc-500">Won</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-red-400 shrink-0"/>
            <span className="text-sm font-bold font-mono text-red-400">{lost}</span>
            <span className="text-[10px] text-zinc-500">Lost</span>
          </div>
          {expired > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-zinc-500 shrink-0"/>
              <span className="text-sm font-bold font-mono text-zinc-400">{expired}</span>
              <span className="text-[10px] text-zinc-500">Expired</span>
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
          <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wide">Regime Hard Gate V2</p>
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
          <p className="text-[10px] text-zinc-500 mb-0.5">24h Rejections</p>
          <p className="text-lg font-bold font-mono text-red-400">{rej24h}</p>
        </div>
        <div>
          <p className="text-[10px] text-zinc-500 mb-0.5">7d Rejections</p>
          <p className="text-lg font-bold font-mono text-red-400">{count7d ?? '—'}</p>
        </div>
        <div>
          <p className="text-[10px] text-zinc-500 mb-0.5">Est. Avoided Loss (7d)</p>
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

      <div className="space-y-6">
        {/* Current Regime Card */}
        <div className={`rounded-xl border p-6 bg-zinc-900 ${REGIME_BORDER[regime.regime]}`}>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Target className="w-4 h-4 text-zinc-500"/>
              <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wide">Current Regime</span>
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
                <p className="text-[10px] text-zinc-500 mb-0.5">Win Rate (7d)</p>
                <p className={`text-sm font-bold font-mono ${(currentPerfRow.win_rate??0)>=0.48?'text-emerald-400':(currentPerfRow.win_rate??0)>=0.38?'text-amber-400':'text-red-400'}`}>
                  {currentPerfRow.win_rate != null ? `${Math.round(currentPerfRow.win_rate*100)}%` : '—'}
                </p>
              </div>
              <div>
                <p className="text-[10px] text-zinc-500 mb-0.5">Expectancy</p>
                <p className={`text-sm font-bold font-mono ${(currentPerfRow.expectancy??0)>0?'text-emerald-400':(currentPerfRow.expectancy??0)>-0.1?'text-amber-400':'text-red-400'}`}>
                  {currentPerfRow.expectancy != null ? `${Number(currentPerfRow.expectancy)>0?'+':''}${Number(currentPerfRow.expectancy).toFixed(2)}R` : '—'}
                </p>
              </div>
              {currentPerfRow.n != null && (
                <div>
                  <p className="text-[10px] text-zinc-500 mb-0.5">Sample</p>
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
            <p className="text-[10px] text-zinc-500 uppercase tracking-wide mb-3">Regime Gate · Last 24h ({scanStats.total_scans} scans)</p>
            <div className="flex flex-wrap gap-5">
              {regimeBlocked > 0 && (
                <div>
                  <p className="text-[10px] text-zinc-500 mb-0.5">Blocked (contra-regime)</p>
                  <p className="text-lg font-bold font-mono text-red-400">{regimeBlocked}</p>
                </div>
              )}
              {totalAllowed > 0 && (
                <div>
                  <p className="text-[10px] text-zinc-500 mb-0.5">Allowed</p>
                  <p className="text-lg font-bold font-mono text-emerald-400">{totalAllowed}</p>
                </div>
              )}
              {nullBlocked > 0 && (
                <div>
                  <p className="text-[10px] text-zinc-500 mb-0.5">NULL Regime Rejected</p>
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
            <p className="text-zinc-200 text-sm font-semibold">Apply Regime Settings</p>
            <p className="text-zinc-500 text-xs mt-0.5">
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
            <p className="text-[10px] text-zinc-500 uppercase tracking-wide mb-3">Regime Distribution · 7d Signal Sample</p>
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

type Tab = 'overview' | 'signals' | 'regime'

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'signals',  label: 'Signals'  },
  { id: 'regime',   label: 'Regime'   },
]

export default function SignalsCenterPage() {
  const [tab, setTab] = useState<Tab>('overview')

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab') as Tab | null
    if (t && TABS.some(x => x.id === t)) setTab(t)
  }, [])

  // ── Shared data polling (singleton registry) ───────────────────────────────
  const celeryFetcher  = useCallback(()=>adminApi.scheduler.status().then(r=>r.success?r.data:null), [])
  const regimeFetcher  = useCallback(()=>fetch('/api/market/intelligence').then(r=>r.ok?r.json():null).then(j=>j?.regime??null), [])
  const countsFetcher  = useCallback(()=>fetch('/api/signals/counts').then(r=>r.ok?r.json():null), [])
  const cacheFetcher   = useCallback(()=>fetch('/api/cache/intelligence').then(r=>r.ok?r.json():null).then(j=>j?.telemetry??null), [])
  const provFetcher    = useCallback(()=>fetch('/api/health/providers').then(r=>r.json()).then(j=>j.providers??[]).catch(()=>[]), [])
  // REDIS.OPTIMIZATION.2: same shared feed as SignalsTab; full 200 passed to OverviewTab
  const sigFetcher     = useCallback(()=>fetch('/api/signals/tactical?limit=200&lifecycleStage=all').then(r=>r.json()).then(j=>({ signals: j.signals??[], dbTotal: j.dbTotal??null })).catch(()=>({ signals: [], dbTotal: null })), [])
  const flagsFetcher   = useCallback(async ()=>{
    const [featRes,aiRes,teleRes] = await Promise.all([adminApi.settings.group('features'),adminApi.settings.group('ai'),adminApi.settings.group('telegram')])
    const field = (res: { fields: {key:string;value:unknown}[] }, k: string) => res.fields.find(f=>f.key===k)?.value
    return {
      emergency_stop:   Boolean(field(featRes,'emergency_stop')),
      maintenance_mode: Boolean(field(featRes,'maintenance_mode')),
      telegram:         Boolean(field(teleRes,'alerts_enabled')),  // P0-NEW-01: was reading features.telegram (non-existent)
      ai_validation:    Boolean(field(aiRes,'enabled')),
      _aiEnabled:       Boolean(field(aiRes,'enabled')),
    }
  }, [])
  const scansFetcher       = useCallback(()=>adminApi.analytics.scans(24).catch(()=>null), [])
  const auditFetcher       = useCallback(()=>adminApi.settings.audit(5).then(r=>r.entries).catch(()=>null), [])
  const healthReadyFetcher = useCallback(()=>adminApi.health.ready().catch(()=>null), [])
  const regimePerfFetcher  = useCallback(()=>adminApi.analytics.regime(168).catch(()=>null), [])
  const trackRecordFetcher = useCallback(()=>adminApi.analytics.trackRecord().catch(()=>null), [])

  // REDIS.REDUCE.3: operational/real-time hooks stay 120s; analytics/cosmetic hooks raised to 300–600s
  const { data: celery,      refresh: refreshCelery  } = useSharedPolling<CeleryStatus|null>('trading:celery',      celeryFetcher,       120_000)
  const { data: regime }                                = useSharedPolling<RegimeData|null>  ('trading:regime',      regimeFetcher,       120_000)
  const { data: signalCounts,  refresh: refreshCounts  } = useSharedPolling<SignalCounts|null>('trading:counts',      countsFetcher,       120_000)
  const { data: cache }                                 = useSharedPolling<CacheTelemetry|null>('trading:cache',     cacheFetcher,        600_000) // cosmetic
  const { data: providers }                             = useSharedPolling<ProviderStatus[]> ('trading:providers',   provFetcher,         300_000) // provider health changes slowly
  const { data: recentFeed,   refresh: refreshFeed    } = useSharedPolling<{ signals: TacticalSignalRow[]; dbTotal: number|null }>('trading:tactical-feed',sigFetcher,       120_000)
  const recentSignals = recentFeed?.signals.slice(0, 6) ?? null
  const { data: flagsData,  refresh: refreshFlags }     = useSharedPolling<{emergency_stop:boolean;maintenance_mode:boolean;telegram:boolean;ai_validation:boolean;_aiEnabled:boolean}|null>('trading:flags', flagsFetcher, 120_000)
  const { data: scanStats }                             = useSharedPolling<ScanSummaryResponse|null>('trading:scans',scansFetcher,        120_000)
  const { data: auditEntries }                          = useSharedPolling<AuditEntry[]|null>('trading:audit',       auditFetcher,        600_000) // audit log rarely changes
  const { data: healthReady }                           = useSharedPolling<HealthReady|null> ('trading:health-ready',healthReadyFetcher,  300_000) // health check 5-min is fine
  const { data: regimePerfData }                        = useSharedPolling<Record<string,unknown>|null>('trading:regime-perf', regimePerfFetcher, 600_000) // analytics history
  const { data: trackRecord }                           = useSharedPolling<TrackRecordResponse|null>('trading:track-record',  trackRecordFetcher,  600_000)

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
      // Refresh signal feed and counts ~20s after queuing — allows scan time to complete
      setTimeout(() => { refreshFeed(); refreshCounts() }, 20_000)
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
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold text-zinc-200">Signals</h1>
        <p className="text-xs text-zinc-500 mt-0.5">Overview · Signals · Regime</p>
      </div>

      {/* Tab nav */}
      <div className="flex gap-1 border-b border-zinc-800 pb-0">
        {TABS.map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)}
            className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors ${
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
          providers={providers??[]} cache={cache??null} signals={recentFeed?.signals??[]}
          flags={flags} countdown={countdown}
          trackRecord={trackRecord??null}
          scanMode={scanMode} onScanModeChange={setScanMode}
          onScanNow={handleScanNow} scanning={scanning} scanDone={scanDone} scanError={opError}
          onTogglePause={handlePause} pausing={pausing}
        />
      )}
      {tab==='signals'  && <SignalsTab  currentRegime={currentRegime} />}
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
