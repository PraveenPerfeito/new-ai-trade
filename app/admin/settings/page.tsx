'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import {
  Settings2, Save, RotateCcw, CheckCircle2, AlertCircle,
  Database, AlertTriangle, Clock, History, RefreshCw,
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
  scanner:       'Scanner',
  signals:       'Signal Thresholds',
  ai:            'AI',
  telegram:      'Telegram',
  risk:          'Risk',
  paper_trading: 'Paper Trading',
  anomaly:       'Anomaly Detection',
  features:      'Feature Flags',
  infra:         'Infrastructure',
}

const GROUP_DESCRIPTIONS: Record<string, string> = {
  scanner:       'Scan cadence, coin limits, and confidence thresholds',
  signals:       'Minimum quality bar for signals to pass the pipeline',
  ai:            'Claude Haiku validation model and API parameters',
  telegram:      'Alert delivery and daily summary configuration',
  risk:          'Grade filters, leverage caps, and portfolio risk limits',
  paper_trading: 'Virtual portfolio simulation parameters',
  anomaly:       'Burn-in health check thresholds and alert levels',
  features:      'Enable or disable major system capabilities',
  infra:         'Infrastructure limits, pool sizes, and cache TTLs',
}

// ── Settings presets ──────────────────────────────────────────────────────────

type PresetId = 'conservative' | 'balanced' | 'aggressive' | 'institutional'

interface SettingsPreset {
  id:          PresetId
  label:       string
  icon:        string
  description: string
  color:       string
  groups:      Record<string, Record<string, number | boolean>>
}

