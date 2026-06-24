import { createClient } from '@supabase/supabase-js';
import { TradingSignal, AIExplainability, CoinData, BacktestTrade, BacktestMetrics, BacktestConfig, BacktestRun, AttributionRow, SignalType, Timeframe, ScannerMode, RiskGrade, MarketRegime, SignalState, ExtensionRisk, McapTier, SectorName } from '@/types';
import { createSupabaseAdminClient } from './supabase/admin';
import { createLogger } from './logger';

const log = createLogger('lib/supabase');

let _client: ReturnType<typeof createClient> | null = null;

// Returns untyped client — we don't have generated DB types, so `any` avoids
// TypeScript rejecting valid insert/select shapes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(): any {
  if (_client) return _client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set in .env.local');
  }
  _client = createClient(url, key);
  return _client;
}

// --- Scan Runs ---

export async function createScanRun(mode: string): Promise<string | null> {
  const { data, error } = await db()
    .from('scan_runs')
    .insert({ mode, status: 'running', coins_scanned: 0, signals_found: 0 })
    .select('id')
    .single();

  if (error) { log.error({ error: error.message }, 'db createScanRun failed'); return null; }
  return data.id as string;
}

export async function updateScanRun(
  id: string,
  patch: {
    coins_scanned?: number;
    signals_found?: number;
    status?: string;
    completed_at?: string;
    error?: string;
  },
): Promise<void> {
  const { error } = await db().from('scan_runs').update(patch).eq('id', id);
  if (error) log.error({ error: error.message }, 'db updateScanRun failed');
}

// --- Signals ---

export async function saveSignal(signal: TradingSignal): Promise<string | null> {
  const { data, error } = await db()
    .from('signals')
    .insert({
      scan_run_id: signal.scanRunId ?? null,
      symbol: signal.symbol,
      name: signal.name,
      type: signal.type,
      timeframe: signal.timeframe,
      scanner_mode: signal.scannerMode,
      entry_price: signal.entryPrice,
      target_price: signal.targetPrice,
      stop_loss: signal.stopLoss,
      rr_ratio: signal.rrRatio,
      confidence: signal.confidence,
      rsi: signal.indicators.rsi,
      macd_histogram: signal.indicators.macd.histogram,
      ema_trend: signal.indicators.trend,
      atr: signal.indicators.atr,
      volume_spike: signal.indicators.volumeSpike,
      setup_description: signal.setupDescription,
      ai_validated:      signal.aiValidated,
      ai_reasoning:      signal.aiReasoning      ?? null,
      ai_explainability: signal.aiExplainability ?? null,
      risks:             signal.risks             ?? [],
      strengths:         signal.strengths         ?? [],
      telegram_sent: signal.telegramSent,
      // Phase 6.7 — tactical intelligence fields for outcome attribution
      market_regime:            signal.marketRegime            ?? null,
      institutional_score:      signal.institutionalScore      ?? null,
      signal_state:             signal.signalState             ?? null,
      extension_risk:           signal.extensionRisk           ?? null,
      mcap_tier:                signal.mcapTier                ?? null,
      sector_name:              signal.sectorName              ?? null,
      continuation_probability: signal.continuation?.continuationProbability ?? null,
      regime_alignment_score:   signal.regimeAlignmentScore    ?? null,
      validation_source:        signal.validationSource        ?? null,
    })
    .select('id')
    .single();

  if (error) { log.error({ error: error.message }, 'db saveSignal failed'); return null; }
  return data.id as string;
}

export async function getRecentSignals(
  limit = 50,
  minConfidence = 70,
  windowDays = 7,
  mode?: string,
  signalType?: string,
): Promise<TradingSignal[]> {
  const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();
  let query = db()
    .from('signals')
    .select('*')
    .gte('confidence', minConfidence)
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false })
    .order('confidence', { ascending: false });

  if (mode) query = query.eq('scanner_mode', mode);
  if (signalType) query = query.eq('type', signalType);

  const { data, error } = await query.limit(limit);

  if (error) { log.error({ error: error.message }, 'db getRecentSignals failed'); return []; }
  return (data ?? []).map(rowToSignal);
}

