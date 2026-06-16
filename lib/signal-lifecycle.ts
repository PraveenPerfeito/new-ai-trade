import { TradingSignal, SignalLifecycleStage, Timeframe } from '@/types';

// ─── Timeframe lifetime windows ───────────────────────────────────────────────
// After this many ms past signal creation, a sent signal is considered STALE.
const LIFETIME_MS: Record<Timeframe, number> = {
  '15m': 2  * 3_600_000,  //  2 hours
  '1h':  8  * 3_600_000,  //  8 hours
  '4h':  24 * 3_600_000,  // 24 hours
  '1d':  72 * 3_600_000,  // 72 hours
};

// ─── Lifecycle computation ────────────────────────────────────────────────────

/**
 * Derives the canonical lifecycle stage for a signal.
 * Pass `outcome` if you have it from signal_outcomes; omit for DB-only signals.
 */
export function computeLifecycleStage(
  signal: TradingSignal,
  outcome?: 'PENDING' | 'TP_HIT' | 'SL_HIT' | 'TIMEOUT',
): SignalLifecycleStage {
  if (outcome === 'TP_HIT')  return 'TP_HIT';
  if (outcome === 'SL_HIT')  return 'SL_HIT';
  if (outcome === 'TIMEOUT') return 'CLOSED';

  if (signal.telegramSent) {
    const lifetime = LIFETIME_MS[signal.timeframe] ?? 8 * 3_600_000;
    const created  = signal.createdAt instanceof Date ? signal.createdAt : new Date(signal.createdAt as unknown as string);
    const ageMs    = Date.now() - created.getTime();
    if (ageMs > lifetime) return 'STALE';
    // First 30 min after send: TELEGRAM_SENT badge (freshly fired alert)
    if (ageMs < 30 * 60 * 1000) return 'TELEGRAM_SENT';
    return 'ACTIVE';
  }

  if (signal.aiValidated) {
    return signal.validationSource === 'HEURISTIC' ? 'SCREENED' : 'AI_APPROVED';
  }
  return 'VALIDATED';
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns true if the stage represents an open / actionable signal. */
export function isActiveStage(stage: SignalLifecycleStage): boolean {
  return stage === 'ACTIVE' || stage === 'AI_APPROVED' || stage === 'SCREENED' || stage === 'TELEGRAM_SENT';
}

/** Returns true if the signal has reached a terminal outcome. */
export function isTerminalStage(stage: SignalLifecycleStage): boolean {
  return stage === 'TP_HIT' || stage === 'SL_HIT' || stage === 'CLOSED' || stage === 'ANALYZED';
}
