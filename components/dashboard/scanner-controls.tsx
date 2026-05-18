'use client';

import { useEffect, useState } from 'react';
import { ScannerMode } from '@/types';
import { SchedulerStatus } from '@/lib/scheduler';
import { Play, BarChart2, TrendingUp, Activity, Zap, Clock, History } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  activeMode:         ScannerMode;
  isScanning:         boolean;
  schedulerStatus:    SchedulerStatus | null;
  onModeChange:       (mode: ScannerMode) => void;
  onRunScan:          () => void;
  onToggleAutoScan:   () => void;
}

const MODES: {
  id:    ScannerMode;
  label: string;
  icon:  React.ReactNode;
  desc:  string;
  color: string;
}[] = [
  { id: 'spot',            label: 'Spot',      icon: <Activity   size={12} />, desc: 'Spot market setups — top-100 coins',      color: '#3b82f6' },
  { id: 'futures',         label: 'Futures',   icon: <BarChart2  size={12} />, desc: 'Perpetual futures with leverage signals', color: '#8b5cf6' },
  { id: 'high_confidence', label: 'High Conf', icon: <Zap        size={12} />, desc: 'Only signals with ≥85% AI confidence',    color: '#f59e0b' },
  { id: 'trending',        label: 'Trending',  icon: <TrendingUp size={12} />, desc: 'High-volume momentum movers',             color: '#00d084' },
];

