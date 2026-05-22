import { TradingSignal, Timeframe, SignalFreshnessData } from '@/types';

// Minutes until AGING / STALE per timeframe
const LIFECYCLE: Record<Timeframe, { aging: number; stale: number }> = {
  '15m': { aging: 20,  stale: 60   },
  '1h':  { aging: 45,  stale: 120  },
  '4h':  { aging: 120, stale: 360  },
  '1d':  { aging: 360, stale: 1440 },
};

export function computeSignalFreshness(signal: TradingSignal): SignalFreshnessData {
  const lc      = LIFECYCLE[signal.timeframe] ?? LIFECYCLE['1h'];
  const ageMin  = (Date.now() - new Date(signal.createdAt).getTime()) / 60_000;

  let score: number;
  let status: SignalFreshnessData['status'];

  if (ageMin <= lc.aging) {
    status = 'FRESH';
    // Linearly decays from 100 → 80 over the fresh window
    score  = Math.round(100 - (ageMin / lc.aging) * 20);
  } else if (ageMin <= lc.stale) {
    status = 'AGING';
    const progress = (ageMin - lc.aging) / (lc.stale - lc.aging);
    // Linearly decays from 80 → 30 over the aging window
    score  = Math.round(80 - progress * 50);
  } else {
    status = 'STALE';
    const overdue = Math.min((ageMin - lc.stale) / lc.stale, 1);
    // Decays from 30 → 0 after stale cutoff
    score  = Math.round(30 - overdue * 30);
  }

  return {
    status,
    score:            Math.max(0, score),
    ageMinutes:       Math.round(ageMin),
    lifecycleMinutes: lc.stale,
    decayPct:         Math.min(1, ageMin / lc.stale),
  };
}

export function formatAge(minutes: number): string {
  if (minutes < 60)    return `${Math.round(minutes)}m`;
  if (minutes < 1440)  return `${Math.round(minutes / 60)}h`;
  return `${Math.round(minutes / 1440)}d`;
}
