'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard, Activity, ScanLine, Zap,
  Database, Server, AlertTriangle, BarChart3, Target, Settings2,
  Layers, Crosshair, Globe, Brain,
} from 'lucide-react'

type NavItem = {
  href: string
  icon: React.ElementType
  label: string
}

type NavSection = {
  label: string
  items: NavItem[]
  primary?: boolean
}

const SECTIONS: NavSection[] = [
  {
    label: 'TRADING DESK',
    primary: true,
    items: [
      { href: '/admin/overview',  icon: LayoutDashboard, label: 'Overview'   },
      { href: '/admin/signals',   icon: Zap,             label: 'Signals'    },
      { href: '/admin/tactical',  icon: Crosshair,       label: 'Tactical'   },
      { href: '/admin/settings',  icon: Settings2,       label: 'Settings'   },
    ],
  },
  {
    label: 'MARKET',
    items: [
      { href: '/admin/market',   icon: Activity, label: 'Intelligence' },
      { href: '/admin/regime',   icon: Target,   label: 'Regime'       },
      { href: '/admin/sectors',  icon: Globe,    label: 'Sectors'      },
    ],
  },
  {
    label: 'OPERATIONS',
    items: [
      { href: '/admin/scanner',   icon: ScanLine,      label: 'Scanner'   },
      { href: '/admin/anomalies', icon: AlertTriangle, label: 'Anomalies' },
      { href: '/admin/providers', icon: Database,      label: 'Providers' },
      { href: '/admin/cache',     icon: Layers,        label: 'Cache'     },
      { href: '/admin/system',    icon: Server,        label: 'System'    },
    ],
  },
  {
    label: 'REVIEW',
    items: [
      { href: '/admin/analytics',   icon: BarChart3, label: 'Analytics'   },
      { href: '/admin/calibration', icon: Brain,     label: 'Calibration' },
    ],
  },
]

export function AdminSidebar() {
  const path = usePathname()

  return (
    <aside className="w-[228px] shrink-0 flex flex-col h-screen sticky top-0 bg-terminal-surface border-r border-terminal-border">
      {/* Brand */}
      <div className="px-5 pt-5 pb-4 border-b border-terminal-border">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-bull-default/20 to-emerald-900/20 border border-bull-default/25 flex items-center justify-center shrink-0">
            <span className="text-bull-default text-[16px] font-bold font-mono leading-none">◈</span>
          </div>
          <div className="min-w-0">
            <p className="text-terminal-text text-sm font-semibold leading-tight tracking-wide">SignalEdge</p>
            <p className="text-terminal-muted/50 text-[10px] uppercase tracking-[0.18em] mt-0.5">Command Center</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-3 px-2.5">
        {SECTIONS.map((section, si) => {
          const topGap = si === 0
            ? ''
            : si === 1
              ? 'mt-4'
              : 'mt-2'

          return (
            <div key={si} className={topGap}>
              <p className="px-3 pt-3 pb-1.5 text-[10px] uppercase tracking-widest text-terminal-muted/50 font-semibold select-none">
                {section.label}
              </p>
              {section.items.map(({ href, icon: Icon, label }) => {
                const active = path === href || path.startsWith(href + '/')
                const inactiveText = section.primary
                  ? 'text-terminal-text/80'
                  : 'text-terminal-muted'

                return (
                  <Link
                    key={href}
                    href={href}
                    className={[
                      'flex items-center gap-3 px-3 rounded-md transition-all duration-150 mb-0.5 relative overflow-hidden border',
                      section.primary
                        ? 'py-2 text-sm font-semibold'
                        : 'py-2 text-sm font-medium',
                      active
                        ? 'bg-bull-default/10 text-bull-default border-bull-default/15'
                        : `${inactiveText} hover:text-terminal-text hover:bg-terminal-bright/40 border-transparent`,
                    ].join(' ')}
                  >
                    {active && (
                      <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-bull-default/90" />
                    )}
                    <Icon size={14} strokeWidth={active ? 2.5 : 2} />
                    <span className="truncate">{label}</span>
                    {active && (
                      <span className="ml-auto w-1.5 h-1.5 rounded-full bg-bull-default/70 animate-pulse-slow shrink-0" />
                    )}
                  </Link>
                )
              })}
            </div>
          )
        })}
      </nav>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-terminal-border">
        <div className="flex items-center gap-1.5 mb-2">
          <Link
            href="/admin/signals"
            className="px-2 py-0.5 rounded border border-terminal-border/40 text-[10px] font-mono text-terminal-muted/50 hover:text-terminal-text hover:border-terminal-border transition-colors"
          >
            Signals
          </Link>
          <Link
            href="/admin/scanner"
            className="px-2 py-0.5 rounded border border-terminal-border/40 text-[10px] font-mono text-terminal-muted/50 hover:text-terminal-text hover:border-terminal-border transition-colors"
          >
            Scanner
          </Link>
        </div>
        <div className="flex items-center gap-2">
          <span className="relative flex h-1.5 w-1.5 shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-bull-default opacity-40" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-bull-default/70" />
          </span>
          <p className="text-terminal-muted/40 text-xs font-mono">Phase 7 · v1.0</p>
        </div>
      </div>
    </aside>
  )
}
