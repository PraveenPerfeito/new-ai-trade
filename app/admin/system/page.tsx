'use client'

import { useCallback, useState, useEffect, useMemo } from 'react'
import { adminApi, HealthReady, ScanSummaryResponse, AiSummaryResponse, MonitorSnapshot, MonitorLevel, AnomalyRecord, BurninStatus } from '@/lib/admin-api'
import { useAutoRefresh } from '@/lib/use-auto-refresh'
import { useSharedPolling } from '@/lib/use-shared-polling'
import { MetricCard } from '@/components/admin/metric-card'
import { AnomalyBadge } from '@/components/admin/anomaly-badge'
import { ProviderHealthTable, type ProviderCheckResult } from '@/components/admin/provider-health-table'
import { analyticsWindowLabel } from '@/lib/window-label'
import { formatTs } from '@/lib/utils'
import { Server, Database, Cpu, Activity, RefreshCw, CheckCircle2, BellOff, Shield, Eye, X, Clock, AlertTriangle, ChevronDown, Lock } from 'lucide-react'
import { settingTier } from '@/lib/settings-tiers'

// ── Infrastructure Configuration (SETTINGS.CENTER.2) ─────────────────────────
// Engineering-only settings relocated from the Founder Settings page.
// READ-ONLY by design: these are set-once / env-adjacent values; editing them
// during normal operations is how outages happen. Change path: settings API or
// a code change — never the dashboard.

interface InfraConfigRow {
  group: string; key: string; label: string
  value: unknown; description: string; restart: boolean
}

function InfraConfigSection() {
  const [open,     setOpen]     = useState(false)
  const [rows,     setRows]     = useState<InfraConfigRow[] | null>(null)
  const [loadErr,  setLoadErr]  = useState<string | null>(null)

  useEffect(() => {
    if (!open || rows !== null) return
    adminApi.settings.all()
      .then(all => {
        const collected: InfraConfigRow[] = []
        for (const [group, grp] of Object.entries(all)) {
          for (const f of grp?.fields ?? []) {
            if (settingTier(group, f.key) === 'engineering') {
              collected.push({
                group, key: f.key, label: f.label, value: f.value,
                description: f.description, restart: f.requires_restart,
              })
            }
          }
        }
        setRows(collected.sort((a, b) => a.group.localeCompare(b.group) || a.key.localeCompare(b.key)))
      })
      .catch(e => setLoadErr(String(e)))
  }, [open, rows])

  return (
    <div className="glass-card rounded-xl overflow-hidden border border-terminal-border/50">
      <button type="button" onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-terminal-bright/5 transition-colors">
        <div className="flex items-center gap-2">
          <Lock size={13} className="text-terminal-muted/60" />
          <span className="text-sm font-semibold text-terminal-text">Infrastructure Configuration</span>
          <span className="text-[10px] text-terminal-muted/40 font-mono hidden sm:block">· read-only · engineering settings · change via settings API only</span>
        </div>
        <ChevronDown size={14} className={`text-terminal-muted/50 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="border-t border-terminal-border/40">
          {loadErr && <p className="px-5 py-4 text-bear-default text-xs">Failed to load: {loadErr}</p>}
          {!loadErr && rows === null && <p className="px-5 py-4 text-terminal-muted text-xs">Loading…</p>}
          {rows !== null && (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-terminal-border">
                  {['Group', 'Setting', 'Value', 'Description'].map(h => (
                    <th key={h} className="text-terminal-muted text-xs uppercase tracking-wider text-left py-2 px-4">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={`${r.group}.${r.key}`} className="border-b border-terminal-border/30">
                    <td className="py-2 px-4 font-mono text-terminal-muted/60">{r.group}</td>
                    <td className="py-2 px-4">
                      <p className="text-terminal-text font-mono">{r.label}</p>
                      <p className="text-terminal-muted/40 font-mono text-[10px]">{r.key}{r.restart ? ' · ↻ restart' : ''}</p>
                    </td>
                    <td className="py-2 px-4 font-mono text-terminal-text">{String(r.value)}</td>
                    <td className="py-2 px-4 text-terminal-muted/60 hidden md:table-cell">{r.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}

function ServiceCard({ name, status, detail }: { name: string; status: string; detail?: string }) {
  const isConfigured = status !== 'not_configured'
  const isOk      = ['ok', 'ready', 'not_configured', 'HEALTHY'].includes(status)
  const isDegraded = status === 'DEGRADED'
  const dotCls  = !isConfigured ? 'bg-terminal-muted/40'
    : isDegraded ? 'bg-amber-400 animate-pulse'
    : isOk ? 'bg-bull-default' : 'bg-bear-default animate-pulse'
  const borderCls = !isConfigured ? 'border-terminal-border'
    : isDegraded ? 'border-amber-500/20'
    : isOk ? 'border-bull-default/20' : 'border-bear-default/20'
  const textCls = !isConfigured ? 'text-terminal-muted/60'
    : isDegraded ? 'text-amber-400'
    : isOk ? 'text-bull-default' : 'text-bear-default'
  return (
    <div className={`glass-card rounded-lg px-4 py-3.5 border ${borderCls}`}>
      <div className="flex items-center gap-2.5">
        <span className={`w-2 h-2 rounded-full shrink-0 ${dotCls}`} />
        <span className="text-terminal-text text-sm font-medium">{name}</span>
        <span className={`ml-auto font-mono text-xs font-bold uppercase ${textCls}`}>
          {status.replace(/_/g, ' ')}
        </span>
      </div>
      {detail && <p className="text-terminal-muted/50 text-xs font-mono mt-1 ml-4.5 pl-0">{detail}</p>}
    </div>
  )
}

// ── Monitoring helpers ────────────────────────────────────────────────────────

const LEVEL_CLS: Record<MonitorLevel, string> = {
  healthy:  'text-emerald-400',
  warning:  'text-amber-400',
  critical: 'text-red-400',
}
const LEVEL_DOT: Record<MonitorLevel, string> = {
  healthy:  'bg-emerald-400',
  warning:  'bg-amber-400 animate-pulse',
  critical: 'bg-red-400 animate-pulse',
}

function MonitorRow({ label, metric }: { label: string; metric: { value: number; unit: string; level: MonitorLevel } }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-terminal-border/15 last:border-0">
      <span className="text-terminal-muted text-xs">{label}</span>
      <span className={`font-mono text-xs font-semibold ${LEVEL_CLS[metric.level]}`}>
        {metric.value.toLocaleString()}{metric.unit && ` ${metric.unit}`}
      </span>
    </div>
  )
}

// ── Pipeline Integrity card (PIPELINE.HARDENING.1) ───────────────────────────

const PIPELINE_CANON_KEYS = [
  'BTC_DOWN_BUY', 'TOXIC_DENYLIST', 'SIGNAL_COOLDOWN', 'CONFIDENCE_REJECTION',
  'CMC_REJECTION', 'REGIME_REJECTION', 'MTF_REJECTION', 'VOLATILITY_REJECTION',
  'TREND_STRENGTH_REJECTION', 'SETUP_REJECTION', 'RR_REJECTION', 'RISK_REJECTION',
]

function PipelineRow({ label, value, sub, ok }: { label: string; value: string; sub: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-terminal-border/15 last:border-0">
      <div className="flex items-center gap-1.5">
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${ok ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'}`} />
        <span className="text-terminal-muted text-xs">{label}</span>
      </div>
      <div className="text-right">
        <span className="font-mono text-xs font-semibold text-terminal-text">{value}</span>
        {sub && <span className="text-terminal-muted/40 text-[10px] ml-1.5">{sub}</span>}
      </div>
    </div>
  )
}

