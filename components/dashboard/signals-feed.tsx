'use client';

import { useState } from 'react';
import { TradingSignal, RiskGrade, SignalState, McapTier } from '@/types';
import { formatPrice, timeAgo, cn } from '@/lib/utils';
import { computeSignalFreshness, formatAge } from '@/lib/signal-aging';
import { TIER_COLORS } from '@/lib/mcap-tiers';
import { TrendingUp, TrendingDown, Brain, Send, Zap, ShieldCheck, AlertTriangle, Loader2, ChevronDown, ChevronUp, Clock, Activity } from 'lucide-react';

interface Props {
  signals: TradingSignal[];
  loading: boolean;
  onEnterTrade?: (signal: TradingSignal) => Promise<{ success: boolean; error?: string }>;
}

export function SignalsFeed({ signals, loading, onEnterTrade }: Props) {
  const [compact, setCompact] = useState(false);
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
        <div className="flex items-center gap-2.5">
          {/* Compact / Detailed toggle */}
          <div className="flex items-center gap-0.5 glass-surface rounded-lg p-0.5 border border-terminal-border/40">
            <button
              onClick={() => setCompact(false)}
              className={`px-2 py-0.5 rounded text-[9px] font-semibold transition-all ${
                !compact ? 'bg-terminal-surface text-terminal-text' : 'text-terminal-muted hover:text-terminal-text'
              }`}
            >
              Detail
            </button>
            <button
              onClick={() => setCompact(true)}
              className={`px-2 py-0.5 rounded text-[9px] font-semibold transition-all ${
                compact ? 'bg-terminal-surface text-terminal-text' : 'text-terminal-muted hover:text-terminal-text'
              }`}
            >
              Compact
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-bull-DEFAULT opacity-50" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-bull-DEFAULT" />
            </span>
            <span className="text-[10px] text-terminal-dim">conf ≥ 80%</span>
          </div>
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

        {compact
          ? filtered.map((signal, idx) => (
              <CompactSignalRow
                key={signal.id ?? `${signal.symbol}-${signal.timeframe}-${String(signal.createdAt)}`}
                signal={signal}
                index={idx}
                onEnterTrade={onEnterTrade}
              />
            ))
          : filtered.map((signal, idx) => (
              <SignalCard
                key={signal.id ?? `${signal.symbol}-${signal.timeframe}-${String(signal.createdAt)}`}
                signal={signal}
                index={idx}
                onEnterTrade={onEnterTrade}
              />
            ))
        }
      </div>
    </div>
  );
}

// ─── Signal card ─────────────────────────────────────────────────────────────

