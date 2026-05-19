type Color = 'green' | 'yellow' | 'orange' | 'red'

function colorOf(score: number): Color {
  if (score >= 80) return 'green'
  if (score >= 65) return 'yellow'
  if (score >= 50) return 'orange'
  return 'red'
}

const COLORS: Record<Color, { stroke: string; glow: string; textClass: string }> = {
  green:  { stroke: '#00d084', glow: 'rgba(0,208,132,0.25)',  textClass: 'text-bull-default' },
  yellow: { stroke: '#f59e0b', glow: 'rgba(245,158,11,0.25)', textClass: 'text-signal-high' },
  orange: { stroke: '#f97316', glow: 'rgba(249,115,22,0.25)', textClass: 'text-orange-400' },
  red:    { stroke: '#ff3b5c', glow: 'rgba(255,59,92,0.25)',  textClass: 'text-bear-default' },
}

interface ScoreRingProps {
  score: number
  size?: number
  strokeWidth?: number
  label?: string
  sublabel?: string
}

export function ScoreRing({ score, size = 120, strokeWidth = 8, label, sublabel }: ScoreRingProps) {
  const r   = (size - strokeWidth) / 2
  const cx  = size / 2
  const cy  = size / 2
  const c   = 2 * Math.PI * r
  const off = c * (1 - Math.max(0, Math.min(100, score)) / 100)

  const { stroke, glow, textClass } = COLORS[colorOf(score)]

  return (
    <div className="flex flex-col items-center gap-2">
      <svg width={size} height={size} style={{ filter: `drop-shadow(0 0 10px ${glow})` }}>
        {/* Track */}
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth={strokeWidth} />
        {/* Arc */}
        <circle
          cx={cx} cy={cy} r={r}
          fill="none"
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={off}
          transform={`rotate(-90 ${cx} ${cy})`}
          style={{ transition: 'stroke-dashoffset 0.9s cubic-bezier(.4,0,.2,1)' }}
        />
        {/* Score */}
        <text
          x={cx} y={cy - size * 0.06}
          textAnchor="middle" dominantBaseline="middle"
          fill={stroke} fontSize={size * 0.22} fontWeight="700" fontFamily="ui-monospace,monospace"
        >
          {score}
        </text>
        <text
          x={cx} y={cy + size * 0.15}
          textAnchor="middle"
          fill="rgba(100,116,139,0.7)" fontSize={size * 0.09} fontFamily="ui-monospace,monospace"
        >
          /100
        </text>
      </svg>
      {label    && <p className={`text-sm font-semibold ${textClass}`}>{label}</p>}
      {sublabel && <p className="text-terminal-muted text-xs">{sublabel}</p>}
    </div>
  )
}
