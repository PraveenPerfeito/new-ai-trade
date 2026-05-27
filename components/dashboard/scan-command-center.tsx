'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { TradingSignal, CoinData, ScannerMode } from '@/types';
import { SchedulerStatus, ScanHistoryEntry } from '@/lib/scheduler';
import { formatPrice, formatPct, formatVolume, cn } from '@/lib/utils';
import { ScanHistoryPanel }  from './scan-history-panel';
import { ProviderHealthBar } from './provider-health-bar';

// ─── Internal types ───────────────────────────────────────────────────────────

type CmdMode =
  | 'global' | 'single' | 'multi' | 'watchlist'
  | 'futures' | 'spot' | 'trending' | 'rotation'
  | 'hc_inst' | 'cross_val';

interface ScanModeConfig {
  id:          CmdMode;
  label:       string;
  short:       string;
  description: string;
  icon:        string;
  apiMode:     ScannerMode;
  color:       string;
  glow:        string;
  badge:       string;
  needsCoins?: boolean;
  needsWL?:    boolean;
}

interface Watchlist {
  id:       string;
  name:     string;
  emoji:    string;
  coins:    string[];
  scanMode: ScannerMode;
  created:  string;
}

interface SignalQuality {
  strength:      number;
  institutional: number;
  continuation:  number;
  correction:    number;
  regime:        'OPTIMAL' | 'FAVORABLE' | 'NEUTRAL' | 'CAUTION';
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SCAN_MODES: ScanModeConfig[] = [
  { id: 'global',    label: 'Global Scan',      short: 'GLOBAL',   description: 'Full top-100 market sweep',             icon: '◎', apiMode: 'spot',            color: '#3b82f6', glow: 'rgba(59,130,246,0.18)',   badge: 'ALL'  },
  { id: 'hc_inst',   label: 'Institutional',    short: 'HC·INST',  description: 'Highest-confluence setups only',         icon: '⬡', apiMode: 'high_confidence', color: '#f59e0b', glow: 'rgba(245,158,11,0.18)',   badge: 'HC'   },
  { id: 'futures',   label: 'Futures Scan',     short: 'FUTURES',  description: 'Leveraged setups with OI & funding',     icon: '◈', apiMode: 'futures',         color: '#8b5cf6', glow: 'rgba(139,92,246,0.18)',   badge: 'FUT'  },
  { id: 'trending',  label: 'Momentum',         short: 'MOMENTUM', description: 'Strongest trend continuations',          icon: '▲', apiMode: 'trending',        color: '#00d084', glow: 'rgba(0,208,132,0.18)',    badge: 'MTM'  },
  { id: 'spot',      label: 'Spot Scan',        short: 'SPOT',     description: 'Spot-only trade setups',                 icon: '◇', apiMode: 'spot',            color: '#06b6d4', glow: 'rgba(6,182,212,0.18)',    badge: 'SPOT' },
  { id: 'single',    label: 'Single Coin',      short: 'SINGLE',   description: 'Deep-scan one coin with full AI',        icon: '◉', apiMode: 'spot',            color: '#ec4899', glow: 'rgba(236,72,153,0.18)',   badge: '1×',  needsCoins: true },
  { id: 'multi',     label: 'Multi Coin',       short: 'MULTI',    description: 'Scan a custom coin selection',           icon: '⊞', apiMode: 'spot',            color: '#f97316', glow: 'rgba(249,115,22,0.18)',   badge: 'N×',  needsCoins: true },
  { id: 'watchlist', label: 'Watchlist',        short: 'WL SCAN',  description: 'Scan one of your saved watchlists',      icon: '★', apiMode: 'spot',            color: '#eab308', glow: 'rgba(234,179,8,0.18)',    badge: 'WL',  needsWL: true },
  { id: 'rotation',  label: 'Rotation',         short: 'ROTATION', description: 'Sector rotation & capital flow analysis',icon: '↻', apiMode: 'trending',        color: '#10b981', glow: 'rgba(16,185,129,0.18)',   badge: 'ROT'  },
  { id: 'cross_val', label: 'Cross Validate',   short: 'X·VAL',   description: 'Multi-mode agreement cross-validation',  icon: '⊕', apiMode: 'spot',            color: '#6366f1', glow: 'rgba(99,102,241,0.18)',   badge: 'XV'   },
];

const PIPELINE_STAGES = [
  { key: 'fetch',      label: 'Provider Fetch',     color: '#3b82f6' },
  { key: 'indicators', label: 'Indicators',         color: '#8b5cf6' },
  { key: 'risk',       label: 'Risk Engine',        color: '#f59e0b' },
  { key: 'ai',         label: 'AI Validate',        color: '#00d084' },
  { key: 'quality',    label: 'Quality Score',      color: '#ec4899' },
  { key: 'final',      label: 'Decision',           color: '#10b981' },
];

const DEFAULT_WATCHLISTS: Watchlist[] = [
  { id: 'majors', name: 'Futures Majors', emoji: '⬡', coins: ['BTC','ETH','BNB','SOL','XRP','DOGE','ADA','AVAX'],       scanMode: 'futures',         created: '' },
  { id: 'ai',     name: 'AI Coins',       emoji: '◈', coins: ['FET','NEAR','TAO','RENDER','AGIX','OCEAN','AKT','AIOZ'], scanMode: 'high_confidence', created: '' },
  { id: 'defi',   name: 'DeFi',           emoji: '◇', coins: ['UNI','AAVE','MKR','COMP','CRV','SNX','BAL','SUSHI'],     scanMode: 'spot',            created: '' },
  { id: 'l1l2',   name: 'L1 / L2',        emoji: '▲', coins: ['ETH','SOL','AVAX','MATIC','ARB','OP','ATOM','DOT','SUI'],scanMode: 'spot',            created: '' },
  { id: 'meme',   name: 'Meme Coins',     emoji: '◉', coins: ['DOGE','SHIB','PEPE','FLOKI','BONK','WIF','NEIRO'],      scanMode: 'trending',        created: '' },
];

const GRADE_COLOR: Record<string, string> = {
  A: '#00d084', B: '#3b82f6', C: '#f59e0b', D: '#f97316', F: '#ff3b5c',
};

type TFPreset = 'scalp' | 'day' | 'swing' | 'position';

interface TimeframePresetConfig {
  id: TFPreset; label: string; tf: string; apiMode: ScannerMode; conf: number; rr: number; color: string; desc: string;
}

const TIMEFRAME_PRESETS: TimeframePresetConfig[] = [
  { id: 'scalp',    label: 'Scalp',     tf: '15m·1h', apiMode: 'trending',        conf: 75, rr: 1.8, color: '#ec4899', desc: 'Fast momentum' },
  { id: 'day',      label: 'Day Trade', tf: '1h·4h',  apiMode: 'spot',            conf: 80, rr: 2.0, color: '#3b82f6', desc: 'Intraday setups' },
  { id: 'swing',    label: 'Swing',     tf: '4h·1D',  apiMode: 'spot',            conf: 83, rr: 2.5, color: '#8b5cf6', desc: 'Multi-day swing' },
  { id: 'position', label: 'Position',  tf: '1D',     apiMode: 'high_confidence', conf: 88, rr: 3.0, color: '#f59e0b', desc: 'Long-term setup' },
];

// Coin category groups for sector rotation display
const SECTORS: Array<{ name: string; symbols: string[]; color: string }> = [
  { name: 'Blue Chips', symbols: ['BTC','ETH','BNB'],                                  color: '#f59e0b' },
  { name: 'L1 / L2',   symbols: ['SOL','AVAX','MATIC','ARB','OP','ATOM','DOT','SUI'], color: '#3b82f6' },
  { name: 'DeFi',       symbols: ['UNI','AAVE','MKR','CRV','COMP','SNX','BAL','SUSHI'],color: '#8b5cf6' },
  { name: 'AI',         symbols: ['FET','NEAR','TAO','RENDER','AGIX','OCEAN','AKT'],   color: '#06b6d4' },
  { name: 'Meme',       symbols: ['DOGE','SHIB','PEPE','FLOKI','BONK','WIF'],          color: '#ec4899' },
  { name: 'Other',      symbols: [],                                                    color: '#4a5568' },
];

// ─── Quality computation (frontend-only) ──────────────────────────────────────

function computeQuality(signal: TradingSignal): SignalQuality {
  const rsi = signal.indicators?.rsi ?? 50;
  const vol = signal.indicators?.volumeSpike ?? 1;
  const qs  = signal.qualityScore ?? 50;
  const rs  = signal.riskScore ?? 50;

  const strength = Math.min(99, Math.max(1, Math.round(
    signal.confidence * 0.40 +
    qs * 0.35 +
    Math.min((signal.rrRatio / 4) * 100, 100) * 0.25,
  )));

  const institutional = Math.min(99, Math.max(1, Math.round(
    (signal.rrRatio >= 3 ? 30 : signal.rrRatio >= 2.5 ? 22 : 14) +
    qs * 0.40 +
    (100 - rs) * 0.30 +
    (signal.aiValidated ? 10 : 0),
  )));

  const continuation = Math.min(99, Math.max(1, Math.round(
    (vol >= 2.5 ? 85 : vol >= 2 ? 68 : vol >= 1.5 ? 52 : 34) * 0.40 +
    signal.confidence * 0.60,
  )));

  const base       = signal.type === 'BUY'
    ? (rsi > 75 ? 80 : rsi > 70 ? 55 : rsi > 65 ? 32 : 18)
    : (rsi < 25 ? 80 : rsi < 30 ? 55 : rsi < 35 ? 32 : 18);
  const correction = Math.min(95, base);

  const regime = rs <= 20 ? 'OPTIMAL' : rs <= 35 ? 'FAVORABLE' : rs <= 50 ? 'NEUTRAL' : 'CAUTION';

  return { strength, institutional, continuation, correction, regime: regime as SignalQuality['regime'] };
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  coins:           CoinData[];
  externalSignals: TradingSignal[];
  schedulerStatus: SchedulerStatus | null;
  isScanning:      boolean;
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ScanCommandCenter({ coins, externalSignals, schedulerStatus, isScanning }: Props) {
  // Scan state
  const [cmdMode,      setCmdMode]      = useState<CmdMode>('global');
  const [localSignals, setLocalSignals] = useState<TradingSignal[]>([]);
  const [scanning,     setScanning]     = useState(false);
  const [scanError,    setScanError]    = useState<string | null>(null);
  const [scanPhase,    setScanPhase]    = useState(-1);
  const [lastScan,     setLastScan]     = useState<{ mode: CmdMode; count: number; ms: number } | null>(null);
  const scanPhaseRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Controls
  const [coinInput,    setCoinInput]    = useState('');
  const [showControls, setShowControls] = useState(false);
  const [minConf,      setMinConf]      = useState(78);
  const [minRR,        setMinRR]        = useState(2.0);
  const [showBuy,      setShowBuy]      = useState(true);
  const [showSell,     setShowSell]     = useState(true);
  const [filterGrades, setFilterGrades] = useState<string[]>(['A', 'B', 'C']);
  const [expandedSig,  setExpandedSig]  = useState<string | null>(null);

  // Watchlists
  const [watchlists,   setWatchlists]   = useState<Watchlist[]>([]);
  const [activeWL,     setActiveWL]     = useState<string | null>(null);
  const [showWLPanel,  setShowWLPanel]  = useState(false);
  const [showWLCreate, setShowWLCreate] = useState(false);
  const [newWLName,    setNewWLName]    = useState('');
  const [newWLCoins,   setNewWLCoins]   = useState('');
  const [showHistory,  setShowHistory]  = useState(false);
  const [tfPreset,     setTfPreset]     = useState<TFPreset | null>(null);

  // Load watchlists from localStorage on mount (client-only)
  useEffect(() => {
    try {
      const raw = localStorage.getItem('qcc_wl_v1');
      setWatchlists(raw ? (JSON.parse(raw) as Watchlist[]) : DEFAULT_WATCHLISTS);
    } catch {
      setWatchlists(DEFAULT_WATCHLISTS);
    }
  }, []);

  const persistWL = useCallback((lists: Watchlist[]) => {
    setWatchlists(lists);
    try { localStorage.setItem('qcc_wl_v1', JSON.stringify(lists)); } catch {}
  }, []);

  const handleClearCache = useCallback(async () => {
    try { await fetch('/api/cache/clear', { method: 'POST' }); } catch {}
  }, []);

  const handleReplay = useCallback(async (entry: ScanHistoryEntry) => {
    if (scanning || isScanning) return;
    setScanError(null);
    setScanning(true);
    setLocalSignals([]);
    const t0 = Date.now();
    try {
      const res  = await fetch('/api/scanner/run', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: entry.mode }),
      });
      const json = await res.json();
      if (res.status === 423) { setScanError('A scan is already running — please wait.'); return; }
      if (res.status === 429) { setScanError(json.error ?? 'Rate limited'); return; }
      if (!json.success) { setScanError(json.error ?? 'Scan failed'); return; }
      setLocalSignals((json.signals ?? []) as TradingSignal[]);
      setLastScan({ mode: cmdMode, count: json.signals?.length ?? 0, ms: Date.now() - t0 });
    } catch (e) {
      setScanError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setScanning(false);
    }
  }, [scanning, isScanning, cmdMode]);

  const applyTfPreset = useCallback((p: TimeframePresetConfig) => {
    setTfPreset(p.id);
    setMinConf(p.conf);
    setMinRR(p.rr);
    const mc = SCAN_MODES.find(m => m.apiMode === p.apiMode);
    if (mc) setCmdMode(mc.id);
  }, []);

  // Pipeline animation while scanning
  useEffect(() => {
    const active = scanning || isScanning;
    if (!active) {
      if (scanPhaseRef.current) clearInterval(scanPhaseRef.current);
      const t = setTimeout(() => setScanPhase(-1), 1400);
      return () => clearTimeout(t);
    }
    setScanPhase(0);
    scanPhaseRef.current = setInterval(() =>
      setScanPhase(p => p < PIPELINE_STAGES.length - 1 ? p + 1 : p), 2600);
    return () => { if (scanPhaseRef.current) clearInterval(scanPhaseRef.current); };
  }, [scanning, isScanning]);

  // Merged + filtered signals
  const allSignals = localSignals.length > 0 ? localSignals : externalSignals;

  const displaySignals = useMemo(() =>
    allSignals.filter(s =>
      s.confidence >= minConf &&
      s.rrRatio    >= minRR   &&
      ((showBuy && s.type === 'BUY') || (showSell && s.type === 'SELL')) &&
      (filterGrades.length === 0 || filterGrades.includes(s.riskGrade ?? 'C')),
    ),
  [allSignals, minConf, minRR, showBuy, showSell, filterGrades]);

  // Market cap tier stats
  const tierStats = useMemo(() => [
    { label: 'Rank 1–10',   lo: 1,  hi: 10,  color: '#f59e0b' },
    { label: 'Rank 11–25',  lo: 11, hi: 25,  color: '#3b82f6' },
    { label: 'Rank 26–50',  lo: 26, hi: 50,  color: '#8b5cf6' },
    { label: 'Rank 51–100', lo: 51, hi: 100, color: '#10b981' },
  ].map(tier => {
    const tc = coins.filter(c => c.rank >= tier.lo && c.rank <= tier.hi);
    const ts = displaySignals.filter(s => {
      const c = coins.find(x => x.symbol === s.symbol);
      return c && c.rank >= tier.lo && c.rank <= tier.hi;
    });
    return {
      ...tier,
      coinCount: tc.length,
      sigCount:  ts.length,
      avgConf:   ts.length ? Math.round(ts.reduce((a, s) => a + s.confidence, 0) / ts.length) : 0,
      buyCount:  ts.filter(s => s.type === 'BUY').length,
      sellCount: ts.filter(s => s.type === 'SELL').length,
    };
  }), [coins, displaySignals]);

  // Sector rotation stats
  const sectorStats = useMemo(() => SECTORS.map(sector => {
    const sigs = displaySignals.filter(s =>
      sector.symbols.length === 0
        ? !SECTORS.slice(0, -1).some(sr => sr.symbols.includes(s.symbol))
        : sector.symbols.includes(s.symbol),
    );
    return { ...sector, sigCount: sigs.length, buyCount: sigs.filter(s => s.type === 'BUY').length };
  }), [displaySignals]);

  // ─── Scan handler ───────────────────────────────────────────────────────────

  const handleScan = useCallback(async () => {
    if (scanning || isScanning) return;
    setScanError(null);
    setScanning(true);
    setLocalSignals([]);
    const t0 = Date.now();
    const mc  = SCAN_MODES.find(m => m.id === cmdMode)!;
    let filterCoins: string[] | undefined;

    if (cmdMode === 'single') {
      const sym = coinInput.trim().toUpperCase();
      if (!sym) { setScanError('Enter a coin symbol for single scan'); setScanning(false); return; }
      filterCoins = [sym];
    } else if (cmdMode === 'multi') {
      filterCoins = coinInput.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
      if (!filterCoins.length) { setScanError('Enter at least one coin symbol'); setScanning(false); return; }
    } else if (cmdMode === 'watchlist') {
      const wl = watchlists.find(w => w.id === activeWL) ?? watchlists[0];
      if (!wl?.coins.length) { setScanError('Select a watchlist first (or create one)'); setScanning(false); return; }
      filterCoins = wl.coins;
    } else if (cmdMode === 'cross_val') {
      await runXVal(t0);
      return;
    }

    try {
      const res  = await fetch('/api/scanner/run', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: mc.apiMode, coins: filterCoins }),
      });
      const json = await res.json();
      if (res.status === 423) { setScanError('A scan is already running — please wait.'); return; }
      if (res.status === 429) { setScanError(json.error ?? 'Rate limit reached. Try again shortly.'); return; }
      if (!json.success)      { setScanError(json.error ?? 'Scan failed'); return; }
      setLocalSignals((json.signals ?? []) as TradingSignal[]);
      setLastScan({ mode: cmdMode, count: json.signals?.length ?? 0, ms: Date.now() - t0 });
    } catch (e) {
      setScanError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setScanning(false);
    }
  }, [cmdMode, coinInput, activeWL, watchlists, scanning, isScanning]);

  const runXVal = useCallback(async (t0: number) => {
    const modes: ScannerMode[] = ['spot', 'futures', 'high_confidence'];
    const all: TradingSignal[]  = [];
    const counts = new Map<string, number>();

    for (const m of modes) {
      try {
        const res  = await fetch('/api/scanner/run', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: m }),
        });
        const json = await res.json();
        if (json.success) {
          for (const s of (json.signals ?? []) as TradingSignal[]) {
            all.push(s);
            counts.set(s.symbol, (counts.get(s.symbol) ?? 0) + 1);
          }
        }
      } catch { /* non-fatal */ }
    }
    // Keep highest-confidence signal per symbol, prefer cross-validated ones
    const best = new Map<string, TradingSignal>();
    for (const s of all) {
      const prev = best.get(s.symbol);
      if (!prev || s.confidence > prev.confidence) best.set(s.symbol, s);
    }
    const result = Array.from(best.values())
      .sort((a, b) => (counts.get(b.symbol) ?? 0) - (counts.get(a.symbol) ?? 0) || b.confidence - a.confidence);
    setLocalSignals(result);
    setLastScan({ mode: 'cross_val', count: result.length, ms: Date.now() - t0 });
    setScanning(false);
  }, []);

  // ─── Watchlist CRUD ─────────────────────────────────────────────────────────

  const createWL = () => {
    if (!newWLName.trim()) return;
    const coinList = newWLCoins.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
    const wl: Watchlist = {
      id: Date.now().toString(), name: newWLName.trim(), emoji: '★',
      coins: coinList, scanMode: 'spot', created: new Date().toISOString(),
    };
    persistWL([...watchlists, wl]);
    setNewWLName(''); setNewWLCoins(''); setShowWLCreate(false); setActiveWL(wl.id);
  };

  const isBusy     = scanning || isScanning;
  const activeMC   = SCAN_MODES.find(m => m.id === cmdMode)!;
  const isRotation = cmdMode === 'rotation';

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-3 animate-fade-in">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2.5">
          <span className="text-[11px] font-bold text-terminal-muted uppercase tracking-[0.15em]">
            ⌘ Quant Command Center
          </span>
          {isBusy && (
            <span className="text-[9px] font-bold text-signal-high animate-pulse px-2 py-0.5 bg-signal-high/10 rounded-full border border-signal-high/30 tracking-wider">
              SCANNING
            </span>
          )}
          {lastScan && !isBusy && (
            <span className="text-[9px] text-terminal-dim font-mono">
              {lastScan.count} signals · {(lastScan.ms / 1000).toFixed(1)}s · {lastScan.mode.toUpperCase()}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setShowControls(v => !v)}
            className={cn('px-2.5 py-1 rounded-lg text-[10px] font-semibold transition-all border',
              showControls
                ? 'bg-terminal-surface text-terminal-text border-terminal-border/60'
                : 'text-terminal-muted border-terminal-border/30 hover:text-terminal-text hover:border-terminal-border/50'
            )}
          >
            ⚙ Controls
          </button>
          <button
            onClick={() => setShowWLPanel(v => !v)}
            className={cn('px-2.5 py-1 rounded-lg text-[10px] font-semibold transition-all border',
              showWLPanel
                ? 'bg-terminal-surface text-terminal-text border-terminal-border/60'
                : 'text-terminal-muted border-terminal-border/30 hover:text-terminal-text hover:border-terminal-border/50'
            )}
          >
            ★ Watchlists ({watchlists.length})
          </button>
          <button
            onClick={() => setShowHistory(v => !v)}
            className={cn('px-2.5 py-1 rounded-lg text-[10px] font-semibold transition-all border',
              showHistory
                ? 'bg-terminal-surface text-terminal-text border-terminal-border/60'
                : 'text-terminal-muted border-terminal-border/30 hover:text-terminal-text hover:border-terminal-border/50'
            )}
          >
            ◷ History
          </button>
        </div>
      </div>

      {/* ── Provider Health ────────────────────────────────────────────────────── */}
      <ProviderHealthBar />

      {/* ── Scan Mode Grid ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-5 gap-1.5">
        {SCAN_MODES.map(mode => (
          <ScanModeCard key={mode.id} mode={mode} active={cmdMode === mode.id} onClick={() => setCmdMode(mode.id)} />
        ))}
      </div>

      {/* ── Timeframe Presets ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[9px] text-terminal-dim uppercase tracking-wider shrink-0">TF Preset:</span>
        {TIMEFRAME_PRESETS.map(p => (
          <button
            key={p.id}
            onClick={() => applyTfPreset(p)}
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[9px] font-semibold border transition-all',
              tfPreset === p.id
                ? ''
                : 'border-terminal-border/25 text-terminal-dim hover:text-terminal-muted hover:border-terminal-border/40',
            )}
            style={tfPreset === p.id ? {
              borderColor:     p.color + '55',
              backgroundColor: p.color + '12',
              color:           p.color,
            } : {}}
            title={p.desc}
          >
            <span className="font-mono opacity-70">{p.tf}</span>
            <span className="font-bold">{p.label}</span>
          </button>
        ))}
      </div>

      {/* ── Controls panel ─────────────────────────────────────────────────── */}
      {showControls && (
        <ControlsPanel
          cmdMode={cmdMode}
          coinInput={coinInput}     onCoinInput={setCoinInput}
          minConf={minConf}         onMinConf={setMinConf}
          minRR={minRR}             onMinRR={setMinRR}
          showBuy={showBuy}         onShowBuy={setShowBuy}
          showSell={showSell}       onShowSell={setShowSell}
          filterGrades={filterGrades} onFilterGrades={setFilterGrades}
          watchlists={watchlists}   activeWL={activeWL} onSelectWL={setActiveWL}
        />
      )}

      {/* ── Action bar ─────────────────────────────────────────────────────── */}
      <ActionBar
        activeMode={activeMC}
        isBusy={isBusy}
        onScan={handleScan}
        onClear={() => { setLocalSignals([]); setScanError(null); setLastScan(null); setTfPreset(null); }}
        onPause={() => fetch('/api/scheduler/stop', { method: 'POST' })}
        onClearCache={handleClearCache}
        canReplay={!isBusy && (schedulerStatus?.history?.filter(h => h.status === 'completed').length ?? 0) > 0}
        onReplay={() => {
          const last = schedulerStatus?.history?.find(h => h.status === 'completed');
          if (last) void handleReplay(last);
        }}
      />

      {/* ── Error banner ───────────────────────────────────────────────────── */}
      {scanError && (
        <div className="px-4 py-2 bg-bear-muted border border-bear-DEFAULT/30 rounded-lg text-bear-text text-xs flex items-center justify-between animate-slide-up">
          <span>⚠ {scanError}</span>
          <button onClick={() => setScanError(null)} className="text-terminal-muted hover:text-terminal-text ml-3">✕</button>
        </div>
      )}

      {/* ── Pipeline visualization ──────────────────────────────────────────── */}
      {(isBusy || scanPhase >= 0) && <PipelineViz phase={scanPhase} isBusy={isBusy} />}

      {/* ── Main content: signals + watchlist panel ─────────────────────────── */}
      <div className={cn('grid gap-3', showWLPanel ? 'grid-cols-1 lg:grid-cols-[1fr_268px]' : 'grid-cols-1')}>

        {/* Signals */}
        <div className="flex flex-col gap-2 min-w-0">
          <SignalsHeader count={displaySignals.length} total={allSignals.length} />
          {isRotation && displaySignals.length > 0 && <RotationOverlay sectorStats={sectorStats} />}
          {displaySignals.length === 0 ? (
            <EmptySignals isBusy={isBusy} hasFilters={minConf > 70 || minRR > 2 || filterGrades.length < 5} />
          ) : (
            <div className="flex flex-col gap-1.5">
              {displaySignals.map(sig => (
                <CommandSignalRow
                  key={sig.id ?? `${sig.symbol}-${sig.type}`}
                  signal={sig}
                  expanded={expandedSig === (sig.id ?? `${sig.symbol}-${sig.type}`)}
                  onToggle={() => setExpandedSig(prev => {
                    const k = sig.id ?? `${sig.symbol}-${sig.type}`;
                    return prev === k ? null : k;
                  })}
                />
              ))}
            </div>
          )}
        </div>

        {/* Watchlist panel */}
        {showWLPanel && (
          <WatchlistPanel
            watchlists={watchlists}
            activeWL={activeWL}
            onSelectWL={setActiveWL}
            onDelete={id => persistWL(watchlists.filter(w => w.id !== id))}
            onScanWL={wl => { setCmdMode('watchlist'); setActiveWL(wl.id); }}
            showCreate={showWLCreate}
            onToggleCreate={() => setShowWLCreate(v => !v)}
            newWLName={newWLName}   onNewWLName={setNewWLName}
            newWLCoins={newWLCoins} onNewWLCoins={setNewWLCoins}
            onCreate={createWL}
          />
        )}
      </div>

      {/* ── Market Cap Intelligence ─────────────────────────────────────────── */}
      <MarketCapIntelligence tiers={tierStats} />

      {/* ── Scan History ────────────────────────────────────────────────────── */}
      {showHistory && (
        <ScanHistoryPanel
          history={schedulerStatus?.history ?? []}
          onReplay={handleReplay}
        />
      )}

    </div>
  );
}