// --- Coins cache ---

export async function upsertCoins(coins: CoinData[]): Promise<void> {
  const rows = coins.map(c => ({
    symbol: c.symbol,
    name: c.name,
    coingecko_id: c.id,
    binance_symbol: c.binanceSymbol,
    market_cap: c.marketCap,
    volume_24h: c.volume24h,
    price: c.price,
    price_change_24h: c.priceChange24h,
    rank: c.rank,
    has_futures: c.hasFutures,
    last_updated: new Date().toISOString(),
  }));

  const { error } = await db().from('coins').upsert(rows, { onConflict: 'symbol' });
  if (error) log.error({ error: error.message }, 'db upsertCoins failed');
}

// --- Coins cache read ---

export async function getCachedCoins(limit = 30): Promise<CoinData[]> {
  try {
    const { data, error } = await db()
      .from('coins')
      .select('*')
      .order('rank', { ascending: true })
      .limit(limit);
    if (error || !data?.length) return [];
    return (data as Record<string, unknown>[]).map(rowToCoin);
  } catch { return []; }
}

// --- Backtest runs ---

export async function createBacktestRun(
  config: BacktestConfig,
): Promise<string | null> {
  const { data, error } = await db()
    .from('backtest_runs')
    .insert({
      strategy_name: config.strategyName,
      mode:          config.mode,
      coins_tested:  0,
      total_trades:  0,
      status:        'running',
      config:        config,
    })
    .select('id')
    .single();
  if (error) { log.error({ error: error.message }, 'db createBacktestRun failed'); return null; }
  return data.id as string;
}

export async function completeBacktestRun(
  id:       string,
  metrics:  BacktestMetrics,
  trades:   BacktestTrade[],
  coinsRan: string[],
): Promise<void> {
  // Save trades in chunks of 200
  const CHUNK = 200;
  for (let i = 0; i < trades.length; i += CHUNK) {
    const chunk = trades.slice(i, i + CHUNK).map(t => ({
      backtest_run_id:  id,
      symbol:           t.symbol,
      type:             t.type,
      entry_price:      t.entryPrice,
      exit_price:       t.exitPrice,
      stop_loss:        t.stopLoss,
      take_profit:      t.takeProfit,
      rr_ratio:         t.rrRatio,
      outcome:          t.outcome,
      pnl_pct:          t.pnlPct,
      entry_time:       t.entryTime.toISOString(),
      exit_time:        t.exitTime?.toISOString() ?? null,
      duration_candles: t.durationCandles,
      exit_reason:      t.exitReason,
      rsi_at_entry:     t.rsiAtEntry ?? null,
      volume_spike:     t.volumeSpikeAtEntry ?? null,
    }));
    const { error } = await db().from('backtest_trades').insert(chunk);
    if (error) log.error({ error: error.message }, 'db insertBacktestTrades failed');
  }

  // Update run summary
  const { error } = await db()
    .from('backtest_runs')
    .update({
      status:              'completed',
      coins_tested:        coinsRan.length,
      total_trades:        trades.length,
      completed_at:        new Date().toISOString(),
      win_rate:            metrics.winRate,
      loss_rate:           metrics.lossRate,
      timeout_rate:        metrics.timeoutRate,
      avg_rr:              metrics.avgRR,
      profit_factor:       metrics.profitFactor,
      total_return:        metrics.totalReturn,
      max_drawdown:        metrics.maxDrawdown,
      avg_win:             metrics.avgWin,
      avg_loss:            metrics.avgLoss,
      best_trade:          metrics.bestTrade,
      worst_trade:         metrics.worstTrade,
      sharpe_ratio:        metrics.sharpeRatio,
      avg_duration_candles: metrics.avgDurationCandles,
      equity_curve:        metrics.equityCurve,
    })
    .eq('id', id);
  if (error) log.error({ error: error.message }, 'db completeBacktestRun failed');
}

