'use client'

import { useCallback, useState, useMemo } from 'react'
import { TradingSignal } from '@/types'
import { adminApi, EdgeReport } from '@/lib/admin-api'
import { useAutoRefresh } from '@/lib/use-auto-refresh'
import { formatTs } from '@/lib/utils'
import { computeLifecycleStage, LIFECYCLE_CONFIG } from '@/lib/signal-lifecycle'
import { ArrowUpRight, ArrowDownRight, ChevronDown, ChevronUp, Filter } from 'lucide-react'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pct(a: number, b: number) {
  return ((Math.abs(b - a) / a) * 100).toFixed(2)
}

function confLabel(c: number) {
  if (c >= 90) return { text: 'VERY HIGH', color: 'text-emerald-400' }
  if (c >= 85) return { text: 'HIGH',      color: 'text-green-400' }
  if (c >= 80) return { text: 'SOLID',     color: 'text-blue-400' }
  if (c >= 75) return { text: 'MEDIUM',    color: 'text-amber-400' }
  return              { text: 'LOW',       color: 'text-orange-400' }
}

const GRADE_COLORS: Record<string, string> = {
  A: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30',
  B: 'text-blue-400   bg-blue-400/10   border-blue-400/30',
  C: 'text-amber-400  bg-amber-400/10  border-amber-400/30',
  D: 'text-orange-400 bg-orange-400/10 border-orange-400/30',
  F: 'text-red-400    bg-red-400/10    border-red-400/30',
}

const MODE_COLORS: Record<string, string> = {
  spot:             'text-sky-400    border-sky-400/30    bg-sky-400/5',
  futures:          'text-purple-400 border-purple-400/30 bg-purple-400/5',
  high_confidence:  'text-emerald-400 border-emerald-400/30 bg-emerald-400/5',
  trending:         'text-amber-400  border-amber-400/30  bg-amber-400/5',
}

// ─── Phase 7.x Intelligence Helpers ──────────────────────────────────────────

