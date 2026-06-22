import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { createLogger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api/signals/watchlist');

/**
 * Phase I — Alpha Promotion Watchlist
 * Returns recently validated signals that didn't reach the Telegram threshold,
 * sorted by empirical_wr DESC so the highest-probability near-misses float to top.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const limit  = Math.min(parseInt(url.searchParams.get('limit') ?? '20', 10), 50);
  const hours  = Math.min(parseInt(url.searchParams.get('hours') ?? '48',  10), 168);

  try {
    const admin = createSupabaseAdminClient();
    const cutoff = new Date(Date.now() - hours * 3_600_000).toISOString();

    const { data, error } = await admin
      .from('signals')
      .select([
        'id', 'symbol', 'type', 'scanner_mode', 'timeframe',
        'confidence', 'rr_ratio', 'entry_price', 'target_price', 'stop_loss',
        'risk_grade', 'market_regime', 'breakout_strength',
        'empirical_wr', 'empirical_n', 'empirical_grade',
        'telegram_sent', 'ai_validated', 'created_at',
      ].join(', '))
      .eq('ai_validated', true)
      .eq('telegram_sent', false)
      .gte('created_at', cutoff)
      .gte('confidence', 80)  // near-miss floor — lowest alert threshold is 82 (futures)
      .order('empirical_wr', { ascending: false, nullsFirst: false })
      .order('confidence', { ascending: false })
      .limit(limit);

    if (error) throw error;

    return NextResponse.json({
      success: true,
      signals: data ?? [],
      total:   (data ?? []).length,
      window_hours: hours,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err: msg }, 'Watchlist fetch failed');
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
