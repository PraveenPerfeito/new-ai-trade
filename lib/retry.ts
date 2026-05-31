import { createLogger } from './logger';

const log = createLogger('lib/retry');

export interface RetryOptions {
  maxRetries?:  number;                        // default 3
  baseDelayMs?: number;                        // default 500ms
  maxDelayMs?:  number;                        // default 10 000ms
  retryOn?:     (err: unknown) => boolean;     // default: 5xx + network errors
  onRetry?:     (attempt: number, err: unknown, delayMs: number) => void;
}

function isRetryable(err: unknown): boolean {
  const status = (err as { response?: { status?: number } }).response?.status;
  if (status) return status >= 500 || status === 429;
  const msg = err instanceof Error ? err.message : '';
  return (
    msg.includes('ECONNRESET') ||
    msg.includes('ETIMEDOUT')  ||
    msg.includes('ENOTFOUND')  ||
    msg.includes('ECONNREFUSED') ||
    msg.includes('timeout')
  );
}

function withJitter(ms: number): number {
  return ms * (0.75 + Math.random() * 0.5); // ±25% jitter
}

function sleep(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms));
}

export async function withRetry<T>(
  fn:       () => Promise<T>,
  options:  RetryOptions = {},
): Promise<T> {
  const {
    maxRetries  = 3,
    baseDelayMs = 500,
    maxDelayMs  = 10_000,
    retryOn     = isRetryable,
    onRetry,
  } = options;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isLast = attempt === maxRetries;
      if (isLast || !retryOn(err)) throw err;

      const delay = Math.round(
        withJitter(Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs)),
      );
      onRetry?.(attempt + 1, err, delay);
      await sleep(delay);
    }
  }

  // Unreachable — loop always throws or returns before this
  throw new Error('withRetry: exhausted retries');
}

// Convenience wrapper for Axios calls with standard retry config
export function withApiRetry<T>(
  fn:       () => Promise<T>,
  label?:   string,
): Promise<T> {
  return withRetry(fn, {
    maxRetries:  3,
    baseDelayMs: 600,
    maxDelayMs:  8_000,
    onRetry: (attempt, err, delayMs) => {
      const status = (err as { response?: { status?: number } }).response?.status ?? 'network';
      log.warn({ label: label ?? 'api', attempt, delayMs, status }, 'api retry');
    },
  });
}
