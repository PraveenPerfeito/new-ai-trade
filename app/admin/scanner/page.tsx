'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { TradingSignal, CoinData, ScannerMode } from '@/types'
import { SchedulerStatus } from '@/lib/scheduler'
import { ScanCommandCenter } from '@/components/dashboard/scan-command-center'
import { ScannerControls }   from '@/components/dashboard/scanner-controls'
import { SignalsFeed }       from '@/components/dashboard/signals-feed'
import { TopCoinsTable }     from '@/components/dashboard/top-coins-table'
import { cn } from '@/lib/utils'

type Tab = 'command' | 'scanner'

const POLL_SIGNALS_MS   = 30_000
const POLL_SCHEDULER_MS = 10_000
const POLL_COINS_MS     = 5 * 60_000

export default function AdminScannerPage() {
  const [tab, setTab]                             = useState<Tab>('command')
  const [mode, setMode]                           = useState<ScannerMode>('spot')
  const [signals, setSignals]                     = useState<TradingSignal[]>([])
  const [coins, setCoins]                         = useState<CoinData[]>([])
  const [coinsLoading, setCoinsLoading]           = useState(true)
  const [sigsLoading, setSigsLoading]             = useState(true)
  const [schedulerStatus, setSchedulerStatus]     = useState<SchedulerStatus | null>(null)
  const [scanError, setScanError]                 = useState<string | null>(null)
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

  const fetchScheduler = useCallback(async () => {
    try {
      const json = await fetch('/api/scheduler/status').then(r => r.json())
      if (!json.success) return
      const st: SchedulerStatus = json.status
      if (prevScanning.current && !st.scanning) void fetchSignals()
      prevScanning.current = st.scanning
      setSchedulerStatus(st)
    } catch { /* non-fatal */ }
  }, [fetchSignals])

  useEffect(() => {
    fetchCoins()
    fetchSignals()
    fetchScheduler()
    const t1 = setInterval(fetchSignals,  POLL_SIGNALS_MS)
    const t2 = setInterval(fetchScheduler, POLL_SCHEDULER_MS)
    const t3 = setInterval(fetchCoins,    POLL_COINS_MS)
    return () => { clearInterval(t1); clearInterval(t2); clearInterval(t3) }
  }, [fetchCoins, fetchSignals, fetchScheduler])

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
    } catch (err) {
      setScanError(err instanceof Error ? err.message : 'Network error')
    }
  }, [schedulerStatus?.scanning, mode, fetchSignals])

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
        {(['command', 'scanner'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'px-4 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-wider transition-all',
              tab === t
                ? 'bg-terminal-surface text-terminal-text border border-terminal-border/60'
                : 'text-terminal-muted hover:text-terminal-text',
            )}
          >
            {t === 'command' ? '⌘ Command Center' : '⬡ Signal Scanner'}
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
    </div>
  )
}
