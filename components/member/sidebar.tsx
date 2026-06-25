'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState } from 'react'
import {
  LayoutDashboard,
  Activity,
  CheckCircle2,
  TrendingUp,
  Settings2,
  Menu,
  X,
} from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import type { PlanId } from '@/types'

interface Props {
  planId: string
  email: string
}

const NAV_ITEMS = [
  { href: '/dashboard',                label: 'Dashboard',      icon: LayoutDashboard },
  { href: '/dashboard/signals/active', label: 'Active Signals', icon: Activity        },
  { href: '/dashboard/signals/closed', label: 'Closed Signals', icon: CheckCircle2    },
  { href: '/dashboard/performance',    label: 'Performance',    icon: TrendingUp      },
  { href: '/dashboard/settings',       label: 'Settings',       icon: Settings2       },
]

const PLAN_STYLES: Record<string, string> = {
  free:       'bg-gray-500/15 text-gray-400 border-gray-500/25',
  pro:        'bg-cyan-400/10 text-cyan-400 border-cyan-400/20',
  enterprise: 'bg-purple-500/15 text-purple-400 border-purple-500/25',
}

function SidebarContent({
  planId,
  email,
  pathname,
  onNav,
  onSignOut,
}: {
  planId: string
  email: string
  pathname: string
  onNav: () => void
  onSignOut: () => void
}) {
  const planCls = PLAN_STYLES[planId] ?? PLAN_STYLES['free']

  return (
    <>
      {/* Logo */}
      <div className="px-5 py-5 border-b border-white/[0.06]">
        <Link href="/" className="flex items-center gap-2" onClick={onNav}>
          <span className="text-cyan-400 font-bold font-mono text-lg">◈</span>
          <span className="text-white font-semibold text-sm">SignalEdge</span>
        </Link>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            onClick={onNav}
            className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
              pathname === href
                ? 'bg-white/[0.06] text-white font-medium'
                : 'text-gray-400 hover:text-white hover:bg-white/[0.03]'
            }`}
          >
            <Icon size={15} className="shrink-0" />
            {label}
          </Link>
        ))}
      </nav>

      {/* Footer */}
      <div className="px-4 py-4 border-t border-white/[0.06] space-y-2">
        <span
          className={`inline-flex text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider border ${planCls}`}
        >
          {planId}
        </span>
        <p className="text-gray-600 text-xs truncate" title={email}>{email}</p>
        <button
          onClick={onSignOut}
          className="text-xs text-gray-500 hover:text-red-400 transition-colors"
        >
          Sign out →
        </button>
      </div>
    </>
  )
}

export function MemberSidebar({ planId, email }: Props) {
  const pathname = usePathname()
  const router   = useRouter()
  const [open, setOpen] = useState(false)

  function handleNav() {
    setOpen(false)
  }

  async function handleSignOut() {
    await createSupabaseBrowserClient().auth.signOut()
    router.push('/')
  }

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex fixed top-0 left-0 h-full w-[220px] flex-col bg-[#0c0c13] border-r border-white/[0.06] z-30">
        <SidebarContent
          planId={planId}
          email={email}
          pathname={pathname}
          onNav={handleNav}
          onSignOut={handleSignOut}
        />
      </aside>

      {/* Mobile hamburger + overlay */}
      <div className="lg:hidden">
        <button
          onClick={() => setOpen(true)}
          className="fixed top-4 left-4 z-40 p-2 rounded-lg bg-[#0c0c13] border border-white/[0.08] text-white"
          aria-label="Open navigation"
        >
          <Menu size={18} />
        </button>

        {open && (
          <>
            <div
              className="fixed inset-0 bg-black/60 z-40"
              onClick={() => setOpen(false)}
            />
            <aside className="fixed top-0 left-0 h-full w-[220px] flex flex-col bg-[#0c0c13] border-r border-white/[0.06] z-50">
              <div className="flex items-center justify-end px-3 pt-3">
                <button
                  onClick={() => setOpen(false)}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/[0.05] transition-colors"
                  aria-label="Close navigation"
                >
                  <X size={16} />
                </button>
              </div>
              <SidebarContent
                planId={planId}
                email={email}
                pathname={pathname}
                onNav={handleNav}
                onSignOut={handleSignOut}
              />
            </aside>
          </>
        )}
      </div>
    </>
  )
}
