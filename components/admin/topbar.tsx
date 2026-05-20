'use client'

import { useCallback } from 'react'
import { AlertOctagon, AlertTriangle, CheckCircle, RefreshCw } from 'lucide-react'
import { adminApi, BurninStatus } from '@/lib/admin-api'
import { useAutoRefresh } from '@/lib/use-auto-refresh'
import { SessionBadge } from './session-badge'

interface Props {
  email:      string
  lastSignIn: string | null
}

export function AdminTopbar({ email, lastSignIn }: Props) {
  const fetcher = useCallback(() => adminApi.burnin.status(), [])
  const { data, loading, error, lastUpdated, refresh } =
    useAutoRefresh<BurninStatus>(fetcher, 30_000)

  const critical = data?.anomaly_summary?.critical ?? 0
  const warnings = data?.anomaly_summary?.warning  ?? 0
  const winRate  = data?.live_metrics.win_rate_7d
  const progress = data?.progress_pct ?? 0

  return (
    <header className="h-9 shrink-0 bg-terminal-surface border-b border-terminal-border flex items-center px-4 gap-3 text-[11px] font-mono select-none">

      {/* Live indicator */}
      <div className="flex items-center gap-1.5">
        <span className={[
          'w-1.5 h-1.5 rounded-full',
          error ? 'bg-bear-default' : 'bg-bull-default animate-pulse-slow',
        ].join(' ')} />
        <span className={error ? 'text-bear-default' : 'text-bull-default/80'}>
          {error ? 'OFFLINE' : 'LIVE'}
        </span>
      </div>

      <div className="h-3 w-px bg-terminal-border shrink-0" />

      {/* Anomaly status */}
      {critical > 0 ? (
        <div className="flex items-center gap-1 text-bear-default">
          <AlertOctagon size={11} />
          <span>{critical} CRITICAL</span>
        </div>
      ) : warnings > 0 ? (
        <div className="flex items-center gap-1 text-signal-high">
          <AlertTriangle size={11} />
          <span>{warnings} WARN</span>
        </div>
      ) : (
        <div className="flex items-center gap-1 text-terminal-muted/60">
          <CheckCircle size={11} />
          <span>CLEAN</span>
        </div>
      )}

      <div className="h-3 w-px bg-terminal-border shrink-0" />

      {/* Burn-in progress */}
      <span className="text-terminal-muted/60">BURN-IN</span>
      <span className="text-terminal-text">{progress.toFixed(0)}%</span>

      {/* Win rate */}
      {winRate != null && (
        <>
          <div className="h-3 w-px bg-terminal-border shrink-0" />
          <span className="text-terminal-muted/60">WR 7D</span>
          <span className={winRate >= 0.55 ? 'text-bull-default' : 'text-bear-default'}>
            {(winRate * 100).toFixed(1)}%
          </span>
        </>
      )}

      <div className="flex-1" />

      {/* Last refresh timestamp */}
      {lastUpdated && (
        <span className="text-terminal-muted/35 hidden sm:block">
          {lastUpdated.toLocaleTimeString()}
        </span>
      )}

      {/* Refresh */}
      <button
        onClick={refresh}
        title="Refresh"
        className="p-1 text-terminal-muted/40 hover:text-terminal-muted transition-colors rounded"
      >
        <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
      </button>

      <div className="h-3 w-px bg-terminal-border shrink-0" />

      {/* Session info + logout */}
      <SessionBadge email={email} lastSignIn={lastSignIn} />
    </header>
  )
}