function trendScoreTier(score: number): { label: string; cls: string } {
  if (score >= 90) return { label: 'Elite',  cls: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30' }
  if (score >= 80) return { label: 'Strong', cls: 'text-blue-400   bg-blue-400/10   border-blue-400/30' }
  if (score >= 70) return { label: 'Good',   cls: 'text-amber-400  bg-amber-400/10  border-amber-400/30' }
  return               { label: 'Weak',   cls: 'text-red-400    bg-red-400/10    border-red-400/30' }
}

const SECTOR_CLS: Record<string, string> = {
  ACCELERATING: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30',
  STRONGEST:    'text-blue-400   bg-blue-400/10   border-blue-400/30',
  WEAKENING:    'text-amber-400  bg-amber-400/10  border-amber-400/30',
  OVERCROWDED:  'text-red-400    bg-red-400/10    border-red-400/30',
}

const BREAKOUT_CLS: Record<string, string> = {
  HIGH_MOMENTUM_BREAKOUT: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30',
  CONFIRMED_BREAKOUT:     'text-blue-400   bg-blue-400/10   border-blue-400/30',
  EARLY_BREAKOUT:         'text-amber-400  bg-amber-400/10  border-amber-400/30',
}

const OI_CLS: Record<string, string> = {
  NEW_LONGS:        'text-emerald-400 bg-emerald-400/10 border-emerald-400/30',
  NEW_SHORTS:       'text-red-400    bg-red-400/10    border-red-400/30',
  SHORT_COVERING:   'text-amber-400  bg-amber-400/10  border-amber-400/30',
  LONG_LIQUIDATION: 'text-orange-400 bg-orange-400/10 border-orange-400/30',
}

const POS_CLS: Record<string, string> = {
  EXTREME_LONG:  'text-red-400    bg-red-400/10    border-red-400/30',
  LONG_HEAVY:    'text-amber-400  bg-amber-400/10  border-amber-400/30',
  SHORT_HEAVY:   'text-sky-400    bg-sky-400/10    border-sky-400/30',
  EXTREME_SHORT: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30',
}

const FUND_CLS: Record<string, string> = {
  RISING:  'text-red-400    bg-red-400/10    border-red-400/30',
  FALLING: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30',
}

const FUND_ARROW: Record<string, string> = { RISING: '↗', FALLING: '↘' }

const INTEL_CHIP = 'flex items-center gap-1 px-2 py-0.5 rounded-md border text-[10px] font-mono font-semibold'

// ─── Section label helper ─────────────────────────────────────────────────────

function SectionLabel({ label }: { label: string }) {
  return (
    <p className="text-[9px] text-terminal-muted/50 uppercase tracking-widest font-semibold mb-2 flex items-center gap-1.5">
      <span className="h-px flex-1 bg-terminal-border/20" />
      {label}
      <span className="h-px flex-1 bg-terminal-border/20" />
    </p>
  )
}

// ─── Signal Card ──────────────────────────────────────────────────────────────

function SignalCard({ sig }: { sig: TradingSignal }) {
  const [expanded, setExpanded] = useState(false)
  const isBuy    = sig.type === 'BUY'
  const stage    = computeLifecycleStage(sig)
  const stageCfg = LIFECYCLE_CONFIG[stage]
  const conf     = confLabel(sig.confidence)
  const tpPct    = pct(sig.entryPrice, sig.targetPrice)
  const slPct    = pct(sig.entryPrice, sig.stopLoss)
  const rr       = sig.stopLoss > 0
    ? (Math.abs(sig.targetPrice - sig.entryPrice) / Math.abs(sig.entryPrice - sig.stopLoss)).toFixed(1)
    : '—'
  const hasIntel = sig.trendScore != null || sig.sectorStatus || sig.breakoutStrength ||
    sig.oiInterpretation || sig.fundingTrend || sig.positioningContext

  return (
    <div className="glass-card rounded-xl border border-terminal-border/50 overflow-hidden">

      {/* ── Collapsed header row ─────────────────────────────────────────────── */}
      <div
        className="px-4 py-3 flex items-center gap-3 cursor-pointer hover:bg-terminal-bright/5 transition-colors"
        onClick={() => setExpanded(e => !e)}
      >
        {/* Direction icon */}
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
          isBuy ? 'bg-emerald-400/10 border border-emerald-400/25' : 'bg-red-400/10 border border-red-400/25'
        }`}>
          {isBuy
            ? <ArrowUpRight className="w-4 h-4 text-emerald-400" />
            : <ArrowDownRight className="w-4 h-4 text-red-400" />
          }
        </div>

        {/* Symbol + direction — always visible */}
        <div className="w-[90px] shrink-0">
          <p className="text-terminal-text text-sm font-bold font-mono leading-tight">{sig.symbol}</p>
          <p className={`text-[10px] font-semibold font-mono ${isBuy ? 'text-emerald-400' : 'text-red-400'}`}>
            {isBuy ? '▲ LONG' : '▼ SHORT'}
          </p>
        </div>

        {/* Confidence — always visible */}
        <div className="w-[70px] shrink-0">
          <p className={`text-sm font-bold font-mono ${conf.color}`}>{sig.confidence}%</p>
          <p className={`text-[9px] font-semibold ${conf.color}`}>{conf.text}</p>
        </div>

        {/* Trade levels — hidden on small mobile */}
        <div className="hidden sm:block w-[120px] shrink-0">
          <p className="text-terminal-text text-xs font-mono font-semibold">${sig.entryPrice.toFixed(4)}</p>
          <p className="text-emerald-400 text-[10px] font-mono">↑ +{tpPct}% · SL -{slPct}%</p>
        </div>

        {/* R:R — visible on sm+ */}
        <div className="hidden sm:block shrink-0">
          <p className="text-[9px] text-terminal-muted/50 uppercase tracking-wider">R:R</p>
          <p className="text-terminal-text text-xs font-mono font-bold">1:{rr}</p>
        </div>

        {/* Grade badge */}
        {sig.riskGrade && (
          <span className={`text-xs font-bold px-1.5 py-0.5 rounded border shrink-0 hidden sm:inline ${GRADE_COLORS[sig.riskGrade] ?? 'text-terminal-muted border-terminal-border'}`}>
            {sig.riskGrade}
          </span>
        )}

        {/* Mode badge — hidden on mobile */}
        <span className={`text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded border shrink-0 hidden md:inline ${MODE_COLORS[sig.scannerMode] ?? 'text-terminal-muted border-terminal-border'}`}>
          {sig.scannerMode?.replace('_', ' ').toUpperCase()}
        </span>

        {/* Stage badge — always visible, prominent */}
        <span className={`text-[10px] font-mono font-semibold px-2 py-0.5 rounded border shrink-0 ${stageCfg.badge}`}>
          {stageCfg.label}
        </span>

        {/* Time + expand */}
        <div className="ml-auto text-right shrink-0 flex flex-col items-end gap-0.5">
          <p className="text-terminal-muted text-[10px] font-mono whitespace-nowrap">
            {formatTs(sig.createdAt instanceof Date ? sig.createdAt.toISOString() : sig.createdAt)}
          </p>
          {expanded
            ? <ChevronUp className="w-3.5 h-3.5 text-terminal-muted/40" />
            : <ChevronDown className="w-3.5 h-3.5 text-terminal-muted/40" />
          }
        </div>
      </div>

      {/* ── Expanded detail — 5 grouped sections ────────────────────────────── */}
      {expanded && (
        <div className="border-t border-terminal-border/30 bg-terminal-surface/20 divide-y divide-terminal-border/15">

          {/* ── TRADE ─── */}
          <div className="px-4 py-3">
            <SectionLabel label="Trade" />
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <p className="text-terminal-muted text-[9px] uppercase tracking-wider mb-0.5">Entry</p>
                <p className="text-terminal-text text-sm font-mono font-semibold">${sig.entryPrice.toFixed(4)}</p>
              </div>
              <div>
                <p className="text-terminal-muted text-[9px] uppercase tracking-wider mb-0.5">Target</p>
                <p className="text-emerald-400 text-sm font-mono font-semibold">${sig.targetPrice.toFixed(4)}</p>
                <p className="text-emerald-400/60 text-[10px] font-mono">+{tpPct}%</p>
              </div>
              <div>
                <p className="text-terminal-muted text-[9px] uppercase tracking-wider mb-0.5">Stop Loss</p>
                <p className="text-red-400 text-sm font-mono font-semibold">${sig.stopLoss.toFixed(4)}</p>
                <p className="text-red-400/60 text-[10px] font-mono">-{slPct}%</p>
              </div>
              <div>
                <p className="text-terminal-muted text-[9px] uppercase tracking-wider mb-0.5">R:R · Risk</p>
                <p className="text-terminal-text text-sm font-mono font-bold">1:{rr}</p>
                {sig.riskScore != null && (
                  <p className="text-terminal-muted text-[10px] font-mono">Risk {sig.riskScore.toFixed(0)}/100</p>
                )}
              </div>
            </div>
            {/* Grade + Mode + Leverage on mobile (hidden in header) */}
            <div className="flex flex-wrap gap-1.5 mt-2.5 sm:hidden">
              {sig.riskGrade && (
                <span className={`text-xs font-bold px-2 py-0.5 rounded border ${GRADE_COLORS[sig.riskGrade] ?? 'text-terminal-muted border-terminal-border'}`}>
                  {sig.riskGrade}
                </span>
              )}
              <span className={`text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded border ${MODE_COLORS[sig.scannerMode] ?? 'text-terminal-muted border-terminal-border'}`}>
                {sig.scannerMode?.replace('_', ' ').toUpperCase()}
              </span>
              {(sig as any).maxSafeLeverage > 0 && (
                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded border border-terminal-border text-terminal-muted">
                  {(sig as any).maxSafeLeverage}× max
                </span>
              )}
            </div>
            {/* Max leverage on desktop */}
            {(sig as any).maxSafeLeverage > 0 && (
              <p className="hidden sm:block text-[10px] text-terminal-muted/50 font-mono mt-1.5">
                Max safe leverage: {(sig as any).maxSafeLeverage}×
              </p>
            )}
          </div>

          {/* ── TECHNICAL ─── */}
          {sig.indicators && (
            <div className="px-4 py-3">
              <SectionLabel label="Technical" />
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-2">
                <div>
                  <p className="text-terminal-muted text-[9px] uppercase tracking-wider mb-0.5">RSI</p>
                  <p className={`text-sm font-mono font-semibold ${sig.indicators.rsi > 70 ? 'text-red-400' : sig.indicators.rsi < 30 ? 'text-emerald-400' : 'text-terminal-text'}`}>
                    {sig.indicators.rsi.toFixed(1)}
                  </p>
                </div>
                <div>
                  <p className="text-terminal-muted text-[9px] uppercase tracking-wider mb-0.5">Vol Spike</p>
                  <p className={`text-sm font-mono font-semibold ${sig.indicators.volumeSpike >= 1.5 ? 'text-emerald-400' : 'text-terminal-muted'}`}>
                    {sig.indicators.volumeSpike.toFixed(1)}×
                  </p>
                </div>
                <div>
                  <p className="text-terminal-muted text-[9px] uppercase tracking-wider mb-0.5">ATR</p>
                  <p className="text-terminal-text text-sm font-mono font-semibold">{sig.indicators.atr.toFixed(4)}</p>
                </div>
                <div>
                  <p className="text-terminal-muted text-[9px] uppercase tracking-wider mb-0.5">Trend</p>
                  <p className={`text-sm font-mono font-semibold ${
                    sig.indicators.trend === 'BULLISH' ? 'text-emerald-400' :
                    sig.indicators.trend === 'BEARISH' ? 'text-red-400' : 'text-terminal-muted'
                  }`}>{sig.indicators.trend}</p>
                </div>
              </div>
              {sig.setupDescription && (
                <p className="text-terminal-muted/70 text-xs leading-relaxed line-clamp-3">
                  {sig.setupDescription}
                </p>
              )}
            </div>
          )}

          {/* ── AI ─── */}
          {(sig.aiReasoning || (sig.strengths && sig.strengths.length > 0) || (sig.risks && sig.risks.length > 0)) && (
            <div className="px-4 py-3">
              <SectionLabel label="AI" />
              {sig.aiReasoning && (
                <p className="text-terminal-text text-xs leading-relaxed mb-2">{sig.aiReasoning}</p>
              )}
              {sig.strengths && sig.strengths.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-1.5">
                  {sig.strengths.slice(0, 3).map((s, i) => (
                    <span key={i} className="text-[9px] px-1.5 py-0.5 rounded border border-emerald-400/20 bg-emerald-400/5 text-emerald-400/80 font-mono">
                      ✓ {s}
                    </span>
                  ))}
                </div>
              )}
              {sig.risks && sig.risks.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {sig.risks.slice(0, 2).map((r, i) => (
                    <span key={i} className="text-[9px] px-1.5 py-0.5 rounded border border-red-400/20 bg-red-400/5 text-red-400/80 font-mono">
                      ⚠ {r}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── INTELLIGENCE ─── */}
          {hasIntel && (
            <div className="px-4 py-3">
              <SectionLabel label="Intelligence" />
              <div className="flex flex-wrap gap-1.5">
                {sig.trendScore != null && (() => {
                  const tier = trendScoreTier(sig.trendScore)
                  return (
                    <span className={`${INTEL_CHIP} ${tier.cls}`}>
                      <span className="opacity-60">TS</span>{sig.trendScore.toFixed(0)}
                      <span className="opacity-50">·</span>{tier.label}
                    </span>
                  )
                })()}
                {sig.sectorStatus && sig.sectorStatus !== 'NEUTRAL' && (
                  <span className={`${INTEL_CHIP} ${SECTOR_CLS[sig.sectorStatus] ?? 'text-terminal-muted border-terminal-border/30'}`}>
                    🏛 {sig.sectorStatus}
                  </span>
                )}
                {sig.breakoutStrength && (
                  <span className={`${INTEL_CHIP} ${BREAKOUT_CLS[sig.breakoutStrength] ?? 'text-terminal-muted border-terminal-border/30'}`}>
                    ⚡ {sig.breakoutStrength.replace('_BREAKOUT', '').replace('HIGH_MOMENTUM', 'HI-MOM')}
                    {sig.breakoutType && <span className="opacity-50 ml-0.5">({sig.breakoutType.split('+')[0].replace(/_/g, ' ')})</span>}
                  </span>
                )}
                {sig.oiInterpretation && sig.oiInterpretation !== 'NEUTRAL' && (
                  <span className={`${INTEL_CHIP} ${OI_CLS[sig.oiInterpretation] ?? 'text-terminal-muted border-terminal-border/30'}`}>
                    OI: {sig.oiInterpretation.replace(/_/g, ' ')}
                  </span>
                )}
                {sig.fundingTrend && sig.fundingTrend !== 'STABLE' && (
                  <span className={`${INTEL_CHIP} ${FUND_CLS[sig.fundingTrend] ?? 'text-terminal-muted border-terminal-border/30'}`}>
                    {FUND_ARROW[sig.fundingTrend]} FUND {sig.fundingTrend}
                  </span>
                )}
                {sig.positioningContext && sig.positioningContext !== 'BALANCED' && (
                  <span className={`${INTEL_CHIP} ${POS_CLS[sig.positioningContext] ?? 'text-terminal-muted border-terminal-border/30'}`}>
                    {sig.positioningContext.replace(/_/g, ' ')}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* ── FUTURES ─── */}
          {['futures', 'high_confidence'].includes(sig.scannerMode) && sig.futuresData && (
            <div className="px-4 py-3">
              <SectionLabel label="Futures" />
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                {sig.futuresData.fundingRate != null && (
                  <div>
                    <p className="text-terminal-muted text-[9px] uppercase tracking-wider mb-0.5">Funding</p>
                    <p className={`text-sm font-mono font-semibold ${sig.futuresData.fundingRate > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                      {(sig.futuresData.fundingRate * 100).toFixed(4)}%
                    </p>
                  </div>
                )}
                {sig.futuresData.momentumScore != null && (
                  <div>
                    <p className="text-terminal-muted text-[9px] uppercase tracking-wider mb-0.5">Momentum</p>
                    <p className="text-terminal-text text-sm font-mono font-semibold">{sig.futuresData.momentumScore}/100</p>
                  </div>
                )}
                {sig.futuresData.oiTrend && (
                  <div>
                    <p className="text-terminal-muted text-[9px] uppercase tracking-wider mb-0.5">OI Trend</p>
                    <p className={`text-sm font-mono font-semibold ${sig.futuresData.oiTrend === 'RISING' ? 'text-emerald-400' : sig.futuresData.oiTrend === 'FALLING' ? 'text-red-400' : 'text-terminal-muted'}`}>
                      {sig.futuresData.oiTrend}
                    </p>
                  </div>
                )}
                {sig.futuresData.longShortRatio != null && (
                  <div>
                    <p className="text-terminal-muted text-[9px] uppercase tracking-wider mb-0.5">L/S Ratio</p>
                    <p className="text-terminal-text text-sm font-mono font-semibold">{sig.futuresData.longShortRatio.toFixed(2)}</p>
                  </div>
                )}
              </div>
            </div>
          )}

        </div>
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

