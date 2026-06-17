'use client'

import { useCallback, useState, useEffect, useMemo, useRef } from 'react'
import {
  adminApi,
  HealthReady,
  ScanSummaryResponse,
  AiSummaryResponse,
  MonitorSnapshot,
  MonitorLevel,
  AnomalyRecord,
  BurninStatus,
  SettingEntry,
  SettingsData,
  SettingsGroupResponse,
  AuditEntry,
  AuditChangedField,
} from '@/lib/admin-api'
import { useAutoRefresh } from '@/lib/use-auto-refresh'
import { useSharedPolling } from '@/lib/use-shared-polling'
import { MetricCard } from '@/components/admin/metric-card'
import { AnomalyBadge } from '@/components/admin/anomaly-badge'
import { ProviderHealthTable, type ProviderCheckResult } from '@/components/admin/provider-health-table'
import { analyticsWindowLabel } from '@/lib/window-label'
import { formatTs } from '@/lib/utils'
import {
  Server, Database, Cpu, Activity, RefreshCw, CheckCircle2, BellOff, Shield, Eye, X,
  Clock, AlertTriangle, ChevronDown, Lock, Settings2, Save, RotateCcw, AlertCircle,
  History, Play, Square, Zap,
} from 'lucide-react'
import { settingTier, DANGEROUS_FLAGS } from '@/lib/settings-tiers'

// ── Infrastructure Configuration (SETTINGS.CENTER.2) ─────────────────────────

interface InfraConfigRow {
  group: string; key: string; label: string
  value: unknown; description: string; restart: boolean
}

