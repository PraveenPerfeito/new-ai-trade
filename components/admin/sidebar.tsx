'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  TrendingUp, BarChart3, Server,
} from 'lucide-react'

type NavItem = { href: string; icon: React.ElementType; label: string; sub: string }

const NAV_ITEMS: NavItem[] = [
  { href: '/admin/trading',   icon: TrendingUp, label: 'Signals',     sub: 'Overview · Signals · Regime'      },
  { href: '/admin/analytics', icon: BarChart3,  label: 'Performance', sub: 'Track Record · Edge · Attribution' },
  { href: '/admin/system',    icon: Server,     label: 'System',      sub: 'Health · Settings'                 },
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
      <nav className="flex-1 overflow-y-auto py-4 px-2.5 space-y-1">
        {NAV_ITEMS.map(({ href, icon: Icon, label, sub }) => {
          const active = href === '/admin/system'
            ? (path === href || path.startsWith(href + '/') || path.startsWith('/admin/intelligence') || path.startsWith('/admin/settings'))
            : (path === href || path.startsWith(href + '/'))
          return (
            <Link
              key={href}
              href={href}
              className={[
                'flex items-start gap-3 px-3 py-2.5 rounded-md transition-all duration-150 relative overflow-hidden border',
                active
                  ? 'bg-bull-default/10 text-bull-default border-bull-default/15'
                  : 'text-terminal-text/80 hover:text-terminal-text hover:bg-terminal-bright/40 border-transparent',
              ].join(' ')}
            >
              {active && (
                <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-bull-default/90" />
              )}
              <Icon size={16} strokeWidth={active ? 2.5 : 2} className="mt-0.5 shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-semibold leading-tight truncate">{label}</p>
                <p className="text-[10px] text-terminal-muted/50 mt-0.5 leading-tight truncate">{sub}</p>
              </div>
              {active && (
                <span className="ml-auto w-1.5 h-1.5 rounded-full bg-bull-default/70 animate-pulse-slow shrink-0 mt-1" />
              )}
            </Link>
          )
        })}
      </nav>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-terminal-border">
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
