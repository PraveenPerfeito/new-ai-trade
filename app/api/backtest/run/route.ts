import { NextRequest, NextResponse } from 'next/server';
import { BacktestConfig } from '@/types';
import { runBacktest } from '@/lib/backtest';
import { getCachedCoins, createBacktestRun, completeBacktestRun, failBacktestRun } from '@/lib/supabase';
import { getTop100ByMarketCap } from '@/lib/coingecko';
import { getFuturesSymbols } from '@/lib/binance';
import { parseBody, backtestBodySchema } from '@/lib/validate';
import { createLogger } from '@/lib/logger';

export const runtime     = 'nodejs';
export const maxDuration = 300;

const log = createLogger('api/backtest/run');

export async function POST(req: NextRequest) {
  const { data, error: validationError } = await parseBody(req, backtestBodySchema);
  if (validationError) return validationError;

  const config: BacktestConfig = {
    strategyName:   data.strategyName,
    mode:           data.mode,
    lookbackDays:   data.lookbackDays,
    maxHoldCandles: data.maxHoldCandles,
    minRRRatio:     data.minRRRatio,
    maxCoins:       data.maxCoins,
  };

  let coins = await getCachedCoins(50);
  if (coins.length < 5) coins = await getTop100ByMarketCap();

  if (config.mode === 'futures') {
    const futSet = await getFuturesSymbols();
    coins = coins.filter(c => futSet.has(c.binanceSymbol));
  }

  coins = coins.slice(0, config.maxCoins);
  if (coins.length === 0) {
    return NextResponse.json({ success: false, error: 'No coins available for backtest' }, { status: 400 });
  }

  const runId = await createBacktestRun(config);
  if (!runId) {
    return NextResponse.json({ success: false, error: 'Failed to create backtest record' }, { status: 500 });
  }

  log.info({ runId, coins: coins.length, lookbackDays: config.lookbackDays, mode: config.mode }, 'Backtest started');

  try {
    const result = await runBacktest(coins, config);
    await completeBacktestRun(runId, result.metrics, result.trades, result.coinsRan);
    log.info({ runId, trades: result.trades.length, durationMs: result.durationMs }, 'Backtest completed');

    return NextResponse.json({
      success:     true,
      runId,
      coinsTested: result.coinsRan.length,
      totalTrades: result.trades.length,
      durationMs:  result.durationMs,
      metrics:     result.metrics,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Backtest failed';
    await failBacktestRun(runId, msg);
    log.error({ runId, err: msg }, 'Backtest failed');
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
