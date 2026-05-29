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

// ─── Signal Card ──────────────────────────────────────────────────────────────

function SignalCard({ sig }: { sig: TradingSignal }) {
  const [expanded, setExpanded] = useState(false)
  const isBuy     = sig.type === 'BUY'
  const stage     = computeLifecycleStage(sig)
  const stageCfg  = LIFECYCLE_CONFIG[stage]
  const conf      = confLabel(sig.confidence)
  const tpPct     = pct(sig.entryPrice, sig.targetPrice)
  const slPct     = pct(sig.entryPrice, sig.stopLoss)
  const rr        = sig.stopLoss > 0
    ? (Math.abs(sig.targetPrice - sig.entryPrice) / Math.abs(sig.entryPrice - sig.stopLoss)).toFixed(1)
    : '—'

  return (
    <div className="glass-card rounded-xl border border-terminal-border/50 overflow-hidden">
      {/* Main row */}
      <div
        className="px-5 py-4 flex items-center gap-4 cursor-pointer hover:bg-terminal-bright/5 transition-colors"
        onClick={() => setExpanded(e => !e)}
      >
        {/* Direction icon */}
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
          isBuy ? 'bg-emerald-400/10 border border-emerald-400/25' : 'bg-red-400/10 border border-red-400/25'
        }`}>
          {isBuy
            ? <ArrowUpRight className="w-5 h-5 text-emerald-400" />
            : <ArrowDownRight className="w-5 h-5 text-red-400" />
          }
        </div>

        {/* Symbol + type */}
        <div className="min-w-[100px]">
          <p className="text-terminal-text text-base font-bold font-mono">{sig.symbol}</p>
          <p className={`text-xs font-semibold font-mono ${isBuy ? 'text-emerald-400' : 'text-red-400'}`}>
            {isBuy ? '▲ LONG' : '▼ SHORT'}
          </p>
        </div>

        {/* Confidence */}
        <div className="min-w-[90px]">
          <p className="text-terminal-muted text-[10px] uppercase tracking-wider mb-0.5">Confidence</p>
          <p className={`text-sm font-bold font-mono ${conf.color}`}>{sig.confidence}%</p>
          <p className={`text-[10px] font-semibold ${conf.color}`}>{conf.text}</p>
        </div>

        {/* Trade levels */}
        <div className="min-w-[130px]">
          <p className="text-terminal-muted text-[10px] uppercase tracking-wider mb-0.5">Entry → Target</p>
          <p className="text-terminal-text text-sm font-mono font-semibold">${sig.entryPrice.toFixed(4)}</p>
          <p className="text-emerald-400 text-xs font-mono">→ ${sig.targetPrice.toFixed(4)} <span className="text-emerald-400/60">(+{tpPct}%)</span></p>
        </div>

        {/* Stop & RR */}
        <div className="min-w-[110px]">
          <p className="text-terminal-muted text-[10px] uppercase tracking-wider mb-0.5">Stop Loss</p>
          <p className="text-red-400 text-sm font-mono">${sig.stopLoss.toFixed(4)}</p>
          <p className="text-terminal-muted text-xs font-mono">-{slPct}% · R:R <span className="text-terminal-text font-bold">1:{rr}</span></p>
        </div>

        {/* Grade */}
        <div className="min-w-[60px]">
          <p className="text-terminal-muted text-[10px] uppercase tracking-wider mb-1">Grade</p>
          {sig.riskGrade ? (
            <span className={`text-sm font-bold px-2 py-0.5 rounded border ${GRADE_COLORS[sig.riskGrade] ?? 'text-terminal-muted border-terminal-border'}`}>
              {sig.riskGrade}
            </span>
          ) : <span className="text-terminal-muted">—</span>}
        </div>

        {/* Mode */}
        <div className="min-w-[90px]">
          <p className="text-terminal-muted text-[10px] uppercase tracking-wider mb-1">Mode</p>
          <span className={`text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded border ${MODE_COLORS[sig.scannerMode] ?? 'text-terminal-muted border-terminal-border'}`}>
            {sig.scannerMode?.replace('_', ' ').toUpperCase()}
          </span>
        </div>

        {/* Lifecycle */}
        <div className="min-w-[80px]">
          <p className="text-terminal-muted text-[10px] uppercase tracking-wider mb-1">Stage</p>
          <span className={`text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded border ${stageCfg.badge}`}>
            {stageCfg.label}
          </span>
        </div>

        {/* Time + expand */}
        <div className="ml-auto text-right shrink-0">
          <p className="text-terminal-muted text-xs font-mono whitespace-nowrap">
            {formatTs(sig.createdAt instanceof Date ? sig.createdAt.toISOString() : sig.createdAt)}
          </p>
          {expanded
            ? <ChevronUp className="w-4 h-4 text-terminal-muted/40 mt-1 ml-auto" />
            : <ChevronDown className="w-4 h-4 text-terminal-muted/40 mt-1 ml-auto" />
          }
        </div>
      </div>

      {/* Expanded detail — grouped sections */}
      {expanded && (
        <div className="border-t border-terminal-border/30 bg-terminal-surface/30">
          {/* Trade Context */}
          <div className="px-4 sm:px-5 py-3 grid grid-cols-2 sm:grid-cols-4 gap-3 border-b border-terminal-border/20">
            {sig.riskScore != null && (
              <div>
                <p className="text-terminal-muted text-[10px] uppercase tracking-wider mb-1">Risk Score</p>
                <p className="text-terminal-text text-sm font-mono">{sig.riskScore.toFixed(0)}/100</p>
              </div>
            )}
            {(sig as any).maxSafeLeverage > 0 && (
              <div>
                <p className="text-terminal-muted text-[10px] uppercase tracking-wider mb-1">Max Leverage</p>
                <p className="text-terminal-text text-sm font-mono font-bold">{(sig as any).maxSafeLeverage}×</p>
              </div>
            )}
          </div>

          {/* Futures Intelligence — only for futures/high_confidence */}
          {['futures', 'high_confidence'].includes(sig.scannerMode) && sig.futuresData && (
            <div className="px-4 sm:px-5 py-3 grid grid-cols-2 sm:grid-cols-4 gap-3 border-b border-terminal-border/20">
              <div className="col-span-2 sm:col-span-4 text-[10px] text-terminal-muted uppercase tracking-wider mb-1">Futures Intelligence</div>
              {sig.futuresData.fundingRate != null && (
                <div>
                  <p className="text-terminal-muted text-[10px] uppercase tracking-wider mb-1">Funding Rate</p>
                  <p className={`text-sm font-mono ${sig.futuresData.fundingRate > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                    {(sig.futuresData.fundingRate * 100).toFixed(4)}%
                  </p>
                </div>
              )}
              {sig.futuresData.momentumScore != null && (
                <div>
                  <p className="text-terminal-muted text-[10px] uppercase tracking-wider mb-1">Momentum</p>
                  <p className="text-terminal-text text-sm font-mono">{sig.futuresData.momentumScore}/100</p>
                </div>
              )}
            </div>
          )}

          {/* AI Analysis */}
          {(sig.aiReasoning || sig.setupDescription) && (
            <div className="px-4 sm:px-5 py-3 space-y-3">
              {sig.aiReasoning && (
                <div>
                  <p className="text-terminal-muted text-[10px] uppercase tracking-wider mb-1">AI Reasoning</p>
                  <p className="text-terminal-text text-sm leading-relaxed">{sig.aiReasoning}</p>
                </div>
              )}
              {sig.setupDescription && (
                <div>
                  <p className="text-terminal-muted text-[10px] uppercase tracking-wider mb-1">Setup</p>
                  <p className="text-terminal-muted text-sm leading-relaxed">{sig.setupDescription}</p>
                </div>
              )}
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
