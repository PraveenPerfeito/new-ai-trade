import { TradingSignal, PaperTrade, OpenTradeView, PortfolioSnapshot, PortfolioMetrics } from '@/types';
import {
  getOrCreatePortfolio,
  getOpenTrades,
  getRecentTrades,
  hasOpenPosition,
  createPaperTrade,
  closePaperTrade,
  touchCheckedAt,
  updatePortfolioCapital,
  getTradeById,
  CreateTradeInput,
} from './paper-trading-db';
import { getCurrentPrice } from './binance';
import { createLogger } from './logger';

const log = createLogger('lib/paper-trading-engine');

// ─── Config ───────────────────────────────────────────────────────────────────

const DEFAULT_RISK_PCT   = 0.01;   // 1% of portfolio equity per trade
const MAX_OPEN_POSITIONS = 5;
const TRADE_EXPIRY_HOURS = 168;    // 7 days

// ─── Enter trade ──────────────────────────────────────────────────────────────

export interface EnterTradeOptions {
  leverage?: number;
  riskPct?:  number;   // override default 1%
}

export interface EnterResult {
  success: boolean;
  trade?:  PaperTrade;
  error?:  string;
}

export async function enterTrade(
  signal: TradingSignal,
  options: EnterTradeOptions = {},
): Promise<EnterResult> {
  const portfolio = await getOrCreatePortfolio();

  // Duplicate check: only one open position per symbol
  if (await hasOpenPosition(portfolio.id, signal.symbol)) {
    return { success: false, error: `Already have an open position in ${signal.symbol}` };
  }

  // Max open positions limit
  const open = await getOpenTrades(portfolio.id);
  if (open.length >= MAX_OPEN_POSITIONS) {
    return { success: false, error: `Max ${MAX_OPEN_POSITIONS} open positions reached` };
  }

  // Determine leverage
  const isFutures = signal.scannerMode === 'futures';
  const leverage  = options.leverage
    ?? (isFutures ? (signal.maxSafeLeverage ?? 2) : 1);

  const riskPct = options.riskPct ?? DEFAULT_RISK_PCT;

  // Position sizing using risk-based approach:
  //   riskAmount = portfolioEquity * riskPct
  //   slDistance = |entry - stopLoss| / entry  (fraction)
  //   notional   = riskAmount / slDistance
  //   margin     = notional / leverage
  const portfolioEquity = calcEquity(portfolio, open, []);
  const riskAmountUsdt  = portfolioEquity * riskPct;
  const slDistanceFrac  = Math.abs(signal.entryPrice - signal.stopLoss) / signal.entryPrice;

  if (slDistanceFrac <= 0) {
    return { success: false, error: 'Invalid stop-loss: same as entry price' };
  }

  const notionalUsdt = riskAmountUsdt / slDistanceFrac;
  const marginUsdt   = notionalUsdt / leverage;
  const quantity     = notionalUsdt / signal.entryPrice;

  // Ensure sufficient capital
  if (marginUsdt > portfolio.availableCapital) {
    const needed = marginUsdt.toFixed(2);
    const avail  = portfolio.availableCapital.toFixed(2);
    return { success: false, error: `Insufficient capital: need $${needed}, available $${avail}` };
  }

  // Cap notional at available * leverage (sanity check)
  const maxNotional = portfolio.availableCapital * leverage;
  if (notionalUsdt > maxNotional) {
    return { success: false, error: 'Position size exceeds maximum allowed notional' };
  }

  if (signal.type === 'NEUTRAL') {
    return { success: false, error: 'Cannot enter trade on NEUTRAL signal' };
  }

  const input: CreateTradeInput = {
    portfolioId:    portfolio.id,
    signalId:       signal.id,
    symbol:         signal.symbol,
    signalType:     signal.type as 'BUY' | 'SELL',
    timeframe:      signal.timeframe,
    scannerMode:    signal.scannerMode,
    confidence:     signal.confidence,
    entryPrice:     signal.entryPrice,
    targetPrice:    signal.targetPrice,
    stopLoss:       signal.stopLoss,
    rrRatio:        signal.rrRatio,
    leverage,
    riskPct,
    notionalUsdt:   parseFloat(notionalUsdt.toFixed(4)),
    marginUsdt:     parseFloat(marginUsdt.toFixed(4)),
    riskAmountUsdt: parseFloat(riskAmountUsdt.toFixed(4)),
    quantity:       parseFloat(quantity.toFixed(8)),
  };

  const trade = await createPaperTrade(input);
  if (!trade) return { success: false, error: 'Failed to create trade record' };

  // Deduct margin from available capital
  await updatePortfolioCapital(portfolio.id, -marginUsdt, 0, 0, 0, 0);

  log.info({ symbol: signal.symbol, type: signal.type, leverage, marginUsdt, notionalUsdt }, 'trade entered');
  return { success: true, trade };
}

// ─── Check all positions ──────────────────────────────────────────────────────

export interface CheckResult {
  checked:  number;
  tpHits:   number;
  slHits:   number;
  expired:  number;
  errors:   number;
}

