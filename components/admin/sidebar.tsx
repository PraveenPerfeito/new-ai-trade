'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard, Activity, Zap, BarChart3, Brain,
  TrendingUp, AlertTriangle, Server, Target, Settings2,
} from 'lucide-react'

const SECTIONS = [
  {
    label: null,
    items: [
      { href: '/admin/overview',      icon: LayoutDashboard, label: 'Overview' },
    ],
  },
  {
    label: 'INFRASTRUCTURE',
    items: [
      { href: '/admin/operations',    icon: Activity,        label: 'Operations' },
      { href: '/admin/system',        icon: Server,          label: 'System Health' },
    ],
  },
  {
    label: 'TRADING',
    items: [
      { href: '/admin/signals',       icon: Zap,             label: 'Signals' },
      { href: '/admin/analytics',     icon: BarChart3,       label: 'Analytics' },
      { href: '/admin/ai',            icon: Brain,           label: 'AI Intelligence' },
      { href: '/admin/paper-trading', icon: TrendingUp,      label: 'Paper Trading' },
    ],
  },
  {
    label: 'MONITORING',
    items: [
      { href: '/admin/anomalies',     icon: AlertTriangle,   label: 'Anomalies' },
      { href: '/admin/readiness',     icon: Target,          label: 'Readiness' },
    ],
  },
  {
    label: 'SYSTEM',
    items: [
      { href: '/admin/settings',      icon: Settings2,       label: 'Settings' },
    ],
  },
]

export function AdminSidebar() {
  const path = usePathname()

  return (
    <aside className="w-[216px] shrink-0 flex flex-col h-screen sticky top-0 bg-terminal-surface border-r border-terminal-border">
      {/* Brand */}
      <div className="px-4 pt-5 pb-4 border-b border-terminal-border">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-md bg-gradient-to-br from-bull-default/30 to-emerald-900/20 border border-bull-default/30 flex items-center justify-center shrink-0">
            <span className="text-bull-default text-[10px] font-bold font-mono">SC</span>
          </div>
          <div className="min-w-0">
            <p className="text-terminal-text text-sm font-semibold leading-none">Admin</p>
            <p className="text-terminal-muted/60 text-[9px] uppercase tracking-[0.15em] mt-0.5">Command Center</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-3 px-2">
        {SECTIONS.map((section, si) => (
          <div key={si} className={si > 0 ? 'mt-1' : ''}>
            {section.label && (
              <p className="px-3 pt-3 pb-1 text-[9px] uppercase tracking-[0.15em] text-terminal-muted/50 font-semibold select-none">
                {section.label}
              </p>
            )}
            {section.items.map(({ href, icon: Icon, label }) => {
              const active = path === href || path.startsWith(href + '/')
              return (
                <Link
                  key={href}
                  href={href}
                  className={[
                    'flex items-center gap-2.5 px-3 py-[7px] rounded-md text-[13px] font-medium transition-all duration-150 mb-0.5',
                    active
                      ? 'bg-bull-default/10 text-bull-default border border-bull-default/20'
                      : 'text-terminal-muted hover:text-terminal-text hover:bg-terminal-bright/40 border border-transparent',
                  ].join(' ')}
                >
                  <Icon size={13} strokeWidth={active ? 2.5 : 2} />
                  <span className="truncate">{label}</span>
                  {active && (
                    <span className="ml-auto w-1 h-1 rounded-full bg-bull-default/80 animate-pulse-slow shrink-0" />
                  )}
                </Link>
              )
            })}
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-terminal-border">
        <p className="text-terminal-muted/40 text-[10px] font-mono">Phase 5 · v1.0</p>
      </div>
    </aside>
  )
}
