'use client';

import { useState, useEffect, useCallback, type ReactNode } from 'react';
import {
  AnalyticsData,
  BreakdownMetrics,
  SetupPattern,
  AIAccuracyBucket,
  PerformanceMetrics,
} from '@/types';
import { cn } from '@/lib/utils';
import { TrendingUp, TrendingDown, Activity, Target, ShieldAlert, Brain, RefreshCw, Loader2 } from 'lucide-react';

type BreakdownTab = 'coin' | 'timeframe' | 'mode' | 'volatility';

export function PerformanceAnalytics() {
  const [data, setData]               = useState<AnalyticsData | null>(null);
  const [loading, setLoading]         = useState(true);
  const [tracking, setTracking]       = useState(false);
  const [trackResult, setTrackResult] = useState<string | null>(null);
  const [bdTab, setBdTab]             = useState<BreakdownTab>('coin');
  const [activeSection, setActiveSection] = useState<'overview' | 'setups' | 'ai'>('overview');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch('/api/analytics/performance');
      const json = await res.json();
      if (json.success) setData(json as AnalyticsData);
    } catch { /* non-fatal */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleRunTracker = useCallback(async () => {
    setTracking(true);
    setTrackResult(null);
    try {
      const res  = await fetch('/api/analytics/tracker/run', { method: 'POST' });
      const json = await res.json();
      if (json.success) {
        const r = json.result;
        setTrackResult(`Checked ${r.checked} · Resolved ${r.resolved} (${r.tpHits} TP, ${r.slHits} SL, ${r.timeouts} timeout)`);
        await fetchData();
      } else {
        setTrackResult(json.error ?? 'Tracker failed');
      }
    } catch {
      setTrackResult('Network error');
    } finally {
      setTracking(false);
    }
  }, [fetchData]);

  const breakdownData = (): BreakdownMetrics[] => {
    if (!data) return [];
    return {
      coin:       data.byCoin,
      timeframe:  data.byTimeframe,
      mode:       data.byMode,
      volatility: data.byVolatility,
    }[bdTab] ?? [];
  };

  if (loading) return <AnalyticsLoading />;

  const overall = data?.overall;

  return (
    <div className="space-y-4 animate-fade-in">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-sm font-semibold text-terminal-text tracking-wider uppercase">Signal Performance</h2>
          {data && (
            <p className="text-[10px] text-terminal-muted mt-0.5">
              {data.resolutionStatus.resolved} resolved · {data.resolutionStatus.pending} pending
              {data.resolutionStatus.resolvedToday > 0 && ` · ${data.resolutionStatus.resolvedToday} resolved today`}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {trackResult && (
            <span className="text-[10px] text-terminal-muted glass-surface border border-terminal-border/40 px-2 py-1 rounded max-w-xs truncate">
              {trackResult}
            </span>
          )}
          <button
            onClick={handleRunTracker}
            disabled={tracking}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-semibold uppercase tracking-wider glass-surface border border-terminal-border/40 text-terminal-muted hover:text-terminal-text hover:border-bull-DEFAULT/40 transition-all disabled:opacity-50"
          >
            {tracking ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />}
            {tracking ? 'Checking…' : 'Run Tracker'}
          </button>
          <button
            onClick={fetchData}
            disabled={loading}
            className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[10px] glass-surface border border-terminal-border/40 text-terminal-muted hover:text-terminal-text transition-all"
          >
            <RefreshCw size={10} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* ── Summary metric cards ───────────────────────────────────────────── */}
      {overall && overall.resolvedSignals > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
          <MetricCard label="Win Rate"      value={pct(overall.winRate)}       up={overall.winRate >= 0.5}  icon={<Target size={11} />} />
          <MetricCard label="Expectancy"    value={`${sign(overall.expectancy)}${Math.abs(overall.expectancy).toFixed(2)}R`} up={overall.expectancy > 0} icon={<Activity size={11} />} />
          <MetricCard label="Profit Factor" value={overall.profitFactor >= 99 ? '∞' : overall.profitFactor.toFixed(2)} up={overall.profitFactor > 1}  icon={<TrendingUp size={11} />} />
          <MetricCard label="Max Drawdown"  value={`${overall.maxDrawdown.toFixed(2)}R`} up={false} icon={<TrendingDown size={11} />} invert />
          <MetricCard label="TP Hit Rate"   value={pct(overall.tpHitRate)}     up={overall.tpHitRate >= 0.5}  icon={<Target size={11} />} />
          <MetricCard label="Avg RR"        value={`${overall.avgRRAchieved.toFixed(2)}R`} up={overall.avgRRAchieved > 0} icon={<Activity size={11} />} />
          <MetricCard label="Sharpe"        value={overall.sharpeRatio.toFixed(2)} up={overall.sharpeRatio > 1}  icon={<ShieldAlert size={11} />} />
          <MetricCard label="Total Return"  value={`${sign(overall.totalReturn)}${Math.abs(overall.totalReturn).toFixed(1)}R`} up={overall.totalReturn > 0} icon={<TrendingUp size={11} />} />
        </div>
      ) : (
        <EmptyState message="No resolved signals yet. Run the tracker after signals accumulate." />
      )}

      {/* ── Section tabs ──────────────────────────────────────────────────── */}
      {data && overall && overall.resolvedSignals > 0 && (
        <>
          <div className="flex gap-1 glass-surface rounded-xl p-1 border border-terminal-border/40 self-start w-fit">
            {(['overview', 'setups', 'ai'] as const).map(s => (
              <button
                key={s}
                onClick={() => setActiveSection(s)}
                className={cn(
                  'px-3 py-1 rounded-lg text-[10px] font-semibold uppercase tracking-wider transition-all',
                  activeSection === s
                    ? 'bg-terminal-surface text-terminal-text border border-terminal-border/60'
                    : 'text-terminal-muted hover:text-terminal-text',
                )}
              >
                {s === 'overview' ? '◈ Breakdown' : s === 'setups' ? '⬡ Setups' : '◇ AI Accuracy'}
              </button>
            ))}
          </div>

          {/* ── Breakdown section ────────────────────────────────────────── */}
          {activeSection === 'overview' && (
            <div className="glass-card rounded-xl border border-terminal-border/40 overflow-hidden">
              <div className="flex gap-0 border-b border-terminal-border/40 overflow-x-auto">
                {(['coin', 'timeframe', 'mode', 'volatility'] as BreakdownTab[]).map(tab => (
                  <button
                    key={tab}
                    onClick={() => setBdTab(tab)}
                    className={cn(
                      'px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap transition-all border-b-2 -mb-px',
                      bdTab === tab
                        ? 'text-terminal-text border-bull-DEFAULT'
                        : 'text-terminal-muted border-transparent hover:text-terminal-text',
                    )}
                  >
                    {tab === 'coin' ? 'By Coin' : tab === 'timeframe' ? 'By Timeframe' : tab === 'mode' ? 'By Mode' : 'By Volatility'}
                  </button>
                ))}
              </div>
              <BreakdownTable rows={breakdownData()} />
            </div>
          )}

          {/* ── Setups section ───────────────────────────────────────────── */}
          {activeSection === 'setups' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <SetupsTable title="Best Setups" setups={data.bestSetups} variant="best" />
              <SetupsTable title="Worst Setups" setups={data.worstSetups} variant="worst" />
            </div>
          )}

          {/* ── AI accuracy section ──────────────────────────────────────── */}
          {activeSection === 'ai' && (
            <div className="space-y-4">
              <AIValidationSummary overall={overall} />
              <AIAccuracyTable buckets={data.aiAccuracy} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Metric card ─────────────────────────────────────────────────────────────

function MetricCard({
  label, value, up, icon, invert = false,
}: {
  label: string; value: string; up: boolean; icon: ReactNode; invert?: boolean;
}) {
  const positive = invert ? !up : up;
  return (
    <div className="glass-card rounded-xl p-3 border border-terminal-border/40 flex flex-col gap-1.5 min-w-0">
      <div className="flex items-center justify-between">
        <span className="text-[9px] text-terminal-muted uppercase tracking-widest truncate">{label}</span>
        <span className="text-terminal-dim">{icon}</span>
      </div>
      <span className={cn('text-sm font-bold font-mono tabular-nums', positive ? 'text-bull-text' : 'text-bear-text')}>
        {value}
      </span>
    </div>
  );
}

// ─── Breakdown table ─────────────────────────────────────────────────────────

function BreakdownTable({ rows }: { rows: BreakdownMetrics[] }) {
  if (rows.length === 0) return <EmptyState message="No data for this dimension yet." />;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[10px] font-mono">
        <thead>
          <tr className="border-b border-terminal-border/40 text-terminal-muted">
            <th className="text-left px-4 py-2 font-medium">Name</th>
            <th className="text-right px-3 py-2 font-medium">Signals</th>
            <th className="text-right px-3 py-2 font-medium">Win Rate</th>
            <th className="text-right px-3 py-2 font-medium">Avg RR</th>
            <th className="text-right px-3 py-2 font-medium">Expectancy</th>
            <th className="text-right px-3 py-2 font-medium">Prof. Factor</th>
            <th className="text-right px-4 py-2 font-medium">Avg Conf</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-terminal-border/20">
          {rows.map(row => (
            <tr key={row.key} className="hover:bg-terminal-surface/30 transition-colors">
              <td className="px-4 py-2 text-terminal-text font-medium">{row.label}</td>
              <td className="px-3 py-2 text-right text-terminal-muted">
                {row.resolvedSignals}<span className="text-terminal-dim">/{row.totalSignals}</span>
              </td>
              <td className={cn('px-3 py-2 text-right font-semibold', row.winRate >= 0.5 ? 'text-bull-text' : 'text-bear-text')}>
                {pct(row.winRate)}
              </td>
              <td className={cn('px-3 py-2 text-right', row.avgRR > 0 ? 'text-bull-text' : 'text-bear-text')}>
                {row.avgRR.toFixed(2)}R
              </td>
              <td className={cn('px-3 py-2 text-right font-semibold', row.expectancy > 0 ? 'text-bull-text' : 'text-bear-text')}>
                {sign(row.expectancy)}{Math.abs(row.expectancy).toFixed(2)}R
              </td>
              <td className={cn('px-3 py-2 text-right', row.profitFactor > 1 ? 'text-bull-text' : 'text-bear-text')}>
                {row.profitFactor >= 99 ? '∞' : row.profitFactor.toFixed(2)}
              </td>
              <td className="px-4 py-2 text-right text-terminal-muted">{row.avgConfidence.toFixed(0)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Setups table ─────────────────────────────────────────────────────────────

function SetupsTable({ title, setups, variant }: { title: string; setups: SetupPattern[]; variant: 'best' | 'worst' }) {
  const accent = variant === 'best' ? 'text-bull-text' : 'text-bear-text';
  const borderAccent = variant === 'best' ? 'border-bull-DEFAULT/30' : 'border-bear-DEFAULT/30';

  return (
    <div className={cn('glass-card rounded-xl border overflow-hidden', borderAccent)}>
      <div className="px-4 py-2.5 border-b border-terminal-border/40">
        <span className={cn('text-[10px] font-semibold uppercase tracking-widest', accent)}>{title}</span>
        <span className="text-terminal-dim text-[9px] ml-2">(min 3 trades)</span>
      </div>
      {setups.length === 0 ? (
        <EmptyState message="Need ≥ 3 trades per setup to rank." />
      ) : (
        <div className="divide-y divide-terminal-border/20">
          {setups.map((s, i) => (
            <div key={i} className="px-4 py-2.5 flex items-center justify-between gap-3 hover:bg-terminal-surface/20 transition-colors">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[10px] font-semibold text-terminal-text">{s.symbol}</span>
                  <span className="text-[9px] text-terminal-dim glass-surface px-1 py-0.5 rounded border border-terminal-border/40">{s.timeframe}</span>
                  <span className="text-[9px] text-terminal-dim glass-surface px-1 py-0.5 rounded border border-terminal-border/40">{s.scannerMode}</span>
                  <span className={cn('text-[9px] font-bold', s.signalType === 'BUY' ? 'text-bull-text' : 'text-bear-text')}>{s.signalType}</span>
                </div>
                <div className="text-[9px] text-terminal-muted mt-0.5">
                  {s.totalTrades} trades · conf {s.avgConfidence.toFixed(0)}%
                </div>
              </div>
              <div className="text-right shrink-0 space-y-0.5">
                <div className={cn('text-[11px] font-bold font-mono', s.winRate >= 0.5 ? 'text-bull-text' : 'text-bear-text')}>
                  {pct(s.winRate)} WR
                </div>
                <div className={cn('text-[10px] font-mono', s.expectancy > 0 ? 'text-bull-text' : 'text-bear-text')}>
                  {sign(s.expectancy)}{Math.abs(s.expectancy).toFixed(2)}R exp
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── AI accuracy section ──────────────────────────────────────────────────────

function AIValidationSummary({ overall }: { overall: PerformanceMetrics }) {
  const aiLift = overall.aiValidatedWinRate - overall.nonAiWinRate;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <div className="glass-card rounded-xl p-3 border border-terminal-border/40">
        <div className="flex items-center gap-2 mb-2">
          <Brain size={11} className="text-signal-high" />
          <span className="text-[9px] text-terminal-muted uppercase tracking-widest">AI Validated Win Rate</span>
        </div>
        <span className={cn('text-lg font-bold font-mono', overall.aiValidatedWinRate >= 0.5 ? 'text-bull-text' : 'text-bear-text')}>
          {pct(overall.aiValidatedWinRate)}
        </span>
      </div>
      <div className="glass-card rounded-xl p-3 border border-terminal-border/40">
        <div className="flex items-center gap-2 mb-2">
          <Activity size={11} className="text-terminal-muted" />
          <span className="text-[9px] text-terminal-muted uppercase tracking-widest">Non-AI Win Rate</span>
        </div>
        <span className={cn('text-lg font-bold font-mono', overall.nonAiWinRate >= 0.5 ? 'text-bull-text' : 'text-bear-text')}>
          {pct(overall.nonAiWinRate)}
        </span>
      </div>
      <div className="glass-card rounded-xl p-3 border border-terminal-border/40">
        <div className="flex items-center gap-2 mb-2">
          <TrendingUp size={11} className={aiLift > 0 ? 'text-bull-DEFAULT' : 'text-bear-DEFAULT'} />
          <span className="text-[9px] text-terminal-muted uppercase tracking-widest">AI Lift</span>
        </div>
        <span className={cn('text-lg font-bold font-mono', aiLift > 0 ? 'text-bull-text' : 'text-bear-text')}>
          {sign(aiLift)}{pct(Math.abs(aiLift))}
        </span>
      </div>
    </div>
  );
}

function AIAccuracyTable({ buckets }: { buckets: AIAccuracyBucket[] }) {
  if (buckets.length === 0) return <EmptyState message="No resolved signals to analyze AI accuracy." />;

  return (
    <div className="glass-card rounded-xl border border-terminal-border/40 overflow-hidden">
      <div className="px-4 py-2.5 border-b border-terminal-border/40">
        <span className="text-[10px] font-semibold text-terminal-text uppercase tracking-widest">Confidence Band Analysis</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[10px] font-mono">
          <thead>
            <tr className="border-b border-terminal-border/40 text-terminal-muted">
              <th className="text-left px-4 py-2 font-medium">Confidence</th>
              <th className="text-right px-3 py-2 font-medium">Signals</th>
              <th className="text-right px-3 py-2 font-medium">Win Rate</th>
              <th className="text-right px-3 py-2 font-medium">TP Rate</th>
              <th className="text-right px-4 py-2 font-medium">Avg RR</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-terminal-border/20">
            {buckets.map(b => (
              <tr key={b.band} className="hover:bg-terminal-surface/30 transition-colors">
                <td className="px-4 py-2 text-terminal-text font-medium">{b.band}%</td>
                <td className="px-3 py-2 text-right text-terminal-muted">{b.total}</td>
                <td className={cn('px-3 py-2 text-right font-semibold', b.winRate >= 0.5 ? 'text-bull-text' : 'text-bear-text')}>
                  {pct(b.winRate)}
                </td>
                <td className={cn('px-3 py-2 text-right', b.tpHitRate >= 0.5 ? 'text-bull-text' : 'text-bear-text')}>
                  {pct(b.tpHitRate)}
                </td>
                <td className={cn('px-4 py-2 text-right font-semibold', b.avgRRAchieved > 0 ? 'text-bull-text' : 'text-bear-text')}>
                  {sign(b.avgRRAchieved)}{Math.abs(b.avgRRAchieved).toFixed(2)}R
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Shared sub-components ────────────────────────────────────────────────────

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 gap-2">
      <Activity size={20} className="text-terminal-muted" />
      <p className="text-terminal-muted text-xs text-center max-w-xs">{message}</p>
    </div>
  );
}

function AnalyticsLoading() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-8 w-48 rounded skeleton" />
      <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
        {Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-16 rounded-xl skeleton" />)}
      </div>
      <div className="h-64 rounded-xl skeleton" />
    </div>
  );
}

// ─── Utils ────────────────────────────────────────────────────────────────────

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function sign(value: number): string {
  return value >= 0 ? '+' : '';
}
