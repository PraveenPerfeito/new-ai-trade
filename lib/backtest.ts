/**
 * Backtesting engine — replays historical 1h candles, applies the same
 * setup-detection logic used by the live scanner (no AI call), simulates
 * trade execution (TP / SL / timeout), and aggregates performance metrics.
 *
 * 4h data is synthesised by aggregating every four 1h candles so we only
 * need one Binance API call per coin.
 *
 * Pipeline per coin:
 *   1. Fetch up to 1 000 1h candles
 *   2. Synthesise 4h candles
 *   3. Roll a 100-candle window every 4 bars
 *   4. Calculate 1h + 4h indicators
 *   5. Apply MTF confirmation, volatility gate, trend-strength gate, setup scorer
 *   6. Simulate trade against forward candles
 *   7. Advance cursor past trade duration to avoid re-entry
 */

import {
  Candle, CoinData, ScannerMode,
  BacktestTrade, BacktestMetrics, BacktestConfig,
} from '@/types';
import { getSpotKlines, getFuturesKlines } from './binance';
import {
  calculateAllIndicators,
  calcTrendStrength,
  calcVolatilityRating,
  confirmMultiTimeframe,
} from './indicators';
import { detectSetup, tradeLevels } from './scanner';
import { sleep } from './utils';
import { createLogger } from './logger';

const log = createLogger('lib/backtest');

// ─── 4h synthesis ─────────────────────────────────────────────────────────────

function aggregate4h(candles: Candle[]): Candle[] {
  const result: Candle[] = [];
  for (let i = 0; i + 3 < candles.length; i += 4) {
    const s = candles.slice(i, i + 4);
    result.push({
      openTime:  s[0].openTime,
      open:      s[0].open,
      high:      Math.max(s[0].high, s[1].high, s[2].high, s[3].high),
      low:       Math.min(s[0].low,  s[1].low,  s[2].low,  s[3].low),
      close:     s[3].close,
      volume:    s[0].volume + s[1].volume + s[2].volume + s[3].volume,
      closeTime: s[3].closeTime,
    });
  }
  return result;
}

// ─── Trade simulation ─────────────────────────────────────────────────────────

function simulateTrade(
  symbol:    string,
  type:      'BUY' | 'SELL',
  entry:     number,
  tp:        number,
  sl:        number,
  rrRatio:   number,
  forward:   Candle[],
  entryTime: Date,
  maxHold:   number,
  rsi:       number,
  volSpike:  number,
): BacktestTrade {
  const limit = Math.min(maxHold, forward.length);
  let exitPrice  = forward[limit - 1]?.close ?? entry;
  let exitReason: BacktestExitReason = 'TIMEOUT';
  let duration   = limit;
  let exitTime   = new Date(forward[limit - 1]?.closeTime ?? entryTime.getTime());

  for (let i = 0; i < limit; i++) {
    const c = forward[i];
    if (type === 'BUY') {
      if (c.low  <= sl) { exitPrice = sl; exitReason = 'SL_HIT'; duration = i + 1; exitTime = new Date(c.closeTime); break; }
      if (c.high >= tp) { exitPrice = tp; exitReason = 'TP_HIT'; duration = i + 1; exitTime = new Date(c.closeTime); break; }
    } else {
      if (c.high >= sl) { exitPrice = sl; exitReason = 'SL_HIT'; duration = i + 1; exitTime = new Date(c.closeTime); break; }
      if (c.low  <= tp) { exitPrice = tp; exitReason = 'TP_HIT'; duration = i + 1; exitTime = new Date(c.closeTime); break; }
    }
  }

  const pnlPct = parseFloat(
    (type === 'BUY'
      ? (exitPrice - entry) / entry * 100
      : (entry - exitPrice) / entry * 100
    ).toFixed(4),
  );

  const outcome: BacktestOutcome =
    exitReason === 'TP_HIT' ? 'WIN'
    : exitReason === 'SL_HIT' ? 'LOSS'
    : pnlPct >= 0 ? 'WIN' : 'LOSS';

  return {
    symbol, type,
    entryPrice: entry,
    exitPrice,
    stopLoss:   sl,
    takeProfit: tp,
    rrRatio,
    outcome,
    pnlPct,
    entryTime,
    exitTime,
    durationCandles:     duration,
    exitReason,
    rsiAtEntry:          rsi,
    volumeSpikeAtEntry:  volSpike,
  };
}

