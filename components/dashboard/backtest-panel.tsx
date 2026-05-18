'use client';

import { useState, useEffect, useCallback } from 'react';
import { BacktestRun, BacktestTrade, BacktestMetrics, ScannerMode } from '@/types';
import { EquityChart } from './equity-chart';
import { cn } from '@/lib/utils';
import {
  Play, BarChart2, TrendingUp, Activity, Zap,
  ChevronDown, ChevronRight, Clock, Target,
  TrendingDown, Award, AlertTriangle,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface RunPayload {
  success:     boolean;
  runId?:      string;
  metrics?:    BacktestMetrics;
  coinsTested?: number;
  totalTrades?: number;
  durationMs?:  number;
  error?:      string;
}

// ─── Mode options ──────────────────────────────────────────────────────────────

const MODES: { id: ScannerMode; label: string; icon: React.ReactNode; color: string }[] = [
  { id: 'spot',            label: 'Spot',      icon: <Activity   size={11} />, color: '#3b82f6' },
  { id: 'futures',         label: 'Futures',   icon: <BarChart2  size={11} />, color: '#8b5cf6' },
  { id: 'high_confidence', label: 'High Conf', icon: <Zap        size={11} />, color: '#f59e0b' },
  { id: 'trending',        label: 'Trending',  icon: <TrendingUp size={11} />, color: '#00d084' },
];

const LOOKBACK_OPTIONS = [7, 14, 30, 40];
const HOLD_OPTIONS     = [24, 48, 72, 96];

// ─── Main panel ───────────────────────────────────────────────────────────────

export function BacktestPanel() {
  const [mode,       setMode]       = useState<ScannerMode>('spot');
  const [lookback,   setLookback]   = useState(30);
  const [maxHold,    setMaxHold]    = useState(48);
  const [maxCoins,   setMaxCoins]   = useState(15);
  const [stratName,  setStratName]  = useState('');
  const [running,    setRunning]    = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const [result,     setResult]     = useState<RunPayload | null>(null);
  const [runs,       setRuns]       = useState<BacktestRun[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailTrades, setDetailTrades] = useState<BacktestTrade[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [activeTab, setActiveTab]   = useState<'results' | 'trades' | 'compare'>('results');

  // ── Load past runs ──────────────────────────────────────────────────────────
  const fetchRuns = useCallback(async () => {
    try {
      const json = await fetch('/api/backtest/results?limit=10').then(r => r.json());
      if (json.success) setRuns(json.runs);
    } catch { /* non-fatal */ }
  }, []);

  useEffect(() => { void fetchRuns(); }, [fetchRuns]);

  // ── Run a new backtest ──────────────────────────────────────────────────────
  const handleRun = useCallback(async () => {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const res  = await fetch('/api/backtest/run', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          mode,
          lookbackDays:   lookback,
          maxHoldCandles: maxHold,
          maxCoins,
          strategyName:   stratName || `${mode} ${lookback}d`,
        }),
      });
      const json: RunPayload = await res.json();
      if (!json.success) { setError(json.error ?? 'Backtest failed'); return; }
      setResult(json);
      void fetchRuns();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setRunning(false);
    }
  }, [mode, lookback, maxHold, maxCoins, stratName, fetchRuns]);

  // ── Load trades for a selected run ─────────────────────────────────────────
  const loadDetail = useCallback(async (id: string) => {
    if (selectedId === id) { setSelectedId(null); return; }
    setSelectedId(id);
    setLoadingDetail(true);
    try {
      const json = await fetch(`/api/backtest/${id}`).then(r => r.json());
      if (json.success) setDetailTrades(json.trades ?? []);
    } catch { /* non-fatal */ }
    finally { setLoadingDetail(false); }
  }, [selectedId]);

  const currentMetrics = result?.metrics ?? runs.find(r => r.id === selectedId)?.metrics;
  const equityCurve    = currentMetrics?.equityCurve ?? [0];

  return (
    <div className="flex flex-col gap-4">

      {/* ── Config card ──────────────────────────────────────────────────── */}
      <div className="glass-card rounded-xl p-4">
        <div className="flex items-center gap-2 mb-4">
          <BarChart2 size={13} className="text-signal-medium" />
          <span className="text-xs font-semibold text-terminal-text uppercase tracking-widest">Backtest Configuration</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">

          {/* Mode */}
          <div>
            <label className="text-[10px] text-terminal-muted uppercase tracking-wider mb-1.5 block">Mode</label>
            <div className="flex gap-1 flex-wrap">
              {MODES.map(m => (
                <button key={m.id} onClick={() => setMode(m.id)}
                  className={cn(
                    'flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-medium border transition-all',
                    mode === m.id
                      ? ''
                      : 'glass-surface border-terminal-border text-terminal-muted hover:text-terminal-text',
                  )}
                  style={mode === m.id ? {
                    background:   `${m.color}18`,
                    borderColor:  `${m.color}55`,
                    color:        m.color,
                  } : {}}
                >
                  {m.icon}{m.label}
                </button>
              ))}
            </div>
          </div>

          {/* Lookback */}
          <div>
            <label className="text-[10px] text-terminal-muted uppercase tracking-wider mb-1.5 block">Lookback Days</label>
            <div className="flex gap-1">
              {LOOKBACK_OPTIONS.map(d => (
                <button key={d} onClick={() => setLookback(d)}
                  className={cn(
                    'px-3 py-1.5 rounded-lg text-[10px] font-mono border transition-all',
                    lookback === d
                      ? 'bg-signal-medium/15 border-signal-medium/40 text-signal-medium'
                      : 'glass-surface border-terminal-border text-terminal-muted hover:text-terminal-text',
                  )}
                >{d}d</button>
              ))}
            </div>
          </div>

          {/* Max hold */}
          <div>
            <label className="text-[10px] text-terminal-muted uppercase tracking-wider mb-1.5 block">Max Hold (candles)</label>
            <div className="flex gap-1">
              {HOLD_OPTIONS.map(h => (
                <button key={h} onClick={() => setMaxHold(h)}
                  className={cn(
                    'px-3 py-1.5 rounded-lg text-[10px] font-mono border transition-all',
                    maxHold === h
                      ? 'bg-signal-medium/15 border-signal-medium/40 text-signal-medium'
                      : 'glass-surface border-terminal-border text-terminal-muted hover:text-terminal-text',
                  )}
                >{h}h</button>
              ))}
            </div>
          </div>

          {/* Coins + Name */}
          <div className="flex flex-col gap-2">
            <div>
              <label className="text-[10px] text-terminal-muted uppercase tracking-wider mb-1 block">
                Coins (top {maxCoins})
              </label>
              <input
                type="range" min={5} max={25} step={5} value={maxCoins}
                onChange={e => setMaxCoins(Number(e.target.value))}
                className="w-full accent-bull-DEFAULT"
              />
              <div className="flex justify-between text-[9px] text-terminal-dim mt-0.5">
                <span>5</span><span className="font-mono text-terminal-muted">{maxCoins}</span><span>25</span>
              </div>
            </div>
            <input
              type="text"
              placeholder={`${mode} ${lookback}d`}
              value={stratName}
              onChange={e => setStratName(e.target.value)}
              className="glass-surface border border-terminal-border rounded-lg px-2.5 py-1.5 text-[10px] text-terminal-text placeholder:text-terminal-dim focus:outline-none focus:border-bull-DEFAULT/40 w-full"
            />
          </div>
        </div>

        {/* Error banner */}
        {error && (
          <div className="mb-3 px-3 py-2 bg-bear-muted border border-bear-DEFAULT/30 rounded-lg text-bear-text text-xs flex items-center gap-2">
            <AlertTriangle size={11} />{error}
          </div>
        )}

        {/* Run button */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleRun}
            disabled={running}
            className={cn(
              'flex items-center gap-2 px-6 py-2.5 rounded-lg font-semibold text-sm transition-all',
              running
                ? 'glass-surface border border-terminal-border text-terminal-muted cursor-not-allowed'
                : 'text-terminal-bg hover:brightness-110 active:scale-95',
            )}
            style={!running ? {
              background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
              boxShadow:  '0 0 20px rgba(59,130,246,0.3), 0 2px 8px rgba(0,0,0,0.4)',
            } : {}}
          >
            {running ? (
              <><span className="relative flex h-3 w-3"><span className="animate-radar-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-60" /><span className="relative inline-flex h-3 w-3 rounded-full bg-blue-400" /></span>Running…</>
            ) : (
              <><Play size={13} fill="currentColor" />Run Backtest</>
            )}
          </button>
          {running && (
            <span className="text-[10px] text-terminal-muted animate-pulse">
              Fetching candles and replaying {maxCoins} coins…
            </span>
          )}
        </div>
      </div>

      {/* ── Results area ─────────────────────────────────────────────────── */}
      {currentMetrics && (
        <div className="glass-card rounded-xl overflow-hidden">

          {/* Tab bar */}
          <div className="flex border-b border-terminal-border/40">
            {(['results', 'trades', 'compare'] as const).map(tab => (
              <button key={tab} onClick={() => setActiveTab(tab)}
                className={cn(
                  'px-4 py-2.5 text-[10px] font-medium uppercase tracking-wider transition-colors border-b-2',
                  activeTab === tab
                    ? 'text-signal-medium border-signal-medium'
                    : 'text-terminal-muted border-transparent hover:text-terminal-text',
                )}
              >{tab}</button>
            ))}
          </div>

          {activeTab === 'results' && (
            <div className="p-4">
              <MetricsGrid metrics={currentMetrics} />
              <div className="mt-4 glass-surface rounded-lg p-3 border border-terminal-border/30">
                <div className="flex items-center gap-1.5 mb-2">
                  <TrendingUp size={10} className="text-terminal-muted" />
                  <span className="text-[9px] uppercase tracking-wider text-terminal-muted">Equity Curve</span>
                  <span className="ml-auto text-[9px] font-mono text-terminal-dim">{currentMetrics.totalTrades} trades</span>
                </div>
                <EquityChart data={equityCurve} height={140} />
              </div>
              <OutcomeBar metrics={currentMetrics} />
            </div>
          )}

          {activeTab === 'trades' && (
            <div className="p-4">
              <TradesTable
                trades={detailTrades}
                loading={loadingDetail}
                runId={result?.runId ?? selectedId}
                onLoad={id => id && loadDetail(id)}
              />
            </div>
          )}

          {activeTab === 'compare' && (
            <div className="p-4">
              <StrategyTable runs={runs} selectedId={selectedId} onSelect={loadDetail} />
            </div>
          )}
        </div>
      )}

      {/* ── Past runs (when no result is selected) ───────────────────────── */}
      {!currentMetrics && runs.length > 0 && (
        <div className="glass-card rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Clock size={11} className="text-terminal-muted" />
            <span className="text-[10px] font-semibold text-terminal-text uppercase tracking-widest">Past Runs</span>
          </div>
          <StrategyTable runs={runs} selectedId={selectedId} onSelect={loadDetail} />
        </div>
      )}
    </div>
  );
}

