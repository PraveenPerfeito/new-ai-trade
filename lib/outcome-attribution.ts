import {
  AttributionRow,
  AttributionDimension,
  EdgePattern,
  ThresholdRecommendation,
  AttributionReport,
} from '@/types';

const MIN_SAMPLE = 5;

// ─── Core stats ───────────────────────────────────────────────────────────────

function mean(nums: number[]): number {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}

interface GroupStats {
  total:         number;
  winRate:       number | null;
  avgRRAchieved: number | null;
  expectancy:    number | null;
  tpHitRate:     number | null;
  avgConfidence: number;
}

function groupStats(rows: AttributionRow[]): GroupStats {
  const total = rows.length;
  const avgConfidence = mean(rows.map(r => r.confidence));
  if (total < MIN_SAMPLE) {
    return { total, winRate: null, avgRRAchieved: null, expectancy: null, tpHitRate: null, avgConfidence };
  }
  const wins   = rows.filter(r => r.outcome === 'TP_HIT');
  const losses = rows.filter(r => r.outcome === 'SL_HIT');
  const winRate  = wins.length / total;
  const lossRate = losses.length / total;
  const rrVals = rows.filter(r => r.rrAchieved != null).map(r => r.rrAchieved!);
  const avgRRAchieved = rrVals.length ? mean(rrVals) : null;
  const avgWinRR  = wins.length   ? mean(wins.map(r => r.rrAchieved ?? r.rrRatio)) : 0;
  const avgLossRR = losses.length ? Math.abs(mean(losses.map(r => r.rrAchieved ?? -1))) : 1;
  return {
    total,
    winRate,
    avgRRAchieved,
    expectancy: winRate * avgWinRR - lossRate * avgLossRR,
    tpHitRate:  winRate,
    avgConfidence,
  };
}

// ─── Dimension breakdown ──────────────────────────────────────────────────────

function byDim<K extends string>(
  rows: AttributionRow[],
  getKey: (r: AttributionRow) => K | undefined,
  labelOf: (k: K) => string,
): AttributionDimension[] {
  const groups = new Map<K, AttributionRow[]>();
  for (const r of rows) {
    const k = getKey(r);
    if (k == null) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(r);
  }
  return Array.from(groups.entries())
    .map(([key, group]) => ({ key, label: labelOf(key), ...groupStats(group) }))
    .sort((a, b) => b.total - a.total);
}

// ─── Edge patterns ────────────────────────────────────────────────────────────

function topPatterns(rows: AttributionRow[]): EdgePattern[] {
  const map = new Map<string, AttributionRow[]>();
  for (const r of rows) {
    if (!r.marketRegime || !r.signalState) continue;
    const k = `${r.marketRegime}|${r.signalState}`;
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(r);
  }
  const result: EdgePattern[] = [];
  for (const [k, group] of Array.from(map.entries())) {
    if (group.length < MIN_SAMPLE) continue;
    const s = groupStats(group);
    if (s.winRate == null || s.expectancy == null) continue;
    const [regime, signalState] = k.split('|');
    result.push({
      dimensions: { regime, signalState },
      label: `${regime} + ${signalState}`,
      total: group.length,
      winRate: s.winRate,
      avgRRAchieved: s.avgRRAchieved,
      expectancy: s.expectancy,
      rank: 0,
    });
  }
  result.sort((a, b) => b.expectancy - a.expectancy);
  result.forEach((p, i) => { p.rank = i + 1; });
  return result.slice(0, 8);
}

// ─── Threshold recommendations ────────────────────────────────────────────────

function p(n: number): string { return `${(n * 100).toFixed(1)}%`; }

