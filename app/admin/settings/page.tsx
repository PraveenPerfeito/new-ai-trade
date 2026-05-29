'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import {
  Settings2, Save, RotateCcw, CheckCircle2, AlertCircle,
  Database, AlertTriangle, Clock, History, RefreshCw, ChevronDown,
} from 'lucide-react'
import {
  adminApi,
  SettingEntry,
  SettingsData,
  SettingsGroupResponse,
  AuditEntry,
  AuditChangedField,
} from '@/lib/admin-api'

// ── Constants ─────────────────────────────────────────────────────────────────

const GROUP_LABELS: Record<string, string> = {
  scanner:  'Scanner',
  signals:  'Signal Thresholds',
  ai:       'AI',
  telegram: 'Telegram',
  risk:     'Risk',
  anomaly:  'Anomaly Detection',
  features: 'Feature Flags',
  infra:    'Infrastructure',
}

const GROUP_DESCRIPTIONS: Record<string, string> = {
  scanner:  'Scan cadence, coin limits, and confidence thresholds',
  signals:  'Minimum quality bar for signals to pass the pipeline',
  ai:       'Claude Haiku validation model and API parameters — toggle on/off from Calibration page',
  telegram: 'Alert delivery and daily summary configuration',
  risk:     'Grade filters, leverage caps, and portfolio risk limits',
  anomaly:  'Burn-in health check thresholds and alert levels',
  features: 'Enable or disable major system capabilities',
  infra:    'Infrastructure limits, pool sizes, and cache TTLs',
}

// Groups to hide from the UI (removed features)
const HIDDEN_GROUPS = new Set(['paper_trading'])

// ── Operating Modes ───────────────────────────────────────────────────────────

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

// ── Tactical Controls ─────────────────────────────────────────────────────────

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
    group: 'signals', key: 'min_quality_score',
    label: 'Quality Gate',
    tagline: 'Multi-factor setup quality minimum (0–100)',
    impact: 'Higher → stricter momentum, volume, and trend filtering',
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
  {
    group: 'telegram', key: 'max_alerts_per_hour',
    label: 'Alert Volume',
    tagline: 'Maximum Telegram alerts dispatched per hour',
    impact: 'Lower → less noise  ·  Higher → real-time signal flow',
  },
  {
    group: 'risk', key: 'max_portfolio_risk_pct',
    label: 'Position Risk Cap',
    tagline: 'Maximum portfolio risk fraction per position',
    impact: 'Lower → tighter capital protection per trade',
  },
  {
    group: 'ai', key: 'temperature',
    label: 'AI Conviction',
    tagline: 'Claude validation temperature — lower = more decisive',
    impact: 'Lower → binary decisions  ·  Higher → probabilistic analysis',
  },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

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
    if (isNaN(num))                               return 'Must be a number'
    if (entry.min_val != null && num < entry.min_val) return `Min: ${entry.min_val}`
    if (entry.max_val != null && num > entry.max_val) return `Max: ${entry.max_val}`
  }
  return null
}

function valEq(a: unknown, b: unknown): boolean { return String(a) === String(b) }

// ── Primitives ────────────────────────────────────────────────────────────────

