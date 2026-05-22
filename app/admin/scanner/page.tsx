'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { TradingSignal, CoinData, ScannerMode, RejectionStats, RejectionStage } from '@/types'
import { SchedulerStatus } from '@/lib/scheduler'
import { ScanCommandCenter } from '@/components/dashboard/scan-command-center'
import { ScannerControls }   from '@/components/dashboard/scanner-controls'
import { SignalsFeed }       from '@/components/dashboard/signals-feed'
import { TopCoinsTable }     from '@/components/dashboard/top-coins-table'
import { cn } from '@/lib/utils'

type Tab = 'command' | 'scanner' | 'diagnostics'

const POLL_SIGNALS_MS     = 30_000
const POLL_SCHEDULER_MS   = 10_000
const POLL_COINS_MS       = 5 * 60_000
const POLL_DIAGNOSTICS_MS = 30_000

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
  direction:        'text-terminal-muted',
  rr_ratio:         'text-yellow-400',
  volatility:       'text-red-500',
  volume_tier:      'text-indigo-400',
  risk_engine:      'text-[#ff3b5c]',
  extension_risk:   'text-amber-300',
  funding_rate:     'text-red-400',
  candles:          'text-terminal-muted/60',
}

// ─── Diagnostics sub-components ──────────────────────────────────────────────

function OverviewStrip({ stats }: { stats: RejectionStats }) {
  const rate = stats.totalScanned > 0
    ? ((stats.totalAccepted / stats.totalScanned) * 100).toFixed(1)
    : '0'
  const cards = [
    { label: 'Scanned',      value: stats.totalScanned,  color: 'text-terminal-text'  },
    { label: 'Accepted',     value: stats.totalAccepted, color: 'text-[#00d084]'       },
    { label: 'Rejected',     value: stats.totalRejected, color: 'text-[#ff3b5c]'       },
    { label: 'Accept Rate',  value: `${rate}%`,          color: rate === '0' ? 'text-terminal-muted' : parseFloat(rate) >= 10 ? 'text-[#00d084]' : 'text-amber-400' },
  ]
  return (
    <div className="grid grid-cols-4 gap-3">
      {cards.map(c => (
        <div key={c.label} className="glass-surface rounded-xl border border-terminal-border/40 px-4 py-3">
          <p className="text-terminal-muted/60 text-[10px] uppercase tracking-widest mb-1">{c.label}</p>
          <p className={cn('text-2xl font-bold font-mono tabular-nums', c.color)}>{c.value}</p>
        </div>
      ))}
    </div>
  )
}

