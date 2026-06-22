'use client'

export interface ProviderCheckResult {
  name: string
  healthy: boolean
  latencyMs: number
  note?: string
  error?: string
}

const PROVIDER_ORDER = ['Binance', 'CMC', 'CoinGecko', 'Claude', 'WhatsApp', 'Supabase', 'Redis', 'CloudAMQP']
const PROVIDER_ROLE: Record<string, string> = {
  Binance:   'OHLCV / Futures',
  CMC:       'Market Intelligence',
  CoinGecko: 'Fallback Data',
  Claude:    'AI Validation',
  WhatsApp:  'Alert Delivery',
  Supabase:  'Database / Auth',
  Redis:     'Cache / Pub-Sub',
  CloudAMQP: 'Task Broker',
}

export function ProviderHealthTable({ providers }: { providers: ProviderCheckResult[] }) {
  const sorted = PROVIDER_ORDER.map(n => providers.find(p => p.name === n)).filter(Boolean) as ProviderCheckResult[]
  return (
    <div className="glass-card rounded-xl p-4 overflow-x-auto">
      <p className="text-zinc-500 text-[10px] uppercase tracking-wide mb-3 font-medium">
        Provider Health — 8 Services
      </p>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-zinc-600 text-[10px] uppercase">
            <th className="text-left pb-2 font-medium w-28">Provider</th>
            <th className="text-left pb-2 font-medium">Role</th>
            <th className="text-right pb-2 font-medium w-16">Status</th>
            <th className="text-right pb-2 font-medium w-16">Latency</th>
            <th className="text-left pb-2 font-medium pl-3">Note</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800/50">
          {sorted.map(p => (
            <tr key={p.name}>
              <td className="py-1.5 text-zinc-200 font-medium">{p.name}</td>
              <td className="py-1.5 text-zinc-500">{PROVIDER_ROLE[p.name] ?? ''}</td>
              <td className="py-1.5 text-right">
                <span className={`font-mono font-bold text-[10px] uppercase ${p.healthy ? 'text-emerald-400' : 'text-red-400'}`}>
                  {p.healthy ? '✓ Up' : '✗ Down'}
                </span>
              </td>
              <td className="py-1.5 text-right font-mono text-zinc-500">
                {p.latencyMs > 0 ? `${p.latencyMs}ms` : '—'}
              </td>
              <td className="py-1.5 pl-3 text-zinc-600 max-w-xs truncate">
                {p.error
                  ? <span className="text-red-400/80">{p.error}</span>
                  : p.note ?? ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