function Toggle({ value, onChange, disabled }: {
  value: boolean; onChange: (v: boolean) => void; disabled?: boolean
}) {
  return (
    <button
      type="button" role="switch" aria-checked={value} disabled={disabled}
      onClick={() => !disabled && onChange(!value)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors
        ${value ? 'bg-bull-default/80' : 'bg-terminal-bright'}
        ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform
        ${value ? 'translate-x-4' : 'translate-x-0.5'}`} />
    </button>
  )
}

function SourceBadge({ value, defaultVal }: { value: unknown; defaultVal: unknown }) {
  return valEq(value, defaultVal) ? (
    <span className="text-[8px] font-mono px-1.5 py-0.5 rounded bg-terminal-bright/40 text-terminal-muted/40 border border-terminal-border/30 whitespace-nowrap">
      default
    </span>
  ) : (
    <span className="text-[8px] font-mono px-1.5 py-0.5 rounded bg-signal-medium/10 text-signal-medium/70 border border-signal-medium/20 whitespace-nowrap">
      modified
    </span>
  )
}

function VersionBadge({ version }: { version: number }) {
  if (!version) return null
  return (
    <span className="ml-1.5 text-xs font-mono px-1 py-0.5 rounded bg-terminal-bright/50 text-terminal-muted/60 border border-terminal-border/50">
      v{version}
    </span>
  )
}

function SettingInput({ entry, value, onChange, disabled }: {
  entry: SettingEntry; value: boolean | number | string
  onChange: (v: boolean | number | string) => void; disabled?: boolean
}) {
  const base = 'bg-terminal-bg border border-terminal-border rounded px-2 py-1 font-mono text-xs text-terminal-text focus:outline-none focus:border-signal-medium/50 disabled:opacity-50'

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

function FeatureFlagCard({ entry, value, onChange, isSaving, isSaved, error }: {
  entry: SettingEntry; value: boolean; onChange: (v: boolean) => void
  isSaving: boolean; isSaved: boolean; error: string | undefined
}) {
  const modified = !valEq(value, entry.default)
  return (
    <div className={`glass-card rounded-lg p-4 flex items-start gap-3 transition-all border ${value ? 'border-bull-default/25' : 'border-terminal-border'}`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-terminal-text font-mono leading-tight">{entry.label}</span>
          {modified && <span className="text-[8px] font-mono px-1.5 py-0.5 rounded bg-signal-medium/10 text-signal-medium/70 border border-signal-medium/20">modified</span>}
          {isSaving && <span className="text-xs text-terminal-muted animate-pulse">saving…</span>}
          {isSaved  && <CheckCircle2 size={10} className="text-bull-default" />}
        </div>
        <p className="text-xs text-terminal-muted/60 mt-1 leading-relaxed">{entry.description}</p>
        {error && <p className="text-xs text-bear-default mt-1">{error}</p>}
      </div>
      <div className="shrink-0 pt-0.5">
        <Toggle value={value} onChange={onChange} disabled={isSaving} />
      </div>
    </div>
  )
}

// ── DotIndicator ──────────────────────────────────────────────────────────────

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

// ── ModeCard ──────────────────────────────────────────────────────────────────

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
      } ${isActive ? '' : 'border-terminal-border/50 bg-transparent hover:border-terminal-border'}`}
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
        <span className="text-sm font-semibold text-terminal-text">{mode.label}</span>
      </div>
      <p className="text-[10px] text-terminal-muted/55 leading-relaxed mb-3">{mode.description}</p>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[9px] text-terminal-muted/45 uppercase tracking-wider">Frequency</span>
          <DotIndicator value={mode.frequency} color={mode.color} />
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[9px] text-terminal-muted/45 uppercase tracking-wider">Risk</span>
          <DotIndicator value={mode.riskLevel} color={riskColor} />
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[9px] text-terminal-muted/45 uppercase tracking-wider">Min R:R</span>
          <span className="text-[10px] font-mono font-semibold" style={{ color: mode.color }}>{mode.rrExpected}</span>
        </div>
      </div>
    </button>
  )
}

// ── TacticalControlCard ───────────────────────────────────────────────────────