export async function failBacktestRun(id: string, message: string): Promise<void> {
  const { error } = await db()
    .from('backtest_runs')
    .update({ status: 'failed', error: message, completed_at: new Date().toISOString() })
    .eq('id', id);
  if (error) log.error({ error: error.message }, 'db failBacktestRun failed');
}

export async function getBacktestRuns(limit = 20): Promise<BacktestRun[]> {
  const { data, error } = await db()
    .from('backtest_runs')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(limit);
  if (error) { log.error({ error: error.message }, 'db getBacktestRuns failed'); return []; }
  return (data ?? []).map(rowToBacktestRun);
}

export async function getBacktestRun(id: string): Promise<{
  run: BacktestRun | null;
  trades: BacktestTrade[];
}> {
  const [runRes, tradesRes] = await Promise.all([
    db().from('backtest_runs').select('*').eq('id', id).single(),
    db().from('backtest_trades').select('*').eq('backtest_run_id', id)
      .order('entry_time', { ascending: true }),
  ]);
  if (runRes.error) { log.error({ error: runRes.error.message }, 'db getBacktestRun failed'); return { run: null, trades: [] }; }
  return {
    run:    rowToBacktestRun(runRes.data),
    trades: (tradesRes.data ?? []).map(rowToBacktestTrade),
  };
}

// --- Attribution ---

/**
 * Returns resolved signal outcomes joined with tactical intelligence fields.
 * Uses the service-role client to bypass RLS on signal_outcomes.
 * Only rows with outcome != PENDING are returned.
 */
export async function getAttributionRows(hours = 720): Promise<AttributionRow[]> {
  const admin = createSupabaseAdminClient();
  const cutoff = new Date(Date.now() - hours * 3_600_000).toISOString();

  const { data: outcomes, error: outErr } = await admin
    .from('signal_outcomes')
    .select('id, signal_id, outcome, rr_achieved, pnl_pct, duration_hours, ai_validated, risk_grade, confidence, timeframe, scanner_mode, symbol, signal_type, rr_ratio, created_at, resolved_at')
    .neq('outcome', 'PENDING')
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false })
    .limit(2000);

  if (outErr || !outcomes?.length) {
    if (outErr) log.error({ error: outErr.message }, 'db getAttributionRows outcomes failed');
    return [];
  }

  const signalIds = Array.from(new Set(outcomes.map((o: Record<string, unknown>) => o.signal_id).filter(Boolean))) as string[];
  if (!signalIds.length) return [];

  const { data: signals, error: sigErr } = await admin
    .from('signals')
    .select('id, market_regime, institutional_score, signal_state, extension_risk, mcap_tier, sector_name, continuation_probability, regime_alignment_score')
    .in('id', signalIds);

  if (sigErr) log.error({ error: sigErr.message }, 'db getAttributionRows signals failed');

  const sigMap = new Map<string, Record<string, unknown>>();
  for (const s of (signals ?? []) as Record<string, unknown>[]) {
    sigMap.set(s.id as string, s);
  }

  return (outcomes as Record<string, unknown>[]).map(o => {
    const sig = sigMap.get(o.signal_id as string);
    return {
      signalId:                o.signal_id as string,
      symbol:                  o.symbol    as string,
      signalType:              o.signal_type as SignalType,
      timeframe:               o.timeframe   as Timeframe,
      scannerMode:             o.scanner_mode as ScannerMode,
      confidence:              Number(o.confidence),
      aiValidated:             Boolean(o.ai_validated),
      riskGrade:               o.risk_grade as RiskGrade | undefined,
      rrRatio:                 Number(o.rr_ratio),
      outcome:                 o.outcome as 'TP_HIT' | 'SL_HIT' | 'TIMEOUT',
      rrAchieved:              o.rr_achieved    != null ? Number(o.rr_achieved)    : undefined,
      pnlPct:                  o.pnl_pct        != null ? Number(o.pnl_pct)        : undefined,
      durationHours:           o.duration_hours != null ? Number(o.duration_hours) : undefined,
      createdAt:               new Date(o.created_at as string),
      resolvedAt:              o.resolved_at ? new Date(o.resolved_at as string) : undefined,
      marketRegime:            sig?.market_regime            as MarketRegime  | undefined,
      institutionalScore:      sig?.institutional_score  != null ? Number(sig.institutional_score)  : undefined,
      signalState:             sig?.signal_state              as SignalState   | undefined,
      extensionRisk:           sig?.extension_risk            as ExtensionRisk | undefined,
      mcapTier:                sig?.mcap_tier                 as McapTier      | undefined,
      sectorName:              sig?.sector_name               as SectorName    | undefined,
      continuationProbability: sig?.continuation_probability != null ? Number(sig.continuation_probability) : undefined,
      regimeAlignmentScore:    sig?.regime_alignment_score   != null ? Number(sig.regime_alignment_score)   : undefined,
    } satisfies AttributionRow;
  });
}

