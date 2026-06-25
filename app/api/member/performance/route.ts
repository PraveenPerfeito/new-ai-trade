import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { createLogger } from '@/lib/logger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const log = createLogger('api/member/performance')

type Period = '7d' | '30d' | '90d'

function getSince(period: Period): string {
  const days = period === '7d' ? 7 : period === '30d' ? 30 : 90
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
}

interface OutcomeRow {
  signal_id: string
  outcome: string
  rr_achieved: number | null
  created_at: string
}

interface SignalRow {
  id: string
  scanner_mode: string | null
  risk_grade: string | null
}

interface ModeStats {
  mode: string
  n: number
  tp: number
  winRate: number
  expectancy: number
  avgRR: number
}

interface GradeStats {
  grade: string
  n: number
  tp: number
  winRate: number
  expectancy: number
}

function calcExpectancy(tp: number, total: number, winners: OutcomeRow[]): number {
  if (total === 0) return 0
  const wr = tp / total
  const avgWinnerRR = winners.length > 0
    ? winners.reduce((sum, r) => sum + (r.rr_achieved ?? 2.0), 0) / winners.length
    : 2.0
  return (wr * avgWinnerRR) - ((1 - wr) * 1.0)
}

function calcProfitFactor(outcomes: OutcomeRow[]): number {
  const grossProfit = outcomes
    .filter(o => o.outcome === 'TP_HIT')
    .reduce((sum, o) => sum + (o.rr_achieved ?? 2.0), 0)
  const grossLoss = outcomes
    .filter(o => o.outcome === 'SL_HIT')
    .reduce((sum, o) => sum + Math.abs(o.rr_achieved ?? 1.0), 0)
  if (grossLoss === 0) return grossProfit > 0 ? 99 : 1
  return grossProfit / grossLoss
}

export async function GET(request: Request) {
  // Auth check
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } },
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const periodParam = searchParams.get('period') ?? '7d'
  const period: Period = ['7d', '30d', '90d'].includes(periodParam)
    ? (periodParam as Period)
    : '7d'

  const since = getSince(period)
  const admin = createSupabaseAdminClient()

  try {
    // Fetch outcomes
    const { data: outcomesData, error: outErr } = await admin
      .from('signal_outcomes')
      .select('signal_id, outcome, rr_achieved, created_at')
      .gte('created_at', since)
      .in('outcome', ['TP_HIT', 'SL_HIT', 'TIMEOUT'])

    if (outErr) {
      log.error({ err: outErr }, 'Failed to fetch signal_outcomes')
      return NextResponse.json({ error: 'DB error' }, { status: 500 })
    }

    const outcomes: OutcomeRow[] = outcomesData ?? []
    const tp      = outcomes.filter(o => o.outcome === 'TP_HIT').length
    const sl      = outcomes.filter(o => o.outcome === 'SL_HIT').length
    const timeout = outcomes.filter(o => o.outcome === 'TIMEOUT').length
    const total   = tp + sl + timeout
    const winners = outcomes.filter(o => o.outcome === 'TP_HIT')

    const winRate      = total === 0 ? 0 : tp / total
    const expectancy   = calcExpectancy(tp, total, winners)
    const profitFactor = calcProfitFactor(outcomes)

    // Fetch signals for mode + grade breakdown
    const signalIds = Array.from(new Set(outcomes.map(o => o.signal_id)))
    let signals: SignalRow[] = []
    if (signalIds.length > 0) {
      const { data: sigData } = await admin
        .from('signals')
        .select('id, scanner_mode, risk_grade')
        .in('id', signalIds)
      signals = sigData ?? []
    }

    const signalMap = new Map<string, SignalRow>(
      signals.map(s => [s.id, s])
    )

    // Group by scanner_mode
    const modeMap = new Map<string, OutcomeRow[]>()
    for (const o of outcomes) {
      const sig = signalMap.get(o.signal_id)
      const mode = sig?.scanner_mode ?? 'unknown'
      const arr = modeMap.get(mode) ?? []
      arr.push(o)
      modeMap.set(mode, arr)
    }

    const byMode: ModeStats[] = []
    for (const [mode, rows] of Array.from(modeMap.entries())) {
      const mTp    = rows.filter((r: OutcomeRow) => r.outcome === 'TP_HIT').length
      const mWins  = rows.filter((r: OutcomeRow) => r.outcome === 'TP_HIT')
      const mWr    = rows.length === 0 ? 0 : mTp / rows.length
      const mAvgRR = mWins.length > 0
        ? mWins.reduce((s: number, r: OutcomeRow) => s + (r.rr_achieved ?? 2.0), 0) / mWins.length
        : 0
      byMode.push({
        mode,
        n: rows.length,
        tp: mTp,
        winRate: mWr,
        expectancy: calcExpectancy(mTp, rows.length, mWins),
        avgRR: mAvgRR,
      })
    }
    byMode.sort((a, b) => b.n - a.n)

    // Group by risk_grade
    const gradeMap = new Map<string, OutcomeRow[]>()
    for (const o of outcomes) {
      const sig = signalMap.get(o.signal_id)
      const grade = sig?.risk_grade ?? 'unknown'
      const arr = gradeMap.get(grade) ?? []
      arr.push(o)
      gradeMap.set(grade, arr)
    }

    const GRADE_ORDER = ['A+', 'A', 'B+', 'B', 'C', 'D', 'F', 'unknown']
    const byGrade: GradeStats[] = []
    for (const [grade, rows] of Array.from(gradeMap.entries())) {
      const gTp   = rows.filter((r: OutcomeRow) => r.outcome === 'TP_HIT').length
      const gWins = rows.filter((r: OutcomeRow) => r.outcome === 'TP_HIT')
      const gWr   = rows.length === 0 ? 0 : gTp / rows.length
      byGrade.push({
        grade,
        n: rows.length,
        tp: gTp,
        winRate: gWr,
        expectancy: calcExpectancy(gTp, rows.length, gWins),
      })
    }
    byGrade.sort((a, b) => {
      const ai = GRADE_ORDER.indexOf(a.grade)
      const bi = GRADE_ORDER.indexOf(b.grade)
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
    })

    log.info({ period, total, tp, sl }, 'member/performance computed')

    return NextResponse.json({
      period,
      totals: { tp, sl, timeout, total, winRate, profitFactor, expectancy },
      byMode,
      byGrade,
    })
  } catch (err) {
    log.error({ err }, 'member/performance unexpected error')
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
