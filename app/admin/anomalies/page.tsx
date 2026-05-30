'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  RefreshCw,
  Bell,
  BellOff,
  CheckCircle2,
  Eye,
  X,
  Clock,
  AlertTriangle,
  Shield,
} from 'lucide-react'
import { adminApi, AnomalyRecord, BurninStatus } from '@/lib/admin-api'
import { useAutoRefresh } from '@/lib/use-auto-refresh'
import { AnomalyBadge } from '@/components/admin/anomaly-badge'
import { formatTs } from '@/lib/utils'

// ─── Local types ──────────────────────────────────────────────────────────────

type AnomalyState = 'new' | 'acknowledged' | 'muted' | 'resolved'

interface StoredAnomaly {
  state: AnomalyState
  mutedUntil?: number
  updatedAt: string
}

// ─── Anomaly metadata helper ──────────────────────────────────────────────────

interface AnomalyMeta {
  source: string
  provider: string
  suggestedAction: string
}

function getAnomalyMeta(type: string): AnomalyMeta {
  const map: Record<string, AnomalyMeta> = {
    ai_error_spike: {
      source: 'AI Validation',
      provider: 'Claude API',
      suggestedAction: 'Check Anthropic API key and rate limits.',
    },
    scan_failure_spike: {
      source: 'Scanner Engine',
      provider: 'Binance API',
      suggestedAction: 'Check Binance connectivity and scan logs.',
    },
    queue_backlog: {
      source: 'Task Queue',
      provider: 'Celery Worker',
      suggestedAction: 'Restart Celery worker or reduce scan frequency.',
    },
    win_rate_degradation: {
      source: 'Analytics',
      provider: 'Signal Pipeline',
      suggestedAction: 'Review recent regime changes. Apply Conservative mode.',
    },
    expectancy_negative: {
      source: 'Analytics',
      provider: 'Signal Analytics',
      suggestedAction: 'Pause signal generation and review thresholds.',
    },
    false_positive_spike: {
      source: 'Signal Quality',
      provider: 'Risk Engine',
      suggestedAction: 'Increase min_confidence in Scanner Settings.',
    },
    drawdown_spike: {
      source: 'Risk Engine',
      provider: 'Portfolio',
      suggestedAction: 'Switch to Conservative mode. Review stop-loss placement.',
    },
    calibration_drift: {
      source: 'Calibration',
      provider: 'AI Validator',
      suggestedAction: 'Run calibration report. Adjust confidence bands.',
    },
  }
  return (
    map[type] ?? {
      source: 'System',
      provider: 'Monitor',
      suggestedAction: 'Review system logs and check provider health.',
    }
  )
}

// ─── State badge ──────────────────────────────────────────────────────────────

const STATE_BADGE: Record<AnomalyState, { color: string; label: string }> = {
  new: {
    color: 'text-blue-400 border-blue-400/30 bg-blue-400/10',
    label: 'NEW',
  },
  acknowledged: {
    color: 'text-amber-400 border-amber-400/30 bg-amber-400/10',
    label: 'ACK',
  },
  muted: {
    color: 'text-zinc-500 border-zinc-600/30 bg-zinc-800/40',
    label: 'MUTED',
  },
  resolved: {
    color: 'text-green-400 border-green-400/30 bg-green-400/10',
    label: 'DONE',
  },
}