// --- Private helpers ---

function rowToCoin(row: Record<string, unknown>): CoinData {
  return {
    id:             row.coingecko_id as string,
    symbol:         row.symbol as string,
    name:           row.name as string,
    rank:           Number(row.rank),
    price:          Number(row.price),
    marketCap:      Number(row.market_cap),
    volume24h:      Number(row.volume_24h),
    priceChange24h: Number(row.price_change_24h),
    binanceSymbol:  row.binance_symbol as string,
    hasFutures:     Boolean(row.has_futures),
  };
}

function rowToBacktestRun(row: Record<string, unknown>): BacktestRun {
  const metrics: BacktestMetrics | undefined = row.total_trades
    ? {
        totalTrades:        Number(row.total_trades),
        winRate:            Number(row.win_rate)      || 0,
        lossRate:           Number(row.loss_rate)     || 0,
        timeoutRate:        Number(row.timeout_rate)  || 0,
        avgRR:              Number(row.avg_rr)        || 0,
        profitFactor:       Number(row.profit_factor) || 0,
        totalReturn:        Number(row.total_return)  || 0,
        maxDrawdown:        Number(row.max_drawdown)  || 0,
        avgWin:             Number(row.avg_win)       || 0,
        avgLoss:            Number(row.avg_loss)      || 0,
        bestTrade:          Number(row.best_trade)    || 0,
        worstTrade:         Number(row.worst_trade)   || 0,
        sharpeRatio:        Number(row.sharpe_ratio)  || 0,
        avgDurationCandles: Number(row.avg_duration_candles) || 0,
        equityCurve:        (row.equity_curve as number[]) || [0],
      }
    : undefined;

  return {
    id:           row.id as string,
    strategyName: row.strategy_name as string,
    mode:         row.mode as BacktestRun['mode'],
    coinsTested:  Number(row.coins_tested)  || 0,
    totalTrades:  Number(row.total_trades)  || 0,
    status:       row.status as BacktestRun['status'],
    metrics,
    config:       (row.config as BacktestConfig),
    startedAt:    new Date(row.started_at as string),
    completedAt:  row.completed_at ? new Date(row.completed_at as string) : undefined,
    error:        row.error as string | undefined,
  };
}

function rowToBacktestTrade(row: Record<string, unknown>): BacktestTrade {
  return {
    id:                  row.id as string,
    backtestRunId:       row.backtest_run_id as string,
    symbol:              row.symbol as string,
    type:                row.type as 'BUY' | 'SELL',
    entryPrice:          Number(row.entry_price),
    exitPrice:           Number(row.exit_price),
    stopLoss:            Number(row.stop_loss),
    takeProfit:          Number(row.take_profit),
    rrRatio:             Number(row.rr_ratio),
    outcome:             row.outcome as BacktestTrade['outcome'],
    pnlPct:              Number(row.pnl_pct),
    entryTime:           new Date(row.entry_time as string),
    exitTime:            row.exit_time ? new Date(row.exit_time as string) : undefined,
    durationCandles:     Number(row.duration_candles),
    exitReason:          row.exit_reason as BacktestTrade['exitReason'],
    rsiAtEntry:          row.rsi_at_entry != null ? Number(row.rsi_at_entry) : undefined,
    volumeSpikeAtEntry:  row.volume_spike  != null ? Number(row.volume_spike)  : undefined,
  };
}

