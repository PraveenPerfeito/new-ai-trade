'use client';

import { useState, useEffect, useCallback, type ReactNode } from 'react';
import {
  PortfolioSnapshot, OpenTradeView, PaperTrade, PaperPortfolio,
} from '@/types';
import { formatPrice, cn, timeAgo } from '@/lib/utils';
import {
  TrendingUp, TrendingDown, Activity, RefreshCw,
  Loader2, RotateCcw, X, ShieldAlert,
} from 'lucide-react';

const POLL_MS = 60_000; // refresh snapshot every 60s

export function PaperTrading() {
  const [snapshot, setSnapshot]   = useState<PortfolioSnapshot | null>(null);
  const [loading, setLoading]     = useState(true);
  const [checking, setChecking]   = useState(false);
  const [resetting, setResetting] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [closingId, setClosingId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'positions' | 'history'>('positions');

  const fetchSnapshot = useCallback(async () => {
    try {
      const res  = await fetch('/api/paper-trading/portfolio');
      const json = await res.json();
      if (json.success) setSnapshot(json as PortfolioSnapshot);
    } catch { /* non-fatal */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    fetchSnapshot();
    const t = setInterval(fetchSnapshot, POLL_MS);
    return () => clearInterval(t);
  }, [fetchSnapshot]);

  const handleCheck = useCallback(async () => {
    setChecking(true);
    setStatusMsg(null);
    try {
      const res  = await fetch('/api/paper-trading/check', { method: 'POST' });
      const json = await res.json();
      if (json.success) {
        const r = json.result;
        const parts = [
          r.tpHits > 0   && `${r.tpHits} TP hit`,
          r.slHits > 0   && `${r.slHits} SL hit`,
          r.expired > 0  && `${r.expired} expired`,
        ].filter(Boolean);
        setStatusMsg(parts.length > 0 ? parts.join(' · ') : `${r.checked} checked — no fills`);
        await fetchSnapshot();
      } else {
        setStatusMsg(json.error ?? 'Check failed');
      }
    } catch {
      setStatusMsg('Network error');
    } finally {
      setChecking(false);
    }
  }, [fetchSnapshot]);

  const handleReset = useCallback(async () => {
    if (!confirm('Reset paper portfolio? All trades will be deleted.')) return;
    setResetting(true);
    try {
      await fetch('/api/paper-trading/portfolio/reset', { method: 'POST' });
      await fetchSnapshot();
      setStatusMsg('Portfolio reset to $10,000');
    } finally {
      setResetting(false);
    }
  }, [fetchSnapshot]);

  const handleClose = useCallback(async (tradeId: string) => {
    setClosingId(tradeId);
    try {
      const res  = await fetch(`/api/paper-trading/trades/${tradeId}/close`, { method: 'POST' });
      const json = await res.json();
      if (json.success) await fetchSnapshot();
      else setStatusMsg(json.error ?? 'Close failed');
    } finally {
      setClosingId(null);
    }
  }, [fetchSnapshot]);

  if (loading) return <PaperTradingLoading />;

  const p = snapshot?.portfolio;

  return (
    <div className="space-y-4 animate-fade-in">

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-sm font-semibold text-terminal-text tracking-wider uppercase">
            Paper Trading
          </h2>
          {p && (
            <p className="text-[10px] text-terminal-muted mt-0.5">
              {p.name} · started {timeAgo(p.createdAt)}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {statusMsg && (
            <span className="text-[10px] glass-surface border border-terminal-border/40 rounded px-2 py-1 text-terminal-muted max-w-[240px] truncate">
              {statusMsg}
            </span>
          )}
          <button
            onClick={handleCheck}
            disabled={checking}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-semibold uppercase tracking-wider glass-surface border border-terminal-border/40 text-terminal-muted hover:text-terminal-text hover:border-bull-DEFAULT/40 transition-all disabled:opacity-50"
          >
            {checking ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />}
            {checking ? 'Checking…' : 'Check Positions'}
          </button>
          <button
            onClick={() => fetchSnapshot()}
            className="p-1.5 rounded-lg glass-surface border border-terminal-border/40 text-terminal-muted hover:text-terminal-text transition-all"
          >
            <RefreshCw size={10} />
          </button>
          <button
            onClick={handleReset}
            disabled={resetting}
            className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[10px] glass-surface border border-bear-DEFAULT/20 text-bear-text/70 hover:text-bear-text hover:border-bear-DEFAULT/40 transition-all disabled:opacity-50"
          >
            <RotateCcw size={10} />
            Reset
          </button>
        </div>
      </div>

      {/* ── Portfolio summary cards ────────────────────────────────────────── */}
      {snapshot ? (
        <>
          <PortfolioCards snapshot={snapshot} />

          {/* ── Tab selector ──────────────────────────────────────────────── */}
          <div className="flex gap-1 glass-surface rounded-xl p-1 border border-terminal-border/40 self-start w-fit">
            {(['positions', 'history'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={cn(
                  'px-3 py-1 rounded-lg text-[10px] font-semibold uppercase tracking-wider transition-all',
                  activeTab === tab
                    ? 'bg-terminal-surface text-terminal-text border border-terminal-border/60'
                    : 'text-terminal-muted hover:text-terminal-text',
                )}
              >
                {tab === 'positions'
                  ? `⬡ Open (${snapshot.openTrades.length})`
                  : `◈ History (${snapshot.recentTrades.length})`}
              </button>
            ))}
          </div>

          {activeTab === 'positions' && (
            <OpenPositionsPanel
              trades={snapshot.openTrades}
              closingId={closingId}
              onClose={handleClose}
            />
          )}

          {activeTab === 'history' && (
            <TradeHistoryPanel trades={snapshot.recentTrades} />
          )}
        </>
      ) : (
        <EmptyPortfolio onCheck={handleCheck} checking={checking} />
      )}
    </div>
  );
}

// ─── Portfolio summary cards ──────────────────────────────────────────────────

function PortfolioCards({ snapshot }: { snapshot: PortfolioSnapshot }) {
  const { portfolio: p, totalEquity, unrealizedPnl, metrics } = snapshot;
  const netPnl     = p.realizedPnl + unrealizedPnl;
  const returnPct  = p.initialCapital > 0 ? (netPnl / p.initialCapital) * 100 : 0;
  const upReturn   = returnPct >= 0;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
      <StatCard label="Total Equity" value={`$${totalEquity.toFixed(2)}`} sub={`${upReturn ? '+' : ''}${returnPct.toFixed(2)}%`} subUp={upReturn} span wide icon={<Activity size={11} />} />
      <StatCard label="Available"    value={`$${p.availableCapital.toFixed(2)}`} icon={<ShieldAlert size={11} />} />
      <StatCard label="Net PnL"      value={`${netPnl >= 0 ? '+' : ''}$${netPnl.toFixed(2)}`} up={netPnl >= 0} icon={<TrendingUp size={11} />} />
      <StatCard label="Unrealized"   value={`${unrealizedPnl >= 0 ? '+' : ''}$${unrealizedPnl.toFixed(2)}`} up={unrealizedPnl >= 0} icon={<Activity size={11} />} />
      <StatCard label="Win Rate"     value={metrics.totalTrades > 0 ? `${(metrics.winRate * 100).toFixed(1)}%` : '–'} up={metrics.winRate >= 0.5} icon={<TrendingUp size={11} />} />
      <StatCard label="Profit Factor" value={metrics.profitFactor >= 99 ? '∞' : metrics.profitFactor.toFixed(2)} up={metrics.profitFactor > 1} icon={<Activity size={11} />} />
    </div>
  );
}

function StatCard({
  label, value, sub, subUp, up, icon, wide = false, span = false,
}: {
  label: string; value: string; sub?: string; subUp?: boolean;
  up?: boolean; icon: ReactNode; wide?: boolean; span?: boolean;
}) {
  const valueColor = up === undefined ? 'text-terminal-text'
    : up ? 'text-bull-text' : 'text-bear-text';

  return (
    <div className={cn(
      'glass-card rounded-xl p-3 border border-terminal-border/40 flex flex-col gap-1 min-w-0',
      span && 'col-span-2',
    )}>
      <div className="flex items-center justify-between">
        <span className="text-[9px] text-terminal-muted uppercase tracking-widest truncate">{label}</span>
        <span className="text-terminal-dim">{icon}</span>
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className={cn('text-sm font-bold font-mono tabular-nums', valueColor)}>{value}</span>
        {sub && (
          <span className={cn('text-[10px] font-mono', subUp ? 'text-bull-text' : 'text-bear-text')}>
            {sub}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Open positions panel ─────────────────────────────────────────────────────

function OpenPositionsPanel({
  trades, closingId, onClose,
}: {
  trades: OpenTradeView[];
  closingId: string | null;
  onClose: (id: string) => void;
}) {
  if (trades.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-14 gap-3 glass-card rounded-xl border border-terminal-border/40">
        <Activity size={24} className="text-terminal-muted" />
        <p className="text-sm text-terminal-muted">No open positions</p>
        <p className="text-xs text-terminal-dim">Enter a trade from the Scanner tab</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {trades.map(trade => (
        <TradePositionCard
          key={trade.id}
          trade={trade}
          isClosing={closingId === trade.id}
          onClose={() => onClose(trade.id)}
        />
      ))}
    </div>
  );
}

function TradePositionCard({
  trade, isClosing, onClose,
}: {
  trade: OpenTradeView;
  isClosing: boolean;
  onClose: () => void;
}) {
  const isBuy    = trade.signalType === 'BUY';
  const isProfit = trade.unrealizedPnl >= 0;
  const accent   = isBuy ? '#00d084' : '#ff3b5c';

  // Clamp progress for bar display
  const barPct = Math.min(100, Math.max(0, trade.progressPct));

  return (
    <div className="glass-card rounded-xl border border-terminal-border/40 overflow-hidden">
      <div className="relative">
        {/* Accent stripe */}
        <div
          className="absolute left-0 top-0 bottom-0 w-0.5"
          style={{ backgroundColor: accent }}
        />

        <div className="pl-4 pr-4 pt-3 pb-3">
          {/* Row 1: symbol + type + scanner mode + leverage + confidence */}
          <div className="flex items-center justify-between gap-2 mb-2.5">
            <div className="flex items-center gap-2 min-w-0 flex-wrap">
              <span className={cn(
                'inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md',
                isBuy
                  ? 'bg-bull-muted text-bull-text border border-bull-DEFAULT/30'
                  : 'bg-bear-muted text-bear-text border border-bear-DEFAULT/30',
              )}>
                {isBuy ? <TrendingUp size={9} /> : <TrendingDown size={9} />}
                {isBuy ? 'LONG' : 'SHORT'}
              </span>
              <span className="font-mono font-bold text-terminal-text text-[13px]">{trade.symbol}</span>
              <span className="text-[9px] glass-surface border border-terminal-border/40 rounded px-1.5 py-0.5 text-terminal-muted">
                {trade.timeframe}
              </span>
              <span className="text-[9px] glass-surface border border-terminal-border/40 rounded px-1.5 py-0.5 text-terminal-muted">
                {trade.scannerMode}
              </span>
              {trade.leverage > 1 && (
                <span className="text-[9px] font-bold text-signal-medium glass-surface border border-terminal-border/40 rounded px-1.5 py-0.5">
                  {trade.leverage}×
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <span className={cn(
                'text-base font-bold font-mono tabular-nums',
                isProfit ? 'text-bull-text' : 'text-bear-text',
              )}>
                {isProfit ? '+' : ''}${trade.unrealizedPnl.toFixed(2)}
              </span>
              <button
                onClick={onClose}
                disabled={isClosing}
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-[9px] font-semibold glass-surface border border-terminal-border/40 text-terminal-muted hover:text-bear-text hover:border-bear-DEFAULT/30 transition-all disabled:opacity-50"
              >
                {isClosing ? <Loader2 size={9} className="animate-spin" /> : <X size={9} />}
                Close
              </button>
            </div>
          </div>

          {/* Price levels grid */}
          <div className="grid grid-cols-3 gap-x-4 gap-y-0.5 mb-2.5 text-[10px] font-mono">
            <PriceRow label="Entry"   value={formatPrice(trade.entryPrice)} />
            <PriceRow label="Current" value={formatPrice(trade.currentPrice)}
              valueClass={isProfit ? 'text-bull-text font-semibold' : 'text-bear-text font-semibold'} />
            <PriceRow label="RR"      value={`1:${trade.rrRatio.toFixed(1)}`} valueClass="text-signal-medium" />
            <PriceRow label="Target"  value={formatPrice(trade.targetPrice)} valueClass="text-bull-text"
              suffix={`+${trade.distanceToTpPct.toFixed(1)}%`} />
            <PriceRow label="Stop"    value={formatPrice(trade.stopLoss)} valueClass="text-bear-text"
              suffix={`-${trade.distanceToSlPct.toFixed(1)}%`} />
            <PriceRow label="Size"    value={`$${trade.notionalUsdt.toFixed(0)}`} />
          </div>

          {/* Progress bar: SL ──────●──────── TP */}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[9px] text-terminal-dim">
              <span>SL {formatPrice(trade.stopLoss)}</span>
              <span className={cn('font-semibold', isProfit ? 'text-bull-text' : 'text-bear-text')}>
                {isProfit ? '+' : ''}{trade.unrealizedPnlPct.toFixed(2)}%
              </span>
              <span>TP {formatPrice(trade.targetPrice)}</span>
            </div>
            <div className="relative h-2 bg-terminal-surface rounded-full overflow-hidden">
              {/* Fill from 0% up to progress position */}
              <div
                className="absolute left-0 top-0 h-full rounded-full transition-all duration-500"
                style={{
                  width:      `${barPct}%`,
                  background: isProfit
                    ? 'linear-gradient(90deg, #00d08440, #00d084)'
                    : 'linear-gradient(90deg, #ff3b5c40, #ff3b5c)',
                }}
              />
              {/* Current price indicator */}
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-terminal-text/80 rounded-full transition-all duration-500"
                style={{ left: `${Math.min(99, Math.max(0, barPct))}%` }}
              />
            </div>
          </div>

          {/* Margin + risk info */}
          <div className="flex items-center gap-3 mt-2 text-[9px] text-terminal-dim">
            <span>Margin ${trade.marginUsdt.toFixed(2)}</span>
            <span className="text-terminal-border">·</span>
            <span>Risk ${trade.riskAmountUsdt.toFixed(2)}</span>
            <span className="text-terminal-border">·</span>
            <span>{timeAgo(trade.createdAt)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Trade history panel ──────────────────────────────────────────────────────

function TradeHistoryPanel({ trades }: { trades: PaperTrade[] }) {
  if (trades.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-14 gap-3 glass-card rounded-xl border border-terminal-border/40">
        <Activity size={24} className="text-terminal-muted" />
        <p className="text-sm text-terminal-muted">No closed trades yet</p>
      </div>
    );
  }

  return (
    <div className="glass-card rounded-xl border border-terminal-border/40 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-[10px] font-mono">
          <thead>
            <tr className="border-b border-terminal-border/40 text-terminal-muted">
              <th className="text-left px-4 py-2.5 font-medium">Symbol</th>
              <th className="text-left px-3 py-2.5 font-medium">Type</th>
              <th className="text-left px-3 py-2.5 font-medium">Mode</th>
              <th className="text-right px-3 py-2.5 font-medium">Entry</th>
              <th className="text-right px-3 py-2.5 font-medium">Exit</th>
              <th className="text-right px-3 py-2.5 font-medium">PnL</th>
              <th className="text-right px-3 py-2.5 font-medium">R·R</th>
              <th className="text-left px-3 py-2.5 font-medium">Result</th>
              <th className="text-right px-4 py-2.5 font-medium">Duration</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-terminal-border/20">
            {trades.map(trade => (
              <HistoryRow key={trade.id} trade={trade} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function HistoryRow({ trade }: { trade: PaperTrade }) {
  const isBuy    = trade.signalType === 'BUY';
  const isWin    = (trade.realizedPnl ?? 0) > 0;
  const rrActual = trade.riskAmountUsdt > 0
    ? (trade.realizedPnl ?? 0) / trade.riskAmountUsdt
    : 0;

  const outcomeLabel: Record<string, { label: string; color: string }> = {
    CLOSED_TP:      { label: 'TP Hit',  color: 'text-bull-text bg-bull-muted border-bull-DEFAULT/30' },
    CLOSED_SL:      { label: 'SL Hit',  color: 'text-bear-text bg-bear-muted border-bear-DEFAULT/30' },
    CLOSED_MANUAL:  { label: 'Manual',  color: 'text-terminal-muted glass-surface border-terminal-border/40' },
    CLOSED_EXPIRED: { label: 'Expired', color: 'text-yellow-400 bg-yellow-900/20 border-yellow-500/30' },
  };
  const outcome = outcomeLabel[trade.status] ?? { label: trade.status, color: 'text-terminal-muted glass-surface border-terminal-border/40' };

  return (
    <tr className="hover:bg-terminal-surface/20 transition-colors">
      <td className="px-4 py-2 font-semibold text-terminal-text">{trade.symbol}</td>
      <td className="px-3 py-2">
        <span className={cn(
          'inline-flex items-center gap-0.5 text-[9px] font-bold',
          isBuy ? 'text-bull-text' : 'text-bear-text',
        )}>
          {isBuy ? <TrendingUp size={8} /> : <TrendingDown size={8} />}
          {isBuy ? 'L' : 'S'}
        </span>
      </td>
      <td className="px-3 py-2 text-terminal-muted">{trade.scannerMode}</td>
      <td className="px-3 py-2 text-right text-terminal-muted">{formatPrice(trade.entryPrice)}</td>
      <td className="px-3 py-2 text-right text-terminal-muted">
        {trade.exitPrice ? formatPrice(trade.exitPrice) : '–'}
      </td>
      <td className={cn('px-3 py-2 text-right font-semibold', isWin ? 'text-bull-text' : 'text-bear-text')}>
        {trade.realizedPnl != null
          ? `${trade.realizedPnl >= 0 ? '+' : ''}$${trade.realizedPnl.toFixed(2)}`
          : '–'}
      </td>
      <td className={cn('px-3 py-2 text-right', isWin ? 'text-bull-text' : 'text-bear-text')}>
        {rrActual >= 0 ? '+' : ''}{rrActual.toFixed(2)}R
      </td>
      <td className="px-3 py-2">
        <span className={cn('text-[9px] px-1.5 py-0.5 rounded border', outcome.color)}>
          {outcome.label}
        </span>
      </td>
      <td className="px-4 py-2 text-right text-terminal-muted">
        {trade.durationHours != null ? `${trade.durationHours.toFixed(1)}h` : '–'}
      </td>
    </tr>
  );
}

// ─── Micro components ─────────────────────────────────────────────────────────

function PriceRow({
  label, value, valueClass = 'text-terminal-text', suffix,
}: {
  label: string; value: string; valueClass?: string; suffix?: string;
}) {
  return (
    <div className="flex justify-between gap-1">
      <span className="text-terminal-dim">{label}</span>
      <span className={valueClass}>
        {value}
        {suffix && <span className="text-terminal-dim ml-1 text-[9px]">{suffix}</span>}
      </span>
    </div>
  );
}

function EmptyPortfolio({ onCheck, checking }: { onCheck: () => void; checking: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-4 glass-card rounded-xl border border-terminal-border/40">
      <Activity size={32} className="text-terminal-muted" />
      <div className="text-center">
        <p className="text-sm text-terminal-text font-semibold">Paper Portfolio Ready</p>
        <p className="text-xs text-terminal-muted mt-1">
          Enter trades from the Scanner tab, then check positions here
        </p>
      </div>
      <button
        onClick={onCheck}
        disabled={checking}
        className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold glass-surface border border-terminal-border/40 text-terminal-muted hover:text-terminal-text transition-all"
      >
        {checking ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
        Check Positions
      </button>
    </div>
  );
}

function PaperTradingLoading() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-8 w-48 rounded skeleton" />
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-16 rounded-xl skeleton" />)}
      </div>
      <div className="h-48 rounded-xl skeleton" />
    </div>
  );
}