// ─── ScanModeCard ─────────────────────────────────────────────────────────────

function ScanModeCard({ mode, active, onClick }: { mode: ScanModeConfig; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'glass-card rounded-xl px-2.5 py-2 flex flex-col gap-1 text-left transition-all duration-150',
        'hover:scale-[1.02] relative overflow-hidden',
        active ? 'scale-[1.02]' : 'hover:border-white/10',
      )}
      style={active ? { borderColor: mode.color + '55', boxShadow: `0 0 14px ${mode.glow}` } : {}}
    >
      {active && (
        <div className="absolute inset-0 pointer-events-none opacity-[0.05]"
          style={{ background: `radial-gradient(ellipse at 50% 0%, ${mode.color}, transparent 70%)` }} />
      )}
      <div className="relative flex items-center justify-between">
        <span className="text-sm leading-none transition-colors" style={{ color: active ? mode.color : '#4a5568' }}>
          {mode.icon}
        </span>
        <span
          className="text-[8px] font-bold tracking-wider px-1 py-0.5 rounded"
          style={{
            background: (active ? mode.color : '#1a2030') + '30',
            color: active ? mode.color : '#4a5568',
          }}
        >
          {mode.badge}
        </span>
      </div>
      <div className="relative">
        <p className={cn('text-[10px] font-bold truncate', active ? 'text-terminal-text' : 'text-terminal-muted')}>
          {mode.label}
        </p>
        <p className="text-[8px] text-terminal-dim leading-tight mt-0.5 line-clamp-2">{mode.description}</p>
      </div>
    </button>
  );
}