function TacticalControlCard({ def, entry, value, isSaving, isSaved, isDirty, error, onChange, onSave }: {
  def: TacticalControlDef; entry: SettingEntry; value: boolean | number | string
  isSaving: boolean; isSaved: boolean; isDirty: boolean
  error: string | undefined; onChange: (v: boolean | number | string) => void; onSave: () => void
}) {
  const modified = !valEq(value, entry.default)
  const pct = entry.data_type !== 'bool' && entry.data_type !== 'enum'
    && entry.min_val != null && entry.max_val != null
    ? Math.round(((Number(value) - entry.min_val) / (entry.max_val - entry.min_val)) * 100)
    : null
  const barColor = pct == null ? '#3b82f6' : pct > 60 ? '#00d084' : pct > 30 ? '#f59e0b' : '#ff3b5c'

  return (
    <div className={`glass-card rounded-xl p-4 border transition-all ${
      error     ? 'border-bear-default/30 bg-bear-default/5'
      : isDirty ? 'border-signal-medium/30'
      : modified ? 'border-signal-medium/20'
      : 'border-terminal-border/50'
    }`}>
      <div className="flex items-start justify-between gap-2 mb-1">
        <span className="text-sm font-medium text-terminal-text leading-tight">{def.label}</span>
        <div className="flex items-center gap-1.5 shrink-0">
          {modified && !isDirty && (
            <span className="text-[8px] font-mono px-1.5 py-0.5 rounded bg-signal-medium/10 text-signal-medium/70 border border-signal-medium/20">modified</span>
          )}
          {isSaving && <span className="text-[10px] text-terminal-muted animate-pulse">saving…</span>}
          {isSaved && !isDirty && <CheckCircle2 size={11} className="text-bull-default" />}
        </div>
      </div>
      <p className="text-[10px] text-terminal-muted/55 mb-1 leading-relaxed">{def.tagline}</p>
      <p className="text-[9px] text-terminal-muted/35 mb-3 font-mono">{def.impact}</p>
      <div className="flex items-center gap-2 flex-wrap">
        <SettingInput entry={entry} value={value} onChange={onChange} disabled={isSaving} />
        {pct !== null && (
          <div className="flex-1 min-w-[48px] h-1.5 rounded-full bg-terminal-bright/25 overflow-hidden">
            <div className="h-full rounded-full transition-all"
              style={{ width: `${Math.max(0, Math.min(100, pct))}%`, backgroundColor: barColor }} />
          </div>
        )}
        {isDirty && !isSaving && !error && (
          <button onClick={onSave}
            className="flex items-center gap-1 px-2 py-1 rounded bg-signal-medium/10 border border-signal-medium/30 text-signal-medium text-xs hover:bg-signal-medium/20 font-mono transition-colors">
            <Save size={9} />Save
          </button>
        )}
      </div>
      {error && (
        <p className="text-bear-default text-xs mt-2 flex items-center gap-1">
          <AlertCircle size={9} />{error}
        </p>
      )}
    </div>
  )
}

// ── OperationalStatusCards ────────────────────────────────────────────────────

