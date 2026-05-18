import {
  SignalOutcomeRecord,
  PerformanceMetrics,
  BreakdownMetrics,
  SetupPattern,
  AIAccuracyBucket,
  AnalyticsData,
  Timeframe,
  ScannerMode,
  SignalType,
} from '@/types';
import { getResolvedOutcomes, getResolutionStatus } from './analytics-db';
import { createLogger } from './logger';

const log = createLogger('lib/signal-analytics');

// ─── Main analytics builder ───────────────────────────────────────────────────

export async function buildAnalyticsData(): Promise<AnalyticsData> {
  const [outcomes, status] = await Promise.all([
    getResolvedOutcomes(1000),
    getResolutionStatus(),
  ]);

  log.info({ resolved: outcomes.length }, 'building analytics');

  return {
    overall:     computeOverall(outcomes),
    byCoin:      computeBreakdown(outcomes, 'symbol'),
    byTimeframe: computeBreakdown(outcomes, 'timeframe'),
    byMode:      computeBreakdown(outcomes, 'scannerMode'),
    byVolatility: computeBreakdown(outcomes, 'volatilityRegime'),
    bestSetups:  computeSetupPatterns(outcomes, 'best'),
    worstSetups: computeSetupPatterns(outcomes, 'worst'),
    aiAccuracy:  computeAIAccuracy(outcomes),
    resolutionStatus: status,
    lastUpdated: new Date(),
  };
}

// ─── Overall performance metrics ─────────────────────────────────────────────

export function computeOverall(outcomes: SignalOutcomeRecord[]): PerformanceMetrics {
  if (outcomes.length === 0) return emptyMetrics(0, 0, 0);

  const total    = outcomes.length;
  const tpHits   = outcomes.filter(o => o.outcome === 'TP_HIT').length;
  const slHits   = outcomes.filter(o => o.outcome === 'SL_HIT').length;
  const timeouts = outcomes.filter(o => o.outcome === 'TIMEOUT').length;
  const resolved = tpHits + slHits + timeouts;

  const wins  = outcomes.filter(o => o.rrAchieved != null && o.rrAchieved > 0);
  const losses = outcomes.filter(o => o.rrAchieved != null && o.rrAchieved <= 0);

  const winRate  = resolved > 0 ? tpHits / resolved : 0;
  const lossRate = resolved > 0 ? (slHits + timeouts) / resolved : 0;

  const avgWin  = wins.length  > 0 ? mean(wins.map(o => o.rrAchieved!))           : 0;
  const avgLoss = losses.length > 0 ? Math.abs(mean(losses.map(o => o.rrAchieved!))) : 0;

  const expectancy = (winRate * avgWin) - (lossRate * avgLoss);

  const grossWins   = wins.reduce((s, o)  => s + o.rrAchieved!, 0);
  const grossLosses = Math.abs(losses.reduce((s, o) => s + o.rrAchieved!, 0));
  const profitFactor = grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? Infinity : 0;

  const allRR = outcomes.filter(o => o.rrAchieved != null).map(o => o.rrAchieved!);
  const avgRR = allRR.length > 0 ? mean(allRR) : 0;

  const maxDrawdown  = computeMaxDrawdown(allRR);
  const totalReturn  = allRR.reduce((s, r) => s + r, 0);
  const sharpeRatio  = computeSharpe(allRR, outcomes);

  const avgConfidence = mean(outcomes.map(o => o.confidence));

  const aiValidated    = outcomes.filter(o => o.aiValidated);
  const aiWins         = aiValidated.filter(o => o.outcome === 'TP_HIT');
  const nonAi          = outcomes.filter(o => !o.aiValidated);
  const nonAiWins      = nonAi.filter(o => o.outcome === 'TP_HIT');
  const aiValidatedWinRate = aiValidated.length > 0 ? aiWins.length / aiValidated.length : 0;
  const nonAiWinRate       = nonAi.length > 0 ? nonAiWins.length / nonAi.length : 0;

  return {
    totalSignals:        total,
    resolvedSignals:     resolved,
    pendingSignals:      total - resolved,
    tpHitRate:           resolved > 0 ? tpHits / resolved : 0,
    slHitRate:           resolved > 0 ? slHits / resolved : 0,
    timeoutRate:         resolved > 0 ? timeouts / resolved : 0,
    winRate:             round(winRate, 4),
    avgRRAchieved:       round(avgRR, 4),
    avgWin:              round(avgWin, 4),
    avgLoss:             round(avgLoss, 4),
    expectancy:          round(expectancy, 4),
    profitFactor:        round(profitFactor, 4),
    maxDrawdown:         round(maxDrawdown, 4),
    totalReturn:         round(totalReturn, 4),
    sharpeRatio:         round(sharpeRatio, 4),
    avgConfidence:       round(avgConfidence, 2),
    aiValidatedWinRate:  round(aiValidatedWinRate, 4),
    nonAiWinRate:        round(nonAiWinRate, 4),
  };
}