// Need explicit import of these union types for the function signatures above
type BacktestOutcome    = 'WIN' | 'LOSS' | 'TIMEOUT';
type BacktestExitReason = 'TP_HIT' | 'SL_HIT' | 'TIMEOUT';

// ─── Per-coin backtest ────────────────────────────────────────────────────────

async function backtestCoin(
  coin:   CoinData,
  config: BacktestConfig,
): Promise<BacktestTrade[]> {
  const limit1h = Math.min(config.lookbackDays * 24 + 120, 1000);
  const mode    = config.mode;

  const candles1h = mode === 'futures'
    ? await getFuturesKlines(coin.binanceSymbol, '1h', limit1h)
    : await getSpotKlines(coin.binanceSymbol, '1h', limit1h);

  if (candles1h.length < 120) return [];

  const candles4h = aggregate4h(candles1h);
  const trades: BacktestTrade[] = [];
  const minRR     = config.minRRRatio ?? 2.0;
  let tradeEndIdx = -1;

  // Roll window every 4 candles — avoids firing duplicate signals in one move
  for (let i = 100; i < candles1h.length - config.maxHoldCandles; i += 4) {
    if (i <= tradeEndIdx) continue;

    const window1h = candles1h.slice(i - 100, i);
    const ind1h    = calculateAllIndicators(window1h);

    // Align 4h window to the same wall-clock position
    const h4Pos    = Math.floor(i / 4);
    if (h4Pos < 25) continue;
    const window4h = candles4h.slice(h4Pos - 25, h4Pos);
    if (window4h.length < 20) continue;
    const ind4h = calculateAllIndicators(window4h);

    // 1. Direction from higher-timeframe trend
    let signalType: 'BUY' | 'SELL';
    if      (ind4h.trend === 'BULLISH') signalType = 'BUY';
    else if (ind4h.trend === 'BEARISH') signalType = 'SELL';
    else continue;

    // 2. Multi-timeframe confirmation
    if (!confirmMultiTimeframe(ind1h, ind4h, signalType).confirmed) continue;

    // 3. Volatility gate
    if (calcVolatilityRating(ind1h.atr, ind1h.currentPrice) === 'EXTREME') continue;

    // 4. Trend strength gate
    const s1 = calcTrendStrength(ind1h);
    const s4 = calcTrendStrength(ind4h);
    if (s1 * 0.4 + s4 * 0.6 < 30) continue;

    // 5. Setup detector (same scoring as live scanner)
    if (!detectSetup(ind1h, ind4h, signalType, s1, s4).hasSetup) continue;

    // 6. Trade levels
    if (ind1h.atr === 0) continue;
    const lvl = tradeLevels(ind1h.currentPrice, ind1h.atr, signalType, mode);
    if (lvl.rrRatio < minRR) continue;

    // 7. Simulate
    const trade = simulateTrade(
      coin.symbol, signalType,
      lvl.entryPrice, lvl.targetPrice, lvl.stopLoss,
      lvl.rrRatio,
      candles1h.slice(i),
      new Date(candles1h[i].openTime),
      config.maxHoldCandles,
      ind1h.rsi,
      ind1h.volumeSpike,
    );

    trades.push(trade);
    tradeEndIdx = i + trade.durationCandles;
  }

  return trades;
}

// ─── Metrics calculation ──────────────────────────────────────────────────────

