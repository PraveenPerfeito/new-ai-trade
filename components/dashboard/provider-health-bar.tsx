'use client';

import { useState, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';

interface ProviderStatus {
  name:      string;
  healthy:   boolean;
  latencyMs: number;
  error?:    string;
}

export function ProviderHealthBar() {
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [checking,  setChecking]  = useState(false);

  const check = useCallback(async () => {
    setChecking(true);
    try {
      const j = await fetch('/api/health/providers').then(r => r.json());
      if (j.success) setProviders(j.providers as ProviderStatus[]);
    } catch { /* non-fatal */ }
    finally { setChecking(false); }
  }, []);

  useEffect(() => {
    void check();
    const t = setInterval(check, 30_000);
    return () => clearInterval(t);
  }, [check]);

  if (!providers.length) return null;

  return (
    <div className="flex items-center gap-3 flex-wrap text-[9px] font-mono py-1">
      {providers.map(p => (
        <div
          key={p.name}
          className="flex items-center gap-1.5"
          title={p.error ?? `${p.latencyMs}ms`}
        >
          <span
            className={cn(
              'w-1.5 h-1.5 rounded-full flex-shrink-0',
              !p.healthy && 'animate-pulse',
            )}
            style={{ backgroundColor: p.healthy ? '#00d084' : '#ff3b5c' }}
          />
          <span className={p.healthy ? 'text-terminal-muted' : 'text-bear-text font-bold'}>
            {p.name}
          </span>
          {p.healthy && (
            <span className="text-terminal-dim">{p.latencyMs}ms</span>
          )}
          {!p.healthy && p.error && (
            <span className="text-bear-text/70 hidden sm:inline truncate max-w-[120px]">{p.error}</span>
          )}
        </div>
      ))}
      {checking && (
        <span className="text-terminal-dim animate-pulse">↻</span>
      )}
    </div>
  );
}
