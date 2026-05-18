'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { TradingSignal, CoinData, ScannerMode, DashboardStats } from '@/types';
import { SchedulerStatus } from '@/lib/scheduler';
import { formatPrice, formatPct, cn } from '@/lib/utils';
import { StatsBar }        from './stats-bar';
import { ScannerControls } from './scanner-controls';
import { SignalsFeed }     from './signals-feed';
import { TopCoinsTable }   from './top-coins-table';
import { MarketWidgets }   from './market-widgets';
import { TopMovers }       from './top-movers';
import { BacktestPanel }   from './backtest-panel';

const POLL_SIGNALS_MS   = 30_000;
const POLL_COINS_MS     = 5 * 60_000;
const POLL_SCHEDULER_MS = 5_000;

export function MarketScanner() {
  const [activeTab, setActiveTab]                 = useState<'scanner' | 'backtest'>('scanner');
  const [mode, setMode]                           = useState<ScannerMode>('spot');
  const [signals, setSignals]                     = useState<TradingSignal[]>([]);
  const [coins, setCoins]                         = useState<CoinData[]>([]);
  const [coinsLoading, setCoinsLoading]           = useState(true);
  const [sigsLoading, setSigsLoading]             = useState(true);
  const [schedulerStatus, setSchedulerStatus]     = useState<SchedulerStatus | null>(null);
  const [lastScanTime, setLastScanTime]           = useState<Date | null>(null);
  const [scanError, setScanError]                 = useState<string | null>(null);
  const [clockTime, setClockTime]                 = useState('');

  // Track previous scanning state to detect scan completion
  const prevScanning = useRef(false);
  const pollRef      = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── UTC clock ──────────────────────────────────────────────────────────────
  useEffect(() => {
    function tick() { setClockTime(new Date().toUTCString().slice(17, 25)); }
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);

  // ── Data fetching ──────────────────────────────────────────────────────────
  const fetchCoins = useCallback(async () => {
    try {
      const json = await fetch('/api/coins/top100').then(r => r.json());
      if (json.success) setCoins(json.coins);
    } catch { /* non-fatal */ }
    finally { setCoinsLoading(false); }
  }, []);

  const fetchSignals = useCallback(async () => {
    try {
      const json = await fetch('/api/signals?minConfidence=75&limit=100').then(r => r.json());
      if (json.success) setSignals(json.signals);
    } catch { /* non-fatal */ }
    finally { setSigsLoading(false); }
  }, []);

  const fetchSchedulerStatus = useCallback(async () => {
    try {
      const json = await fetch('/api/scheduler/status').then(r => r.json());
      if (!json.success) return;
      const st: SchedulerStatus = json.status;

      // Detect scan completion: scanning true → false → refresh signals
      if (prevScanning.current && !st.scanning) {
        setLastScanTime(new Date());
        void fetchSignals();
      }
      prevScanning.current = st.scanning;
      setSchedulerStatus(st);
    } catch { /* non-fatal */ }
  }, [fetchSignals]);

  // ── Initial load + polling ─────────────────────────────────────────────────
  useEffect(() => {
    fetchCoins();
    fetchSignals();
    fetchSchedulerStatus();

    pollRef.current = setInterval(fetchSignals, POLL_SIGNALS_MS);
    const coinsTimer     = setInterval(fetchCoins,           POLL_COINS_MS);
    const schedTimer     = setInterval(fetchSchedulerStatus, POLL_SCHEDULER_MS);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      clearInterval(coinsTimer);
      clearInterval(schedTimer);
    };
  }, [fetchCoins, fetchSignals, fetchSchedulerStatus]);

  // ── Manual scan ────────────────────────────────────────────────────────────
  const handleRunScan = useCallback(async () => {
    if (schedulerStatus?.scanning) return;
    setScanError(null);

    try {
      const res  = await fetch('/api/scanner/run', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ mode }),
      });
      const json = await res.json();

      if (res.status === 423) {
        setScanError('A scan is already running — please wait.');
        return;
      }
      if (res.status === 429) {
        setScanError(json.error ?? 'Rate limit reached. Try again shortly.');
        return;
      }
      if (!json.success) {
        setScanError(json.error ?? 'Scan failed');
        return;
      }

      setLastScanTime(new Date());
      if (json.signals?.length) {
        setSignals(prev => {
          const ids   = new Set(prev.map(s => s.id).filter(Boolean));
          const fresh = (json.signals as TradingSignal[]).filter(s => !ids.has(s.id));
          return [...fresh, ...prev].slice(0, 200);
        });
      }
      await fetchSignals();
    } catch (err) {
      setScanError(err instanceof Error ? err.message : 'Network error');
    }
  }, [schedulerStatus?.scanning, mode, fetchSignals]);

  // ── Auto-scan toggle ───────────────────────────────────────────────────────
  const handleToggleAutoScan = useCallback(async () => {
    const isOn = schedulerStatus?.started ?? false;
    try {
      if (isOn) {
        await fetch('/api/scheduler/stop', { method: 'POST' });
      } else {
        await fetch('/api/scheduler/start', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ mode, intervalMinutes: 5 }),
        });
      }
      await fetchSchedulerStatus();
    } catch (err) {
      setScanError(err instanceof Error ? err.message : 'Scheduler toggle failed');
    }
  }, [schedulerStatus?.started, mode, fetchSchedulerStatus]);

  // ── Derived ────────────────────────────────────────────────────────────────
  const isScanning = schedulerStatus?.scanning ?? false;

  const stats: DashboardStats = {
    totalScanned:    coins.length,
    totalSignals:    signals.filter(s => s.confidence >= 75).length,
    highConfSignals: signals.filter(s => s.confidence >= 85).length,
    lastScanTime:    schedulerStatus?.lastScanAt
                       ? new Date(schedulerStatus.lastScanAt)
                       : lastScanTime,
    isScanning,
  };

  return (
    <div className="min-h-screen bg-terminal-bg text-terminal-text font-mono flex flex-col">

      {/* ── Sticky header ─────────────────────────────────────────────────── */}
      <header className="glass-surface border-b border-terminal-border sticky top-0 z-50 flex-shrink-0">
        <div className="px-4 sm:px-6 py-2.5 flex items-center justify-between max-w-[1600px] mx-auto">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded bg-bull-DEFAULT/15 border border-bull-DEFAULT/35 flex items-center justify-center">
                <span className="text-bull-DEFAULT text-[11px] font-bold select-none">◈</span>
              </div>
              <span className="text-bull-DEFAULT font-bold text-sm tracking-tight hidden sm:inline">
                MARKET SCANNER
              </span>
              <span className="text-bull-DEFAULT font-bold text-sm tracking-tight sm:hidden">
                SCANNER
              </span>
            </div>
            <LiveDot isScanning={isScanning} autoOn={schedulerStatus?.started ?? false} />
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-2.5 text-[10px] text-terminal-muted">
              <span>Top 100 · CoinGecko + Binance</span>
              <span className="text-terminal-border">|</span>
              <span>claude-haiku-4-5</span>
            </div>
            <span className="font-mono text-[11px] text-terminal-muted tabular-nums">
              {clockTime} UTC
            </span>
          </div>
        </div>
        {coins.length > 0 && <PriceTicker coins={coins} />}
      </header>

      {/* ── Main content ──────────────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col px-4 sm:px-6 py-5 max-w-[1600px] mx-auto w-full">

        {/* Error banner */}
        {scanError && (
          <div className="mb-4 px-4 py-2.5 bg-bear-muted border border-bear-DEFAULT/30 rounded-lg text-bear-text text-xs flex items-center justify-between animate-slide-up flex-shrink-0">
            <span>⚠ {scanError}</span>
            <button
              onClick={() => setScanError(null)}
              className="text-terminal-muted hover:text-terminal-text ml-4 text-sm leading-none"
            >
              ✕
            </button>
          </div>
        )}

        <div className="flex-shrink-0"><StatsBar stats={stats} /></div>
        <div className="flex-shrink-0"><MarketWidgets coins={coins} loading={coinsLoading} /></div>
        <div className="flex-shrink-0"><TopMovers coins={coins} loading={coinsLoading} /></div>

        {/* Tab navigation */}
        <div className="flex-shrink-0 flex gap-1 glass-surface rounded-xl p-1 border border-terminal-border/40 mb-0 self-start w-fit">
          {(['scanner', 'backtest'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                'px-4 py-1.5 rounded-lg text-[10px] font-semibold uppercase tracking-wider transition-all',
                activeTab === tab
                  ? 'bg-terminal-surface text-terminal-text border border-terminal-border/60'
                  : 'text-terminal-muted hover:text-terminal-text',
              )}
            >
              {tab === 'scanner' ? '⬡ Scanner' : '◈ Backtest'}
            </button>
          ))}
        </div>

        {activeTab === 'scanner' && (
          <>
            <div className="flex-shrink-0">
              <ScannerControls
                activeMode={mode}
                isScanning={isScanning}
                schedulerStatus={schedulerStatus}
                onModeChange={setMode}
                onRunScan={handleRunScan}
                onToggleAutoScan={handleToggleAutoScan}
              />
            </div>
            <div
              className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[390px_1fr] gap-4"
              style={{ minHeight: 480 }}
            >
              <SignalsFeed signals={signals} loading={sigsLoading} />
              <TopCoinsTable coins={coins} signals={signals} loading={coinsLoading} />
            </div>
          </>
        )}

        {activeTab === 'backtest' && (
          <div className="flex-1 min-h-0 overflow-y-auto">
            <BacktestPanel />
          </div>
        )}
      </main>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function LiveDot({ isScanning, autoOn }: { isScanning: boolean; autoOn: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="relative flex h-2 w-2">
        {isScanning ? (
          <span className="animate-radar-ping absolute inline-flex h-full w-full rounded-full bg-signal-high opacity-60" />
        ) : autoOn ? (
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-bull-DEFAULT opacity-40" />
        ) : null}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${isScanning ? 'bg-signal-high' : autoOn ? 'bg-bull-DEFAULT' : 'bg-terminal-muted'}`} />
      </span>
      <span className={`text-[10px] font-mono ${isScanning ? 'text-signal-high' : autoOn ? 'text-bull-text' : 'text-terminal-muted'}`}>
        {isScanning ? 'SCANNING' : autoOn ? 'AUTO' : 'IDLE'}
      </span>
    </div>
  );
}

function PriceTicker({ coins }: { coins: CoinData[] }) {
  const featured = coins.slice(0, 20);
  const items    = [...featured, ...featured];

  return (
    <div className="overflow-hidden border-t border-terminal-border/30 bg-terminal-surface/25">
      <div className="ticker-scroll py-1">
        {items.map((coin, i) => {
          const up = coin.priceChange24h >= 0;
          return (
            <span key={i} className="inline-flex items-center gap-1.5 px-4 text-[10px] font-mono">
              <span className="text-terminal-muted">{coin.symbol}</span>
              <span className="text-terminal-text">{formatPrice(coin.price)}</span>
              <span className={up ? 'text-bull-text' : 'text-bear-text'}>
                {formatPct(coin.priceChange24h)}
              </span>
              <span className="text-terminal-border/60 mx-1">·</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
