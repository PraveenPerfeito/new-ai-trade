import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { MessageCircle } from 'lucide-react'
import { OverviewSignalsFeed } from '@/components/member/overview-signals-feed'

export const dynamic = 'force-dynamic'

interface StatTileProps {
  label: string
  value: string
  sub: string
  color: string
}

function StatTile({ label, value, sub, color }: StatTileProps) {
  return (
    <div className="bg-[#0d0d14] border border-white/[0.07] rounded-xl p-5">
      <p className={`text-xs uppercase tracking-wider mb-2 ${color}`}>{label}</p>
      <p className="text-3xl font-mono font-bold text-white tabular-nums">{value}</p>
      <p className="text-xs text-gray-600 mt-1">{sub}</p>
    </div>
  )
}

function fmtPct(n: number): string {
  return `${Math.round(n * 100)}%`
}

export default async function MemberOverviewPage() {
  // ── Session ────────────────────────────────────────────────────────────────
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } },
  )
  const { data: { user } } = await supabase.auth.getUser()

  // ── Stats ──────────────────────────────────────────────────────────────────
  const admin  = createSupabaseAdminClient()
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const since7d  = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  const [todayRes, outcomesRes, telegramRes] = await Promise.all([
    admin
      .from('signals')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', since24h),
    admin
      .from('signal_outcomes')
      .select('outcome, rr_achieved')
      .gte('created_at', since7d)
      .in('outcome', ['TP_HIT', 'SL_HIT', 'TIMEOUT']),
    admin
      .from('signals')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', since7d)
      .eq('telegram_sent', true),
  ])

  // Active signals: signals from last 7d with no resolved outcome
  const { data: resolvedIdsData } = await admin
    .from('signal_outcomes')
    .select('signal_id')
    .gte('created_at', since7d)
    .not('outcome', 'eq', 'PENDING')
  const resolvedIds = (resolvedIdsData ?? []).map((r: { signal_id: string }) => r.signal_id)

  const { count: total7d } = await admin
    .from('signals')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', since7d)
  const activeCount = Math.max(0, (total7d ?? 0) - resolvedIds.length)

  const signalsToday   = todayRes.count ?? 0
  const telegramSent7d = telegramRes.count ?? 0

  const outcomes = (outcomesRes.data ?? []) as { outcome: string; rr_achieved: number | null }[]
  const tp       = outcomes.filter(o => o.outcome === 'TP_HIT').length
  const sl       = outcomes.filter(o => o.outcome === 'SL_HIT').length
  const total    = outcomes.length

  const winRate7d     = total >= 5 ? tp / total : null
  const winners       = outcomes.filter(o => o.outcome === 'TP_HIT')
  const avgWinnerRR   = winners.length > 0
    ? winners.reduce((s, o) => s + (o.rr_achieved ?? 2.0), 0) / winners.length
    : 2.0
  const wr            = total === 0 ? 0 : tp / total
  const expectancy7d  = total >= 5 ? (wr * avgWinnerRR) - ((1 - wr) * 1.0) : null
  const grossProfit   = winners.reduce((s, o) => s + (o.rr_achieved ?? 2.0), 0)
  const grossLoss     = outcomes.filter(o => o.outcome === 'SL_HIT')
    .reduce((s, o) => s + Math.abs(o.rr_achieved ?? 1.0), 0)
  const profitFactor  = total >= 5 && grossLoss > 0 ? grossProfit / grossLoss : null

  // Date header
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })

  const winRateDisplay  = winRate7d     != null ? fmtPct(winRate7d)                  : '—'
  const expDisplay      = expectancy7d  != null
    ? `${expectancy7d > 0 ? '+' : ''}${expectancy7d.toFixed(2)}R`
    : '—'
  const pfDisplay       = profitFactor  != null ? profitFactor.toFixed(2)            : '—'

  return (
    <div>
      {/* Page header */}
      <div className="flex items-start justify-between mb-8 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-white">Dashboard</h1>
          <p className="text-gray-500 text-sm mt-0.5">{today}</p>
        </div>
      </div>

      {/* 4 stat tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatTile
          label="Active Signals"
          value={String(activeCount)}
          sub="within signal window"
          color="text-blue-400"
        />
        <StatTile
          label="Win Rate 7D"
          value={winRateDisplay}
          sub={total >= 5 ? `${total} resolved` : 'min 5 needed'}
          color="text-emerald-400"
        />
        <StatTile
          label="Expectancy 7D"
          value={expDisplay}
          sub="avg R per signal"
          color="text-cyan-400"
        />
        <StatTile
          label="Signals Today"
          value={String(signalsToday)}
          sub="generated last 24h"
          color="text-purple-400"
        />
      </div>

      {/* 2-col grid: Recent Signals | Performance Snapshot */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 mb-6">
        {/* Left: Recent Signals */}
        <div className="lg:col-span-3">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-white">Recent Signals</h2>
            <a href="/dashboard/signals/active" className="text-xs text-cyan-400 hover:underline">
              View all →
            </a>
          </div>
          <OverviewSignalsFeed />
        </div>

        {/* Right: Performance Snapshot */}
        <div className="lg:col-span-2">
          <h2 className="text-sm font-semibold text-white mb-4">Performance · 7D</h2>
          <div className="bg-[#0d0d14] border border-white/[0.07] rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500 uppercase tracking-wider">Win Rate</span>
              <span className={`text-sm font-mono font-bold tabular-nums ${winRate7d != null ? 'text-emerald-400' : 'text-gray-600'}`}>
                {winRateDisplay}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500 uppercase tracking-wider">Profit Factor</span>
              <span className={`text-sm font-mono font-bold tabular-nums ${profitFactor != null ? 'text-cyan-400' : 'text-gray-600'}`}>
                {pfDisplay}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500 uppercase tracking-wider">Expectancy</span>
              <span className={`text-sm font-mono font-bold tabular-nums ${expectancy7d != null ? (expectancy7d >= 0 ? 'text-blue-400' : 'text-red-400') : 'text-gray-600'}`}>
                {expDisplay}
              </span>
            </div>
            <div className="border-t border-white/[0.06] pt-3 flex items-center justify-between">
              <div className="flex gap-4 text-xs text-gray-400">
                <span><span className="text-emerald-400 font-bold">{tp}</span> TP</span>
                <span><span className="text-red-400 font-bold">{sl}</span> SL</span>
                <span><span className="text-gray-400 font-bold">{outcomes.filter(o => o.outcome === 'TIMEOUT').length}</span> Timeout</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Alerts delivered card */}
      <div className="bg-[#0d0d14] border border-white/[0.07] rounded-xl p-5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <MessageCircle size={18} className="text-cyan-400 shrink-0" />
          <div>
            <p className="text-white text-sm font-medium">Alerts Delivered This Week</p>
            <p className="text-gray-500 text-xs mt-0.5">Signals sent via Telegram channel</p>
          </div>
        </div>
        <p className="text-2xl font-mono font-bold text-cyan-400 tabular-nums">{telegramSent7d}</p>
      </div>
    </div>
  )
}
