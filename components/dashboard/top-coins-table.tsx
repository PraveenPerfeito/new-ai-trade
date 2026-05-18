'use client';

import { CoinData, TradingSignal } from '@/types';
import { formatPrice, formatVolume, formatMarketCap, formatPct, cn } from '@/lib/utils';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface Props {
  coins:   CoinData[];
  signals: TradingSignal[];
  loading: boolean;
}

export function TopCoinsTable({ coins, signals, loading }: Props) {
  const sigMap = new Map<string, TradingSignal>();
  for (const s of signals) {
    const existing = sigMap.get(s.symbol);
    if (!existing || s.confidence > existing.confidence) sigMap.set(s.symbol, s);
  }

  return (
    <div className="glass-card rounded-xl flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-terminal-border/50 flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-terminal-text uppercase tracking-widest">Market</span>
          <span className="glass-surface border border-terminal-border/50 rounded px-1.5 py-0.5 text-[10px] text-terminal-muted font-mono">
            TOP 100
          </span>
        </div>
        <span className="text-[10px] text-terminal-dim">by market cap</span>
      </div>

      {/* Column headers */}
      <div className="flex-shrink-0 border-b border-terminal-border/30">
        <div className="grid grid-cols-[28px_1fr_auto_auto_auto_auto_76px] items-center gap-x-2 px-4 py-2 text-[10px] text-terminal-muted uppercase tracking-wider">
          <span>#</span>
          <span>Coin</span>
          <span className="text-right">Price</span>
          <span className="text-right">24h</span>
          <span className="text-right hidden md:block">Volume</span>
          <span className="text-right hidden lg:block">MCap</span>
          <span className="text-center">Signal</span>
        </div>
      </div>

      {/* Rows */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {loading && coins.length === 0 && (
          <div className="p-3 space-y-1">
            {Array.from({ length: 18 }).map((_, i) => (
              <div key={i} className="rounded h-8 skeleton" />
            ))}
          </div>
        )}

        {coins.map(coin => (
          <CoinRow
            key={coin.id}
            coin={coin}
            signal={sigMap.get(coin.symbol)}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Row ─────────────────────────────────────────────────────────────────────

function CoinRow({ coin, signal }: { coin: CoinData; signal?: TradingSignal }) {
  const up     = coin.priceChange24h >= 0;
  const hasSig = !!signal;

  return (
    <div
      className={cn(
        'grid grid-cols-[28px_1fr_auto_auto_auto_auto_76px] items-center gap-x-2 px-4 py-2',
        'border-b border-terminal-border/15 text-xs',
        'hover:bg-terminal-surface/40 transition-colors duration-100',
        hasSig && 'bg-terminal-surface/10',
      )}
    >
      {/* Rank */}
      <span className="font-mono text-terminal-dim text-[10px]">{coin.rank}</span>

      {/* Coin */}
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="font-mono font-semibold text-terminal-text text-[11px]">{coin.symbol}</span>
        <span className="text-terminal-dim text-[10px] hidden sm:inline truncate">{coin.name}</span>
      </div>

      {/* Price */}
      <span className="font-mono text-terminal-text text-[11px] text-right tabular-nums">
        {formatPrice(coin.price)}
      </span>

      {/* 24h change */}
      <span className={cn(
        'font-mono text-[11px] text-right flex items-center justify-end gap-0.5 tabular-nums',
        up ? 'text-bull-text' : 'text-bear-text',
      )}>
        {up ? <TrendingUp size={8} /> : <TrendingDown size={8} />}
        {formatPct(coin.priceChange24h)}
      </span>

      {/* Volume */}
      <span className="font-mono text-terminal-muted text-[10px] text-right hidden md:block tabular-nums">
        {formatVolume(coin.volume24h)}
      </span>

      {/* MCap */}
      <span className="font-mono text-terminal-muted text-[10px] text-right hidden lg:block tabular-nums">
        {formatMarketCap(coin.marketCap)}
      </span>

      {/* Signal badge */}
      <div className="flex justify-center">
        <SignalBadge signal={signal} />
      </div>
    </div>
  );
}

// ─── Signal badge ─────────────────────────────────────────────────────────────

function SignalBadge({ signal }: { signal?: TradingSignal }) {
  if (!signal) {
    return <Minus size={9} className="text-terminal-dim" />;
  }
  const isBuy = signal.type === 'BUY';
  return (
    <span className={cn(
      'inline-flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap',
      isBuy
        ? 'bg-bull-muted text-bull-text border border-bull-DEFAULT/30'
        : 'bg-bear-muted text-bear-text border border-bear-DEFAULT/30',
    )}>
      {isBuy ? <TrendingUp size={7} /> : <TrendingDown size={7} />}
      {signal.type} {signal.confidence}%
    </span>
  );
}