function RejectionBreakdown({ stats }: { stats: RejectionStats }) {
  const total = stats.totalRejected
  return (
    <div className="glass-surface rounded-xl border border-terminal-border/40 p-4">
      <h3 className="text-terminal-text text-sm font-semibold mb-3 flex items-center gap-2">
        <span className="text-[#ff3b5c]">⬡</span> Rejection Breakdown
        <span className="ml-auto text-terminal-muted/50 text-[10px] font-normal">{total} total</span>
      </h3>
      {stats.topReasons.length === 0 ? (
        <p className="text-terminal-muted/50 text-xs py-4 text-center">No scan data yet — run a scan to see rejection analysis.</p>
      ) : (
        <div className="space-y-2.5">
          {stats.topReasons.map(r => (
            <div key={r.stage}>
              <div className="flex items-center justify-between mb-0.5">
                <span className={cn('text-xs font-medium', STAGE_COLOR[r.stage] ?? 'text-terminal-muted')}>
                  {STAGE_LABELS[r.stage] ?? r.stage}
                </span>
                <span className="text-terminal-muted/70 text-xs font-mono tabular-nums">
                  {r.count} · {r.pct}%
                </span>
              </div>
              <div className="h-1 bg-terminal-border/30 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full bg-current opacity-50 transition-all duration-500"
                  style={{ width: `${r.pct}%`, color: STAGE_COLOR[r.stage]?.replace('text-', '') ?? '#6b7280' }}
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
    <div className="glass-surface rounded-xl border border-terminal-border/40 p-4">
      <h3 className="text-terminal-text text-sm font-semibold mb-3 flex items-center gap-2">
        <span className="text-amber-400">⚡</span> Near-Miss Opportunities
        <span className="ml-auto text-terminal-muted/50 text-[10px] font-normal">{items.length} setups</span>
      </h3>
      {items.length === 0 ? (
        <p className="text-terminal-muted/50 text-xs py-4 text-center">
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
              <div key={i} className="flex items-start gap-3 py-2 border-b border-terminal-border/20 last:border-0">
                <div className="mt-0.5">
                  <span className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-amber-400/10 border border-amber-400/20 text-amber-400 text-xs font-bold font-mono">
                    {entry.symbol.slice(0, 3)}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-terminal-text text-xs font-semibold">{entry.symbol}</span>
                    <span className={cn('text-[10px] font-medium px-1.5 py-0.5 rounded-full border', STAGE_COLOR[entry.stage] ?? 'text-terminal-muted', 'bg-current/10 border-current/20')}>
                      {STAGE_LABELS[entry.stage] ?? entry.stage}
                    </span>
                  </div>
                  {hasMetrics && (
                    <p className="text-terminal-muted/70 text-[11px] mt-0.5 font-mono">
                      {entry.actual} / {entry.threshold} required
                      {missBy && <span className="text-amber-400/80 ml-1.5">— missed by {missBy}</span>}
                    </p>
                  )}
                  <p className="text-terminal-muted/50 text-[10px] mt-0.5 truncate">{entry.reason}</p>
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
  // Near-miss rate > 20% suggests thresholds may still be too tight
  const nearMissRate = stats.totalRejected > 0
    ? (stats.nearMisses.length / stats.totalRejected) * 100
    : 0
  const scanAge = Math.round((Date.now() - stats.scannedAt) / 60_000)
  const tooTight = nearMissRate > 20

  return (
    <div className={cn(
      'flex items-center gap-3 px-4 py-2.5 rounded-xl border text-xs',
      tooTight
        ? 'bg-amber-400/5 border-amber-400/20 text-amber-400/90'
        : 'bg-terminal-surface border-terminal-border/40 text-terminal-muted/60',
    )}>
      <span>{tooTight ? '⚠' : '✓'}</span>
      <span>
        {tooTight
          ? `${stats.nearMisses.length} near-misses (${nearMissRate.toFixed(0)}% of rejections) — thresholds may be over-filtering`
          : 'Calibration nominal — rejection margins are decisive'}
      </span>
      <span className="ml-auto text-terminal-muted/40">
        {scanAge < 1 ? 'just now' : `${scanAge}m ago`}
      </span>
    </div>
  )
}

function DiagnosticsPanel({ stats }: { stats: RejectionStats | null }) {
  if (!stats) {
    return (
      <div className="flex items-center justify-center h-48 text-terminal-muted/40 text-sm">
        Loading diagnostics...
      </div>
    )
  }

  return (
    <div className="space-y-4 animate-fade-in">
      <OverviewStrip stats={stats} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <RejectionBreakdown stats={stats} />
        <NearMissPanel stats={stats} />
      </div>
      <CalibrationBadge stats={stats} />
    </div>
  )
}

// ─── Main page ───────────────────────────────────────────────────────────────

export default function AdminScannerPage() {
  const [tab, setTab]                             = useState<Tab>('command')
  const [mode, setMode]                           = useState<ScannerMode>('spot')
  const [signals, setSignals]                     = useState<TradingSignal[]>([])
  const [coins, setCoins]                         = useState<CoinData[]>([])
  const [coinsLoading, setCoinsLoading]           = useState(true)
  const [sigsLoading, setSigsLoading]             = useState(true)
  const [schedulerStatus, setSchedulerStatus]     = useState<SchedulerStatus | null>(null)
  const [scanError, setScanError]                 = useState<string | null>(null)
  const [diagnosticsStats, setDiagnosticsStats]   = useState<RejectionStats | null>(null)
  const prevScanning                              = useRef(false)

  const fetchCoins = useCallback(async () => {
    try {
      const json = await fetch('/api/coins/top100').then(r => r.json())
      if (json.success) setCoins(json.coins)
    } catch { /* non-fatal */ }
    finally { setCoinsLoading(false) }
  }, [])

  const fetchSignals = useCallback(async () => {
    try {
      const json = await fetch('/api/signals?minConfidence=75&limit=50').then(r => r.json())
      if (json.success) setSignals(json.signals)
    } catch { /* non-fatal */ }
    finally { setSigsLoading(false) }
  }, [])

  const fetchDiagnostics = useCallback(async () => {
    try {
      const json = await fetch('/api/scanner/diagnostics').then(r => r.json())
      if (json.success) setDiagnosticsStats(json.stats)
    } catch { /* non-fatal */ }
  }, [])

  const fetchScheduler = useCallback(async () => {
    try {
      const json = await fetch('/api/scheduler/status').then(r => r.json())
      if (!json.success) return
      const st: SchedulerStatus = json.status
      if (prevScanning.current && !st.scanning) {
        void fetchSignals()
        void fetchDiagnostics() // refresh diagnostics when scan completes
      }
      prevScanning.current = st.scanning
      setSchedulerStatus(st)
    } catch { /* non-fatal */ }
  }, [fetchSignals, fetchDiagnostics])

  useEffect(() => {
    fetchCoins()
    fetchSignals()
    fetchScheduler()
    fetchDiagnostics()
    const t1 = setInterval(fetchSignals,      POLL_SIGNALS_MS)
    const t2 = setInterval(fetchScheduler,    POLL_SCHEDULER_MS)
    const t3 = setInterval(fetchCoins,        POLL_COINS_MS)
    const t4 = setInterval(fetchDiagnostics,  POLL_DIAGNOSTICS_MS)
    return () => { clearInterval(t1); clearInterval(t2); clearInterval(t3); clearInterval(t4) }
  }, [fetchCoins, fetchSignals, fetchScheduler, fetchDiagnostics])

  const handleRunScan = useCallback(async () => {
    if (schedulerStatus?.scanning) return
    setScanError(null)
    try {
      const res  = await fetch('/api/scanner/run', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      })
      const json = await res.json()
      if (res.status === 423) { setScanError('A scan is already running — please wait.'); return }
      if (res.status === 429) { setScanError(json.error ?? 'Rate limit reached.'); return }
      if (!json.success)      { setScanError(json.error ?? 'Scan failed'); return }
      if (json.signals?.length) {
        setSignals(prev => {
          const ids   = new Set(prev.map(s => s.id).filter(Boolean))
          const fresh = (json.signals as TradingSignal[]).filter(s => !ids.has(s.id))
          return [...fresh, ...prev].slice(0, 200)
        })
      }
      void fetchSignals()
      void fetchDiagnostics()
    } catch (err) {
      setScanError(err instanceof Error ? err.message : 'Network error')
    }
  }, [schedulerStatus?.scanning, mode, fetchSignals, fetchDiagnostics])

  const handleToggleAutoScan = useCallback(async () => {
    const isOn = schedulerStatus?.started ?? false
    try {
      if (isOn) {
        await fetch('/api/scheduler/stop', { method: 'POST' })
      } else {
        await fetch('/api/scheduler/start', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode, intervalMinutes: 5 }),
        })
      }
      void fetchScheduler()
    } catch (err) {
      setScanError(err instanceof Error ? err.message : 'Scheduler toggle failed')
    }
  }, [schedulerStatus?.started, mode, fetchScheduler])

  const handleEnterTrade = useCallback(async (signal: TradingSignal) => {
    try {
      const res  = await fetch('/api/paper-trading/enter', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signal }),
      })
      const json = await res.json()
      return { success: json.success as boolean, error: json.error as string | undefined }
    } catch {
      return { success: false, error: 'Network error' }
    }
  }, [])

  const isScanning = schedulerStatus?.scanning ?? false

  const TABS = [
    { id: 'command'     as const, label: '⌘ Command Center' },
    { id: 'scanner'     as const, label: '⬡ Signal Scanner'  },
    { id: 'diagnostics' as const, label: '◈ Diagnostics'     },
  ]

  return (
    <div className="space-y-4 animate-fade-in">
      <div>
        <h1 className="text-terminal-text text-xl font-semibold">Scanner</h1>
        <p className="text-terminal-muted text-sm mt-1">
          10-mode signal engine · AI-validated setups · Live market sweep
        </p>
      </div>

      {/* Tab navigation */}
      <div className="flex gap-1 glass-surface rounded-xl p-1 border border-terminal-border/40 self-start w-fit">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'px-4 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-wider transition-all',
              tab === t.id
                ? 'bg-terminal-surface text-terminal-text border border-terminal-border/60'
                : 'text-terminal-muted hover:text-terminal-text',
            )}
          >
            {t.label}
            {t.id === 'diagnostics' && diagnosticsStats && diagnosticsStats.nearMisses.length > 0 && (
              <span className="ml-1.5 inline-flex items-center justify-center w-4 h-4 rounded-full bg-amber-400/20 text-amber-400 text-[9px] font-bold">
                {diagnosticsStats.nearMisses.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Error banner */}
      {scanError && (
        <div className="px-4 py-2.5 bg-bear-muted border border-bear-DEFAULT/30 rounded-lg text-bear-text text-xs flex items-center justify-between">
          <span>⚠ {scanError}</span>
          <button onClick={() => setScanError(null)} className="text-terminal-muted hover:text-terminal-text ml-4">✕</button>
        </div>
      )}

      {tab === 'command' && (
        <ScanCommandCenter
          coins={coins}
          externalSignals={signals}
          schedulerStatus={schedulerStatus}
          isScanning={isScanning}
          onEnterTrade={handleEnterTrade}
        />
      )}

      {tab === 'scanner' && (
        <>
          <ScannerControls
            activeMode={mode}
            isScanning={isScanning}
            schedulerStatus={schedulerStatus}
            onModeChange={setMode}
            onRunScan={handleRunScan}
            onToggleAutoScan={handleToggleAutoScan}
          />
          <div className="grid grid-cols-1 lg:grid-cols-[390px_1fr] gap-4" style={{ minHeight: 480 }}>
            <SignalsFeed signals={signals} loading={sigsLoading} onEnterTrade={handleEnterTrade} />
            <TopCoinsTable coins={coins} signals={signals} loading={coinsLoading} />
          </div>
        </>
      )}

      {tab === 'diagnostics' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-terminal-text text-sm font-semibold">Rejection Intelligence</h2>
              <p className="text-terminal-muted/60 text-xs mt-0.5">
                Why signals were filtered · Near-miss opportunities · Calibration status
              </p>
            </div>
            <button
              onClick={fetchDiagnostics}
              className="text-terminal-muted/60 hover:text-terminal-text text-xs px-3 py-1.5 rounded-lg border border-terminal-border/40 hover:border-terminal-border/70 transition-all"
            >
              ↻ Refresh
            </button>
          </div>
          <DiagnosticsPanel stats={diagnosticsStats} />
        </div>
      )}
    </div>
  )
}
