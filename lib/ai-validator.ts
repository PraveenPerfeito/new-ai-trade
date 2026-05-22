import Anthropic from '@anthropic-ai/sdk';
import { TradingSignal, AIValidationResult, AIExplainability, CoinData, TechnicalIndicators, ContinuationAnalysis, MarketRegimeSnapshot } from '@/types';
import { VolatilityRating } from './indicators';
import { clamp } from './utils';
import { createLogger } from './logger';
import { getEnv } from './env';

const log = createLogger('lib/ai-validator');

type DraftSignal = Omit<TradingSignal,
  'id' | 'scanRunId' | 'aiValidated' | 'aiReasoning' | 'risks' | 'strengths' | 'telegramSent' | 'createdAt'
>;

let _client: Anthropic | null = null;
function getClient(): Anthropic | null {
  const key = getEnv().ANTHROPIC_API_KEY;
  if (!key) return null;
  if (!_client) _client = new Anthropic({ apiKey: key });
  return _client;
}

/**
 * Validates a draft trading signal using Claude AI (or a heuristic fallback).
 *
 * Receives both the 1h entry indicators and the 4h trend indicators so Claude
 * has full multi-timeframe context rather than just the entry candle.
 * Also receives the combined trend strength score and volatility rating to
 * allow Claude to factor in overall market conditions.
 *
 * Claude model: claude-haiku (fast + cheap — runs once per coin per scan)
 * Fallback: heuristic scoring if no API key or on API error
 *
 * Returns AIValidationResult with:
 *   confidence:  0-100 (must be ≥ minConfidence to generate signal)
 *   validated:   true only if confidence ≥ 80
 *   reasoning:   2-3 sentence explanation of the rating
 *   risks:       list of identified weaknesses
 *   strengths:   list of identified strengths
 */