function StateBadge({ state }: { state: AnomalyState }) {
  const { color, label } = STATE_BADGE[state]
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold border ${color}`}>
      {label}
    </span>
  )
}

// ─── Mute menu ────────────────────────────────────────────────────────────────

const MUTE_DURATIONS: { label: string; ms: number }[] = [
  { label: '15 min', ms: 15 * 60 * 1000 },
  { label: '1 hour', ms: 60 * 60 * 1000 },
  { label: '24 hours', ms: 24 * 60 * 60 * 1000 },
]

// ─── Row actions ──────────────────────────────────────────────────────────────

interface RowActionsProps {
  anomalyKey: string
  anomaly: AnomalyRecord
  muteMenuFor: string | null
  onAcknowledge: () => void
  onMute: (ms: number) => void
  onResolve: () => void
  onDetail: () => void
  onToggleMuteMenu: () => void
}

function RowActions({
  anomalyKey,
  muteMenuFor,
  onAcknowledge,
  onMute,
  onResolve,
  onDetail,
  onToggleMuteMenu,
}: RowActionsProps) {
  const btnBase =
    'p-1.5 rounded transition-colors hover:bg-terminal-bright/10 text-terminal-muted hover:text-terminal-text'

  return (
    <div className="flex items-center gap-0.5 relative shrink-0">
      <button
        type="button"
        title="Acknowledge"
        onClick={onAcknowledge}
        className={`${btnBase} hover:text-amber-400`}
      >
        <CheckCircle2 size={14} />
      </button>

      <div className="relative">
        <button
          type="button"
          title="Mute"
          onClick={onToggleMuteMenu}
          className={`${btnBase} hover:text-zinc-300`}
        >
          <BellOff size={14} />
        </button>
        {muteMenuFor === anomalyKey && (
          <div className="absolute right-0 top-full mt-1 z-30 bg-terminal-surface border border-terminal-border rounded shadow-xl py-1 min-w-[96px]">
            {MUTE_DURATIONS.map(({ label, ms }) => (
              <button
                key={label}
                type="button"
                onClick={() => onMute(ms)}
                className="w-full text-left px-3 py-1.5 text-xs text-terminal-text hover:bg-terminal-bright/10 transition-colors"
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      <button
        type="button"
        title="Mark Resolved"
        onClick={onResolve}
        className={`${btnBase} hover:text-green-400`}
      >
        <Shield size={14} />
      </button>

      <button
        type="button"
        title="View Details"
        onClick={onDetail}
        className={`${btnBase} hover:text-blue-400`}
      >
        <Eye size={14} />
      </button>
    </div>
  )
}

// ─── Detail drawer ────────────────────────────────────────────────────────────

interface DetailDrawerProps {
  anomaly: AnomalyRecord
  effectiveState: AnomalyState
  muteMenuFor: string | null
  anomalyKey: string
  onClose: () => void
  onAcknowledge: () => void
  onMute: (ms: number) => void
  onResolve: () => void
  onToggleMuteMenu: () => void
}

function DetailDrawer({
  anomaly,
  effectiveState,
  muteMenuFor,
  anomalyKey,
  onClose,
  onAcknowledge,
  onMute,
  onResolve,
  onToggleMuteMenu,
}: DetailDrawerProps) {
  const meta = getAnomalyMeta(anomaly.anomaly_type)
  const title = anomaly.anomaly_type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/40"
        onClick={onClose}
      />
      {/* Panel */}
      <div className="fixed right-0 top-0 bottom-0 w-full max-w-sm z-50 bg-terminal-surface border-l border-terminal-border overflow-y-auto p-5 flex flex-col gap-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-terminal-text text-sm font-semibold leading-snug">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-terminal-muted hover:text-terminal-text hover:bg-terminal-bright/10 transition-colors shrink-0"
          >
            <X size={14} />
          </button>
        </div>

        {/* Badges */}
        <div className="flex items-center gap-2 flex-wrap">
          <AnomalyBadge severity={anomaly.severity} />
          <StateBadge state={effectiveState} />
        </div>

        {/* Description */}
        <p className="text-terminal-text text-xs leading-relaxed">{anomaly.description}</p>

        {/* Details grid */}
        <div className="grid grid-cols-2 gap-2 text-xs">
          {[
            ['Type', anomaly.anomaly_type],
            ['Severity', anomaly.severity],
            ['Source', meta.source],
            ['Provider', meta.provider],
            ['First Seen', formatTs(anomaly.detected_at)],
          ].map(([label, value]) => (
            <div key={label} className="glass-card rounded px-2.5 py-2">
              <p className="text-terminal-muted/60 uppercase tracking-wide text-[10px] mb-0.5">{label}</p>
              <p className="text-terminal-text font-mono">{value}</p>
            </div>
          ))}
        </div>

        {/* Suggested action */}
        <div className="glass-card rounded-lg px-4 py-3 border border-amber-400/15 bg-amber-400/5">
          <div className="flex items-center gap-1.5 mb-1.5">
            <AlertTriangle size={12} className="text-amber-400" />
            <p className="text-amber-400 text-[10px] uppercase tracking-wider font-semibold">Suggested Action</p>
          </div>
          <p className="text-terminal-text text-xs leading-relaxed">{meta.suggestedAction}</p>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onAcknowledge}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-amber-400 border border-amber-400/30 hover:bg-amber-400/10 rounded transition-colors"
          >
            <CheckCircle2 size={12} /> Acknowledge
          </button>

          <div className="relative">
            <button
              type="button"
              onClick={onToggleMuteMenu}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-zinc-400 border border-zinc-600/30 hover:bg-zinc-800/40 rounded transition-colors"
            >
              <BellOff size={12} /> Mute
            </button>
            {muteMenuFor === anomalyKey && (
              <div className="absolute left-0 top-full mt-1 z-30 bg-terminal-surface border border-terminal-border rounded shadow-xl py-1 min-w-[96px]">
                {MUTE_DURATIONS.map(({ label, ms }) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => onMute(ms)}
                    className="w-full text-left px-3 py-1.5 text-xs text-terminal-text hover:bg-terminal-bright/10 transition-colors"
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={onResolve}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-green-400 border border-green-400/30 hover:bg-green-400/10 rounded transition-colors"
          >
            <Shield size={12} /> Resolve
          </button>
        </div>
      </div>
    </>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const LS_KEY = 'anomaly_states'

export default function AnomaliesPage() {
  const anomalyFetcher = useCallback(() => adminApi.burnin.anomalies(96), [])
  const statusFetcher  = useCallback(() => adminApi.burnin.status(), [])

  const { data: anomalies, loading: al, refresh } = useAutoRefresh<AnomalyRecord[]>(anomalyFetcher, 60_000)
  const { data: status }                           = useAutoRefresh<BurninStatus>(statusFetcher, 60_000)

  const [storedStates, setStoredStates] = useState<Record<string, StoredAnomaly>>({})
  const [selectedAnomaly, setSelectedAnomaly] = useState<AnomalyRecord | null>(null)
  const [muteMenuFor, setMuteMenuFor] = useState<string | null>(null)

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY)
      if (raw) {
        setStoredStates(JSON.parse(raw) as Record<string, StoredAnomaly>)
      }
    } catch {
      // ignore parse errors
    }
  }, [])

  // Persist whenever storedStates changes
  useEffect(() => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(storedStates))
    } catch {
      // ignore write errors
    }
  }, [storedStates])

  const getKey = useCallback((a: AnomalyRecord): string => {
    return `${a.anomaly_type}|${a.detected_at}`
  }, [])

  const getEffectiveState = useCallback(
    (a: AnomalyRecord): AnomalyState => {
      const key = getKey(a)
      const stored = storedStates[key]
      if (!stored) return 'new'
      if (stored.state === 'muted' && stored.mutedUntil != null) {
        if (Date.now() > stored.mutedUntil) return 'new'
      }
      return stored.state
    },
    [storedStates, getKey]
  )

  const updateAnomalyState = useCallback(
    (a: AnomalyRecord, state: AnomalyState, mutedUntilMs?: number) => {
      const key = getKey(a)
      setStoredStates(prev => ({
        ...prev,
        [key]: {
          state,
          ...(mutedUntilMs !== undefined ? { mutedUntil: mutedUntilMs } : {}),
          updatedAt: new Date().toISOString(),
        },
      }))
      setMuteMenuFor(null)
    },
    [getKey]
  )

  const lastCheck = status?.anomaly_summary?.checked_at

  // Sort: critical NEW → warning NEW → info NEW → acknowledged → muted last
  const sortedAnomalies = useMemo(() => {
    if (!anomalies) return []
    const severityOrder: Record<string, number> = { critical: 0, warning: 1, info: 2 }
    const stateOrder: Record<AnomalyState, number> = {
      new: 0,
      acknowledged: 1,
      resolved: 2,
      muted: 3,
    }
    return [...anomalies].sort((a, b) => {
      const sa = getEffectiveState(a)
      const sb = getEffectiveState(b)
      const stateA = stateOrder[sa]
      const stateB = stateOrder[sb]
      if (stateA !== stateB) return stateA - stateB
      const sevA = severityOrder[a.severity] ?? 3
      const sevB = severityOrder[b.severity] ?? 3
      return sevA - sevB
    })
  }, [anomalies, getEffectiveState])

  // Counts for summary tiles
  const counts = useMemo(() => {
    if (!anomalies) return { critical: 0, warning: 0, info: 0, muted: 0 }
    return anomalies.reduce(
      (acc, a) => {
        const state = getEffectiveState(a)
        if (state === 'muted') {
          acc.muted += 1
        } else if (a.severity === 'critical') {
          acc.critical += 1
        } else if (a.severity === 'warning') {
          acc.warning += 1
        } else {
          acc.info += 1
        }
        return acc
      },
      { critical: 0, warning: 0, info: 0, muted: 0 }
    )
  }, [anomalies, getEffectiveState])

  const selectedKey = selectedAnomaly ? getKey(selectedAnomaly) : null

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-terminal-text text-xl font-semibold">Anomaly Action Center</h1>
          <p className="text-terminal-muted text-sm mt-1">
            {lastCheck
              ? `Last check: ${formatTs(lastCheck)}`
              : 'Detect · acknowledge · mute · resolve operational events'}
          </p>
        </div>
        <button
          type="button"
          onClick={refresh}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-terminal-muted hover:text-terminal-text border border-terminal-border hover:border-terminal-bright rounded transition-all"
        >
          <RefreshCw size={11} className={al ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Active Issues tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          {
            label: 'Critical',
            count: counts.critical,
            color: 'text-bear-default',
            border: 'border-bear-default/20',
            bg: 'bg-bear-default/5',
          },
          {
            label: 'Warning',
            count: counts.warning,
            color: 'text-signal-high',
            border: 'border-signal-high/20',
            bg: 'bg-signal-high/5',
          },
          {
            label: 'Info',
            count: counts.info,
            color: 'text-signal-medium',
            border: 'border-signal-medium/20',
            bg: 'bg-signal-medium/5',
          },
          {
            label: 'Muted',
            count: counts.muted,
            color: 'text-zinc-500',
            border: 'border-zinc-600/20',
            bg: 'bg-zinc-800/20',
          },
        ].map(({ label, count, color, border, bg }) => (
          <div key={label} className={`glass-card rounded-lg px-5 py-4 border ${border} ${bg}`}>
            <p className="text-terminal-muted text-xs uppercase tracking-wider mb-1">{label}</p>
            <p className={`font-mono font-bold text-3xl ${color}`}>{al ? '—' : count}</p>
          </div>
        ))}
      </div>

      {/* Anomaly feed */}
      <div>
        <p className="text-terminal-muted text-xs uppercase tracking-wider mb-3">
          Recent Anomalies (last 96h)
        </p>
        <div className="glass-card rounded-lg overflow-hidden">
          {al ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="px-5 py-4 border-b border-terminal-border/50">
                <div className="skeleton h-3 w-16 mb-2 rounded" />
                <div className="skeleton h-2.5 w-full mb-1 rounded" />
                <div className="skeleton h-2.5 w-2/3 rounded" />
              </div>
            ))
          ) : !anomalies?.length ? (
            <div className="px-5 py-10 text-center space-y-1">
              <p className="text-bull-default text-sm font-semibold">No anomalies detected</p>
              <p className="text-terminal-muted text-xs">
                {lastCheck
                  ? 'System operating within normal parameters'
                  : 'Health checks run hourly — anomaly monitoring starts after the first scan cycle'}
              </p>
            </div>
          ) : (
            sortedAnomalies.map(a => {
              const key = getKey(a)
              const effectiveState = getEffectiveState(a)
              const isMuted = effectiveState === 'muted'
              const stored = storedStates[key]
              const mutedRemaining =
                isMuted && stored?.mutedUntil
                  ? Math.max(0, Math.ceil((stored.mutedUntil - Date.now()) / 60_000))
                  : null

              return (
                <div
                  key={key}
                  className={`px-5 py-3.5 border-b border-terminal-border/50 last:border-0 hover:bg-terminal-bright/10 transition-colors ${isMuted ? 'opacity-50' : ''}`}
                >
                  <div className="flex items-start gap-3">
                    <AnomalyBadge severity={a.severity} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-0.5">
                        <StateBadge state={effectiveState} />
                        {isMuted && mutedRemaining !== null && (
                          <span className="flex items-center gap-1 text-zinc-500 text-[10px] font-mono">
                            <Clock size={10} />
                            {mutedRemaining}m remaining
                          </span>
                        )}
                      </div>
                      <p className="text-terminal-text text-xs leading-relaxed">{a.description}</p>
                      <div className="flex items-center gap-4 mt-1.5 flex-wrap">
                        <span className="text-terminal-muted/60 text-xs font-mono uppercase tracking-wide">
                          {a.anomaly_type.replace(/_/g, ' ')}
                        </span>
                        {a.metric_value != null && (
                          <span className="text-terminal-muted/60 text-xs font-mono">
                            value: {a.metric_value} · threshold: {a.threshold ?? '—'}
                          </span>
                        )}
                        <span className="text-terminal-muted/40 text-xs font-mono ml-auto">
                          {formatTs(a.detected_at)}
                        </span>
                      </div>
                    </div>
                    <RowActions
                      anomalyKey={key}
                      anomaly={a}
                      muteMenuFor={muteMenuFor}
                      onAcknowledge={() => updateAnomalyState(a, 'acknowledged')}
                      onMute={ms => updateAnomalyState(a, 'muted', Date.now() + ms)}
                      onResolve={() => updateAnomalyState(a, 'resolved')}
                      onDetail={() => setSelectedAnomaly(a)}
                      onToggleMuteMenu={() =>
                        setMuteMenuFor(prev => (prev === key ? null : key))
                      }
                    />
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* Detail drawer */}
      {selectedAnomaly && selectedKey && (
        <DetailDrawer
          anomaly={selectedAnomaly}
          effectiveState={getEffectiveState(selectedAnomaly)}
          muteMenuFor={muteMenuFor}
          anomalyKey={selectedKey}
          onClose={() => setSelectedAnomaly(null)}
          onAcknowledge={() => {
            updateAnomalyState(selectedAnomaly, 'acknowledged')
          }}
          onMute={ms => {
            updateAnomalyState(selectedAnomaly, 'muted', Date.now() + ms)
          }}
          onResolve={() => {
            updateAnomalyState(selectedAnomaly, 'resolved')
          }}
          onToggleMuteMenu={() =>
            setMuteMenuFor(prev => (prev === selectedKey ? null : selectedKey))
          }
        />
      )}

      {/* Monitored Checks glossary */}
      <div>
        <p className="text-terminal-muted text-xs uppercase tracking-wider mb-3">Monitored Checks</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {[
            ['win_rate_degradation',  'Win rate drops ≥12 pp vs 30d baseline'],
            ['expectancy_negative',   'Rolling expectancy turns negative (n≥20)'],
            ['false_positive_spike',  'SL hit rate exceeds 70%'],
            ['drawdown_spike',        'Max drawdown exceeds 5R warning / 10R critical'],
            ['calibration_drift',     'ECE exceeds 0.12 or drifts +0.05 from last snapshot'],
            ['scan_failure_spike',    'Scan failure rate exceeds 15% / 30%'],
            ['ai_error_spike',        'Claude API error rate exceeds 8% / 15%'],
            ['queue_backlog',         'Celery queue depth exceeds 10 / 30 tasks'],
          ].map(([name, desc]) => (
            <div key={name} className="glass-card rounded-md px-3 py-2 flex gap-2">
              <span className="text-terminal-muted/60 font-mono text-xs shrink-0 mt-0.5">→</span>
              <div>
                <p className="text-terminal-text text-xs font-mono">{name}</p>
                <p className="text-terminal-muted text-sm mt-1">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