function InfraConfigSection() {
  const [open,    setOpen]    = useState(false)
  const [rows,    setRows]    = useState<InfraConfigRow[] | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)

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
    <div className="glass-card rounded-xl overflow-hidden border border-zinc-800/50">
      <button type="button" onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-zinc-700/5 transition-colors">
        <div className="flex items-center gap-2">
          <Lock size={13} className="text-zinc-500/60" />
          <span className="text-sm font-semibold text-zinc-200">Infrastructure Configuration</span>
          <span className="text-[10px] text-zinc-500/40 font-mono hidden sm:block">· read-only · engineering settings · change via settings API only</span>
        </div>
        <ChevronDown size={14} className={`text-zinc-500/50 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="border-t border-zinc-800/40">
          {loadErr && <p className="px-5 py-4 text-bear-default text-xs">Failed to load: {loadErr}</p>}
          {!loadErr && rows === null && <p className="px-5 py-4 text-zinc-500 text-xs">Loading…</p>}
          {rows !== null && (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-zinc-800">
                  {['Group', 'Setting', 'Value', 'Description'].map(h => (
                    <th key={h} className="text-zinc-500 text-xs uppercase tracking-wider text-left py-2 px-4">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={`${r.group}.${r.key}`} className="border-b border-zinc-800/30">
                    <td className="py-2 px-4 font-mono text-zinc-500/60">{r.group}</td>
                    <td className="py-2 px-4">
                      <p className="text-zinc-200 font-mono">{r.label}</p>
                      <p className="text-zinc-500/40 font-mono text-[10px]">{r.key}{r.restart ? ' · ↻ restart' : ''}</p>
                    </td>
                    <td className="py-2 px-4 font-mono text-zinc-200">{String(r.value)}</td>
                    <td className="py-2 px-4 text-zinc-500/60 hidden md:table-cell">{r.description}</td>
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
  const isOk       = ['ok', 'ready', 'not_configured', 'HEALTHY'].includes(status)
  const isDegraded = status === 'DEGRADED'
  const dotCls  = !isConfigured ? 'bg-zinc-500/40'
    : isDegraded ? 'bg-amber-400 animate-pulse'
    : isOk ? 'bg-bull-default' : 'bg-bear-default animate-pulse'
  const borderCls = !isConfigured ? 'border-zinc-800'
    : isDegraded ? 'border-amber-500/20'
    : isOk ? 'border-bull-default/20' : 'border-bear-default/20'
  const textCls = !isConfigured ? 'text-zinc-500/60'
    : isDegraded ? 'text-amber-400'
    : isOk ? 'text-bull-default' : 'text-bear-default'
  return (
    <div className={`glass-card rounded-lg px-4 py-3.5 border ${borderCls}`}>
      <div className="flex items-center gap-2.5">
        <span className={`w-2 h-2 rounded-full shrink-0 ${dotCls}`} />
        <span className="text-zinc-200 text-sm font-medium">{name}</span>
        <span className={`ml-auto font-mono text-xs font-bold uppercase ${textCls}`}>
          {status.replace(/_/g, ' ')}
        </span>
      </div>
      {detail && <p className="text-zinc-500/50 text-xs font-mono mt-1 ml-4.5 pl-0">{detail}</p>}
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
    <div className="flex items-center justify-between py-1.5 border-b border-zinc-800/15 last:border-0">
      <span className="text-zinc-500 text-xs">{label}</span>
      <span className={`font-mono text-xs font-semibold ${LEVEL_CLS[metric.level]}`}>
        {metric.value.toLocaleString()}{metric.unit && ` ${metric.unit}`}
      </span>
    </div>
  )
}

// ── Pipeline Integrity card ───────────────────────────────────────────────────

const PIPELINE_CANON_KEYS = [
  'BTC_DOWN_BUY', 'TOXIC_DENYLIST', 'SIGNAL_COOLDOWN', 'CONFIDENCE_REJECTION',
  'CMC_REJECTION', 'REGIME_REJECTION', 'MTF_REJECTION', 'VOLATILITY_REJECTION',
  'TREND_STRENGTH_REJECTION', 'SETUP_REJECTION', 'RR_REJECTION', 'RISK_REJECTION',
]

function PipelineRow({ label, value, sub, ok }: { label: string; value: string; sub: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-zinc-800/15 last:border-0">
      <div className="flex items-center gap-1.5">
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${ok ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'}`} />
        <span className="text-zinc-500 text-xs">{label}</span>
      </div>
      <div className="text-right">
        <span className="font-mono text-xs font-semibold text-zinc-200">{value}</span>
        {sub && <span className="text-zinc-500/40 text-[10px] ml-1.5">{sub}</span>}
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

  let score = 95
  if (gatesPct < 100) score = Math.max(85, score - Math.round((100 - gatesPct) * 0.15))
  if (resolved7d === 0 && signals24h > 5) score -= 3

  const scoreColor = score >= 95 ? 'text-emerald-400' : score >= 90 ? 'text-amber-400' : 'text-red-400'
  const borderCls  = score >= 95 ? 'border-emerald-500/20' : score >= 90 ? 'border-amber-500/20' : 'border-red-500/20'
  const statusText = score >= 95 ? 'All pipeline stages hardened' : score >= 90 ? 'Minor live gaps detected' : 'Pipeline health degraded'

  return (
    <div className="glass-card rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-zinc-500 text-[10px] uppercase tracking-wide">Pipeline Integrity · HARDENING.1</p>
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

const GATE_REJECTION_LABELS: Record<string, string> = {
  BTC_DOWN_BUY:          'BTC-down BUY',
  TOXIC_DENYLIST:        'Toxic denylist',
  SIGNAL_COOLDOWN:       '4h cooldown',
  CONFIDENCE_REJECTION:  'Confidence',
  CMC_REJECTION:         'CMC filter',
  REGIME_REJECTION:      'Regime',
  CONTRA_REGIME_REJECTION: 'Contra-regime v2',
  KLINE_EMPTY:           'Kline empty',
  KLINE_PARTIAL:         'Kline partial',
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
      <p className="text-zinc-500 text-[10px] uppercase tracking-wide mb-2">
        Gate Rejections - {analyticsWindowLabel(24)}
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {keys.map((key) => (
          <div key={key} className="rounded-lg border border-zinc-800/30 px-3 py-2">
            <p className="text-zinc-500/70 text-[10px]">{GATE_REJECTION_LABELS[key]}</p>
            <p className="text-zinc-200 font-mono font-semibold text-sm">{counts?.[key] ?? 0}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Founder Operations interfaces + helpers ───────────────────────────────────

interface CeleryStatus {
  enabled: boolean; scanning: boolean; running_modes: string[]; last_scan_at: number | null
  next_scan_at?: Record<string, number | null>; is_overdue?: boolean
}
interface SystemOpsFlags {
  emergency_stop: boolean; maintenance_mode: boolean
  ai_enabled: boolean; telegram_enabled: boolean
}

function sODot(level: 'green' | 'amber' | 'red' | 'neutral') {
  return level === 'green' ? 'bg-emerald-400' : level === 'amber' ? 'bg-amber-400 animate-pulse' : level === 'red' ? 'bg-red-400 animate-pulse' : 'bg-zinc-600'
}
function sOTxt(level: 'green' | 'amber' | 'red' | 'neutral') {
  return level === 'green' ? 'text-emerald-400' : level === 'amber' ? 'text-amber-400' : level === 'red' ? 'text-red-400' : 'text-zinc-200'
}

// Flag categorization for Feature Flags section (SIGNAL.QUALITY.AUDIT.3)
// tier 'quality' = direct trading/signal impact, always visible
// tier 'operational' = system controls, visible
// tier 'advanced' = background jobs / analytics only, collapsed by default
const FLAG_META: Record<string, {
  tier: 'quality' | 'operational' | 'advanced'
  p0?: boolean
  recommendedState?: boolean
  p0Note?: string
}> = {
  high_confidence_mode_enabled:       { tier: 'quality',     p0: true, recommendedState: false, p0Note: '0/9 wins last 7D · disable to stop active losses' },
  regime_hard_gate_v2:                { tier: 'quality',     p0: true, recommendedState: true,  p0Note: 'Contra-regime BUY: 19% WR, −0.405R · enable hard gate' },
  early_breakout_penalty_v1:          { tier: 'quality',     p0: true, recommendedState: true,  p0Note: 'BUY+EARLY_BREAKOUT unpenalized · enable −8 setup score' },
  probability_gate_v1:                { tier: 'quality',     p0: true, recommendedState: true,  p0Note: '2/3 live signals in WR<40% cohorts · enable Telegram gate' },
  riskgrade_v2:                       { tier: 'quality',     p0: true, recommendedState: true,  p0Note: 'Heuristic grades inverted (Grade A < Grade C) · enable empirical grades' },
  futures_intelligence:               { tier: 'quality' },
  probability_gate_expectancy_filter: { tier: 'quality' },
  ai_validation:                      { tier: 'operational' },
  telegram:                           { tier: 'operational' },
  emergency_stop:                     { tier: 'operational' },
  maintenance_mode:                   { tier: 'operational' },
  anomaly_detection:                  { tier: 'operational' },
  output_collapse_alert:              { tier: 'operational' },
  paper_trading_monitor:              { tier: 'advanced' },
  backtesting:                        { tier: 'advanced' },
  daily_analytics_snapshot:           { tier: 'advanced' },
  rate_limiting:                      { tier: 'advanced' },
  confidence_calibration_v2:          { tier: 'advanced' },
  attribution_snapshots:              { tier: 'advanced' },
}

// ── System Diagnostics Accordion ─────────────────────────────────────────────

function AdvancedOperationsAccordion({
  providers, scans, monitor,
}: {
  providers: ProviderCheckResult[] | null
  scans: ScanSummaryResponse | null
  monitor: MonitorSnapshot | null
}) {
  const [open, setOpen] = useState(false)

  return (
    <div className="glass-card rounded-xl overflow-hidden border border-zinc-800/50">
      <button type="button" onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-zinc-700/5 transition-colors">
        <div className="flex items-center gap-2">
          <Settings2 size={13} className="text-zinc-500/60" />
          <span className="text-sm font-semibold text-zinc-200">System Diagnostics</span>
          <span className="text-[10px] text-zinc-500/40 font-mono hidden sm:block">· provider health · queue metrics · gate analysis · infra config</span>
        </div>
        <ChevronDown size={14} className={`text-zinc-500/50 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="border-t border-zinc-800/40 p-5 space-y-6">

          {/* Provider Diagnostics */}
          {providers && providers.length > 0 && (
            <div>
              <p className="text-[10px] text-zinc-500/50 uppercase tracking-wide mb-3">Provider Diagnostics</p>
              <ProviderHealthTable providers={providers} />
            </div>
          )}

          {/* Queue & Scanner Diagnostics */}
          {monitor && (
            <div>
              <p className="text-[10px] text-zinc-500/50 uppercase tracking-wide mb-3">Queue & Scanner Diagnostics</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {([
                  { label: 'Scans Today',   val: monitor.metrics.scans_today.value,             lvl: monitor.metrics.scans_today.level },
                  { label: 'Last Scan',     val: `${monitor.metrics.scan_duration_s.value}s`,   lvl: monitor.metrics.scan_duration_s.level },
                  { label: 'Binance Err',   val: monitor.metrics.binance_errors_per_day.value,  lvl: monitor.metrics.binance_errors_per_day.level },
                  { label: 'CMC Credits',   val: monitor.metrics.cmc_credits_per_day.value,     lvl: monitor.metrics.cmc_credits_per_day.level },
                  { label: 'Tg Sends',      val: monitor.metrics.telegram_sends_per_day.value,  lvl: monitor.metrics.telegram_sends_per_day.level },
                  { label: 'Claude Calls',  val: monitor.metrics.claude_calls_per_day.value,    lvl: monitor.metrics.claude_calls_per_day.level },
                  { label: 'Heuristic',     val: monitor.metrics.heuristic_calls_per_day.value, lvl: monitor.metrics.heuristic_calls_per_day.level },
                  { label: 'AI Fallback',   val: `${monitor.metrics.claude_fallback_pct.value}%`, lvl: monitor.metrics.claude_fallback_pct.level },
                ] as { label: string; val: number | string; lvl: MonitorLevel }[]).map(({ label, val, lvl }) => (
                  <div key={label} className="glass-card rounded-lg px-3 py-2.5">
                    <p className="text-[10px] text-zinc-500/55 uppercase tracking-wider mb-1">{label}</p>
                    <p className={`text-sm font-mono font-semibold ${LEVEL_CLS[lvl]}`}>{val}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Gate Rejection Diagnostics */}
          {scans && (
            <div>
              <p className="text-[10px] text-zinc-500/50 uppercase tracking-wide mb-3">Gate Rejection Diagnostics</p>
              <PipelineIntegrityCard scans={scans} monitor={monitor ?? undefined} />
              <div className="mt-3"><GateRejectionGrid counts={scans.gate_rejections} /></div>
            </div>
          )}

          {/* Redis / Infra Configuration */}
          <div>
            <p className="text-[10px] text-zinc-500/50 uppercase tracking-wide mb-3">Redis & Infrastructure Config</p>
            <InfraConfigSection />
          </div>

        </div>
      )}
    </div>
  )
}

// ── Founder Operations Card (Phase A, B, C) ───────────────────────────────────

function FounderOperationsCard({
  celery, flags, monitor, health,
  onPauseScanner, onPatchFlag, onScanNow,
  scanning, scanDone, opLoading, opError, pausing,
}: {
  celery: CeleryStatus | null
  flags: SystemOpsFlags | null
  monitor: MonitorSnapshot | null
  health: HealthReady | null
  onPauseScanner: () => void
  onPatchFlag: (group: string, key: string, value: boolean) => void
  onScanNow: () => void
  scanning: boolean; scanDone: boolean; opLoading: boolean; opError: string | null; pausing: boolean
}) {
  const signals24h  = monitor?.metrics.signals_per_day.value ?? null
  const queueWorker = health?.checks?.celery_worker as string | undefined
  const queueOk     = queueWorker === 'HEALTHY'
  const queueWarn   = queueWorker === 'DEGRADED'

  const lastScanText = celery?.last_scan_at
    ? (() => {
        const s = Math.floor((Date.now() - celery.last_scan_at * 1000) / 1000)
        if (s < 60) return `${s}s ago`
        if (s < 3600) return `${Math.floor(s / 60)}m ago`
        return `${Math.floor(s / 3600)}h ago`
      })()
    : '—'

  type Lvl = 'green' | 'amber' | 'red' | 'neutral'
  type StatusItem = { label: string; value: string; level: Lvl }

  const items: StatusItem[] = [
    { label: 'Scanner',        value: celery === null ? '…' : celery.scanning ? 'SCANNING' : celery.enabled ? 'ACTIVE' : 'DISABLED', level: celery === null ? 'neutral' : celery.enabled ? 'green' : 'amber'         },
    { label: 'Claude AI',      value: flags  === null ? '…' : flags.ai_enabled ? 'ACTIVE'  : 'DISABLED',                             level: flags  === null ? 'neutral' : flags.ai_enabled ? 'green' : 'amber'        },
    { label: 'Telegram',       value: flags  === null ? '…' : flags.telegram_enabled ? 'ACTIVE' : 'DISABLED',                        level: flags  === null ? 'neutral' : flags.telegram_enabled ? 'green' : 'amber'  },
    { label: 'Emergency Stop', value: flags  === null ? '…' : flags.emergency_stop ? 'ON'   : 'OFF',                                 level: flags  === null ? 'neutral' : flags.emergency_stop ? 'red' : 'green'      },
    { label: 'Maintenance',    value: flags  === null ? '…' : flags.maintenance_mode ? 'ON' : 'OFF',                                 level: flags  === null ? 'neutral' : flags.maintenance_mode ? 'amber' : 'green'  },
    { label: 'Last Scan',      value: lastScanText,                                                                                   level: 'neutral'                                                                   },
    { label: 'Signals (24h)',  value: signals24h !== null ? String(signals24h) : '—',                                                level: 'neutral'                                                                   },
    { label: 'Queue',          value: !queueWorker ? '—' : queueOk ? 'Healthy' : queueWarn ? 'Warning' : 'Offline',                 level: !queueWorker ? 'neutral' : queueOk ? 'green' : queueWarn ? 'amber' : 'red' },
  ]

  const hasCritical = Boolean(flags?.emergency_stop)
  const hasWarning  = flags != null && (!flags.ai_enabled || !flags.telegram_enabled || !celery?.enabled || flags.maintenance_mode)

  return (
    <div className={`rounded-xl border p-5 space-y-5 ${hasCritical ? 'border-red-500/40 bg-red-900/10' : hasWarning ? 'border-amber-500/30 bg-amber-900/5' : 'border-zinc-800/70 bg-zinc-900/30'}`}>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${hasCritical ? 'bg-red-400 animate-pulse' : hasWarning ? 'bg-amber-400 animate-pulse' : 'bg-emerald-400'}`} />
          <p className="text-sm font-semibold text-zinc-200">System Status</p>
        </div>
        <span className={`text-xs font-mono font-bold uppercase ${hasCritical ? 'text-red-400' : hasWarning ? 'text-amber-400' : 'text-emerald-400'}`}>
          {hasCritical ? 'CRITICAL' : hasWarning ? 'WARNING' : 'OPERATIONAL'}
        </span>
      </div>

      {/* Status grid (Phase A) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {items.map(item => (
          <div key={item.label} className="bg-zinc-950/40 rounded-lg px-3 py-2.5 border border-zinc-800/30">
            <p className="text-[10px] text-zinc-500/50 uppercase tracking-wider mb-1.5">{item.label}</p>
            <div className="flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${sODot(item.level)}`} />
              <span className={`font-mono font-bold text-xs ${sOTxt(item.level)}`}>{item.value}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Operational Controls (Phase B + C) */}
      <div>
        <p className="text-[10px] text-zinc-500/50 uppercase tracking-wide mb-2">Operational Controls</p>
        <div className="flex flex-wrap gap-2">

          {/* Run Scan Now (Phase C) */}
          <button onClick={onScanNow}
            disabled={scanning || opLoading || !celery || flags?.emergency_stop || flags?.maintenance_mode}
            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors disabled:opacity-40 ${
              scanDone  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' :
              scanning  ? 'bg-blue-500/10 border-blue-500/30 text-blue-400' :
                          'bg-zinc-950 border-zinc-800 text-zinc-200 hover:border-zinc-700'
            }`}>
            {scanning ? <><RefreshCw size={11} className="animate-spin"/>Scanning…</> :
             scanDone  ? <><CheckCircle2 size={11}/>Done</> :
                         <><Zap size={11}/>Scan Now</>}
          </button>

          {/* Scanner ON/OFF */}
          <button onClick={onPauseScanner}
            disabled={pausing || opLoading || celery === null}
            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors disabled:opacity-40 ${
              celery?.enabled
                ? 'bg-amber-500/10 border-amber-500/30 text-amber-400 hover:bg-amber-500/20'
                : 'bg-zinc-950 border-zinc-800 text-zinc-200 hover:border-zinc-700'
            }`}>
            {celery?.enabled ? <><Square size={11}/>Pause Scanner</> : <><Play size={11}/>Enable Scanner</>}
          </button>

          {/* Claude AI ON/OFF */}
          <button onClick={() => flags && onPatchFlag('ai', 'enabled', !flags.ai_enabled)}
            disabled={opLoading || flags === null}
            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors disabled:opacity-40 ${
              flags?.ai_enabled
                ? 'bg-purple-500/10 border-purple-500/30 text-purple-400 hover:bg-purple-500/20'
                : 'bg-zinc-950 border-zinc-800 text-zinc-500 hover:border-zinc-700'
            }`}>
            <Cpu size={11} />
            Claude AI {flags === null ? '…' : flags.ai_enabled ? 'ON' : 'OFF'}
          </button>

          {/* Telegram ON/OFF */}
          <button onClick={() => flags && onPatchFlag('telegram', 'alerts_enabled', !flags.telegram_enabled)}
            disabled={opLoading || flags === null}
            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors disabled:opacity-40 ${
              flags?.telegram_enabled
                ? 'bg-sky-500/10 border-sky-500/30 text-sky-400 hover:bg-sky-500/20'
                : 'bg-zinc-950 border-zinc-800 text-zinc-500 hover:border-zinc-700'
            }`}>
            <Activity size={11} />
            Telegram {flags === null ? '…' : flags.telegram_enabled ? 'ON' : 'OFF'}
          </button>

          {/* Divider before destructive controls */}
          <div className="w-px bg-zinc-700 self-stretch mx-1" />

          {/* Emergency Stop */}
          <button onClick={() => flags && onPatchFlag('features', 'emergency_stop', !flags.emergency_stop)}
            disabled={opLoading || flags === null}
            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors disabled:opacity-40 ${
              flags?.emergency_stop
                ? 'bg-red-500/20 border-red-500/50 text-red-400 hover:bg-red-500/30'
                : 'bg-zinc-950 border-zinc-800 text-zinc-500/60 hover:border-zinc-700'
            }`}>
            <AlertTriangle size={11} />
            Emergency Stop{flags?.emergency_stop ? ' — ACTIVE' : ''}
          </button>

          {/* Maintenance Mode */}
          <button onClick={() => flags && onPatchFlag('features', 'maintenance_mode', !flags.maintenance_mode)}
            disabled={opLoading || flags === null}
            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors disabled:opacity-40 ${
              flags?.maintenance_mode
                ? 'bg-amber-500/10 border-amber-500/30 text-amber-400 hover:bg-amber-500/20'
                : 'bg-zinc-950 border-zinc-800 text-zinc-500/60 hover:border-zinc-700'
            }`}>
            <Settings2 size={11} />
            Maintenance{flags?.maintenance_mode ? ' — ON' : ''}
          </button>
        </div>
        {opError && <p className="text-xs text-bear-default font-mono mt-2">{opError}</p>}
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

  const lastCheck   = status?.anomaly_summary?.checked_at
  const selectedKey = selectedAnomaly ? getKey(selectedAnomaly) : null

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between">
        <p className="text-zinc-500 text-sm">{lastCheck ? `Last check: ${formatTs(lastCheck)}` : 'Detect · acknowledge · mute · resolve operational events'}</p>
        <button type="button" onClick={refresh}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-zinc-500 hover:text-zinc-200 border border-zinc-800 hover:border-zinc-700 rounded transition-all">
          <RefreshCw size={11} className={al ? 'animate-spin' : ''}/>Refresh
        </button>
      </div>

      {!al && counts.critical + counts.warning + counts.info + counts.muted === 0 ? (
        <div className="glass-card rounded-lg px-5 py-4 border border-zinc-800 flex items-center gap-2.5">
          <span className="w-1.5 h-1.5 rounded-full bg-zinc-600 shrink-0" />
          <p className="text-zinc-500 text-sm">No anomalies · System operating within normal parameters</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Critical', count: counts.critical, color: 'text-bear-default',   border: 'border-bear-default/20',   bg: 'bg-bear-default/5'   },
            { label: 'Warning',  count: counts.warning,  color: 'text-signal-high',    border: 'border-signal-high/20',    bg: 'bg-signal-high/5'    },
            { label: 'Info',     count: counts.info,     color: 'text-signal-medium',  border: 'border-signal-medium/20',  bg: 'bg-signal-medium/5'  },
            { label: 'Muted',    count: counts.muted,    color: 'text-zinc-500',       border: 'border-zinc-600/20',       bg: 'bg-zinc-800/20'      },
          ].map(({ label, count, color, border, bg }) => (
            <div key={label} className={`glass-card rounded-lg px-5 py-4 border ${border} ${bg}`}>
              <p className="text-zinc-500 text-xs mb-1">{label}</p>
              <p className={`font-mono font-bold text-2xl ${color}`}>{al ? '—' : count}</p>
            </div>
          ))}
        </div>
      )}

      <div>
        <p className="text-zinc-500 text-xs uppercase tracking-wider mb-3">Recent Anomalies (last 96h)</p>
        <div className="glass-card rounded-lg overflow-hidden">
          {al ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="px-5 py-4 border-b border-zinc-800/50">
                <div className="skeleton h-3 w-16 mb-2 rounded"/><div className="skeleton h-2.5 w-full mb-1 rounded"/><div className="skeleton h-2.5 w-2/3 rounded"/>
              </div>
            ))
          ) : !anomalies?.length ? (
            <div className="px-5 py-10 text-center space-y-1">
              <p className="text-bull-default text-sm font-semibold">No anomalies detected</p>
              <p className="text-zinc-500 text-xs">{lastCheck ? 'System operating within normal parameters' : 'Health checks run hourly — anomaly monitoring starts after the first scan cycle'}</p>
            </div>
          ) : (
            sortedAnomalies.map(a => {
              const key = getKey(a)
              const effectiveState = getEffectiveState(a)
              const isMuted = effectiveState === 'muted'
              const stored = storedStates[key]
              const mutedRemaining = isMuted && stored?.mutedUntil ? Math.max(0, Math.ceil((stored.mutedUntil - Date.now()) / 60_000)) : null
              return (
                <div key={key} className={`px-5 py-3.5 border-b border-zinc-800/50 last:border-0 hover:bg-zinc-700/10 transition-colors ${isMuted ? 'opacity-50' : ''}`}>
                  <div className="flex items-start gap-3">
                    <AnomalyBadge severity={a.severity}/>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-0.5">
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold border ${STATE_BADGE_CLS[effectiveState]}`}>{STATE_LABEL[effectiveState]}</span>
                        {isMuted && mutedRemaining !== null && <span className="flex items-center gap-1 text-zinc-500 text-[10px] font-mono"><Clock size={10}/>{mutedRemaining}m remaining</span>}
                      </div>
                      <p className="text-zinc-200 text-xs leading-relaxed">{a.description}</p>
                      <div className="flex items-center gap-4 mt-1.5 flex-wrap">
                        <span className="text-zinc-500/60 text-xs font-mono uppercase tracking-wide">{a.anomaly_type.replace(/_/g, ' ')}</span>
                        {a.metric_value != null && <span className="text-zinc-500/60 text-xs font-mono">value: {a.metric_value} · threshold: {a.threshold ?? '—'}</span>}
                        <span className="text-zinc-500/40 text-xs font-mono ml-auto">{formatTs(a.detected_at)}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-0.5 relative shrink-0">
                      <button type="button" title="Acknowledge" onClick={()=>updateAnomalyState(a,'acknowledged')} className="p-1.5 rounded transition-colors hover:bg-zinc-700/10 text-zinc-500 hover:text-amber-400"><CheckCircle2 size={14}/></button>
                      <div className="relative">
                        <button type="button" title="Mute" onClick={()=>setMuteMenuFor(prev=>prev===key?null:key)} className="p-1.5 rounded transition-colors hover:bg-zinc-700/10 text-zinc-500 hover:text-zinc-300"><BellOff size={14}/></button>
                        {muteMenuFor===key && (
                          <div className="absolute right-0 top-full mt-1 z-30 bg-zinc-900 border border-zinc-800 rounded shadow-xl py-1 min-w-[96px]">
                            {MUTE_DURATIONS.map(({label,ms})=>(
                              <button key={label} type="button" onClick={()=>updateAnomalyState(a,'muted',Date.now()+ms)} className="w-full text-left px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-700/10 transition-colors">{label}</button>
                            ))}
                          </div>
                        )}
                      </div>
                      <button type="button" title="Mark Resolved" onClick={()=>updateAnomalyState(a,'resolved')} className="p-1.5 rounded transition-colors hover:bg-zinc-700/10 text-zinc-500 hover:text-green-400"><Shield size={14}/></button>
                      <button type="button" title="View Details"  onClick={()=>setSelectedAnomaly(a)}            className="p-1.5 rounded transition-colors hover:bg-zinc-700/10 text-zinc-500 hover:text-blue-400"><Eye size={14}/></button>
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
          <div className="fixed right-0 top-0 bottom-0 w-full max-w-sm z-50 bg-zinc-900 border-l border-zinc-800 overflow-y-auto p-5 flex flex-col gap-4">
            <div className="flex items-start justify-between gap-2">
              <h2 className="text-zinc-200 text-sm font-semibold leading-snug">{selectedAnomaly.anomaly_type.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())}</h2>
              <button type="button" onClick={()=>setSelectedAnomaly(null)} className="p-1 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-700/10 transition-colors shrink-0"><X size={14}/></button>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <AnomalyBadge severity={selectedAnomaly.severity}/>
              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold border ${STATE_BADGE_CLS[getEffectiveState(selectedAnomaly)]}`}>{STATE_LABEL[getEffectiveState(selectedAnomaly)]}</span>
            </div>
            <p className="text-zinc-200 text-xs leading-relaxed">{selectedAnomaly.description}</p>
            <div className="grid grid-cols-2 gap-2 text-xs">
              {[['Type',selectedAnomaly.anomaly_type],['Severity',selectedAnomaly.severity],['Source',getAnomalyMeta(selectedAnomaly.anomaly_type).source],['Provider',getAnomalyMeta(selectedAnomaly.anomaly_type).provider],['First Seen',formatTs(selectedAnomaly.detected_at)]].map(([label,value])=>(
                <div key={label} className="glass-card rounded px-2.5 py-2"><p className="text-zinc-500/60 uppercase tracking-wide text-[10px] mb-0.5">{label}</p><p className="text-zinc-200 font-mono">{value}</p></div>
              ))}
            </div>
            <div className="glass-card rounded-lg px-4 py-3 border border-amber-400/15 bg-amber-400/5">
              <div className="flex items-center gap-1.5 mb-1.5"><AlertTriangle size={12} className="text-amber-400"/><p className="text-amber-400 text-[10px] uppercase tracking-wider font-semibold">Suggested Action</p></div>
              <p className="text-zinc-200 text-xs leading-relaxed">{getAnomalyMeta(selectedAnomaly.anomaly_type).suggestedAction}</p>
            </div>
          </div>
        </>
      )}

      <div>
        <p className="text-zinc-500 text-xs uppercase tracking-wider mb-3">Monitored Checks</p>
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
              <span className="text-zinc-500/60 font-mono text-xs shrink-0 mt-0.5">→</span>
              <div><p className="text-zinc-200 text-xs font-mono">{name}</p><p className="text-zinc-500 text-sm mt-1">{desc}</p></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Settings tab ──────────────────────────────────────────────────────────────

const SETTINGS_GROUP_LABELS: Record<string, string> = {
  scanner:  'Scanner',
  signals:  'Signal Thresholds',
  ai:       'AI',
  telegram: 'Telegram',
  risk:     'Risk',
  anomaly:  'Anomaly Detection',
  features: 'Feature Flags',
}

const SETTINGS_GROUP_DESCRIPTIONS: Record<string, string> = {
  scanner:  'Scan cadence, coin limits, and confidence thresholds',
  signals:  'Minimum quality bar for signals to pass the pipeline',
  ai:       'Claude Haiku validation model and API parameters',
  telegram: 'Alert delivery and daily summary configuration',
  risk:     'Grade filters, leverage caps, and portfolio risk limits',
  anomaly:  'Burn-in health check thresholds and alert levels',
  features: 'Enable or disable major system capabilities',
}

const HIDDEN_GROUPS = new Set(['paper_trading'])

type WiredState = 'live' | 'floors' | 'display'

const GROUP_WIRED_DEFAULT: Record<string, WiredState> = {
  features: 'live', ai: 'live', telegram: 'live', anomaly: 'live',
  scanner: 'display', signals: 'display', risk: 'display', infra: 'display',
}

const FIELD_WIRED: Record<string, WiredState> = {
  'scanner.trending_watchlist': 'live',
  'scanner.min_confidence':     'floors',
  'scanner.alert_confidence':   'floors',
  'scanner.max_coins_per_run':  'floors',
  'signals.min_rr_ratio':       'floors',
}

function wiredState(group: string, key: string): WiredState {
  return FIELD_WIRED[`${group}.${key}`] ?? GROUP_WIRED_DEFAULT[group] ?? 'display'
}

const RECOMMENDED: Record<string, boolean | number> = {
  'scanner.min_confidence':    85,
  'scanner.alert_confidence':  85,
  'scanner.max_coins_per_run': 80,
  'signals.min_rr_ratio':      2.0,
  'ai.enabled':                true,
  'telegram.alerts_enabled':   true,
}

type ModeId =
  | 'conservative'
  | 'balanced'
  | 'aggressive'
  | 'institutional'
  | 'sniper'
  | 'futures_tactical'
  | 'rotation_hunter'

interface OperatingMode {
  id:          ModeId
  label:       string
  icon:        string
  description: string
  color:       string
  frequency:   number
  riskLevel:   number
  rrExpected:  string
  groups:      Record<string, Record<string, number | boolean>>
}

const OPERATING_MODES: OperatingMode[] = [
  {
    id: 'conservative', label: 'Conservative', icon: '◇', color: '#00d084',
    description: 'High-confluence only · tight risk · ideal for live capital',
    frequency: 2, riskLevel: 1, rrExpected: '2.5+',
    groups: {
      scanner:  { min_confidence: 87, alert_confidence: 92, max_coins_per_run: 50 },
      signals:  { min_rr_ratio: 2.5, min_quality_score: 60 },
      risk:     { max_portfolio_risk_pct: 0.01, reject_f_grade: true },
      telegram: { min_confidence: 90, max_alerts_per_hour: 5 },
      ai:       { temperature: 0.2 },
    },
  },
  {
    id: 'balanced', label: 'Balanced', icon: '◈', color: '#3b82f6',
    description: 'Default production profile · good signal/noise ratio',
    frequency: 3, riskLevel: 2, rrExpected: '2.0+',
    groups: {
      scanner:  { min_confidence: 80, alert_confidence: 85, max_coins_per_run: 100 },
      signals:  { min_rr_ratio: 2.0, min_quality_score: 40 },
      risk:     { max_portfolio_risk_pct: 0.02, reject_f_grade: true },
      telegram: { min_confidence: 85, max_alerts_per_hour: 10 },
      ai:       { temperature: 0.3 },
    },
  },
  {
    id: 'aggressive', label: 'Aggressive', icon: '▲', color: '#f97316',
    description: 'Lower thresholds · high signal volume · research & paper',
    frequency: 5, riskLevel: 4, rrExpected: '1.5+',
    groups: {
      scanner:  { min_confidence: 72, alert_confidence: 78, max_coins_per_run: 100 },
      signals:  { min_rr_ratio: 1.5, min_quality_score: 30 },
      risk:     { max_portfolio_risk_pct: 0.04, reject_f_grade: false },
      telegram: { min_confidence: 78, max_alerts_per_hour: 20 },
      ai:       { temperature: 0.45 },
    },
  },
  {
    id: 'institutional', label: 'Institutional', icon: '⬡', color: '#f59e0b',
    description: 'A-grade only · 3× R:R minimum · for large capital positions',
    frequency: 1, riskLevel: 1, rrExpected: '3.0+',
    groups: {
      scanner:  { min_confidence: 90, alert_confidence: 94, max_coins_per_run: 30 },
      signals:  { min_rr_ratio: 3.0, min_quality_score: 70 },
      risk:     { max_portfolio_risk_pct: 0.01, reject_f_grade: true },
      telegram: { min_confidence: 92, max_alerts_per_hour: 3 },
      ai:       { temperature: 0.15 },
    },
  },
  {
    id: 'sniper', label: 'Sniper', icon: '✦', color: '#a855f7',
    description: 'Ultra-selective · mega/large cap only · maximum conviction',
    frequency: 1, riskLevel: 1, rrExpected: '3.5+',
    groups: {
      scanner:  { min_confidence: 92, alert_confidence: 96, max_coins_per_run: 20 },
      signals:  { min_rr_ratio: 3.5, min_quality_score: 75 },
      risk:     { max_portfolio_risk_pct: 0.005, reject_f_grade: true },
      telegram: { min_confidence: 95, max_alerts_per_hour: 2 },
      ai:       { temperature: 0.1 },
    },
  },
  {
    id: 'futures_tactical', label: 'Futures Tactical', icon: '⚡', color: '#06b6d4',
    description: 'Futures-first · OI + funding rate intelligence active',
    frequency: 3, riskLevel: 3, rrExpected: '2.0+',
    groups: {
      scanner:  { min_confidence: 78, alert_confidence: 82, max_coins_per_run: 100 },
      signals:  { min_rr_ratio: 2.0, min_quality_score: 45 },
      risk:     { max_portfolio_risk_pct: 0.025, reject_f_grade: true },
      telegram: { min_confidence: 82, max_alerts_per_hour: 15 },
      ai:       { temperature: 0.35 },
    },
  },
  {
    id: 'rotation_hunter', label: 'Rotation Hunter', icon: '↺', color: '#14b8a6',
    description: 'Sector rotation detection · momentum-based entry engine',
    frequency: 4, riskLevel: 3, rrExpected: '1.8+',
    groups: {
      scanner:  { min_confidence: 75, alert_confidence: 80, max_coins_per_run: 100 },
      signals:  { min_rr_ratio: 1.8, min_quality_score: 35 },
      risk:     { max_portfolio_risk_pct: 0.03, reject_f_grade: false },
      telegram: { min_confidence: 80, max_alerts_per_hour: 18 },
      ai:       { temperature: 0.4 },
    },
  },
]

interface TacticalControlDef {
  group:   string
  key:     string
  label:   string
  tagline: string
  impact:  string
}

const TACTICAL_CONTROLS: TacticalControlDef[] = [
  {
    group: 'scanner', key: 'min_confidence',
    label: 'Signal Strictness',
    tagline: 'Minimum pipeline confidence for a signal to surface',
    impact: 'Lower → more signals  ·  Higher → fewer false positives',
  },
  {
    group: 'signals', key: 'min_rr_ratio',
    label: 'Min Risk / Reward',
    tagline: 'R:R threshold — setups below this are rejected',
    impact: 'Higher → only high-conviction entries qualify',
  },
  {
    group: 'scanner', key: 'max_coins_per_run',
    label: 'Scan Coverage',
    tagline: 'Coins scanned per cycle (top-N by market cap)',
    impact: 'Wider → more opportunities  ·  Narrow → faster scans',
  },
  {
    group: 'scanner', key: 'alert_confidence',
    label: 'Alert Threshold',
    tagline: 'Minimum confidence to dispatch a Telegram alert',
    impact: 'Higher → alerts on strongest setups only',
  },
]

function formatRelative(iso: string | null | undefined): string {
  if (!iso) return 'never'
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60_000)         return 'just now'
  if (diff < 3_600_000)      return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000)     return `${Math.floor(diff / 3_600_000)}h ago`
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`
  return new Date(iso).toLocaleDateString()
}

function validateField(entry: SettingEntry, value: boolean | number | string): string | null {
  if (entry.data_type === 'int' || entry.data_type === 'float') {
    const num = Number(value)
    if (isNaN(num))                                return 'Must be a number'
    if (entry.min_val != null && num < entry.min_val) return `Min: ${entry.min_val}`
    if (entry.max_val != null && num > entry.max_val) return `Max: ${entry.max_val}`
  }
  return null
}

function valEq(a: unknown, b: unknown): boolean { return String(a) === String(b) }

function Toggle({ value, onChange, disabled, danger }: {
  value: boolean; onChange: (v: boolean) => void; disabled?: boolean; danger?: boolean
}) {
  const trackOn = danger ? 'bg-red-500' : 'bg-emerald-500'
  return (
    <button
      type="button" role="switch" aria-checked={value} disabled={disabled}
      onClick={() => !disabled && onChange(!value)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-200
        ${value ? trackOn : 'bg-zinc-600'}
        ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <span className={`inline-block h-3.5 w-3.5 transform rounded-full shadow-md transition-transform duration-200
        ${value ? 'bg-white translate-x-4' : 'bg-zinc-300 translate-x-0.5'}`} />
    </button>
  )
}

function WiredChip({ state }: { state: WiredState }) {
  const cfg = {
    live:    { label: 'live',         cls: 'text-bull-default border-bull-default/30 bg-bull-default/5',      title: 'Read by the backend at runtime' },
    floors:  { label: 'floor',        cls: 'text-blue-400 border-blue-500/30 bg-blue-500/5',                  title: 'Applied as a floor on per-mode configs when Apply Founder Thresholds is ON' },
    display: { label: 'display only', cls: 'text-zinc-500/50 border-zinc-800/60 bg-transparent', title: 'No backend consumer reads this value' },
  }[state]
  return (
    <span title={cfg.title} className={`text-[8px] px-1 py-0.5 rounded border font-mono uppercase tracking-wider ${cfg.cls}`}>
      {cfg.label}
    </span>
  )
}

function SettingInput({ entry, value, onChange, disabled }: {
  entry: SettingEntry; value: boolean | number | string
  onChange: (v: boolean | number | string) => void; disabled?: boolean
}) {
  const base = 'bg-zinc-950 border border-zinc-800 rounded px-2 py-1 font-mono text-xs text-zinc-200 focus:outline-none focus:border-signal-medium/50 disabled:opacity-50'

  if (entry.data_type === 'bool')
    return <Toggle value={value as boolean} onChange={onChange as (v: boolean) => void} disabled={disabled} />

  if (entry.data_type === 'enum' && entry.allowed_values)
    return (
      <select value={String(value)} disabled={disabled} onChange={e => onChange(e.target.value)}
        className={`${base} cursor-pointer min-w-[10rem]`}>
        {entry.allowed_values.map(v => <option key={v} value={v}>{v}</option>)}
      </select>
    )

  return (
    <input type="number" value={String(value)}
      min={entry.min_val ?? undefined} max={entry.max_val ?? undefined}
      step={entry.data_type === 'float' ? 0.01 : 1} disabled={disabled}
      onChange={e => { const p = entry.data_type === 'float' ? parseFloat(e.target.value) : parseInt(e.target.value, 10); if (!isNaN(p)) onChange(p) }}
      className={`${base} w-28`} />
  )
}

function FeatureFlagCard({ entry, value, onChange, isSaving, isSaved, error, p0Note, recommendedState }: {
  entry: SettingEntry; value: boolean; onChange: (v: boolean) => void
  isSaving: boolean; isSaved: boolean; error: string | undefined
  p0Note?: string; recommendedState?: boolean
}) {
  const modified = !valEq(value, entry.default)
  const needsAction = p0Note !== undefined && recommendedState !== undefined && value !== recommendedState
  return (
    <div className={`group glass-card rounded-lg p-4 flex items-start gap-3 transition-all border ${
      needsAction ? 'border-amber-500/50 bg-amber-500/5'
      : value ? 'border-emerald-500/30 bg-emerald-500/5'
      : 'border-zinc-700/50'
    }`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-sm font-mono leading-tight ${value ? 'text-zinc-200' : 'text-zinc-500/70'}`}>{entry.label}</span>
          <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border font-bold tracking-wide ${
            value ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                  : 'bg-zinc-800/80 text-zinc-400 border-zinc-600/50'
          }`}>{value ? 'ON' : 'OFF'}</span>
          {needsAction && (
            <span className="text-[8px] font-mono px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/30">
              {recommendedState ? '↑ enable' : '↓ disable'}
            </span>
          )}
          {modified && !needsAction && <span className="text-[8px] font-mono px-1.5 py-0.5 rounded bg-signal-medium/10 text-signal-medium/70 border border-signal-medium/20">modified</span>}
          {isSaving && <span className="text-xs text-zinc-500 animate-pulse">saving…</span>}
          {isSaved  && <CheckCircle2 size={10} className="text-bull-default" />}
        </div>
        <p className={`text-xs mt-1 leading-relaxed ${value ? 'text-zinc-500/60' : 'text-zinc-500/45'} ${needsAction ? '' : 'hidden group-hover:block'}`}>{entry.description}</p>
        {needsAction && p0Note && (
          <p className="text-[10px] text-amber-400/80 mt-1.5 font-mono leading-relaxed">{p0Note}</p>
        )}
        {error && <p className="text-xs text-bear-default mt-1">{error}</p>}
      </div>
      <div className="shrink-0 pt-0.5">
        <Toggle value={value} onChange={onChange} disabled={isSaving} danger={entry.key === 'emergency_stop'} />
      </div>
    </div>
  )
}

function DotIndicator({ value, color }: { value: number; color: string }) {
  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: 5 }).map((_, i) => (
        <span key={i} className="w-1.5 h-1.5 rounded-full"
          style={{ backgroundColor: i < value ? color : 'rgba(255,255,255,0.1)' }} />
      ))}
    </div>
  )
}

function ModeCard({ mode, isActive, isApplying, disabled, onApply }: {
  mode: OperatingMode; isActive: boolean; isApplying: boolean
  disabled: boolean; onApply: (m: OperatingMode) => void
}) {
  const riskColor = mode.riskLevel <= 2 ? '#00d084' : mode.riskLevel <= 3 ? '#f59e0b' : '#ff3b5c'
  return (
    <button
      type="button"
      onClick={() => !disabled && onApply(mode)}
      disabled={disabled}
      className={`relative text-left w-full rounded-xl p-4 border transition-all ${
        disabled ? 'cursor-not-allowed opacity-60' : 'hover:scale-[1.01] active:scale-[0.99]'
      } ${isActive ? '' : 'border-zinc-800/50 bg-transparent hover:border-zinc-800'}`}
      style={{
        borderColor:     isActive ? mode.color + '70' : undefined,
        backgroundColor: isActive ? mode.color + '0d' : undefined,
      }}
    >
      {isActive && (
        <span className="absolute top-2.5 right-2.5 text-[8px] font-mono px-1.5 py-0.5 rounded-full border"
          style={{ color: mode.color, borderColor: mode.color + '60', backgroundColor: mode.color + '18' }}>
          ACTIVE
        </span>
      )}
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className="text-base leading-none" style={{ color: mode.color }}>
          {isApplying ? <span className="inline-block animate-spin text-sm">◌</span> : mode.icon}
        </span>
        <span className="text-sm font-semibold text-zinc-200">{mode.label}</span>
      </div>
      <p className="text-[10px] text-zinc-500/55 leading-relaxed mb-3">{mode.description}</p>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-zinc-500/45 uppercase tracking-wider">Frequency</span>
          <DotIndicator value={mode.frequency} color={mode.color} />
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-zinc-500/45 uppercase tracking-wider">Risk</span>
          <DotIndicator value={mode.riskLevel} color={riskColor} />
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-zinc-500/45 uppercase tracking-wider">Min R:R</span>
          <span className="text-[10px] font-mono font-semibold" style={{ color: mode.color }}>{mode.rrExpected}</span>
        </div>
      </div>
    </button>
  )
}

function SafetyStatusCard({ settings, dirty }: {
  settings: SettingsData
  dirty: Record<string, boolean | number | string>
}) {
  const val = (grp: string, key: string): unknown => {
    const k = `${grp}.${key}`
    return dirty[k] !== undefined ? dirty[k] : settings[grp]?.fields.find(f => f.key === key)?.value
  }

  const issues = Object.entries(DANGEROUS_FLAGS)
    .map(([path, cfg]) => {
      const [grp, key] = path.split('.')
      const v = val(grp, key)
      if (v === undefined) return null
      return Boolean(v) === cfg.dangerousWhen ? cfg : null
    })
    .filter((c): c is NonNullable<typeof c> => c !== null)

  const conf = Number(val('scanner', 'min_confidence') ?? 0)
  const floorsOn = Boolean(val('features', 'apply_founder_thresholds'))
  if (conf > 0 && conf < 85 && floorsOn) {
    issues.push({
      dangerousWhen: true,
      label: `Min confidence ${conf} is below the audited 85 floor`,
      detail: 'The 80–85 band ran negative expectancy over 30d (ALPHA.TRUTH.1).',
    })
  }

  if (issues.length === 0) {
    return (
      <div className="rounded-xl border border-bull-default/25 bg-bull-default/5 px-4 py-3 flex items-center gap-3">
        <span className="w-2.5 h-2.5 rounded-full bg-bull-default shrink-0" />
        <div>
          <p className="text-sm font-semibold text-zinc-200">Safety status: normal</p>
          <p className="text-xs text-zinc-500/60">AI validation, Telegram delivery, and operational switches are all in their expected states.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-bear-default/40 bg-bear-default/5 px-4 py-3">
      <div className="flex items-center gap-2 mb-2">
        <AlertTriangle size={14} className="text-bear-default shrink-0" />
        <p className="text-sm font-semibold text-bear-default">
          {issues.length} safety condition{issues.length !== 1 ? 's' : ''} need attention
        </p>
      </div>
      <div className="space-y-1.5">
        {issues.map((iss, i) => (
          <div key={i} className="text-xs">
            <span className="text-bear-default/90 font-semibold">{iss.label}</span>
            <span className="text-zinc-500/60"> — {iss.detail}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function SettingsTab() {
  const [settings,        setSettings]        = useState<SettingsData>({})
  const [dirty,           setDirty]           = useState<Record<string, boolean | number | string>>({})
  const [saving,          setSaving]          = useState<Set<string>>(new Set())
  const [saved,           setSaved]           = useState<Set<string>>(new Set())
  const [errors,          setErrors]          = useState<Record<string, string>>({})
  const [loading,         setLoading]         = useState(true)
  const [fetchError,      setFetchError]      = useState<string | null>(null)
  const [activeAdvTab,    setActiveAdvTab]    = useState('scanner')
  const [auditLog,        setAuditLog]        = useState<AuditEntry[]>([])
  const [auditGroup,      setAuditGroup]      = useState('all')
  const [auditLoading,    setAuditLoading]    = useState(false)
  const [resetConfirm,    setResetConfirm]    = useState<string | null>(null)
  const [saveWarnings,    setSaveWarnings]    = useState<Record<string, string[]>>({})
  const [applyingMode,    setApplyingMode]    = useState<ModeId | null>(null)
  const [activeMode,      setActiveMode]      = useState<ModeId | null>(null)
  const [allSettingsOpen, setAllSettingsOpen] = useState(false)
  const [advFlagsOpen,    setAdvFlagsOpen]    = useState(false)

  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  const fetchSettings = useCallback(async () => {
    setFetchError(null)
    try { setSettings(await adminApi.settings.all()) }
    catch (e) { setFetchError(String(e)) }
    finally { setLoading(false) }
  }, [])

  const fetchAudit = useCallback(async (grp = 'all') => {
    setAuditLoading(true)
    try {
      const data = await adminApi.settings.audit(150, grp !== 'all' ? grp : undefined)
      setAuditLog(data.entries ?? [])
    } finally { setAuditLoading(false) }
  }, [])

  useEffect(() => { fetchSettings() }, [fetchSettings])
  useEffect(() => { if (activeAdvTab === 'audit') fetchAudit(auditGroup) }, [activeAdvTab, auditGroup, fetchAudit])

  // Derived
  const advTabs = [...Object.keys(settings).filter(g => !HIDDEN_GROUPS.has(g) && g !== 'infra' && g !== 'features'), 'audit']
  const advGroup  = settings[activeAdvTab] as SettingsGroupResponse | undefined
  const advFields = (advGroup?.fields ?? []).filter(f => {
    const tier = settingTier(activeAdvTab, f.key)
    return tier !== 'dead' && tier !== 'engineering'
  })
  const advMeta = advGroup?.meta

  const getValue = (entry: SettingEntry) => {
    const k = `${entry.category}.${entry.key}`
    return dirty[k] !== undefined ? dirty[k] : entry.value
  }
  const isDirtyField = (e: SettingEntry) => dirty[`${e.category}.${e.key}`] !== undefined
  const dirtyKeys    = (cat: string) => (settings[cat]?.fields ?? []).filter(isDirtyField).length

  const flashSaved = (k: string) => {
    setSaved(s => new Set(s).add(k))
    setTimeout(() => setSaved(s => { const n = new Set(s); n.delete(k); return n }), 2_000)
  }

  const saveField = useCallback(async (entry: SettingEntry, value: boolean | number | string) => {
    const k = `${entry.category}.${entry.key}`
    setSaving(s => new Set(s).add(k))
    setErrors(e => { const n = { ...e }; delete n[k]; return n })
    try {
      const result = await adminApi.settings.patch(entry.category, { [entry.key]: value })
      if (result.warnings?.length) {
        setSaveWarnings(prev => ({ ...prev, [entry.category]: result.warnings! }))
      } else {
        setSaveWarnings(prev => { const n = { ...prev }; delete n[entry.category]; return n })
      }
      setSettings(prev => {
        const updated = { ...prev }
        const grp     = updated[entry.category]
        if (grp) updated[entry.category] = {
          ...grp,
          meta:   { ...grp.meta, data_version: grp.meta.data_version + 1, updated_at: new Date().toISOString() },
          fields: grp.fields.map(f => f.key === entry.key ? { ...f, value } : f),
        }
        return updated
      })
      setDirty(d => { const n = { ...d }; delete n[k]; return n })
      flashSaved(k)
    } catch (e) {
      setErrors(prev => ({ ...prev, [k]: String(e).replace(/^Error: /, '') }))
    } finally {
      setSaving(s => { const n = new Set(s); n.delete(k); return n })
    }
  }, [])

  const handleChange = (entry: SettingEntry, value: boolean | number | string) => {
    const k = `${entry.category}.${entry.key}`
    setDirty(d => ({ ...d, [k]: value }))
    const err = validateField(entry, value)
    setErrors(e => { const n = { ...e }; if (err) n[k] = err; else delete n[k]; return n })
    if (err) return
    clearTimeout(timers.current[k])
    if (entry.data_type === 'bool' || entry.data_type === 'enum') { saveField(entry, value); return }
    timers.current[k] = setTimeout(() => saveField(entry, value), 800)
  }

  const handleManualSave = (entry: SettingEntry) => {
    const k = `${entry.category}.${entry.key}`
    const v = dirty[k]
    if (v === undefined) return
    clearTimeout(timers.current[k])
    saveField(entry, v)
  }

  const handleResetGroup = async (groupName: string) => {
    if (resetConfirm !== groupName) { setResetConfirm(groupName); return }
    setResetConfirm(null)
    try { await adminApi.settings.reset(groupName); setDirty({}); await fetchSettings() } catch {}
  }

  const applyMode = useCallback(async (mode: OperatingMode) => {
    setApplyingMode(mode.id)
    const allWarnings: Record<string, string[]> = {}
    try {
      await Promise.all(
        Object.entries(mode.groups).map(async ([grp, flds]) => {
          const result = await adminApi.settings.patch(grp, flds)
          if (result.warnings?.length) allWarnings[grp] = result.warnings
        }),
      )
      if (Object.keys(allWarnings).length) setSaveWarnings(prev => ({ ...prev, ...allWarnings }))
      setDirty({})
      await fetchSettings()
      setActiveMode(mode.id)
    } catch (e) {
      setFetchError(`Mode "${mode.label}" failed: ${String(e).replace(/^Error: /, '')}`)
    } finally {
      setApplyingMode(null)
    }
  }, [fetchSettings])

  const getTacticalEntry = (grp: string, key: string): SettingEntry | null =>
    settings[grp]?.fields.find(f => f.key === key) ?? null

  const getTacticalValue = (grp: string, key: string): boolean | number | string => {
    const k   = `${grp}.${key}`
    const ent = getTacticalEntry(grp, key)
    if (!ent) return 0
    return dirty[k] !== undefined ? dirty[k] : ent.value
  }

  const quickToggleKeys = [
    { group: 'ai',       key: 'enabled' },
    { group: 'telegram', key: 'alerts_enabled' },
    { group: 'features', key: 'apply_founder_thresholds' },
  ]

  if (loading) {
    return (
      <div className="glass-card rounded-lg p-10 text-center text-zinc-500 text-sm">
        Loading configuration…
      </div>
    )
  }

  if (fetchError) {
    return (
      <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-bear-default/5 border border-bear-default/20 text-bear-default text-xs">
        <AlertCircle size={13} />
        <span>Failed to load settings: {fetchError}</span>
        <button onClick={fetchSettings} className="ml-auto underline">Retry</button>
      </div>
    )
  }

  return (
    <div className="space-y-6">

      {/* Safety status */}
      <SafetyStatusCard settings={settings} dirty={dirty} />

      {/* ── Quick Controls ──────────────────────────────────────────────────── */}
      <div className="space-y-3">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <p className="text-zinc-200 text-sm font-semibold">Quick Controls</p>
          <p className="text-[10px] text-zinc-500/50">
            Emergency Stop · Maintenance also in{' '}
            <a href="/admin/system?tab=settings" className="underline hover:text-zinc-200">System → Settings</a>
          </p>
        </div>
        {/* Toggles */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {quickToggleKeys.map(({ group: g, key: kk }) => {
            const entry = getTacticalEntry(g, kk)
            if (!entry) return null
            const k = `${g}.${kk}`
            return (
              <FeatureFlagCard key={k} entry={entry} value={getTacticalValue(g, kk) as boolean}
                onChange={v => handleChange(entry, v)} isSaving={saving.has(k)}
                isSaved={saved.has(k)} error={errors[k]} />
            )
          })}
        </div>
        {/* Number controls */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          {TACTICAL_CONTROLS.map(def => {
            const entry = getTacticalEntry(def.group, def.key)
            if (!entry) return null
            const k     = `${def.group}.${def.key}`
            const value = getTacticalValue(def.group, def.key)
            const pct   = entry.min_val != null && entry.max_val != null
              ? Math.round(((Number(value) - entry.min_val) / (entry.max_val - entry.min_val)) * 100)
              : null
            const barColor = pct == null ? '#3b82f6' : pct > 60 ? '#00d084' : pct > 30 ? '#f59e0b' : '#ff3b5c'
            const isFieldDirty = dirty[k] !== undefined
            const modified = !valEq(value, entry.default)
            const errMsg = errors[k]
            return (
              <div key={k} className={`glass-card rounded-xl p-4 border transition-all ${
                errMsg       ? 'border-bear-default/30 bg-bear-default/5'
                : isFieldDirty ? 'border-signal-medium/30'
                : modified   ? 'border-signal-medium/20'
                : 'border-zinc-800/50'
              }`}>
                <div className="flex items-start justify-between gap-2 mb-1">
                  <span className="text-sm font-medium text-zinc-200 leading-tight">{def.label}</span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {modified && !isFieldDirty && (
                      <span className="text-[8px] font-mono px-1.5 py-0.5 rounded bg-signal-medium/10 text-signal-medium/70 border border-signal-medium/20">modified</span>
                    )}
                    {saving.has(k) && <span className="text-[10px] text-zinc-500 animate-pulse">saving…</span>}
                    {saved.has(k) && !isFieldDirty && <CheckCircle2 size={11} className="text-bull-default" />}
                  </div>
                </div>
                <p className="text-[10px] text-zinc-500/55 mb-1 leading-relaxed">{def.tagline}</p>
                <p className="text-[10px] text-zinc-500/35 mb-3 font-mono">{def.impact}</p>
                <div className="flex items-center gap-2 flex-wrap">
                  <SettingInput entry={entry} value={value} onChange={v => handleChange(entry, v)} disabled={saving.has(k)} />
                  {pct !== null && (
                    <div className="flex-1 min-w-[48px] h-1.5 rounded-full bg-zinc-700/25 overflow-hidden">
                      <div className="h-full rounded-full transition-all"
                        style={{ width: `${Math.max(0, Math.min(100, pct))}%`, backgroundColor: barColor }} />
                    </div>
                  )}
                  {isFieldDirty && !saving.has(k) && !errMsg && (
                    <button onClick={() => handleManualSave(entry)}
                      className="flex items-center gap-1 px-2 py-1 rounded bg-signal-medium/10 border border-signal-medium/30 text-signal-medium text-xs hover:bg-signal-medium/20 font-mono transition-colors">
                      <Save size={9} />Save
                    </button>
                  )}
                </div>
                {errMsg && (
                  <p className="text-bear-default text-xs mt-2 flex items-center gap-1">
                    <AlertCircle size={9} />{errMsg}
                  </p>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Operating Mode ──────────────────────────────────────────────────── */}
      <div className="space-y-3">
        <p className="text-zinc-200 text-sm font-semibold">Operating Mode</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {OPERATING_MODES.filter(m => ['conservative', 'balanced', 'aggressive'].includes(m.id)).map(mode => (
            <ModeCard key={mode.id} mode={mode} isActive={activeMode === mode.id}
              isApplying={applyingMode === mode.id} disabled={!!applyingMode} onApply={applyMode} />
          ))}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] text-zinc-500/50 uppercase tracking-wider shrink-0">Specialist:</span>
          {OPERATING_MODES.filter(m => !['conservative', 'balanced', 'aggressive'].includes(m.id)).map(mode => (
            <button key={mode.id} type="button" title={mode.description}
              onClick={() => applyMode(mode)} disabled={!!applyingMode}
              className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors disabled:opacity-40 ${
                activeMode === mode.id
                  ? 'border-bull-default/50 bg-bull-default/10 text-zinc-200'
                  : 'border-zinc-800 text-zinc-500 hover:text-zinc-200 hover:border-zinc-800/80'
              }`}>
              <span style={{ color: mode.color }}>{mode.icon}</span>
              {applyingMode === mode.id ? 'Applying…' : mode.label}
              <span className="text-zinc-500/40 font-mono hidden sm:inline">RR {mode.rrExpected}</span>
            </button>
          ))}
        </div>
        <p className="text-[10px] text-zinc-500/40 leading-relaxed">
          Presets that set confidence below 85 (Aggressive, Futures Tactical, Rotation Hunter) conflict with the
          ALPHA.TRUTH.1 audit — the 80–85 band ran negative expectancy over 30d. Prefer Balanced/Conservative for live capital.
        </p>
      </div>

      {/* ── Feature Flags ───────────────────────────────────────────────────── */}
      {(() => {
        const allFlags = (settings['features']?.fields ?? [])
          .filter(entry => !quickToggleKeys.some(q => q.group === 'features' && q.key === entry.key))
        const qualityFlags     = allFlags.filter(e => (FLAG_META[e.key]?.tier ?? 'operational') === 'quality')
        const operationalFlags = allFlags.filter(e => (FLAG_META[e.key]?.tier ?? 'operational') === 'operational')
        const advancedFlags    = allFlags.filter(e => FLAG_META[e.key]?.tier === 'advanced')
        const p0Pending = qualityFlags.filter(e => {
          const m = FLAG_META[e.key]
          if (!m?.p0 || m.recommendedState === undefined) return false
          const cur = getValue(e) as boolean
          return cur !== m.recommendedState
        }).length
        const renderFlag = (entry: SettingEntry) => {
          const k = `features.${entry.key}`
          const m = FLAG_META[entry.key]
          return (
            <FeatureFlagCard key={entry.key} entry={entry} value={getValue(entry) as boolean}
              onChange={v => handleChange(entry, v)} isSaving={saving.has(k)}
              isSaved={saved.has(k)} error={errors[k]}
              p0Note={m?.p0Note} recommendedState={m?.recommendedState} />
          )
        }
        return (
          <div className="space-y-4">
            <div className="flex items-center gap-3 flex-wrap">
              <p className="text-zinc-200 text-sm font-semibold">Feature Flags</p>
              {p0Pending > 0 && (
                <>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/30 font-bold">
                    {p0Pending} P0 fix{p0Pending > 1 ? 'es' : ''} pending
                  </span>
                  <button
                    type="button"
                    onClick={async () => {
                      const changes: Record<string, boolean> = {}
                      qualityFlags.forEach(e => {
                        const m = FLAG_META[e.key]
                        if (m?.p0 && m.recommendedState !== undefined && (getValue(e) as boolean) !== m.recommendedState)
                          changes[e.key] = m.recommendedState
                      })
                      if (!Object.keys(changes).length) return
                      try {
                        await adminApi.settings.patch('features', changes)
                        await fetchSettings()
                      } catch {}
                    }}
                    className="text-[10px] font-mono px-2.5 py-1 rounded border border-emerald-500/40 text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 transition-colors font-semibold"
                  >
                    ✓ Apply All Recommended
                  </button>
                </>
              )}
            </div>

            {/* Signal Quality flags */}
            {qualityFlags.length > 0 && (
              <div className="space-y-2">
                <p className="text-[10px] font-mono uppercase tracking-wide text-zinc-500/50">Signal Quality</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {qualityFlags.map(renderFlag)}
                </div>
              </div>
            )}

            {/* Operational flags */}
            {operationalFlags.length > 0 && (
              <div className="space-y-2">
                <p className="text-[10px] font-mono uppercase tracking-wide text-zinc-500/50">Operational</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {operationalFlags.map(renderFlag)}
                </div>
              </div>
            )}

            {/* Background & Analytics — collapsed by default */}
            {advancedFlags.length > 0 && (
              <div className="glass-card rounded-lg border border-zinc-800/40 overflow-hidden">
                <button type="button" onClick={() => setAdvFlagsOpen(v => !v)}
                  className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-zinc-700/5 transition-colors">
                  <span className="text-xs text-zinc-500/60 font-mono">Background &amp; Analytics ({advancedFlags.length})</span>
                  <ChevronDown size={12} className={`text-zinc-500/40 transition-transform ${advFlagsOpen ? 'rotate-180' : ''}`} />
                </button>
                {advFlagsOpen && (
                  <div className="border-t border-zinc-800/30 p-3 grid grid-cols-1 md:grid-cols-2 gap-2">
                    {advancedFlags.map(renderFlag)}
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })()}

      {/* ── Advanced Settings & Audit Log ───────────────────────────────────── */}
      <div className="glass-card rounded-xl overflow-hidden border border-zinc-800/50">
        <button type="button" onClick={() => setAllSettingsOpen(v => !v)}
          className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-zinc-700/5 transition-colors">
          <div className="flex items-center gap-2">
            <Database size={14} className="text-zinc-500/60" />
            <span className="text-sm font-semibold text-zinc-200">Advanced Settings &amp; Audit Log</span>
            <span className="text-[10px] text-zinc-500/40 font-mono hidden sm:block">
              · tuning-phase knobs · change history
            </span>
          </div>
          <div className="flex items-center gap-3">
            {Object.values(dirty).length > 0 && (
              <span className="text-xs text-signal-medium font-semibold">
                {Object.keys(dirty).length} unsaved
              </span>
            )}
            <ChevronDown size={14} className={`text-zinc-500/50 transition-transform ${allSettingsOpen ? 'rotate-180' : ''}`} />
          </div>
        </button>

        {allSettingsOpen && (
          <div className="flex min-h-[400px] border-t border-zinc-800/40">
            {/* Left nav */}
            <div className="w-44 sm:w-52 shrink-0 border-r border-zinc-800/40 py-2">
              {[...advTabs.filter(t => t !== 'audit'), 'audit'].map(tab => {
                const isActive = activeAdvTab === tab
                const count    = tab !== 'audit' ? dirtyKeys(tab) : 0
                const label    = tab === 'audit' ? 'Audit Log' : (SETTINGS_GROUP_LABELS[tab] ?? tab)
                const desc     = tab === 'audit' ? 'Change history' : (SETTINGS_GROUP_DESCRIPTIONS[tab] ?? '')
                const dotColor: Record<string, string> = {
                  scanner: '#3b82f6', signals: '#00d084', ai: '#a855f7',
                  telegram: '#06b6d4', risk: '#f59e0b', anomaly: '#f97316',
                  features: '#6366f1', audit: '#374151',
                }
                return (
                  <button
                    key={tab}
                    onClick={() => { setActiveAdvTab(tab); setResetConfirm(null) }}
                    className={`w-full text-left px-3 py-2.5 transition-colors relative ${
                      isActive
                        ? 'bg-zinc-700/15 text-zinc-200'
                        : 'text-zinc-500 hover:bg-zinc-700/5 hover:text-zinc-200'
                    }`}
                  >
                    {isActive && (
                      <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-r-full bg-bull-default/70" />
                    )}
                    <div className="flex items-center gap-2 pl-1.5">
                      <span className="w-2 h-2 rounded-full shrink-0 opacity-70"
                        style={{ backgroundColor: dotColor[tab] ?? '#6b7280' }} />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className={`text-xs font-semibold truncate ${isActive ? 'text-zinc-200' : ''}`}>
                            {label}
                          </span>
                          {count > 0 && (
                            <span className="text-[10px] px-1 py-0.5 rounded bg-signal-medium/20 text-signal-medium font-bold shrink-0">
                              {count}
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] text-zinc-500/45 truncate leading-tight mt-0.5 hidden sm:block">
                          {desc.split('·')[0].trim()}
                        </p>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>

            {/* Right content */}
            <div className="flex-1 min-w-0 p-4 sm:p-5 space-y-4">
              {activeAdvTab !== 'audit' && (
                <>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-zinc-200 text-sm font-medium">{SETTINGS_GROUP_LABELS[activeAdvTab] ?? activeAdvTab}</p>
                      <p className="text-zinc-500/60 text-xs mt-0.5">{SETTINGS_GROUP_DESCRIPTIONS[activeAdvTab]}</p>
                      {advMeta && (
                        <div className="flex items-center gap-3 mt-1.5 text-xs font-mono text-zinc-500/40">
                          <span className="flex items-center gap-1"><Clock size={9} />{formatRelative(advMeta.updated_at)}</span>
                          <span>schema v{advMeta.schema_version} · data v{advMeta.data_version}</span>
                          <span>by {advMeta.updated_by}</span>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button onClick={() => { setAuditGroup(activeAdvTab); setActiveAdvTab('audit') }}
                        className="flex items-center gap-1.5 text-xs px-2 py-1 rounded border transition-colors font-mono text-zinc-500 border-zinc-800 hover:text-zinc-200">
                        <History size={10} />History
                      </button>
                      <button onClick={() => handleResetGroup(activeAdvTab)}
                        className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded border transition-colors font-mono ${
                          resetConfirm === activeAdvTab
                            ? 'text-bear-default border-bear-default/40 bg-bear-default/5'
                            : 'text-zinc-500 border-zinc-800 hover:text-zinc-200'
                        }`}>
                        <RotateCcw size={10} />
                        {resetConfirm === activeAdvTab ? 'Confirm?' : 'Defaults'}
                      </button>
                    </div>
                  </div>

                  {(saveWarnings[activeAdvTab]?.length ?? 0) > 0 && (
                    <div className="flex items-start gap-2.5 px-4 py-3 rounded-lg bg-signal-high/5 border border-signal-high/20 text-signal-high text-xs">
                      <AlertTriangle size={12} className="shrink-0 mt-0.5" />
                      <div className="space-y-1">
                        <p className="font-semibold">Safety warnings — saved, but review recommended:</p>
                        {saveWarnings[activeAdvTab].map((w, i) => <p key={i} className="text-signal-high/80 leading-relaxed">{w}</p>)}
                      </div>
                      <button onClick={() => setSaveWarnings(p => { const n = { ...p }; delete n[activeAdvTab]; return n })}
                        className="ml-auto text-signal-high/50 hover:text-signal-high shrink-0 font-mono text-xs">✕</button>
                    </div>
                  )}

                  <div className="glass-card rounded-lg overflow-hidden">
                    {!advFields.length ? (
                      <div className="px-5 py-8 text-center text-zinc-500 text-sm">No settings in this group</div>
                    ) : (
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-zinc-800">
                            {[['Setting', 'w-44'], ['Value', ''], ['Default', 'w-24 hidden md:table-cell'], ['Description', 'hidden lg:table-cell'], ['', 'w-20']].map(([h, cls]) => (
                              <th key={h} className={`text-zinc-500 text-xs uppercase tracking-wider text-left py-2 px-4 ${cls}`}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {advFields.map(entry => {
                            const k            = `${entry.category}.${entry.key}`
                            const currentVal   = getValue(entry)
                            const isFieldDirty = isDirtyField(entry)
                            const isSavingK    = saving.has(k)
                            const isSavedK     = saved.has(k)
                            const errMsg       = errors[k]
                            return (
                              <tr key={entry.key} className={`border-b border-zinc-800/30 transition-colors ${
                                errMsg ? 'bg-bear-default/5' : isFieldDirty ? 'bg-signal-medium/5' : 'hover:bg-zinc-700/5'
                              }`}>
                                <td className="py-2.5 px-4">
                                  <div className="flex items-center gap-1.5">
                                    <p className="text-zinc-200 font-mono">{entry.label}</p>
                                    <WiredChip state={wiredState(entry.category, entry.key)} />
                                  </div>
                                  <p className="text-zinc-500/50 text-xs font-mono">{entry.key}</p>
                                  {entry.requires_restart && <span className="text-xs text-signal-high">↻ restart</span>}
                                </td>
                                <td className="py-2.5 px-4">
                                  <SettingInput entry={entry} value={currentVal} onChange={v => handleChange(entry, v)} disabled={isSavingK} />
                                  {errMsg && <p className="text-bear-default text-xs mt-1 flex items-center gap-1"><AlertCircle size={9} />{errMsg}</p>}
                                  {(() => {
                                    const rec = RECOMMENDED[`${entry.category}.${entry.key}`]
                                    if (rec === undefined || valEq(currentVal, rec)) return null
                                    return (
                                      <button onClick={() => handleChange(entry, rec)} disabled={isSavingK}
                                        title="Audited recommendation — click to apply"
                                        className="mt-1 text-[10px] px-1.5 py-0.5 rounded border border-signal-medium/40 text-signal-medium hover:bg-signal-medium/10 font-mono transition-colors">
                                        Rec: {String(rec)} — apply
                                      </button>
                                    )
                                  })()}
                                </td>
                                <td className="py-2.5 px-4 font-mono text-zinc-500/50 text-xs hidden md:table-cell">{String(entry.default)}</td>
                                <td className="py-2.5 px-4 text-zinc-500/60 hidden lg:table-cell">
                                  {entry.description}
                                  {entry.min_val != null && entry.max_val != null && (
                                    <span className="ml-1 text-zinc-500/30 font-mono">[{entry.min_val}–{entry.max_val}]</span>
                                  )}
                                </td>
                                <td className="py-2.5 px-4">
                                  <div className="flex items-center justify-end gap-1.5">
                                    {isSavingK && <span className="text-xs text-zinc-500 font-mono animate-pulse">saving…</span>}
                                    {isSavedK && !isFieldDirty && <CheckCircle2 size={13} className="text-bull-default" />}
                                    {isFieldDirty && !isSavingK && !errMsg && (
                                      <button onClick={() => handleManualSave(entry)}
                                        className="flex items-center gap-1 px-2 py-1 rounded bg-signal-medium/10 border border-signal-medium/30 text-signal-medium text-xs hover:bg-signal-medium/20 font-mono transition-colors">
                                        <Save size={9} />Save
                                      </button>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                </>
              )}

              {/* Audit log */}
              {activeAdvTab === 'audit' && (
                <>
                  <div className="flex items-center gap-3 flex-wrap">
                    <p className="text-zinc-500 text-xs uppercase tracking-wider flex-1">Configuration Change History</p>
                    <select value={auditGroup} onChange={e => setAuditGroup(e.target.value)}
                      className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs font-mono text-zinc-200 focus:outline-none cursor-pointer">
                      <option value="all">All groups</option>
                      {Object.keys(settings).map(g => <option key={g} value={g}>{SETTINGS_GROUP_LABELS[g] ?? g}</option>)}
                    </select>
                    <button onClick={() => fetchAudit(auditGroup)}
                      className="flex items-center gap-1 text-zinc-500 text-xs hover:text-zinc-200 font-mono transition-colors">
                      <RefreshCw size={10} />Refresh
                    </button>
                  </div>
                  <div className="glass-card rounded-lg overflow-hidden">
                    {auditLoading ? (
                      Array.from({ length: 5 }).map((_, i) => (
                        <div key={i} className="px-4 py-3 border-b border-zinc-800/40 flex gap-4">
                          <div className="skeleton h-3 w-20 rounded" />
                          <div className="skeleton h-3 w-28 rounded" />
                          <div className="skeleton h-3 w-40 rounded" />
                        </div>
                      ))
                    ) : !auditLog.length ? (
                      <div className="px-5 py-10 text-center text-zinc-500 text-sm">No configuration changes recorded yet</div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs min-w-[620px]">
                          <thead>
                            <tr className="border-b border-zinc-800">
                              {['Group', 'Version', 'Changed Fields', 'By', 'When'].map(h => (
                                <th key={h} className="text-zinc-500 text-xs uppercase tracking-wider text-left py-2 px-3">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {auditLog.map(entry => (
                              <tr key={entry.id} className="border-b border-zinc-800/30 hover:bg-zinc-700/10">
                                <td className="py-2.5 px-3 font-mono text-zinc-500/60 text-xs">{SETTINGS_GROUP_LABELS[entry.group_name] ?? entry.group_name}</td>
                                <td className="py-2.5 px-3 font-mono text-xs whitespace-nowrap">
                                  <span className="text-bear-default/60">v{entry.old_version}</span>
                                  <span className="text-zinc-500/30"> → </span>
                                  <span className="text-bull-default">v{entry.new_version}</span>
                                </td>
                                <td className="py-2.5 px-3 text-xs max-w-xs">
                                  <div className="space-y-0.5">
                                    {Object.entries(entry.changed_fields as Record<string, AuditChangedField>).map(([field, diff]) => (
                                      <div key={field} className="font-mono">
                                        <span className="text-zinc-200">{field}</span>
                                        <span className="text-zinc-500/30"> </span>
                                        <span className="text-bear-default/70">{JSON.stringify(diff.old)}</span>
                                        <span className="text-zinc-500/30"> → </span>
                                        <span className="text-bull-default">{JSON.stringify(diff.new)}</span>
                                      </div>
                                    ))}
                                  </div>
                                </td>
                                <td className="py-2.5 px-3 font-mono text-zinc-500 text-xs">{entry.updated_by}</td>
                                <td className="py-2.5 px-3 font-mono text-zinc-500/50 text-xs whitespace-nowrap">
                                  <span title={new Date(entry.updated_at).toLocaleString()}>{formatRelative(entry.updated_at)}</span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
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

  const healthFetcher   = useCallback(() => adminApi.health.ready(), [])
  const providerFetcher = useCallback(() => fetch('/api/health/providers').then(r => r.json()), [])
  const scanFetcher     = useCallback(() => adminApi.analytics.scans(24), [])
  const aiFetcher       = useCallback(() => adminApi.analytics.ai(24), [])
  const monitorFetcher  = useCallback(() => adminApi.analytics.monitor(), [])

  const { data: health,   loading: hl } = useAutoRefresh<HealthReady>(healthFetcher, 120_000)
  const { data: provData }              = useAutoRefresh<{ providers: ProviderCheckResult[] }>(providerFetcher, 120_000)
  const { data: scans }                 = useAutoRefresh<ScanSummaryResponse>(scanFetcher, 120_000)
  const { data: ai }                    = useAutoRefresh<AiSummaryResponse>(aiFetcher, 120_000)
  const { data: monitor }               = useSharedPolling<MonitorSnapshot>('admin:monitor', monitorFetcher, 120_000)

  // ── Founder operations state (Phase A–C) ──────────────────────────────────
  const celeryFetcher   = useCallback(() => adminApi.scheduler.status().then(r => r.success ? r.data : null), [])
  const sysFlagsFetcher = useCallback(async () => {
    const [featRes, aiRes, teleRes] = await Promise.all([
      adminApi.settings.group('features'),
      adminApi.settings.group('ai'),
      adminApi.settings.group('telegram'),
    ])
    const field = (res: SettingsGroupResponse, k: string) =>
      (res.fields as { key: string; value: unknown }[]).find(f => f.key === k)?.value
    return {
      emergency_stop:   Boolean(field(featRes, 'emergency_stop')),
      maintenance_mode: Boolean(field(featRes, 'maintenance_mode')),
      ai_enabled:       Boolean(field(aiRes, 'enabled')),
      telegram_enabled: Boolean(field(teleRes, 'alerts_enabled')),
    } as SystemOpsFlags
  }, [])

  const { data: celery,   refresh: refreshCelery } = useAutoRefresh<CeleryStatus | null>(celeryFetcher, 120_000)
  const { data: sysFlags, refresh: refreshFlags  } = useAutoRefresh<SystemOpsFlags | null>(sysFlagsFetcher, 120_000)

  const [opLoading,  setOpLoading]  = useState(false)
  const [opError,    setOpError]    = useState<string | null>(null)
  const [scanning,   setScanning]   = useState(false)
  const [scanDone,   setScanDone]   = useState(false)
  const [pausing,    setPausing]    = useState(false)
  const scanDoneTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  async function handleScanNow() {
    setScanning(true); setScanDone(false); setOpError(null)
    if (scanDoneTimer.current) clearTimeout(scanDoneTimer.current)
    try {
      const res  = await fetch('/api/scanner/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
      const json = await res.json()
      if (res.status === 423) { setOpError('A scan is already running.'); return }
      if (res.status === 503) { setOpError(json.detail ?? 'Scanner is disabled or blocked.'); return }
      if (!json.success)      { setOpError(json.error ?? 'Scan failed'); return }
      setScanDone(true)
      scanDoneTimer.current = setTimeout(() => setScanDone(false), 30_000)
      refreshCelery()
    } catch (e) { setOpError(e instanceof Error ? e.message : 'Network error') }
    finally { setScanning(false) }
  }

  async function handlePauseScanner() {
    if (!celery || pausing) return
    setPausing(true)
    try {
      if (celery.enabled) await adminApi.scheduler.stop()
      else await adminApi.scheduler.start()
      refreshCelery()
    } finally { setPausing(false) }
  }

  async function handlePatchFlag(group: string, key: string, value: boolean) {
    setOpLoading(true); setOpError(null)
    try { await adminApi.settings.patch(group, { [key]: value }); refreshFlags() }
    catch (e) { setOpError(e instanceof Error ? e.message : 'Failed') }
    finally { setOpLoading(false) }
  }

  const TABS = [
    { id: 'system',    label: 'Health' },
    { id: 'anomalies', label: 'Anomalies' },
    { id: 'settings',  label: 'Settings' },
  ] as const

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-zinc-200 text-xl font-semibold">System Health</h1>
        <p className="text-zinc-500 text-sm mt-1">Service status · database truth · Redis fallback counters</p>
      </div>

      {/* Tab nav */}
      <div className="flex gap-1 border-b border-zinc-800 pb-0">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors ${tab === t.id ? 'border-zinc-200 text-zinc-200' : 'border-transparent text-zinc-500 hover:text-zinc-200/70'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'anomalies' && <AnomaliesTab />}

      {tab === 'settings' && <SettingsTab />}

      {tab === 'system' && <>
      {/* Founder Operations Card — Phase A, B, C */}
      <FounderOperationsCard
        celery={celery ?? null}
        flags={sysFlags ?? null}
        monitor={monitor ?? null}
        health={health ?? null}
        onPauseScanner={handlePauseScanner}
        onPatchFlag={handlePatchFlag}
        onScanNow={handleScanNow}
        scanning={scanning}
        scanDone={scanDone}
        opLoading={opLoading}
        opError={opError}
        pausing={pausing}
      />

      {/* Overall status banner */}
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
            <p className="text-xs text-zinc-500/60 mt-0.5">
              {health.status === 'ready' ? 'All services operating normally' : 'One or more services degraded — check below'}
            </p>
          </div>
        </div>
      )}

      {/* Service grid */}
      <div>
        <p className="text-[10px] text-zinc-500/50 uppercase tracking-wide mb-2.5">Service Status</p>
        {hl ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton h-12 rounded-lg" />)}
          </div>
        ) : (() => {
          const apiOk = ['ok', 'ready', 'HEALTHY'].includes(health?.status ?? '')
          const checksOk = Object.entries(health?.checks ?? {})
            .filter(([svc]) => svc !== 'celery_worker_age_s')
            .every(([, st]) => ['ok', 'ready', 'not_configured', 'HEALTHY'].includes(st))
          const allHealthy = apiOk && checksOk

          if (allHealthy) {
            const services = [
              { name: 'Backend API', status: health?.status ?? 'ok' },
              ...Object.entries(health?.checks ?? {})
                .filter(([svc]) => svc !== 'celery_worker_age_s')
                .map(([svc, st]) => ({
                  name: svc === 'celery_worker' ? 'Celery Worker' : svc.charAt(0).toUpperCase() + svc.slice(1).replace(/_/g, ' '),
                  status: st,
                })),
            ]
            return (
              <div className="flex flex-wrap gap-2 p-3 rounded-lg border border-zinc-800 bg-zinc-900/40">
                {services.map(s => (
                  <span key={s.name} className="flex items-center gap-1.5 text-xs text-zinc-400">
                    <span className="w-1.5 h-1.5 rounded-full bg-bull-default shrink-0" />
                    {s.name}
                  </span>
                ))}
              </div>
            )
          }

          return (
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
          )
        })()}
      </div>

      {/* Operational metrics */}
      <div>
        <p className="text-[10px] text-zinc-500/50 uppercase tracking-wide mb-2.5">Operational Metrics · {analyticsWindowLabel(24)}</p>
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

      {/* OUTPUT.COLLAPSE.ALERT.1 banner */}
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

      {/* Operational Monitoring */}
      {monitor && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <span className={`w-2 h-2 rounded-full shrink-0 ${LEVEL_DOT[monitor.overall_level]}`} />
            <p className="text-zinc-500 text-xs uppercase tracking-wider font-semibold">
              Operational Monitoring - DB Truth / UTC Counters
            </p>
            <span className={`ml-auto text-[10px] font-mono font-bold uppercase ${LEVEL_CLS[monitor.overall_level]}`}>
              {monitor.overall_level}
            </span>
          </div>

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

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="glass-card rounded-xl p-4">
              <p className="text-zinc-500 text-[10px] uppercase tracking-wide mb-2">Signals & Outcomes</p>
              <MonitorRow label={`Signals generated (${analyticsWindowLabel(monitor.metrics.signals_per_day.window_hours)})`} metric={monitor.metrics.signals_per_day} />
              <MonitorRow label="Win rate (7d)"          metric={monitor.metrics.win_rate_pct} />
              <MonitorRow label="SL rate (7d)"           metric={monitor.metrics.sl_rate_pct} />
              <MonitorRow label="Resolved outcomes (7d)" metric={monitor.metrics.resolved_7d} />
              <MonitorRow label="Telegram sends"         metric={monitor.metrics.telegram_sends_per_day} />
            </div>
            <div className="glass-card rounded-xl p-4">
              <p className="text-zinc-500 text-[10px] uppercase tracking-wide mb-2">Scanner</p>
              <MonitorRow label="Scans today"          metric={monitor.metrics.scans_today} />
              <MonitorRow label="Coins/run"            metric={monitor.metrics.coins_scanned_per_run} />
              <MonitorRow label="Last scan duration"   metric={monitor.metrics.scan_duration_s} />
              <MonitorRow label="Binance errors"       metric={monitor.metrics.binance_errors_per_day} />
              <MonitorRow label="CMC credits/day"      metric={monitor.metrics.cmc_credits_per_day} />
            </div>
            <div className="glass-card rounded-xl p-4">
              <p className="text-zinc-500 text-[10px] uppercase tracking-wide mb-2">Claude / AI</p>
              <MonitorRow label="Claude calls"       metric={monitor.metrics.claude_calls_per_day} />
              <MonitorRow label="Heuristic calls"    metric={monitor.metrics.heuristic_calls_per_day} />
              <MonitorRow label="Fallback rate"      metric={monitor.metrics.claude_fallback_pct} />
              <MonitorRow label="Est. cost today"    metric={monitor.metrics.estimated_cost_usd} />
            </div>
          </div>
          <p className="text-zinc-500/30 text-[10px] font-mono mt-2">
            Generated {new Date(monitor.generated_at).toLocaleTimeString()} · signals source: {monitor.metrics.signals_per_day.source ?? 'unknown'} · Redis counters reset midnight UTC
          </p>
        </div>
      )}

      {/* Advanced Operations accordion — Phase D */}
      <AdvancedOperationsAccordion
        providers={provData?.providers ?? null}
        scans={scans ?? null}
        monitor={monitor ?? null}
      />
      </>}
    </div>
  )
}