const SETTINGS_PRESETS: SettingsPreset[] = [
  {
    id:          'conservative',
    label:       'Conservative',
    icon:        '◇',
    description: 'High-confluence only · tight risk · low frequency · ideal for real capital',
    color:       '#00d084',
    groups: {
      scanner:  { min_confidence: 87, alert_confidence: 92, max_coins_per_run: 50 },
      signals:  { min_rr_ratio: 2.5, min_quality_score: 60 },
      risk:     { max_portfolio_risk_pct: 0.01, reject_f_grade: true },
      telegram: { min_confidence: 90, max_alerts_per_hour: 5 },
      ai:       { temperature: 0.2 },
    },
  },
  {
    id:          'balanced',
    label:       'Balanced',
    icon:        '◈',
    description: 'Default production profile · good signal/noise ratio · recommended starting point',
    color:       '#3b82f6',
    groups: {
      scanner:  { min_confidence: 80, alert_confidence: 85, max_coins_per_run: 100 },
      signals:  { min_rr_ratio: 2.0, min_quality_score: 40 },
      risk:     { max_portfolio_risk_pct: 0.02, reject_f_grade: true },
      telegram: { min_confidence: 85, max_alerts_per_hour: 10 },
      ai:       { temperature: 0.3 },
    },
  },
  {
    id:          'aggressive',
    label:       'Aggressive',
    icon:        '▲',
    description: 'Lower thresholds · higher signal volume · accepts D-grade setups · paper trading / research',
    color:       '#f97316',
    groups: {
      scanner:  { min_confidence: 72, alert_confidence: 78, max_coins_per_run: 100 },
      signals:  { min_rr_ratio: 1.5, min_quality_score: 30 },
      risk:     { max_portfolio_risk_pct: 0.04, reject_f_grade: false },
      telegram: { min_confidence: 78, max_alerts_per_hour: 20 },
      ai:       { temperature: 0.45 },
    },
  },
  {
    id:          'institutional',
    label:       'Institutional',
    icon:        '⬡',
    description: 'Highest bar · A-grade only · 3× R:R minimum · very low alert noise · for large positions',
    color:       '#f59e0b',
    groups: {
      scanner:  { min_confidence: 90, alert_confidence: 94, max_coins_per_run: 30 },
      signals:  { min_rr_ratio: 3.0, min_quality_score: 70 },
      risk:     { max_portfolio_risk_pct: 0.01, reject_f_grade: true },
      telegram: { min_confidence: 92, max_alerts_per_hour: 3 },
      ai:       { temperature: 0.15 },
    },
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

function validateField(
  entry: SettingEntry,
  value: boolean | number | string,
): string | null {
  if (entry.data_type === 'int' || entry.data_type === 'float') {
    const num = Number(value)
    if (isNaN(num)) return 'Must be a number'
    if (entry.min_val != null && num < entry.min_val) return `Min: ${entry.min_val}`
    if (entry.max_val != null && num > entry.max_val) return `Max: ${entry.max_val}`
  }
  return null
}

function valEq(a: unknown, b: unknown): boolean {
  return String(a) === String(b)
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Toggle({
  value,
  onChange,
  disabled,
}: {
  value:    boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      disabled={disabled}
      onClick={() => !disabled && onChange(!value)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors
        ${value ? 'bg-bull-default/80' : 'bg-terminal-bright'}
        ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform
          ${value ? 'translate-x-4' : 'translate-x-0.5'}`}
      />
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
    <span className="ml-1.5 text-[9px] font-mono px-1 py-0.5 rounded bg-terminal-bright/50 text-terminal-muted/60 border border-terminal-border/50">
      v{version}
    </span>
  )
}

function SettingInput({
  entry,
  value,
  onChange,
  disabled,
}: {
  entry:    SettingEntry
  value:    boolean | number | string
  onChange: (v: boolean | number | string) => void
  disabled?: boolean
}) {
  const base =
    'bg-terminal-bg border border-terminal-border rounded px-2 py-1 font-mono text-xs text-terminal-text focus:outline-none focus:border-signal-medium/50 disabled:opacity-50'

  if (entry.data_type === 'bool') {
    return (
      <Toggle
        value={value as boolean}
        onChange={onChange as (v: boolean) => void}
        disabled={disabled}
      />
    )
  }

  if (entry.data_type === 'enum' && entry.allowed_values) {
    return (
      <select
        value={String(value)}
        disabled={disabled}
        onChange={e => onChange(e.target.value)}
        className={`${base} cursor-pointer min-w-[10rem]`}
      >
        {entry.allowed_values.map(v => (
          <option key={v} value={v}>{v}</option>
        ))}
      </select>
    )
  }

  return (
    <input
      type="number"
      value={String(value)}
      min={entry.min_val ?? undefined}
      max={entry.max_val ?? undefined}
      step={entry.data_type === 'float' ? 0.01 : 1}
      disabled={disabled}
      onChange={e => {
        const raw    = e.target.value
        const parsed = entry.data_type === 'float' ? parseFloat(raw) : parseInt(raw, 10)
        if (!isNaN(parsed)) onChange(parsed)
      }}
      className={`${base} w-28`}
    />
  )
}

function FeatureFlagCard({
  entry,
  value,
  onChange,
  isSaving,
  isSaved,
  error,
}: {
  entry:    SettingEntry
  value:    boolean
  onChange: (v: boolean) => void
  isSaving: boolean
  isSaved:  boolean
  error:    string | undefined
}) {
  const modified = !valEq(value, entry.default)
  return (
    <div
      className={`glass-card rounded-lg p-4 flex items-start gap-3 transition-all border ${
        value ? 'border-bull-default/25' : 'border-terminal-border'
      }`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-terminal-text font-mono leading-tight">
            {entry.label}
          </span>
          {modified && (
            <span className="text-[8px] font-mono px-1.5 py-0.5 rounded bg-signal-medium/10 text-signal-medium/70 border border-signal-medium/20">
              modified
            </span>
          )}
          {isSaving && (
            <span className="text-[9px] text-terminal-muted animate-pulse">saving…</span>
          )}
          {isSaved && <CheckCircle2 size={10} className="text-bull-default" />}
        </div>
        <p className="text-[11px] text-terminal-muted/60 mt-1 leading-relaxed">
          {entry.description}
        </p>
        {error && (
          <p className="text-[10px] text-bear-default mt-1">{error}</p>
        )}
      </div>
      <div className="shrink-0 pt-0.5">
        <Toggle value={value} onChange={onChange} disabled={isSaving} />
      </div>
    </div>
  )
}

// ── SettingsPresetsBar ────────────────────────────────────────────────────────

function SettingsPresetsBar({
  applying,
  applied,
  onApply,
}: {
  applying: string | null
  applied:  string | null
  onApply:  (preset: SettingsPreset) => void
}) {
  return (
    <div className="glass-card rounded-lg p-3.5 border border-terminal-border/50">
      <div className="flex items-center gap-2 mb-2.5">
        <Settings2 size={11} className="text-terminal-muted/60" />
        <span className="text-[10px] text-terminal-muted uppercase tracking-widest">
          Quick Presets
        </span>
        <span className="text-[9px] text-terminal-muted/40 ml-1">
          — patches scanner · signals · risk · telegram · ai in one click
        </span>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        {SETTINGS_PRESETS.map(p => {
          const isApplying = applying === p.id
          const isApplied  = applied  === p.id
          const isDisabled = !!applying
          return (
            <button
              key={p.id}
              onClick={() => !isDisabled && onApply(p)}
              disabled={isDisabled}
              title={p.description}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-[11px] font-semibold border transition-all ${
                isDisabled ? 'opacity-50 cursor-not-allowed' : 'hover:scale-[1.02] active:scale-[0.98]'
              }`}
              style={{
                borderColor:     (isApplied || isApplying) ? p.color + '55' : 'rgba(255,255,255,0.07)',
                backgroundColor: isApplied  ? p.color + '18'
                               : isApplying ? p.color + '10'
                               : 'transparent',
                color: isApplied || isApplying ? p.color : '#6b7280',
              }}
            >
              {isApplying ? (
                <span className="inline-block animate-spin text-sm leading-none">◌</span>
              ) : isApplied ? (
                <CheckCircle2 size={12} style={{ color: p.color }} />
              ) : (
                <span className="leading-none" style={{ color: p.color + '90' }}>{p.icon}</span>
              )}
              {p.label}
            </button>
          )
        })}
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
  const [applyingPreset, setApplyingPreset] = useState<string | null>(null)
  const [presetApplied,  setPresetApplied]  = useState<string | null>(null)

  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  // ── Data fetching ──────────────────────────────────────────────────────────

  const fetchSettings = useCallback(async () => {
    setFetchError(null)
    try {
      setSettings(await adminApi.settings.all())
    } catch (e) {
      setFetchError(String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchAudit = useCallback(async (group = 'all') => {
    setAuditLoading(true)
    try {
      const data = await adminApi.settings.audit(
        150,
        group !== 'all' ? group : undefined,
      )
      setAuditLog(data.entries ?? [])
    } finally {
      setAuditLoading(false)
    }
  }, [])

  useEffect(() => { fetchSettings() }, [fetchSettings])
  useEffect(() => {
    if (activeTab === 'audit') fetchAudit(auditGroup)
  }, [activeTab, auditGroup, fetchAudit])

  // ── Derived state ──────────────────────────────────────────────────────────

  const tabs   = [...Object.keys(settings), 'audit']
  const group  = settings[activeTab] as SettingsGroupResponse | undefined
  const fields = group?.fields ?? []
  const meta   = group?.meta

  const getValue = (entry: SettingEntry): boolean | number | string => {
    const k = `${entry.category}.${entry.key}`
    return dirty[k] !== undefined ? dirty[k] : entry.value
  }
  const isDirty   = (e: SettingEntry) => dirty[`${e.category}.${e.key}`] !== undefined
  const dirtyKeys = (cat: string) => (settings[cat]?.fields ?? []).filter(isDirty).length

  const pendingRestartFields = useMemo(
    () =>
      Object.values(settings)
        .flatMap(g => g?.fields ?? [])
        .filter(f => f.requires_restart && !valEq(f.value, f.default)),
    [settings],
  )

  // ── Save logic ─────────────────────────────────────────────────────────────

  const flashSaved = (k: string) => {
    setSaved(s => new Set(s).add(k))
    setTimeout(() => setSaved(s => { const n = new Set(s); n.delete(k); return n }), 2_000)
  }

  const saveField = useCallback(async (
    entry: SettingEntry,
    value: boolean | number | string,
  ) => {
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
        if (grp) {
          updated[entry.category] = {
            ...grp,
            meta: {
              ...grp.meta,
              data_version: grp.meta.data_version + 1,
              updated_at:   new Date().toISOString(),
            },
            fields: grp.fields.map(f => f.key === entry.key ? { ...f, value } : f),
          }
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

  // ── Change handler — inline validation + auto-save ─────────────────────────

  const handleChange = (entry: SettingEntry, value: boolean | number | string) => {
    const k = `${entry.category}.${entry.key}`
    setDirty(d => ({ ...d, [k]: value }))

    const err = validateField(entry, value)
    setErrors(e => {
      const n = { ...e }
      if (err) n[k] = err
      else delete n[k]
      return n
    })
    if (err) return

    clearTimeout(timers.current[k])

    if (entry.data_type === 'bool' || entry.data_type === 'enum') {
      saveField(entry, value)
      return
    }

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
    try {
      await adminApi.settings.reset(groupName)
      setDirty({})
      await fetchSettings()
    } catch {}
  }

  const applyPreset = useCallback(async (preset: SettingsPreset) => {
    setApplyingPreset(preset.id)
    const allWarnings: Record<string, string[]> = {}
    try {
      await Promise.all(
        Object.entries(preset.groups).map(async ([group, fields]) => {
          const result = await adminApi.settings.patch(group, fields)
          if (result.warnings?.length) allWarnings[group] = result.warnings
        }),
      )
      if (Object.keys(allWarnings).length) {
        setSaveWarnings(prev => ({ ...prev, ...allWarnings }))
      }
      setDirty({})
      await fetchSettings()
      setPresetApplied(preset.id)
      setTimeout(() => setPresetApplied(null), 3_000)
    } catch (e) {
      setFetchError(`Preset "${preset.label}" failed: ${String(e).replace(/^Error: /, '')}`)
    } finally {
      setApplyingPreset(null)
    }
  }, [fetchSettings])

  // ── Loading / error ────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="space-y-5 animate-fade-in">
        <h1 className="text-terminal-text text-lg font-semibold">Settings</h1>
        <div className="glass-card rounded-lg p-10 text-center text-terminal-muted text-sm">
          Loading configuration…
        </div>
      </div>
    )
  }

  if (fetchError) {
    return (
      <div className="space-y-5 animate-fade-in">
        <h1 className="text-terminal-text text-lg font-semibold">Settings</h1>
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
    <div className="space-y-5 animate-fade-in">

      {/* Operational status — pending restart */}
      {pendingRestartFields.length > 0 && (
        <div className="flex items-start gap-2.5 px-4 py-3 rounded-lg bg-signal-high/5 border border-signal-high/20 text-signal-high text-xs">
          <AlertTriangle size={12} className="shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold">
              {pendingRestartFields.length} setting{pendingRestartFields.length !== 1 ? 's' : ''} require
              a process restart to take effect:{' '}
            </span>
            <span className="font-mono text-signal-high/80">
              {pendingRestartFields.map(f => f.label).join(', ')}
            </span>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <h1 className="text-terminal-text text-lg font-semibold">Settings</h1>
          <p className="text-terminal-muted text-xs mt-0.5">
            Strongly-typed groups · Schema validation · Versioned · Auto-save
          </p>
        </div>
        <Settings2 size={20} className="text-terminal-muted/40 mt-0.5" />
      </div>

      {/* Info banner */}
      <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-signal-medium/5 border border-signal-medium/20 text-signal-medium text-xs">
        <Database size={12} />
        <span>
          Toggles and dropdowns save immediately. Numbers auto-save 0.8 s after you stop
          typing. All changes are validated against the Pydantic group model before persist.
          Settings marked <span className="text-signal-high font-medium">↻ restart</span> take
          effect after a process restart.
        </span>
      </div>

      {/* Settings Presets */}
      <SettingsPresetsBar
        applying={applyingPreset}
        applied={presetApplied}
        onApply={applyPreset}
      />

      {/* Tab bar */}
      <div className="flex gap-0.5 flex-wrap border-b border-terminal-border">
        {tabs.map(tab => {
          const label    = tab === 'audit' ? 'Audit Log' : (GROUP_LABELS[tab] ?? tab)
          const count    = tab !== 'audit' ? dirtyKeys(tab) : 0
          const grpMeta  = settings[tab]?.meta
          const isActive = activeTab === tab
          return (
            <button
              key={tab}
              onClick={() => { setActiveTab(tab); setResetConfirm(null) }}
              className={`px-3 py-1.5 text-[11px] font-mono rounded-t transition-colors relative -mb-px border-b ${
                isActive
                  ? 'bg-terminal-surface border-x border-t border-terminal-border border-b-terminal-surface text-terminal-text'
                  : 'border-transparent text-terminal-muted hover:text-terminal-text'
              }`}
            >
              {label}
              {grpMeta && <VersionBadge version={grpMeta.data_version} />}
              {count > 0 && (
                <span className="ml-1 text-[9px] px-1 py-0.5 rounded bg-signal-medium/20 text-signal-medium font-bold">
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Settings panel */}
      {activeTab !== 'audit' && (
        <>
          {/* Group header */}
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-terminal-text text-sm font-medium">
                {GROUP_LABELS[activeTab] ?? activeTab}
              </p>
              <p className="text-terminal-muted/60 text-[11px] mt-0.5">
                {GROUP_DESCRIPTIONS[activeTab]}
              </p>
              {meta && (
                <div className="flex items-center gap-3 mt-1.5 text-[10px] font-mono text-terminal-muted/40">
                  <span className="flex items-center gap-1">
                    <Clock size={9} />
                    {formatRelative(meta.updated_at)}
                  </span>
                  <span>schema v{meta.schema_version} · data v{meta.data_version}</span>
                  <span>by {meta.updated_by}</span>
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => { setAuditGroup(activeTab); setActiveTab('audit') }}
                className="flex items-center gap-1.5 text-[10px] px-2 py-1 rounded border transition-colors font-mono text-terminal-muted border-terminal-border hover:text-terminal-text"
              >
                <History size={10} />
                History
              </button>
              <button
                onClick={() => handleResetGroup(activeTab)}
                className={`flex items-center gap-1.5 text-[10px] px-2 py-1 rounded border transition-colors font-mono ${
                  resetConfirm === activeTab
                    ? 'text-bear-default border-bear-default/40 bg-bear-default/5'
                    : 'text-terminal-muted border-terminal-border hover:text-terminal-text'
                }`}
              >
                <RotateCcw size={10} />
                {resetConfirm === activeTab ? 'Confirm?' : 'Defaults'}
              </button>
            </div>
          </div>

          {/* Safety warnings from last save */}
          {(saveWarnings[activeTab]?.length ?? 0) > 0 && (
            <div className="flex items-start gap-2.5 px-4 py-3 rounded-lg bg-signal-high/5 border border-signal-high/20 text-signal-high text-xs">
              <AlertTriangle size={12} className="shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-semibold">Safety warnings — saved, but review recommended:</p>
                {saveWarnings[activeTab].map((w, i) => (
                  <p key={i} className="text-signal-high/80 leading-relaxed">{w}</p>
                ))}
              </div>
              <button
                onClick={() => setSaveWarnings(p => { const n = { ...p }; delete n[activeTab]; return n })}
                className="ml-auto text-signal-high/50 hover:text-signal-high shrink-0 font-mono text-[10px]"
              >
                ✕
              </button>
            </div>
          )}

          {/* Feature Flags — card grid */}
          {activeTab === 'features' && (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {fields.map(entry => {
                const k = `${entry.category}.${entry.key}`
                return (
                  <FeatureFlagCard
                    key={entry.key}
                    entry={entry}
                    value={getValue(entry) as boolean}
                    onChange={v => handleChange(entry, v)}
                    isSaving={saving.has(k)}
                    isSaved={saved.has(k)}
                    error={errors[k]}
                  />
                )
              })}
            </div>
          )}

          {/* Regular settings table */}
          {activeTab !== 'features' && (
            <div className="glass-card rounded-lg overflow-hidden">
              {!fields.length ? (
                <div className="px-5 py-8 text-center text-terminal-muted text-sm">
                  No settings in this group
                </div>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-terminal-border">
                      <th className="text-terminal-muted text-[9px] uppercase tracking-wider text-left py-2 px-4 w-44">
                        Setting
                      </th>
                      <th className="text-terminal-muted text-[9px] uppercase tracking-wider text-left py-2 px-4">
                        Value
                      </th>
                      <th className="text-terminal-muted text-[9px] uppercase tracking-wider text-left py-2 px-4 w-20 hidden sm:table-cell">
                        Source
                      </th>
                      <th className="text-terminal-muted text-[9px] uppercase tracking-wider text-left py-2 px-4 w-24 hidden md:table-cell">
                        Default
                      </th>
                      <th className="text-terminal-muted text-[9px] uppercase tracking-wider text-left py-2 px-4 hidden lg:table-cell">
                        Description
                      </th>
                      <th className="py-2 px-4 w-20" />
                    </tr>
                  </thead>
                  <tbody>
                    {fields.map(entry => {
                      const k          = `${entry.category}.${entry.key}`
                      const currentVal = getValue(entry)
                      const isFieldDirty = isDirty(entry)
                      const isSaving   = saving.has(k)
                      const isSaved    = saved.has(k)
                      const errMsg     = errors[k]

                      return (
                        <tr
                          key={entry.key}
                          className={`border-b border-terminal-border/30 transition-colors ${
                            errMsg
                              ? 'bg-bear-default/5'
                              : isFieldDirty
                              ? 'bg-signal-medium/5'
                              : 'hover:bg-terminal-bright/5'
                          }`}
                        >
                          {/* Label */}
                          <td className="py-2.5 px-4">
                            <p className="text-terminal-text font-mono">{entry.label}</p>
                            <p className="text-terminal-muted/50 text-[10px] font-mono">
                              {entry.key}
                            </p>
                            {entry.requires_restart && (
                              <span className="text-[9px] text-signal-high">↻ restart</span>
                            )}
                          </td>

                          {/* Input */}
                          <td className="py-2.5 px-4">
                            <SettingInput
                              entry={entry}
                              value={currentVal}
                              onChange={v => handleChange(entry, v)}
                              disabled={isSaving}
                            />
                            {errMsg && (
                              <p className="text-bear-default text-[10px] mt-1 flex items-center gap-1">
                                <AlertCircle size={9} />
                                {errMsg}
                              </p>
                            )}
                          </td>

                          {/* Source */}
                          <td className="py-2.5 px-4 hidden sm:table-cell">
                            <SourceBadge
                              value={entry.value}
                              defaultVal={entry.default}
                            />
                          </td>

                          {/* Default */}
                          <td className="py-2.5 px-4 font-mono text-terminal-muted/50 text-[10px] hidden md:table-cell">
                            {String(entry.default)}
                          </td>

                          {/* Description */}
                          <td className="py-2.5 px-4 text-terminal-muted/60 hidden lg:table-cell">
                            {entry.description}
                            {entry.min_val != null && entry.max_val != null && (
                              <span className="ml-1 text-terminal-muted/30 font-mono">
                                [{entry.min_val}–{entry.max_val}]
                              </span>
                            )}
                          </td>

                          {/* Status / manual save */}
                          <td className="py-2.5 px-4">
                            <div className="flex items-center justify-end gap-1.5">
                              {isSaving && (
                                <span className="text-[9px] text-terminal-muted font-mono animate-pulse">
                                  saving…
                                </span>
                              )}
                              {isSaved && !isFieldDirty && (
                                <CheckCircle2 size={13} className="text-bull-default" />
                              )}
                              {isFieldDirty && !isSaving && !errMsg && (
                                <button
                                  onClick={() => handleManualSave(entry)}
                                  className="flex items-center gap-1 px-2 py-1 rounded bg-signal-medium/10 border border-signal-medium/30 text-signal-medium text-[10px] hover:bg-signal-medium/20 font-mono transition-colors"
                                >
                                  <Save size={9} />
                                  Save
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
            <p className="text-terminal-muted text-[9px] uppercase tracking-widest flex-1">
              Configuration Change History
            </p>
            <select
              value={auditGroup}
              onChange={e => setAuditGroup(e.target.value)}
              className="bg-terminal-bg border border-terminal-border rounded px-2 py-1 text-[10px] font-mono text-terminal-text focus:outline-none cursor-pointer"
            >
              <option value="all">All groups</option>
              {Object.keys(settings).map(g => (
                <option key={g} value={g}>{GROUP_LABELS[g] ?? g}</option>
              ))}
            </select>
            <button
              onClick={() => fetchAudit(auditGroup)}
              className="flex items-center gap-1 text-terminal-muted text-[10px] hover:text-terminal-text font-mono transition-colors"
            >
              <RefreshCw size={10} />
              Refresh
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
              <div className="px-5 py-10 text-center text-terminal-muted text-sm">
                No configuration changes recorded yet
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs min-w-[620px]">
                  <thead>
                    <tr className="border-b border-terminal-border">
                      {['Group', 'Version', 'Changed Fields', 'By', 'When'].map(h => (
                        <th
                          key={h}
                          className="text-terminal-muted text-[9px] uppercase tracking-wider text-left py-2 px-3"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {auditLog.map(entry => (
                      <tr
                        key={entry.id}
                        className="border-b border-terminal-border/30 hover:bg-terminal-bright/10"
                      >
                        <td className="py-2.5 px-3 font-mono text-terminal-muted/60 text-[10px]">
                          {GROUP_LABELS[entry.group_name] ?? entry.group_name}
                        </td>
                        <td className="py-2.5 px-3 font-mono text-[10px] whitespace-nowrap">
                          <span className="text-bear-default/60">v{entry.old_version}</span>
                          <span className="text-terminal-muted/30"> → </span>
                          <span className="text-bull-default">v{entry.new_version}</span>
                        </td>
                        <td className="py-2.5 px-3 text-[10px] max-w-xs">
                          <div className="space-y-0.5">
                            {Object.entries(
                              entry.changed_fields as Record<string, AuditChangedField>,
                            ).map(([field, diff]) => (
                              <div key={field} className="font-mono">
                                <span className="text-terminal-text">{field}</span>
                                <span className="text-terminal-muted/30"> </span>
                                <span className="text-bear-default/70">
                                  {JSON.stringify(diff.old)}
                                </span>
                                <span className="text-terminal-muted/30"> → </span>
                                <span className="text-bull-default">
                                  {JSON.stringify(diff.new)}
                                </span>
                              </div>
                            ))}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 font-mono text-terminal-muted text-[10px]">
                          {entry.updated_by}
                        </td>
                        <td className="py-2.5 px-3 font-mono text-terminal-muted/50 text-[10px] whitespace-nowrap">
                          <span title={new Date(entry.updated_at).toLocaleString()}>
                            {formatRelative(entry.updated_at)}
                          </span>
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
  )
}
