import { AlertOctagon, AlertTriangle, Info } from 'lucide-react'

type Severity = 'critical' | 'warning' | 'info'

const CONFIG: Record<Severity, { Icon: React.ElementType; bg: string; text: string; border: string }> = {
  critical: { Icon: AlertOctagon, bg: 'bg-bear-default/10',    text: 'text-bear-default',  border: 'border-bear-default/30' },
  warning:  { Icon: AlertTriangle, bg: 'bg-signal-high/10',    text: 'text-signal-high',   border: 'border-signal-high/30' },
  info:     { Icon: Info,          bg: 'bg-signal-medium/10',  text: 'text-signal-medium', border: 'border-signal-medium/30' },
}

interface AnomalyBadgeProps {
  severity: Severity
  className?: string
}

export function AnomalyBadge({ severity, className = '' }: AnomalyBadgeProps) {
  const { Icon, bg, text, border } = CONFIG[severity]
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-bold uppercase tracking-wide border ${bg} ${text} ${border} ${className}`}>
      <Icon size={11} />
      {severity}
    </span>
  )
}