// ─── Metrics grid ─────────────────────────────────────────────────────────────

function MetricsGrid({ metrics }: { metrics: BacktestMetrics }) {
  const cells = [
    { label: 'Win Rate',      value: `${(metrics.winRate * 100).toFixed(1)}%`,     color: metrics.winRate >= 0.5 ? '#00d084' : '#ff3b5c' },
    { label: 'Profit Factor', value: metrics.profitFactor.toFixed(2),              color: metrics.profitFactor >= 1.5 ? '#00d084' : metrics.profitFactor >= 1 ? '#f59e0b' : '#ff3b5c' },
    { label: 'Total Return',  value: `${metrics.totalReturn >= 0 ? '+' : ''}${metrics.totalReturn.toFixed(2)}%`, color: metrics.totalReturn >= 0 ? '#00d084' : '#ff3b5c' },
    { label: 'Max Drawdown',  value: `${metrics.maxDrawdown.toFixed(2)}%`,         color: metrics.maxDrawdown > 20 ? '#ff3b5c' : metrics.maxDrawdown > 10 ? '#f59e0b' : '#00d084' },
    { label: 'Sharpe Ratio',  value: metrics.sharpeRatio.toFixed(2),               color: metrics.sharpeRatio >= 1 ? '#00d084' : metrics.sharpeRatio >= 0 ? '#f59e0b' : '#ff3b5c' },
    { label: 'Avg RR',        value: `1:${metrics.avgRR.toFixed(2)}`,              color: metrics.avgRR >= 2 ? '#00d084' : '#f59e0b' },
    { label: 'Total Trades',  value: String(metrics.totalTrades),                  color: '#94a3b8' },
    { label: 'Avg Duration',  value: `${metrics.avgDurationCandles}h`,             color: '#94a3b8' },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      {cells.map(c => (
        <div key={c.label} className="glass-surface rounded-lg p-3 border border-terminal-border/30">
          <div className="text-[9px] text-terminal-dim uppercase tracking-wider mb-1">{c.label}</div>
          <div className="font-mono font-bold text-sm" style={{ color: c.color }}>{c.value}</div>
        </div>
      ))}
    </div>
  );
}

