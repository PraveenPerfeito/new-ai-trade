'use client'

import { useState, useEffect, useCallback } from 'react'
import { Settings2, Save, RotateCcw, CheckCircle2, AlertCircle, ChevronRight } from 'lucide-react'
import { adminApi, SettingEntry, SettingsData, AuditEntry } from '@/lib/admin-api'

const CATEGORY_LABELS: Record<string, string> = {
  scanner:      'Scanner',
  signals:      'Signals',
  ai:           'AI',
  telegram:     'Telegram',
  paper_trading:'Paper Trading',
  readiness:    'Readiness',
  anomaly:      'Anomaly',
  features:     'Features',
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
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
    'bg-terminal-bg border border-terminal-border rounded px-2 py-1 font-mono text-xs text-terminal-text focus:outline-none focus:border-signal-medium/50 w-32'

  if (entry.data_type === 'bool') {
    return <Toggle value={value as boolean} onChange={onChange as (v: boolean) => void} />
  }
  if (entry.data_type === 'enum' && entry.allowed_values) {
    return (
      <select
        value={String(value)}
        onChange={e => onChange(e.target.value)}
        className={base + ' cursor-pointer w-48'}
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
        onChange(entry.data_type === 'float' ? parseFloat(raw) : parseInt(raw, 10))
      }}
      className={base}
    />
  )
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<SettingsData>({})
  const [dirty, setDirty] = useState<Record<string, boolean | number | string>>({})
  const [saving, setSaving] = useState<Set<string>>(new Set())
  const [saved, setSaved] = useState<Set<string>>(new Set())
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [activeTab, setActiveTab] = useState<string>('scanner')
  const [loading, setLoading] = useState(true)
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([])
  const [auditLoading, setAuditLoading] = useState(false)
  const [resetConfirm, setResetConfirm] = useState<string | null>(null)

  const fetchSettings = useCallback(async () => {
    try {
      const data = await adminApi.settings.all()
      setSettings(data)
    } catch {
      // will show empty state
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

  useEffect(() => {
    fetchSettings()
  }, [fetchSettings])

  useEffect(() => {
    if (activeTab === 'audit') fetchAudit()
  }, [activeTab, fetchAudit])

  const categories = Object.keys(settings)
  const tabs = [...categories, 'audit']

  const getValue = (entry: SettingEntry): boolean | number | string =>
    dirty[entry.key] !== undefined ? dirty[entry.key] : entry.value

  const isDirty = (key: string) => dirty[key] !== undefined

  const dirtyCountFor = (cat: string) =>
    (settings[cat] ?? []).filter(e => isDirty(e.key)).length

  const handleChange = (key: string, value: boolean | number | string) => {
    setDirty(d => ({ ...d, [key]: value }))
    setErrors(e => {
      const n = { ...e }
      delete n[key]
      return n
    })
  }

  const flashSaved = (key: string) => {
    setSaved(s => {
      const n = new Set(s)
      n.add(key)
      return n
    })
    setTimeout(() => {
      setSaved(s => {
        const n = new Set(s)
        n.delete(key)
        return n
      })
    }, 2000)
  }

  const handleSave = async (entry: SettingEntry) => {
    const value = dirty[entry.key]
    if (value === undefined) return
    setSaving(s => new Set(s).add(entry.key))
    setErrors(e => {
      const n = { ...e }
      delete n[entry.key]
      return n
    })
    try {
      await adminApi.settings.update(entry.category, entry.key, value)
      setSettings(prev => {
        const updated = { ...prev }
        const cat = updated[entry.category]
        if (cat) {
          updated[entry.category] = cat.map(e =>
            e.key === entry.key ? { ...e, value } : e
          )
        }
        return updated
      })
      setDirty(d => {
        const n = { ...d }
        delete n[entry.key]
        return n
      })
      flashSaved(entry.key)
    } catch (e) {
      setErrors(prev => ({ ...prev, [entry.key]: String(e) }))
    } finally {
      setSaving(s => {
        const n = new Set(s)
        n.delete(entry.key)
        return n
      })
    }
  }

  const handleResetCategory = async (category: string) => {
    if (resetConfirm !== category) {
      setResetConfirm(category)
      return
    }
    setResetConfirm(null)
    try {
      await adminApi.settings.reset(category)
      setDirty({})
      await fetchSettings()
    } catch (e) {
      console.error('reset failed', e)
    }
  }

  if (loading) {
    return (
      <div className="space-y-5 animate-fade-in">
        <div className="flex items-start gap-3">
          <h1 className="text-terminal-text text-lg font-semibold">Settings</h1>
        </div>
        <div className="glass-card rounded-lg p-10 text-center text-terminal-muted text-sm">
          Loading configuration…
        </div>
      </div>
    )
  }

  const currentRows = settings[activeTab] ?? []

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <h1 className="text-terminal-text text-lg font-semibold">Settings</h1>
          <p className="text-terminal-muted text-xs mt-0.5">
            Runtime configuration · Anomaly thresholds · Feature flags · Audit trail
          </p>
        </div>
        <Settings2 size={20} className="text-terminal-muted/40 mt-0.5" />
      </div>

      {/* DB-backed notice */}
      <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-signal-medium/5 border border-signal-medium/20 text-signal-medium text-xs">
        <AlertCircle size={12} />
        <span>
          Changes persist to the database and take effect on the next cache refresh (≤30 s).
          Settings marked <span className="text-signal-high">requires restart</span> need a
          process restart to take effect.
        </span>
      </div>

      {/* Tab bar */}
      <div className="flex gap-0.5 flex-wrap border-b border-terminal-border">
        {tabs.map(tab => {
          const label = tab === 'audit' ? 'Audit Log' : (CATEGORY_LABELS[tab] ?? tab)
          const count = tab !== 'audit' ? dirtyCountFor(tab) : 0
          const isActive = activeTab === tab
          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-3 py-1.5 text-[11px] font-mono rounded-t transition-colors relative -mb-px border-b ${
                isActive
                  ? 'bg-terminal-surface border-x border-t border-terminal-border border-b-terminal-surface text-terminal-text'
                  : 'border-transparent text-terminal-muted hover:text-terminal-text'
              }`}
            >
              {label}
              {count > 0 && (
                <span className="ml-1.5 text-[9px] px-1 py-0.5 rounded bg-signal-medium/20 text-signal-medium font-bold">
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
            <p className="text-terminal-muted text-[9px] uppercase tracking-widest">
              {CATEGORY_LABELS[activeTab] ?? activeTab} — {currentRows.length} settings
            </p>
            <button
              onClick={() => handleResetCategory(activeTab)}
              className={`flex items-center gap-1.5 text-[10px] px-2 py-1 rounded border transition-colors font-mono ${
                resetConfirm === activeTab
                  ? 'text-bear-default border-bear-default/40 bg-bear-default/5 hover:bg-bear-default/10'
                  : 'text-terminal-muted border-terminal-border hover:text-terminal-text hover:border-terminal-muted/50'
              }`}
            >
              <RotateCcw size={10} />
              {resetConfirm === activeTab ? 'Confirm reset?' : 'Reset to defaults'}
            </button>
          </div>

          <div className="glass-card rounded-lg overflow-hidden">
            {currentRows.length === 0 ? (
              <div className="px-5 py-8 text-center text-terminal-muted text-sm">
                No settings in this category
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
                    <th className="text-terminal-muted text-[9px] uppercase tracking-wider text-left py-2 px-4 w-24 hidden md:table-cell">
                      Default
                    </th>
                    <th className="text-terminal-muted text-[9px] uppercase tracking-wider text-left py-2 px-4 hidden lg:table-cell">
                      Description
                    </th>
                    <th className="py-2 px-4 w-16" />
                  </tr>
                </thead>
                <tbody>
                  {currentRows.map(entry => {
                    const currentValue = getValue(entry)
                    const dirty = isDirty(entry.key)
                    const isSaving = saving.has(entry.key)
                    const isSaved  = saved.has(entry.key)
                    const errMsg   = errors[entry.key]
                    return (
                      <tr
                        key={entry.key}
                        className={`border-b border-terminal-border/30 transition-colors ${
                          dirty ? 'bg-signal-medium/5' : 'hover:bg-terminal-bright/5'
                        }`}
                      >
                        <td className="py-2.5 px-4">
                          <p className="text-terminal-text font-mono">{entry.label}</p>
                          <p className="text-terminal-muted/50 text-[10px] font-mono">{entry.key}</p>
                          {entry.requires_restart && (
                            <span className="text-[9px] text-signal-high">requires restart</span>
                          )}
                        </td>

                        <td className="py-2.5 px-4">
                          <SettingInput
                            entry={entry}
                            value={currentValue}
                            onChange={v => handleChange(entry.key, v)}
                          />
                          {errMsg && (
                            <p className="text-bear-default text-[10px] mt-1">{errMsg}</p>
                          )}
                        </td>

                        <td className="py-2.5 px-4 font-mono text-terminal-muted/50 text-[10px] hidden md:table-cell">
                          {String(entry.default)}
                        </td>

                        <td className="py-2.5 px-4 text-terminal-muted/60 hidden lg:table-cell">
                          {entry.description}
                          {entry.min_val != null && entry.max_val != null && (
                            <span className="ml-1 text-terminal-muted/30">
                              [{entry.min_val}–{entry.max_val}]
                            </span>
                          )}
                        </td>

                        <td className="py-2.5 px-4">
                          {isSaved ? (
                            <CheckCircle2 size={14} className="text-bull-default ml-auto" />
                          ) : dirty ? (
                            <button
                              onClick={() => handleSave(entry)}
                              disabled={isSaving}
                              className="flex items-center gap-1 ml-auto px-2 py-1 rounded bg-signal-medium/10 border border-signal-medium/30 text-signal-medium text-[10px] hover:bg-signal-medium/20 transition-colors disabled:opacity-50 font-mono"
                            >
                              {isSaving ? (
                                <span className="animate-pulse">…</span>
                              ) : (
                                <>
                                  <Save size={10} />
                                  Save
                                </>
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
              Recent Configuration Changes
            </p>
            <button
              onClick={fetchAudit}
              className="text-terminal-muted text-[10px] hover:text-terminal-text transition-colors font-mono"
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
                  <div className="skeleton h-3 w-16 rounded" />
                  <div className="skeleton h-3 w-16 rounded" />
                </div>
              ))
            ) : !auditLog.length ? (
              <div className="px-5 py-10 text-center text-terminal-muted text-sm">
                No configuration changes recorded yet
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs min-w-[700px]">
                  <thead>
                    <tr className="border-b border-terminal-border">
                      {['Category', 'Key', 'Old Value', 'New Value', 'Changed By', 'When'].map(h => (
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
                        <td className="py-2 px-3 font-mono text-terminal-muted/60 text-[10px] uppercase">
                          {entry.category}
                        </td>
                        <td className="py-2 px-3 font-mono text-terminal-text text-[10px]">
                          {entry.key}
                        </td>
                        <td className="py-2 px-3 font-mono text-bear-default/60 text-[10px]">
                          {JSON.stringify(entry.old_value)}
                        </td>
                        <td className="py-2 px-3 font-mono text-bull-default text-[10px]">
                          {JSON.stringify(entry.new_value)}
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
