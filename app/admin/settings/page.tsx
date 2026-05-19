'use client'

import { useState, useEffect, useCallback } from 'react'
import { Settings2, Save, RotateCcw, CheckCircle2, AlertCircle, Database } from 'lucide-react'
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
  scanner:      'Scanner',
  signals:      'Signal Thresholds',
  ai:           'AI',
  telegram:     'Telegram',
  risk:         'Risk',
  paper_trading:'Paper Trading',
  anomaly:      'Anomaly',
  features:     'Feature Flags',
  infra:        'Infrastructure',
}

// ── Subcomponents ─────────────────────────────────────────────────────────────

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      aria-checked={value}
      role="switch"
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
        value ? 'bg-bull-default/80' : 'bg-terminal-bright'
      }`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
          value ? 'translate-x-4' : 'translate-x-0.5'
        }`}
      />
    </button>
  )
}

function SettingInput({
  entry,
  value,
  onChange,
}: {
  entry: SettingEntry
  value: boolean | number | string
  onChange: (v: boolean | number | string) => void
}) {
  const base =
    'bg-terminal-bg border border-terminal-border rounded px-2 py-1 font-mono text-xs text-terminal-text focus:outline-none focus:border-signal-medium/50'

  if (entry.data_type === 'bool') {
    return <Toggle value={value as boolean} onChange={onChange as (v: boolean) => void} />
  }

  if (entry.data_type === 'enum' && entry.allowed_values) {
    return (
      <select
        value={String(value)}
        onChange={e => onChange(e.target.value)}
        className={`${base} cursor-pointer min-w-[10rem]`}
      >
        {entry.allowed_values.map(v => (
          <option key={v} value={v}>
            {v}
          </option>
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
      onChange={e => {
        const raw = e.target.value
        const parsed =
          entry.data_type === 'float' ? parseFloat(raw) : parseInt(raw, 10)
        if (!isNaN(parsed)) onChange(parsed)
      }}
      className={`${base} w-28`}
    />
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

// ── Main page ─────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const [settings,     setSettings]     = useState<SettingsData>({})
  const [dirty,        setDirty]        = useState<Record<string, boolean | number | string>>({})
  const [saving,       setSaving]       = useState<Set<string>>(new Set())
  const [saved,        setSaved]        = useState<Set<string>>(new Set())
  const [errors,       setErrors]       = useState<Record<string, string>>({})
  const [activeTab,    setActiveTab]    = useState<string>('scanner')
  const [loading,      setLoading]      = useState(true)
  const [fetchError,   setFetchError]   = useState<string | null>(null)
  const [auditLog,     setAuditLog]     = useState<AuditEntry[]>([])
  const [auditLoading, setAuditLoading] = useState(false)
  const [resetConfirm, setResetConfirm] = useState<string | null>(null)

  // ── Data fetching ──────────────────────────────────────────────────────────

  const fetchSettings = useCallback(async () => {
    setFetchError(null)
    try {
      const data = await adminApi.settings.all()
      setSettings(data)
    } catch (e) {
      setFetchError(String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchAudit = useCallback(async () => {
    setAuditLoading(true)
    try {
      const data = await adminApi.settings.audit(100)
      setAuditLog(data.entries ?? [])
    } finally {
      setAuditLoading(false)
    }
  }, [])

  useEffect(() => { fetchSettings() }, [fetchSettings])
  useEffect(() => { if (activeTab === 'audit') fetchAudit() }, [activeTab, fetchAudit])

  // ── Derived state ──────────────────────────────────────────────────────────

  const groups   = Object.keys(settings)
  const tabs     = [...groups, 'audit']
  const group    = settings[activeTab] as SettingsGroupResponse | undefined
  const fields   = group?.fields ?? []
  const meta     = group?.meta

  const getValue = (entry: SettingEntry): boolean | number | string =>
    dirty[`${entry.category}.${entry.key}`] !== undefined
      ? dirty[`${entry.category}.${entry.key}`]
      : entry.value

  const isDirty     = (entry: SettingEntry) => dirty[`${entry.category}.${entry.key}`] !== undefined
  const dirtyKeys   = (cat: string) =>
    (settings[cat]?.fields ?? []).filter(isDirty).length

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleChange = (entry: SettingEntry, value: boolean | number | string) => {
    const k = `${entry.category}.${entry.key}`
    setDirty(d => ({ ...d, [k]: value }))
    setErrors(e => { const n = { ...e }; delete n[k]; return n })
  }

  const flashSaved = (key: string) => {
    setSaved(s => new Set(s).add(key))
    setTimeout(() => setSaved(s => { const n = new Set(s); n.delete(key); return n }), 2_000)
  }

  const handleSave = async (entry: SettingEntry) => {
    const k = `${entry.category}.${entry.key}`
    const value = dirty[k]
    if (value === undefined) return
    setSaving(s => new Set(s).add(k))
    setErrors(e => { const n = { ...e }; delete n[k]; return n })
    try {
      await adminApi.settings.patch(entry.category, { [entry.key]: value })
      setSettings(prev => {
        const updated = { ...prev }
        const grp = updated[entry.category]
        if (grp) {
          updated[entry.category] = {
            ...grp,
            meta: { ...grp.meta, data_version: grp.meta.data_version + 1 },
            fields: grp.fields.map(e =>
              e.key === entry.key ? { ...e, value } : e
            ),
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
  }

  const handleResetGroup = async (groupName: string) => {
    if (resetConfirm !== groupName) { setResetConfirm(groupName); return }
    setResetConfirm(null)
    try {
      await adminApi.settings.reset(groupName)
      setDirty({})
      await fetchSettings()
    } catch (e) {
      console.error('reset failed', e)
    }
  }

  // ── Loading / error states ─────────────────────────────────────────────────

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
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <h1 className="text-terminal-text text-lg font-semibold">Settings</h1>
          <p className="text-terminal-muted text-xs mt-0.5">
            Strongly-typed groups · Schema validation · Versioned · Audit trail
          </p>
        </div>
        <Settings2 size={20} className="text-terminal-muted/40 mt-0.5" />
      </div>

      {/* Info banner */}
      <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-signal-medium/5 border border-signal-medium/20 text-signal-medium text-xs">
        <Database size={12} />
        <span>
          Changes are validated against the Pydantic group model (cross-field constraints
          included), persisted to{' '}
          <code className="font-mono bg-terminal-bright/50 px-1 rounded">settings_groups</code>,
          and cached for up to 30 s. Settings marked{' '}
          <span className="text-signal-high">requires restart</span> take effect after a
          process restart.
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

      {/* Settings table */}
      {activeTab !== 'audit' && (
        <>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <p className="text-terminal-muted text-[9px] uppercase tracking-widest">
                {GROUP_LABELS[activeTab] ?? activeTab} — {fields.length} settings
              </p>
              {meta && (
                <span className="text-terminal-muted/40 text-[9px] font-mono">
                  schema v{meta.schema_version} · data v{meta.data_version}
                  {meta.updated_at && (
                    <> · {new Date(meta.updated_at).toLocaleDateString()}</>
                  )}
                </span>
              )}
            </div>
            <button
              onClick={() => handleResetGroup(activeTab)}
              className={`flex items-center gap-1.5 text-[10px] px-2 py-1 rounded border transition-colors font-mono ${
                resetConfirm === activeTab
                  ? 'text-bear-default border-bear-default/40 bg-bear-default/5'
                  : 'text-terminal-muted border-terminal-border hover:text-terminal-text'
              }`}
            >
              <RotateCcw size={10} />
              {resetConfirm === activeTab ? 'Confirm reset?' : 'Reset to defaults'}
            </button>
          </div>

          <div className="glass-card rounded-lg overflow-hidden">
            {!fields.length ? (
              <div className="px-5 py-8 text-center text-terminal-muted text-sm">
                No settings in this group
              </div>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-terminal-border">
                    <th className="text-terminal-muted text-[9px] uppercase tracking-wider text-left py-2 px-4 w-44">Setting</th>
                    <th className="text-terminal-muted text-[9px] uppercase tracking-wider text-left py-2 px-4">Value</th>
                    <th className="text-terminal-muted text-[9px] uppercase tracking-wider text-left py-2 px-4 w-24 hidden md:table-cell">Default</th>
                    <th className="text-terminal-muted text-[9px] uppercase tracking-wider text-left py-2 px-4 hidden lg:table-cell">Description</th>
                    <th className="py-2 px-4 w-16" />
                  </tr>
                </thead>
                <tbody>
                  {fields.map(entry => {
                    const k          = `${entry.category}.${entry.key}`
                    const currentVal = getValue(entry)
                    const isFieldDirty  = isDirty(entry)
                    const isSaving   = saving.has(k)
                    const isSaved    = saved.has(k)
                    const errMsg     = errors[k]

                    return (
                      <tr
                        key={entry.key}
                        className={`border-b border-terminal-border/30 transition-colors ${
                          isFieldDirty ? 'bg-signal-medium/5' : 'hover:bg-terminal-bright/5'
                        }`}
                      >
                        {/* Label */}
                        <td className="py-2.5 px-4">
                          <p className="text-terminal-text font-mono">{entry.label}</p>
                          <p className="text-terminal-muted/50 text-[10px] font-mono">{entry.key}</p>
                          {entry.requires_restart && (
                            <span className="text-[9px] text-signal-high">restart required</span>
                          )}
                        </td>

                        {/* Input */}
                        <td className="py-2.5 px-4">
                          <SettingInput
                            entry={entry}
                            value={currentVal}
                            onChange={v => handleChange(entry, v)}
                          />
                          {errMsg && (
                            <p className="text-bear-default text-[10px] mt-1 max-w-xs">{errMsg}</p>
                          )}
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

                        {/* Save button */}
                        <td className="py-2.5 px-4">
                          {isSaved ? (
                            <CheckCircle2 size={14} className="text-bull-default ml-auto" />
                          ) : isFieldDirty ? (
                            <button
                              onClick={() => handleSave(entry)}
                              disabled={isSaving}
                              className="flex items-center gap-1 ml-auto px-2 py-1 rounded bg-signal-medium/10 border border-signal-medium/30 text-signal-medium text-[10px] hover:bg-signal-medium/20 disabled:opacity-50 font-mono transition-colors"
                            >
                              {isSaving ? (
                                <span className="animate-pulse">…</span>
                              ) : (
                                <><Save size={10} />Save</>
                              )}
                            </button>
                          ) : null}
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
      {activeTab === 'audit' && (
        <>
          <div className="flex items-center justify-between">
            <p className="text-terminal-muted text-[9px] uppercase tracking-widest">
              Configuration Change History
            </p>
            <button
              onClick={fetchAudit}
              className="text-terminal-muted text-[10px] hover:text-terminal-text font-mono transition-colors"
            >
              <RotateCcw size={10} className="inline mr-1" />
              Refresh
            </button>
          </div>

          <div className="glass-card rounded-lg overflow-hidden">
            {auditLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="px-4 py-3 border-b border-terminal-border/40 flex gap-3">
                  <div className="skeleton h-3 w-20 rounded" />
                  <div className="skeleton h-3 w-28 rounded" />
                  <div className="skeleton h-3 w-32 rounded" />
                </div>
              ))
            ) : !auditLog.length ? (
              <div className="px-5 py-10 text-center text-terminal-muted text-sm">
                No configuration changes recorded yet
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs min-w-[640px]">
                  <thead>
                    <tr className="border-b border-terminal-border">
                      {['Group', 'Version', 'Changed Fields', 'Schema', 'By', 'When'].map(h => (
                        <th key={h} className="text-terminal-muted text-[9px] uppercase tracking-wider text-left py-2 px-3">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {auditLog.map(entry => (
                      <tr key={entry.id} className="border-b border-terminal-border/30 hover:bg-terminal-bright/10">
                        <td className="py-2 px-3 font-mono text-terminal-muted/60 text-[10px] uppercase">
                          {entry.group_name}
                        </td>
                        <td className="py-2 px-3 font-mono text-terminal-muted text-[10px]">
                          <span className="text-bear-default/60">v{entry.old_version}</span>
                          <span className="text-terminal-muted/30"> → </span>
                          <span className="text-bull-default">v{entry.new_version}</span>
                        </td>
                        <td className="py-2 px-3 text-[10px] max-w-xs">
                          {Object.entries(entry.changed_fields as Record<string, AuditChangedField>)
                            .map(([field, diff]) => (
                              <div key={field} className="font-mono">
                                <span className="text-terminal-text">{field}</span>
                                <span className="text-terminal-muted/40"> </span>
                                <span className="text-bear-default/60">{JSON.stringify(diff.old)}</span>
                                <span className="text-terminal-muted/40"> → </span>
                                <span className="text-bull-default">{JSON.stringify(diff.new)}</span>
                              </div>
                            ))}
                        </td>
                        <td className="py-2 px-3 font-mono text-terminal-muted/40 text-[10px]">
                          v{entry.schema_version}
                        </td>
                        <td className="py-2 px-3 font-mono text-terminal-muted text-[10px]">
                          {entry.updated_by}
                        </td>
                        <td className="py-2 px-3 font-mono text-terminal-muted/50 text-[10px]">
                          {new Date(entry.updated_at).toLocaleString()}
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