// ─── Win / Loss / Timeout bar ─────────────────────────────────────────────────

function OutcomeBar({ metrics }: { metrics: BacktestMetrics }) {
  const wins     = Math.round(metrics.winRate    * 100);
  const losses   = Math.round(metrics.lossRate   * 100);
  const timeouts = Math.round(metrics.timeoutRate * 100);

  return (
    <div className="mt-3 glass-surface rounded-lg p-3 border border-terminal-border/30">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[9px] uppercase tracking-wider text-terminal-muted">Outcome Distribution</span>
        <div className="flex items-center gap-3 text-[9px] font-mono">
          <span className="text-bull-text">WIN {wins}%</span>
          <span className="text-bear-text">LOSS {losses}%</span>
          <span className="text-terminal-muted">TIMEOUT {timeouts}%</span>
        </div>
      </div>
      <div className="flex h-2 rounded-full overflow-hidden gap-0.5">
        {wins > 0     && <div className="bg-bull-DEFAULT"    style={{ width: `${wins}%` }} />}
        {losses > 0   && <div className="bg-bear-DEFAULT"    style={{ width: `${losses}%` }} />}
        {timeouts > 0 && <div className="bg-terminal-muted" style={{ width: `${timeouts}%` }} />}
      </div>
      <div className="grid grid-cols-3 gap-2 mt-2 text-[9px] font-mono">
        <div><span className="text-terminal-dim">Best: </span><span className="text-bull-text">+{metrics.bestTrade.toFixed(2)}%</span></div>
        <div><span className="text-terminal-dim">Worst: </span><span className="text-bear-text">{metrics.worstTrade.toFixed(2)}%</span></div>
        <div><span className="text-terminal-dim">Avg Win: </span><span className="text-bull-text">+{metrics.avgWin.toFixed(2)}%</span></div>
      </div>
    </div>
  );
}

