/**
 * ScanScheduler — singleton that owns the global scan lock and runs scheduled scans.
 *
 * Responsibilities:
 *   • Single mutex lock prevents any two scans from overlapping (API vs scheduler)
 *   • Fixed-interval ticker (default 5 min) — uses setInterval so the wall-clock
 *     cadence stays stable even if a scan takes a long time
 *   • Queue: if a tick fires while a scan is running, buffer ONE pending run;
 *     any further ticks are skipped until the queue drains
 *   • Rate limit: max MAX_HOURLY scans per rolling 60-min window
 *   • Gap guard: hard floor of MIN_GAP_MS between scan starts
 *   • Retry on failure: exponential back-off (30 s → 60 s → 120 s),
 *     then 10-min pause after PAUSE_AFTER_N consecutive failures
 *   • History: last MAX_HISTORY entries kept in memory
 *
 * The singleton is stored on globalThis so it survives Next.js HMR reloads.
 */

import { runScan } from './scanner';
import { ScannerMode, ScanResult } from '@/types';
import { runStartupCheck } from './startup-check';
import { startIntelligenceWorkers, preloadIntelligence } from './intelligence';

// ─── Constants ───────────────────────────────────────────────────────────────

const MAX_HISTORY    = 50;
const MAX_HOURLY     = 20;
const MIN_GAP_MS     = 2 * 60_000;        // 2 min
const RETRY_DELAYS   = [30_000, 60_000, 120_000];
const PAUSE_AFTER_N  = 3;
const PAUSE_DURATION = 10 * 60_000;       // 10 min

// ─── Types ───────────────────────────────────────────────────────────────────

export type ScanTrigger = 'manual' | 'scheduler' | 'retry';

export interface ScanHistoryEntry {
  id:               string;
  mode:             ScannerMode;
  triggeredBy:      ScanTrigger;
  status:           'running' | 'completed' | 'failed';
  startedAt:        string;   // ISO
  completedAt?:     string;
  durationMs?:      number;
  coinsScanned?:    number;
  signalsFound?:    number;
  highConfSignals?: number;
  error?:           string;
  retryCount:       number;
}

export interface SchedulerConfig {
  mode:       ScannerMode;
  intervalMs: number;
}

export interface SchedulerStatus {
  started:             boolean;
  scanning:            boolean;
  lockOwner:           string | null;
  nextScanAt:          string | null;
  lastScanAt:          string | null;
  consecutiveFailures: number;
  pausedUntil:         string | null;
  queuedMode:          ScannerMode | null;
  scansThisHour:       number;
  history:             ScanHistoryEntry[];
  config:              SchedulerConfig;
}

export type RateLimitCheck =
  | { ok: true }
  | { ok: false; reason: string; retryAfterMs: number };

// ─── Scheduler class ─────────────────────────────────────────────────────────

class ScanScheduler {
  // Scan mutex
  private _locked      = false;
  private _lockOwner:   string | null = null;

  // Scheduler state
  private _started     = false;
  private _tickerId:    ReturnType<typeof setInterval> | null = null;
  private _nextScanAt:  Date | null = null;

  // Queue (max 1)
  private _queuedMode:  ScannerMode | null = null;

  // Stats
  private _lastScanAt:           Date | null = null;
  private _consecutiveFailures   = 0;
  private _pausedUntil:          Date | null = null;
  private _recentScanTimes:      number[] = [];
  private _history:              ScanHistoryEntry[] = [];

  // Config
  private _config: SchedulerConfig = {
    mode:       'spot',
    intervalMs: 5 * 60_000,
  };

  // ── Lock API (used by both scheduler and /api/scanner/run) ─────────────

  tryAcquireLock(owner: string): boolean {
    if (this._locked) return false;
    this._locked    = true;
    this._lockOwner = owner;
    return true;
  }

  releaseLock(): void {
    this._locked    = false;
    this._lockOwner = null;
  }

  get isLocked(): boolean { return this._locked; }

  // ── Rate-limit + gap check ─────────────────────────────────────────────

