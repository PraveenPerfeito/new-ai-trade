'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertOctagon, AlertTriangle, CheckCircle, RefreshCw, Clock } from 'lucide-react'
import { adminApi, BurninStatus } from '@/lib/admin-api'
import { useAutoRefresh } from '@/lib/use-auto-refresh'
import { SessionBadge } from './session-badge'
import Link from 'next/link'

interface Props {
  email:      string
  lastSignIn: string | null
}

export function AdminTopbar({ email, lastSignIn }: Props) {
  const fetcher = useCallback(() => adminApi.burnin.status(), [])
  const { data, loading, error, lastUpdated, refresh } =
    useAutoRefresh<BurninStatus>(fetcher, 30_000)

  const [utcTime, setUtcTime] = useState('')
  useEffect(() => {
    const fmt = () => new Date().toLocaleTimeString('en-US', { timeZone: 'UTC', hour12: false })
    setUtcTime(fmt())
    const id = setInterval(() => setUtcTime(fmt()), 1000)
    return () => clearInterval(id)
  }, [])

  const critical = data?.anomaly_summary?.critical ?? 0
  const warnings = data?.anomaly_summary?.warning  ?? 0
  const winRate  = data?.live_metrics?.win_rate_7d
  const progress = data?.progress_pct ?? 0

  return (
    <header className="h-11 shrink-0 bg-terminal-surface border-b border-terminal-border flex items-center px-5 gap-4 text-xs font-mono select-none">

      {/* Live indicator */}
      <div className="flex items-center gap-2">
        <span className={[
          'w-2 h-2 rounded-full',
          error ? 'bg-bear-default' : 'bg-bull-default animate-pulse-slow',
        ].join(' ')} />
        <span className={error ? 'text-bear-default' : 'text-bull-default/80'}>
          {error ? 'OFFLINE' : 'LIVE'}
        </span>
      </div>

      <div className="h-4 w-px bg-terminal-border shrink-0" />

      {/* Anomaly status — clickable, links to Anomaly Action Center */}
      {critical > 0 ? (
        <Link href="/admin/anomalies"
          className="flex items-center gap-1.5 text-bear-default hover:text-bear-default/80 px-2 py-0.5 rounded border border-bear-default/30 bg-bear-default/5 transition-colors">
          <AlertOctagon size={12} className="animate-pulse" />
          <span className="font-semibold">{critical} CRITICAL</span>
        </Link>
      ) : warnings > 0 ? (
        <Link href="/admin/anomalies"
          className="flex items-center gap-1.5 text-signal-high hover:text-signal-high/80 px-2 py-0.5 rounded border border-signal-high/30 bg-signal-high/5 transition-colors">
          <AlertTriangle size={12} />
          <span>{warnings} WARN</span>
        </Link>
      ) : (
        <div className="flex items-center gap-1.5 text-terminal-muted/50">
          <CheckCircle size={12} />
          <span>CLEAN</span>
        </div>
      )}

      <div className="h-4 w-px bg-terminal-border shrink-0" />

      {/* Burn-in progress */}
      <span className="text-terminal-muted/60">BURN-IN</span>
      <span className="text-terminal-text font-semibold">{progress.toFixed(0)}%</span>

      {/* Win rate */}
      {winRate != null && (
        <>
          <div className="h-4 w-px bg-terminal-border shrink-0" />
          <span className="text-terminal-muted/60">WIN 7D</span>
          <span className={`font-semibold ${winRate >= 0.55 ? 'text-bull-default' : 'text-bear-default'}`}>
            {(winRate * 100).toFixed(1)}%
          </span>
        </>
      )}

      <div className="flex-1" />

      {/* Last refresh timestamp */}
      {lastUpdated && (
        <span className="text-terminal-muted/30 hidden md:block text-[10px]">
          updated {lastUpdated.toLocaleTimeString()}
        </span>
      )}

      {/* UTC clock */}
      {utcTime && (
        <div className="hidden sm:flex items-center gap-1.5 text-terminal-muted/50">
          <Clock size={11} />
          <span className="tabular-nums">{utcTime} UTC</span>
        </div>
      )}

      {/* Refresh */}
      <button
        onClick={refresh}
        title="Refresh"
        className="p-1.5 text-terminal-muted/40 hover:text-terminal-muted transition-colors rounded"
      >
        <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
      </button>

      <div className="h-4 w-px bg-terminal-border shrink-0" />

      {/* Session info + logout */}
      <SessionBadge email={email} lastSignIn={lastSignIn} />
    </header>
  )
}
