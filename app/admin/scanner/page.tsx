'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { ScanLine, Play, Square, AlertOctagon, RefreshCw, AlertTriangle, CheckCircle, Clock } from 'lucide-react'
import { TradingSignal, ScannerMode, RejectionStats } from '@/types'
import { adminApi } from '@/lib/admin-api'
import { cn } from '@/lib/utils'

// ─── Types ────────────────────────────────────────────────────────────────────

interface CeleryStatus {
  enabled:      boolean
  scanning:     boolean
  running_modes: string[]
  last_scan_at: number | null
}

// ─── Schedule reference ───────────────────────────────────────────────────────

const SCHEDULE = [
  { mode: 'spot',             label: 'Standard',         interval: 'Every 15 min',          coins: 80,  minConf: 80  },
  { mode: 'high_confidence',  label: 'High Confidence',  interval: 'Every 30 min (:05, :35)', coins: 30,  minConf: 87  },
  { mode: 'futures',          label: 'Futures',          interval: 'Every 30 min (:10, :40)', coins: 50,  minConf: 82  },
]

const MODE_COLORS: Record<string, string> = {
  spot:            'text-sky-400    border-sky-400/20    bg-sky-400/5',
  futures:         'text-purple-400 border-purple-400/20 bg-purple-400/5',
  high_confidence: 'text-emerald-400 border-emerald-400/20 bg-emerald-400/5',
  trending:        'text-amber-400  border-amber-400/20  bg-amber-400/5',
}

const MODES: ScannerMode[] = ['spot', 'futures', 'high_confidence', 'trending']

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(ts: number | null): string {
  if (!ts) return '—'
  const diff = Math.floor(Date.now() / 1000 - ts)
  if (diff < 60)   return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  return `${Math.floor(diff / 3600)}h ago`
}