function SignalCard({
  signal, index, onEnterTrade,
}: {
  signal: TradingSignal;
  index: number;
  onEnterTrade?: (signal: TradingSignal) => Promise<{ success: boolean; error?: string }>;
}) {
  const [trading, setTrading]       = useState(false);
  const [tradeState, setTradeState] = useState<'idle' | 'ok' | 'dup' | 'err'>('idle');
  const [aiExpanded, setAiExpanded] = useState(false);

  const handleTrade = async () => {
    if (!onEnterTrade || trading) return;
    setTrading(true);
    setTradeState('idle');
    try {
      const result = await onEnterTrade(signal);
      if (result.success) {
        setTradeState('ok');
        setTimeout(() => setTradeState('idle'), 3000);
      } else {
        const isDup = result.error?.toLowerCase().includes('already have') || result.error?.toLowerCase().includes('duplicate');
        setTradeState(isDup ? 'dup' : 'err');
        setTimeout(() => setTradeState('idle'), 4000);
      }
    } finally {
      setTrading(false);
    }
  };

  const isBuy    = signal.type === 'BUY';
  const dir      = isBuy ? 1 : -1;
  const atr      = signal.indicators.atr;
  const freshness = computeSignalFreshness(signal);

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
            {/* Signal freshness */}
            <FreshnessBadge freshness={freshness.status} ageMin={freshness.ageMinutes} />
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

        {/* Phase 6.1 — Tactical intelligence row */}
        {(signal.signalState || signal.institutionalScore != null || signal.continuation) && (
          <div className="flex items-center gap-1.5 flex-wrap mb-2">
            {signal.signalState && <SignalStateBadge state={signal.signalState} />}
            {signal.institutionalScore != null && (
              <span className="text-[9px] font-mono glass-surface border border-terminal-border/50 rounded px-1.5 py-0.5 text-terminal-muted">
                Inst {signal.institutionalScore}
              </span>
            )}
            {signal.continuation && (
              <div className="flex items-center gap-1 flex-1 min-w-[80px]">
                <span className="text-[9px] text-terminal-dim flex-shrink-0">Cont</span>
                <div className="flex-1 h-1 bg-terminal-surface rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{
                      width: `${signal.continuation.continuationProbability}%`,
                      background:
                        signal.continuation.exhaustionRisk === 'low'    ? '#00d084' :
                        signal.continuation.exhaustionRisk === 'medium' ? '#f59e0b' : '#ff3b5c',
                    }}
                  />
                </div>
                <span className="text-[9px] font-mono text-terminal-muted w-7 text-right flex-shrink-0">
                  {signal.continuation.continuationProbability}%
                </span>
                <ExhaustionDot risk={signal.continuation.exhaustionRisk} />
              </div>
            )}
            {signal.marketRegime && (
              <span className={cn(
                'text-[8px] font-mono px-1.5 py-0.5 rounded border flex-shrink-0',
                signal.marketRegime === 'BULL_TREND'     ? 'bg-bull-muted text-bull-text border-bull-DEFAULT/20' :
                signal.marketRegime === 'BEAR_TREND'     ? 'bg-bear-muted text-bear-text border-bear-DEFAULT/20' :
                signal.marketRegime === 'EUPHORIA'       ? 'bg-yellow-900/20 text-yellow-400 border-yellow-500/20' :
                signal.marketRegime === 'CAPITULATION'   ? 'bg-orange-900/20 text-orange-400 border-orange-500/20' :
                signal.marketRegime === 'HIGH_VOLATILITY'? 'bg-purple-900/20 text-purple-400 border-purple-500/20' :
                'glass-surface text-terminal-muted border-terminal-border/50',
              )}>
                {signal.marketRegime.replace('_', ' ')}
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
            {/* Phase 6.2 intelligence badges */}
            {signal.mcapTier && <McapTierBadge tier={signal.mcapTier} />}
            {signal.sectorName && signal.sectorName !== 'Other' && (
              <MicroBadge label={signal.sectorName} />
            )}
            {signal.telegramSent && <Send size={9} className="text-signal-medium opacity-70" />}
          </div>
          <span className="text-[9px] text-terminal-dim flex-shrink-0">{timeAgo(signal.createdAt)}</span>
        </div>

        {/* Entry quality + extension risk */}
        {(signal.entryQualityScore != null || signal.extensionRisk) && (
          <div className="flex items-center gap-2 mt-1.5">
            {signal.entryQualityScore != null && (
              <div className="flex items-center gap-1.5 flex-1 min-w-0">
                <Activity size={8} className="text-terminal-dim flex-shrink-0" />
                <span className="text-[9px] text-terminal-dim flex-shrink-0">Entry</span>
                <div className="flex-1 h-1 bg-terminal-surface rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{
                      width:      `${signal.entryQualityScore}%`,
                      background: signal.entryQualityScore >= 70 ? '#00d084'
                                : signal.entryQualityScore >= 50 ? '#f59e0b'
                                : '#ff3b5c',
                    }}
                  />
                </div>
                <span className="text-[9px] font-mono text-terminal-muted w-6 text-right flex-shrink-0">
                  {signal.entryQualityScore}
                </span>
              </div>
            )}
            {signal.extensionRisk && signal.extensionRisk !== 'LOW' && (
              <span className={cn(
                'text-[9px] font-mono px-1.5 py-0.5 rounded border flex-shrink-0',
                signal.extensionRisk === 'HIGH'
                  ? 'bg-bear-muted text-bear-text border-bear-DEFAULT/30'
                  : 'bg-yellow-900/20 text-yellow-400 border-yellow-500/30',
              )}>
                {signal.extensionRisk === 'HIGH' ? '⚠ EXTENDED' : '~ Extended'}
              </span>
            )}
          </div>
        )}

        {/* Strengths */}
        {signal.strengths && signal.strengths.length > 0 && (
          <div className="flex gap-1 flex-wrap mt-1.5">
            {signal.strengths.slice(0, 2).map((s, i) => (
              <span
                key={i}
                className="text-[8px] font-mono px-1.5 py-0.5 rounded border bg-bull-muted/30 text-bull-text/75 border-bull-DEFAULT/15 truncate max-w-[160px]"
              >
                ✓ {s}
              </span>
            ))}
          </div>
        )}

        {/* Risk warnings */}
        {signal.riskWarnings && signal.riskWarnings.length > 0 && (
          <div className="mt-1.5 flex items-start gap-1.5">
            <AlertTriangle size={8} className="text-signal-high mt-0.5 flex-shrink-0" />
            <p className="text-[8.5px] text-signal-high/80 leading-relaxed line-clamp-2">
              {signal.riskWarnings.slice(0, 2).map(w => w.message).join(' · ')}
            </p>
          </div>
        )}

        {/* AI analysis — expandable */}
        {(signal.aiExplainability || signal.aiReasoning) && (
          <div className="mt-1.5">
            <button
              onClick={() => setAiExpanded(v => !v)}
              className="flex items-center gap-1 text-[9px] text-terminal-muted hover:text-terminal-text transition-colors w-full"
            >
              <Brain size={9} className="flex-shrink-0" />
              {signal.aiExplainability
                ? <span className="flex-1 text-left truncate">{signal.aiExplainability.summary}</span>
                : <span className="flex-1 text-left truncate line-clamp-1">{signal.aiReasoning}</span>
              }
              {signal.aiExplainability && (
                aiExpanded ? <ChevronUp size={8} className="flex-shrink-0" /> : <ChevronDown size={8} className="flex-shrink-0" />
              )}
            </button>

            {aiExpanded && signal.aiExplainability && (
              <div className="mt-1.5 glass-surface rounded-lg border border-terminal-border/40 p-2 space-y-1.5">
                <AIExplainRow icon="📈" label="Trend"        text={signal.aiExplainability.trend} />
                <AIExplainRow icon="⚡" label="Momentum"     text={signal.aiExplainability.momentum} />
                <AIExplainRow icon="🌡" label="Volatility"   text={signal.aiExplainability.volatility} />
                <AIExplainRow icon="💡" label="Why"          text={signal.aiExplainability.rationale} />
                {signal.aiExplainability.continuationCase && (
                  <AIExplainRow icon="→" label="Cont."       text={signal.aiExplainability.continuationCase} />
                )}
                {signal.aiExplainability.cautionCase && (
                  <AIExplainRow icon="⚠" label="Caution"    text={signal.aiExplainability.cautionCase} />
                )}
                {signal.aiExplainability.regimeNote && (
                  <AIExplainRow icon="🌐" label="Regime"     text={signal.aiExplainability.regimeNote} />
                )}
              </div>
            )}
          </div>
        )}

        {/* Paper trade button */}
        {onEnterTrade && (
          <div className="mt-2 flex items-center justify-end">
            <button
              onClick={handleTrade}
              disabled={trading || tradeState === 'ok' || tradeState === 'dup'}
              className={cn(
                'inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[9px] font-semibold border transition-all',
                tradeState === 'ok'  && 'bg-bull-muted text-bull-text border-bull-DEFAULT/30',
                tradeState === 'dup' && 'bg-yellow-900/20 text-yellow-400 border-yellow-500/30',
                tradeState === 'err' && 'bg-bear-muted text-bear-text border-bear-DEFAULT/30',
                tradeState === 'idle' && 'glass-surface text-terminal-muted border-terminal-border/40 hover:text-terminal-text hover:border-bull-DEFAULT/40',
              )}
            >
              {trading
                ? <><Loader2 size={8} className="animate-spin" /> Entering…</>
                : tradeState === 'ok'  ? '✓ Entered'
                : tradeState === 'dup' ? '⚠ Duplicate'
                : tradeState === 'err' ? '⚠ Failed'
                : '◈ Paper Trade'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Compact row ─────────────────────────────────────────────────────────────

function CompactSignalRow({
  signal, index, onEnterTrade,
}: {
  signal: TradingSignal;
  index: number;
  onEnterTrade?: (signal: TradingSignal) => Promise<{ success: boolean; error?: string }>;
}) {
  const [trading, setTrading]       = useState(false);
  const [tradeState, setTradeState] = useState<'idle' | 'ok' | 'dup' | 'err'>('idle');

  const handleTrade = async () => {
    if (!onEnterTrade || trading) return;
    setTrading(true);
    setTradeState('idle');
    try {
      const result = await onEnterTrade(signal);
      if (result.success) {
        setTradeState('ok');
        setTimeout(() => setTradeState('idle'), 3000);
      } else {
        const isDup = result.error?.toLowerCase().includes('already have') || result.error?.toLowerCase().includes('duplicate');
        setTradeState(isDup ? 'dup' : 'err');
        setTimeout(() => setTradeState('idle'), 4000);
      }
    } finally {
      setTrading(false);
    }
  };

  const isBuy = signal.type === 'BUY';
  const confColor = signal.confidence >= 90 ? '#00d084'
                  : signal.confidence >= 85 ? '#f59e0b'
                  : '#3b82f6';
  const confGradient = signal.confidence >= 90
    ? 'linear-gradient(90deg,#00d084,#4ade80)'
    : signal.confidence >= 85
    ? 'linear-gradient(90deg,#f59e0b,#fbbf24)'
    : 'linear-gradient(90deg,#3b82f6,#60a5fa)';

  return (
    <div
      className="px-3 py-2 flex items-center gap-2.5 hover:bg-terminal-surface/30 transition-colors relative overflow-hidden group signal-card-enter"
      style={{ animationDelay: `${Math.min(index * 20, 200)}ms` }}
    >
      {/* Left accent */}
      <div
        className="absolute left-0 top-0 bottom-0 w-0.5 opacity-60 group-hover:opacity-100 transition-opacity"
        style={{ backgroundColor: isBuy ? '#00d084' : '#ff3b5c' }}
      />

      {/* Direction badge */}
      <span className={cn(
        'inline-flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded flex-shrink-0',
        isBuy
          ? 'bg-bull-muted text-bull-text border border-bull-DEFAULT/30'
          : 'bg-bear-muted text-bear-text border border-bear-DEFAULT/30',
      )}>
        {isBuy ? <TrendingUp size={8} /> : <TrendingDown size={8} />}
        {isBuy ? 'L' : 'S'}
      </span>

      {/* Symbol */}
      <span className="font-mono font-bold text-[11px] text-terminal-text w-[72px] flex-shrink-0 truncate pl-1">
        {signal.symbol}
      </span>

      {/* Timeframe */}
      <span className="text-[9px] text-terminal-dim glass-surface border border-terminal-border/40 rounded px-1 py-0.5 flex-shrink-0 hidden sm:inline">
        {signal.timeframe.toUpperCase()}
      </span>

      {/* Confidence bar + value */}
      <div className="flex items-center gap-1.5 flex-1 min-w-0">
        <div className="flex-1 h-1 bg-terminal-surface rounded-full overflow-hidden min-w-0 max-w-[80px]">
          <div
            className="h-full rounded-full"
            style={{ width: `${signal.confidence}%`, background: confGradient }}
          />
        </div>
        <span className="font-mono text-[10px] font-bold flex-shrink-0" style={{ color: confColor }}>
          {signal.confidence}%
        </span>
      </div>

      {/* R:R */}
      <span className="text-[9px] font-mono text-signal-medium flex-shrink-0 hidden sm:inline">
        1:{signal.rrRatio.toFixed(1)}
      </span>

      {/* Grade */}
      {signal.riskGrade != null && (
        <RiskGradeBadge grade={signal.riskGrade} />
      )}

      {/* AI validated dot */}
      {signal.aiValidated && (
        <Brain size={9} className="text-purple-400 flex-shrink-0 hidden md:block" />
      )}

      {/* Time */}
      <span className="text-[9px] text-terminal-dim flex-shrink-0 w-14 text-right hidden lg:block">
        {timeAgo(signal.createdAt)}
      </span>

      {/* Trade button — visible on hover */}
      {onEnterTrade && (
        <button
          onClick={handleTrade}
          disabled={trading || tradeState === 'ok' || tradeState === 'dup'}
          className={cn(
            'hidden group-hover:inline-flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-semibold border transition-all flex-shrink-0',
            tradeState === 'ok'  && 'bg-bull-muted text-bull-text border-bull-DEFAULT/30',
            tradeState === 'dup' && 'bg-yellow-900/20 text-yellow-400 border-yellow-500/30',
            tradeState === 'err' && 'bg-bear-muted text-bear-text border-bear-DEFAULT/30',
            tradeState === 'idle' && 'glass-surface text-terminal-muted border-terminal-border/40 hover:text-terminal-text hover:border-bull-DEFAULT/40',
          )}
        >
          {trading
            ? <Loader2 size={7} className="animate-spin" />
            : tradeState === 'ok'  ? '✓'
            : tradeState === 'dup' ? '⚠'
            : tradeState === 'err' ? '✕'
            : '◈'}
        </button>
      )}
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

function AIExplainRow({ icon, label, text }: { icon: string; label: string; text: string }) {
  return (
    <div className="flex items-start gap-1.5">
      <span className="text-[9px] flex-shrink-0 w-[60px] text-terminal-dim">{icon} {label}</span>
      <span className="text-[9px] text-terminal-muted leading-relaxed">{text}</span>
    </div>
  );
}

function SignalStateBadge({ state }: { state: SignalState }) {
  const styles: Record<SignalState, { label: string; cls: string }> = {
    CONFIRMED:   { label: 'CONFIRMED',   cls: 'bg-bull-muted text-bull-text border-bull-DEFAULT/30' },
    DEVELOPING:  { label: 'DEVELOPING',  cls: 'bg-blue-900/20 text-blue-400 border-blue-500/30' },
    EXTENDED:    { label: 'EXTENDED',    cls: 'bg-yellow-900/20 text-yellow-400 border-yellow-500/30' },
    COOLING:     { label: 'COOLING',     cls: 'bg-cyan-900/20 text-cyan-400 border-cyan-500/30' },
    CORRECTING:  { label: 'CORRECTING',  cls: 'bg-orange-900/20 text-orange-400 border-orange-500/30' },
    INVALIDATED: { label: 'INVALIDATED', cls: 'bg-bear-muted text-bear-text border-bear-DEFAULT/30' },
    EXPIRED:     { label: 'EXPIRED',     cls: 'glass-surface text-terminal-muted border-terminal-border/50' },
  };
  const s = styles[state];
  return (
    <span className={cn('text-[9px] font-bold px-1.5 py-0.5 rounded border flex-shrink-0', s.cls)}>
      {s.label}
    </span>
  );
}

function ExhaustionDot({ risk }: { risk: 'low' | 'medium' | 'high' }) {
  const color = risk === 'low' ? '#00d084' : risk === 'medium' ? '#f59e0b' : '#ff3b5c';
  return (
    <span
      className="w-1.5 h-1.5 rounded-full flex-shrink-0"
      style={{ backgroundColor: color }}
      title={`Exhaustion: ${risk}`}
    />
  );
}

function FreshnessBadge({ freshness, ageMin }: { freshness: 'FRESH' | 'AGING' | 'STALE'; ageMin: number }) {
  const styles = {
    FRESH: 'text-bull-text border-bull-DEFAULT/20 bg-bull-muted/30',
    AGING: 'text-yellow-400 border-yellow-500/20 bg-yellow-900/10',
    STALE: 'text-terminal-dim border-terminal-border/40 bg-transparent',
  };
  return (
    <span className={cn(
      'inline-flex items-center gap-1 text-[9px] font-mono px-1.5 py-0.5 rounded border flex-shrink-0',
      styles[freshness],
    )}>
      <Clock size={7} />
      {freshness === 'FRESH' ? 'FRESH' : freshness === 'AGING' ? `${formatAge(ageMin)}` : `STALE ${formatAge(ageMin)}`}
    </span>
  );
}

function McapTierBadge({ tier }: { tier: McapTier }) {
  const labels: Record<McapTier, string> = {
    mega: 'T10', large: 'T25', mid: 'T50', small: 'T100',
  };
  return (
    <span
      className="text-[9px] font-mono px-1.5 py-0.5 rounded border flex-shrink-0"
      style={{
        color:           TIER_COLORS[tier],
        borderColor:     TIER_COLORS[tier] + '30',
        backgroundColor: TIER_COLORS[tier] + '10',
      }}
    >
      {labels[tier]}
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