  checkCanRun(bypass = false): RateLimitCheck {
    const now = Date.now();

    // Prune timestamps older than 1 hour
    this._recentScanTimes = this._recentScanTimes.filter(t => now - t < 60 * 60_000);

    if (!bypass && this._recentScanTimes.length >= MAX_HOURLY) {
      const oldestInWindow = this._recentScanTimes[0];
      const retryAfterMs   = 60 * 60_000 - (now - oldestInWindow);
      return {
        ok: false,
        reason:       `Rate limit: ${MAX_HOURLY} scans/hr reached`,
        retryAfterMs: Math.max(0, retryAfterMs),
      };
    }

    if (!bypass && this._lastScanAt) {
      const elapsed = now - this._lastScanAt.getTime();
      if (elapsed < MIN_GAP_MS) {
        return {
          ok: false,
          reason:       `Gap protection: wait ${Math.ceil((MIN_GAP_MS - elapsed) / 1000)}s`,
          retryAfterMs: MIN_GAP_MS - elapsed,
        };
      }
    }

    return { ok: true };
  }

  // ── History helpers ────────────────────────────────────────────────────

  beginScan(mode: ScannerMode, triggeredBy: ScanTrigger, retryCount = 0): string {
    const id    = `scan_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const entry: ScanHistoryEntry = {
      id,
      mode,
      triggeredBy,
      status:     'running',
      startedAt:  new Date().toISOString(),
      retryCount,
    };
    this._history.unshift(entry);
    if (this._history.length > MAX_HISTORY) this._history.length = MAX_HISTORY;
    this._recentScanTimes.push(Date.now());
    return id;
  }

  completeScan(id: string, result: ScanResult): void {
    this._lastScanAt          = new Date();
    this._consecutiveFailures = 0;
    this._pausedUntil         = null;
    this._patchEntry(id, {
      status:          'completed',
      completedAt:     new Date().toISOString(),
      durationMs:      result.duration,
      coinsScanned:    result.coinsScanned,
      signalsFound:    result.signals.length,
      highConfSignals: result.signals.filter(s => s.confidence >= 85).length,
    });
  }

  failScan(id: string, err: unknown, mode: ScannerMode, retryCount: number, autoRetry = true): void {
    const msg = err instanceof Error ? err.message : String(err);
    this._consecutiveFailures++;
    this._patchEntry(id, {
      status:      'failed',
      completedAt: new Date().toISOString(),
      error:       msg,
    });

    if (!autoRetry) return; // manual API calls — just record, don't retry

    if (this._consecutiveFailures >= PAUSE_AFTER_N) {
      this._pausedUntil = new Date(Date.now() + PAUSE_DURATION);
      console.warn(
        `[Scheduler] ${PAUSE_AFTER_N} consecutive failures — pausing until ${this._pausedUntil.toISOString()}`,
      );
    } else {
      const delay = RETRY_DELAYS[Math.min(retryCount, RETRY_DELAYS.length - 1)];
      console.log(`[Scheduler] Retrying mode:${mode} in ${delay / 1000}s (attempt ${retryCount + 1})`);
      setTimeout(() => void this._doScan(mode, 'retry', retryCount + 1), delay);
    }
  }

  private _patchEntry(id: string, patch: Partial<ScanHistoryEntry>): void {
    const idx = this._history.findIndex(e => e.id === id);
    if (idx >= 0) Object.assign(this._history[idx], patch);
  }

  // ── Core scan execution ────────────────────────────────────────────────

  private async _doScan(mode: ScannerMode, triggeredBy: ScanTrigger, retryCount = 0): Promise<void> {
    // Check pause
    if (this._pausedUntil && Date.now() < this._pausedUntil.getTime()) {
      console.log(`[Scheduler] Paused until ${this._pausedUntil.toISOString()}`);
      return;
    }

    // Skip rate-limit + gap for retries (already charged)
    if (triggeredBy !== 'retry') {
      const check = this.checkCanRun();
      if (!check.ok) {
        console.warn('[Scheduler] Tick skipped:', check.reason);
        return;
      }
    }

    // Acquire lock — if busy, queue once and bail
    if (!this.tryAcquireLock(triggeredBy)) {
      if (triggeredBy === 'scheduler' && !this._queuedMode) {
        this._queuedMode = mode;
        console.log('[Scheduler] Lock held, queued mode:', mode);
      }
      return;
    }

    const id = this.beginScan(mode, triggeredBy, retryCount);
    console.log(`[Scheduler] Scan start — mode:${mode} trigger:${triggeredBy} retry:${retryCount}`);

    try {
      // Warm intelligence cache before scan so scanner reads fresh data
      await preloadIntelligence().catch((err) =>
        console.warn('[Scheduler] Intelligence preload failed (non-fatal):', err),
      );

      const result = await runScan(mode);
      this.completeScan(id, result);
      console.log(
        `[Scheduler] Scan done — ${result.coinsScanned} coins, ` +
        `${result.signals.length} signals, ${result.duration}ms`,
      );
    } catch (err) {
      console.error(`[Scheduler] Scan failed (consec #${this._consecutiveFailures + 1}):`, err);
      this.failScan(id, err, mode, retryCount);
    } finally {
      this.releaseLock();

      // Drain queue
      if (this._queuedMode) {
        const queued     = this._queuedMode;
        this._queuedMode = null;
        console.log('[Scheduler] Draining queue, mode:', queued);
        setTimeout(() => void this._doScan(queued, 'scheduler'), 2_000);
      }
    }
  }

