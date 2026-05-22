import { RejectionEntry, RejectionStage, RejectionStats } from '@/types';
import { createLogger } from './logger';

const log = createLogger('lib/rejection-tracker');

interface TrackerStore {
  entries:       RejectionEntry[];
  scanRunId?:    string;
  scannedAt:     number;
  totalScanned:  number;
  totalAccepted: number;
}

// globalThis key survives Next.js hot-module replacement
const STORE_KEY = '__rejectionTracker';
const g = globalThis as Record<string, unknown>;

function store(): TrackerStore {
  if (!g[STORE_KEY]) {
    g[STORE_KEY] = {
      entries: [], scannedAt: Date.now(), totalScanned: 0, totalAccepted: 0,
    } satisfies TrackerStore;
  }
  return g[STORE_KEY] as TrackerStore;
}

/** Call once at the start of each scan run to reset the store. */
export function startTracking(scanRunId?: string | null): void {
  g[STORE_KEY] = {
    entries:      [],
    scanRunId:    scanRunId ?? undefined,
    scannedAt:    Date.now(),
    totalScanned: 0,
    totalAccepted: 0,
  } satisfies TrackerStore;
  log.info({ scanRunId }, 'rejection tracking started');
}

/** Increment scanned count — call before each scanCoin attempt. */
export function trackCoinStart(): void {
  store().totalScanned++;
}

/** Increment accepted count — call when a signal passes all gates. */
export function trackAccepted(): void {
  store().totalAccepted++;
}

/**
 * Record a rejection.
 * `isNearMiss: true` = failed by a small margin (within ~15% of threshold).
 * Only call this immediately before `return null` — one entry per coin.
 */
export function trackRejection(entry: Omit<RejectionEntry, 'ts' | 'scanRunId'>): void {
  const s = store();
  s.entries.push({ ...entry, ts: Date.now(), scanRunId: s.scanRunId });
}

/** Returns a snapshot of the current scan's rejection stats. */
export function getRejectionStats(): RejectionStats {
  const s = store();
  const totalRejected = s.entries.length;

  const byStage: Partial<Record<RejectionStage, number>> = {};
  for (const e of s.entries) {
    byStage[e.stage] = (byStage[e.stage] ?? 0) + 1;
  }

  const nearMisses = s.entries.filter(e => e.isNearMiss).slice(0, 20);

  const topReasons = (Object.entries(byStage) as [RejectionStage, number][])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([stage, count]) => ({
      stage,
      count,
      pct: totalRejected > 0 ? Math.round((count / totalRejected) * 100) : 0,
    }));

  return {
    totalScanned:  s.totalScanned,
    totalAccepted: s.totalAccepted,
    totalRejected,
    byStage,
    nearMisses,
    topReasons,
    scanRunId: s.scanRunId,
    scannedAt: s.scannedAt,
  };
}
