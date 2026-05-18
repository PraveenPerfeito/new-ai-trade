import { TradingSignal, TPHitEvent, SLHitEvent, DailySummaryData } from '@/types';

const TOKEN   = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// ─── Helpers ────────────────────────────────────────────────────────────────

function confBar(n: number): string {
  const filled = Math.round(n / 10);
  return '█'.repeat(filled) + '░'.repeat(10 - filled);
}

function pct(a: number, b: number): string {
  return (Math.abs(a - b) / b * 100).toFixed(2);
}

function fmt(n: number): string {
  // Auto-format price: many decimals for small values, few for large
  if (n >= 1000) return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (n >= 1)    return n.toFixed(4);
  return n.toPrecision(5);
}

function timeStr(d: Date): string {
  return d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

async function sendMessage(text: string): Promise<boolean> {
  if (!TOKEN || !CHAT_ID) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id:                  CHAT_ID,
        text,
        parse_mode:               'HTML',
        disable_web_page_preview: true,
      }),
    });
    if (!res.ok) {
      console.error('[Telegram] sendMessage failed:', await res.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error('[Telegram] network error:', err);
    return false;
  }
}

// ─── TP/SL level helpers ────────────────────────────────────────────────────

function tpLevels(s: TradingSignal): { tp1: number; tp2: number; tp3: number } {
  const atr = s.indicators.atr;
  const dir = s.type === 'BUY' ? 1 : -1;
  return {
    tp1: s.entryPrice + dir * atr * 1.0,
    tp2: s.entryPrice + dir * atr * 2.0,
    tp3: s.entryPrice + dir * atr * 3.0,
  };
}

// ─── Alert formatters ────────────────────────────────────────────────────────

export function formatSpotAlert(s: TradingSignal): string {
  const isBuy   = s.type === 'BUY';
  const header  = isBuy ? '🟢 SPOT LONG SIGNAL' : '🔴 SPOT SHORT SIGNAL';
  const { tp1, tp2, tp3 } = tpLevels(s);
  const slRisk  = pct(s.entryPrice, s.stopLoss);
  const trend   = s.indicators.trend;
  const trendIcon = trend === 'BULLISH' ? '📈' : trend === 'BEARISH' ? '📉' : '↔️';

  const strengths = s.strengths?.map(x => `✅ ${x}`).join('\n') ?? '';
  const risks     = s.risks?.map(x => `⚠️ ${x}`).join('\n') ?? '';
  const separator = strengths && risks ? '\n' : '';

  return `${header}
━━━━━━━━━━━━━━━━━━━━━━━━━━
🪙 <b>${s.name}</b>  (<code>${s.symbol}</code>)
⏱ Timeframe: <b>${s.timeframe.toUpperCase()}</b>  ${trendIcon} ${trend}

🎯 <b>Confidence</b>
<code>${confBar(s.confidence)}</code>  <b>${s.confidence}%</b>

💰 <b>Trade Levels</b>
  Entry   →  <code>${fmt(s.entryPrice)}</code>
  TP1     →  <code>${fmt(tp1)}</code>  (+${pct(tp1, s.entryPrice)}%)
  TP2     →  <code>${fmt(tp2)}</code>  (+${pct(tp2, s.entryPrice)}%)
  TP3     →  <code>${fmt(tp3)}</code>  (+${pct(tp3, s.entryPrice)}%)
  Stop    →  <code>${fmt(s.stopLoss)}</code>  (−${slRisk}%)
  R:R     →  <b>1:${s.rrRatio.toFixed(2)}</b>

📊 <b>Indicators</b>
  RSI:     ${s.indicators.rsi.toFixed(1)}
  MACD:    ${s.indicators.macd.histogram > 0 ? '▲ Bullish' : '▼ Bearish'}  (hist: ${s.indicators.macd.histogram.toFixed(6)})
  EMA20:   ${fmt(s.indicators.ema20)}  |  EMA50: ${fmt(s.indicators.ema50)}
  Volume:  ${s.indicators.volumeSpike.toFixed(2)}× avg
  ATR:     ${fmt(s.indicators.atr)}

🤖 <b>AI Analysis</b>
<i>${s.aiReasoning ?? s.setupDescription}</i>

${strengths}${separator}${risks}
━━━━━━━━━━━━━━━━━━━━━━━━━━
⏰ ${timeStr(s.createdAt)}
<i>Not financial advice. Trade responsibly.</i>`;
}

