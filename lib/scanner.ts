import {
  CoinData, TradingSignal, ScannerMode,
  ScannerConfig, ScanResult, TechnicalIndicators, MarketRegimeSnapshot,
} from '@/types';
import { getTop100ByMarketCap, filterHighVolume, filterByLiquidity, prioritizeCoins } from './coingecko';
import { getSpotKlines, getFuturesKlines, getFuturesSymbols } from './binance';
import {
  calculateAllIndicators,
  calcTrendStrength,
  calcVolatilityRating,
  confirmMultiTimeframe,
  VolatilityRating,
} from './indicators';
import { validateSignal } from './ai-validator';
import { validateRisk } from './risk';
import { analyzeFuturesIntelligence } from './futures-intelligence';
import { runMarketStructureChecks } from './market-structure';
import { getMarketRegime, scoreRegimeAlignment } from './market-regime';
import { analyzeContinuation } from './continuation';
import { computeSignalState } from './signal-state';
import { calcInstitutionalScore } from './institutional-score';
import { saveSignal, createScanRun, updateScanRun, upsertCoins } from './supabase';
import { sendSignalAlert, sendScanSummary } from './telegram';
import { assessEntryQuality } from './entry-quality';
import { getTierProfile } from './mcap-tiers';
import { classifySector } from './sectors';
import { sleep } from './utils';
import { createLogger } from './logger'
import { getEnv } from './env';

const log = createLogger('lib/scanner');

// ─── Scanner configurations per mode ───────────────────────────────────────
// NOTE: `timeframes` is kept for API compatibility but the scanner now always
// fetches 1h (entry) + 4h (trend filter) internally via confirmMultiTimeframe.
// minRRRatio is 2.0 across all modes — enforcing minimum 1:2 risk/reward.

const CONFIGS: Record<ScannerMode, ScannerConfig> = {
  spot: {
    minMarketCap:   500_000_000,
    minVolume24h:    50_000_000,
    minRRRatio:          2.0,   // 1:2 minimum
    minConfidence:       80,
    maxCoinsToScan:      50,
    timeframes:        ['1h', '4h'],
    scannerMode:       'spot',
  },
  futures: {
    minMarketCap: 1_000_000_000,
    minVolume24h:   200_000_000,
    minRRRatio:           2.0,
    minConfidence:        82,
    maxCoinsToScan:       40,
    timeframes:         ['1h', '4h'],
    scannerMode:        'futures',
  },
  high_confidence: {
    minMarketCap: 2_000_000_000,
    minVolume24h:   500_000_000,
    minRRRatio:           2.0,
    minConfidence:        87,   // tighter threshold for HC mode
    maxCoinsToScan:       30,
    timeframes:         ['1h', '4h'],
    scannerMode:        'high_confidence',
  },
  trending: {
    minMarketCap:   100_000_000,
    minVolume24h:    20_000_000,
    minRRRatio:          2.0,
    minConfidence:       78,
    maxCoinsToScan:      60,
    timeframes:        ['1h', '4h'],
    scannerMode:       'trending',
  },
};

// ─── Setup quality detection ────────────────────────────────────────────────

/**
 * Scores the quality of a trading setup using both the 1h (entry) and 4h
 * (trend) indicators. Returns a pre-AI score and a human-readable description.
 *
 * Scoring (max ~100, threshold 65 to proceed to AI):
 *   4h trend aligned:        +30  — higher TF is the trend filter (most weight)
 *   1h trend aligned:        +20  — entry TF must confirm
 *   RSI momentum zone (1h):  +15  — avoid overbought/oversold entries
 *   MACD histogram (1h):     +15  — entry TF momentum direction
 *   Volume spike >= 1.5×:    +10  — volume confirms move is real
 *   Trend strength bonus:    +10  — extra points for high-scoring trends
 *
 * Penalties:
 *   RSI extreme (>78 or <22): -25  — high reversal risk at extremes
 *   Volume below average:     -10  — weak conviction, likely to fail
 *   MACD conflicted:          -10  — momentum divergence is a warning
 */