// ─── Breakdown by dimension ──────────────────────────────────────────────────

type Dimension = 'symbol' | 'timeframe' | 'scannerMode' | 'volatilityRegime';

export function computeBreakdown(
  outcomes: SignalOutcomeRecord[],
  dimension: Dimension,
): BreakdownMetrics[] {
  const groups = groupBy(outcomes, o => String(o[dimension]));
  const result: BreakdownMetrics[] = [];

  for (const [key, group] of Array.from(groups.entries())) {
    const resolved = group.filter((o: SignalOutcomeRecord) => o.outcome !== 'PENDING');
    if (resolved.length === 0) continue;

    const tpHits    = resolved.filter((o: SignalOutcomeRecord) => o.outcome === 'TP_HIT').length;
    const wins      = resolved.filter((o: SignalOutcomeRecord) => o.rrAchieved != null && o.rrAchieved > 0);
    const losses    = resolved.filter((o: SignalOutcomeRecord) => o.rrAchieved != null && o.rrAchieved <= 0);
    const allRR     = resolved.filter((o: SignalOutcomeRecord) => o.rrAchieved != null).map((o: SignalOutcomeRecord) => o.rrAchieved!);

    const winRate     = resolved.length > 0 ? tpHits / resolved.length : 0;
    const lossRate    = 1 - winRate;
    const avgWin      = wins.length  > 0 ? mean(wins.map((o: SignalOutcomeRecord) => o.rrAchieved!))           : 0;
    const avgLoss     = losses.length > 0 ? Math.abs(mean(losses.map((o: SignalOutcomeRecord) => o.rrAchieved!))) : 0;
    const grossWins   = wins.reduce((s: number, o: SignalOutcomeRecord)  => s + o.rrAchieved!, 0);
    const grossLosses = Math.abs(losses.reduce((s: number, o: SignalOutcomeRecord) => s + o.rrAchieved!, 0));

    result.push({
      key,
      label:          dimensionLabel(dimension, key),
      totalSignals:   group.length,
      resolvedSignals: resolved.length,
      winRate:        round(winRate, 4),
      avgRR:          round(allRR.length > 0 ? mean(allRR) : 0, 4),
      expectancy:     round((winRate * avgWin) - (lossRate * avgLoss), 4),
      profitFactor:   round(grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? 99 : 0, 4),
      tpHitRate:      round(winRate, 4),
      avgConfidence:  round(mean(group.map((o: SignalOutcomeRecord) => o.confidence)), 2),
    });
  }

  return result.sort((a, b) => b.expectancy - a.expectancy);
}

// ─── Setup patterns (best / worst) ───────────────────────────────────────────

const MIN_TRADES_FOR_PATTERN = 3;

export function computeSetupPatterns(
  outcomes: SignalOutcomeRecord[],
  order: 'best' | 'worst',
  topN = 8,
): SetupPattern[] {
  const groups = groupBy(
    outcomes,
    o => `${o.symbol}|${o.timeframe}|${o.scannerMode}|${o.signalType}`,
  );

  const patterns: SetupPattern[] = [];

  for (const [key, group] of Array.from(groups.entries())) {
    const resolved = group.filter((o: SignalOutcomeRecord) => o.outcome !== 'PENDING');
    if (resolved.length < MIN_TRADES_FOR_PATTERN) continue;

    const parts = key.split('|');
    const tpHits  = resolved.filter((o: SignalOutcomeRecord) => o.outcome === 'TP_HIT').length;
    const wins    = resolved.filter((o: SignalOutcomeRecord) => o.rrAchieved != null && o.rrAchieved > 0);
    const losses  = resolved.filter((o: SignalOutcomeRecord) => o.rrAchieved != null && o.rrAchieved <= 0);
    const allRR   = resolved.filter((o: SignalOutcomeRecord) => o.rrAchieved != null).map((o: SignalOutcomeRecord) => o.rrAchieved!);

    const winRate   = tpHits / resolved.length;
    const lossRate  = 1 - winRate;
    const avgWin    = wins.length  > 0 ? mean(wins.map((o: SignalOutcomeRecord) => o.rrAchieved!))            : 0;
    const avgLoss   = losses.length > 0 ? Math.abs(mean(losses.map((o: SignalOutcomeRecord) => o.rrAchieved!))) : 0;
    const grossWins   = wins.reduce((s: number, o: SignalOutcomeRecord)  => s + o.rrAchieved!, 0);
    const grossLosses = Math.abs(losses.reduce((s: number, o: SignalOutcomeRecord) => s + o.rrAchieved!, 0));

    const sorted       = [...group].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const lastSignalAt = sorted[0]?.createdAt;

    patterns.push({
      symbol:       parts[0],
      timeframe:    parts[1] as Timeframe,
      scannerMode:  parts[2] as ScannerMode,
      signalType:   parts[3] as SignalType,
      totalTrades:  resolved.length,
      winRate:      round(winRate, 4),
      avgRR:        round(allRR.length > 0 ? mean(allRR) : 0, 4),
      expectancy:   round((winRate * avgWin) - (lossRate * avgLoss), 4),
      profitFactor: round(grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? 99 : 0, 4),
      avgConfidence: round(mean(group.map((o: SignalOutcomeRecord) => o.confidence)), 2),
      lastSignalAt,
    });
  }

  const sorted = patterns.sort((a, b) =>
    order === 'best' ? b.expectancy - a.expectancy : a.expectancy - b.expectancy,
  );
  return sorted.slice(0, topN);
}