export function calcMetrics(trades: BacktestTrade[]): BacktestMetrics {
  if (trades.length === 0) {
    return {
      totalTrades: 0, winRate: 0, lossRate: 0, timeoutRate: 0,
      avgRR: 0, profitFactor: 0, totalReturn: 0, maxDrawdown: 0,
      avgWin: 0, avgLoss: 0, bestTrade: 0, worstTrade: 0,
      sharpeRatio: 0, avgDurationCandles: 0, equityCurve: [0],
    };
  }

  const wins    = trades.filter(t => t.outcome === 'WIN');
  const losses  = trades.filter(t => t.outcome === 'LOSS');
  const timeouts = trades.filter(t => t.exitReason === 'TIMEOUT');

  const grossProfit = wins.reduce((s, t) => s + t.pnlPct, 0);
  const grossLoss   = Math.abs(losses.reduce((s, t) => s + t.pnlPct, 0));
  const avgWin      = wins.length   > 0 ?  grossProfit / wins.length   : 0;
  const avgLoss     = losses.length > 0 ? -(grossLoss  / losses.length) : 0;

  // Equity curve
  const equityCurve: number[] = [0];
  let running = 0;
  for (const t of trades) {
    running += t.pnlPct;
    equityCurve.push(parseFloat(running.toFixed(4)));
  }

  // Max drawdown (peak-to-trough)
  let maxDrawdown = 0;
  let peak = equityCurve[0];
  for (const v of equityCurve) {
    if (v > peak) peak = v;
    const dd = peak - v;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  // Simplified Sharpe: mean(return) / stddev(return)
  const returns    = trades.map(t => t.pnlPct);
  const mean       = running / returns.length;
  const variance   = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
  const sharpe     = Math.sqrt(variance) > 0 ? mean / Math.sqrt(variance) : 0;

  return {
    totalTrades:        trades.length,
    winRate:            parseFloat((wins.length    / trades.length).toFixed(4)),
    lossRate:           parseFloat((losses.length  / trades.length).toFixed(4)),
    timeoutRate:        parseFloat((timeouts.length / trades.length).toFixed(4)),
    avgRR:              avgLoss !== 0 ? parseFloat((Math.abs(avgWin / avgLoss)).toFixed(4)) : 0,
    profitFactor:       grossLoss > 0 ? parseFloat((grossProfit / grossLoss).toFixed(4)) : (grossProfit > 0 ? 99 : 0),
    totalReturn:        parseFloat(running.toFixed(4)),
    maxDrawdown:        parseFloat(maxDrawdown.toFixed(4)),
    avgWin:             parseFloat(avgWin.toFixed(4)),
    avgLoss:            parseFloat(avgLoss.toFixed(4)),
    bestTrade:          parseFloat(Math.max(...returns).toFixed(4)),
    worstTrade:         parseFloat(Math.min(...returns).toFixed(4)),
    sharpeRatio:        parseFloat(sharpe.toFixed(4)),
    avgDurationCandles: Math.round(trades.reduce((s, t) => s + t.durationCandles, 0) / trades.length),
    equityCurve,
  };
}

// ─── Full backtest orchestration ──────────────────────────────────────────────

export interface BacktestResult {
  trades:     BacktestTrade[];
  metrics:    BacktestMetrics;
  coinsRan:   string[];
  durationMs: number;
}

export async function runBacktest(
  coins:  CoinData[],
  config: BacktestConfig,
): Promise<BacktestResult> {
  const t0      = Date.now();
  const all:    BacktestTrade[] = [];
  const coinsRan: string[]      = [];

  for (const coin of coins) {
    try {
      const trades = await backtestCoin(coin, config);
      all.push(...trades);
      coinsRan.push(coin.symbol);
      log.info({ symbol: coin.symbol, trades: trades.length }, 'backtest coin done');
    } catch (err) {
      log.error({ symbol: coin.symbol, err }, 'backtest coin error');
    }
    await sleep(300); // Binance rate-limit courtesy delay
  }

  // Sort by entry time so the equity curve is chronological
  all.sort((a, b) => a.entryTime.getTime() - b.entryTime.getTime());

  return {
    trades:     all,
    metrics:    calcMetrics(all),
    coinsRan,
    durationMs: Date.now() - t0,
  };
}
