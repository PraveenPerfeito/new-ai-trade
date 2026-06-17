'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  TrendingUp, BarChart3, Server,
} from 'lucide-react'

type NavItem = { href: string; icon: React.ElementType; label: string; sub: string }

const NAV_ITEMS: NavItem[] = [
  { href: '/admin/signals',     icon: TrendingUp, label: 'Signals',     sub: 'Overview · Signals · Regime'       },
  { href: '/admin/performance', icon: BarChart3,  label: 'Performance', sub: 'Track Record · Edge · Attribution' },
  { href: '/admin/system',      icon: Server,     label: 'System',      sub: 'Health · Anomalies · Settings'     },
]

export function AdminSidebar() {
  const path = usePathname()

  return (
    <aside className="w-[220px] shrink-0 flex flex-col h-screen sticky top-0 bg-zinc-900 border-r border-zinc-800">
      {/* Brand */}
      <div className="px-5 pt-5 pb-4 border-b border-zinc-800/70">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-center shrink-0">
            <span className="text-bull-default text-sm font-bold leading-none">◈</span>
          </div>
          <div className="min-w-0">
            <p className="text-white text-sm font-semibold leading-tight">SignalEdge</p>
            <p className="text-zinc-500 text-[10px] mt-0.5 leading-none">Admin</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
        {NAV_ITEMS.map(({ href, icon: Icon, label, sub }) => {
          const active = path === href || path.startsWith(href + '/')
          return (
            <Link
              key={href}
              href={href}
              className={[
                'flex items-start gap-3 px-3 py-2.5 rounded-lg transition-all duration-150 relative border',
                active
                  ? 'bg-zinc-800/80 text-white border-zinc-700/60'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50 border-transparent',
              ].join(' ')}
            >
              {/* Brand-colored left accent on active */}
              {active && (
                <span className="absolute left-0 top-2.5 bottom-2.5 w-[2px] rounded-full bg-bull-default" />
              )}
              <Icon size={15} strokeWidth={active ? 2 : 1.75} className="mt-0.5 shrink-0" />
              <div className="min-w-0">
                <p className={`text-sm font-medium leading-tight truncate ${active ? 'text-white' : ''}`}>{label}</p>
                <p className="text-[10px] text-zinc-600 mt-0.5 leading-tight truncate font-normal">{sub}</p>
              </div>
            </Link>
          )
        })}
      </nav>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-zinc-800/70">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
          <p className="text-zinc-600 text-[10px]">SignalEdge AI</p>
        </div>
      </div>
    </aside>
  )
}