  // ── Scheduler start / stop ─────────────────────────────────────────────

  start(config?: Partial<SchedulerConfig>): void {
    if (config) Object.assign(this._config, config);

    if (this._started) {
      // Config updated on running scheduler — reschedule if interval changed
      if (config?.intervalMs !== undefined) this._reschedule();
      return;
    }

    this._started = true;
    this._reschedule();
    console.log(
      `[Scheduler] Started — mode:${this._config.mode} interval:${this._config.intervalMs / 1000}s`,
    );
  }

  stop(): void {
    if (this._tickerId) {
      clearInterval(this._tickerId);
      this._tickerId = null;
    }
    this._started    = false;
    this._nextScanAt = null;
    this._queuedMode = null;
    console.log('[Scheduler] Stopped');
  }

  private _reschedule(): void {
    if (this._tickerId) clearInterval(this._tickerId);
    this._nextScanAt = new Date(Date.now() + this._config.intervalMs);
    this._tickerId   = setInterval(() => {
      this._nextScanAt = new Date(Date.now() + this._config.intervalMs);
      void this._doScan(this._config.mode, 'scheduler');
    }, this._config.intervalMs);
  }

  // ── Manual trigger (from dashboard run button) ─────────────────────────

  async triggerManual(mode: ScannerMode): Promise<
    | { ok: true;  scanId: string }
    | { ok: false; reason: string; locked?: boolean; retryAfterMs?: number }
  > {
    if (this.isLocked) {
      return { ok: false, reason: 'Scan already in progress', locked: true };
    }
    const rateCheck = this.checkCanRun();
    if (!rateCheck.ok) {
      return { ok: false, reason: rateCheck.reason, retryAfterMs: rateCheck.retryAfterMs };
    }

    // Acquire lock, begin history entry, then run async (don't await — API waits separately)
    if (!this.tryAcquireLock('api')) {
      return { ok: false, reason: 'Lock acquired concurrently', locked: true };
    }
    const id = this.beginScan(mode, 'manual');
    this.releaseLock(); // release; the caller (run route) holds its own execution flow

    return { ok: true, scanId: id };
  }

  // ── Status ─────────────────────────────────────────────────────────────

  getStatus(): SchedulerStatus {
    const now = Date.now();
    this._recentScanTimes = this._recentScanTimes.filter(t => now - t < 60 * 60_000);

    return {
      started:             this._started,
      scanning:            this._locked,
      lockOwner:           this._lockOwner,
      nextScanAt:          this._nextScanAt?.toISOString() ?? null,
      lastScanAt:          this._lastScanAt?.toISOString() ?? null,
      consecutiveFailures: this._consecutiveFailures,
      pausedUntil:         this._pausedUntil?.toISOString() ?? null,
      queuedMode:          this._queuedMode,
      scansThisHour:       this._recentScanTimes.length,
      history:             this._history,
      config:              { ...this._config },
    };
  }
}

// ─── Singleton (survives Next.js HMR) ────────────────────────────────────────

const g = globalThis as typeof globalThis & { __market_scanner_sched?: ScanScheduler };
if (!g.__market_scanner_sched) {
  // Validate required environment before the scheduler starts accepting work.
  // Throws in production if ADMIN_EMAILS, ADMIN_SECRET, etc. are missing.
  runStartupCheck();
  g.__market_scanner_sched = new ScanScheduler();

  // Start background intelligence cache refresh workers (HMR-safe via globalThis registry)
  startIntelligenceWorkers();
}

export const scheduler = g.__market_scanner_sched;
