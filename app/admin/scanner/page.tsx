'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  ScanLine, Play, Square, Pause, RotateCcw, AlertOctagon,
  RefreshCw, AlertTriangle, ChevronDown,
} from 'lucide-react'
import { TradingSignal, CoinData, ScannerMode, RejectionStats, RejectionStage } from '@/types'
import { cn } from '@/lib/utils'

// ─── Types ────────────────────────────────────────────────────────────────────

interface SchedulerStatus {
  started:       boolean
  scanning:      boolean
  paused:        boolean
  emergencyStop: boolean
  mode:          ScannerMode
  scanCount:     number
  errorCount:    number
  lastScanAt:    number | null
  nextScanAt:    number | null
  intervalMs:    number
  uptime?:       number
}

interface ControlData {
  success:        boolean
  error?:         string
  scheduler:      SchedulerStatus
  rejectionStats: RejectionStats | null
  computedAt:     string
}

// ─── Stage metadata ──────────────────────────────────────────────────────────

const STAGE_LABELS: Record<RejectionStage, string> = {
  candles:          'Insufficient Data',
  direction:        'No Trend Direction',
  mtf:              'Timeframe Conflict',
  volatility:       'Extreme Volatility',
  trend_strength:   'Weak Trend',
  market_structure: 'Market Structure',
  setup_score:      'Setup Quality',
  rr_ratio:         'Risk / Reward',
  volume_tier:      'Low Volume',
  risk_engine:      'Risk Engine',
  funding_rate:     'Extreme Funding',
  extension_risk:   'Extension Risk',
  continuation:     'Low Continuation',
  ai_validation:    'AI Confidence',
}

const STAGE_COLOR: Record<RejectionStage, string> = {
  ai_validation:    'text-amber-400',
  trend_strength:   'text-blue-400',
  market_structure: 'text-purple-400',
  continuation:     'text-cyan-400',
  setup_score:      'text-orange-400',
  mtf:              'text-red-400',
  direction:        'text-zinc-500',
  rr_ratio:         'text-yellow-400',
  volatility:       'text-red-500',
  volume_tier:      'text-indigo-400',
  risk_engine:      'text-red-500',
  extension_risk:   'text-amber-300',
  funding_rate:     'text-red-400',
  candles:          'text-zinc-600',
}

const MODES: ScannerMode[] = ['spot', 'futures', 'high_confidence', 'trending']

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusPill({ status }: { status: SchedulerStatus }) {
  if (status.emergencyStop) return (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-red-500/15 border border-red-500/30 text-red-400">
      <AlertOctagon className="w-3 h-3" /> Emergency Stop
    </span>
  )
  if (status.paused) return (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-400">
      <Pause className="w-3 h-3" /> Paused
    </span>
  )
  if (status.scanning) return (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-blue-500/15 border border-blue-500/30 text-blue-400">
      <RefreshCw className="w-3 h-3 animate-spin" /> Scanning
    </span>
  )
  if (status.started) return (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-green-500/15 border border-green-500/30 text-green-400">
      <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" /> Active
    </span>
  )
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-zinc-500/15 border border-zinc-500/30 text-zinc-400">
      <Square className="w-3 h-3" /> Stopped
    </span>
  )
}

function TimeStr({ ts }: { ts: number | null }) {
  if (!ts) return <span className="text-zinc-600">—</span>
  const d = new Date(ts)
  return <span>{d.toLocaleTimeString()}</span>
}

function OverviewStrip({ stats }: { stats: RejectionStats }) {
  const rate = stats.totalScanned > 0
    ? ((stats.totalAccepted / stats.totalScanned) * 100).toFixed(1)
    : '0'
  const cards = [
    { label: 'Scanned',     value: stats.totalScanned,  color: 'text-white'       },
    { label: 'Accepted',    value: stats.totalAccepted, color: 'text-green-400'   },
    { label: 'Rejected',    value: stats.totalRejected, color: 'text-red-400'     },
    { label: 'Accept Rate', value: `${rate}%`,          color: parseFloat(rate) === 0 ? 'text-zinc-500' : parseFloat(rate) >= 10 ? 'text-green-400' : 'text-amber-400' },
  ]
  return (
    <div className="grid grid-cols-4 gap-3">
      {cards.map(c => (
        <div key={c.label} className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3">
          <p className="text-zinc-500 text-[10px] uppercase tracking-widest mb-1">{c.label}</p>
          <p className={cn('text-2xl font-bold font-mono tabular-nums', c.color)}>{c.value}</p>
        </div>
      ))}
    </div>
  )
}