export async function validateSignal(
  signal: DraftSignal,
  coin: CoinData,
  ind4h: TechnicalIndicators,
  trendStrength: number,
  volatilityRating: VolatilityRating,
  continuation?: ContinuationAnalysis,
  regime?: MarketRegimeSnapshot,
): Promise<AIValidationResult> {
  const client = getClient();
  if (!client) return heuristic(signal, ind4h, trendStrength, volatilityRating, continuation, regime);

  const i1h = signal.indicators;

  const fd = signal.futuresData;
  const regimeSection = regime ? `
═══ MARKET REGIME ═══════════════════
BTC regime:     ${regime.regime}
BTC RSI (4h):   ${regime.btcRsi4h.toFixed(1)}
BTC trend (4h): ${regime.btcTrend4h}
BTC 24h change: ${regime.btc24hChange > 0 ? '+' : ''}${regime.btc24hChange.toFixed(2)}%
` : '';

  const continuationSection = continuation ? `
═══ CONTINUATION ANALYSIS ═══════════
Cont. probability: ${continuation.continuationProbability}%
Exhaustion risk:   ${continuation.exhaustionRisk.toUpperCase()}
Momentum health:   ${continuation.momentumHealth.toUpperCase()}
Factors:           ${continuation.reasons.slice(0, 3).join(' | ')}
` : '';

  const futuresSection = fd ? `
═══ FUTURES INTELLIGENCE ════════════
Funding rate:   ${(fd.fundingRate * 100).toFixed(4)}%  (${fd.fundingRateAnnualized.toFixed(1)}% ann.)  |  Bias: ${fd.fundingBias}
OI 24h change:  ${fd.oiChange24h > 0 ? '+' : ''}${fd.oiChange24h.toFixed(2)}%  |  Trend: ${fd.oiTrend}
L/S ratio:      ${fd.longShortRatio?.toFixed(2) ?? 'n/a'}  (Long ${fd.longAccountPercent?.toFixed(1) ?? '?'}% / Short ${fd.shortAccountPercent?.toFixed(1) ?? '?'}%)
Momentum score: ${fd.momentumScore}/100
${fd.breakout ? `Breakout:       ${fd.breakout.direction} +${fd.breakout.breakoutPct.toFixed(2)}%  |  Vol confirmed: ${fd.breakout.volumeConfirmed}` : 'Breakout:       none detected'}
Pullback:       ${fd.trendContinuation.isPullback ? `Yes — depth ${fd.trendContinuation.pullbackDepth}× ATR  |  Holding key level: ${fd.trendContinuation.holdingKeyLevel}  |  Cont. confidence: ${fd.trendContinuation.continuationConfidence}%` : 'No pullback pattern'}
Liq. zones:     ${fd.liquidationZones.length > 0 ? fd.liquidationZones.slice(0, 3).map(z => `$${z.price.toFixed(2)} (${z.side}, ${z.strength}, ${z.distancePct.toFixed(1)}%)`).join(' | ') : 'none within 10%'}
` : '';

  const prompt = `You are a professional crypto trader and quantitative analyst. Evaluate this trade setup with institutional rigor.
${regimeSection}${continuationSection}
═══ ASSET ═══════════════════════════
Symbol: ${signal.symbol} (${signal.name})
Direction: ${signal.type}  |  Mode: ${signal.scannerMode}
Rank: #${coin.rank}  |  Vol 24h: $${(coin.volume24h / 1e6).toFixed(0)}M  |  MCap: $${(coin.marketCap / 1e9).toFixed(1)}B

═══ 1H INDICATORS (entry timeframe) ═══
Price:      $${i1h.currentPrice}
Trend:      ${i1h.trend}
RSI(14):    ${i1h.rsi.toFixed(1)}
MACD hist:  ${i1h.macd.histogram.toFixed(6)} (${i1h.macd.histogram > 0 ? 'positive ▲' : 'negative ▼'})
EMA20:      $${i1h.ema20.toFixed(4)}  |  EMA50: $${i1h.ema50.toFixed(4)}
ATR(14):    $${i1h.atr.toFixed(4)}
Vol spike:  ${i1h.volumeSpike.toFixed(2)}×

═══ 4H INDICATORS (trend filter) ════
Trend:      ${ind4h.trend}
RSI(14):    ${ind4h.rsi.toFixed(1)}
MACD hist:  ${ind4h.macd.histogram.toFixed(6)} (${ind4h.macd.histogram > 0 ? 'positive ▲' : 'negative ▼'})
EMA20:      $${ind4h.ema20.toFixed(4)}  |  EMA50: $${ind4h.ema50.toFixed(4)}
${futuresSection}
═══ TRADE LEVELS ════════════════════
Entry:   $${signal.entryPrice}
Target:  $${signal.targetPrice}
Stop:    $${signal.stopLoss}
R:R:     1:${signal.rrRatio.toFixed(2)}

═══ QUALITY METRICS ════════════════
Trend strength score: ${trendStrength.toFixed(0)}/100
Volatility:           ${volatilityRating}
Setup:                ${signal.setupDescription}

═══ REJECTION CRITERIA ═════════════
Reject (confidence < 80) if ANY of these apply:
• 1h and 4h signals not aligned (already pre-filtered, but double-check)
• RSI overbought > 75 for BUY, or oversold < 25 for SELL
• Volume spike < 1.2× average
• R:R < 2.0
• EXTREME volatility (stop placement unreliable)
• Trend strength < 35 (choppy/weak market)
• MACD histogram direction conflicts with trade direction
• Setup description mentions conflicting signals
• Futures only: funding rate bias strongly against trade direction
• Futures only: momentum score < 35 (poor futures market structure)

Respond ONLY with valid JSON (no markdown, no text outside the JSON object):
{"confidence":<integer 0-100>,"validated":<boolean>,"reasoning":"<1-sentence overall verdict>","risks":["<risk>","<risk>"],"strengths":["<strength>","<strength>"],"trend":"<1-2 sentences on multi-TF trend structure and EMA alignment>","momentum":"<1-2 sentences on RSI zone, MACD histogram direction, and volume confirmation>","volatility":"<1 sentence on ATR-based volatility regime and stop reliability>","rationale":"<1 sentence explaining why confidence is at this specific level>","summary":"<one concise line: trade thesis + key edge>","continuationCase":"<1 sentence: why trend continuation is likely from this entry>","cautionCase":"<1 sentence: the main scenario that would invalidate this trade>","regimeNote":"<1 sentence: how the current market regime affects this setup>"}`;

  const AI_TIMEOUT_MS = 15_000; // 15 s hard ceiling — prevents scan pipeline stall

  try {
    const msg = await client.messages.create(
      {
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 768,
        messages:   [{ role: 'user', content: prompt }],
      },
      { timeout: AI_TIMEOUT_MS },
    );

    const text = msg.content[0].type === 'text' ? msg.content[0].text.trim() : '';
    const parsed = JSON.parse(text);
    const confidence = clamp(Number(parsed.confidence) || 0, 0, 100);

    const explainability: AIExplainability | undefined =
      parsed.trend && parsed.momentum && parsed.volatility && parsed.rationale && parsed.summary
        ? {
            trend:            String(parsed.trend),
            momentum:         String(parsed.momentum),
            volatility:       String(parsed.volatility),
            rationale:        String(parsed.rationale),
            summary:          String(parsed.summary),
            continuationCase: parsed.continuationCase ? String(parsed.continuationCase) : undefined,
            cautionCase:      parsed.cautionCase      ? String(parsed.cautionCase)      : undefined,
            regimeNote:       parsed.regimeNote       ? String(parsed.regimeNote)       : undefined,
          }
        : undefined;

    return {
      confidence,
      validated:      parsed.validated === true && confidence >= 80,
      reasoning:      String(parsed.reasoning || ''),
      risks:          Array.isArray(parsed.risks)     ? parsed.risks.map(String)     : [],
      strengths:      Array.isArray(parsed.strengths) ? parsed.strengths.map(String) : [],
      explainability,
    };
  } catch (err) {
    const isTimeout =
      err instanceof Error &&
      (err.message.includes('timeout') || err.message.includes('timed out') || err.name === 'APIConnectionTimeoutError');

    if (isTimeout) {
      log.warn(
        { symbol: signal.symbol, timeoutMs: AI_TIMEOUT_MS },
        'AI validator timeout — using heuristic fallback',
      );
    } else {
      log.error({ err, symbol: signal.symbol }, 'AI API error — using heuristic fallback');
    }
    return heuristic(signal, ind4h, trendStrength, volatilityRating);
  }
}

