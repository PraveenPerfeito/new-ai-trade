'use client';

import { CoinData } from '@/types';
import { formatPrice, formatPct, cn } from '@/lib/utils';
import { TrendingUp, TrendingDown } from 'lucide-react';

interface Props {
  coins: CoinData[];
  loading: boolean;
}

export function TopMovers({ coins, loading }: Props) {
  if (loading || coins.length === 0) {
    return (
      <div className="mb-4">
        <SectionLabel />
        <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
          {[0, 1, 2, 3, 4, 5, 6, 7].map(i => (
            <div key={i} className="glass-card rounded-xl flex-shrink-0 w-[130px] h-[72px] skeleton" />
          ))}
        </div>
      </div>
    );
  }

  const movers = [...coins]
    .sort((a, b) => Math.abs(b.priceChange24h) - Math.abs(a.priceChange24h))
    .slice(0, 10);

  return (
    <div className="mb-4 animate-fade-in">
      <SectionLabel />
      <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
        {movers.map((coin, i) => <MoverCard key={coin.id} coin={coin} rank={i + 1} />)}
      </div>
    </div>
  );
}

function SectionLabel() {
  return (
    <div className="flex items-center gap-2 mb-2.5">
      <span className="text-[10px] text-terminal-muted uppercase tracking-widest">Top Movers · 24h</span>
      <div className="flex-1 h-px bg-terminal-border/50" />
    </div>
  );
}

function MoverCard({ coin, rank }: { coin: CoinData; rank: number }) {
  const up      = coin.priceChange24h >= 0;
  const absPct  = Math.abs(coin.priceChange24h);
  const barPct  = Math.min(absPct * 6, 100);

  return (
    <div
      className={cn(
        'glass-card rounded-xl flex-shrink-0 px-3 py-2.5 w-[136px] relative overflow-hidden',
        'hover:scale-[1.03] transition-transform duration-150 cursor-default',
        'hover:border-white/10',
      )}
      style={{ borderTop: `2px solid ${up ? '#00d08428' : '#ff3b5c28'}` }}
    >
      {/* Top glow line */}
      <div
        className="absolute top-0 left-0 right-0 h-px"
        style={{ background: `linear-gradient(90deg, transparent, ${up ? '#00d084' : '#ff3b5c'}60, transparent)` }}
      />

      {/* Rank + symbol + icon */}
      <div className="flex items-center justify-between mb-0.5 gap-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-[9px] font-mono text-terminal-dim/60 flex-shrink-0 w-4">{rank}</span>
          <span className="font-mono font-bold text-terminal-text text-xs truncate">{coin.symbol}</span>
        </div>
        {up
          ? <TrendingUp  size={11} className="text-bull-text flex-shrink-0" />
          : <TrendingDown size={11} className="text-bear-text flex-shrink-0" />
        }
      </div>

      {/* Price */}
      <p className="font-mono text-[10px] text-terminal-muted mb-1 truncate">{formatPrice(coin.price)}</p>

      {/* Change */}
      <p className={cn('font-mono text-sm font-bold', up ? 'text-bull-text' : 'text-bear-text')}>
        {formatPct(coin.priceChange24h)}
      </p>

      {/* Mini magnitude bar */}
      <div className="w-full h-0.5 bg-terminal-surface rounded-full mt-1.5 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${barPct}%`, backgroundColor: up ? '#00d084' : '#ff3b5c' }}
        />
      </div>
    </div>
  );
}
