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

    const [todayRes, sig7dRes, outcomesRes, tgSentRes] = await Promise.all([
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

      // DB-authoritative telegram sends (7d) — avoids feed cap of 200
      admin.from('signals').select('id', { count: 'exact', head: true })
        .gte('created_at', since7d)
        .eq('telegram_sent', true),
    ])

    const signalsToday   = todayRes.count ?? 0
    const telegramSent7d = tgSentRes.count ?? 0
    const sig7dIds = (sig7dRes.data ?? []).map((s: { id: string }) => s.id).filter(Boolean)

    // Active = signals from last 7d with no resolved outcome.
    // Count DISTINCT signal IDs (not rows): a signal can have PENDING + TP_HIT/SL_HIT/TIMEOUT rows,
    // so counting rows instead of IDs caused undercounting (multi-row signals subtracted 2+).
    let activeSignals = sig7dIds.length
    if (sig7dIds.length > 0) {
      const { data: resolvedRows } = await admin
        .from('signal_outcomes')
        .select('signal_id')
        .in('signal_id', sig7dIds)
        .in('outcome', ['TP_HIT', 'SL_HIT', 'TIMEOUT'])
      const resolvedIds = new Set((resolvedRows ?? []).map((r: { signal_id: string }) => r.signal_id))
      activeSignals = sig7dIds.length - resolvedIds.size
    }

    let winRate7d       = 0
    let expectancy7d    = 0
    let resolved7d      = 0
    let profitFactor7d  = 0
    let avgRrAchieved7d = 0

    const outcomes = outcomesRes.data ?? []
    let tpCount7d = 0
    let slCount7d = 0
    if (outcomes.length > 0) {
      resolved7d   = outcomes.length
      const tpHits = outcomes.filter((o) => o.outcome === 'TP_HIT').length
      tpCount7d    = tpHits
      slCount7d    = outcomes.filter((o) => o.outcome === 'SL_HIT' || o.outcome === 'TIMEOUT').length
      winRate7d    = Math.round((tpHits / resolved7d) * 100)

      const tpReturns = outcomes.filter((o) => o.outcome === 'TP_HIT' && o.rr_achieved != null).map((o) => o.rr_achieved as number)
      const slReturns = outcomes.filter((o) => (o.outcome === 'SL_HIT' || o.outcome === 'TIMEOUT') && o.rr_achieved != null).map((o) => o.rr_achieved as number)

      // Canonical expectancy: winRate × avgWin − lossRate × avgLoss
      if (tpReturns.length > 0 || slReturns.length > 0) {
        const winRate  = tpHits / resolved7d
        const lossRate = slCount7d / resolved7d
        const avgWin   = tpReturns.length ? tpReturns.reduce((s, v) => s + v, 0) / tpReturns.length : 0
        const avgLoss  = slReturns.length ? Math.abs(slReturns.reduce((s, v) => s + v, 0) / slReturns.length) : 1
        expectancy7d   = Math.round((winRate * avgWin - lossRate * avgLoss) * 100) / 100
      }

      // Profit factor = gross profit / gross loss
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
      // open_signals = unresolved 7d signals (includes STALE past window); differs from ACTIVE stage (within window only)
      open_signals:         activeSignals,
      active_signals:       activeSignals,
      win_rate_7d:          winRate7d,
      expectancy_7d:        expectancy7d,
      resolved_7d:          resolved7d,
      profit_factor_7d:     profitFactor7d,
      avg_rr_achieved_7d:   avgRrAchieved7d,
      tp_count_7d:          tpCount7d,
      sl_count_7d:          slCount7d,
      telegram_sent_7d:     telegramSent7d,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to fetch signal counts'
    log.error({ err: msg }, 'signal counts error')
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
