'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import type { PlanId } from '@/types'

interface Props {
  email: string
  planId: PlanId
}

const PLAN_STYLES: Record<PlanId, string> = {
  free:       'bg-gray-500/15 text-gray-400 border-gray-500/25',
  pro:        'bg-cyan-400/10 text-cyan-400 border-cyan-400/20',
  enterprise: 'bg-purple-500/15 text-purple-400 border-purple-500/25',
}

const NAV_LINKS = [
  { href: '/dashboard',         label: 'Overview' },
  { href: '/dashboard/account', label: 'Account'  },
]

export function MemberNav({ email, planId }: Props) {
  const pathname = usePathname()
  const router   = useRouter()

  async function handleSignOut() {
    await createSupabaseBrowserClient().auth.signOut()
    router.push('/')
    router.refresh()
  }

  return (
    <nav className="sticky top-0 z-40 border-b border-white/[0.06] bg-[#070711]/95 backdrop-blur-sm">
      <div className="max-w-7xl mx-auto px-6 h-14 flex items-center gap-2">

        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 mr-5 shrink-0">
          <span className="text-cyan-400 font-bold font-mono">◈</span>
          <span className="text-white font-semibold text-sm">SignalEdge</span>
        </Link>

        {/* Nav links */}
        {NAV_LINKS.map(({ href, label }) => (
          <Link
            key={href}
            href={href}
            className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
              pathname === href
                ? 'bg-white/[0.07] text-white font-medium'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            {label}
          </Link>
        ))}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Plan badge */}
        <span className={`hidden sm:inline text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider border ${PLAN_STYLES[planId]}`}>
          {planId}
        </span>

        {/* Email */}
        <span className="hidden md:block text-gray-500 text-xs truncate max-w-[180px]">{email}</span>

        {/* Sign out */}
        <button
          onClick={handleSignOut}
          className="text-xs text-gray-500 hover:text-white transition-colors ml-1 px-2 py-1 rounded"
        >
          Sign out
        </button>
      </div>
    </nav>
  )
}
