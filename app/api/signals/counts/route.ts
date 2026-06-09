import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { createLogger } from '@/lib/logger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const log = createLogger('api/signals/counts')

/**
 * GET /api/signals/counts
 * DB-authoritative signal counts — bypasses the limit=100 tactical query.
 * Returns signals_today (24h), active_signals (open positions),
 * win_rate_7d and expectancy_7d from resolved signal_outcomes.
 */
export async function GET() {
  try {
    const admin = createSupabaseAdminClient()
    const now   = new Date()
    const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
    const since7d  = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()

    const [todayRes, activeRes, outcomesRes] = await Promise.all([
      // Signals generated in the last 24 hours
      admin.from('signals').select('id', { count: 'exact', head: true }).gte('created_at', since24h),

      // Active open signals — not expired, not timed-out
      // We count signals that either have no outcome row yet, or have outcome=PENDING,
      // and were created within the last 7 days (older unresolved = stale, not "active")
      admin.from('signals')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', since7d)
        .not('id', 'in', `(select signal_id from signal_outcomes where outcome != 'PENDING')`),

      // Win rate + expectancy from resolved outcomes (7d)
      admin.from('signal_outcomes')
        .select('outcome, return_r')
        .gte('created_at', since7d)
        .in('outcome', ['TP_HIT', 'SL_HIT']),
    ])

    const signalsToday  = todayRes.count ?? 0
    const activeSignals = activeRes.count ?? 0

    let winRate7d    = 0
    let expectancy7d = 0
    let resolved7d   = 0

    const outcomes = outcomesRes.data ?? []
    if (outcomes.length > 0) {
      resolved7d   = outcomes.length
      const tpHits = outcomes.filter((o) => o.outcome === 'TP_HIT').length
      winRate7d    = Math.round((tpHits / resolved7d) * 100)
      // expectancy = average return_r across resolved (positive=profit, negative=loss)
      const returnsWithValue = outcomes.filter((o) => o.return_r != null)
      if (returnsWithValue.length > 0) {
        const sumR = returnsWithValue.reduce((s, o) => s + (o.return_r as number), 0)
        expectancy7d = Math.round((sumR / returnsWithValue.length) * 100) / 100
      }
    }

    return NextResponse.json({
      success:       true,
      signals_today:  signalsToday,
      active_signals: activeSignals,
      win_rate_7d:    winRate7d,
      expectancy_7d:  expectancy7d,
      resolved_7d:    resolved7d,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to fetch signal counts'
    log.error({ err: msg }, 'signal counts error')
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
