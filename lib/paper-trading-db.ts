import { createClient } from '@supabase/supabase-js';
import {
  PaperPortfolio, PaperTrade, PaperTradeStatus, PaperTradeExitReason,
  Timeframe, ScannerMode,
} from '@/types';
import { createLogger } from './logger';

const log = createLogger('lib/paper-trading-db');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(): any {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Supabase env vars not set');
  return createClient(url, key);
}

// ─── Portfolio ────────────────────────────────────────────────────────────────

export async function getOrCreatePortfolio(): Promise<PaperPortfolio> {
  const client = db();

  const { data: existing } = await client
    .from('paper_portfolios')
    .select('*')
    .order('created_at', { ascending: true })
    .limit(1)
    .single();

  if (existing) return rowToPortfolio(existing);

  const { data: created, error } = await client
    .from('paper_portfolios')
    .insert({ name: 'Paper Portfolio', initial_capital: 10000, available_capital: 10000 })
    .select('*')
    .single();

  if (error || !created) throw new Error(`Failed to create portfolio: ${error?.message}`);
  return rowToPortfolio(created);
}

export async function updatePortfolioCapital(
  id: string,
  availableCapitalDelta: number,
  realizedPnlDelta: number,
  winDelta = 0,
  lossDelta = 0,
  tradeDelta = 0,
): Promise<void> {
  // Read current values first, then update — avoids race conditions for single-user paper trading
  const { data, error: readErr } = await db()
    .from('paper_portfolios')
    .select('available_capital, realized_pnl, wins, losses, total_trades')
    .eq('id', id)
    .single();

  if (readErr || !data) { log.error({ err: readErr?.message }, 'updatePortfolioCapital read'); return; }

  const { error } = await db()
    .from('paper_portfolios')
    .update({
      available_capital: Number(data.available_capital) + availableCapitalDelta,
      realized_pnl:      Number(data.realized_pnl)      + realizedPnlDelta,
      wins:              Number(data.wins)               + winDelta,
      losses:            Number(data.losses)             + lossDelta,
      total_trades:      Number(data.total_trades)       + tradeDelta,
      updated_at:        new Date().toISOString(),
    })
    .eq('id', id);

  if (error) log.error({ err: error.message }, 'updatePortfolioCapital write');
}

export async function resetPortfolio(id: string): Promise<void> {
  const { data: portfolio } = await db()
    .from('paper_portfolios')
    .select('initial_capital')
    .eq('id', id)
    .single();

  if (!portfolio) return;

  const client = db();
  await Promise.all([
    client.from('paper_trades').delete().eq('portfolio_id', id),
    client.from('paper_portfolios').update({
      available_capital: portfolio.initial_capital,
      realized_pnl:      0,
      total_trades:      0,
      wins:              0,
      losses:            0,
      updated_at:        new Date().toISOString(),
    }).eq('id', id),
  ]);
}

// ─── Trades ───────────────────────────────────────────────────────────────────

export interface CreateTradeInput {
  portfolioId:    string;
  signalId?:      string;
  symbol:         string;
  signalType:     'BUY' | 'SELL';
  timeframe:      Timeframe;
  scannerMode:    ScannerMode;
  confidence:     number;
  entryPrice:     number;
  targetPrice:    number;
  stopLoss:       number;
  rrRatio:        number;
  leverage:       number;
  riskPct:        number;
  notionalUsdt:   number;
  marginUsdt:     number;
  riskAmountUsdt: number;
  quantity:       number;
}

export async function createPaperTrade(input: CreateTradeInput): Promise<PaperTrade | null> {
  const { data, error } = await db()
    .from('paper_trades')
    .insert({
      portfolio_id:     input.portfolioId,
      signal_id:        input.signalId ?? null,
      symbol:           input.symbol,
      signal_type:      input.signalType,
      timeframe:        input.timeframe,
      scanner_mode:     input.scannerMode,
      confidence:       input.confidence,
      entry_price:      input.entryPrice,
      target_price:     input.targetPrice,
      stop_loss:        input.stopLoss,
      rr_ratio:         input.rrRatio,
      leverage:         input.leverage,
      risk_pct:         input.riskPct,
      notional_usdt:    input.notionalUsdt,
      margin_usdt:      input.marginUsdt,
      risk_amount_usdt: input.riskAmountUsdt,
      quantity:         input.quantity,
      status:           'OPEN',
    })
    .select('*')
    .single();

  if (error) { log.error({ err: error.message }, 'createPaperTrade'); return null; }
  return rowToTrade(data);
}

