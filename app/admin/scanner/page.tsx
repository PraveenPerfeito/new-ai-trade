'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { ScanLine, Play, Square, RefreshCw, AlertTriangle, CheckCircle, Clock, ArrowRight } from 'lucide-react'
import { ScannerMode, RejectionStats } from '@/types'
import { adminApi } from '@/lib/admin-api'
import { cn } from '@/lib/utils'
import Link from 'next/link'

// ─── Types ────────────────────────────────────────────────────────────────────

interface CeleryStatus {
  enabled: boolean; scanning: boolean; running_modes: string[]; last_scan_at: number | null
}

const MODE_COLORS: Record<string, string> = {
  spot:            'text-sky-400     border-sky-400/20     bg-sky-400/5',
  futures:         'text-purple-400  border-purple-400/20  bg-purple-400/5',
  high_confidence: 'text-emerald-400 border-emerald-400/20 bg-emerald-400/5',
  trending:        'text-amber-400   border-amber-400/20   bg-amber-400/5',
}
const MODES: ScannerMode[] = ['spot', 'futures', 'high_confidence', 'trending']

function timeAgo(ts: number | null): string {
  if (!ts) return '—'
  const diff = Math.floor(Date.now() / 1000 - ts)
  if (diff < 60)   return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  return `${Math.floor(diff / 3600)}h ago`
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminScannerPage() {
  const [status,    setStatus]    = useState<CeleryStatus | null>(null)
  const [error,     setError]     = useState<string | null>(null)
  const [loading,   setLoading]   = useState(false)
  const [scanMode,  setScanMode]  = useState<ScannerMode>('spot')
  const [scanning,  setScanning]  = useState(false)
  const [scanDone,  setScanDone]  = useState(false)      // shows View Signals button
  const [countdown, setCountdown] = useState<number | null>(null)
  const [rejStats,  setRejStats]  = useState<RejectionStats | null>(null)
  const scanDoneTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

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

  // Rejection stats from Next.js layer
  useEffect(() => {
    fetch('/api/scanner/control').then(r => r.json()).then(j => {
      if (j.rejectionStats) setRejStats(j.rejectionStats)
    }).catch(() => {})
  }, [])

  // Live ticking countdown to next standard scan
  useEffect(() => {
    const tick = () => {
      if (!status?.last_scan_at) { setCountdown(null); return }
      const nextAt = status.last_scan_at + 15 * 60
      const diff   = Math.max(0, Math.floor(nextAt - Date.now() / 1000))
      setCountdown(diff)
    }
    tick()
    const t = setInterval(tick, 1000)
    return () => clearInterval(t)
  }, [status?.last_scan_at])

  const handleEnable = async () => {
    setLoading(true); setError(null)
    try { await adminApi.scheduler.start(); await fetchStatus() }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed') }
    finally { setLoading(false) }
  }

  const handleDisable = async () => {
    setLoading(true); setError(null)
    try { await adminApi.scheduler.stop(); await fetchStatus() }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed') }
    finally { setLoading(false) }
  }

  const handleScanNow = async () => {
    setScanning(true); setScanDone(false); setError(null)
    if (scanDoneTimer.current) clearTimeout(scanDoneTimer.current)
    try {
      const res  = await fetch('/api/scanner/run', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: scanMode }),
      })
      const json = await res.json()
      if (res.status === 423) { setError('A scan is already running — wait for it to finish.'); return }
      if (!json.success)      { setError(json.error ?? 'Scan failed'); return }
      setScanDone(true)
      // Auto-hide View Signals button after 30s
      scanDoneTimer.current = setTimeout(() => setScanDone(false), 30_000)
      await fetchStatus()
    } catch (e) { setError(e instanceof Error ? e.message : 'Network error') }
    finally { setScanning(false) }
  }

  const isEnabled = status?.enabled ?? null

  const fmtCountdown = (s: number) => {
    const m = Math.floor(s / 60)
    const sec = s % 60
    return m > 0 ? `${m}m ${sec.toString().padStart(2, '0')}s` : `${sec}s`
  }

  return (
    <div className="space-y-5 max-w-5xl mx-auto p-4 sm:p-6">

      {/* Header */}
      <div className="flex items-center gap-3">
        <ScanLine className="w-6 h-6 text-blue-400 shrink-0" />
        <div>
          <h1 className="text-terminal-text text-lg sm:text-xl font-semibold">Scanner Control</h1>
          <p className="text-terminal-muted text-xs sm:text-sm mt-0.5">
            Celery Beat on Railway — auto-scans 24/7 · no manual start needed
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

      {/* Scan complete feedback + View Signals */}
      {scanDone && (
        <div className="p-3 rounded-lg bg-emerald-900/20 border border-emerald-700/50 text-emerald-300 text-sm flex items-center gap-3 flex-wrap">
          <CheckCircle className="w-4 h-4 shrink-0" />
          <span className="flex-1">Scan queued — results appear in Signals within ~60s</span>
          <Link
            href="/admin/signals"
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/30 transition-colors font-semibold whitespace-nowrap"
          >
            View Signals <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      )}

      {/* Status strip with live countdown */}
      <div className="glass-card rounded-xl p-4 sm:p-5">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className={cn(
              'w-3 h-3 rounded-full shrink-0',
              status === null              ? 'bg-zinc-500 animate-pulse'
              : isEnabled && status.scanning ? 'bg-blue-400 animate-pulse'
              : isEnabled                  ? 'bg-emerald-400 animate-pulse'
              : 'bg-zinc-600',
            )} />
            <div className="min-w-0">
              <p className="text-terminal-text font-semibold text-sm sm:text-base">
                {status === null              ? 'Connecting…'
                : isEnabled && status.scanning ? `Scanning — ${status.running_modes.join(', ') || 'standard'}`
                : isEnabled                  ? 'Active'
                : 'Paused'}
              </p>
              <div className="flex items-center gap-2 flex-wrap mt-0.5">
                <span className="text-terminal-muted text-xs">
                  Last: <span className="text-terminal-text">{timeAgo(status?.last_scan_at ?? null)}</span>
                </span>
                {isEnabled && !status?.scanning && countdown !== null && (
                  <span className="flex items-center gap-1 text-xs text-terminal-muted">
                    <Clock className="w-3 h-3" />
                    Next standard: <span className="text-white font-semibold font-mono ml-0.5">{fmtCountdown(countdown)}</span>
                  </span>
                )}
                {isEnabled && status?.scanning && (
                  <span className="text-xs text-blue-400 font-mono animate-pulse flex items-center gap-1">
                    <RefreshCw className="w-3 h-3 animate-spin" /> Scanning now…
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {isEnabled === false ? (
              <button onClick={handleEnable} disabled={loading}
                className="flex items-center gap-2 text-sm px-4 py-2 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/25 transition-colors disabled:opacity-40">
                <Play className="w-4 h-4" /> Enable
              </button>
            ) : (
              <button onClick={handleDisable} disabled={loading || status === null}
                className="flex items-center gap-2 text-sm px-4 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-300 hover:bg-zinc-700 transition-colors disabled:opacity-40">
                <Square className="w-4 h-4" /> Disable
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Manual scan */}
      <div className="glass-card rounded-xl p-4 sm:p-5">
        <p className="text-terminal-muted text-xs uppercase tracking-wider mb-3 font-semibold">Manual Scan</p>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1">
            {MODES.map(m => (
              <button key={m} onClick={() => setScanMode(m)}
                className={cn(
                  'text-sm px-3 py-2 rounded-lg border transition-colors font-medium',
                  scanMode === m ? MODE_COLORS[m] : 'border-transparent text-terminal-muted hover:text-terminal-text',
                )}>
                {m.replace('_', ' ')}
              </button>
            ))}
          </div>
          <button onClick={handleScanNow} disabled={scanning}
            className="flex items-center gap-2 text-sm px-4 py-2 rounded-lg bg-blue-500/15 border border-blue-500/30 text-blue-300 hover:bg-blue-500/25 transition-colors disabled:opacity-40 ml-auto">
            {scanning
              ? <><RefreshCw className="w-4 h-4 animate-spin" /> Queuing…</>
              : <><ScanLine className="w-4 h-4" /> Scan Now</>
            }
          </button>
        </div>
        {/* Compact schedule reference — replaces full schedule cards */}
        <p className="text-terminal-muted/40 text-xs mt-3 font-mono">
          Auto: standard 15m · high_conf 30m (:05,:35) · futures 30m (:10,:40) · outcomes 10m
        </p>
      </div>

      {/* Rejection stats */}
      {rejStats && rejStats.totalScanned > 0 && (
        <div>
          <p className="text-terminal-muted text-xs uppercase tracking-wider mb-3 font-semibold">Last Manual Scan — Rejection Breakdown</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            {[
              { label: 'Scanned',     value: rejStats.totalScanned,  color: 'text-terminal-text' },
              { label: 'Accepted',    value: rejStats.totalAccepted, color: 'text-emerald-400'   },
              { label: 'Rejected',    value: rejStats.totalRejected, color: 'text-red-400'       },
              { label: 'Accept Rate', value: rejStats.totalScanned > 0 ? `${((rejStats.totalAccepted / rejStats.totalScanned) * 100).toFixed(1)}%` : '0%', color: 'text-blue-400' },
            ].map(c => (
              <div key={c.label} className="glass-card rounded-xl px-4 py-3">
                <p className="text-terminal-muted text-[10px] uppercase tracking-widest mb-1">{c.label}</p>
                <p className={`text-xl font-bold font-mono ${c.color}`}>{c.value}</p>
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
