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
    return ageMs < lifetime ? 'ACTIVE' : 'STALE';
  }

  if (signal.aiValidated && signal.validationSource !== 'HEURISTIC') return 'AI_APPROVED';
  return 'VALIDATED';
}

// ─── Display configuration ────────────────────────────────────────────────────

export interface LifecycleConfig {
  label:  string;
  /** Tailwind text-color class */
  color:  string;
  /** Tailwind border/bg badge classes */
  badge:  string;
  order:  number;
}

export const LIFECYCLE_CONFIG: Record<SignalLifecycleStage, LifecycleConfig> = {
  VALIDATED:     { label: 'Validated',     color: 'text-terminal-muted',  badge: 'text-terminal-muted border-terminal-border bg-transparent',               order: 1 },
  AI_APPROVED:   { label: 'Approved',      color: 'text-purple-400',      badge: 'text-purple-400 border-purple-500/30 bg-purple-500/5',                    order: 2 },
  TELEGRAM_SENT: { label: 'Telegram Sent', color: 'text-signal-high',     badge: 'text-signal-high border-signal-high/30 bg-signal-high/5',                 order: 3 },
  ACTIVE:        { label: 'Active',        color: 'text-bull-default',    badge: 'text-bull-default border-bull-default/30 bg-bull-default/5',               order: 4 },
  STALE:         { label: 'Stale',         color: 'text-terminal-muted/60', badge: 'text-terminal-muted border-terminal-border bg-transparent',             order: 5 },
  TP_HIT:        { label: 'TP Hit',        color: 'text-bull-default',    badge: 'text-bull-default border-bull-default/40 bg-bull-default/8 font-bold',     order: 6 },
  SL_HIT:        { label: 'SL Hit',        color: 'text-bear-default',    badge: 'text-bear-default border-bear-default/40 bg-bear-default/8 font-bold',     order: 7 },
  CLOSED:        { label: 'Closed',        color: 'text-terminal-muted',  badge: 'text-terminal-muted border-terminal-border bg-transparent',               order: 8 },
  ANALYZED:      { label: 'Analyzed',      color: 'text-terminal-muted',  badge: 'text-terminal-muted border-terminal-border bg-transparent',               order: 9 },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns true if the stage represents an open / actionable signal. */
export function isActiveStage(stage: SignalLifecycleStage): boolean {
  return stage === 'ACTIVE' || stage === 'AI_APPROVED' || stage === 'TELEGRAM_SENT';
}

/** Returns true if the signal has reached a terminal outcome. */
export function isTerminalStage(stage: SignalLifecycleStage): boolean {
  return stage === 'TP_HIT' || stage === 'SL_HIT' || stage === 'CLOSED' || stage === 'ANALYZED';
}