export function formatFuturesAlert(s: TradingSignal): string {
  const isLong  = s.type === 'BUY';
  const header  = isLong ? '🟢 FUTURES LONG' : '🔴 FUTURES SHORT';
  const dir     = isLong ? 'LONG' : 'SHORT';
  const { tp1, tp2, tp3 } = tpLevels(s);
  const slRisk  = pct(s.entryPrice, s.stopLoss);
  const trend   = s.indicators.trend;
  const trendIcon = trend === 'BULLISH' ? '📈' : trend === 'BEARISH' ? '📉' : '↔️';

  const strengths = s.strengths?.map(x => `✅ ${x}`).join('\n') ?? '';
  const risks     = s.risks?.map(x => `⚠️ ${x}`).join('\n') ?? '';
  const separator = strengths && risks ? '\n' : '';

  return `${header}  [PERP]
━━━━━━━━━━━━━━━━━━━━━━━━━━
🪙 <b>${s.name}</b>  (<code>${s.symbol}</code>)
⏱ Timeframe: <b>${s.timeframe.toUpperCase()}</b>  |  Direction: <b>${dir}</b>  ${trendIcon}

🎯 <b>Confidence</b>
<code>${confBar(s.confidence)}</code>  <b>${s.confidence}%</b>

💰 <b>Trade Levels</b>
  Entry   →  <code>${fmt(s.entryPrice)}</code>
  TP1     →  <code>${fmt(tp1)}</code>  (+${pct(tp1, s.entryPrice)}%)
  TP2     →  <code>${fmt(tp2)}</code>  (+${pct(tp2, s.entryPrice)}%)
  TP3     →  <code>${fmt(tp3)}</code>  (+${pct(tp3, s.entryPrice)}%)
  Stop    →  <code>${fmt(s.stopLoss)}</code>  (−${slRisk}%)
  R:R     →  <b>1:${s.rrRatio.toFixed(2)}</b>

📊 <b>Indicators</b>
  RSI:     ${s.indicators.rsi.toFixed(1)}
  MACD:    ${s.indicators.macd.histogram > 0 ? '▲ Bullish' : '▼ Bearish'}
  EMA20:   ${fmt(s.indicators.ema20)}  |  EMA50: ${fmt(s.indicators.ema50)}
  Volume:  ${s.indicators.volumeSpike.toFixed(2)}× avg
  ATR:     ${fmt(s.indicators.atr)}

⚡ <b>Futures Note</b>
Use 5-10× leverage max. Set stop as hard SL order immediately.
Scale out: 40% at TP1 → 35% at TP2 → trail rest to TP3.

🤖 <b>AI Analysis</b>
<i>${s.aiReasoning ?? s.setupDescription}</i>

${strengths}${separator}${risks}
━━━━━━━━━━━━━━━━━━━━━━━━━━
⏰ ${timeStr(s.createdAt)}
<i>Not financial advice. Futures carry high risk.</i>`;
}

export function formatTPHit(e: TPHitEvent): string {
  const isLong = e.signal.type === 'BUY';
  const { tp1, tp2, tp3 } = tpLevels(e.signal);
  const gainPct = pct(e.hitPrice, e.signal.entryPrice);

  const nextAction: Record<1 | 2 | 3, string> = {
    1: '→ Move stop to breakeven. Let remaining 60% ride to TP2.',
    2: '→ Move stop above entry (+0.5 ATR). Trail to TP3.',
    3: '→ Full position closed. Excellent trade! 🏆',
  };

  const remainingLevels = e.tpLevel < 3
    ? `\n  TP${e.tpLevel === 1 ? 2 : 3}  →  <code>${fmt(e.tpLevel === 1 ? tp2 : tp3)}</code>  (next target)`
    : '';

  return `${isLong ? '✅' : '✅'} <b>TP${e.tpLevel} HIT — ${e.signal.symbol}</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━
${isLong ? '🟢' : '🔴'} ${e.signal.type}  |  ${e.signal.timeframe.toUpperCase()}  |  ${e.signal.scannerMode.replace('_', ' ').toUpperCase()}

💰 <b>Performance</b>
  Entry    →  <code>${fmt(e.signal.entryPrice)}</code>
  Hit at   →  <code>${fmt(e.hitPrice)}</code>  (+${gainPct}% 🎯)
  TP1      →  <code>${fmt(tp1)}</code>${e.tpLevel >= 1 ? '  ✅' : ''}
  TP2      →  <code>${fmt(tp2)}</code>${e.tpLevel >= 2 ? '  ✅' : ''}
  TP3      →  <code>${fmt(tp3)}</code>${e.tpLevel >= 3 ? '  ✅' : ''}
  Stop     →  <code>${fmt(e.signal.stopLoss)}</code>${remainingLevels}

📋 <b>Position Management</b>
${nextAction[e.tpLevel]}

⏰ ${timeStr(e.hitTime)}`;
}

