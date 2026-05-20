'use client';

import type { ScanHistoryEntry } from '@/lib/scheduler';
import { cn } from '@/lib/utils';

interface Props {
  history:  ScanHistoryEntry[];
  onReplay: (entry: ScanHistoryEntry) => void;
}

export function ScanHistoryPanel({ history, onReplay }: Props) {
  const entries = history.slice(0, 15);

  if (!entries.length) {
    return (
      <div className="glass-card rounded-xl px-4 py-6 flex items-center justify-center border border-dashed border-terminal-border/25">
        <span className="text-[11px] text-terminal-dim font-mono">
          No scan history yet — run a scan to record entries
        </span>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-2.5">
        <span className="text-[10px] text-terminal-muted uppercase tracking-widest">◷ Scan History</span>
        <span className="text-[9px] text-terminal-dim font-mono px-1.5 py-0.5 bg-terminal-surface rounded border border-terminal-border/30">
          {entries.length}
        </span>
        <div className="flex-1 h-px bg-terminal-border/30" />
      </div>

      <div className="flex flex-col gap-1">
        {entries.map(entry => {
          const started    = new Date(entry.startedAt);
          const timeStr    = started.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
          const dateStr    = started.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          const statusColor =
            entry.status === 'completed' ? '#00d084' :
            entry.status === 'running'   ? '#f59e0b' : '#ff3b5c';
          const durationStr = entry.durationMs ? `${(entry.durationMs / 1000).toFixed(1)}s` : '—';

          return (
            <div
              key={entry.id}
              className="glass-card rounded-lg px-3.5 py-2.5 flex items-center gap-3 group hover:border-white/10 transition-all"
            >
              {/* Status dot */}
              <span
                className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', entry.status === 'running' && 'animate-pulse')}
                style={{ backgroundColor: statusColor }}
              />

              {/* Mode + trigger */}
              <div className="w-[64px] shrink-0">
                <p className="text-[10px] font-bold text-terminal-text uppercase font-mono">{entry.mode}</p>
                <p className="text-[8px] text-terminal-dim capitalize">{entry.triggeredBy}</p>
              </div>

              {/* Time */}
              <div className="hidden sm:block w-[72px] shrink-0">
                <p className="text-[10px] font-mono text-terminal-muted">{timeStr}</p>
                <p className="text-[8px] text-terminal-dim">{dateStr}</p>
              </div>

              {/* Stats */}
              <div className="flex-1 flex items-center gap-4 min-w-0">
                {entry.status === 'completed' ? (
                  <>
                    <div className="text-center">
                      <p className="text-[11px] font-bold font-mono" style={{ color: statusColor }}>
                        {entry.signalsFound ?? 0}
                      </p>
                      <p className="text-[8px] text-terminal-dim">signals</p>
                    </div>
                    <div className="hidden md:block text-center">
                      <p className="text-[11px] font-bold font-mono text-terminal-text">{entry.coinsScanned ?? 0}</p>
                      <p className="text-[8px] text-terminal-dim">coins</p>
                    </div>
                    <div className="hidden lg:block text-center">
                      <p className="text-[11px] font-bold font-mono text-terminal-muted">{durationStr}</p>
                      <p className="text-[8px] text-terminal-dim">duration</p>
                    </div>
                    {(entry.highConfSignals ?? 0) > 0 && (
                      <span
                        className="hidden xl:inline-block text-[8px] font-bold px-1.5 py-0.5 rounded font-mono"
                        style={{ backgroundColor: '#f59e0b18', color: '#f59e0b', border: '1px solid #f59e0b30' }}
                      >
                        {entry.highConfSignals} HC
                      </span>
                    )}
                  </>
                ) : entry.status === 'failed' ? (
                  <p className="text-[9px] text-bear-text truncate max-w-[200px]">{entry.error ?? 'Scan failed'}</p>
                ) : (
                  <p className="text-[9px] text-signal-high animate-pulse">Scanning…</p>
                )}
              </div>

              {/* Replay */}
              {entry.status === 'completed' && (
                <button
                  onClick={() => onReplay(entry)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity px-2 py-1 text-[9px] font-bold rounded border border-terminal-border/25 text-terminal-muted hover:text-terminal-text hover:border-terminal-border/50"
                >
                  ▶ Replay
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