export function detectSetup(
  ind1h: TechnicalIndicators,
  ind4h: TechnicalIndicators,
  type: 'BUY' | 'SELL',
  strength1h: number,
  strength4h: number,
): { hasSetup: boolean; description: string; preScore: number } {
  let score = 0;
  const reasons: string[] = [];

  if (type === 'BUY') {
    // 4h trend alignment — primary filter
    if (ind4h.trend === 'BULLISH') {
      score += 30;
      reasons.push(`4h bullish (EMA20 ${ind4h.ema20 > ind4h.ema50 ? '>' : '<'} EMA50)`);
    }
    // 1h trend alignment — entry confirmation
    if (ind1h.trend === 'BULLISH') {
      score += 20;
      reasons.push('1h bullish trend confirmed');
    }
    // RSI: ideal BUY zone is 48-70 — above neutral but not yet overbought
    if (ind1h.rsi >= 48 && ind1h.rsi <= 70) {
      score += 15;
      reasons.push(`RSI ${ind1h.rsi.toFixed(1)} in bullish momentum zone (48-70)`);
    } else if (ind1h.rsi > 78) {
      score -= 25; // overbought penalty — high reversal risk
    } else if (ind1h.rsi < 40) {
      score -= 5;
    }
    // MACD histogram (1h): positive = bullish momentum building
    if (ind1h.macd.histogram > 0) {
      score += 15;
      reasons.push('1h MACD histogram positive');
    } else {
      score -= 10; // MACD divergence is a warning sign
    }
    // Volume: spike confirms institutional buying
    if (ind1h.volumeSpike >= 1.5) {
      score += 10;
      reasons.push(`Volume spike ${ind1h.volumeSpike.toFixed(1)}× (${ind1h.volumeSpike >= 2 ? 'strong' : 'moderate'})`);
    } else if (ind1h.volumeSpike < 0.8) {
      score -= 10; // below-average volume = weak conviction
    }
  } else {
    // SELL setup — mirror logic
    if (ind4h.trend === 'BEARISH') {
      score += 30;
      reasons.push(`4h bearish (EMA20 ${ind4h.ema20 < ind4h.ema50 ? '<' : '>'} EMA50)`);
    }
    if (ind1h.trend === 'BEARISH') {
      score += 20;
      reasons.push('1h bearish trend confirmed');
    }
    // RSI: ideal SELL zone is 30-52 — below neutral but not yet oversold
    if (ind1h.rsi >= 30 && ind1h.rsi <= 52) {
      score += 15;
      reasons.push(`RSI ${ind1h.rsi.toFixed(1)} in bearish momentum zone (30-52)`);
    } else if (ind1h.rsi < 22) {
      score -= 25; // oversold penalty
    } else if (ind1h.rsi > 60) {
      score -= 5;
    }
    if (ind1h.macd.histogram < 0) {
      score += 15;
      reasons.push('1h MACD histogram negative');
    } else {
      score -= 10;
    }
    if (ind1h.volumeSpike >= 1.5) {
      score += 10;
      reasons.push(`Volume spike ${ind1h.volumeSpike.toFixed(1)}×`);
    } else if (ind1h.volumeSpike < 0.8) {
      score -= 10;
    }
  }

  // Bonus: strong trend scores on both timeframes add up to +10
  const combinedStrength = strength1h * 0.4 + strength4h * 0.6;
  if (combinedStrength > 60) {
    score += 10;
    reasons.push(`Strong trend score: ${combinedStrength.toFixed(0)}/100`);
  }

  return {
    hasSetup:    score >= 65,
    description: reasons.join('. '),
    preScore:    score,
  };
}

// ─── Trade level calculation ────────────────────────────────────────────────

/**
 * Calculates ATR-based entry, target, and stop-loss levels.
 *
 * ATR multipliers by mode:
 *   spot/trending:      target = 2× ATR, stop = 1× ATR → RR 1:2.0
 *   futures:            target = 2.5× ATR, stop = 1× ATR → RR 1:2.5
 *   high_confidence:    target = 3× ATR, stop = 1× ATR → RR 1:3.0
 *
 * Using ATR for levels is important because:
 *   1. It adapts to each coin's inherent volatility (BTC vs. altcoin)
 *   2. Stops are placed outside normal noise (1 ATR from entry)
 *   3. Target is a realistic multiple of the expected daily range
 */