// ─── Trades table ─────────────────────────────────────────────────────────────

function TradesTable({
  trades, loading, runId, onLoad,
}: {
  trades: BacktestTrade[];
  loading: boolean;
  runId: string | null | undefined;
  onLoad: (id: string | null | undefined) => void;
}) {
  if (loading) {
    return <div className="space-y-2">{[0,1,2,3].map(i => <div key={i} className="skeleton h-8 rounded-lg" />)}</div>;
  }
  if (!runId) {
    return (
      <div className="text-center py-8 text-terminal-muted text-sm">
        Select a run to view individual trades
        {runId === undefined && (
          <button onClick={() => onLoad(runId)} className="block mt-2 text-xs text-signal-medium hover:underline mx-auto">Load trades</button>
        )}
      </div>
    );
  }
  if (trades.length === 0) {
    return (
      <div className="text-center py-8">
        <button onClick={() => onLoad(runId)} className="text-xs text-signal-medium hover:underline">Load {runId ? 'trades' : 'trades for selected run'}</button>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <div className="text-[9px] text-terminal-muted mb-2">{trades.length} trades</div>
      <table className="w-full text-[10px] font-mono">
        <thead>
          <tr className="text-terminal-dim text-left border-b border-terminal-border/30">
            <th className="pb-1.5 pr-3">Symbol</th>
            <th className="pb-1.5 pr-3">Dir</th>
            <th className="pb-1.5 pr-3">Entry</th>
            <th className="pb-1.5 pr-3">Exit</th>
            <th className="pb-1.5 pr-3">P&L</th>
            <th className="pb-1.5 pr-3">Outcome</th>
            <th className="pb-1.5">Duration</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-terminal-border/15">
          {trades.slice(0, 100).map((t, i) => (
            <tr key={t.id ?? i} className="hover:bg-terminal-surface/20">
              <td className="py-1 pr-3 text-terminal-text font-bold">{t.symbol}</td>
              <td className={cn('py-1 pr-3', t.type === 'BUY' ? 'text-bull-text' : 'text-bear-text')}>{t.type === 'BUY' ? '▲' : '▼'}</td>
              <td className="py-1 pr-3 text-terminal-muted">{t.entryPrice.toFixed(4)}</td>
              <td className="py-1 pr-3 text-terminal-muted">{t.exitPrice.toFixed(4)}</td>
              <td className={cn('py-1 pr-3 font-bold', t.pnlPct >= 0 ? 'text-bull-text' : 'text-bear-text')}>
                {t.pnlPct >= 0 ? '+' : ''}{t.pnlPct.toFixed(2)}%
              </td>
              <td className="py-1 pr-3">
                <span className={cn(
                  'px-1.5 py-0.5 rounded text-[8px]',
                  t.outcome === 'WIN' ? 'bg-bull-muted text-bull-text' : t.outcome === 'LOSS' ? 'bg-bear-muted text-bear-text' : 'glass-surface text-terminal-muted',
                )}>{t.outcome}</span>
              </td>
              <td className="py-1 text-terminal-dim">{t.durationCandles}h</td>
            </tr>
          ))}
        </tbody>
      </table>
      {trades.length > 100 && (
        <p className="text-[9px] text-terminal-dim mt-2">Showing first 100 of {trades.length} trades</p>
      )}
    </div>
  );
}

// ─── Strategy comparison table ────────────────────────────────────────────────

function StrategyTable({
  runs, selectedId, onSelect,
}: {
  runs:       BacktestRun[];
  selectedId: string | null;
  onSelect:   (id: string) => void;
}) {
  if (runs.length === 0) {
    return <p className="text-terminal-muted text-xs text-center py-6">No backtest runs yet — run your first one above.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[10px] font-mono">
        <thead>
          <tr className="text-terminal-dim text-left border-b border-terminal-border/30">
            <th className="pb-1.5 pr-3 font-normal">Strategy</th>
            <th className="pb-1.5 pr-3 font-normal">Trades</th>
            <th className="pb-1.5 pr-3 font-normal">Win%</th>
            <th className="pb-1.5 pr-3 font-normal">PF</th>
            <th className="pb-1.5 pr-3 font-normal">Return</th>
            <th className="pb-1.5 pr-3 font-normal">DD</th>
            <th className="pb-1.5 pr-3 font-normal">Sharpe</th>
            <th className="pb-1.5 font-normal">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-terminal-border/15">
          {runs.map(run => {
            const m   = run.metrics;
            const sel = selectedId === run.id;
            return (
              <tr
                key={run.id}
                onClick={() => run.id && onSelect(run.id)}
                className={cn(
                  'cursor-pointer transition-colors hover:bg-terminal-surface/30',
                  sel && 'bg-terminal-surface/40',
                )}
              >
                <td className="py-1.5 pr-3">
                  <div className="flex items-center gap-1.5">
                    {sel ? <ChevronDown size={9} className="text-signal-medium" /> : <ChevronRight size={9} className="text-terminal-dim" />}
                    <div>
                      <div className="text-terminal-text font-semibold">{run.strategyName}</div>
                      <div className="text-[8px] text-terminal-dim">{run.mode} · {run.coinsTested}c · {new Date(run.startedAt).toLocaleDateString()}</div>
                    </div>
                  </div>
                </td>
                <td className="py-1.5 pr-3 text-terminal-muted">{run.totalTrades}</td>
                <td className={cn('py-1.5 pr-3', (m?.winRate ?? 0) >= 0.5 ? 'text-bull-text' : 'text-bear-text')}>
                  {m ? `${(m.winRate * 100).toFixed(0)}%` : '—'}
                </td>
                <td className={cn('py-1.5 pr-3', (m?.profitFactor ?? 0) >= 1 ? 'text-bull-text' : 'text-bear-text')}>
                  {m?.profitFactor.toFixed(2) ?? '—'}
                </td>
                <td className={cn('py-1.5 pr-3', (m?.totalReturn ?? 0) >= 0 ? 'text-bull-text' : 'text-bear-text')}>
                  {m ? `${m.totalReturn >= 0 ? '+' : ''}${m.totalReturn.toFixed(1)}%` : '—'}
                </td>
                <td className={cn('py-1.5 pr-3', (m?.maxDrawdown ?? 0) > 15 ? 'text-bear-text' : 'text-terminal-muted')}>
                  {m?.maxDrawdown.toFixed(1) ?? '—'}%
                </td>
                <td className={cn('py-1.5 pr-3', (m?.sharpeRatio ?? 0) >= 1 ? 'text-bull-text' : 'text-terminal-muted')}>
                  {m?.sharpeRatio.toFixed(2) ?? '—'}
                </td>
                <td className="py-1.5">
                  <StatusBadge status={run.status} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Micro components ──────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: BacktestRun['status'] }) {
  const s = {
    completed: { cls: 'bg-bull-muted text-bull-text border-bull-DEFAULT/20', icon: <Award size={8} /> },
    running:   { cls: 'bg-blue-900/20 text-blue-400 border-blue-500/20',     icon: <Clock size={8} className="animate-spin" /> },
    failed:    { cls: 'bg-bear-muted text-bear-text border-bear-DEFAULT/20', icon: <AlertTriangle size={8} /> },
  }[status];
  return (
    <span className={cn('inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[8px]', s.cls)}>
      {s.icon}{status}
    </span>
  );
}
