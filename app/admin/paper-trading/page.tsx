'use client'

import { useCallback } from 'react'
import { adminApi, PortfolioMetrics } from '@/lib/admin-api'
import { useAutoRefresh } from '@/lib/use-auto-refresh'
import { MetricCard } from '@/components/admin/metric-card'
import { DollarSign, TrendingUp, TrendingDown, Layers } from 'lucide-react'

function pnlColor(v: number) {
  return v > 0 ? 'text-bull-default' : v < 0 ? 'text-bear-default' : 'text-terminal-muted'
}

type Trade = {
  id: string
  symbol: string
  signal_type: string
  entry_price: number
  target_price: number
  stop_loss: number
  position_size: number
  status: string
  unrealized_pnl?: number
  realized_pnl?: number
  created_at: string
  closed_at?: string
}

export default function PaperTradingPage() {
  const portfolioFetcher = useCallback(() => adminApi.analytics.portfolio(), [])
  const tradesFetcher    = useCallback(async () => {
    const raw = await adminApi.analytics.trades(30, 'all')
    return { trades: (raw.trades as unknown as Trade[]), total: raw.total }
  }, [])

  const { data: portfolio, loading: pl } = useAutoRefresh<PortfolioMetrics>(portfolioFetcher, 30_000)
  const { data: tradesData, loading: tl } = useAutoRefresh<{ trades: Trade[]; total: number }>(tradesFetcher, 30_000)

  const trades  = tradesData?.trades ?? []
  const open    = trades.filter(t => t.status === 'OPEN')
  const closed  = trades.filter(t => t.status !== 'OPEN')

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-terminal-text text-lg font-semibold">Paper Trading</h1>
        <p className="text-terminal-muted text-xs mt-0.5">Virtual portfolio · Position tracking · Performance validation</p>
      </div>

      {/* Portfolio metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard
          label="Balance"
          value={portfolio ? `$${portfolio.balance.toFixed(0)}` : '—'}
          sub={portfolio?.initial_balance ? `started $${portfolio.initial_balance.toFixed(0)}` : ''}
          accent="info"
          icon={<DollarSign size={13} />}
          loading={pl}
        />
        <MetricCard
          label="Total Return"
          value={portfolio?.total_return_pct != null ? `${portfolio.total_return_pct > 0 ? '+' : ''}${portfolio.total_return_pct.toFixed(2)}%` : '—'}
          accent={!portfolio?.total_return_pct ? 'neutral' : portfolio.total_return_pct > 0 ? 'bull' : 'bear'}
          icon={<TrendingUp size={13} />}
          loading={pl}
        />
        <MetricCard
          label="Realized PnL"
          value={portfolio ? `${portfolio.total_pnl > 0 ? '+' : ''}$${portfolio.total_pnl.toFixed(2)}` : '—'}
          accent={!portfolio ? 'neutral' : portfolio.total_pnl > 0 ? 'bull' : 'bear'}
          icon={<DollarSign size={13} />}
          loading={pl}
        />
        <MetricCard
          label="Win Rate"
          value={portfolio?.win_rate != null ? `${(portfolio.win_rate * 100).toFixed(1)}%` : '—'}
          sub={`${portfolio?.total_trades ?? 0} trades`}
          accent={!portfolio?.win_rate ? 'neutral' : portfolio.win_rate >= 0.55 ? 'bull' : 'bear'}
          icon={<Layers size={13} />}
          loading={pl}
        />
      </div>

      {/* Open positions */}
      <div>
        <p className="text-terminal-muted text-[9px] uppercase tracking-widest mb-3">
          Open Positions ({portfolio?.open_trades ?? 0})
        </p>
        <div className="glass-card rounded-lg overflow-hidden">
          {tl ? (
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="px-4 py-3 border-b border-terminal-border/40 flex gap-3">
                <div className="skeleton h-3 w-20 rounded" />
                <div className="skeleton h-3 w-12 rounded" />
                <div className="skeleton h-3 w-16 rounded" />
              </div>
            ))
          ) : !open.length ? (
            <div className="px-5 py-6 text-center text-terminal-muted text-sm">No open positions</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs min-w-[600px]">
                <thead>
                  <tr className="border-b border-terminal-border">
                    {['Symbol', 'Type', 'Entry', 'Target', 'SL', 'Size', 'Unr. PnL', 'Opened'].map(h => (
                      <th key={h} className="text-terminal-muted text-[9px] uppercase tracking-wider text-left py-2 px-3">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {open.map(t => (
                    <tr key={t.id} className="border-b border-terminal-border/30 hover:bg-terminal-bright/10">
                      <td className="py-2.5 px-3 font-mono font-bold text-terminal-text">{t.symbol}</td>
                      <td className="py-2.5 px-3 font-mono font-bold">
                        <span className={t.signal_type === 'BUY' ? 'text-bull-default' : 'text-bear-default'}>{t.signal_type}</span>
                      </td>
                      <td className="py-2.5 px-3 font-mono text-terminal-text">{t.entry_price?.toFixed(4)}</td>
                      <td className="py-2.5 px-3 font-mono text-bull-default">{t.target_price?.toFixed(4)}</td>
                      <td className="py-2.5 px-3 font-mono text-bear-default">{t.stop_loss?.toFixed(4)}</td>
                      <td className="py-2.5 px-3 font-mono text-terminal-muted">{t.position_size}</td>
                      <td className={`py-2.5 px-3 font-mono font-bold ${pnlColor(t.unrealized_pnl ?? 0)}`}>
                        {t.unrealized_pnl != null ? `${t.unrealized_pnl > 0 ? '+' : ''}$${t.unrealized_pnl.toFixed(2)}` : '—'}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-terminal-muted/50 text-[10px]">
                        {new Date(t.created_at).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Recent closed trades */}
      {closed.length > 0 && (
        <div>
          <p className="text-terminal-muted text-[9px] uppercase tracking-widest mb-3">Recent Closed Trades</p>
          <div className="glass-card rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs min-w-[500px]">
                <thead>
                  <tr className="border-b border-terminal-border">
                    {['Symbol', 'Type', 'Status', 'Realized PnL', 'Opened', 'Closed'].map(h => (
                      <th key={h} className="text-terminal-muted text-[9px] uppercase tracking-wider text-left py-2 px-3">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {closed.slice(0, 20).map(t => (
                    <tr key={t.id} className="border-b border-terminal-border/30 hover:bg-terminal-bright/10">
                      <td className="py-2 px-3 font-mono text-terminal-text font-bold">{t.symbol}</td>
                      <td className="py-2 px-3 font-mono font-bold">
                        <span className={t.signal_type === 'BUY' ? 'text-bull-default' : 'text-bear-default'}>{t.signal_type}</span>
                      </td>
                      <td className="py-2 px-3">
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border font-mono ${
                          t.status.includes('TP') ? 'text-bull-default border-bull-default/30' : 'text-bear-default border-bear-default/30'
                        }`}>{t.status.replace('CLOSED_', '')}</span>
                      </td>
                      <td className={`py-2 px-3 font-mono font-bold ${pnlColor(t.realized_pnl ?? 0)}`}>
                        {t.realized_pnl != null ? `${t.realized_pnl > 0 ? '+' : ''}$${t.realized_pnl.toFixed(2)}` : '—'}
                      </td>
                      <td className="py-2 px-3 font-mono text-terminal-muted/50 text-[10px]">
                        {new Date(t.created_at).toLocaleDateString()}
                      </td>
                      <td className="py-2 px-3 font-mono text-terminal-muted/50 text-[10px]">
                        {t.closed_at ? new Date(t.closed_at).toLocaleDateString() : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
