'use client';

import { TradingSignal, RiskGrade } from '@/types';
import { formatPrice, timeAgo, cn } from '@/lib/utils';
import { TrendingUp, TrendingDown, Brain, Send, Zap, ShieldCheck, AlertTriangle } from 'lucide-react';

interface Props {
  signals: TradingSignal[];
  loading: boolean;
}

export function SignalsFeed({ signals, loading }: Props) {
  const filtered = signals.filter(s => s.confidence >= 80);

  return (
    <div className="glass-card rounded-xl flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-terminal-border/50 flex-shrink-0">
        <div className="flex items-center gap-2">
          <Zap size={12} className="text-signal-high" />
          <span className="text-xs font-semibold text-terminal-text uppercase tracking-widest">Live Signals</span>
          {filtered.length > 0 && (
            <span className="text-[10px] font-mono glass-surface px-1.5 py-0.5 rounded border border-terminal-border/50 text-terminal-muted">
              {filtered.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="relative flex h-1.5 w-1.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-bull-DEFAULT opacity-50" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-bull-DEFAULT" />
          </span>
          <span className="text-[10px] text-terminal-dim">conf ≥ 80%</span>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto min-h-0 divide-y divide-terminal-border/25">

        {/* Loading skeleton */}
        {loading && filtered.length === 0 && (
          <div className="p-3 space-y-2">
            {[0, 1, 2, 3].map(i => (
              <div key={i} className="rounded-lg h-[108px] skeleton" />
            ))}
          </div>
        )}

        {/* Empty state */}
        {!loading && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <div className="w-12 h-12 rounded-full glass-surface border border-terminal-border/50 flex items-center justify-center">
              <TrendingUp size={20} className="text-terminal-muted" />
            </div>
            <p className="text-terminal-muted text-sm">No signals yet</p>
            <p className="text-terminal-dim text-xs">Run a scan to detect setups</p>
          </div>
        )}

        {filtered.map((signal, idx) => (
          <SignalCard
            key={signal.id ?? `${signal.symbol}-${signal.timeframe}-${String(signal.createdAt)}`}
            signal={signal}
            index={idx}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Signal card ─────────────────────────────────────────────────────────────

function SignalCard({ signal, index }: { signal: TradingSignal; index: number }) {
  const isBuy = signal.type === 'BUY';
  const dir   = isBuy ? 1 : -1;
  const atr   = signal.indicators.atr;

  // TP levels from ATR
  const tp1 = signal.entryPrice + dir * atr * 1;
  const tp2 = signal.entryPrice + dir * atr * 2;
  const tp3 = signal.entryPrice + dir * atr * 3;

  const slRiskPct = (Math.abs(signal.entryPrice - signal.stopLoss) / signal.entryPrice * 100).toFixed(1);
  const confColor = signal.confidence >= 90 ? '#00d084'
                  : signal.confidence >= 85 ? '#f59e0b'
                  : '#3b82f6';

  const confGradient = signal.confidence >= 90
    ? 'linear-gradient(90deg, #00d084, #4ade80)'
    : signal.confidence >= 85
    ? 'linear-gradient(90deg, #f59e0b, #fbbf24)'
    : 'linear-gradient(90deg, #3b82f6, #60a5fa)';

  return (
    <div
      className="px-4 py-3 signal-card-enter hover:bg-terminal-surface/30 transition-colors relative overflow-hidden group"
      style={{ animationDelay: `${Math.min(index * 40, 400)}ms` }}
    >
      {/* Left accent stripe */}
      <div
        className="absolute left-0 top-0 bottom-0 w-0.5 opacity-70 group-hover:opacity-100 transition-opacity"
        style={{ backgroundColor: isBuy ? '#00d084' : '#ff3b5c' }}
      />

      {/* Ambient glow on hover */}
      <div
        className="absolute inset-0 opacity-0 group-hover:opacity-[0.02] transition-opacity pointer-events-none"
        style={{ background: isBuy ? '#00d084' : '#ff3b5c' }}
      />

      <div className="pl-2">
        {/* Row 1: type + symbol + timeframe + confidence */}
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-1.5 flex-wrap min-w-0">
            <span className={cn(
              'inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md flex-shrink-0',
              isBuy
                ? 'bg-bull-muted text-bull-text border border-bull-DEFAULT/30'
                : 'bg-bear-muted text-bear-text border border-bear-DEFAULT/30',
            )}>
              {isBuy ? <TrendingUp size={9} /> : <TrendingDown size={9} />}
              {isBuy ? 'LONG' : 'SHORT'}
            </span>
            <span className="font-mono font-bold text-terminal-text text-[13px]">{signal.symbol}</span>
            <span className="text-[9px] text-terminal-muted glass-surface border border-terminal-border/50 rounded px-1.5 py-0.5">
              {signal.timeframe.toUpperCase()}
            </span>
            <span className="text-[9px] text-terminal-dim hidden sm:inline">
              {signal.scannerMode.replace('_', ' ')}
            </span>
          </div>
          {/* Confidence value */}
          <span
            className="font-mono font-bold text-sm flex-shrink-0"
            style={{ color: confColor }}
          >
            {signal.confidence}%
          </span>
        </div>

        {/* Confidence bar */}
        <div className="w-full h-1.5 bg-terminal-surface rounded-full overflow-hidden mb-2.5">
          <div
            className={cn(
              'h-full rounded-full transition-all duration-700',
              signal.confidence >= 85 ? 'conf-bar-high' : '',
            )}
            style={{ width: `${signal.confidence}%`, background: confGradient }}
          />
        </div>

        {/* Trade levels grid */}
        <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 mb-2.5 font-mono text-[10px]">
          <LevelRow label="Entry" value={formatPrice(signal.entryPrice)} />
          <LevelRow label="Stop"  value={formatPrice(signal.stopLoss)} valueClass="text-bear-text" suffix={`-${slRiskPct}%`} />
          <LevelRow label="TP 1"  value={formatPrice(tp1)} valueClass="text-bull-text" />
          <LevelRow label="TP 2"  value={formatPrice(tp2)} valueClass="text-bull-text" />
          <LevelRow label="TP 3"  value={formatPrice(tp3)} valueClass="text-bull-text" />
          <LevelRow label="R:R"   value={`1:${signal.rrRatio.toFixed(2)}`} valueClass="text-signal-medium font-bold" />
        </div>

        {/* Risk grade + quality bar */}
        {signal.riskGrade != null && (
          <div className="flex items-center gap-2 mb-2">
            <RiskGradeBadge grade={signal.riskGrade} />
            {signal.qualityScore != null && (
              <div className="flex-1 flex items-center gap-1.5">
                <span className="text-[9px] text-terminal-dim w-10 flex-shrink-0">Quality</span>
                <div className="flex-1 h-1 bg-terminal-surface rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{
                      width:      `${signal.qualityScore}%`,
                      background: signal.qualityScore >= 70 ? '#00d084'
                                : signal.qualityScore >= 50 ? '#f59e0b'
                                : '#3b82f6',
                    }}
                  />
                </div>
                <span className="text-[9px] font-mono text-terminal-muted w-6 text-right flex-shrink-0">
                  {signal.qualityScore}
                </span>
              </div>
            )}
            {signal.maxSafeLeverage != null && signal.scannerMode === 'futures' && (
              <span className="text-[9px] font-mono text-signal-medium flex-shrink-0 glass-surface border border-terminal-border/50 rounded px-1.5 py-0.5">
                {signal.maxSafeLeverage}×
              </span>
            )}
          </div>
        )}

        {/* Futures intelligence row */}
        {signal.futuresData && (
          <div className="mb-2 space-y-1">
            {/* Funding rate + OI trend + momentum score */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <FundingBadge
                rate={signal.futuresData.fundingRate}
                bias={signal.futuresData.fundingBias}
              />
              <OITrendBadge trend={signal.futuresData.oiTrend} change={signal.futuresData.oiChange24h} />
              {signal.futuresData.breakout && (
                <BreakoutBadge
                  direction={signal.futuresData.breakout.direction}
                  pct={signal.futuresData.breakout.breakoutPct}
                  volConfirmed={signal.futuresData.breakout.volumeConfirmed}
                />
              )}
            </div>
            {/* Momentum score bar */}
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] text-terminal-dim w-16 flex-shrink-0">Momentum</span>
              <div className="flex-1 h-1 bg-terminal-surface rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{
                    width:      `${signal.futuresData.momentumScore}%`,
                    background: signal.futuresData.momentumScore >= 65 ? '#00d084'
                              : signal.futuresData.momentumScore >= 45 ? '#f59e0b'
                              : '#ff3b5c',
                  }}
                />
              </div>
              <span className="text-[9px] font-mono text-terminal-muted w-6 text-right flex-shrink-0">
                {signal.futuresData.momentumScore}
              </span>
            </div>
            {/* Nearest liquidation zone */}
            {signal.futuresData.liquidationZones.length > 0 && (
              <div className="text-[9px] text-terminal-dim">
                Nearest liq:{' '}
                {signal.futuresData.liquidationZones.slice(0, 2).map((z, i) => (
                  <span key={i} className={cn(
                    'font-mono mr-1.5',
                    z.side === 'LONG_LIQ' ? 'text-bull-text/70' : 'text-bear-text/70',
                  )}>
                    {formatPrice(z.price)}&nbsp;({z.distancePct > 0 ? '+' : ''}{z.distancePct.toFixed(1)}%)
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Badges row */}
        <div className="flex items-center justify-between gap-1">
          <div className="flex gap-1 flex-wrap">
            <MicroBadge label={`RSI ${signal.indicators.rsi.toFixed(0)}`} />
            <MicroBadge
              label={`Vol ${signal.indicators.volumeSpike.toFixed(1)}×`}
              color={signal.indicators.volumeSpike >= 1.5 ? 'green' : undefined}
            />
            <MicroBadge
              label={`+${(Math.abs(tp3 - signal.entryPrice) / signal.entryPrice * 100).toFixed(1)}%`}
              color="green"
            />
            {signal.aiValidated && <MicroBadge label="AI ✓" color="purple" />}
            {signal.telegramSent && <Send size={9} className="text-signal-medium opacity-70" />}
          </div>
          <span className="text-[9px] text-terminal-dim flex-shrink-0">{timeAgo(signal.createdAt)}</span>
        </div>

        {/* Risk warnings */}
        {signal.riskWarnings && signal.riskWarnings.length > 0 && (
          <div className="mt-1.5 flex items-start gap-1.5">
            <AlertTriangle size={8} className="text-signal-high mt-0.5 flex-shrink-0" />
            <p className="text-[8.5px] text-signal-high/80 leading-relaxed line-clamp-2">
              {signal.riskWarnings.slice(0, 2).map(w => w.message).join(' · ')}
            </p>
          </div>
        )}

        {/* AI reasoning */}
        {signal.aiReasoning && (
          <div className="mt-1.5 flex gap-1.5 items-start">
            <Brain size={9} className="text-terminal-muted mt-0.5 flex-shrink-0" />
            <p className="text-[9px] text-terminal-muted leading-relaxed line-clamp-2">
              {signal.aiReasoning}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Micro components ─────────────────────────────────────────────────────────

function LevelRow({
  label, value, valueClass = 'text-terminal-text', suffix,
}: {
  label: string;
  value: string;
  valueClass?: string;
  suffix?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-1">
      <span className="text-terminal-dim">{label}</span>
      <span className={valueClass}>
        {value}
        {suffix && <span className="text-terminal-dim ml-1">{suffix}</span>}
      </span>
    </div>
  );
}

function MicroBadge({ label, color }: { label: string; color?: 'green' | 'purple' }) {
  const styles: Record<string, string> = {
    green:  'bg-bull-muted text-bull-text border-bull-DEFAULT/20',
    purple: 'bg-purple-900/20 text-purple-400 border-purple-500/20',
  };
  return (
    <span className={cn(
      'text-[9px] font-mono px-1.5 py-0.5 rounded border',
      styles[color ?? ''] ?? 'glass-surface text-terminal-muted border-terminal-border/50',
    )}>
      {label}
    </span>
  );
}

function FundingBadge({ rate, bias }: { rate: number; bias: 'LONG_HEAVY' | 'SHORT_HEAVY' | 'NEUTRAL' }) {
  const pct = (rate * 100).toFixed(4);
  const positive = rate >= 0;
  const extreme  = Math.abs(rate) > 0.001;
  const color = bias === 'NEUTRAL'
    ? 'glass-surface text-terminal-muted border-terminal-border/50'
    : positive
    ? (extreme ? 'bg-bear-muted text-bear-text border-bear-DEFAULT/30' : 'bg-yellow-900/20 text-yellow-400 border-yellow-500/30')
    : (extreme ? 'bg-bull-muted text-bull-text border-bull-DEFAULT/30' : 'bg-teal-900/20 text-teal-400 border-teal-500/30');
  return (
    <span className={cn('text-[9px] font-mono px-1.5 py-0.5 rounded border', color)}>
      FR {positive ? '+' : ''}{pct}%
    </span>
  );
}

function OITrendBadge({ trend, change }: { trend: 'RISING' | 'FALLING' | 'STABLE'; change: number }) {
  const color = trend === 'RISING'  ? 'bg-bull-muted text-bull-text border-bull-DEFAULT/30'
              : trend === 'FALLING' ? 'bg-bear-muted text-bear-text border-bear-DEFAULT/30'
              : 'glass-surface text-terminal-muted border-terminal-border/50';
  const arrow = trend === 'RISING' ? '▲' : trend === 'FALLING' ? '▼' : '→';
  return (
    <span className={cn('text-[9px] font-mono px-1.5 py-0.5 rounded border', color)}>
      OI {arrow} {change > 0 ? '+' : ''}{change.toFixed(1)}%
    </span>
  );
}

function BreakoutBadge({ direction, pct, volConfirmed }: { direction: 'UP' | 'DOWN'; pct: number; volConfirmed: boolean }) {
  const isBull = direction === 'UP';
  return (
    <span className={cn(
      'text-[9px] font-mono px-1.5 py-0.5 rounded border',
      isBull
        ? 'bg-bull-muted text-bull-text border-bull-DEFAULT/30'
        : 'bg-bear-muted text-bear-text border-bear-DEFAULT/30',
    )}>
      {isBull ? '⬆' : '⬇'} BRK +{pct.toFixed(1)}%{volConfirmed ? ' ✓V' : ''}
    </span>
  );
}

function RiskGradeBadge({ grade }: { grade: RiskGrade }) {
  const styles: Record<RiskGrade, { bg: string; text: string; border: string }> = {
    A: { bg: 'bg-bull-muted',          text: 'text-bull-text',      border: 'border-bull-DEFAULT/30' },
    B: { bg: 'bg-teal-900/20',         text: 'text-teal-400',       border: 'border-teal-500/30' },
    C: { bg: 'bg-blue-900/20',         text: 'text-blue-400',       border: 'border-blue-500/30' },
    D: { bg: 'bg-yellow-900/20',       text: 'text-yellow-400',     border: 'border-yellow-500/30' },
    F: { bg: 'bg-bear-muted',          text: 'text-bear-text',      border: 'border-bear-DEFAULT/30' },
  };
  const s = styles[grade];
  return (
    <span className={cn(
      'inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded border flex-shrink-0',
      s.bg, s.text, s.border,
    )}>
      <ShieldCheck size={8} />
      {grade}
    </span>
  );
}
