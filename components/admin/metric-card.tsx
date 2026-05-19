import type { ReactNode } from 'react'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'

type Accent = 'bull' | 'bear' | 'neutral' | 'warning' | 'info' | 'purple'

const ACCENT: Record<Accent, { text: string; border: string }> = {
  bull:    { text: 'text-bull-default',   border: 'border-bull-default/20' },
  bear:    { text: 'text-bear-default',   border: 'border-bear-default/20' },
  neutral: { text: 'text-terminal-text',  border: 'border-terminal-border' },
  warning: { text: 'text-signal-high',    border: 'border-signal-high/20' },
  info:    { text: 'text-signal-medium',  border: 'border-signal-medium/20' },
  purple:  { text: 'text-signal-purple',  border: 'border-signal-purple/20' },
}

function Skel({ w, h }: { w: string; h: string }) {
  return <div className={`skeleton rounded ${w} ${h}`} />
}

interface MetricCardProps {
  label: string
  value: ReactNode
  sub?: string
  delta?: number
  accent?: Accent
  icon?: ReactNode
  loading?: boolean
  className?: string
}

export function MetricCard({
  label, value, sub, delta, accent = 'neutral', icon, loading, className = '',
}: MetricCardProps) {
  const { text, border } = ACCENT[accent]

  if (loading) {
    return (
      <div className={`glass-card rounded-lg p-4 border border-terminal-border ${className}`}>
        <Skel w="w-20" h="h-2.5" />
        <div className="mt-3 mb-1"><Skel w="w-16" h="h-7" /></div>
        <Skel w="w-24" h="h-2.5" />
      </div>
    )
  }

  return (
    <div className={`glass-card rounded-lg p-4 border ${border} ${className}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-terminal-muted text-[9px] uppercase tracking-[0.13em] font-semibold">{label}</span>
        {icon && <span className={`${text} opacity-50`}>{icon}</span>}
      </div>

      <div className={`font-mono font-bold text-[22px] leading-none ${text}`}>{value}</div>

      <div className="flex items-center gap-2 mt-1.5">
        {sub && <span className="text-terminal-muted text-[11px]">{sub}</span>}
        {delta != null && (
          <span className={[
            'flex items-center gap-0.5 text-[11px] font-mono',
            delta > 0 ? 'text-bull-default' : delta < 0 ? 'text-bear-default' : 'text-terminal-muted',
          ].join(' ')}>
            {delta > 0 ? <TrendingUp size={9} /> : delta < 0 ? <TrendingDown size={9} /> : <Minus size={9} />}
            {delta > 0 ? '+' : ''}{delta.toFixed(1)}%
          </span>
        )}
      </div>
    </div>
  )
}