type SortKey = 'date' | 'confidence' | 'rr'
type FilterMode = 'all' | 'spot' | 'futures' | 'high_confidence' | 'trending'
type FilterType = 'all' | 'BUY' | 'SELL'

export default function SignalsPage() {
  const [sortKey,     setSortKey]     = useState<SortKey>('date')
  const [sortAsc,     setSortAsc]     = useState(false)
  const [filterMode,  setFilterMode]  = useState<FilterMode>('all')
  const [filterType,  setFilterType]  = useState<FilterType>('all')
  const [minConf,     setMinConf]     = useState(0)

  const edgeFetcher = useCallback(() => adminApi.analytics.edgeReport(168), [])
  const { data: edge, loading: el } = useAutoRefresh<EdgeReport>(edgeFetcher, 60_000)

  const signalsFetcher = useCallback(async () => {
    const res = await fetch('/api/signals?limit=200&minConfidence=0', { cache: 'no-store' })
    if (!res.ok) throw new Error('signals fetch failed')
    return res.json() as Promise<{ signals: TradingSignal[] }>
  }, [])
  const { data: signalsData, loading: sl } = useAutoRefresh<{ signals: TradingSignal[] }>(signalsFetcher, 30_000)

  const rawSignals = signalsData?.signals ?? []

  const signals = useMemo(() => {
    let s = rawSignals
    if (filterMode !== 'all') s = s.filter(x => x.scannerMode === filterMode)
    if (filterType !== 'all') s = s.filter(x => x.type === filterType)
    if (minConf > 0)          s = s.filter(x => x.confidence >= minConf)

    s = [...s].sort((a, b) => {
      let v = 0
      if (sortKey === 'date')       v = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      if (sortKey === 'confidence') v = a.confidence - b.confidence
      if (sortKey === 'rr')         v = a.rrRatio - b.rrRatio
      return sortAsc ? v : -v
    })
    return s
  }, [rawSignals, filterMode, filterType, minConf, sortKey, sortAsc])

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(a => !a)
    else { setSortKey(key); setSortAsc(false) }
  }

  const SortBtn = ({ k, label }: { k: SortKey; label: string }) => (
    <button
      onClick={() => toggleSort(k)}
      className={`flex items-center gap-1 text-xs px-2.5 py-1.5 rounded border transition-colors ${
        sortKey === k
          ? 'bg-terminal-bright/20 border-terminal-border text-terminal-text'
          : 'border-transparent text-terminal-muted hover:text-terminal-text'
      }`}
    >
      {label}
      {sortKey === k && (sortAsc ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
    </button>
  )

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-terminal-text text-2xl font-semibold">Signal Intelligence</h1>
          <p className="text-terminal-muted text-sm mt-1">
            {sl ? 'Loading…' : `${signals.length} signal${signals.length !== 1 ? 's' : ''} · refreshes every 30s`}
          </p>
        </div>
      </div>

      {/* Edge summary strip */}
      {!el && edge && edge.overall && edge.edge_verdict && edge.edge_verdict.confidence_level !== 'insufficient_data' && (
        <div className="glass-card rounded-xl px-5 py-3 flex items-center gap-6 flex-wrap text-sm font-mono">
          <div>
            <span className="text-terminal-muted text-xs">WIN RATE </span>
            <span className={`font-bold ${edge.overall.win_rate != null && edge.overall.win_rate >= 0.55 ? 'text-emerald-400' : 'text-red-400'}`}>
              {edge.overall.win_rate != null ? `${(edge.overall.win_rate * 100).toFixed(1)}%` : '—'}
            </span>
          </div>
          <div>
            <span className="text-terminal-muted text-xs">EXPECTANCY </span>
            <span className={`font-bold ${edge.overall.expectancy != null && edge.overall.expectancy > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {edge.overall.expectancy != null ? `${edge.overall.expectancy > 0 ? '+' : ''}${edge.overall.expectancy.toFixed(2)}R` : '—'}
            </span>
          </div>
          <div>
            <span className="text-terminal-muted text-xs">SIGNALS (7d) </span>
            <span className="font-bold text-terminal-text">{edge.overall.total}</span>
          </div>
          <div>
            <span className="text-terminal-muted text-xs">EDGE </span>
            <span className={`font-bold ${edge.edge_verdict.has_edge ? 'text-emerald-400' : 'text-red-400'}`}>
              {edge.edge_verdict.confidence_level.toUpperCase().replace(/_/g, ' ')}
            </span>
          </div>
        </div>
      )}

      {!el && edge && (!edge.overall || edge.edge_verdict?.confidence_level === 'insufficient_data') && (
        <div className="rounded-xl px-4 py-3 bg-amber-400/5 border border-amber-400/20">
          <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
            <span className="text-amber-400 font-semibold text-sm">◌ Edge warming up</span>
            <span className="text-terminal-muted text-xs font-mono">
              {edge.overall?.total ?? 0} / 30 resolved signals
            </span>
          </div>
          <div className="w-full h-1.5 bg-terminal-border/40 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                (edge.overall?.total ?? 0) >= 20 ? 'bg-blue-400' :
                (edge.overall?.total ?? 0) >= 10 ? 'bg-amber-400' : 'bg-zinc-500'
              }`}
              style={{ width: `${Math.min(100, ((edge.overall?.total ?? 0) / 30) * 100)}%` }}
            />
          </div>
          <p className="text-terminal-muted/60 text-xs mt-1.5">
            Need 30+ resolved outcomes for win rate and expectancy. Keep running scans — outcomes resolve automatically.
          </p>
        </div>
      )}

      {/* Lifecycle distribution pills */}
      {rawSignals.length > 0 && (() => {
        const counts = rawSignals.reduce<Record<string,number>>((a,s) => { const stage = computeLifecycleStage(s); a[stage] = (a[stage]??0)+1; return a }, {})
        const pills: Array<{label:string;count:number;color:string}> = [
          { label:'Active',   count: counts['ACTIVE']??0,        color:'text-green-400  border-green-500/20  bg-green-500/5'  },
          { label:'Sent',     count: (counts['TELEGRAM_SENT']??0)+(counts['AI_APPROVED']??0), color:'text-purple-400 border-purple-500/20 bg-purple-500/5' },
          { label:'TP Hit',   count: counts['TP_HIT']??0,        color:'text-emerald-400 border-emerald-500/20 bg-emerald-500/5' },
          { label:'SL Hit',   count: counts['SL_HIT']??0,        color:'text-red-400    border-red-500/20    bg-red-500/5'    },
          { label:'Stale',    count: counts['STALE']??0,         color:'text-amber-400  border-amber-500/20  bg-amber-500/5'  },
        ].filter(p => p.count > 0)
        return pills.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {pills.map(p => (
              <span key={p.label} className={`text-xs px-2.5 py-1 rounded-full border font-medium ${p.color}`}>
                {p.count} {p.label}
              </span>
            ))}
          </div>
        ) : null
      })()}

      {/* Filters + Sort */}
      <div className="flex items-center gap-3 flex-wrap">
        <Filter className="w-4 h-4 text-terminal-muted shrink-0" />

        {/* Mode filter */}
        <div className="flex gap-1">
          {(['all', 'spot', 'futures', 'high_confidence', 'trending'] as FilterMode[]).map(m => (
            <button key={m} onClick={() => setFilterMode(m)}
              className={`text-xs px-2.5 py-1.5 rounded border transition-colors ${
                filterMode === m
                  ? 'bg-terminal-bright/20 border-terminal-border text-terminal-text'
                  : 'border-transparent text-terminal-muted hover:text-terminal-text'
              }`}
            >
              {m === 'all' ? 'All Modes' : m.replace('_', ' ')}
            </button>
          ))}
        </div>

        <div className="w-px h-4 bg-terminal-border/50" />

        {/* Direction filter */}
        {(['all', 'BUY', 'SELL'] as FilterType[]).map(t => (
          <button key={t} onClick={() => setFilterType(t)}
            className={`text-xs px-2.5 py-1.5 rounded border transition-colors ${
              filterType === t
                ? t === 'BUY' ? 'bg-emerald-400/10 border-emerald-400/30 text-emerald-400'
                : t === 'SELL' ? 'bg-red-400/10 border-red-400/30 text-red-400'
                : 'bg-terminal-bright/20 border-terminal-border text-terminal-text'
                : 'border-transparent text-terminal-muted hover:text-terminal-text'
            }`}
          >
            {t === 'all' ? 'All' : t === 'BUY' ? '▲ Long' : '▼ Short'}
          </button>
        ))}

        <div className="w-px h-4 bg-terminal-border/50" />

        {/* Min confidence */}
        <select
          value={minConf}
          onChange={e => setMinConf(Number(e.target.value))}
          className="text-xs bg-transparent border border-terminal-border/50 rounded px-2 py-1.5 text-terminal-muted hover:border-terminal-border transition-colors"
        >
          <option value={0}>All Confidence</option>
          <option value={75}>≥ 75%</option>
          <option value={80}>≥ 80%</option>
          <option value={85}>≥ 85%</option>
          <option value={90}>≥ 90%</option>
        </select>

        <div className="ml-auto flex items-center gap-1">
          <span className="text-terminal-muted text-xs mr-1">Sort:</span>
          <SortBtn k="date"       label="Date"       />
          <SortBtn k="confidence" label="Confidence" />
          <SortBtn k="rr"         label="R:R"        />
        </div>
      </div>

      {/* Signal list */}
      {sl ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="glass-card rounded-xl px-5 py-4 flex items-center gap-4">
              <div className="skeleton w-9 h-9 rounded-lg" />
              <div className="space-y-2 flex-1">
                <div className="skeleton h-4 w-24 rounded" />
                <div className="skeleton h-3 w-48 rounded" />
              </div>
              <div className="skeleton h-4 w-16 rounded" />
            </div>
          ))}
        </div>
      ) : !signals.length ? (
        <div className="glass-card rounded-xl px-6 py-12 text-center">
          <p className="text-terminal-text text-base font-medium mb-2">No signals match your filters</p>
          <p className="text-terminal-muted text-sm">
            {rawSignals.length === 0
              ? 'Run a scan from the Scanner page. High-confidence and futures modes produce the most actionable setups.'
              : 'Try adjusting the mode/direction/confidence filters above.'
            }
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {signals.map(sig => (
            <SignalCard key={sig.id ?? `${sig.symbol}-${sig.createdAt}`} sig={sig} />
          ))}
        </div>
      )}
    </div>
  )
}