// ─── Heuristic fallback ─────────────────────────────────────────────────────

/**
 * Scores the signal using pure heuristic rules when Claude API is unavailable.
 * Mirrors the AI's rejection criteria as closely as possible.
 *
 * Score starts at 45 (neutral baseline) and is adjusted by:
 *   Multi-TF alignment:    ±25  (most important factor)
 *   RSI zone:              ±15
 *   MACD confirmation:     ±10
 *   Volume:                ±15
 *   Trend strength:        ±10
 *   R:R ratio:             ±10
 *   Volatility penalty:    -20 (HIGH), -40 (EXTREME)
 *
 * Score is clamped to [10, 95] — never produces 0 or 100 to distinguish
 * from "no data" and "perfect" which are reserved for edge cases.
 */
function heuristic(
  signal: DraftSignal,
  ind4h: TechnicalIndicators,
  trendStrength: number,
  volatilityRating: VolatilityRating,
  continuation?: ContinuationAnalysis,
  regime?: MarketRegimeSnapshot,
): AIValidationResult {
  const { indicators: i1h, type, rrRatio } = signal;
  let score = 45;
  const strengths: string[] = [];
  const risks: string[] = [];

  // ── 1. Multi-timeframe alignment (±25) ───────────────────────────────────
  const tfAligned = (type === 'BUY' && i1h.trend === 'BULLISH' && ind4h.trend === 'BULLISH')
                 || (type === 'SELL' && i1h.trend === 'BEARISH' && ind4h.trend === 'BEARISH');
  if (tfAligned) {
    score += 25;
    strengths.push(`1h + 4h both ${type === 'BUY' ? 'bullish' : 'bearish'} — multi-TF aligned`);
  } else {
    score -= 15;
    risks.push('Timeframe conflict: 1h and 4h trends not aligned');
  }

  // ── 2. RSI zone check (±15) ───────────────────────────────────────────────
  if (type === 'BUY') {
    if (i1h.rsi >= 48 && i1h.rsi <= 70) {
      score += 15;
      strengths.push(`RSI ${i1h.rsi.toFixed(1)} in bullish momentum zone (48-70)`);
    } else if (i1h.rsi > 75) {
      score -= 20;
      risks.push(`RSI overbought at ${i1h.rsi.toFixed(1)} — high reversal risk`);
    } else {
      score -= 5;
      risks.push(`RSI ${i1h.rsi.toFixed(1)} outside optimal zone`);
    }
  } else {
    if (i1h.rsi >= 30 && i1h.rsi <= 52) {
      score += 15;
      strengths.push(`RSI ${i1h.rsi.toFixed(1)} in bearish momentum zone (30-52)`);
    } else if (i1h.rsi < 25) {
      score -= 20;
      risks.push(`RSI oversold at ${i1h.rsi.toFixed(1)} — high reversal risk`);
    } else {
      score -= 5;
      risks.push(`RSI ${i1h.rsi.toFixed(1)} outside optimal zone`);
    }
  }

  // ── 3. MACD histogram direction (±10) ─────────────────────────────────────
  const macdAligned = (type === 'BUY' && i1h.macd.histogram > 0)
                   || (type === 'SELL' && i1h.macd.histogram < 0);
  if (macdAligned) {
    score += 10;
    strengths.push('MACD histogram confirms entry direction');
  } else {
    score -= 10;
    risks.push('MACD histogram diverges from trade direction — momentum conflict');
  }

  // ── 4. Volume confirmation (±15) ──────────────────────────────────────────
  if (i1h.volumeSpike >= 2.0) {
    score += 15;
    strengths.push(`Strong volume spike: ${i1h.volumeSpike.toFixed(1)}× — high conviction`);
  } else if (i1h.volumeSpike >= 1.4) {
    score += 8;
    strengths.push(`Above-average volume: ${i1h.volumeSpike.toFixed(1)}×`);
  } else if (i1h.volumeSpike < 1.0) {
    score -= 15;
    risks.push(`Below-average volume (${i1h.volumeSpike.toFixed(2)}×) — weak conviction`);
  }

  // ── 5. Trend strength (±10) ───────────────────────────────────────────────
  if (trendStrength >= 60) {
    score += 10;
    strengths.push(`High trend strength: ${trendStrength.toFixed(0)}/100`);
  } else if (trendStrength >= 40) {
    score += 5;
  } else {
    score -= 10;
    risks.push(`Weak trend strength: ${trendStrength.toFixed(0)}/100 — choppy market`);
  }

  // ── 6. R:R ratio (±10) ────────────────────────────────────────────────────
  if (rrRatio >= 2.5) {
    score += 10;
    strengths.push(`Excellent R:R ratio: 1:${rrRatio.toFixed(1)}`);
  } else if (rrRatio >= 2.0) {
    score += 5;
    strengths.push(`Solid R:R ratio: 1:${rrRatio.toFixed(1)}`);
  } else {
    score -= 15;
    risks.push(`R:R below minimum: 1:${rrRatio.toFixed(2)} (need ≥ 2.0)`);
  }

  // ── 7. Volatility penalty ──────────────────────────────────────────────────
  // EXTREME should already be rejected in scanner, but heuristic penalises anyway
  if (volatilityRating === 'EXTREME') {
    score -= 40;
    risks.push('EXTREME volatility — stops unreliable, likely news-driven');
  } else if (volatilityRating === 'HIGH') {
    score -= 15;
    risks.push('HIGH volatility — wider stops required, manage position size');
  } else if (volatilityRating === 'LOW') {
    score -= 5;
    risks.push('LOW volatility — limited momentum, breakout may be weak');
  }

  score = clamp(score, 10, 95);

  const tfAlignedForDesc = (type === 'BUY' && i1h.trend === 'BULLISH' && ind4h.trend === 'BULLISH')
                        || (type === 'SELL' && i1h.trend === 'BEARISH' && ind4h.trend === 'BEARISH');
  const macdAlignedForDesc = (type === 'BUY' && i1h.macd.histogram > 0)
                           || (type === 'SELL' && i1h.macd.histogram < 0);
  const dir = type === 'BUY' ? 'bullish' : 'bearish';

  const trendDesc = tfAlignedForDesc
    ? `Both 1h and 4h trends are ${dir}, with EMA alignment confirming the ${type === 'BUY' ? 'upward' : 'downward'} bias. Trend strength: ${trendStrength.toFixed(0)}/100.`
    : `Timeframe conflict: 1h is ${i1h.trend.toLowerCase()} but 4h is ${ind4h.trend.toLowerCase()}, reducing setup reliability. Trend strength: ${trendStrength.toFixed(0)}/100.`;

  const momentumDesc = `RSI at ${i1h.rsi.toFixed(1)} ${type === 'BUY' ? '(bullish zone: 48–70)' : '(bearish zone: 30–52)'} with MACD histogram ${macdAlignedForDesc ? 'confirming' : 'conflicting with'} entry direction. Volume spike: ${i1h.volumeSpike.toFixed(1)}× average${i1h.volumeSpike >= 2 ? ' — strong conviction' : i1h.volumeSpike >= 1.4 ? ' — above average' : ' — weak'}.`;

  const volatilityDesc = volatilityRating === 'EXTREME'
    ? 'EXTREME volatility — stop placement is unreliable and likely driven by news. Avoid entry.'
    : volatilityRating === 'HIGH'
    ? 'HIGH volatility — wider-than-normal stops required; reduce position size accordingly.'
    : volatilityRating === 'LOW'
    ? 'LOW volatility environment — momentum is limited and breakout potential is reduced.'
    : 'Normal volatility with reliable ATR-based stop placement.';

  const rationaleDesc = `Score ${score}/100 based on ${strengths.length} confirming factor${strengths.length !== 1 ? 's' : ''} and ${risks.length} risk flag${risks.length !== 1 ? 's' : ''}; ${tfAlignedForDesc ? 'MTF aligned' : 'MTF conflict'}, R:R 1:${rrRatio.toFixed(1)}.`;

  const summaryDesc = `${tfAlignedForDesc ? 'Multi-TF aligned' : 'Single-TF'} ${type === 'BUY' ? 'long' : 'short'} — R:R 1:${rrRatio.toFixed(1)}, trend strength ${trendStrength.toFixed(0)}/100, ${volatilityRating.toLowerCase()} volatility.`;

  const continuationCase = continuation
    ? continuation.momentumHealth === 'healthy'
      ? `Momentum is healthy (${continuation.continuationProbability}% continuation probability) with ${continuation.reasons[0] ?? 'supporting factors present'}.`
      : `Continuation probability is ${continuation.continuationProbability}% — momentum is ${continuation.momentumHealth}; ${continuation.reasons[0] ?? 'watch closely'}.`
    : undefined;

  const cautionCase = risks.length > 0
    ? `Primary risk: ${risks[0]}.`
    : `Monitor for reversal candles and loss of ${type === 'BUY' ? 'EMA20 support' : 'EMA20 resistance'}.`;

  const regimeNote = regime
    ? `Market regime is ${regime.regime} (BTC RSI ${regime.btcRsi4h.toFixed(0)}) — ${
        type === 'BUY' && (regime.regime === 'BULL_TREND' || regime.regime === 'EUPHORIA')
          ? 'macro tailwind supports long bias'
          : type === 'SELL' && (regime.regime === 'BEAR_TREND' || regime.regime === 'CAPITULATION')
          ? 'macro headwind supports short bias'
          : 'regime is neutral to mixed for this direction'
      }.`
    : undefined;

  return {
    confidence: score,
    validated:  score >= 80,
    reasoning:  `Heuristic: ${strengths.length} strength(s), ${risks.length} concern(s). Trend strength ${trendStrength.toFixed(0)}/100. Volatility: ${volatilityRating}. Score: ${score}/100.`,
    risks,
    strengths,
    explainability: {
      trend:      trendDesc,
      momentum:   momentumDesc,
      volatility: volatilityDesc,
      rationale:  rationaleDesc,
      summary:    summaryDesc,
      continuationCase,
      cautionCase,
      regimeNote,
    },
  };
}