export async function checkPositions(): Promise<CheckResult> {
  const portfolio = await getOrCreatePortfolio();
  const trades    = await getOpenTrades(portfolio.id);
  const result: CheckResult = { checked: 0, tpHits: 0, slHits: 0, expired: 0, errors: 0 };

  const checkedIds: string[] = [];

  for (const trade of trades) {
    result.checked++;
    try {
      const isFutures = trade.scannerMode === 'futures';
      const price     = await getCurrentPrice(trade.symbol, isFutures);

      if (price == null) {
        // Try spot fallback for futures symbols
        const fallback = await getCurrentPrice(trade.symbol, false);
        if (fallback == null) { result.errors++; continue; }
      }

      const currentPrice = price ?? 0;
      checkedIds.push(trade.id);

      // Check expiry first
      const ageHours = (Date.now() - trade.createdAt.getTime()) / 3_600_000;
      if (ageHours > TRADE_EXPIRY_HOURS) {
        await resolveClose(trade, currentPrice, 'EXPIRED', portfolio.id);
        result.expired++;
        continue;
      }

      // TP/SL check
      const tpHit = trade.signalType === 'BUY'
        ? currentPrice >= trade.targetPrice
        : currentPrice <= trade.targetPrice;

      const slHit = trade.signalType === 'BUY'
        ? currentPrice <= trade.stopLoss
        : currentPrice >= trade.stopLoss;

      if (slHit) {
        await resolveClose(trade, trade.stopLoss, 'SL_HIT', portfolio.id);
        result.slHits++;
      } else if (tpHit) {
        await resolveClose(trade, trade.targetPrice, 'TP_HIT', portfolio.id);
        result.tpHits++;
      }
    } catch (err) {
      log.error({ err, tradeId: trade.id }, 'checkPositions error');
      result.errors++;
    }
  }

  if (checkedIds.length > 0) await touchCheckedAt(checkedIds);
  log.info(result, 'position check complete');
  return result;
}

// ─── Manual close ─────────────────────────────────────────────────────────────

export interface CloseResult {
  success:  boolean;
  trade?:   PaperTrade;
  error?:   string;
}

export async function closeTradeManually(tradeId: string): Promise<CloseResult> {
  const trade = await getTradeById(tradeId);
  if (!trade) return { success: false, error: 'Trade not found' };
  if (trade.status !== 'OPEN') return { success: false, error: 'Trade is already closed' };

  const isFutures = trade.scannerMode === 'futures';
  const price     = await getCurrentPrice(trade.symbol, isFutures)
                 ?? await getCurrentPrice(trade.symbol, false);

  if (price == null) return { success: false, error: 'Could not fetch current price' };

  const portfolio = await getOrCreatePortfolio();
  await resolveClose(trade, price, 'MANUAL', portfolio.id);

  const updated = await getTradeById(tradeId);
  return { success: true, trade: updated ?? undefined };
}

// ─── Portfolio snapshot ───────────────────────────────────────────────────────

