import { getSpotKlines, getFuturesKlines } from './binance';
import { backfillOutcomeRecords, getPendingOutcomes, updateOutcome, OutcomeResolution } from './analytics-db';
import { createLogger } from './logger';
import { SignalOutcomeRecord } from '@/types';

const log = createLogger('lib/outcome-tracker');

// Signals older than this with no resolution are timed out
const TIMEOUT_HOURS = 72;

// How many candles to fetch per check (covers up to ~8 days at 1h)
const CANDLE_LIMIT = 200;

export interface TrackerRunResult {
  backfilled: number;
  checked: number;
  resolved: number;
  tpHits: number;
  slHits: number;
  timeouts: number;
  stillPending: number;
  errors: number;
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function runOutcomeTracker(batchSize = 40): Promise<TrackerRunResult> {
  const result: TrackerRunResult = {
    backfilled: 0,
    checked: 0,
    resolved: 0,
    tpHits: 0,
    slHits: 0,
    timeouts: 0,
    stillPending: 0,
    errors: 0,
  };

  // Step 1: ensure all existing signals have an outcome record
  try {
    result.backfilled = await backfillOutcomeRecords();
    if (result.backfilled > 0) {
      log.info({ count: result.backfilled }, 'backfilled outcome records');
    }
  } catch (err) {
    log.error({ err }, 'backfill failed');
  }

  // Step 2: fetch pending outcomes and resolve them
  const pending = await getPendingOutcomes(batchSize);
  log.info({ count: pending.length }, 'checking pending outcomes');

  for (const record of pending) {
    result.checked++;
    try {
      const resolution = await resolveOutcome(record);
      if (resolution === null) {
        result.stillPending++;
        await updateOutcome(record.id, record.checkCount, null);
      } else {
        result.resolved++;
        if (resolution.outcome === 'TP_HIT') result.tpHits++;
        else if (resolution.outcome === 'SL_HIT') result.slHits++;
        else result.timeouts++;
        await updateOutcome(record.id, record.checkCount, resolution);
        log.debug({ symbol: record.symbol, outcome: resolution.outcome, rr: resolution.rrAchieved }, 'resolved');
      }
    } catch (err) {
      result.errors++;
      log.error({ err, signalId: record.signalId }, 'error resolving outcome');
    }
  }

  log.info(result, 'tracker run complete');
  return result;
}

// ─── Single-signal resolution ─────────────────────────────────────────────────

async function resolveOutcome(record: SignalOutcomeRecord): Promise<OutcomeResolution | null> {
  const isFutures = record.scannerMode === 'futures';
  const interval  = record.timeframe;

  // signal.symbol is already the Binance symbol (e.g. 'BTCUSDT')
  const candles = isFutures
    ? await getFuturesKlines(record.symbol, interval, CANDLE_LIMIT).catch(() => [])
    : await getSpotKlines(record.symbol, interval, CANDLE_LIMIT).catch(() => []);

  // Candles after signal creation (signal was detected at record.createdAt)
  const signalTs = record.createdAt.getTime();
  const candlesAfter = candles.filter(c => c.openTime > signalTs);

  if (candlesAfter.length === 0) {
    // No new candles yet — check for timeout based on age alone
    return checkTimeout(record, record.entryPrice, record.createdAt.getTime());
  }

  // Scan candles chronologically for TP or SL hit
  for (const candle of candlesAfter) {
    const resolution = checkCandleHit(record, candle.high, candle.low, candle.openTime, candle.close);
    if (resolution) return resolution;
  }

  // No resolution found — check for timeout
  const lastCandle = candlesAfter[candlesAfter.length - 1];
  return checkTimeout(record, lastCandle.close, lastCandle.closeTime);
}

function checkCandleHit(
  record: SignalOutcomeRecord,
  high: number,
  low: number,
  candleTime: number,
  close: number,
): OutcomeResolution | null {
  const { signalType, entryPrice, targetPrice, stopLoss, rrRatio, createdAt } = record;
  if (signalType === 'NEUTRAL') return null;
  const side = signalType as 'BUY' | 'SELL';
  const durationHours = (candleTime - createdAt.getTime()) / 3_600_000;

  if (side === 'BUY') {
    // SL checked first (conservative: if both touched in same candle, SL wins)
    if (low <= stopLoss) {
      return buildResolution('SL_HIT', stopLoss, candleTime, entryPrice, stopLoss, rrRatio, side, durationHours, close);
    }
    if (high >= targetPrice) {
      return buildResolution('TP_HIT', targetPrice, candleTime, entryPrice, stopLoss, rrRatio, side, durationHours, close);
    }
  } else {
    // SELL: SL is above entry, TP is below entry
    if (high >= stopLoss) {
      return buildResolution('SL_HIT', stopLoss, candleTime, entryPrice, stopLoss, rrRatio, side, durationHours, close);
    }
    if (low <= targetPrice) {
      return buildResolution('TP_HIT', targetPrice, candleTime, entryPrice, stopLoss, rrRatio, side, durationHours, close);
    }
  }
  return null;
}

function checkTimeout(record: SignalOutcomeRecord, currentPrice: number, currentTime: number): OutcomeResolution | null {
  const ageHours = (Date.now() - record.createdAt.getTime()) / 3_600_000;
  if (ageHours < TIMEOUT_HOURS) return null;

  const { entryPrice, stopLoss, rrRatio, signalType, createdAt } = record;
  if (signalType === 'NEUTRAL') return null;
  const side = signalType as 'BUY' | 'SELL';
  const durationHours = (currentTime - createdAt.getTime()) / 3_600_000;

  return buildResolution('TIMEOUT', currentPrice, currentTime, entryPrice, stopLoss, rrRatio, side, durationHours, currentPrice);
}

function buildResolution(
  outcome: 'TP_HIT' | 'SL_HIT' | 'TIMEOUT',
  exitPrice: number,
  exitTimeMs: number,
  entryPrice: number,
  stopLoss: number,
  rrRatio: number,
  signalType: 'BUY' | 'SELL',
  durationHours: number,
  fallbackClose: number,
): OutcomeResolution {
  const finalExit = exitPrice || fallbackClose;
  const riskR     = Math.abs(entryPrice - stopLoss);

  let rrAchieved: number;
  let pnlPct: number;

  if (outcome === 'TP_HIT') {
    rrAchieved = rrRatio;
    pnlPct = signalType === 'BUY'
      ? ((finalExit - entryPrice) / entryPrice) * 100
      : ((entryPrice - finalExit) / entryPrice) * 100;
  } else if (outcome === 'SL_HIT') {
    rrAchieved = -1;
    pnlPct = signalType === 'BUY'
      ? ((finalExit - entryPrice) / entryPrice) * 100
      : ((entryPrice - finalExit) / entryPrice) * 100;
  } else {
    // TIMEOUT — calculate actual R achieved at exit
    const rawDiff = signalType === 'BUY'
      ? finalExit - entryPrice
      : entryPrice - finalExit;
    rrAchieved = riskR > 0 ? rawDiff / riskR : 0;
    pnlPct     = signalType === 'BUY'
      ? ((finalExit - entryPrice) / entryPrice) * 100
      : ((entryPrice - finalExit) / entryPrice) * 100;
  }

  return {
    outcome,
    exitPrice:     finalExit,
    exitTime:      new Date(exitTimeMs),
    rrAchieved:    parseFloat(rrAchieved.toFixed(4)),
    pnlPct:        parseFloat(pnlPct.toFixed(4)),
    durationHours: parseFloat(durationHours.toFixed(2)),
  };
}
