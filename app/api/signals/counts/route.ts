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

    const [todayRes, sig7dRes, outcomesRes] = await Promise.all([
      // Signals generated in the last 24 hours
      admin.from('signals').select('id', { count: 'exact', head: true }).gte('created_at', since24h),

      // All signal IDs from the last 7 days (to compute active count)
      admin.from('signals').select('id').gte('created_at', since7d),

      // Win rate + expectancy from resolved outcomes (7d)
      // Include TIMEOUT in denominator to match Edge tab formula
      admin.from('signal_outcomes')
        .select('outcome, rr_achieved')
        .gte('created_at', since7d)
        .in('outcome', ['TP_HIT', 'SL_HIT', 'TIMEOUT']),
    ])

    const signalsToday = todayRes.count ?? 0
    const sig7dIds = (sig7dRes.data ?? []).map((s: { id: string }) => s.id).filter(Boolean)

    // Active = signals from last 7d that have no resolved outcome
    // PostgREST doesn't support subqueries in filters, so we do a second query
    let activeSignals = sig7dIds.length
    if (sig7dIds.length > 0) {
      const { count: resolvedCount } = await admin
        .from('signal_outcomes')
        .select('signal_id', { count: 'exact', head: true })
        .in('signal_id', sig7dIds)
        .neq('outcome', 'PENDING')
      activeSignals = sig7dIds.length - (resolvedCount ?? 0)
    }

    let winRate7d       = 0
    let expectancy7d    = 0
    let resolved7d      = 0
    let profitFactor7d  = 0
    let avgRrAchieved7d = 0

    const outcomes = outcomesRes.data ?? []
    if (outcomes.length > 0) {
      resolved7d   = outcomes.length
      const tpHits = outcomes.filter((o) => o.outcome === 'TP_HIT').length
      winRate7d    = Math.round((tpHits / resolved7d) * 100)

      const returnsWithValue = outcomes.filter((o) => o.rr_achieved != null)
      if (returnsWithValue.length > 0) {
        const sumR = returnsWithValue.reduce((s, o) => s + (o.rr_achieved as number), 0)
        expectancy7d = Math.round((sumR / returnsWithValue.length) * 100) / 100
      }

      // Profit factor = gross profit / gross loss
      const tpReturns = outcomes.filter((o) => o.outcome === 'TP_HIT' && o.rr_achieved != null).map((o) => o.rr_achieved as number)
      const slReturns = outcomes.filter((o) => o.outcome === 'SL_HIT' && o.rr_achieved != null).map((o) => o.rr_achieved as number)
      if (tpReturns.length > 0 && slReturns.length > 0) {
        const grossProfit = tpReturns.reduce((s, v) => s + v, 0)
        const grossLoss   = Math.abs(slReturns.reduce((s, v) => s + v, 0))
        if (grossLoss > 0) profitFactor7d = Math.round((grossProfit / grossLoss) * 100) / 100
      }
      // Avg RR achieved = avg return_r on winning trades
      if (tpReturns.length > 0) {
        avgRrAchieved7d = Math.round((tpReturns.reduce((s, v) => s + v, 0) / tpReturns.length) * 100) / 100
      }
    }

    return NextResponse.json({
      success:              true,
      signals_today:        signalsToday,
      active_signals:       activeSignals,
      win_rate_7d:          winRate7d,
      expectancy_7d:        expectancy7d,
      resolved_7d:          resolved7d,
      profit_factor_7d:     profitFactor7d,
      avg_rr_achieved_7d:   avgRrAchieved7d,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to fetch signal counts'
    log.error({ err: msg }, 'signal counts error')
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