export function formatSLHit(e: SLHitEvent): string {
  const isLong  = e.signal.type === 'BUY';
  const lossPct = pct(e.hitPrice, e.signal.entryPrice);
  const { tp1, tp2, tp3 } = tpLevels(e.signal);

  return `🛑 <b>STOP LOSS HIT — ${e.signal.symbol}</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━
${isLong ? '🟢' : '🔴'} ${e.signal.type}  |  ${e.signal.timeframe.toUpperCase()}  |  ${e.signal.scannerMode.replace('_', ' ').toUpperCase()}

💸 <b>Result</b>
  Entry    →  <code>${fmt(e.signal.entryPrice)}</code>
  SL hit   →  <code>${fmt(e.hitPrice)}</code>  (−${lossPct}%)
  R:R was  →  1:${e.signal.rrRatio.toFixed(2)}  (planned)
  TP1      →  <code>${fmt(tp1)}</code>  (not reached)
  TP2      →  <code>${fmt(tp2)}</code>
  TP3      →  <code>${fmt(tp3)}</code>

📋 <b>Trade Review</b>
→ Stop worked as intended — capital protected.
→ Review: Was the MTF alignment still valid at entry?
→ Check if news/macro event invalidated the setup.
→ Next opportunity: wait for re-entry confirmation.

⏰ ${timeStr(e.hitTime)}
<i>Losses are part of trading. Risk was managed correctly.</i>`;
}

export function formatDailySummary(d: DailySummaryData): string {
  const winRate = d.totalSignals > 0
    ? ((d.highConfSignals / d.totalSignals) * 100).toFixed(0)
    : '0';

  const bestLine = d.bestSignal
    ? `\n⭐ <b>Best Signal:</b> ${d.bestSignal.type} ${d.bestSignal.symbol}  (${d.bestSignal.confidence}% conf  |  R:R 1:${d.bestSignal.rrRatio.toFixed(2)})`
    : '';

  return `📊 <b>DAILY SCAN REPORT</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━
📅 <b>${d.date}</b>

🔍 <b>Coverage</b>
  Scans run:      ${d.totalScans}
  Coins analyzed: ${d.coinsAnalyzed}

📈 <b>Signal Stats</b>
  Total signals:  ${d.totalSignals}
  High conf ≥85%: ${d.highConfSignals}  (${winRate}%)
  BUY setups:     ${d.buySignals}  🟢
  SELL setups:    ${d.sellSignals}  🔴
${bestLine}

💡 <b>Summary</b>
${d.highConfSignals >= 3
  ? '✅ Strong session — multiple high-quality setups identified.'
  : d.totalSignals >= 1
  ? '⚡ Moderate session — a few opportunities available.'
  : '😴 Quiet session — market lacked clear directional setups.'}

━━━━━━━━━━━━━━━━━━━━━━━━━━
<i>Not financial advice. All signals are informational only.</i>`;
}

function formatScanSummaryText(
  coinsScanned: number,
  signalsFound: number,
  highConf: number,
  durationMs: number,
  mode: string,
): string {
  const modeLabel = mode.replace('_', ' ').toUpperCase();
  const icon = signalsFound > 0 ? '📡' : '📭';
  return `${icon} <b>Scan Complete</b>  [${modeLabel}]
━━━━━━━━━━━━━━━━━━━━━━━━━━
⏱ Duration:   ${(durationMs / 1000).toFixed(1)}s
🔍 Scanned:   ${coinsScanned} coins
📊 Signals:   ${signalsFound} found
⭐ High conf: ${highConf} (≥85%)
━━━━━━━━━━━━━━━━━━━━━━━━━━
${signalsFound === 0 ? '<i>No signals met quality filters this scan.</i>' : `<i>${signalsFound} signal${signalsFound > 1 ? 's' : ''} sent above.</i>`}`;
}

// ─── Public send functions ───────────────────────────────────────────────────

export async function sendSignalAlert(signal: TradingSignal): Promise<boolean> {
  const isFutures = signal.scannerMode === 'futures';
  const text = isFutures ? formatFuturesAlert(signal) : formatSpotAlert(signal);
  return sendMessage(text);
}

export async function sendTPHitAlert(event: TPHitEvent): Promise<boolean> {
  return sendMessage(formatTPHit(event));
}

export async function sendSLHitAlert(event: SLHitEvent): Promise<boolean> {
  return sendMessage(formatSLHit(event));
}

export async function sendDailySummary(data: DailySummaryData): Promise<boolean> {
  return sendMessage(formatDailySummary(data));
}

export async function sendScanSummary(
  coinsScanned: number,
  signalsFound: number,
  highConf: number,
  durationMs: number,
  mode = 'spot',
): Promise<boolean> {
  return sendMessage(formatScanSummaryText(coinsScanned, signalsFound, highConf, durationMs, mode));
}