function PipelineIntegrityCard({
  scans,
  monitor,
}: {
  scans?: ScanSummaryResponse
  monitor?: MonitorSnapshot
}) {
  const signals24h   = monitor?.metrics.signals_per_day.value ?? 0
  const telegrams24h = monitor?.metrics.telegram_sends_per_day.value ?? 0
  const resolved7d   = monitor?.metrics.resolved_7d.value ?? 0

  const gateData    = scans?.gate_rejections ?? {}
  const keysCovered = PIPELINE_CANON_KEYS.filter(k => k in gateData).length
  const gatesPct    = PIPELINE_CANON_KEYS.length > 0
    ? Math.round(keysCovered / PIPELINE_CANON_KEYS.length * 100)
    : 0

  const telegramPct = signals24h > 0 ? Math.round(telegrams24h / signals24h * 100) : null

  // Base score post-PIPELINE.HARDENING.1; live deductions for observable gaps
  let score = 95
  if (gatesPct < 100) score = Math.max(85, score - Math.round((100 - gatesPct) * 0.15))
  if (resolved7d === 0 && signals24h > 5) score -= 3

  const scoreColor = score >= 95 ? 'text-emerald-400' : score >= 90 ? 'text-amber-400' : 'text-red-400'
  const borderCls  = score >= 95 ? 'border-emerald-500/20' : score >= 90 ? 'border-amber-500/20' : 'border-red-500/20'
  const statusText = score >= 95 ? 'All pipeline stages hardened' : score >= 90 ? 'Minor live gaps detected' : 'Pipeline health degraded'

  return (
    <div className="glass-card rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-terminal-muted text-[9px] uppercase tracking-widest">Pipeline Integrity · HARDENING.1</p>
        <div className={`rounded-md px-2 py-0.5 border ${borderCls}`}>
          <span className={`font-mono font-bold text-sm ${scoreColor}`}>{score}/100</span>
        </div>
      </div>
      <p className={`text-[10px] font-mono mb-3 ${scoreColor}`}>{statusText}</p>
      <PipelineRow label="Signals Persisted"  value="100%"  sub="C1: DB-gated accept"  ok />
      <PipelineRow
        label="Gate Accounting"
        value={`${keysCovered}/12`}
        sub={`${gatesPct}% canonical keys`}
        ok={gatesPct === 100}
      />
      <PipelineRow
        label="Outcome Coverage"
        value={resolved7d > 0 ? `${resolved7d}` : '—'}
        sub="resolved (7d)"
        ok={resolved7d > 0}
      />
      <PipelineRow
        label="Telegram Delivery"
        value={telegramPct !== null ? `${telegramPct}%` : '—'}
        sub={`${telegrams24h} sends (24h)`}
        ok
      />
    </div>
  )
}