export async function getPortfolioSnapshot(): Promise<PortfolioSnapshot> {
  const portfolio   = await getOrCreatePortfolio();
  const openTrades  = await getOpenTrades(portfolio.id);
  const recentTrades = await getRecentTrades(portfolio.id, 30);

  // Fetch current prices for open trades
  const openViews: OpenTradeView[] = await Promise.all(
    openTrades.map(async (trade) => {
      const isFutures = trade.scannerMode === 'futures';
      const price = await getCurrentPrice(trade.symbol, isFutures)
                 ?? await getCurrentPrice(trade.symbol, false)
                 ?? trade.entryPrice;

      const { unrealizedPnl, unrealizedPnlPct, progressPct, distanceToTpPct, distanceToSlPct } =
        calcUnrealized(trade, price);

      return {
        ...trade,
        currentPrice: price,
        unrealizedPnl,
        unrealizedPnlPct,
        progressPct,
        distanceToTpPct,
        distanceToSlPct,
      };
    }),
  );

  const marginLocked  = openViews.reduce((s, t) => s + t.marginUsdt, 0);
  const unrealizedPnl = openViews.reduce((s, t) => s + t.unrealizedPnl, 0);
  const totalEquity   = portfolio.availableCapital + marginLocked + unrealizedPnl;

  return {
    portfolio,
    totalEquity,
    unrealizedPnl,
    marginLocked,
    openTrades:   openViews,
    recentTrades,
    metrics:      calcMetrics(portfolio, openViews, recentTrades),
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function resolveClose(
  trade: PaperTrade,
  exitPrice: number,
  reason: 'TP_HIT' | 'SL_HIT' | 'MANUAL' | 'EXPIRED',
  portfolioId: string,
): Promise<void> {
  const priceDiff = trade.signalType === 'BUY'
    ? exitPrice - trade.entryPrice
    : trade.entryPrice - exitPrice;

  const realizedPnl    = trade.notionalUsdt * (priceDiff / trade.entryPrice);
  const realizedPnlPct = (priceDiff / trade.entryPrice) * 100 * trade.leverage;
  const durationHours  = (Date.now() - trade.createdAt.getTime()) / 3_600_000;

  await closePaperTrade(
    trade.id, exitPrice, reason,
    parseFloat(realizedPnl.toFixed(4)),
    parseFloat(realizedPnlPct.toFixed(4)),
    parseFloat(durationHours.toFixed(2)),
  );

  // Return margin + PnL to available capital
  const capitalReturn = trade.marginUsdt + realizedPnl;
  const isWin  = realizedPnl > 0 ? 1 : 0;
  const isLoss = realizedPnl < 0 ? 1 : 0;

  await updatePortfolioCapital(
    portfolioId,
    capitalReturn,
    realizedPnl,
    isWin,
    isLoss,
    1,
  );
}

function calcUnrealized(trade: PaperTrade, currentPrice: number) {
  const priceDiff = trade.signalType === 'BUY'
    ? currentPrice - trade.entryPrice
    : trade.entryPrice - currentPrice;

  const unrealizedPnl    = trade.notionalUsdt * (priceDiff / trade.entryPrice);
  const unrealizedPnlPct = (priceDiff / trade.entryPrice) * 100 * trade.leverage;

  // Progress: how far price has moved between SL and TP (0 = at SL, 100 = at TP)
  const range = trade.signalType === 'BUY'
    ? trade.targetPrice - trade.stopLoss
    : trade.stopLoss - trade.targetPrice;

  const position = trade.signalType === 'BUY'
    ? currentPrice - trade.stopLoss
    : trade.stopLoss - currentPrice;

  const progressPct = range > 0 ? Math.min(110, Math.max(-10, (position / range) * 100)) : 50;

  const distanceToTpPct = trade.signalType === 'BUY'
    ? ((trade.targetPrice - currentPrice) / currentPrice) * 100
    : ((currentPrice - trade.targetPrice) / currentPrice) * 100;

  const distanceToSlPct = trade.signalType === 'BUY'
    ? ((currentPrice - trade.stopLoss) / currentPrice) * 100
    : ((trade.stopLoss - currentPrice) / currentPrice) * 100;

  return {
    unrealizedPnl:    parseFloat(unrealizedPnl.toFixed(4)),
    unrealizedPnlPct: parseFloat(unrealizedPnlPct.toFixed(4)),
    progressPct:      parseFloat(progressPct.toFixed(1)),
    distanceToTpPct:  parseFloat(distanceToTpPct.toFixed(2)),
    distanceToSlPct:  parseFloat(distanceToSlPct.toFixed(2)),
  };
}

function calcEquity(
  portfolio: { availableCapital: number },
  openTrades: Array<{ marginUsdt: number }>,
  openViews: Array<{ unrealizedPnl: number }>,
): number {
  const marginLocked  = openTrades.reduce((s, t) => s + t.marginUsdt, 0);
  const unrealizedPnl = openViews.reduce((s, t) => s + t.unrealizedPnl, 0);
  return portfolio.availableCapital + marginLocked + unrealizedPnl;
}

function calcMetrics(
  portfolio: { wins: number; losses: number; totalTrades: number; initialCapital: number; availableCapital: number; realizedPnl: number },
  openViews: OpenTradeView[],
  closed: PaperTrade[],
): PortfolioMetrics {
  const total     = portfolio.totalTrades;
  const winRate   = total > 0 ? portfolio.wins / total : 0;

  const closedRR  = closed.filter(t => t.realizedPnl != null);
  const avgRR     = closedRR.length > 0
    ? closedRR.reduce((s, t) => s + (t.realizedPnl! / t.riskAmountUsdt), 0) / closedRR.length
    : 0;

  const grossWins  = closed.filter(t => (t.realizedPnl ?? 0) > 0).reduce((s, t) => s + t.realizedPnl!, 0);
  const grossLoss  = Math.abs(closed.filter(t => (t.realizedPnl ?? 0) < 0).reduce((s, t) => s + t.realizedPnl!, 0));
  const profitFactor = grossLoss > 0 ? grossWins / grossLoss : grossWins > 0 ? 99 : 0;

  const best  = closed.length > 0 ? Math.max(...closed.map(t => t.realizedPnl ?? 0)) : 0;
  const worst = closed.length > 0 ? Math.min(...closed.map(t => t.realizedPnl ?? 0)) : 0;

  const unrealizedPnl     = openViews.reduce((s, t) => s + t.unrealizedPnl, 0);
  const marginLocked      = openViews.reduce((s, t) => s + t.marginUsdt, 0);
  const currentEquity     = portfolio.availableCapital + marginLocked + unrealizedPnl;
  const totalReturnPct    = portfolio.initialCapital > 0
    ? ((currentEquity - portfolio.initialCapital) / portfolio.initialCapital) * 100
    : 0;

  return {
    totalTrades:    total,
    openTrades:     openViews.length,
    winRate:        parseFloat(winRate.toFixed(4)),
    avgRR:          parseFloat(avgRR.toFixed(4)),
    totalReturnPct: parseFloat(totalReturnPct.toFixed(4)),
    profitFactor:   parseFloat(profitFactor.toFixed(4)),
    bestTrade:      parseFloat(best.toFixed(4)),
    worstTrade:     parseFloat(worst.toFixed(4)),
  };
}
