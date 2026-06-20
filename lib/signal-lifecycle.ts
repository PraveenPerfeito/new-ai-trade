import { TradingSignal, SignalLifecycleStage, Timeframe } from '@/types';

// ─── Timeframe lifetime windows ───────────────────────────────────────────────
// After this many ms past estimated send time, a signal is considered STALE.
// D-04: STALE is measured from approx send time = createdAt + SEND_OFFSET_MS
// so signals don't go STALE early when Telegram queue has latency.
const LIFETIME_MS: Partial<Record<Timeframe, number>> = {
  '1h':  8  * 3_600_000,  //  8 hours
  '4h':  24 * 3_600_000,  // 24 hours
  '1d':  72 * 3_600_000,  // 72 hours
};
// Approximate queue latency budget — STALE threshold extends by this much
const SEND_OFFSET_MS = 30 * 60 * 1000; // 30 min (TELEGRAM_SENT window)

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
    // First 30 min after creation: TELEGRAM_SENT badge (freshly fired alert)
    if (ageMs < SEND_OFFSET_MS) return 'TELEGRAM_SENT';
    // D-04: measure STALE from approx send time (createdAt + SEND_OFFSET_MS)
    if (ageMs > lifetime + SEND_OFFSET_MS) return 'STALE';
    return 'ACTIVE';
  }

  if (signal.aiValidated) {
    // Treat null/undefined as HEURISTIC — pre-migration rows default to SCREENED
    // to avoid falsely badging AI-off signals as AI_APPROVED.
    return (!signal.validationSource || signal.validationSource === 'HEURISTIC')
      ? 'SCREENED'
      : 'AI_APPROVED';
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