// ─── AI confidence vs actual outcome ─────────────────────────────────────────

const CONFIDENCE_BANDS = [
  { min: 70, max: 75, band: '70–75' },
  { min: 75, max: 80, band: '75–80' },
  { min: 80, max: 85, band: '80–85' },
  { min: 85, max: 90, band: '85–90' },
  { min: 90, max: 95, band: '90–95' },
  { min: 95, max: 101, band: '95–100' },
];

export function computeAIAccuracy(outcomes: SignalOutcomeRecord[]): AIAccuracyBucket[] {
  return CONFIDENCE_BANDS.map(({ min, max, band }) => {
    const group    = outcomes.filter(o => o.confidence >= min && o.confidence < max);
    const resolved = group.filter(o => o.outcome !== 'PENDING');
    const tpHits   = resolved.filter(o => o.outcome === 'TP_HIT').length;
    const allRR    = resolved.filter(o => o.rrAchieved != null).map(o => o.rrAchieved!);

    return {
      band,
      minConfidence:  min,
      maxConfidence:  max === 101 ? 100 : max,
      total:          group.length,
      winRate:        resolved.length > 0 ? round(tpHits / resolved.length, 4) : 0,
      avgRRAchieved:  allRR.length > 0 ? round(mean(allRR), 4) : 0,
      tpHitRate:      resolved.length > 0 ? round(tpHits / resolved.length, 4) : 0,
    };
  }).filter(b => b.total > 0);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function round(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

function groupBy<T>(items: T[], keyFn: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    const arr = map.get(key) ?? [];
    arr.push(item);
    map.set(key, arr);
  }
  return map;
}

function computeMaxDrawdown(rrSequence: number[]): number {
  if (rrSequence.length === 0) return 0;
  let equity = 0;
  let peak = 0;
  let maxDD = 0;
  for (const r of rrSequence) {
    equity += r;
    if (equity > peak) peak = equity;
    const dd = peak - equity;
    if (dd > maxDD) maxDD = dd;
  }
  return maxDD;
}

function computeSharpe(rrSequence: number[], outcomes: SignalOutcomeRecord[]): number {
  if (rrSequence.length < 2) return 0;
  const avg = mean(rrSequence);
  const variance = rrSequence.reduce((s, v) => s + Math.pow(v - avg, 2), 0) / (rrSequence.length - 1);
  const stdDev = Math.sqrt(variance);
  if (stdDev === 0) return 0;

  const avgDurationHours = mean(
    outcomes.filter(o => o.durationHours != null).map(o => o.durationHours!),
  ) || 24;
  const tradesPerYear = 8760 / avgDurationHours;
  return (avg / stdDev) * Math.sqrt(tradesPerYear);
}

function dimensionLabel(dimension: Dimension, key: string): string {
  if (dimension === 'scannerMode') {
    const labels: Record<string, string> = {
      spot:            'Spot',
      futures:         'Futures',
      high_confidence: 'High Conf.',
      trending:        'Trending',
    };
    return labels[key] ?? key;
  }
  if (dimension === 'volatilityRegime') {
    const labels: Record<string, string> = {
      LOW:     'Low Vol',
      NORMAL:  'Normal Vol',
      HIGH:    'High Vol',
      EXTREME: 'Extreme Vol',
    };
    return labels[key] ?? key;
  }
  return key;
}

function emptyMetrics(total: number, resolved: number, pending: number): PerformanceMetrics {
  return {
    totalSignals: total, resolvedSignals: resolved, pendingSignals: pending,
    tpHitRate: 0, slHitRate: 0, timeoutRate: 0,
    winRate: 0, avgRRAchieved: 0, avgWin: 0, avgLoss: 0,
    expectancy: 0, profitFactor: 0, maxDrawdown: 0, totalReturn: 0, sharpeRatio: 0,
    avgConfidence: 0, aiValidatedWinRate: 0, nonAiWinRate: 0,
  };
}
