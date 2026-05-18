'use client';

import { DashboardStats } from '@/types';
import { timeAgo } from '@/lib/utils';
import { Activity, TrendingUp, Target, Clock } from 'lucide-react';

interface Props {
  stats: DashboardStats;
}

export function StatsBar({ stats }: Props) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
      <StatCard
        icon={<Activity size={14} className="text-signal-medium" />}
        label="Coins Scanned"
        value={stats.totalScanned.toString()}
        sub="top 100 filtered"
        accent="#3b82f6"
      />
      <StatCard
        icon={<TrendingUp size={14} className={stats.totalSignals > 0 ? 'text-bull-text' : 'text-terminal-muted'} />}
        label="Active Signals"
        value={stats.totalSignals.toString()}
        sub="confidence ≥75%"
        accent={stats.totalSignals > 0 ? '#00d084' : undefined}
        valueClass={stats.totalSignals > 0 ? 'text-gradient-bull' : ''}
      />
      <StatCard
        icon={<Target size={14} className={stats.highConfSignals > 0 ? 'text-signal-high' : 'text-terminal-muted'} />}
        label="High Confidence"
        value={stats.highConfSignals.toString()}
        sub="confidence ≥85%"
        accent={stats.highConfSignals > 0 ? '#f59e0b' : undefined}
        valueClass={stats.highConfSignals > 0 ? 'text-signal-high' : ''}
      />
      <StatCard
        icon={
          <Clock
            size={14}
            className={stats.isScanning ? 'text-signal-high animate-spin-slow' : 'text-terminal-muted'}
          />
        }
        label="Last Scan"
        value={stats.lastScanTime ? timeAgo(stats.lastScanTime) : '—'}
        sub={stats.isScanning ? 'scanning now…' : 'idle'}
        accent={stats.isScanning ? '#f59e0b' : undefined}
        valueClass={stats.isScanning ? 'text-signal-high animate-pulse' : ''}
      />
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  sub,
  valueClass = '',
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  valueClass?: string;
  accent?: string;
}) {
  return (
    <div
      className="glass-card rounded-xl px-4 py-3 relative overflow-hidden hover:border-white/10 transition-all duration-200"
      style={accent ? { borderLeft: `2px solid ${accent}60` } : {}}
    >
      {/* Ambient radial glow */}
      {accent && (
        <div
          className="absolute inset-0 opacity-[0.035] pointer-events-none"
          style={{ background: `radial-gradient(ellipse at 0% 50%, ${accent}, transparent 70%)` }}
        />
      )}
      <div className="relative">
        <div className="flex items-center gap-1.5 mb-1">
          {icon}
          <span className="text-[10px] text-terminal-muted uppercase tracking-widest">{label}</span>
        </div>
        <p className={`font-mono text-2xl font-bold text-terminal-text ${valueClass}`}>
          {value}
        </p>
        <p className="text-[10px] text-terminal-dim mt-0.5">{sub}</p>
      </div>
    </div>
  );
}