function recommendations(
  rows: AttributionRow[],
  byRegime: AttributionDimension[],
  bySignalState: AttributionDimension[],
  byExtensionRisk: AttributionDimension[],
  ai: AttributionReport['aiEffectiveness'],
): ThresholdRecommendation[] {
  const recs: ThresholdRecommendation[] = [];

  // 1. SIDEWAYS underperformance vs BULL_TREND
  const bull = byRegime.find(d => d.key === 'BULL_TREND');
  const side = byRegime.find(d => d.key === 'SIDEWAYS');
  if (bull?.winRate != null && side?.winRate != null && side.total >= MIN_SAMPLE && side.winRate < bull.winRate - 0.12) {
    recs.push({
      parameter: 'SIDEWAYS regime minimum thresholds',
      insight: `SIDEWAYS win rate ${p(side.winRate)} trails BULL_TREND ${p(bull.winRate)} — adaptive minimums may need tightening`,
      direction: 'RAISE',
      impact: 'HIGH',
      basis: `${side.total} SIDEWAYS signals`,
    });
  }

  // 2. DEVELOPING signal state underperformance
  const dev  = bySignalState.find(d => d.key === 'DEVELOPING');
  const conf = bySignalState.find(d => d.key === 'CONFIRMED');
  if (dev?.winRate != null && dev.total >= MIN_SAMPLE && dev.winRate < 0.45) {
    recs.push({
      parameter: 'DEVELOPING signal state filter',
      insight: `DEVELOPING signals win at ${p(dev.winRate)}${conf?.winRate ? ` vs CONFIRMED ${p(conf.winRate)}` : ''} — consider requiring CONFIRMED or higher`,
      direction: 'RAISE',
      impact: 'MEDIUM',
      basis: `${dev.total} DEVELOPING signals`,
    });
  }

  // 3. HIGH extension risk validation (mid-cap caution flag)
  const highExt = byExtensionRisk.find(d => d.key === 'HIGH');
  if (highExt?.winRate != null && highExt.total >= MIN_SAMPLE && highExt.winRate < 0.40) {
    recs.push({
      parameter: 'HIGH extension risk (mid-cap caution flag)',
      insight: `HIGH extension risk signals win at ${p(highExt.winRate)} — caution flag may be insufficient, consider reverting to hard reject`,
      direction: 'RAISE',
      impact: 'HIGH',
      basis: `${highExt.total} high-extension signals`,
    });
  }

  // 4. AI effectiveness delta
  if (ai.aiEdgeDelta != null && ai.aiApproved.total >= MIN_SAMPLE) {
    if (ai.aiEdgeDelta > 0.10) {
      recs.push({
        parameter: 'AI validation coverage',
        insight: `AI-approved signals outperform heuristic by ${p(ai.aiEdgeDelta)} — increase AI validation coverage or raise AI confidence threshold`,
        direction: 'MONITOR',
        impact: 'HIGH',
        basis: `${ai.aiApproved.total} AI vs ${ai.heuristic.total} heuristic signals`,
      });
    } else if (ai.aiEdgeDelta < -0.05) {
      recs.push({
        parameter: 'AI validation effectiveness',
        insight: `Heuristic signals outperform AI-approved by ${p(-ai.aiEdgeDelta)} — review AI prompt calibration or fallback threshold`,
        direction: 'LOWER',
        impact: 'MEDIUM',
        basis: `${ai.aiApproved.total} AI vs ${ai.heuristic.total} heuristic signals`,
      });
    }
  }

  // 5. Bear regime guard
  const bear = byRegime.find(d => d.key === 'BEAR_TREND');
  if (bear?.winRate != null && bear.total >= MIN_SAMPLE && bear.winRate < 0.35) {
    recs.push({
      parameter: 'BEAR_TREND signal quality',
      insight: `BEAR_TREND signals win at only ${p(bear.winRate)} — consider suppressing signals in bear regime or requiring higher confidence`,
      direction: 'RAISE',
      impact: 'HIGH',
      basis: `${bear.total} bear regime signals`,
    });
  }

  // Fallback: no issues
  if (recs.length === 0) {
    const totalResolved = rows.length;
    recs.push({
      parameter: 'All monitored parameters',
      insight: 'No significant deviations detected — system performing within expected bounds',
      direction: 'MONITOR',
      impact: 'LOW',
      basis: `${totalResolved} resolved signals`,
    });
  }

  return recs;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function computeAttribution(rows: AttributionRow[], windowHours = 720): AttributionReport {
  const resolvedRows = rows.length;

  const withTactical = rows.filter(r => r.marketRegime != null);
  const dataGap = resolvedRows > 0 && withTactical.length < resolvedRows * 0.3;

  // Use only rows with tactical fields for tactical dimensions; use all rows for AI/timeframe/mode
  const tactRows = dataGap ? withTactical : rows;

  const regimeLabels: Record<string, string> = {
    BULL_TREND: 'Bull Trend', BEAR_TREND: 'Bear Trend', SIDEWAYS: 'Sideways',
    HIGH_VOLATILITY: 'High Vol', EUPHORIA: 'Euphoria', CAPITULATION: 'Capitulation',
  };
  const mcapLabels:  Record<string, string> = { mega: 'Mega Cap', large: 'Large Cap', mid: 'Mid Cap', small: 'Small Cap' };
  const stateLabels: Record<string, string> = {
    CONFIRMED: 'Confirmed', DEVELOPING: 'Developing', EXTENDED: 'Extended',
    COOLING: 'Cooling', CORRECTING: 'Correcting', INVALIDATED: 'Invalidated', EXPIRED: 'Expired',
  };
  const extLabels:  Record<string, string> = { LOW: 'Low', MODERATE: 'Moderate', HIGH: 'High' };
  const tfLabels:   Record<string, string> = { '15m': '15m', '1h': '1h', '4h': '4h', '1d': '1d' };
  const modeLabels: Record<string, string> = { spot: 'Spot', futures: 'Futures', high_confidence: 'High Conf', trending: 'Trending' };

  const byRegime        = byDim(tactRows, r => r.marketRegime,  k => regimeLabels[k] ?? k);
  const byMcapTier      = byDim(tactRows, r => r.mcapTier,      k => mcapLabels[k]   ?? k);
  const bySignalState   = byDim(tactRows, r => r.signalState,   k => stateLabels[k]  ?? k);
  const byExtensionRisk = byDim(tactRows, r => r.extensionRisk, k => extLabels[k]    ?? k);
  const bySector        = byDim(tactRows, r => r.sectorName,    k => k);
  const byAiValidated   = byDim(rows, r => (r.aiValidated ? 'ai' : 'heuristic') as 'ai' | 'heuristic', k => k === 'ai' ? 'AI Validated' : 'Heuristic');
  const byTimeframe     = byDim(rows, r => r.timeframe,         k => tfLabels[k]     ?? k);
  const byScannerMode   = byDim(rows, r => r.scannerMode,       k => modeLabels[k]   ?? k);
  const byGrade         = byDim(rows, r => r.riskGrade,         k => `Grade ${k}`);

  const edgePatterns = topPatterns(tactRows);

  const aiRows   = rows.filter(r => r.aiValidated);
  const heurRows = rows.filter(r => !r.aiValidated);
  const aiSt   = groupStats(aiRows);
  const heurSt = groupStats(heurRows);
  const aiEffectiveness: AttributionReport['aiEffectiveness'] = {
    aiApproved:  { total: aiRows.length,   winRate: aiSt.winRate,   expectancy: aiSt.expectancy },
    heuristic:   { total: heurRows.length, winRate: heurSt.winRate, expectancy: heurSt.expectancy },
    aiEdgeDelta: aiSt.winRate != null && heurSt.winRate != null ? aiSt.winRate - heurSt.winRate : null,
  };

  const recs = recommendations(rows, byRegime, bySignalState, byExtensionRisk, aiEffectiveness);

  return {
    generatedAt:  new Date(),
    windowHours,
    totalRows:    rows.length,
    resolvedRows,
    dataGap,
    insufficient: resolvedRows < 20,
    dimensions: { byRegime, byMcapTier, bySignalState, byExtensionRisk, bySector, byAiValidated, byTimeframe, byScannerMode, byGrade },
    edgePatterns,
    recommendations: recs,
    aiEffectiveness,
  };
}
