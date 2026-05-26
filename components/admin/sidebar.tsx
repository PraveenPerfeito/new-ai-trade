'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard, Activity, ScanLine, Zap, TrendingUp,
  Database, Server, AlertTriangle, BarChart3, Target, Settings2,
  Layers, Crosshair, Globe, Brain, Cpu,
} from 'lucide-react'

const SECTIONS = [
  {
    label: 'OVERVIEW',
    items: [
      { href: '/admin/overview', icon: LayoutDashboard, label: 'Command Overview'   },
      { href: '/admin/market',   icon: Activity,        label: 'Market Intelligence'},
    ],
  },
  {
    label: 'OPERATIONS',
    items: [
      { href: '/admin/scanner',       icon: ScanLine,   label: 'Scanner'       },
      { href: '/admin/signals',       icon: Zap,        label: 'Signals'       },
      { href: '/admin/tactical',      icon: Crosshair,  label: 'Tactical Feed' },
      { href: '/admin/paper-trading', icon: TrendingUp, label: 'Paper Trading' },
    ],
  },
  {
    label: 'INTELLIGENCE',
    items: [
      { href: '/admin/analytics',   icon: BarChart3, label: 'Edge Analytics'      },
      { href: '/admin/regime',      icon: Target,    label: 'Regime Intelligence' },
      { href: '/admin/sectors',     icon: Globe,     label: 'Sector Rotation'     },
      { href: '/admin/calibration', icon: Brain,     label: 'Calibration'         },
    ],
  },
  {
    label: 'INFRASTRUCTURE',
    items: [
      { href: '/admin/providers', icon: Database,      label: 'Providers'        },
      { href: '/admin/cache',     icon: Layers,        label: 'Cache Operations' },
      { href: '/admin/system',    icon: Server,        label: 'System Health'    },
      { href: '/admin/anomalies', icon: AlertTriangle, label: 'Diagnostics'      },
    ],
  },
  {
    label: 'SYSTEM',
    items: [
      { href: '/admin/settings', icon: Settings2, label: 'Settings' },
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
            <p className="text-terminal-text text-sm font-semibold leading-tight tracking-wide">Admin</p>
            <p className="text-terminal-muted/50 text-[10px] uppercase tracking-[0.18em] mt-0.5">Command Center</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-3 px-2.5">
        {SECTIONS.map((section, si) => (
          <div key={si} className={si > 0 ? 'mt-1' : ''}>
            <p className="px-3 pt-3 pb-1.5 text-[10px] uppercase tracking-widest text-terminal-muted/50 font-semibold select-none">
              {section.label}
            </p>
            {section.items.map(({ href, icon: Icon, label }) => {
              const active = path === href || path.startsWith(href + '/')
              return (
                <Link
                  key={href}
                  href={href}
                  className={[
                    'flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-all duration-150 mb-0.5 relative overflow-hidden',
                    active
                      ? 'bg-bull-default/10 text-bull-default border border-bull-default/15'
                      : 'text-terminal-muted hover:text-terminal-text hover:bg-terminal-bright/40 border border-transparent',
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
        ))}
      </nav>

      {/* Footer */}
      <div className="px-5 py-3 border-t border-terminal-border flex items-center gap-2">
        <span className="relative flex h-1.5 w-1.5 shrink-0">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-bull-default opacity-40" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-bull-default/70" />
        </span>
        <p className="text-terminal-muted/40 text-xs font-mono">Phase 7 · v1.0</p>
      </div>
    </aside>
  )
}