type TechnicalTrend = 'BULLISH' | 'BEARISH' | 'RANGING';

function rowToSignal(row: Record<string, unknown>): TradingSignal {
  const contProb = row.continuation_probability != null ? Number(row.continuation_probability) : undefined;
  return {
    id: row.id as string,
    scanRunId: row.scan_run_id as string | undefined,
    symbol: row.symbol as string,
    name: row.name as string,
    type: row.type as TradingSignal['type'],
    timeframe: row.timeframe as TradingSignal['timeframe'],
    scannerMode: row.scanner_mode as TradingSignal['scannerMode'],
    entryPrice: Number(row.entry_price),
    targetPrice: Number(row.target_price),
    stopLoss: Number(row.stop_loss),
    rrRatio: Number(row.rr_ratio),
    confidence: Number(row.confidence),
    indicators: {
      rsi: Number(row.rsi) || 50,
      macd: { macd: 0, signal: 0, histogram: Number(row.macd_histogram) || 0 },
      ema20: 0,
      ema50: 0,
      atr: Number(row.atr) || 0,
      volumeSpike: Number(row.volume_spike) || 1,
      currentPrice: Number(row.entry_price),
      trend: (row.ema_trend as TechnicalTrend) || 'RANGING',
    },
    setupDescription: (row.setup_description as string) || '',
    aiValidated:      Boolean(row.ai_validated),
    aiReasoning:      row.ai_reasoning      as string | undefined,
    aiExplainability: row.ai_explainability as AIExplainability | undefined ?? undefined,
    risks:            (row.risks     as string[]) || [],
    strengths:        (row.strengths as string[]) || [],
    telegramSent: Boolean(row.telegram_sent),
    createdAt: new Date(row.created_at as string),
    // Phase 6.7 tactical intelligence
    marketRegime:          row.market_regime      as TradingSignal['marketRegime']    ?? undefined,
    institutionalScore:    row.institutional_score != null ? Number(row.institutional_score) : undefined,
    signalState:           row.signal_state        as TradingSignal['signalState']     ?? undefined,
    extensionRisk:         row.extension_risk      as TradingSignal['extensionRisk']   ?? undefined,
    mcapTier:              row.mcap_tier           as TradingSignal['mcapTier']        ?? undefined,
    sectorName:            row.sector_name         as TradingSignal['sectorName']      ?? undefined,
    regimeAlignmentScore:  row.regime_alignment_score != null ? Number(row.regime_alignment_score) : undefined,
    continuation:          contProb != null
      ? { continuationProbability: contProb, exhaustionRisk: 'low', momentumHealth: 'healthy', reasons: [] }
      : undefined,
    // Phase 7.x intelligence pipeline
    breakoutType:       row.breakout_type       as string | undefined ?? undefined,
    breakoutStrength:   row.breakout_strength   as string | undefined ?? undefined,
    oiInterpretation:   row.oi_interpretation   as string | undefined ?? undefined,
    fundingTrend:       row.funding_trend        as string | undefined ?? undefined,
    positioningContext: row.positioning_context  as string | undefined ?? undefined,
    trendScore:         row.trend_score  != null ? Number(row.trend_score) : undefined,
    sectorStatus:       row.sector_status        as string | undefined ?? undefined,
    validationSource:   row.validation_source    as 'CLAUDE' | 'HEURISTIC' | undefined ?? undefined,
    // PHASE.9.P1 — outcome-derived probability + RiskGrade 2.0 (NULL pre-migration)
    empiricalWr:        row.empirical_wr    != null ? Number(row.empirical_wr) : null,
    empiricalN:         row.empirical_n     != null ? Number(row.empirical_n)  : null,
    empiricalGrade:     (row.empirical_grade as string | null) ?? null,
  };
}