function nextScanIn(lastScanAt: number | null, intervalMin = 15): string {
  if (!lastScanAt) return '—'
  const nextAt = lastScanAt + intervalMin * 60
  const diff   = Math.floor(nextAt - Date.now() / 1000)
  if (diff <= 0) return 'Now'
  if (diff < 60)   return `${diff}s`
  return `${Math.floor(diff / 60)}m ${diff % 60}s`
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AdminScannerPage() {
  const [status,   setStatus]   = useState<CeleryStatus | null>(null)
  const [error,    setError]    = useState<string | null>(null)
  const [loading,  setLoading]  = useState(false)
  const [scanMode, setScanMode] = useState<ScannerMode>('spot')
  const [scanning, setScanning] = useState(false)
  const [scanMsg,  setScanMsg]  = useState<string | null>(null)

  // rejection stats still from Next.js layer (populated during Scan Now)
  const [rejStats, setRejStats] = useState<RejectionStats | null>(null)

  const fetchStatus = useCallback(async () => {
    try {
      const res = await adminApi.scheduler.status()
      if (res.success && res.data) setStatus(res.data)
    } catch { /* silent */ }
  }, [])

  useEffect(() => {
    fetchStatus()
    const t = setInterval(fetchStatus, 8_000)
    return () => clearInterval(t)
  }, [fetchStatus])

  // fetch rejection stats from existing control endpoint
  const fetchRejStats = useCallback(async () => {
    try {
      const res = await fetch('/api/scanner/control')
      const j   = await res.json()
      if (j.rejectionStats) setRejStats(j.rejectionStats)
    } catch { /* silent */ }
  }, [])
  useEffect(() => { fetchRejStats() }, [fetchRejStats])

  const handleEnable = async () => {
    setLoading(true); setError(null)
    try {
      await adminApi.scheduler.start()
      await fetchStatus()
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed') }
    finally { setLoading(false) }
  }

  const handleDisable = async () => {
    setLoading(true); setError(null)
    try {
      await adminApi.scheduler.stop()
      await fetchStatus()
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed') }
    finally { setLoading(false) }
  }

  const handleScanNow = async () => {
    setScanning(true); setScanMsg(null); setError(null)
    try {
      const res  = await fetch('/api/scanner/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: scanMode }),
      })
      const json = await res.json()
      if (res.status === 423) { setError('A scan is already running — wait for it to finish.'); return }
      if (!json.success)       { setError(json.error ?? 'Scan failed'); return }
      setScanMsg(`Scan queued (${scanMode}) — results appear in Signals page within ~60s`)
      await fetchStatus()
    } catch (e) { setError(e instanceof Error ? e.message : 'Network error') }
    finally { setScanning(false) }
  }

  const isEnabled = status?.enabled ?? null

  return (
    <div className="space-y-6 max-w-5xl mx-auto">

      {/* Header */}
      <div className="flex items-center gap-3">
        <ScanLine className="w-6 h-6 text-blue-400" />
        <div>
          <h1 className="text-terminal-text text-xl font-semibold">Scanner Control</h1>
          <p className="text-terminal-muted text-sm mt-0.5">
            Scanning runs via <span className="text-terminal-text font-medium">Celery Beat on Railway</span> — automatic, no manual start needed
          </p>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-900/20 border border-red-800 text-red-300 text-sm flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)}>✕</button>
        </div>
      )}

      {scanMsg && (
        <div className="p-3 rounded-lg bg-emerald-900/20 border border-emerald-700/50 text-emerald-300 text-sm flex items-center gap-2">
          <CheckCircle className="w-4 h-4 shrink-0" />
          {scanMsg}
        </div>
      )}

      {/* Status strip */}
      <div className="glass-card rounded-xl p-5">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className={cn(
              'w-3 h-3 rounded-full',
              status === null        ? 'bg-zinc-500 animate-pulse'
              : isEnabled && status.scanning ? 'bg-blue-400 animate-pulse'
              : isEnabled            ? 'bg-emerald-400 animate-pulse'
              : 'bg-zinc-600',
            )} />
            <div>
              <p className="text-terminal-text font-semibold">
                {status === null        ? 'Connecting…'
                : isEnabled && status.scanning ? `Scanning — ${status.running_modes.join(', ')}`
                : isEnabled            ? 'Active — waiting for next scheduled scan'
                : 'Paused — auto-scanning disabled'}
              </p>
              <p className="text-terminal-muted text-xs mt-0.5">
                Last scan: <span className="text-terminal-text">{timeAgo(status?.last_scan_at ?? null)}</span>
                {' · '}
                Next standard: <span className="text-terminal-text">{nextScanIn(status?.last_scan_at ?? null, 15)}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {isEnabled === false ? (
              <button
                onClick={handleEnable}
                disabled={loading}
                className="flex items-center gap-2 text-sm px-4 py-2 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/25 transition-colors disabled:opacity-40"
              >
                <Play className="w-4 h-4" /> Enable Auto-Scan
              </button>
            ) : (
              <button
                onClick={handleDisable}
                disabled={loading || status === null}
                className="flex items-center gap-2 text-sm px-4 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-300 hover:bg-zinc-700 transition-colors disabled:opacity-40"
              >
                <Square className="w-4 h-4" /> Disable Auto-Scan
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Manual scan */}
      <div className="glass-card rounded-xl p-5">
        <p className="text-terminal-muted text-xs uppercase tracking-wider mb-4 font-semibold">Manual Scan</p>
        <div className="flex items-center gap-3 flex-wrap">
          {/* Mode selector */}
          <div className="flex gap-1">
            {MODES.map(m => (
              <button
                key={m}
                onClick={() => setScanMode(m)}
                className={cn(
                  'text-sm px-3 py-2 rounded-lg border transition-colors font-medium',
                  scanMode === m
                    ? MODE_COLORS[m] ?? 'bg-terminal-bright/20 border-terminal-border text-terminal-text'
                    : 'border-transparent text-terminal-muted hover:text-terminal-text',
                )}
              >
                {m.replace('_', ' ')}
              </button>
            ))}
          </div>

          <button
            onClick={handleScanNow}
            disabled={scanning}
            className="flex items-center gap-2 text-sm px-4 py-2 rounded-lg bg-blue-500/15 border border-blue-500/30 text-blue-300 hover:bg-blue-500/25 transition-colors disabled:opacity-40 ml-auto"
          >
            {scanning
              ? <><RefreshCw className="w-4 h-4 animate-spin" /> Queuing…</>
              : <><ScanLine className="w-4 h-4" /> Scan Now</>
            }
          </button>
        </div>
        <p className="text-terminal-muted/50 text-xs mt-3">
          Runs the Python scanner on Railway immediately. Results appear in Signals within ~60s.
        </p>
      </div>

      {/* Automatic schedule */}
      <div>
        <p className="text-terminal-muted text-xs uppercase tracking-wider mb-3 font-semibold">Automatic Schedule (Celery Beat · Railway)</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {SCHEDULE.map(s => (
            <div key={s.mode} className="glass-card rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <span className={cn('text-xs font-mono font-semibold px-2 py-0.5 rounded border', MODE_COLORS[s.mode])}>
                  {s.label}
                </span>
                {status?.running_modes?.includes(s.mode) && (
                  <span className="text-xs text-blue-400 font-semibold animate-pulse">● RUNNING</span>
                )}
              </div>
              <div className="space-y-1.5 text-sm">
                <div className="flex items-center gap-2 text-terminal-muted">
                  <Clock className="w-3.5 h-3.5 shrink-0" />
                  <span>{s.interval}</span>
                </div>
                <p className="text-terminal-muted/70 text-xs">
                  Scans <span className="text-terminal-text">{s.coins} coins</span> · Min confidence <span className="text-terminal-text">{s.minConf}%</span>
                </p>
              </div>
            </div>
          ))}
        </div>
        <p className="text-terminal-muted/40 text-xs mt-2">
          Celery Beat fires these tasks automatically — runs 24/7 on Railway regardless of this dashboard.
        </p>
      </div>

      {/* Rejection stats (populated when Scan Now is used via TS layer) */}
      {rejStats && rejStats.totalScanned > 0 && (
        <div>
          <p className="text-terminal-muted text-xs uppercase tracking-wider mb-3 font-semibold">
            Last Manual Scan — Rejection Breakdown
          </p>
          <div className="grid grid-cols-4 gap-3 mb-4">
            {[
              { label: 'Scanned',     value: rejStats.totalScanned,  color: 'text-terminal-text' },
              { label: 'Accepted',    value: rejStats.totalAccepted, color: 'text-emerald-400' },
              { label: 'Rejected',    value: rejStats.totalRejected, color: 'text-red-400' },
              { label: 'Accept Rate', value: rejStats.totalScanned > 0 ? `${((rejStats.totalAccepted / rejStats.totalScanned) * 100).toFixed(1)}%` : '0%', color: 'text-blue-400' },
            ].map(c => (
              <div key={c.label} className="glass-card rounded-xl px-4 py-3">
                <p className="text-terminal-muted text-[10px] uppercase tracking-widest mb-1">{c.label}</p>
                <p className={`text-2xl font-bold font-mono ${c.color}`}>{c.value}</p>
              </div>
            ))}
          </div>
          {rejStats.topReasons.length > 0 && (
            <div className="glass-card rounded-xl p-4">
              <p className="text-terminal-muted text-xs uppercase tracking-wider mb-3">Top Rejection Gates</p>
              <div className="space-y-2.5">
                {rejStats.topReasons.map(r => (
                  <div key={r.stage}>
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-terminal-text text-sm capitalize">{r.stage.replace(/_/g, ' ')}</span>
                      <span className="text-terminal-muted text-xs font-mono">{r.count} · {r.pct}%</span>
                    </div>
                    <div className="h-1 bg-zinc-800 rounded-full overflow-hidden">
                      <div className="h-full rounded-full bg-blue-400/40" style={{ width: `${r.pct}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