// ─── ControlsPanel ───────────────────────────────────────────────────────────

interface ControlsPanelProps {
  cmdMode: CmdMode; coinInput: string; onCoinInput: (v: string) => void;
  minConf: number; onMinConf: (v: number) => void;
  minRR: number; onMinRR: (v: number) => void;
  showBuy: boolean; onShowBuy: (v: boolean) => void;
  showSell: boolean; onShowSell: (v: boolean) => void;
  filterGrades: string[]; onFilterGrades: (g: string[]) => void;
  watchlists: Watchlist[]; activeWL: string | null; onSelectWL: (id: string | null) => void;
}

function ControlsPanel({
  cmdMode, coinInput, onCoinInput, minConf, onMinConf, minRR, onMinRR,
  showBuy, onShowBuy, showSell, onShowSell, filterGrades, onFilterGrades,
  watchlists, activeWL, onSelectWL,
}: ControlsPanelProps) {
  const needsCoins = cmdMode === 'single' || cmdMode === 'multi';
  const needsWL    = cmdMode === 'watchlist';

  const toggleGrade = (g: string) =>
    onFilterGrades(filterGrades.includes(g) ? filterGrades.filter(x => x !== g) : [...filterGrades, g]);

  return (
    <div className="glass-card rounded-xl p-4 border border-terminal-border/40 animate-fade-in">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">

        {/* Coin / watchlist input */}
        {(needsCoins || needsWL) && (
          <div className={needsCoins ? 'sm:col-span-2' : ''}>
            {needsCoins ? (
              <label className="block">
                <span className="text-[10px] text-terminal-muted uppercase tracking-wider mb-1.5 block">
                  {cmdMode === 'single' ? 'Coin Symbol' : 'Coins (comma-separated)'}
                </span>
                <input
                  type="text" value={coinInput}
                  onChange={e => onCoinInput(e.target.value.toUpperCase())}
                  placeholder={cmdMode === 'single' ? 'BTC' : 'BTC, ETH, SOL, BNB'}
                  className="w-full bg-terminal-surface border border-terminal-border/50 rounded-lg px-3 py-2 text-xs font-mono text-terminal-text placeholder:text-terminal-dim focus:outline-none focus:border-bull-DEFAULT/50"
                />
              </label>
            ) : (
              <label className="block">
                <span className="text-[10px] text-terminal-muted uppercase tracking-wider mb-1.5 block">Watchlist</span>
                <select
                  value={activeWL ?? ''}
                  onChange={e => onSelectWL(e.target.value || null)}
                  className="w-full bg-terminal-surface border border-terminal-border/50 rounded-lg px-3 py-2 text-xs font-mono text-terminal-text focus:outline-none focus:border-bull-DEFAULT/50"
                >
                  <option value="">Select watchlist…</option>
                  {watchlists.map(wl => (
                    <option key={wl.id} value={wl.id}>{wl.emoji} {wl.name} ({wl.coins.length})</option>
                  ))}
                </select>
              </label>
            )}
          </div>
        )}

        {/* Min confidence */}
        <div>
          <span className="text-[10px] text-terminal-muted uppercase tracking-wider mb-1.5 block">
            Min Confidence: <span className="text-terminal-text font-bold font-mono">{minConf}%</span>
          </span>
          <input type="range" min={65} max={95} step={1} value={minConf}
            onChange={e => onMinConf(Number(e.target.value))}
            className="w-full h-1 accent-bull-DEFAULT cursor-pointer" />
          <div className="flex justify-between text-[9px] text-terminal-dim mt-0.5">
            <span>65</span><span className="text-terminal-muted">80</span><span>95</span>
          </div>
        </div>

        {/* Min RR */}
        <div>
          <span className="text-[10px] text-terminal-muted uppercase tracking-wider mb-1.5 block">
            Min R:R Ratio: <span className="text-terminal-text font-bold font-mono">{minRR.toFixed(1)}×</span>
          </span>
          <input type="range" min={1.5} max={4.0} step={0.1} value={minRR}
            onChange={e => onMinRR(Number(e.target.value))}
            className="w-full h-1 accent-bull-DEFAULT cursor-pointer" />
          <div className="flex justify-between text-[9px] text-terminal-dim mt-0.5">
            <span>1.5×</span><span className="text-terminal-muted">2.5×</span><span>4×</span>
          </div>
        </div>

        {/* Signal type */}
        <div>
          <span className="text-[10px] text-terminal-muted uppercase tracking-wider mb-1.5 block">Signal Type</span>
          <div className="flex gap-2">
            {([['BUY', showBuy, onShowBuy, '#00d084'] as const, ['SELL', showSell, onShowSell, '#ff3b5c'] as const]).map(
              ([label, active, toggle, color]) => (
                <button key={label} onClick={() => toggle(!active)}
                  className="flex-1 py-1.5 rounded-lg text-[10px] font-bold border transition-all"
                  style={active ? { backgroundColor: color + '15', borderColor: color + '40', color } : { borderColor: '#2d3748', color: '#4a5568' }}
                >
                  {label === 'BUY' ? '▲' : '▼'} {label}
                </button>
              )
            )}
          </div>
        </div>

        {/* Risk grades */}
        <div>
          <span className="text-[10px] text-terminal-muted uppercase tracking-wider mb-1.5 block">Risk Grade</span>
          <div className="flex gap-1">
            {(['A','B','C','D','F'] as const).map(g => (
              <button key={g} onClick={() => toggleGrade(g)}
                className="flex-1 py-1.5 rounded text-[10px] font-bold border transition-all"
                style={filterGrades.includes(g) ? {
                  color: GRADE_COLOR[g], borderColor: GRADE_COLOR[g] + '50',
                  backgroundColor: GRADE_COLOR[g] + '12',
                } : { borderColor: '#1e2736', color: '#2d3748' }}
              >
                {g}
              </button>
            ))}
          </div>
        </div>

        {/* Presets */}
        <div className="sm:col-span-2">
          <span className="text-[10px] text-terminal-muted uppercase tracking-wider mb-1.5 block">Quick Presets</span>
          <div className="flex gap-1.5 flex-wrap">
            {[
              { label: 'Conservative',  conf: 87, rr: 2.5, grades: ['A','B'],           color: '#00d084' },
              { label: 'Balanced',      conf: 80, rr: 2.0, grades: ['A','B','C'],        color: '#3b82f6' },
              { label: 'Aggressive',    conf: 75, rr: 1.8, grades: ['A','B','C','D'],    color: '#f97316' },
              { label: 'Institutional', conf: 88, rr: 3.0, grades: ['A'],                color: '#f59e0b' },
            ].map(p => (
              <button key={p.label}
                onClick={() => { onMinConf(p.conf); onMinRR(p.rr); onFilterGrades(p.grades); }}
                className="px-2.5 py-1 rounded-lg text-[9px] font-semibold border transition-all"
                style={{ borderColor: p.color + '30', color: p.color + 'cc' }}
                onMouseEnter={e => (e.currentTarget.style.backgroundColor = p.color + '12')}
                onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}

// ─── ActionBar ────────────────────────────────────────────────────────────────

function ActionBar({
  activeMode, isBusy, onScan, onClear, onPause, onClearCache, onReplay, canReplay,
}: {
  activeMode: ScanModeConfig; isBusy: boolean;
  onScan: () => void; onClear: () => void; onPause: () => void;
  onClearCache: () => void; onReplay: () => void; canReplay: boolean;
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <button
        onClick={onScan} disabled={isBusy}
        className={cn(
          'flex items-center gap-2 px-5 py-2 rounded-lg text-xs font-bold transition-all border',
          isBusy ? 'opacity-50 cursor-not-allowed border-terminal-border/30 text-terminal-muted'
                 : 'hover:scale-[1.02] active:scale-[0.98]',
        )}
        style={!isBusy ? {
          background:  activeMode.color + '18', borderColor: activeMode.color + '50',
          color:       activeMode.color,       boxShadow: `0 0 10px ${activeMode.glow}`,
        } : {}}
      >
        {isBusy
          ? <><span className="inline-block animate-spin text-sm leading-none">◌</span> Scanning…</>
          : <><span className="text-sm leading-none">{activeMode.icon}</span> Run {activeMode.short}</>
        }
      </button>

      <button onClick={onClear}
        className="px-3 py-2 rounded-lg text-[10px] font-semibold border border-terminal-border/30 text-terminal-muted hover:text-terminal-text hover:border-terminal-border/50 transition-all">
        ⟳ Clear
      </button>

      <button
        onClick={onReplay} disabled={!canReplay}
        className={cn(
          'px-3 py-2 rounded-lg text-[10px] font-semibold border transition-all',
          canReplay
            ? 'border-terminal-border/30 text-terminal-muted hover:text-terminal-text hover:border-terminal-border/50'
            : 'border-terminal-border/15 text-terminal-dim opacity-40 cursor-not-allowed',
        )}
      >
        ▶ Replay
      </button>

      <button onClick={onClearCache}
        className="px-3 py-2 rounded-lg text-[10px] font-semibold border border-terminal-border/25 text-terminal-dim hover:text-terminal-muted hover:border-terminal-border/45 transition-all">
        ⊘ Cache
      </button>

      <button onClick={onPause}
        className="px-3 py-2 rounded-lg text-[10px] font-semibold border border-bear-DEFAULT/20 text-bear-text/50 hover:text-bear-text hover:border-bear-DEFAULT/45 transition-all">
        ⬛ Pause
      </button>

      <div className="flex-1" />
      <span className="text-[10px] text-terminal-dim hidden lg:block">{activeMode.description}</span>
    </div>
  );
}

// ─── PipelineViz ──────────────────────────────────────────────────────────────

function PipelineViz({ phase, isBusy }: { phase: number; isBusy: boolean }) {
  return (
    <div className="glass-card rounded-xl px-4 py-3 border border-terminal-border/35 animate-fade-in">
      <div className="flex items-center gap-1.5 mb-3">
        <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', isBusy ? 'bg-signal-high animate-pulse' : 'bg-terminal-muted')} />
        <span className="text-[10px] text-terminal-muted uppercase tracking-wider">
          {isBusy ? 'Signal Generation Pipeline — Active' : 'Pipeline Complete'}
        </span>
      </div>
      <div className="flex items-start">
        {PIPELINE_STAGES.map((stage, i) => {
          const done    = i < phase;
          const current = i === phase && isBusy;
          const waiting = i > phase;
          return (
            <div key={stage.key} className="flex items-center flex-1 min-w-0">
              <div className="flex flex-col items-center gap-1 flex-1 min-w-0">
                <div
                  className={cn('w-6 h-6 rounded-full flex items-center justify-center text-[8px] font-bold border transition-all duration-500 flex-shrink-0', current && 'animate-pulse')}
                  style={!waiting ? {
                    borderColor:     stage.color + (done ? '70' : current ? '90' : '20'),
                    backgroundColor: stage.color + (done ? '22' : current ? '18' : '06'),
                    color:           done || current ? stage.color : '#2d3748',
                    boxShadow:       current ? `0 0 10px ${stage.color}50` : undefined,
                  } : { borderColor: '#1e2736', backgroundColor: '#0d1117', color: '#2d3748' }}
                >
                  {done ? '✓' : i + 1}
                </div>
                <span
                  className="text-[8px] font-mono truncate w-full text-center leading-none"
                  style={{ color: done || current ? stage.color : '#2d3748' }}
                >
                  {stage.label}
                </span>
              </div>
              {i < PIPELINE_STAGES.length - 1 && (
                <div
                  className="h-px mx-0.5 flex-shrink-0 w-3 transition-all duration-500 mt-[-12px]"
                  style={{ background: done ? `linear-gradient(90deg,${stage.color}50,${PIPELINE_STAGES[i+1].color}50)` : '#1e2736' }}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── SignalsHeader ────────────────────────────────────────────────────────────

function SignalsHeader({ count, total }: { count: number; total: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-terminal-muted uppercase tracking-widest">Signals</span>
      <span className="text-[10px] font-bold text-terminal-text font-mono px-1.5 py-0.5 bg-terminal-surface rounded border border-terminal-border/40">
        {count}
      </span>
      {count < total && <span className="text-[9px] text-terminal-dim">of {total}</span>}
      <div className="flex-1 h-px bg-terminal-border/30" />
    </div>
  );
}

// ─── EmptySignals ─────────────────────────────────────────────────────────────

function EmptySignals({ isBusy, hasFilters }: { isBusy: boolean; hasFilters: boolean }) {
  return (
    <div className="glass-card rounded-xl px-6 py-8 flex flex-col items-center gap-2 border border-dashed border-terminal-border/25">
      <span className="text-terminal-muted text-2xl leading-none">{isBusy ? '◌' : '◎'}</span>
      <p className="text-[11px] text-terminal-muted font-mono">
        {isBusy ? 'Scanning in progress…'
         : hasFilters ? 'No signals match current filters'
         : 'Run a scan to generate signals'}
      </p>
      {hasFilters && !isBusy && (
        <p className="text-[10px] text-terminal-dim">Try lowering confidence threshold or relaxing grade filters</p>
      )}
    </div>
  );
}

// ─── RotationOverlay ──────────────────────────────────────────────────────────

function RotationOverlay({ sectorStats }: {
  sectorStats: Array<{ name: string; color: string; sigCount: number; buyCount: number }>;
}) {
  const maxSig = Math.max(...sectorStats.map(s => s.sigCount), 1);
  return (
    <div className="glass-card rounded-xl p-3 border border-terminal-border/35 mb-1">
      <p className="text-[9px] text-terminal-muted uppercase tracking-wider mb-2.5">↻ Sector Rotation Intelligence</p>
      <div className="grid grid-cols-3 gap-2">
        {sectorStats.filter(s => s.sigCount > 0 || s.name !== 'Other').map(s => (
          <div key={s.name} className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className="text-[9px] font-semibold" style={{ color: s.sigCount > 0 ? s.color : '#4a5568' }}>{s.name}</span>
              <span className="text-[9px] font-mono font-bold" style={{ color: s.sigCount > 0 ? s.color : '#2d3748' }}>
                {s.sigCount > 0 ? `${s.sigCount} sig` : '—'}
              </span>
            </div>
            <div className="w-full h-1 bg-terminal-surface rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all duration-700"
                style={{ width: `${(s.sigCount / maxSig) * 100}%`, background: s.color }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── CommandSignalRow ─────────────────────────────────────────────────────────

function CommandSignalRow({ signal, expanded, onToggle }: {
  signal: TradingSignal; expanded: boolean;
  onToggle: () => void;
}) {
  const quality = useMemo(() => computeQuality(signal), [signal]);
  const isBuy   = signal.type === 'BUY';
  const grade   = signal.riskGrade ?? 'C';
  const sigKey  = signal.id ?? `${signal.symbol}-${signal.type}`;

  return (
    <div
      className={cn('glass-card rounded-xl border-l-2 transition-all duration-150 overflow-hidden',
        expanded ? 'border-terminal-border/45' : 'border-terminal-border/20 hover:border-terminal-border/40',
      )}
      style={{ borderLeftColor: isBuy ? '#00d08445' : '#ff3b5c45' }}
    >
      {/* Main row */}
      <div className="flex items-center gap-2.5 px-3.5 py-2.5 cursor-pointer select-none" onClick={onToggle}>

        {/* Type badge */}
        <span className={cn('text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0 font-mono',
          isBuy ? 'bg-bull-DEFAULT/12 text-bull-text' : 'bg-bear-DEFAULT/12 text-bear-text')}
        >
          {isBuy ? '▲' : '▼'} {signal.type}
        </span>

        {/* Symbol */}
        <span className="font-mono font-bold text-xs text-terminal-text w-[52px] shrink-0">{signal.symbol}</span>

        {/* Prices — hidden on small screens */}
        <div className="hidden sm:flex items-center gap-3 text-[10px] font-mono flex-1 min-w-0 overflow-hidden">
          <span className="text-terminal-dim shrink-0">E:<span className="text-terminal-text ml-0.5">{formatPrice(signal.entryPrice)}</span></span>
          <span className="text-terminal-dim shrink-0">TP:<span className="text-bull-text ml-0.5">{formatPrice(signal.targetPrice)}</span></span>
          <span className="text-terminal-dim shrink-0">SL:<span className="text-bear-text ml-0.5">{formatPrice(signal.stopLoss)}</span></span>
        </div>

        {/* Right side metrics */}
        <div className="flex items-center gap-2 ml-auto shrink-0">
          <span className="hidden md:block text-[10px] font-mono text-terminal-dim">
            R:R <span className="text-terminal-text font-bold">{signal.rrRatio.toFixed(1)}×</span>
          </span>

          {/* Confidence bar */}
          <div className="hidden sm:flex flex-col items-end gap-0.5 w-14 shrink-0">
            <span className="text-[9px] font-mono text-terminal-muted">{signal.confidence}%</span>
            <div className="w-full h-1 bg-terminal-surface rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all"
                style={{
                  width: `${signal.confidence}%`,
                  background: signal.confidence >= 87 ? '#f59e0b' : signal.confidence >= 80 ? '#00d084' : '#3b82f6',
                }} />
            </div>
          </div>

          {/* Grade badge */}
          <span className="text-[10px] font-bold w-6 h-6 flex items-center justify-center rounded border shrink-0 font-mono"
            style={{ color: GRADE_COLOR[grade], borderColor: GRADE_COLOR[grade] + '45', backgroundColor: GRADE_COLOR[grade] + '10' }}>
            {grade}
          </span>

          {/* Strength score */}
          <div className="hidden lg:flex flex-col items-center gap-0 w-9 shrink-0">
            <span className="text-[8px] text-terminal-dim leading-none">STR</span>
            <span className="text-[11px] font-bold font-mono leading-none mt-0.5"
              style={{ color: quality.strength > 75 ? '#f59e0b' : quality.strength > 60 ? '#00d084' : '#3b82f6' }}>
              {quality.strength}
            </span>
          </div>

          <span className="text-terminal-dim text-[10px] ml-0.5 select-none">{expanded ? '▲' : '▼'}</span>
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && <SignalDetailPanel signal={signal} quality={quality} />}
    </div>
  );
}

// ─── SignalDetailPanel ────────────────────────────────────────────────────────

function SignalDetailPanel({ signal, quality }: { signal: TradingSignal; quality: SignalQuality }) {
  const ind = signal.indicators;
  const fut = signal.futuresData;
  const ex  = signal.aiExplainability;

  const regimeColor = { OPTIMAL: '#00d084', FAVORABLE: '#3b82f6', NEUTRAL: '#f59e0b', CAUTION: '#ff3b5c' }[quality.regime];

  return (
    <div className="border-t border-terminal-border/15 px-4 pt-3 pb-3.5 animate-fade-in">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">

        {/* Technical indicators */}
        <div>
          <p className="text-[9px] text-terminal-muted uppercase tracking-wider mb-2">Technical Indicators</p>
          <div className="flex flex-col gap-1">
            {[
              { label: 'RSI',       val: ind?.rsi?.toFixed(1) ?? '—',               color: ind?.rsi ? (signal.type==='BUY' ? ind.rsi>=55&&ind.rsi<=70?'#00d084':'#f59e0b' : ind.rsi>=30&&ind.rsi<=45?'#00d084':'#f59e0b') : '#4a5568' },
              { label: 'MACD Hist', val: ind?.macd?.histogram?.toFixed(5) ?? '—',   color: (ind?.macd?.histogram ?? 0)>0 ? '#00d084' : '#ff3b5c' },
              { label: 'EMA 20',    val: ind?.ema20 ? formatPrice(ind.ema20) : '—', color: '#3b82f6' },
              { label: 'EMA 50',    val: ind?.ema50 ? formatPrice(ind.ema50) : '—', color: '#8b5cf6' },
              { label: 'ATR',       val: ind?.atr   ? formatPrice(ind.atr)   : '—', color: '#f59e0b' },
              { label: 'Vol Spike', val: ind?.volumeSpike ? `${ind.volumeSpike.toFixed(2)}×` : '—', color: (ind?.volumeSpike??1)>=1.5?'#00d084':'#4a5568' },
              { label: 'Trend',     val: ind?.trend ?? '—',                          color: ind?.trend==='BULLISH'?'#00d084':ind?.trend==='BEARISH'?'#ff3b5c':'#f59e0b' },
            ].map(row => (
              <div key={row.label} className="flex items-center justify-between">
                <span className="text-[10px] text-terminal-dim">{row.label}</span>
                <span className="text-[10px] font-mono font-bold" style={{ color: row.color }}>{row.val}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Signal Quality Engine */}
        <div>
          <p className="text-[9px] text-terminal-muted uppercase tracking-wider mb-2">Signal Quality Engine</p>
          <div className="flex flex-col gap-2">
            {[
              { label: 'Signal Strength',    val: quality.strength,      color: '#f59e0b' },
              { label: 'Institutional Score',val: quality.institutional, color: '#8b5cf6' },
              { label: 'Continuation Prob',  val: quality.continuation,  color: '#00d084' },
              { label: 'Pullback Risk',       val: quality.correction,    color: '#ff3b5c' },
            ].map(row => (
              <div key={row.label}>
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-[9px] text-terminal-dim">{row.label}</span>
                  <span className="text-[9px] font-mono font-bold" style={{ color: row.color }}>{row.val}%</span>
                </div>
                <div className="w-full h-1 bg-terminal-surface rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-700" style={{ width: `${row.val}%`, background: row.color }} />
                </div>
              </div>
            ))}
            <div className="flex items-center justify-between mt-0.5">
              <span className="text-[9px] text-terminal-dim">Market Regime</span>
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded font-mono"
                style={{ color: regimeColor, backgroundColor: regimeColor + '15', border: `1px solid ${regimeColor}30` }}>
                {quality.regime}
              </span>
            </div>
          </div>
        </div>

        {/* AI Intelligence */}
        <div>
          {ex && (
            <div className="mb-3">
              <p className="text-[9px] text-terminal-muted uppercase tracking-wider mb-1.5">AI Explainability</p>
              <div className="flex flex-col gap-1.5">
                {[['Trend', ex.trend], ['Momentum', ex.momentum], ['Volatility', ex.volatility]].map(([k, v]) => (
                  v && <div key={k}>
                    <span className="text-[9px] text-terminal-muted font-semibold">{k}: </span>
                    <span className="text-[9px] text-terminal-dim">{v}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {!ex && signal.aiReasoning && (
            <div className="mb-3">
              <p className="text-[9px] text-terminal-muted uppercase tracking-wider mb-1.5">AI Reasoning</p>
              <p className="text-[10px] text-terminal-dim leading-relaxed line-clamp-4">{signal.aiReasoning}</p>
            </div>
          )}
          {fut && (
            <div>
              <p className="text-[9px] text-terminal-muted uppercase tracking-wider mb-1.5">Futures Intelligence</p>
              <div className="flex flex-col gap-1">
                {[
                  { label: 'Funding Rate', val: `${(fut.fundingRate * 100).toFixed(4)}%`, color: Math.abs(fut.fundingRate)>0.001?'#f97316':'#00d084' },
                  { label: 'OI Trend',     val: fut.oiTrend ?? '—',                        color: '#3b82f6' },
                  { label: 'Breakout',     val: fut.breakout?.detected ? 'YES' : 'NO',     color: fut.breakout?.detected ? '#00d084' : '#4a5568' },
                ].map(row => (
                  <div key={row.label} className="flex items-center justify-between">
                    <span className="text-[10px] text-terminal-dim">{row.label}</span>
                    <span className="text-[10px] font-mono font-bold" style={{ color: row.color }}>{row.val}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {/* Strength / risk tags */}
          {(signal.strengths?.length || signal.risks?.length) ? (
            <div className="mt-2 pt-2 border-t border-terminal-border/12">
              <div className="flex flex-wrap gap-1">
                {signal.strengths?.slice(0, 3).map((s, i) => (
                  <span key={i} className="text-[8px] px-1.5 py-0.5 bg-bull-DEFAULT/8 text-bull-text rounded border border-bull-DEFAULT/15 leading-none">{s}</span>
                ))}
                {signal.risks?.slice(0, 2).map((r, i) => (
                  <span key={i} className="text-[8px] px-1.5 py-0.5 bg-bear-DEFAULT/8 text-bear-text rounded border border-bear-DEFAULT/15 leading-none">{r}</span>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* Setup description footer */}
      {signal.setupDescription && (
        <div className="mt-2.5 pt-2 border-t border-terminal-border/12">
          <span className="text-[9px] text-terminal-muted uppercase tracking-wider mr-2">Setup:</span>
          <span className="text-[10px] text-terminal-dim">{signal.setupDescription}</span>
        </div>
      )}
    </div>
  );
}

// ─── WatchlistPanel ───────────────────────────────────────────────────────────

function WatchlistPanel({
  watchlists, activeWL, onSelectWL, onDelete, onScanWL,
  showCreate, onToggleCreate, newWLName, onNewWLName, newWLCoins, onNewWLCoins, onCreate,
}: {
  watchlists: Watchlist[]; activeWL: string | null;
  onSelectWL: (id: string | null) => void; onDelete: (id: string) => void;
  onScanWL: (wl: Watchlist) => void;
  showCreate: boolean; onToggleCreate: () => void;
  newWLName: string; onNewWLName: (v: string) => void;
  newWLCoins: string; onNewWLCoins: (v: string) => void;
  onCreate: () => void;
}) {
  return (
    <div className="glass-card rounded-xl border border-terminal-border/40 p-3 flex flex-col gap-2 h-fit">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-terminal-muted uppercase tracking-wider">★ Watchlists</span>
        <button onClick={onToggleCreate}
          className="text-[9px] text-terminal-muted hover:text-terminal-text border border-terminal-border/30 hover:border-terminal-border/55 rounded px-1.5 py-0.5 transition-all">
          + New
        </button>
      </div>

      {showCreate && (
        <div className="p-2.5 bg-terminal-surface/40 rounded-lg border border-terminal-border/30 animate-fade-in flex flex-col gap-1.5">
          <input type="text" placeholder="Watchlist name" value={newWLName}
            onChange={e => onNewWLName(e.target.value)}
            className="w-full bg-transparent border border-terminal-border/35 rounded px-2 py-1 text-[10px] font-mono text-terminal-text placeholder:text-terminal-dim focus:outline-none focus:border-bull-DEFAULT/45"
          />
          <input type="text" placeholder="BTC, ETH, SOL…" value={newWLCoins}
            onChange={e => onNewWLCoins(e.target.value.toUpperCase())}
            className="w-full bg-transparent border border-terminal-border/35 rounded px-2 py-1 text-[10px] font-mono text-terminal-text placeholder:text-terminal-dim focus:outline-none focus:border-bull-DEFAULT/45"
          />
          <button onClick={onCreate}
            className="w-full py-1.5 bg-bull-DEFAULT/12 border border-bull-DEFAULT/30 rounded text-[10px] text-bull-text font-bold hover:bg-bull-DEFAULT/22 transition-all">
            Create Watchlist
          </button>
        </div>
      )}

      <div className="flex flex-col gap-1">
        {watchlists.map(wl => (
          <div key={wl.id}
            className={cn('flex items-center gap-2 p-2 rounded-lg border transition-all cursor-pointer group',
              activeWL === wl.id ? 'bg-terminal-surface border-terminal-border/50' : 'border-terminal-border/15 hover:border-terminal-border/35'
            )}
            onClick={() => onSelectWL(wl.id === activeWL ? null : wl.id)}
          >
            <span className="text-sm shrink-0 leading-none">{wl.emoji}</span>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-semibold text-terminal-text truncate">{wl.name}</p>
              <p className="text-[9px] text-terminal-dim truncate">
                {wl.coins.slice(0, 4).join(', ')}{wl.coins.length > 4 ? ` +${wl.coins.length - 4}` : ''}
              </p>
            </div>
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button onClick={e => { e.stopPropagation(); onScanWL(wl); }}
                className="text-[8px] px-1.5 py-0.5 bg-bull-DEFAULT/12 text-bull-text rounded hover:bg-bull-DEFAULT/22 border border-bull-DEFAULT/20 transition-all font-bold">
                ▶
              </button>
              {!DEFAULT_WATCHLISTS.find(d => d.id === wl.id) && (
                <button onClick={e => { e.stopPropagation(); onDelete(wl.id); }}
                  className="text-[8px] px-1 py-0.5 text-bear-text/50 hover:text-bear-text hover:bg-bear-DEFAULT/10 rounded transition-all">
                  ✕
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── MarketCapIntelligence ────────────────────────────────────────────────────

function MarketCapIntelligence({ tiers }: {
  tiers: Array<{ label: string; color: string; coinCount: number; sigCount: number; avgConf: number; buyCount: number; sellCount: number }>;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2.5">
        <span className="text-[10px] text-terminal-muted uppercase tracking-widest">Market Cap Intelligence</span>
        <div className="flex-1 h-px bg-terminal-border/40" />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        {tiers.map(tier => (
          <div key={tier.label}
            className="glass-card rounded-xl px-3.5 py-3 relative overflow-hidden hover:border-white/10 transition-all duration-200"
            style={{ borderTop: `2px solid ${tier.color}28` }}
          >
            <div className="absolute top-0 left-0 right-0 h-px"
              style={{ background: `linear-gradient(90deg, transparent, ${tier.color}55, transparent)` }} />
            <div className="absolute inset-0 opacity-[0.025] pointer-events-none"
              style={{ background: `radial-gradient(ellipse at 10% 0%, ${tier.color}, transparent 70%)` }} />
            <div className="relative">
              <p className="text-[9px] uppercase tracking-wider mb-1.5 font-semibold" style={{ color: tier.color + 'bb' }}>
                {tier.label}
              </p>
              <div className="flex items-end gap-1.5 mb-1.5">
                <span className="text-xl font-bold font-mono" style={{ color: tier.sigCount > 0 ? tier.color : '#2d3748' }}>
                  {tier.sigCount}
                </span>
                <span className="text-[10px] text-terminal-dim mb-0.5">signals</span>
              </div>
              {tier.sigCount > 0 && (
                <div className="flex gap-2.5 mb-1.5">
                  <span className="text-[9px] text-bull-text font-mono">▲{tier.buyCount}</span>
                  <span className="text-[9px] text-bear-text font-mono">▼{tier.sellCount}</span>
                  <span className="text-[9px] text-terminal-dim font-mono ml-auto">{tier.avgConf}%</span>
                </div>
              )}
              <p className="text-[9px] text-terminal-dim">{tier.coinCount} coins scanned</p>
              {tier.coinCount > 0 && (
                <div className="w-full h-0.5 bg-terminal-surface rounded-full mt-2 overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-700"
                    style={{ width: `${Math.min((tier.sigCount / Math.max(tier.coinCount, 1)) * 200, 100)}%`, background: tier.color }} />
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