function OperationalStatusCards({ settings, dirty, activeMode }: {
  settings: SettingsData; dirty: Record<string, boolean | number | string>; activeMode: ModeId | null
}) {
  const get = (grp: string, key: string): number => {
    const k   = `${grp}.${key}`
    const raw = dirty[k] !== undefined ? dirty[k] : settings[grp]?.fields.find(f => f.key === key)?.value
    return Number(raw ?? 0)
  }
  const strictness  = get('scanner', 'min_confidence')
  const rrMin       = get('signals', 'min_rr_ratio')
  const alertVolume = get('telegram', 'max_alerts_per_hour')
  const mode        = activeMode ? OPERATING_MODES.find(m => m.id === activeMode) : null

  const alertLabel = alertVolume <= 3 ? 'Minimal' : alertVolume <= 8 ? 'Low' : alertVolume <= 15 ? 'Medium' : 'High'
  const alertColor = alertVolume <= 3 ? '#00d084' : alertVolume <= 8 ? '#3b82f6' : alertVolume <= 15 ? '#f59e0b' : '#f97316'
  const strictPct  = Math.max(0, Math.min(100, ((strictness - 60) / 39) * 100))
  const strictColor = strictness >= 85 ? '#00d084' : strictness >= 75 ? '#f59e0b' : '#ff3b5c'
  const rrColor     = rrMin >= 3.0 ? '#00d084' : rrMin >= 2.0 ? '#f59e0b' : '#ff3b5c'

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <div className="glass-card rounded-xl p-4 border border-terminal-border/50">
        <p className="text-[9px] text-terminal-muted/45 uppercase tracking-widest mb-2">Current Mode</p>
        {mode ? (
          <>
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className="text-lg leading-none" style={{ color: mode.color }}>{mode.icon}</span>
              <span className="text-sm font-semibold text-terminal-text">{mode.label}</span>
            </div>
            <p className="text-[9px] text-terminal-muted/40">Active profile</p>
          </>
        ) : (
          <>
            <span className="text-sm font-semibold text-terminal-muted">Custom</span>
            <p className="text-[9px] text-terminal-muted/40 mt-0.5">Manual configuration</p>
          </>
        )}
      </div>

      <div className="glass-card rounded-xl p-4 border border-terminal-border/50">
        <p className="text-[9px] text-terminal-muted/45 uppercase tracking-widest mb-2">Signal Strictness</p>
        <div className="flex items-baseline gap-1 mb-1.5">
          <span className="text-xl font-mono font-bold text-terminal-text">{strictness}</span>
          <span className="text-[10px] text-terminal-muted/45">/ 99</span>
        </div>
        <div className="h-1 rounded-full bg-terminal-bright/25 overflow-hidden">
          <div className="h-full rounded-full transition-all" style={{ width: `${strictPct}%`, backgroundColor: strictColor }} />
        </div>
      </div>

      <div className="glass-card rounded-xl p-4 border border-terminal-border/50">
        <p className="text-[9px] text-terminal-muted/45 uppercase tracking-widest mb-2">Min Risk / Reward</p>
        <div className="flex items-baseline gap-0.5 mb-0.5">
          <span className="text-xl font-mono font-bold" style={{ color: rrColor }}>{rrMin.toFixed(1)}</span>
          <span className="text-sm font-mono" style={{ color: rrColor }}>×</span>
        </div>
        <p className="text-[9px] text-terminal-muted/40">
          {rrMin >= 3.0 ? 'Institutional grade' : rrMin >= 2.0 ? 'Solid threshold' : 'Permissive — review'}
        </p>
      </div>

      <div className="glass-card rounded-xl p-4 border border-terminal-border/50">
        <p className="text-[9px] text-terminal-muted/45 uppercase tracking-widest mb-2">Alert Volume</p>
        <div className="flex items-baseline gap-1.5 mb-1">
          <span className="text-xl font-mono font-bold text-terminal-text">{alertVolume}</span>
          <span className="text-[10px] text-terminal-muted/45">/hr</span>
        </div>
        <span className="text-[9px] font-mono px-1.5 py-0.5 rounded border"
          style={{ color: alertColor, borderColor: alertColor + '55', backgroundColor: alertColor + '18' }}>
          {alertLabel}
        </span>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const [settings,     setSettings]     = useState<SettingsData>({})
  const [dirty,        setDirty]        = useState<Record<string, boolean | number | string>>({})
  const [saving,       setSaving]       = useState<Set<string>>(new Set())
  const [saved,        setSaved]        = useState<Set<string>>(new Set())
  const [errors,       setErrors]       = useState<Record<string, string>>({})
  const [activeTab,    setActiveTab]    = useState('scanner')
  const [loading,      setLoading]      = useState(true)
  const [fetchError,   setFetchError]   = useState<string | null>(null)
  const [auditLog,     setAuditLog]     = useState<AuditEntry[]>([])
  const [auditGroup,   setAuditGroup]   = useState('all')
  const [auditLoading, setAuditLoading] = useState(false)
  const [resetConfirm,   setResetConfirm]   = useState<string | null>(null)
  const [saveWarnings,   setSaveWarnings]   = useState<Record<string, string[]>>({})
  const [applyingMode,   setApplyingMode]   = useState<ModeId | null>(null)
  const [activeMode,     setActiveMode]     = useState<ModeId | null>(null)
  const [advancedOpen,   setAdvancedOpen]   = useState(false)

  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  // ── Data ───────────────────────────────────────────────────────────────────

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
  useEffect(() => { if (activeTab === 'audit') fetchAudit(auditGroup) }, [activeTab, auditGroup, fetchAudit])

  // ── Derived ────────────────────────────────────────────────────────────────

  const tabs   = [...Object.keys(settings).filter(g => !HIDDEN_GROUPS.has(g)), 'audit']
  const group  = settings[activeTab] as SettingsGroupResponse | undefined
  const fields = group?.fields ?? []
  const meta   = group?.meta

  const getValue   = (entry: SettingEntry) => {
    const k = `${entry.category}.${entry.key}`
    return dirty[k] !== undefined ? dirty[k] : entry.value
  }
  const isDirty    = (e: SettingEntry) => dirty[`${e.category}.${e.key}`] !== undefined
  const dirtyKeys  = (cat: string) => (settings[cat]?.fields ?? []).filter(isDirty).length

  const pendingRestartFields = useMemo(
    () => Object.values(settings).flatMap(g => g?.fields ?? []).filter(f => f.requires_restart && !valEq(f.value, f.default)),
    [settings],
  )

  // ── Save logic ─────────────────────────────────────────────────────────────

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

  // ── Loading / error ────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="space-y-5 animate-fade-in">
        <h1 className="text-terminal-text text-xl font-semibold">Operator Control</h1>
        <div className="glass-card rounded-lg p-10 text-center text-terminal-muted text-sm">Loading configuration…</div>
      </div>
    )
  }

  if (fetchError) {
    return (
      <div className="space-y-5 animate-fade-in">
        <h1 className="text-terminal-text text-xl font-semibold">Operator Control</h1>
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-bear-default/5 border border-bear-default/20 text-bear-default text-xs">
          <AlertCircle size={13} />
          <span>Failed to load settings: {fetchError}</span>
          <button onClick={fetchSettings} className="ml-auto underline">Retry</button>
        </div>
      </div>
    )
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 animate-fade-in">

      {/* Restart warning */}
      {pendingRestartFields.length > 0 && (
        <div className="flex items-start gap-2.5 px-4 py-3 rounded-lg bg-signal-high/5 border border-signal-high/20 text-signal-high text-xs">
          <AlertTriangle size={12} className="shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold">{pendingRestartFields.length} setting{pendingRestartFields.length !== 1 ? 's' : ''} require a process restart: </span>
            <span className="font-mono text-signal-high/80">{pendingRestartFields.map(f => f.label).join(', ')}</span>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-terminal-text text-xl font-semibold">Operator Control</h1>
          <p className="text-terminal-muted text-sm mt-0.5">Tactical mission control · select a mode or tune individual controls</p>
        </div>
        <Settings2 size={20} className="text-terminal-muted/40 mt-0.5" />
      </div>

      {/* Status cards */}
      <OperationalStatusCards settings={settings} dirty={dirty} activeMode={activeMode} />

      {/* ── Layer 1: Quick Modes ─────────────────────────────────────────── */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-[9px] text-terminal-muted/40 uppercase tracking-widest font-mono">Layer 1</span>
          <span className="h-px flex-1 bg-terminal-border/30" />
          <span className="text-xs text-terminal-text font-semibold">Quick Modes</span>
          <span className="h-px flex-1 bg-terminal-border/30" />
          <span className="text-[9px] text-terminal-muted/35 font-mono">patches 5 groups instantly</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-7 gap-3">
          {OPERATING_MODES.map(mode => (
            <ModeCard
              key={mode.id}
              mode={mode}
              isActive={activeMode === mode.id}
              isApplying={applyingMode === mode.id}
              disabled={!!applyingMode}
              onApply={applyMode}
            />
          ))}
        </div>
      </div>

      {/* ── Layer 2: Tactical Controls ───────────────────────────────────── */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-[9px] text-terminal-muted/40 uppercase tracking-widest font-mono">Layer 2</span>
          <span className="h-px flex-1 bg-terminal-border/30" />
          <span className="text-xs text-terminal-text font-semibold">Tactical Controls</span>
          <span className="h-px flex-1 bg-terminal-border/30" />
          <span className="text-[9px] text-terminal-muted/35 font-mono">human-readable · auto-save</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          {TACTICAL_CONTROLS.map(def => {
            const entry = getTacticalEntry(def.group, def.key)
            if (!entry) return null
            const k     = `${def.group}.${def.key}`
            const value = getTacticalValue(def.group, def.key)
            return (
              <TacticalControlCard
                key={k}
                def={def}
                entry={entry}
                value={value}
                isSaving={saving.has(k)}
                isSaved={saved.has(k)}
                isDirty={dirty[k] !== undefined}
                error={errors[k]}
                onChange={v => handleChange(entry, v)}
                onSave={() => handleManualSave(entry)}
              />
            )
          })}
        </div>
      </div>

      {/* ── Layer 3: Advanced Infrastructure (accordion) ─────────────────── */}
      <div className="border border-terminal-border/50 rounded-xl overflow-hidden">
        <button
          type="button"
          onClick={() => setAdvancedOpen(v => !v)}
          className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-terminal-bright/5 transition-colors"
        >
          <div className="flex items-center gap-3">
            <span className="text-[9px] text-terminal-muted/40 uppercase tracking-widest font-mono">Layer 3</span>
            <span className="text-xs font-semibold text-terminal-text">Advanced Infrastructure</span>
            <span className="text-[9px] text-terminal-muted/35 font-mono hidden sm:block">raw configuration groups + audit log</span>
          </div>
          <ChevronDown size={14} className={`text-terminal-muted/50 transition-transform ${advancedOpen ? 'rotate-180' : ''}`} />
        </button>

        {advancedOpen && (
          <div className="border-t border-terminal-border/40 p-5 space-y-5">

            <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-signal-medium/5 border border-signal-medium/20 text-signal-medium text-xs">
              <Database size={12} />
              <span>
                Toggles and dropdowns save immediately. Numbers auto-save 0.8 s after you stop typing.
                Settings marked <span className="text-signal-high font-medium">↻ restart</span> take effect after a process restart.
              </span>
            </div>

            {/* Tab bar */}
            <div className="flex gap-0.5 flex-wrap border-b border-terminal-border">
              {tabs.map(tab => {
                const label    = tab === 'audit' ? 'Audit Log' : (GROUP_LABELS[tab] ?? tab)
                const count    = tab !== 'audit' ? dirtyKeys(tab) : 0
                const grpMeta  = settings[tab]?.meta
                const isActive = activeTab === tab
                return (
                  <button key={tab} onClick={() => { setActiveTab(tab); setResetConfirm(null) }}
                    className={`px-3 py-1.5 text-xs font-mono rounded-t transition-colors relative -mb-px border-b ${
                      isActive
                        ? 'bg-terminal-surface border-x border-t border-terminal-border border-b-terminal-surface text-terminal-text'
                        : 'border-transparent text-terminal-muted hover:text-terminal-text'
                    }`}>
                    {label}
                    {grpMeta && <VersionBadge version={grpMeta.data_version} />}
                    {count > 0 && (
                      <span className="ml-1 text-xs px-1 py-0.5 rounded bg-signal-medium/20 text-signal-medium font-bold">{count}</span>
                    )}
                  </button>
                )
              })}
            </div>

            {/* Settings panel */}
            {activeTab !== 'audit' && (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-terminal-text text-sm font-medium">{GROUP_LABELS[activeTab] ?? activeTab}</p>
                    <p className="text-terminal-muted/60 text-xs mt-0.5">{GROUP_DESCRIPTIONS[activeTab]}</p>
                    {meta && (
                      <div className="flex items-center gap-3 mt-1.5 text-xs font-mono text-terminal-muted/40">
                        <span className="flex items-center gap-1"><Clock size={9} />{formatRelative(meta.updated_at)}</span>
                        <span>schema v{meta.schema_version} · data v{meta.data_version}</span>
                        <span>by {meta.updated_by}</span>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button onClick={() => { setAuditGroup(activeTab); setActiveTab('audit') }}
                      className="flex items-center gap-1.5 text-xs px-2 py-1 rounded border transition-colors font-mono text-terminal-muted border-terminal-border hover:text-terminal-text">
                      <History size={10} />History
                    </button>
                    <button onClick={() => handleResetGroup(activeTab)}
                      className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded border transition-colors font-mono ${
                        resetConfirm === activeTab
                          ? 'text-bear-default border-bear-default/40 bg-bear-default/5'
                          : 'text-terminal-muted border-terminal-border hover:text-terminal-text'
                      }`}>
                      <RotateCcw size={10} />
                      {resetConfirm === activeTab ? 'Confirm?' : 'Defaults'}
                    </button>
                  </div>
                </div>

                {(saveWarnings[activeTab]?.length ?? 0) > 0 && (
                  <div className="flex items-start gap-2.5 px-4 py-3 rounded-lg bg-signal-high/5 border border-signal-high/20 text-signal-high text-xs">
                    <AlertTriangle size={12} className="shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <p className="font-semibold">Safety warnings — saved, but review recommended:</p>
                      {saveWarnings[activeTab].map((w, i) => <p key={i} className="text-signal-high/80 leading-relaxed">{w}</p>)}
                    </div>
                    <button onClick={() => setSaveWarnings(p => { const n = { ...p }; delete n[activeTab]; return n })}
                      className="ml-auto text-signal-high/50 hover:text-signal-high shrink-0 font-mono text-xs">✕</button>
                  </div>
                )}

                {activeTab === 'features' && (
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                    {fields.map(entry => {
                      const k = `${entry.category}.${entry.key}`
                      return (
                        <FeatureFlagCard key={entry.key} entry={entry} value={getValue(entry) as boolean}
                          onChange={v => handleChange(entry, v)} isSaving={saving.has(k)}
                          isSaved={saved.has(k)} error={errors[k]} />
                      )
                    })}
                  </div>
                )}

                {activeTab !== 'features' && (
                  <div className="glass-card rounded-lg overflow-hidden">
                    {!fields.length ? (
                      <div className="px-5 py-8 text-center text-terminal-muted text-sm">No settings in this group</div>
                    ) : (
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-terminal-border">
                            {[['Setting', 'w-44'], ['Value', ''], ['Source', 'w-20 hidden sm:table-cell'], ['Default', 'w-24 hidden md:table-cell'], ['Description', 'hidden lg:table-cell'], ['', 'w-20']].map(([h, cls]) => (
                              <th key={h} className={`text-terminal-muted text-xs uppercase tracking-wider text-left py-2 px-4 ${cls}`}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {fields.map(entry => {
                            const k            = `${entry.category}.${entry.key}`
                            const currentVal   = getValue(entry)
                            const isFieldDirty = isDirty(entry)
                            const isSaving     = saving.has(k)
                            const isSaved      = saved.has(k)
                            const errMsg       = errors[k]
                            return (
                              <tr key={entry.key} className={`border-b border-terminal-border/30 transition-colors ${
                                errMsg ? 'bg-bear-default/5' : isFieldDirty ? 'bg-signal-medium/5' : 'hover:bg-terminal-bright/5'
                              }`}>
                                <td className="py-2.5 px-4">
                                  <p className="text-terminal-text font-mono">{entry.label}</p>
                                  <p className="text-terminal-muted/50 text-xs font-mono">{entry.key}</p>
                                  {entry.requires_restart && <span className="text-xs text-signal-high">↻ restart</span>}
                                </td>
                                <td className="py-2.5 px-4">
                                  <SettingInput entry={entry} value={currentVal} onChange={v => handleChange(entry, v)} disabled={isSaving} />
                                  {errMsg && <p className="text-bear-default text-xs mt-1 flex items-center gap-1"><AlertCircle size={9} />{errMsg}</p>}
                                </td>
                                <td className="py-2.5 px-4 hidden sm:table-cell">
                                  <SourceBadge value={entry.value} defaultVal={entry.default} />
                                </td>
                                <td className="py-2.5 px-4 font-mono text-terminal-muted/50 text-xs hidden md:table-cell">{String(entry.default)}</td>
                                <td className="py-2.5 px-4 text-terminal-muted/60 hidden lg:table-cell">
                                  {entry.description}
                                  {entry.min_val != null && entry.max_val != null && (
                                    <span className="ml-1 text-terminal-muted/30 font-mono">[{entry.min_val}–{entry.max_val}]</span>
                                  )}
                                </td>
                                <td className="py-2.5 px-4">
                                  <div className="flex items-center justify-end gap-1.5">
                                    {isSaving && <span className="text-xs text-terminal-muted font-mono animate-pulse">saving…</span>}
                                    {isSaved && !isFieldDirty && <CheckCircle2 size={13} className="text-bull-default" />}
                                    {isFieldDirty && !isSaving && !errMsg && (
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
                )}
              </>
            )}

            {/* Audit log */}
            {activeTab === 'audit' && (
              <>
                <div className="flex items-center gap-3 flex-wrap">
                  <p className="text-terminal-muted text-xs uppercase tracking-wider flex-1">Configuration Change History</p>
                  <select value={auditGroup} onChange={e => setAuditGroup(e.target.value)}
                    className="bg-terminal-bg border border-terminal-border rounded px-2 py-1 text-xs font-mono text-terminal-text focus:outline-none cursor-pointer">
                    <option value="all">All groups</option>
                    {Object.keys(settings).map(g => <option key={g} value={g}>{GROUP_LABELS[g] ?? g}</option>)}
                  </select>
                  <button onClick={() => fetchAudit(auditGroup)}
                    className="flex items-center gap-1 text-terminal-muted text-xs hover:text-terminal-text font-mono transition-colors">
                    <RefreshCw size={10} />Refresh
                  </button>
                </div>
                <div className="glass-card rounded-lg overflow-hidden">
                  {auditLoading ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <div key={i} className="px-4 py-3 border-b border-terminal-border/40 flex gap-4">
                        <div className="skeleton h-3 w-20 rounded" />
                        <div className="skeleton h-3 w-28 rounded" />
                        <div className="skeleton h-3 w-40 rounded" />
                      </div>
                    ))
                  ) : !auditLog.length ? (
                    <div className="px-5 py-10 text-center text-terminal-muted text-sm">No configuration changes recorded yet</div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs min-w-[620px]">
                        <thead>
                          <tr className="border-b border-terminal-border">
                            {['Group', 'Version', 'Changed Fields', 'By', 'When'].map(h => (
                              <th key={h} className="text-terminal-muted text-xs uppercase tracking-wider text-left py-2 px-3">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {auditLog.map(entry => (
                            <tr key={entry.id} className="border-b border-terminal-border/30 hover:bg-terminal-bright/10">
                              <td className="py-2.5 px-3 font-mono text-terminal-muted/60 text-xs">{GROUP_LABELS[entry.group_name] ?? entry.group_name}</td>
                              <td className="py-2.5 px-3 font-mono text-xs whitespace-nowrap">
                                <span className="text-bear-default/60">v{entry.old_version}</span>
                                <span className="text-terminal-muted/30"> → </span>
                                <span className="text-bull-default">v{entry.new_version}</span>
                              </td>
                              <td className="py-2.5 px-3 text-xs max-w-xs">
                                <div className="space-y-0.5">
                                  {Object.entries(entry.changed_fields as Record<string, AuditChangedField>).map(([field, diff]) => (
                                    <div key={field} className="font-mono">
                                      <span className="text-terminal-text">{field}</span>
                                      <span className="text-terminal-muted/30"> </span>
                                      <span className="text-bear-default/70">{JSON.stringify(diff.old)}</span>
                                      <span className="text-terminal-muted/30"> → </span>
                                      <span className="text-bull-default">{JSON.stringify(diff.new)}</span>
                                    </div>
                                  ))}
                                </div>
                              </td>
                              <td className="py-2.5 px-3 font-mono text-terminal-muted text-xs">{entry.updated_by}</td>
                              <td className="py-2.5 px-3 font-mono text-terminal-muted/50 text-xs whitespace-nowrap">
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
        )}
      </div>
    </div>
  )
}
