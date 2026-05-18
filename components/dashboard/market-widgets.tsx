'use client';

import { useEffect, useState } from 'react';
import { CoinData } from '@/types';
import { formatVolume } from '@/lib/utils';
import { TrendingUp, TrendingDown, Activity, DollarSign } from 'lucide-react';

interface Props {
  coins: CoinData[];
  loading: boolean;
}

interface FngData {
  value: string;
  value_classification: string;
}

function fngColor(score: number): string {
  if (score >= 75) return '#00d084';
  if (score >= 55) return '#4ade80';
  if (score >= 45) return '#f59e0b';
  if (score >= 25) return '#f97316';
  return '#ff3b5c';
}

export function MarketWidgets({ coins, loading }: Props) {
  const [fng, setFng] = useState<FngData | null>(null);

  useEffect(() => {
    fetch('https://api.alternative.me/fng/?limit=1')
      .then(r => r.json())
      .then(d => { if (d.data?.[0]) setFng(d.data[0] as FngData); })
      .catch(() => null);
  }, []);

  if (loading || coins.length === 0) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="glass-card rounded-xl h-[82px] skeleton" />
        ))}
      </div>
    );
  }

  // BTC dominance
  const totalMcap = coins.reduce((s, c) => s + c.marketCap, 0);
  const btcMcap   = coins.find(c => c.symbol === 'BTC')?.marketCap ?? 0;
  const btcDom    = totalMcap > 0 ? (btcMcap / totalMcap) * 100 : 0;

  // Market breadth
  const upCount = coins.filter(c => c.priceChange24h > 0).length;
  const breadth  = (upCount / coins.length) * 100;

  // 24h total volume
  const totalVol = coins.reduce((s, c) => s + c.volume24h, 0);

  // Fear & Greed: API value if available, else derived from breadth
  const fngScore = fng
    ? parseInt(fng.value, 10)
    : Math.round(breadth);
  const fngLabel = fng
    ? fng.value_classification
    : breadth >= 75 ? 'Extreme Greed'
    : breadth >= 60 ? 'Greed'
    : breadth >= 45 ? 'Neutral'
    : breadth >= 30 ? 'Fear'
    : 'Extreme Fear';

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4 animate-fade-in">
      {/* BTC Dominance */}
      <WidgetCard
        label="BTC Dominance"
        value={`${btcDom.toFixed(1)}%`}
        sub="of top-100 market cap"
        icon={<DollarSign size={13} className="text-signal-high" />}
        accent="#f59e0b"
      >
        <BarFill pct={btcDom} color="linear-gradient(90deg, #f59e0b, #fbbf24)" />
      </WidgetCard>

      {/* Fear & Greed */}
      <WidgetCard
        label={fng ? 'Fear & Greed' : 'Sentiment'}
        value={`${fngScore}`}
        sub={fngLabel}
        icon={<Activity size={13} style={{ color: fngColor(fngScore) }} />}
        accent={fngColor(fngScore)}
        valueColor={fngColor(fngScore)}
      >
        <BarFill pct={fngScore} color={fngColor(fngScore)} />
      </WidgetCard>

      {/* Market Breadth */}
      <WidgetCard
        label="Market Breadth"
        value={`${upCount}/${coins.length}`}
        sub={`${breadth.toFixed(0)}% advancing`}
        icon={
          breadth >= 50
            ? <TrendingUp  size={13} className="text-bull-text" />
            : <TrendingDown size={13} className="text-bear-text" />
        }
        accent={breadth >= 50 ? '#00d084' : '#ff3b5c'}
      >
        {/* Split bull/bear bar */}
        <div className="w-full h-1 bg-terminal-surface rounded-full mt-2 overflow-hidden flex">
          <div
            className="h-full transition-all duration-700"
            style={{ width: `${breadth}%`, background: 'linear-gradient(90deg,#00d084,#4ade80)' }}
          />
          <div
            className="h-full transition-all duration-700"
            style={{ width: `${100 - breadth}%`, background: 'linear-gradient(90deg,#ff3b5c,#f87171)' }}
          />
        </div>
      </WidgetCard>

      {/* 24h Volume */}
      <WidgetCard
        label="24h Volume"
        value={formatVolume(totalVol)}
        sub="top-100 combined"
        icon={<Activity size={13} className="text-signal-medium" />}
        accent="#3b82f6"
      >
        <BarFill pct={100} color="linear-gradient(90deg, #3b82f6, #8b5cf6)" animated />
      </WidgetCard>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function BarFill({
  pct, color, animated = false,
}: {
  pct: number;
  color: string;
  animated?: boolean;
}) {
  return (
    <div className="w-full h-1 bg-terminal-surface rounded-full mt-2 overflow-hidden">
      <div
        className={`h-full rounded-full transition-all duration-700 ${animated ? 'conf-bar-high' : ''}`}
        style={{ width: `${Math.min(pct, 100)}%`, background: color }}
      />
    </div>
  );
}

function WidgetCard({
  label, value, sub, icon, accent, valueColor, children,
}: {
  label: string;
  value: string;
  sub: string;
  icon: React.ReactNode;
  accent: string;
  valueColor?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      className="glass-card rounded-xl px-4 py-3 relative overflow-hidden hover:border-white/10 transition-all duration-200 group"
      style={{ borderTop: `2px solid ${accent}30` }}
    >
      {/* Top glow line */}
      <div
        className="absolute top-0 left-0 right-0 h-px"
        style={{ background: `linear-gradient(90deg, transparent, ${accent}80, transparent)` }}
      />
      {/* Subtle background radial */}
      <div
        className="absolute inset-0 opacity-[0.025] pointer-events-none"
        style={{ background: `radial-gradient(ellipse at 10% 0%, ${accent}, transparent 70%)` }}
      />

      <div className="relative">
        <div className="flex items-center gap-1.5 mb-1">
          {icon}
          <span className="text-[10px] text-terminal-muted uppercase tracking-widest">{label}</span>
        </div>
        <p
          className="font-mono text-xl font-bold"
          style={{ color: valueColor ?? '#e2e8f0' }}
        >
          {value}
        </p>
        <p className="text-[10px] text-terminal-dim">{sub}</p>
        {children}
      </div>
    </div>
  );
}
