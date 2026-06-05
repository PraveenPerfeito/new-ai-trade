'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { TradingSignal, CoinData, ScannerMode, DashboardStats, SectorStats } from '@/types';
import { SchedulerStatus } from '@/lib/scheduler';
import { formatPrice, formatPct, cn } from '@/lib/utils';
import { detectClustering } from '@/lib/sectors';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { StatsBar }        from './stats-bar';
import { ScannerControls } from './scanner-controls';
import { SignalsFeed }     from './signals-feed';
import { TopCoinsTable }   from './top-coins-table';
import { MarketWidgets }   from './market-widgets';
import { TopMovers }       from './top-movers';
import { BacktestPanel }         from './backtest-panel';
import { PerformanceAnalytics } from './performance-analytics';
import { ScanCommandCenter }    from './scan-command-center';

const POLL_SIGNALS_MS   = 60_000;
const POLL_COINS_MS     = 5 * 60_000;
const POLL_SCHEDULER_MS = 30_000;

export function MarketScanner() {
  const [activeTab, setActiveTab]                 = useState<'command' | 'scanner' | 'backtest' | 'analytics'>('command');
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
      const ac = new AbortController();
      const tid = setTimeout(() => ac.abort(), 10_000);
      const json = await fetch('/api/coins/top100', { signal: ac.signal }).then(r => r.json());
      clearTimeout(tid);
      if (json.success) setCoins(json.coins);
    } catch { /* non-fatal */ }
    finally { setCoinsLoading(false); }
  }, []);

  const fetchSignals = useCallback(async () => {
    try {
      const ac = new AbortController();
      const tid = setTimeout(() => ac.abort(), 10_000);
      const json = await fetch('/api/signals?minConfidence=75&limit=50', { signal: ac.signal }).then(r => r.json());
      clearTimeout(tid);
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
        <div className="px-4 sm:px-6 py-3 flex items-center justify-between max-w-[1600px] mx-auto">
          {/* Brand + live status */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-md bg-bull-DEFAULT/15 border border-bull-DEFAULT/35 flex items-center justify-center">
                <span className="text-bull-DEFAULT text-sm font-bold select-none">◈</span>
              </div>
              <div className="hidden sm:block">
                <p className="text-bull-DEFAULT font-bold text-sm tracking-tight leading-none">MARKET SCANNER</p>
                <p className="text-terminal-muted/50 text-[10px] mt-0.5">AI-powered crypto signals</p>
              </div>
              <span className="text-bull-DEFAULT font-bold text-sm tracking-tight sm:hidden">SCANNER</span>
            </div>
            <LiveDot isScanning={isScanning} autoOn={schedulerStatus?.started ?? false} />
          </div>

          {/* Right: clock + admin button */}
          <div className="flex items-center gap-3">
            <span className="font-mono text-xs text-terminal-muted/60 tabular-nums hidden sm:block">
              {clockTime} UTC
            </span>
            <a
              href="/admin"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-terminal-border text-terminal-muted text-xs font-mono hover:border-bull-DEFAULT/40 hover:text-bull-DEFAULT transition-all duration-200"
            >
              <span className="text-[11px]">⌘</span>
              <span className="hidden sm:inline">Admin</span>
            </a>
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
        {coins.length > 0 && <div className="flex-shrink-0"><MarketRegimeBanner coins={coins} signals={signals} /></div>}
        <SectorRotationStrip coins={coins} />
        <ActiveOpportunitySummary signals={signals} />
        <div className="flex-shrink-0"><MarketWidgets coins={coins} loading={coinsLoading} /></div>
        <div className="flex-shrink-0"><TopMovers coins={coins} loading={coinsLoading} /></div>

        {/* Tab navigation */}
        <div className="flex-shrink-0 flex gap-1 glass-surface rounded-xl p-1 border border-terminal-border/40 mb-0 self-start w-fit">
          {(['command', 'scanner', 'backtest', 'analytics'] as const).map(tab => (
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
              {tab === 'command'   ? '⌘ Command'
               : tab === 'scanner'   ? '⬡ Scanner'
               : tab === 'backtest'  ? '◈ Backtest'
               : '◇ Analytics'}
            </button>
          ))}
        </div>

        {activeTab === 'command' && (
          <div className="flex-1 min-h-0 overflow-y-auto">
            <ScanCommandCenter
              coins={coins}
              externalSignals={signals}
              schedulerStatus={schedulerStatus}
              isScanning={isScanning}
            />
          </div>
        )}

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

        {activeTab === 'analytics' && (
          <div className="flex-1 min-h-0 overflow-y-auto">
            <PerformanceAnalytics />
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

// ─── Sector Rotation Strip ────────────────────────────────────────────────────

function SectorRotationStrip({ coins }: { coins: CoinData[] }) {
  const [sectors, setSectors] = useState<SectorStats[]>([]);

  useEffect(() => {
    if (coins.length === 0) return;
    fetch('/api/market/sectors')
      .then(r => r.json())
      .then(d => { if (d.success) setSectors(d.sectors); })
      .catch(() => null);
  }, [coins.length]);

  if (sectors.length === 0) return null;

  const top    = sectors.slice(0, 6);
  const maxAbs = Math.max(...top.map(s => Math.abs(s.avgChange24h)), 1);

  const momentumColor: Record<string, string> = {
    ACCELERATING:  '#00d084',
    STABLE:        '#3b82f6',
    DECELERATING:  '#f59e0b',
    REVERSING:     '#ff3b5c',
  };

  return (
    <div className="flex items-center gap-2 px-4 py-2 mb-3 glass-surface rounded-xl border border-terminal-border/30 flex-shrink-0 overflow-x-auto no-scrollbar">
      <span className="text-[10px] font-mono text-terminal-dim flex-shrink-0">Sectors ·</span>
      {top.map(s => {
        const color  = momentumColor[s.momentum] ?? '#6b7280';
        const barPct = Math.round((Math.abs(s.avgChange24h) / maxAbs) * 100);
        const up     = s.avgChange24h >= 0;
        return (
          <div key={s.name} className="flex flex-col gap-0.5 flex-shrink-0 min-w-[52px]">
            <div className="flex items-center justify-between gap-1">
              <span className="text-[9px] font-mono text-terminal-muted truncate">{s.name}</span>
              <span
                className="text-[9px] font-mono font-bold"
                style={{ color }}
              >
                {up ? '+' : ''}{s.avgChange24h.toFixed(1)}%
              </span>
            </div>
            <div className="w-full h-0.5 bg-terminal-surface rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{ width: `${barPct}%`, backgroundColor: color + 'cc' }}
              />
            </div>
            <div className="flex justify-between">
              <span className="text-[8px] text-terminal-dim">{Math.round(s.breadth * 100)}%▲</span>
              <span className="text-[8px]" style={{ color: color + '90' }}>
                {s.momentum === 'ACCELERATING' ? '⚡' : s.momentum === 'REVERSING' ? '↩' : s.momentum === 'STABLE' ? '→' : '↘'}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Active Opportunity Summary ──────────────────────────────────────────────

function ActiveOpportunitySummary({ signals }: { signals: TradingSignal[] }) {
  const qual = signals.filter(s => s.confidence >= 80);
  if (qual.length === 0) return null;

  const top        = [...qual].sort((a, b) => b.confidence - a.confidence)[0];
  const gradeA     = qual.filter(s => s.riskGrade === 'A').length;
  const aiCount    = qual.filter(s => s.aiValidated).length;
  const futCount   = qual.filter(s => s.futuresData != null).length;
  const isBuy      = top.type === 'BUY';
  const clustering = detectClustering(qual);

  return (
    <div className="flex items-center gap-2 px-4 py-2 mb-3 glass-surface rounded-xl border border-terminal-border/30 flex-shrink-0 overflow-x-auto no-scrollbar">
      <span className="text-[10px] font-mono text-terminal-dim shrink-0">Active ·</span>

      {/* Top signal chip */}
      <span className={cn(
        'inline-flex items-center gap-1 text-[10px] font-mono font-bold px-2 py-0.5 rounded-md border shrink-0',
        isBuy
          ? 'bg-bull-muted/50 text-bull-text border-bull-DEFAULT/25'
          : 'bg-bear-muted/50 text-bear-text border-bear-DEFAULT/25',
      )}>
        {isBuy ? <TrendingUp size={8} /> : <TrendingDown size={8} />}
        {top.symbol} {top.confidence}%
      </span>

      {gradeA > 0 && (
        <span className="inline-flex items-center gap-1 text-[10px] font-mono text-terminal-text glass-surface border border-terminal-border/50 px-2 py-0.5 rounded-md shrink-0">
          ■ {gradeA} Grade-A
        </span>
      )}

      {aiCount > 0 && (
        <span className="inline-flex items-center gap-1 text-[10px] font-mono text-purple-400 border border-purple-500/20 glass-surface px-2 py-0.5 rounded-md shrink-0">
          ◎ {aiCount} AI ✓
        </span>
      )}

      {futCount > 0 && (
        <span className="inline-flex items-center gap-1 text-[10px] font-mono text-signal-medium border border-terminal-border/40 glass-surface px-2 py-0.5 rounded-md shrink-0">
          ⚡ {futCount} Futures
        </span>
      )}

      <div className="flex-1 min-w-[8px]" />

      {clustering.detected && clustering.warning && (
        <span className="inline-flex items-center gap-1 text-[10px] font-mono text-signal-high border border-signal-high/20 bg-signal-high/5 px-2 py-0.5 rounded-md shrink-0">
          ⚠ {clustering.warning}
        </span>
      )}

      <span className="text-[10px] font-mono text-terminal-dim shrink-0">{qual.length} signals ≥80%</span>
    </div>
  );
}

// ─── Market Regime Banner ─────────────────────────────────────────────────────

function MarketRegimeBanner({ coins, signals }: { coins: CoinData[]; signals: TradingSignal[] }) {
  const upCount  = coins.filter(c => c.priceChange24h > 0).length;
  const breadth  = upCount / coins.length;
  const buySigs  = signals.filter(s => s.type === 'BUY'  && s.confidence >= 75).length;
  const sellSigs = signals.filter(s => s.type === 'SELL' && s.confidence >= 75).length;
  const btc      = coins.find(c => c.symbol === 'BTC');
  const btcChg   = btc?.priceChange24h ?? 0;

  let label: string, color: string, desc: string;
  if      (breadth >= 0.72) { label = 'BULL MARKET';   color = '#00d084'; desc = `${Math.round(breadth * 100)}% advancing`; }
  else if (breadth >= 0.58) { label = 'BULLISH BIAS';  color = '#4ade80'; desc = `${Math.round(breadth * 100)}% advancing`; }
  else if (breadth >= 0.42) { label = 'NEUTRAL';       color = '#f59e0b'; desc = 'No clear directional bias'; }
  else if (breadth >= 0.28) { label = 'BEARISH BIAS';  color = '#f97316'; desc = `${Math.round((1 - breadth) * 100)}% declining`; }
  else                       { label = 'BEAR MARKET';   color = '#ff3b5c'; desc = `${Math.round((1 - breadth) * 100)}% declining`; }

  return (
    <div
      className="flex items-center gap-3 px-4 py-2 mb-3 rounded-xl border text-[10px] font-mono flex-wrap"
      style={{ borderColor: color + '22', backgroundColor: color + '07' }}
    >
      {/* Regime */}
      <div className="flex items-center gap-1.5 shrink-0">
        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
        <span className="font-bold uppercase tracking-wider" style={{ color }}>
          {label}
        </span>
        <span className="text-terminal-dim ml-1">{desc}</span>
      </div>

      <div className="h-3 w-px bg-terminal-border/35" />

      {/* BTC */}
      <div className="flex items-center gap-1 shrink-0">
        <span className="text-terminal-dim">BTC</span>
        <span className={`font-bold ${btcChg >= 0 ? 'text-bull-text' : 'text-bear-text'}`}>
          {btcChg >= 0 ? '▲' : '▼'} {Math.abs(btcChg).toFixed(2)}%
        </span>
      </div>

      <div className="h-3 w-px bg-terminal-border/35" />

      {/* Signal direction */}
      <div className="flex items-center gap-2.5 shrink-0">
        <span className="text-bull-text">▲ {buySigs} BUY</span>
        <span className="text-bear-text">▼ {sellSigs} SELL</span>
      </div>

      <div className="flex-1" />

      {/* Mini breadth bars (desktop) */}
      <div className="hidden sm:flex items-end gap-0.5 h-4">
        {Array.from({ length: 12 }, (_, i) => {
          const idx = Math.floor((i / 12) * coins.length);
          const c   = coins[idx];
          const up  = (c?.priceChange24h ?? 0) >= 0;
          const h   = Math.min(Math.max(Math.abs(c?.priceChange24h ?? 0) * 1.5 + 2, 2), 14);
          return (
            <div key={i} className="w-1 rounded-sm flex-shrink-0"
              style={{ height: h, backgroundColor: (up ? '#00d084' : '#ff3b5c') + '70' }} />
          );
        })}
      </div>
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