function RejectionBreakdown({ stats }: { stats: RejectionStats }) {
  const total = stats.totalRejected
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
      <h3 className="text-white text-sm font-semibold mb-3 flex items-center gap-2">
        Rejection Breakdown
        <span className="ml-auto text-zinc-600 text-[10px] font-normal">{total} total</span>
      </h3>
      {stats.topReasons.length === 0 ? (
        <p className="text-zinc-600 text-xs py-4 text-center">No scan data yet — run a scan to see rejection analysis.</p>
      ) : (
        <div className="space-y-2.5">
          {stats.topReasons.map(r => (
            <div key={r.stage}>
              <div className="flex items-center justify-between mb-0.5">
                <span className={cn('text-xs font-medium', STAGE_COLOR[r.stage] ?? 'text-zinc-500')}>
                  {STAGE_LABELS[r.stage] ?? r.stage}
                </span>
                <span className="text-zinc-500 text-xs font-mono tabular-nums">{r.count} · {r.pct}%</span>
              </div>
              <div className="h-1 bg-zinc-800 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500 bg-current opacity-50"
                  style={{ width: `${r.pct}%`, color: STAGE_COLOR[r.stage] }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function NearMissPanel({ stats }: { stats: RejectionStats }) {
  const items = stats.nearMisses
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
      <h3 className="text-white text-sm font-semibold mb-3 flex items-center gap-2">
        Near-Miss Opportunities
        <span className="ml-auto text-zinc-600 text-[10px] font-normal">{items.length} setups</span>
      </h3>
      {items.length === 0 ? (
        <p className="text-zinc-600 text-xs py-4 text-center">
          {stats.totalScanned === 0
            ? 'No scan data yet — run a scan to surface near-miss setups.'
            : 'No near-miss setups in this scan. All rejections were decisive.'}
        </p>
      ) : (
        <div className="space-y-2">
          {items.map((entry, i) => {
            const hasMetrics = entry.threshold !== undefined && entry.actual !== undefined
            const missBy = hasMetrics ? (entry.threshold! - entry.actual!).toFixed(1) : null
            return (
              <div key={i} className="flex items-start gap-3 py-2 border-b border-zinc-800/60 last:border-0">
                <span className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-amber-400/10 border border-amber-400/20 text-amber-400 text-xs font-bold font-mono shrink-0 mt-0.5">
                  {entry.symbol.slice(0, 3)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-white text-xs font-semibold">{entry.symbol}</span>
                    <span className={cn('text-[10px] font-medium px-1.5 py-0.5 rounded border', STAGE_COLOR[entry.stage] ?? 'text-zinc-500')}>
                      {STAGE_LABELS[entry.stage] ?? entry.stage}
                    </span>
                  </div>
                  {hasMetrics && (
                    <p className="text-zinc-600 text-[11px] mt-0.5 font-mono">
                      {entry.actual} / {entry.threshold} required
                      {missBy && <span className="text-amber-400/80 ml-1.5">— missed by {missBy}</span>}
                    </p>
                  )}
                  <p className="text-zinc-600 text-[10px] mt-0.5 truncate">{entry.reason}</p>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function CalibrationBadge({ stats }: { stats: RejectionStats | null }) {
  if (!stats || stats.scannedAt === 0) return null
  const nearMissRate = stats.totalRejected > 0
    ? (stats.nearMisses.length / stats.totalRejected) * 100
    : 0
  const scanAge = Math.round((Date.now() - stats.scannedAt) / 60_000)
  const tooTight = nearMissRate > 20

  return (
    <div className={cn(
      'flex items-center gap-3 px-4 py-2.5 rounded-xl border text-xs',
      tooTight
        ? 'bg-amber-400/5 border-amber-400/20 text-amber-400'
        : 'bg-zinc-900 border-zinc-800 text-zinc-500',
    )}>
      <span>{tooTight ? '⚠' : '✓'}</span>
      <span>
        {tooTight
          ? `${stats.nearMisses.length} near-misses (${nearMissRate.toFixed(0)}% of rejections) — thresholds may be over-filtering`
          : 'Calibration nominal — rejection margins are decisive'}
      </span>
      <span className="ml-auto text-zinc-600">
        {scanAge < 1 ? 'just now' : `${scanAge}m ago`}
      </span>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AdminScannerPage() {
  const [controlData, setControlData] = useState<ControlData | null>(null)
  const [error, setError]             = useState<string | null>(null)
  const [actionLoading, setAL]        = useState(false)
  const [selectedMode, setMode]       = useState<ScannerMode>('spot')
  const [intervalMin, setIntervalMin]  = useState(5)
  const prevScanning                  = useRef(false)

  const fetchControl = useCallback(async () => {
    try {
      const res  = await fetch('/api/scanner/control')
      const json = await res.json()
      if (json.success) {
        setControlData(json)
        setError(null)
        if (json.scheduler?.mode) setMode(json.scheduler.mode)
      } else {
        setError(json.error)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  useEffect(() => {
    fetchControl()
    const t = setInterval(fetchControl, 5_000)
    return () => clearInterval(t)
  }, [fetchControl])

  // Detect scan completion — refresh rejection stats
  const scheduler = controlData?.scheduler
  useEffect(() => {
    if (prevScanning.current && scheduler && !scheduler.scanning) {
      void fetchControl()
    }
    prevScanning.current = scheduler?.scanning ?? false
  }, [scheduler?.scanning, fetchControl])

  const doAction = useCallback(async (
    action: string,
    extra?: Record<string, unknown>
  ) => {
    setAL(true)
    setError(null)
    try {
      const body: Record<string, unknown> = { action, ...extra }
      const res  = await fetch('/api/scanner/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!json.success) setError(json.error ?? 'Action failed')
      else void fetchControl()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setAL(false)
    }
  }, [fetchControl])

  const handleStart = () => doAction('start', {
    config: { mode: selectedMode, intervalMs: intervalMin * 60_000 }
  })
  const handleStop          = () => doAction('stop')
  const handlePause         = () => doAction('pause')
  const handleResume        = () => doAction('resume')
  const handleEmergencyStop = () => doAction('emergency_stop')
  const handleReset         = () => doAction('reset')

  const handleManualScan = useCallback(async () => {
    setAL(true)
    setError(null)
    try {
      const res  = await fetch('/api/scanner/run', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: selectedMode }),
      })
      const json = await res.json()
      if (res.status === 423) { setError('A scan is already running — please wait.'); return }
      if (!json.success)      { setError(json.error ?? 'Scan failed'); return }
      void fetchControl()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setAL(false)
    }
  }, [selectedMode, fetchControl])

  const stats = controlData?.rejectionStats ?? null
  const disabled = actionLoading

  return (
    <div className="p-6 space-y-5 max-w-6xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ScanLine className="w-6 h-6 text-blue-400" />
          <div>
            <h1 className="text-xl font-semibold text-white">Scanner Control</h1>
            <p className="text-sm text-zinc-400">10-gate signal pipeline · mode control · rejection diagnostics</p>
          </div>
        </div>
        {scheduler && (
          <div className="flex items-center gap-3">
            <StatusPill status={scheduler} />
            <span className="text-xs text-zinc-600">{scheduler.scanCount} scans</span>
          </div>
        )}
      </div>

      {/* Error banner */}
      {error && (
        <div className="p-3 rounded-lg bg-red-900/30 border border-red-800 text-red-300 text-sm flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-300">✕</button>
        </div>
      )}

      {/* Emergency stop banner */}
      {scheduler?.emergencyStop && (
        <div className="p-4 rounded-xl bg-red-900/20 border border-red-500/40 flex items-center gap-4">
          <AlertOctagon className="w-5 h-5 text-red-400 shrink-0" />
          <div className="flex-1">
            <div className="text-sm font-semibold text-red-400">Emergency Stop Active</div>
            <div className="text-xs text-zinc-500 mt-0.5">All scanning is halted. Reset the system to resume operations.</div>
          </div>
          <button
            onClick={handleReset}
            disabled={disabled}
            className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-red-500/15 border border-red-500/30 text-red-300 hover:bg-red-500/25 transition-colors disabled:opacity-50"
          >
            <RotateCcw className="w-3.5 h-3.5" /> Reset System
          </button>
        </div>
      )}

      {/* Control panel */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
        <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-4">Controls</h2>
        <div className="flex flex-wrap items-end gap-4">

          {/* Mode selector */}
          <div className="space-y-1.5">
            <label className="text-xs text-zinc-500">Mode</label>
            <div className="flex gap-1">
              {MODES.map(m => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={[
                    'text-xs px-2.5 py-1.5 rounded border transition-colors',
                    selectedMode === m
                      ? 'bg-blue-500/20 border-blue-500/40 text-blue-300'
                      : 'border-zinc-700 text-zinc-500 hover:text-zinc-300',
                  ].join(' ')}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>

          {/* Interval */}
          <div className="space-y-1.5">
            <label className="text-xs text-zinc-500">Interval</label>
            <div className="flex gap-1">
              {[5, 10, 15, 30].map(min => (
                <button
                  key={min}
                  onClick={() => setIntervalMin(min)}
                  className={[
                    'text-xs px-2.5 py-1.5 rounded border transition-colors',
                    intervalMin === min
                      ? 'bg-zinc-700 border-zinc-600 text-white'
                      : 'border-zinc-700 text-zinc-500 hover:text-zinc-300',
                  ].join(' ')}
                >
                  {min}m
                </button>
              ))}
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex gap-2 ml-auto">
            <button
              onClick={handleManualScan}
              disabled={disabled || (scheduler?.scanning ?? false) || (scheduler?.emergencyStop ?? false)}
              className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-blue-500/30 bg-blue-500/10 text-blue-300 hover:bg-blue-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ScanLine className="w-3.5 h-3.5" />
              Scan Now
            </button>

            {!scheduler?.started ? (
              <button
                onClick={handleStart}
                disabled={disabled || (scheduler?.emergencyStop ?? false)}
                className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-green-500/30 bg-green-500/10 text-green-300 hover:bg-green-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Play className="w-3.5 h-3.5" /> Start Auto
              </button>
            ) : scheduler?.paused ? (
              <button
                onClick={handleResume}
                disabled={disabled}
                className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-green-500/30 bg-green-500/10 text-green-300 hover:bg-green-500/20 transition-colors disabled:opacity-40"
              >
                <Play className="w-3.5 h-3.5" /> Resume
              </button>
            ) : (
              <button
                onClick={handlePause}
                disabled={disabled}
                className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 transition-colors disabled:opacity-40"
              >
                <Pause className="w-3.5 h-3.5" /> Pause
              </button>
            )}

            <button
              onClick={handleStop}
              disabled={disabled || !(scheduler?.started ?? false)}
              className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-zinc-600 bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors disabled:opacity-40"
            >
              <Square className="w-3.5 h-3.5" /> Stop
            </button>

            <button
              onClick={handleEmergencyStop}
              disabled={disabled || (scheduler?.emergencyStop ?? false)}
              className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-40"
            >
              <AlertOctagon className="w-3.5 h-3.5" /> E-Stop
            </button>
          </div>
        </div>
      </div>

      {/* Scheduler status strip */}
      {scheduler && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Scan Count',   value: scheduler.scanCount },
            { label: 'Error Count',  value: scheduler.errorCount, warn: scheduler.errorCount > 3 },
            { label: 'Last Scan',    value: <TimeStr ts={scheduler.lastScanAt} /> },
            { label: 'Next Scan',    value: scheduler.started && !scheduler.paused ? <TimeStr ts={scheduler.nextScanAt} /> : <span className="text-zinc-600">—</span> },
          ].map((m, i) => (
            <div key={i} className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3">
              <div className="text-[10px] text-zinc-500 uppercase tracking-widest mb-1">{m.label}</div>
              <div className={cn('text-base font-bold font-mono', (m as any).warn ? 'text-red-400' : 'text-white')}>
                {m.value}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Diagnostics */}
      {stats && (
        <div className="space-y-4">
          <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest">Rejection Diagnostics</h2>
          <OverviewStrip stats={stats} />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <RejectionBreakdown stats={stats} />
            <NearMissPanel stats={stats} />
          </div>
          <CalibrationBadge stats={stats} />
        </div>
      )}

      {!controlData && !error && (
        <div className="flex items-center justify-center h-32 text-zinc-500 text-sm">
          <RefreshCw className="w-4 h-4 animate-spin mr-2" /> Loading…
        </div>
      )}
    </div>
  )
}