export function tradeLevels(price: number, atr: number, type: 'BUY' | 'SELL', mode: ScannerMode) {
  const targetMult = mode === 'high_confidence' ? 3.0
                   : mode === 'futures'          ? 2.5
                   : 2.0; // spot and trending
  const stopMult = 1.0;

  const entry  = price;
  const target = type === 'BUY' ? price + atr * targetMult : price - atr * targetMult;
  const stop   = type === 'BUY' ? price - atr * stopMult   : price + atr * stopMult;
  const risk   = Math.abs(entry - stop);
  const reward = Math.abs(target - entry);

  return {
    entryPrice:  entry,
    targetPrice: target,
    stopLoss:    stop,
    rrRatio:     risk > 0 ? reward / risk : 0,
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function fetchKlines(coin: CoinData, interval: string, limit: number, mode: ScannerMode) {
  return mode === 'futures'
    ? getFuturesKlines(coin.binanceSymbol, interval, limit)
    : getSpotKlines(coin.binanceSymbol, interval, limit);
}

// ─── Single coin scan ───────────────────────────────────────────────────────

/**
 * Full pipeline for a single coin:
 *   1. Fetch 1h + 4h candles (100 each)
 *   2. Calculate indicators for both timeframes
 *   3. Multi-timeframe confirmation — reject if 1h/4h trends conflict
 *   4. Volatility gate — reject EXTREME (ATR > 8% of price on 1h)
 *   5. Trend strength gate — reject weak/choppy trends (combined < 30)
 *   5b. Market structure gate — sideways, overextension, candle structure,
 *       trend exhaustion, fake volume, S/R rejection, weak breakout
 *   6. Setup scoring (pre-AI) — must score ≥ 65/100
 *   7. Trade level calculation (ATR-based) — must achieve RR ≥ 2.0
 *   8. Risk engine — grade A-F gating
 *   9. Futures intelligence — funding rate, OI, momentum
 *  10. AI validation — final confidence scoring and reasoning
 *
 * Returns null at any rejection step to avoid noisy signals.
 */
export async function scanCoin(
  coin: CoinData,
  mode: ScannerMode,
  config: ScannerConfig,
  regime?: MarketRegimeSnapshot,
): Promise<TradingSignal | null> {
  try {
    // Step 1: Fetch both timeframes in parallel
    const [candles1h, candles4h] = await Promise.all([
      fetchKlines(coin, '1h', 100, mode),
      fetchKlines(coin, '4h', 100, mode),
    ]);

    // Need at least 60 candles for indicators to be reliable (EMA-50 + buffer)
    if (candles1h.length < 60 || candles4h.length < 60) return null;

    // Step 2: Calculate indicators
    const ind1h = calculateAllIndicators(candles1h);
    const ind4h = calculateAllIndicators(candles4h);

    // Step 3: Determine direction from 4h (higher TF leads)
    // 4h chart is the trend filter — we only take signals in its direction
    let signalType: 'BUY' | 'SELL';
    if      (ind4h.trend === 'BULLISH') signalType = 'BUY';
    else if (ind4h.trend === 'BEARISH') signalType = 'SELL';
    else return null; // 4h ranging → no clear direction, skip

    // Step 4: Multi-timeframe confirmation (1h must align with 4h)
    const mtf = confirmMultiTimeframe(ind1h, ind4h, signalType);
    if (!mtf.confirmed) {
      // Uncomment for verbose debugging:
      // console.log(`[Scanner] ${coin.symbol} MTF rejected: ${mtf.reason}`);
      return null;
    }

    // Step 5: Volatility gate — reject during extreme moves
    // Uses 1h ATR as it reflects current short-term volatility
    const volatility: VolatilityRating = calcVolatilityRating(ind1h.atr, ind1h.currentPrice);
    if (volatility === 'EXTREME') {
      log.info({ symbol: coin.symbol }, 'rejected — EXTREME volatility');
      return null;
    }

    // Step 6: Trend strength scoring
    const strength1h = calcTrendStrength(ind1h);
    const strength4h = calcTrendStrength(ind4h);
    const combinedStrength = strength1h * 0.4 + strength4h * 0.6;

    // Minimum combined strength of 30 — below this the trend is too weak/choppy
    if (combinedStrength < 30) return null;

    // Step 5b: Market structure gate — 10 structural filters (Phase 6.1: +3 new filters)
    const structure = runMarketStructureChecks(
      candles1h,
      ind1h.atr,
      ind1h.currentPrice,
      ind1h.volumeSpike,
      signalType,
      ind1h,  // enables euphoric-spike, fake-breakout, momentum-decline checks
    );
    if (!structure.pass) {
      log.info({ symbol: coin.symbol, reason: structure.rejectionReason }, 'structure gate rejected');
      return null;
    }
    // ADX available for context in subsequent steps (included in setupDescription)

    // Step 7: Setup quality scoring (pre-AI, fast)
    const { hasSetup, description } = detectSetup(ind1h, ind4h, signalType, strength1h, strength4h);
    if (!hasSetup) return null;

    // Step 8: Trade level calculation
    if (ind1h.atr === 0) return null; // not enough data
    const levels = tradeLevels(ind1h.currentPrice, ind1h.atr, signalType, mode);

    // Enforce RR ≥ 2.0 — reject poor risk/reward before expensive AI call
    if (levels.rrRatio < config.minRRRatio) return null;

    // Step 8.5: Market-cap tier profile + adaptive continuation gate
    const tierProfile = getTierProfile(coin.rank);
    // Small-cap noise gate: require stronger volume than usual
    if (ind1h.volumeSpike < tierProfile.volumeRequirement && tierProfile.tier === 'small') {
      log.info({ symbol: coin.symbol, tier: tierProfile.tier, volumeSpike: ind1h.volumeSpike }, 'rejected — insufficient volume for small-cap tier');
      return null;
    }

    // Step 9: Risk engine validation — reject unsafe setups before AI call
    const risk = validateRisk({
      entry:            levels.entryPrice,
      stopLoss:         levels.stopLoss,
      rrRatio:          levels.rrRatio,
      ind1h,
      ind4h,
      coin,
      signalType,
      mode,
      volatility,
      combinedStrength,
    });

    if (!risk.pass) {
      log.info({ symbol: coin.symbol, summary: risk.summary }, 'risk engine rejected');
      return null;
    }

    // Step 10: Futures intelligence (only for futures / high_confidence modes)
    let futuresData = undefined;
    if (mode === 'futures' || mode === 'high_confidence') {
      try {
        futuresData = await analyzeFuturesIntelligence({
          symbol:     coin.binanceSymbol,
          baseSymbol: coin.symbol,
          candles1h,
          ema20:      ind1h.ema20,
          atr:        ind1h.atr,
          rsi:        ind1h.rsi,
          trend:      ind1h.trend,
          signalType,
        });

        // Gate: reject when funding rate is extreme (>0.2% per 8h = 0.002)
        // — extreme funding means overcrowded trade and imminent flush risk
        if (Math.abs(futuresData.fundingRate) > 0.002) {
          log.info({ symbol: coin.symbol, fundingRate: futuresData.fundingRate }, 'rejected — extreme funding rate');
          return null;
        }
      } catch {
        // Non-fatal: proceed without futures data if API fails
      }
    }

    // Phase 6.1: Compute continuation + regime alignment before AI call
    const continuation    = analyzeContinuation(candles1h, ind1h, signalType);
    const regimeAlignment = regime ? scoreRegimeAlignment(signalType, regime.regime) : 0;

    // Phase 6.2: Entry quality assessment (pre-AI diagnostic)
    const entryQuality = assessEntryQuality(ind1h, ind4h, signalType, levels.rrRatio);
    // Reject high-extension-risk signals for small/mid caps — they amplify whipsaw
    if (entryQuality.extensionRisk === 'HIGH' && (tierProfile.tier === 'small' || tierProfile.tier === 'mid')) {
      log.info({ symbol: coin.symbol, tier: tierProfile.tier, extensionRisk: 'HIGH' }, 'rejected — high extension risk for small/mid-cap');
      return null;
    }

    // Reject low-continuation setups early (saves AI tokens)
    if (continuation.continuationProbability < tierProfile.continuationMinimum) {
      log.info({ symbol: coin.symbol, contProb: continuation.continuationProbability, minRequired: tierProfile.continuationMinimum }, 'rejected — insufficient continuation probability');
      return null;
    }

    // Step 11: AI validation (most expensive step — gated by all checks above)
    const draft = {
      symbol: coin.symbol,
      name: coin.name,
      type: signalType,
      timeframe: '1h' as const,  // entry timeframe
      scannerMode: mode,
      ...levels,
      confidence: 0,
      indicators: ind1h,
      setupDescription: `${description} | ADX: ${structure.adx.toFixed(0)}`,
      riskScore:              risk.riskScore,
      qualityScore:           risk.qualityScore,
      riskGrade:              risk.riskGrade,
      riskWarnings:           risk.warnings,
      maxSafeLeverage:        risk.maxSafeLeverage,
      positionSizeMultiplier: risk.positionSizeMultiplier,
      futuresData,
    };

    const ai = await validateSignal(draft, coin, ind4h, combinedStrength, volatility, continuation, regime);
    if (!ai.validated || ai.confidence < config.minConfidence) return null;

    // Phase 6.1: Compute post-AI intelligence fields
    const signalState      = computeSignalState(ind1h, ind4h, continuation, signalType);
    const institutionalScore = calcInstitutionalScore({
      aiConfidence:         ai.confidence,
      riskGrade:            risk.riskGrade,
      trendStrength:        combinedStrength,
      qualityScore:         risk.qualityScore,
      volatility,
      rrRatio:              levels.rrRatio,
      futuresMomentumScore: futuresData?.momentumScore,
      regimeAlignmentScore: regimeAlignment,
    });

    return {
      ...draft,
      confidence:           ai.confidence,
      aiValidated:          ai.validated,
      aiReasoning:          ai.reasoning,
      aiExplainability:     ai.explainability,
      risks:                ai.risks,
      strengths:            ai.strengths,
      telegramSent:         false,
      createdAt:            new Date(),
      // Phase 6.1 tactical intelligence
      signalState,
      institutionalScore,
      regimeAlignmentScore: regimeAlignment,
      marketRegime:         regime?.regime,
      continuation,
      // Phase 6.2 adaptive quant intelligence
      mcapTier:            tierProfile.tier,
      sectorName:          classifySector(coin.symbol),
      entryQualityScore:   entryQuality.score,
      extensionRisk:       entryQuality.extensionRisk,
      pullbackQuality:     entryQuality.pullbackQuality,
    };
  } catch (err) {
    log.error({ symbol: coin.symbol, err }, 'scanCoin error');
    return null;
  }
}

// ─── Full scan orchestration ────────────────────────────────────────────────

export async function runScan(
  mode: ScannerMode = 'spot',
  options?: { filterCoins?: string[] },
): Promise<ScanResult> {
  const t0 = Date.now();
  const config = CONFIGS[mode];
  const { SCANNER_DELAY_MS: delayMs, SCANNER_MIN_CONFIDENCE_ALERT: alertThreshold } = getEnv();

  log.info({ mode }, 'scan starting');
  const scanRunId = await createScanRun(mode);

  // Phase 6.1: Prefetch BTC market regime once per scan (cached 5 min)
  let regime: MarketRegimeSnapshot | undefined;
  try {
    regime = await getMarketRegime();
    log.info({ regime: regime.regime, btcRsi: regime.btcRsi4h.toFixed(1) }, 'regime loaded');
  } catch {
    log.warn('regime fetch failed — continuing without regime context');
  }

  try {
    // 1. Fetch top 100 from CoinGecko
    const allCoins = await getTop100ByMarketCap();
    log.info({ count: allCoins.length }, 'fetched coins from CoinGecko');

    // 2. Apply market-cap and volume filters
    let filtered = filterHighVolume(allCoins, config.minVolume24h);
    filtered = filterByLiquidity(filtered, config.minMarketCap);

    // 3. Futures mode: restrict to symbols that trade on Binance USDT-M futures
    if (mode === 'futures') {
      const futSet = await getFuturesSymbols();
      filtered = filtered
        .filter(c => futSet.has(c.binanceSymbol))
        .map(c => ({ ...c, hasFutures: true }));
    }

    // 4. Trending mode: sort by volume/marketcap ratio to find hot movers
    if (mode === 'trending') {
      filtered = filtered
        .filter(c => c.priceChange24h > 2 || c.volume24h / c.marketCap > 0.08)
        .sort((a, b) => (b.volume24h / b.marketCap) - (a.volume24h / a.marketCap));
    }

    // 5. Prioritise priority coins (BTC, ETH, SOL, …) then sort by quality score
    filtered = prioritizeCoins(filtered).slice(0, config.maxCoinsToScan);

    // 5b. Optional coin filter: restrict to specific symbols (single/multi/watchlist modes)
    if (options?.filterCoins?.length) {
      const targetSet = new Set(options.filterCoins.map(s => s.toUpperCase()));
      filtered = filtered.filter(c => targetSet.has(c.symbol.toUpperCase()));
      // If none of the requested coins made it through the market-cap/volume gates,
      // fall back to the unfiltered prioritised list so the scan always returns data.
      if (filtered.length === 0) {
        log.warn({ requested: options.filterCoins }, 'coin filter matched 0 after gates — falling back to full list');
        filtered = prioritizeCoins(await getTop100ByMarketCap()).slice(0, config.maxCoinsToScan);
      }
    }

    log.info({ count: filtered.length, mode }, 'scanning coins');

    // 6. Cache coin list in Supabase for the dashboard
    await upsertCoins(allCoins);

    const signals: TradingSignal[] = [];
    let coinsScanned = 0;

    // 7. Main scan loop — one scanCoin call per coin (MTF handled inside)
    for (const coin of filtered) {
      // Rate limiting: 300ms between coins → ~50 coins ≈ 15s scan time
      // Each scanCoin makes 2 Binance API calls (1h + 4h) plus 1 Claude call
      await sleep(delayMs);

      const signal = await scanCoin(coin, mode, config, regime);
      coinsScanned++;

      if (!signal) continue;

      signal.scanRunId = scanRunId ?? undefined;

      // Save to Supabase
      const id = await saveSignal(signal);
      if (id) signal.id = id;

      signals.push(signal);

      // Telegram alert only for high-confidence signals (default ≥ 85%)
      if (signal.confidence >= alertThreshold) {
        const sent = await sendSignalAlert(signal);
        if (sent) signal.telegramSent = true;
      }

      log.info({ type: signal.type, symbol: coin.symbol, confidence: signal.confidence, rrRatio: signal.rrRatio }, 'signal accepted');
    }

    const duration = Date.now() - t0;
    const highConf = signals.filter(s => s.confidence >= alertThreshold).length;

    if (scanRunId) {
      await updateScanRun(scanRunId, {
        coins_scanned: coinsScanned,
        signals_found: signals.length,
        status:        'completed',
        completed_at:  new Date().toISOString(),
      });
    }

    await sendScanSummary(coinsScanned, signals.length, highConf, duration, mode);
    log.info({ mode, coinsScanned, signals: signals.length, duration }, 'scan complete');

    return { scanRunId, signals, coinsScanned, duration, mode };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);

    if (scanRunId) {
      await updateScanRun(scanRunId, {
        status:       'failed',
        error:        msg,
        completed_at: new Date().toISOString(),
      });
    }
    throw err;
  }
}