export function ScannerControls({
  activeMode,
  isScanning,
  schedulerStatus,
  onModeChange,
  onRunScan,
  onToggleAutoScan,
}: Props) {
  const activeColor  = MODES.find(m => m.id === activeMode)?.color ?? '#3b82f6';
  const autoOn       = schedulerStatus?.started ?? false;
  const rateLimited  = (schedulerStatus?.scansThisHour ?? 0) >= 18; // warn at 18/20
  const isPaused     = !!schedulerStatus?.pausedUntil;
  const historyCount = schedulerStatus?.history.filter(h => h.status === 'completed').length ?? 0;
  const failCount    = schedulerStatus?.consecutiveFailures ?? 0;

  return (
    <div className="glass-card rounded-xl p-4 mb-4">
      {/* ── Row 1: mode tabs + action buttons ─────────────────────────── */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">

        {/* Mode tabs */}
        <div className="flex gap-1.5 flex-wrap">
          {MODES.map(m => {
            const isActive = activeMode === m.id;
            return (
              <button
                key={m.id}
                onClick={() => onModeChange(m.id)}
                title={m.desc}
                className={cn(
                  'flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium',
                  'transition-all duration-200 border',
                  isActive
                    ? ''
                    : 'bg-terminal-surface/60 border-terminal-border text-terminal-muted hover:text-terminal-text hover:border-terminal-bright',
                )}
                style={isActive ? {
                  backgroundColor: `${m.color}18`,
                  borderColor:     `${m.color}55`,
                  color:           m.color,
                  boxShadow:       `0 0 14px ${m.color}20`,
                } : {}}
              >
                {m.icon}
                {m.label}
              </button>
            );
          })}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Auto-scan toggle */}
          <button
            onClick={onToggleAutoScan}
            title={autoOn ? 'Stop auto-scan' : 'Start auto-scan (every 5 min)'}
            className={cn(
              'flex items-center gap-1.5 px-3.5 py-2.5 rounded-lg text-xs font-medium',
              'border transition-all duration-200',
              autoOn
                ? 'border-bull-DEFAULT/50 text-bull-text bg-bull-muted hover:bg-bull-DEFAULT/20'
                : 'border-terminal-border text-terminal-muted bg-terminal-surface/60 hover:border-terminal-bright hover:text-terminal-text',
            )}
            style={autoOn ? { boxShadow: '0 0 12px rgba(0,208,132,0.15)' } : {}}
          >
            <Clock size={12} className={autoOn ? 'text-bull-DEFAULT' : ''} />
            {autoOn ? 'Auto ON' : 'Auto OFF'}
          </button>

          {/* Manual run */}
          <button
            onClick={onRunScan}
            disabled={isScanning}
            className={cn(
              'flex items-center gap-2 px-5 py-2.5 rounded-lg font-semibold text-sm transition-all duration-200',
              isScanning
                ? 'bg-terminal-surface border border-terminal-border text-terminal-muted cursor-not-allowed'
                : 'text-terminal-bg hover:brightness-110 active:scale-95',
            )}
            style={!isScanning ? {
              background: 'linear-gradient(135deg, #00d084, #00b872)',
              boxShadow:  '0 0 20px rgba(0,208,132,0.3), 0 2px 8px rgba(0,0,0,0.4)',
            } : {}}
          >
            {isScanning ? (
              <>
                <span className="relative flex h-3 w-3 flex-shrink-0">
                  <span className="animate-radar-ping absolute inline-flex h-full w-full rounded-full bg-signal-high opacity-60" />
                  <span className="relative inline-flex h-3 w-3 rounded-full bg-signal-high" />
                </span>
                Scanning…
              </>
            ) : (
              <>
                <Play size={14} fill="currentColor" />
                Run Scan
              </>
            )}
          </button>
        </div>
      </div>

      {/* ── Row 2: status bar ──────────────────────────────────────────── */}
      <div className="flex items-center gap-3 mt-3 pt-3 border-t border-terminal-border/40 flex-wrap">
        {/* Active mode */}
        <div className="flex items-center gap-1.5">
          <div
            className="w-1.5 h-1.5 rounded-full"
            style={{ backgroundColor: activeColor, boxShadow: `0 0 5px ${activeColor}` }}
          />
          <span className="text-[10px] text-terminal-muted uppercase tracking-wider">MODE</span>
          <span className="text-[10px] text-terminal-text font-mono">
            {MODES.find(m => m.id === activeMode)?.desc}
          </span>
        </div>

        <div className="h-3 w-px bg-terminal-border/50" />

        {/* Countdown or auto-off notice */}
        {autoOn && schedulerStatus && (
          <Countdown nextScanAt={schedulerStatus.nextScanAt} isPaused={isPaused} />
        )}

        {/* Rate limit warning */}
        {rateLimited && (
          <span className="text-[10px] text-signal-high flex items-center gap-1">
            ⚠ {schedulerStatus?.scansThisHour}/20 scans this hour
          </span>
        )}

        {/* Failure warning */}
        {failCount > 0 && (
          <span className="text-[10px] text-bear-text flex items-center gap-1">
            ⚠ {failCount} consecutive failure{failCount > 1 ? 's' : ''}
          </span>
        )}

        {/* History count */}
        {historyCount > 0 && (
          <span className="ml-auto flex items-center gap-1 text-[10px] text-terminal-muted">
            <History size={10} />
            {historyCount} completed today
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Countdown component ──────────────────────────────────────────────────────

function Countdown({ nextScanAt, isPaused }: { nextScanAt: string | null; isPaused: boolean }) {
  const [display, setDisplay] = useState('');

  useEffect(() => {
    function update() {
      if (isPaused) { setDisplay('paused'); return; }
      if (!nextScanAt) { setDisplay(''); return; }
      const ms = new Date(nextScanAt).getTime() - Date.now();
      if (ms <= 0) { setDisplay('soon'); return; }
      const m = Math.floor(ms / 60_000);
      const s = Math.floor((ms % 60_000) / 1000);
      setDisplay(`${m}:${String(s).padStart(2, '0')}`);
    }
    update();
    const t = setInterval(update, 500);
    return () => clearInterval(t);
  }, [nextScanAt, isPaused]);

  if (!display) return null;

  return (
    <span className={cn(
      'flex items-center gap-1 text-[10px] font-mono',
      isPaused ? 'text-bear-text' : 'text-bull-text',
    )}>
      <Clock size={9} />
      {isPaused ? 'Paused (backoff)' : `Next scan in ${display}`}
    </span>
  );
}