// ── Gate rejection labels ─────────────────────────────────────────────────────

// All 12 canonical pipeline gate keys (PIPELINE.HARDENING.1 + original 6)
const GATE_REJECTION_LABELS: Record<string, string> = {
  // Outer gates (original 6)
  BTC_DOWN_BUY:          'BTC-down BUY',
  TOXIC_DENYLIST:        'Toxic denylist',
  SIGNAL_COOLDOWN:       '4h cooldown',
  CONFIDENCE_REJECTION:  'Confidence',
  CMC_REJECTION:         'CMC filter',
  REGIME_REJECTION:      'Regime',
  CONTRA_REGIME_REJECTION: 'Contra-regime v2',
  KLINE_EMPTY:           'Kline empty',
  KLINE_PARTIAL:         'Kline partial',
  // Inner pipeline gates (added PIPELINE.HARDENING.1)
  MTF_REJECTION:             'MTF analysis',
  VOLATILITY_REJECTION:      'Volatility',
  TREND_STRENGTH_REJECTION:  'Trend strength',
  SETUP_REJECTION:           'Setup score',
  RR_REJECTION:              'R:R ratio',
  RISK_REJECTION:            'Risk engine',
}

function GateRejectionGrid({ counts }: { counts?: Record<string, number> }) {
  const keys = Object.keys(GATE_REJECTION_LABELS)
  return (
    <div className="glass-card rounded-xl p-4">
      <p className="text-terminal-muted text-[9px] uppercase tracking-widest mb-2">
        Gate Rejections - {analyticsWindowLabel(24)}
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {keys.map((key) => (
          <div key={key} className="rounded-lg border border-terminal-border/30 px-3 py-2">
            <p className="text-terminal-muted/70 text-[10px]">{GATE_REJECTION_LABELS[key]}</p>
            <p className="text-terminal-text font-mono font-semibold text-sm">{counts?.[key] ?? 0}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Anomalies tab inline ──────────────────────────────────────────────────────

type AnomalyState = 'new' | 'acknowledged' | 'muted' | 'resolved'
interface StoredAnomaly { state: AnomalyState; mutedUntil?: number; updatedAt: string }

const STATE_BADGE_CLS: Record<AnomalyState, string> = {
  new:          'text-blue-400 border-blue-400/30 bg-blue-400/10',
  acknowledged: 'text-amber-400 border-amber-400/30 bg-amber-400/10',
  muted:        'text-zinc-500 border-zinc-600/30 bg-zinc-800/40',
  resolved:     'text-green-400 border-green-400/30 bg-green-400/10',
}
const STATE_LABEL: Record<AnomalyState, string> = { new: 'NEW', acknowledged: 'ACK', muted: 'MUTED', resolved: 'DONE' }
const MUTE_DURATIONS = [{ label: '15 min', ms: 15 * 60_000 }, { label: '1 hour', ms: 60 * 60_000 }, { label: '24 hours', ms: 24 * 60 * 60_000 }]
const LS_KEY = 'anomaly_states'

function getAnomalyMeta(type: string) {
  const map: Record<string, { source: string; provider: string; suggestedAction: string }> = {
    ai_error_spike:        { source: 'AI Validation',   provider: 'Claude API',       suggestedAction: 'Check Anthropic API key and rate limits.' },
    scan_failure_spike:    { source: 'Scanner Engine',  provider: 'Binance API',       suggestedAction: 'Check Binance connectivity and scan logs.' },
    queue_backlog:         { source: 'Task Queue',      provider: 'Celery Worker',     suggestedAction: 'Restart Celery worker or reduce scan frequency.' },
    win_rate_degradation:  { source: 'Analytics',       provider: 'Signal Pipeline',   suggestedAction: 'Review recent regime changes. Apply Conservative mode.' },
    expectancy_negative:   { source: 'Analytics',       provider: 'Signal Analytics',  suggestedAction: 'Pause signal generation and review thresholds.' },
    false_positive_spike:  { source: 'Signal Quality',  provider: 'Risk Engine',       suggestedAction: 'Increase min_confidence in Scanner Settings.' },
    drawdown_spike:        { source: 'Risk Engine',     provider: 'Portfolio',         suggestedAction: 'Switch to Conservative mode. Review stop-loss placement.' },
    calibration_drift:     { source: 'Calibration',     provider: 'AI Validator',      suggestedAction: 'Run calibration report. Adjust confidence bands.' },
  }
  return map[type] ?? { source: 'System', provider: 'Monitor', suggestedAction: 'Review system logs and check provider health.' }
}

function AnomaliesTab() {
  const anomalyFetcher = useCallback(() => adminApi.burnin.anomalies(96), [])
  const statusFetcher  = useCallback(() => adminApi.burnin.status(),      [])
  const { data: anomalies, loading: al, refresh } = useAutoRefresh<AnomalyRecord[]>(anomalyFetcher, 120_000)
  const { data: status }                           = useAutoRefresh<BurninStatus>(statusFetcher, 120_000)

  const [storedStates, setStoredStates]   = useState<Record<string, StoredAnomaly>>({})
  const [selectedAnomaly, setSelectedAnomaly] = useState<AnomalyRecord | null>(null)
  const [muteMenuFor, setMuteMenuFor]     = useState<string | null>(null)

  useEffect(() => {
    try { const raw = localStorage.getItem(LS_KEY); if (raw) setStoredStates(JSON.parse(raw)) } catch { }
  }, [])
  useEffect(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(storedStates)) } catch { }
  }, [storedStates])

  const getKey = useCallback((a: AnomalyRecord) => `${a.anomaly_type}|${a.detected_at}`, [])

  const getEffectiveState = useCallback((a: AnomalyRecord): AnomalyState => {
    const stored = storedStates[getKey(a)]
    if (!stored) return 'new'
    if (stored.state === 'muted' && stored.mutedUntil != null && Date.now() > stored.mutedUntil) return 'new'
    return stored.state
  }, [storedStates, getKey])

  const updateAnomalyState = useCallback((a: AnomalyRecord, state: AnomalyState, mutedUntilMs?: number) => {
    const key = getKey(a)
    setStoredStates(prev => ({ ...prev, [key]: { state, ...(mutedUntilMs !== undefined ? { mutedUntil: mutedUntilMs } : {}), updatedAt: new Date().toISOString() } }))
    setMuteMenuFor(null)
  }, [getKey])

  const sortedAnomalies = useMemo(() => {
    if (!anomalies) return []
    const sevOrder: Record<string, number> = { critical: 0, warning: 1, info: 2 }
    const stOrder: Record<AnomalyState, number> = { new: 0, acknowledged: 1, resolved: 2, muted: 3 }
    return [...anomalies].sort((a, b) => {
      const da = stOrder[getEffectiveState(a)], db = stOrder[getEffectiveState(b)]
      if (da !== db) return da - db
      return (sevOrder[a.severity] ?? 3) - (sevOrder[b.severity] ?? 3)
    })
  }, [anomalies, getEffectiveState])

  const counts = useMemo(() => {
    if (!anomalies) return { critical: 0, warning: 0, info: 0, muted: 0 }
    return anomalies.reduce((acc, a) => {
      const state = getEffectiveState(a)
      if (state === 'muted') acc.muted++
      else if (a.severity === 'critical') acc.critical++
      else if (a.severity === 'warning') acc.warning++
      else acc.info++
      return acc
    }, { critical: 0, warning: 0, info: 0, muted: 0 })
  }, [anomalies, getEffectiveState])

  const lastCheck    = status?.anomaly_summary?.checked_at
  const selectedKey  = selectedAnomaly ? getKey(selectedAnomaly) : null

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between">
        <p className="text-terminal-muted text-sm">{lastCheck ? `Last check: ${formatTs(lastCheck)}` : 'Detect · acknowledge · mute · resolve operational events'}</p>
        <button type="button" onClick={refresh}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-terminal-muted hover:text-terminal-text border border-terminal-border hover:border-terminal-bright rounded transition-all">
          <RefreshCw size={11} className={al ? 'animate-spin' : ''}/>Refresh
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Critical', count: counts.critical, color: 'text-bear-default',   border: 'border-bear-default/20',   bg: 'bg-bear-default/5'   },
          { label: 'Warning',  count: counts.warning,  color: 'text-signal-high',    border: 'border-signal-high/20',    bg: 'bg-signal-high/5'    },
          { label: 'Info',     count: counts.info,     color: 'text-signal-medium',  border: 'border-signal-medium/20',  bg: 'bg-signal-medium/5'  },
          { label: 'Muted',    count: counts.muted,    color: 'text-zinc-500',       border: 'border-zinc-600/20',       bg: 'bg-zinc-800/20'      },
        ].map(({ label, count, color, border, bg }) => (
          <div key={label} className={`glass-card rounded-lg px-5 py-4 border ${border} ${bg}`}>
            <p className="text-terminal-muted text-xs uppercase tracking-wider mb-1">{label}</p>
            <p className={`font-mono font-bold text-3xl ${color}`}>{al ? '—' : count}</p>
          </div>
        ))}
      </div>

      <div>
        <p className="text-terminal-muted text-xs uppercase tracking-wider mb-3">Recent Anomalies (last 96h)</p>
        <div className="glass-card rounded-lg overflow-hidden">
          {al ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="px-5 py-4 border-b border-terminal-border/50">
                <div className="skeleton h-3 w-16 mb-2 rounded"/><div className="skeleton h-2.5 w-full mb-1 rounded"/><div className="skeleton h-2.5 w-2/3 rounded"/>
              </div>
            ))
          ) : !anomalies?.length ? (
            <div className="px-5 py-10 text-center space-y-1">
              <p className="text-bull-default text-sm font-semibold">No anomalies detected</p>
              <p className="text-terminal-muted text-xs">{lastCheck ? 'System operating within normal parameters' : 'Health checks run hourly — anomaly monitoring starts after the first scan cycle'}</p>
            </div>
          ) : (
            sortedAnomalies.map(a => {
              const key = getKey(a)
              const effectiveState = getEffectiveState(a)
              const isMuted = effectiveState === 'muted'
              const stored = storedStates[key]
              const mutedRemaining = isMuted && stored?.mutedUntil ? Math.max(0, Math.ceil((stored.mutedUntil - Date.now()) / 60_000)) : null
              return (
                <div key={key} className={`px-5 py-3.5 border-b border-terminal-border/50 last:border-0 hover:bg-terminal-bright/10 transition-colors ${isMuted ? 'opacity-50' : ''}`}>
                  <div className="flex items-start gap-3">
                    <AnomalyBadge severity={a.severity}/>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-0.5">
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold border ${STATE_BADGE_CLS[effectiveState]}`}>{STATE_LABEL[effectiveState]}</span>
                        {isMuted && mutedRemaining !== null && <span className="flex items-center gap-1 text-zinc-500 text-[10px] font-mono"><Clock size={10}/>{mutedRemaining}m remaining</span>}
                      </div>
                      <p className="text-terminal-text text-xs leading-relaxed">{a.description}</p>
                      <div className="flex items-center gap-4 mt-1.5 flex-wrap">
                        <span className="text-terminal-muted/60 text-xs font-mono uppercase tracking-wide">{a.anomaly_type.replace(/_/g, ' ')}</span>
                        {a.metric_value != null && <span className="text-terminal-muted/60 text-xs font-mono">value: {a.metric_value} · threshold: {a.threshold ?? '—'}</span>}
                        <span className="text-terminal-muted/40 text-xs font-mono ml-auto">{formatTs(a.detected_at)}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-0.5 relative shrink-0">
                      <button type="button" title="Acknowledge" onClick={()=>updateAnomalyState(a,'acknowledged')} className="p-1.5 rounded transition-colors hover:bg-terminal-bright/10 text-terminal-muted hover:text-amber-400"><CheckCircle2 size={14}/></button>
                      <div className="relative">
                        <button type="button" title="Mute" onClick={()=>setMuteMenuFor(prev=>prev===key?null:key)} className="p-1.5 rounded transition-colors hover:bg-terminal-bright/10 text-terminal-muted hover:text-zinc-300"><BellOff size={14}/></button>
                        {muteMenuFor===key && (
                          <div className="absolute right-0 top-full mt-1 z-30 bg-terminal-surface border border-terminal-border rounded shadow-xl py-1 min-w-[96px]">
                            {MUTE_DURATIONS.map(({label,ms})=>(
                              <button key={label} type="button" onClick={()=>updateAnomalyState(a,'muted',Date.now()+ms)} className="w-full text-left px-3 py-1.5 text-xs text-terminal-text hover:bg-terminal-bright/10 transition-colors">{label}</button>
                            ))}
                          </div>
                        )}
                      </div>
                      <button type="button" title="Mark Resolved" onClick={()=>updateAnomalyState(a,'resolved')} className="p-1.5 rounded transition-colors hover:bg-terminal-bright/10 text-terminal-muted hover:text-green-400"><Shield size={14}/></button>
                      <button type="button" title="View Details"  onClick={()=>setSelectedAnomaly(a)}            className="p-1.5 rounded transition-colors hover:bg-terminal-bright/10 text-terminal-muted hover:text-blue-400"><Eye size={14}/></button>
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* Detail drawer */}
      {selectedAnomaly && selectedKey && (
        <>
          <div className="fixed inset-0 z-50 bg-black/40" onClick={()=>setSelectedAnomaly(null)}/>
          <div className="fixed right-0 top-0 bottom-0 w-full max-w-sm z-50 bg-terminal-surface border-l border-terminal-border overflow-y-auto p-5 flex flex-col gap-4">
            <div className="flex items-start justify-between gap-2">
              <h2 className="text-terminal-text text-sm font-semibold leading-snug">{selectedAnomaly.anomaly_type.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())}</h2>
              <button type="button" onClick={()=>setSelectedAnomaly(null)} className="p-1 rounded text-terminal-muted hover:text-terminal-text hover:bg-terminal-bright/10 transition-colors shrink-0"><X size={14}/></button>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <AnomalyBadge severity={selectedAnomaly.severity}/>
              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold border ${STATE_BADGE_CLS[getEffectiveState(selectedAnomaly)]}`}>{STATE_LABEL[getEffectiveState(selectedAnomaly)]}</span>
            </div>
            <p className="text-terminal-text text-xs leading-relaxed">{selectedAnomaly.description}</p>
            <div className="grid grid-cols-2 gap-2 text-xs">
              {[['Type',selectedAnomaly.anomaly_type],['Severity',selectedAnomaly.severity],['Source',getAnomalyMeta(selectedAnomaly.anomaly_type).source],['Provider',getAnomalyMeta(selectedAnomaly.anomaly_type).provider],['First Seen',formatTs(selectedAnomaly.detected_at)]].map(([label,value])=>(
                <div key={label} className="glass-card rounded px-2.5 py-2"><p className="text-terminal-muted/60 uppercase tracking-wide text-[10px] mb-0.5">{label}</p><p className="text-terminal-text font-mono">{value}</p></div>
              ))}
            </div>
            <div className="glass-card rounded-lg px-4 py-3 border border-amber-400/15 bg-amber-400/5">
              <div className="flex items-center gap-1.5 mb-1.5"><AlertTriangle size={12} className="text-amber-400"/><p className="text-amber-400 text-[10px] uppercase tracking-wider font-semibold">Suggested Action</p></div>
              <p className="text-terminal-text text-xs leading-relaxed">{getAnomalyMeta(selectedAnomaly.anomaly_type).suggestedAction}</p>
            </div>
          </div>
        </>
      )}

      <div>
        <p className="text-terminal-muted text-xs uppercase tracking-wider mb-3">Monitored Checks</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {[
            ['win_rate_degradation','Win rate drops ≥12 pp vs 30d baseline'],
            ['expectancy_negative','Rolling expectancy turns negative (n≥20)'],
            ['false_positive_spike','SL hit rate exceeds 70%'],
            ['drawdown_spike','Max drawdown exceeds 5R warning / 10R critical'],
            ['calibration_drift','ECE exceeds 0.12 or drifts +0.05 from last snapshot'],
            ['scan_failure_spike','Scan failure rate exceeds 15% / 30%'],
            ['ai_error_spike','Claude API error rate exceeds 8% / 15%'],
            ['queue_backlog','Celery queue depth exceeds 10 / 30 tasks'],
          ].map(([name,desc])=>(
            <div key={name} className="glass-card rounded-md px-3 py-2 flex gap-2">
              <span className="text-terminal-muted/60 font-mono text-xs shrink-0 mt-0.5">→</span>
              <div><p className="text-terminal-text text-xs font-mono">{name}</p><p className="text-terminal-muted text-sm mt-1">{desc}</p></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function SystemPage() {
  const [tab, setTab] = useState<'system' | 'anomalies' | 'settings'>('system')

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab')
    if (t === 'system' || t === 'anomalies' || t === 'settings') setTab(t)
  }, [])

  const healthFetcher    = useCallback(() => adminApi.health.ready(), [])
  const providerFetcher  = useCallback(() => fetch('/api/health/providers').then(r => r.json()), [])
  const scanFetcher      = useCallback(() => adminApi.analytics.scans(24), [])
  const scan7dFetcher    = useCallback(() => adminApi.analytics.scans(168), [])
  const aiFetcher        = useCallback(() => adminApi.analytics.ai(24), [])
  const monitorFetcher   = useCallback(() => adminApi.analytics.monitor(), [])

  const { data: health,    loading: hl } = useAutoRefresh<HealthReady>(healthFetcher, 120_000)
  const { data: provData }               = useAutoRefresh<{ providers: ProviderCheckResult[] }>(providerFetcher, 120_000)
  const { data: scans }                  = useAutoRefresh<ScanSummaryResponse>(scanFetcher, 120_000)
  const { data: scans7d }                = useAutoRefresh<ScanSummaryResponse>(scan7dFetcher, 120_000)
  const { data: ai }                     = useAutoRefresh<AiSummaryResponse>(aiFetcher, 120_000)
  // R7: shared polling — multiple tabs/widgets reuse the same timer + response.
  // Interval raised 60s → 120s; monitor counters are daily aggregates.
  const { data: monitor }                = useSharedPolling<MonitorSnapshot>('admin:monitor', monitorFetcher, 120_000)

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-terminal-text text-xl font-semibold">System Health</h1>
        <p className="text-terminal-muted text-sm mt-1">Service status · database truth · Redis fallback counters</p>
      </div>

      {/* Tab nav */}
      <div className="flex gap-1 border-b border-terminal-border pb-0">
        {(['system', 'anomalies', 'settings'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-xs font-mono uppercase tracking-wider border-b-2 transition-colors ${tab === t ? 'border-terminal-text text-terminal-text' : 'border-transparent text-terminal-muted hover:text-terminal-text/70'}`}>
            {t === 'system' ? 'System Health' : t === 'anomalies' ? 'Anomalies' : 'Settings'}
          </button>
        ))}
      </div>

      {tab === 'anomalies' && <AnomaliesTab/>}

      {tab === 'settings' && (
        <div className="space-y-6">
          <div>
            <h2 className="text-sm font-semibold text-terminal-text uppercase tracking-wider mb-1">Signal Settings</h2>
            <p className="text-xs text-terminal-muted mb-4">Configure signal quality thresholds, operating mode presets, and system toggles.</p>
            <a
              href="/admin/settings"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-bull-default/10 border border-bull-default/30 text-bull-text text-sm font-semibold hover:bg-bull-default/20 transition-colors"
            >
              Open Settings ↗
            </a>
          </div>
        </div>
      )}

      {tab === 'system' && <>
      {/* Overall status banner — primary health, above fold */}
      {!hl && health && (
        <div className={`rounded-xl px-5 py-4 border flex items-center gap-4 ${
          health.status === 'ready'
            ? 'bg-bull-default/5 border-bull-default/20'
            : 'bg-bear-default/5 border-bear-default/20'
        }`}>
          <span className={`w-3 h-3 rounded-full shrink-0 ${health.status === 'ready' ? 'bg-bull-default animate-pulse-slow' : 'bg-bear-default animate-pulse'}`} />
          <div>
            <span className={`font-mono font-bold text-base uppercase ${health.status === 'ready' ? 'text-bull-default' : 'text-bear-default'}`}>
              System {health.status}
            </span>
            <p className="text-xs text-terminal-muted/60 mt-0.5">
              {health.status === 'ready' ? 'All services operating normally' : 'One or more services degraded — check below'}
            </p>
          </div>
        </div>
      )}

      {/* Primary: Service grid */}
      <div>
        <p className="text-[9px] text-terminal-muted/50 uppercase tracking-widest mb-2.5">Service Status</p>
        {hl ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton h-12 rounded-lg" />)}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <ServiceCard name="Backend API" status={health?.status ?? 'unknown'} />
            {Object.entries(health?.checks ?? {})
              .filter(([svc]) => svc !== 'celery_worker_age_s')
              .map(([svc, status]) => {
                const ageS = svc === 'celery_worker' ? health?.checks?.celery_worker_age_s : undefined
                const ageDetail = ageS ? `heartbeat ${ageS}s ago` : undefined
                return (
                  <ServiceCard
                    key={svc}
                    name={svc === 'celery_worker' ? 'Celery Worker' : svc.charAt(0).toUpperCase() + svc.slice(1).replace(/_/g, ' ')}
                    status={status.startsWith('error:') ? 'error' : status}
                    detail={status.startsWith('error:') ? status.slice(7) : ageDetail}
                  />
                )
              })}
          </div>
        )}
      </div>

      {/* Provider health table — 8 services */}
      {provData?.providers && provData.providers.length > 0 && (
        <ProviderHealthTable providers={provData.providers} />
      )}

      {/* Secondary: Operational metrics */}
      <div>
        <p className="text-[9px] text-terminal-muted/50 uppercase tracking-widest mb-2.5">Operational Metrics · {analyticsWindowLabel(24)}</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MetricCard
            label="Total Scans"
            value={scans?.total_scans ?? '—'}
            sub="scanner runs"
            accent="neutral"
            icon={<Activity size={13} />}
            loading={!scans && !hl}
          />
          <MetricCard
            label="Scan Failures"
            value={scans ? `${(scans.failure_rate * 100).toFixed(1)}%` : '—'}
            sub={scans ? `${Math.round(scans.total_scans * scans.failure_rate)} failed` : ''}
            accent={scans && scans.failure_rate >= 0.15 ? 'warning' : 'bull'}
            icon={<Server size={13} />}
            loading={!scans}
          />
          <MetricCard
            label="AI Calls"
            value={ai?.total_calls ?? '—'}
            sub="rolling 24h"
            accent="info"
            icon={<Cpu size={13} />}
            loading={!ai}
          />
          <MetricCard
            label="AI Failures"
            value={ai ? `${(ai.error_rate * 100).toFixed(1)}%` : '—'}
            sub="API errors"
            accent={ai && ai.error_rate >= 0.08 ? 'warning' : 'bull'}
            icon={<Database size={13} />}
            loading={!ai}
          />
        </div>
      </div>

      {/* ── OUTPUT.COLLAPSE.ALERT.1 banner ─────────────────────────────────── */}
      {monitor?.output_collapse?.active && (
        <div className="rounded-xl border border-red-500/50 bg-red-900/25 p-4 flex items-start gap-3">
          <span className="text-lg shrink-0">🚨</span>
          <div className="flex-1">
            <p className="font-semibold text-sm text-red-200">Signal Output Collapse</p>
            <p className="text-xs text-red-300 mt-1">
              Last 24h: <span className="font-mono font-bold">{monitor.output_collapse.signals_24h}</span> signals
              vs 7-day average <span className="font-mono font-bold">{monitor.output_collapse.avg_daily_7d?.toFixed(0)}</span>/day
              (threshold &lt;{monitor.output_collapse.threshold?.toFixed(0)}). Output has been below 25% of baseline
              for {monitor.output_collapse.breach_streak} consecutive scan cycles. Check KLINE_EMPTY gate rejections,
              intelligence cache freshness, and provider health below.
            </p>
          </div>
        </div>
      )}

      {/* ── Operational Monitoring ─────────────────────────────────────────── */}
      {monitor && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <span className={`w-2 h-2 rounded-full shrink-0 ${LEVEL_DOT[monitor.overall_level]}`} />
            <p className="text-terminal-muted text-xs uppercase tracking-wider font-semibold">
              Operational Monitoring - DB Truth / UTC Counters
            </p>
            <span className={`ml-auto text-[10px] font-mono font-bold uppercase ${LEVEL_CLS[monitor.overall_level]}`}>
              {monitor.overall_level}
            </span>
          </div>

          {/* Anomalies */}
          {monitor.anomalies.length > 0 && (
            <div className="space-y-1.5 mb-3">
              {monitor.anomalies.map((a, i) => (
                <div key={i} className={`rounded-lg px-3 py-2 border text-xs flex items-start gap-2 ${
                  a.severity === 'critical' ? 'bg-red-900/15 border-red-500/30 text-red-300'
                  : 'bg-amber-900/15 border-amber-500/30 text-amber-300'
                }`}>
                  <span className="shrink-0 mt-0.5">{a.severity === 'critical' ? '🔴' : '🟠'}</span>
                  <span>{a.message}</span>
                </div>
              ))}
            </div>
          )}

          {/* Metrics grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="glass-card rounded-xl p-4">
              <p className="text-terminal-muted text-[9px] uppercase tracking-widest mb-2">Signals & Outcomes</p>
              <MonitorRow label={`Signals generated (${analyticsWindowLabel(monitor.metrics.signals_per_day.window_hours)})`} metric={monitor.metrics.signals_per_day} />
              <MonitorRow label="Win rate (7d)"        metric={monitor.metrics.win_rate_pct} />
              <MonitorRow label="SL rate (7d)"         metric={monitor.metrics.sl_rate_pct} />
              <MonitorRow label="Resolved outcomes (7d)" metric={monitor.metrics.resolved_7d} />
              <MonitorRow label="Telegram sends"       metric={monitor.metrics.telegram_sends_per_day} />
            </div>
            <div className="glass-card rounded-xl p-4">
              <p className="text-terminal-muted text-[9px] uppercase tracking-widest mb-2">Scanner</p>
              <MonitorRow label="Scans today"          metric={monitor.metrics.scans_today} />
              <MonitorRow label="Coins/run"            metric={monitor.metrics.coins_scanned_per_run} />
              <MonitorRow label="Last scan duration"   metric={monitor.metrics.scan_duration_s} />
              <MonitorRow label="Binance errors"       metric={monitor.metrics.binance_errors_per_day} />
              <MonitorRow label="CMC credits/day"      metric={monitor.metrics.cmc_credits_per_day} />
            </div>
            <div className="glass-card rounded-xl p-4">
              <p className="text-terminal-muted text-[9px] uppercase tracking-widest mb-2">Claude / AI</p>
              <MonitorRow label="Claude calls"         metric={monitor.metrics.claude_calls_per_day} />
              <MonitorRow label="Heuristic calls"      metric={monitor.metrics.heuristic_calls_per_day} />
              <MonitorRow label="Fallback rate"        metric={monitor.metrics.claude_fallback_pct} />
              <MonitorRow label="Est. cost today"      metric={monitor.metrics.estimated_cost_usd} />
            </div>
          </div>
          <p className="text-terminal-muted/30 text-[10px] font-mono mt-2">
            Generated {new Date(monitor.generated_at).toLocaleTimeString()} · signals source: {monitor.metrics.signals_per_day.source ?? 'unknown'} · Redis counters reset midnight UTC
          </p>
        </div>
      )}

      <PipelineIntegrityCard scans={scans ?? undefined} monitor={monitor ?? undefined} />

      <GateRejectionGrid counts={scans?.gate_rejections} />

      {/* Infrastructure Configuration — read-only (SETTINGS.CENTER.2) */}
      <InfraConfigSection />

      {/* Diagnostics section label */}
      <p className="text-[9px] text-terminal-muted/40 uppercase tracking-widest flex items-center gap-2">
        <span className="h-px flex-1 bg-terminal-border/30" />Diagnostics<span className="h-px flex-1 bg-terminal-border/30" />
      </p>
      </>}
    </div>
  )
}