export async function closePaperTrade(
  id: string,
  exitPrice: number,
  exitReason: PaperTradeExitReason,
  realizedPnl: number,
  realizedPnlPct: number,
  durationHours: number,
): Promise<void> {
  const status: PaperTradeStatus =
    exitReason === 'TP_HIT' ? 'CLOSED_TP'
    : exitReason === 'SL_HIT' ? 'CLOSED_SL'
    : exitReason === 'EXPIRED' ? 'CLOSED_EXPIRED'
    : 'CLOSED_MANUAL';

  const { error } = await db()
    .from('paper_trades')
    .update({
      status,
      exit_price:       exitPrice,
      exit_reason:      exitReason,
      realized_pnl:     realizedPnl,
      realized_pnl_pct: realizedPnlPct,
      duration_hours:   durationHours,
      closed_at:        new Date().toISOString(),
    })
    .eq('id', id);

  if (error) log.error({ err: error.message, id }, 'closePaperTrade');
}

export async function touchCheckedAt(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await db()
    .from('paper_trades')
    .update({ last_checked_at: new Date().toISOString() })
    .in('id', ids);
  if (error) log.error({ err: error.message }, 'touchCheckedAt');
}

export async function getOpenTrades(portfolioId: string): Promise<PaperTrade[]> {
  const { data, error } = await db()
    .from('paper_trades')
    .select('*')
    .eq('portfolio_id', portfolioId)
    .eq('status', 'OPEN')
    .order('created_at', { ascending: true });

  if (error) { log.error({ err: error.message }, 'getOpenTrades'); return []; }
  return (data ?? []).map(rowToTrade);
}

export async function getRecentTrades(portfolioId: string, limit = 30): Promise<PaperTrade[]> {
  const { data, error } = await db()
    .from('paper_trades')
    .select('*')
    .eq('portfolio_id', portfolioId)
    .neq('status', 'OPEN')
    .order('closed_at', { ascending: false })
    .limit(limit);

  if (error) { log.error({ err: error.message }, 'getRecentTrades'); return []; }
  return (data ?? []).map(rowToTrade);
}

export async function hasOpenPosition(portfolioId: string, symbol: string): Promise<boolean> {
  const { count } = await db()
    .from('paper_trades')
    .select('id', { count: 'exact', head: true })
    .eq('portfolio_id', portfolioId)
    .eq('symbol', symbol)
    .eq('status', 'OPEN');
  return (count ?? 0) > 0;
}

export async function getTradeById(id: string): Promise<PaperTrade | null> {
  const { data, error } = await db()
    .from('paper_trades')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !data) return null;
  return rowToTrade(data);
}

// ─── Row mappers ──────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToPortfolio(row: any): PaperPortfolio {
  return {
    id:               row.id,
    name:             row.name,
    initialCapital:   Number(row.initial_capital),
    availableCapital: Number(row.available_capital),
    realizedPnl:      Number(row.realized_pnl),
    totalTrades:      Number(row.total_trades),
    wins:             Number(row.wins),
    losses:           Number(row.losses),
    createdAt:        new Date(row.created_at),
    updatedAt:        new Date(row.updated_at),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToTrade(row: any): PaperTrade {
  return {
    id:             row.id,
    portfolioId:    row.portfolio_id,
    signalId:       row.signal_id ?? undefined,
    symbol:         row.symbol,
    signalType:     row.signal_type,
    timeframe:      row.timeframe as Timeframe,
    scannerMode:    row.scanner_mode as ScannerMode,
    confidence:     Number(row.confidence),
    entryPrice:     Number(row.entry_price),
    targetPrice:    Number(row.target_price),
    stopLoss:       Number(row.stop_loss),
    rrRatio:        Number(row.rr_ratio),
    leverage:       Number(row.leverage),
    riskPct:        Number(row.risk_pct),
    notionalUsdt:   Number(row.notional_usdt),
    marginUsdt:     Number(row.margin_usdt),
    riskAmountUsdt: Number(row.risk_amount_usdt),
    quantity:       Number(row.quantity),
    status:         row.status as PaperTradeStatus,
    exitPrice:      row.exit_price    != null ? Number(row.exit_price)    : undefined,
    exitReason:     row.exit_reason   ?? undefined,
    realizedPnl:    row.realized_pnl  != null ? Number(row.realized_pnl)  : undefined,
    realizedPnlPct: row.realized_pnl_pct != null ? Number(row.realized_pnl_pct) : undefined,
    durationHours:  row.duration_hours != null ? Number(row.duration_hours) : undefined,
    createdAt:      new Date(row.created_at),
    closedAt:       row.closed_at       ? new Date(row.closed_at)       : undefined,
    lastCheckedAt:  row.last_checked_at ? new Date(row.last_checked_at) : undefined,
  };
}
