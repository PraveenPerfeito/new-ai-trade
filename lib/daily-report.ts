import { createLogger } from './logger';
import { getAttributionRows } from './supabase';
import { computeAttribution } from './outcome-attribution';

const log = createLogger('lib/daily-report');

const TOKEN   = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

async function sendTg(text: string): Promise<boolean> {
  if (!TOKEN || !CHAT_ID) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });
    if (!res.ok) {
      log.error({ status: res.status }, 'daily report send failed');
      return false;
    }
    return true;
  } catch (err) {
    log.error({ err }, 'daily report network error');
    return false;
  }
}

function pct(n: number | null): string {
  return n != null ? `${(n * 100).toFixed(1)}%` : '—';
}
function exp(n: number | null): string {
  if (n == null) return '—';
  return n > 0 ? `+${n.toFixed(2)}R` : `${n.toFixed(2)}R`;
}

export function formatDailyReport(hours = 24): Promise<{ text: string; dataRows: number }> {
  return getAttributionRows(hours).then(rows => {
    const report = computeAttribution(rows, hours);
    const now = new Date().toISOString().replace('T', ' ').slice(0, 16);

    let text = `<b>📊 DAILY INTELLIGENCE REPORT</b>\n`;
    text += `<i>${now} UTC · Last ${hours}h</i>\n\n`;

    text += `<b>Signal Outcomes</b>\n`;
    text += `Resolved: ${report.resolvedRows} signals\n`;

    if (report.insufficient) {
      text += `\n⏳ Insufficient data for attribution (≥20 resolved signals needed).\n`;
      text += `Keep running scans — attribution populates automatically.\n`;
    } else {
      const ai   = report.aiEffectiveness.aiApproved;
      const heur = report.aiEffectiveness.heuristic;

      text += `\n<b>AI vs Heuristic</b>\n`;
      text += `AI-validated: ${ai.total} · WR ${pct(ai.winRate)} · E ${exp(ai.expectancy)}\n`;
      text += `Heuristic: ${heur.total} · WR ${pct(heur.winRate)} · E ${exp(heur.expectancy)}\n`;
      if (report.aiEffectiveness.aiEdgeDelta != null) {
        const delta = report.aiEffectiveness.aiEdgeDelta;
        text += delta > 0
          ? `✅ AI adding +${(delta * 100).toFixed(1)}% edge\n`
          : `⚠️ Heuristic outperforming AI by ${(-delta * 100).toFixed(1)}%\n`;
      }

      if (report.dimensions.byRegime.length > 0) {
        text += `\n<b>Regime Performance (top 3)</b>\n`;
        for (const d of report.dimensions.byRegime.slice(0, 3)) {
          text += `${d.label}: ${d.total} sig · WR ${pct(d.winRate)} · E ${exp(d.expectancy)}\n`;
        }
      }

      if (report.dimensions.bySignalState.length > 0) {
        text += `\n<b>Signal State Breakdown</b>\n`;
        for (const d of report.dimensions.bySignalState.slice(0, 4)) {
          text += `${d.label}: ${d.total} · WR ${pct(d.winRate)}\n`;
        }
      }

      if (report.edgePatterns.length > 0) {
        text += `\n<b>Top Edge Pattern</b>\n`;
        const top = report.edgePatterns[0];
        text += `${top.label}\n`;
        text += `  WR ${pct(top.winRate)} · E ${exp(top.expectancy)} · ${top.total} signals\n`;
      }

      const highImpact = report.recommendations.filter(r => r.impact === 'HIGH' && r.direction !== 'MONITOR');
      if (highImpact.length > 0) {
        text += `\n<b>⚠️ Calibration Alerts</b>\n`;
        for (const rec of highImpact.slice(0, 2)) {
          text += `• ${rec.parameter}: ${rec.insight}\n`;
        }
      }
    }

    if (report.dataGap) {
      const tactCount = report.dimensions.byRegime.reduce((s, d) => s + d.total, 0);
      text += `\n<i>Note: Most signals predate Phase 6.7 — tactical attribution covers ${tactCount} of ${report.resolvedRows} signals.</i>\n`;
    }

    return { text, dataRows: report.resolvedRows };
  });
}

export async function generateDailyReport(): Promise<{ sent: boolean; dataRows?: number; error?: string }> {
  try {
    const { text, dataRows } = await formatDailyReport(24);
    const sent = await sendTg(text);
    log.info({ sent, dataRows }, 'daily intelligence report dispatched');
    return { sent, dataRows };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.error({ err }, 'generateDailyReport failed');
    return { sent: false, error };
  }
}
