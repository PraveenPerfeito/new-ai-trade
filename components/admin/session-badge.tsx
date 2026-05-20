'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { LogOut, Loader2, User } from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

interface Props {
  email:      string
  lastSignIn: string | null
}

function relativeTime(iso: string | null): string {
  if (!iso) return 'first login'
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60_000)         return 'just now'
  if (ms < 3_600_000)      return `${Math.floor(ms / 60_000)}m ago`
  if (ms < 86_400_000)     return `${Math.floor(ms / 3_600_000)}h ago`
  return `${Math.floor(ms / 86_400_000)}d ago`
}

export function SessionBadge({ email, lastSignIn }: Props) {
  const router    = useRouter()
  const [loading, setLoading] = useState(false)

  async function handleSignOut() {
    setLoading(true)
    try {
      await fetch('/api/auth/signout', { method: 'POST' })
      await createSupabaseBrowserClient().auth.signOut()
      router.replace('/login')
    } finally {
      setLoading(false)
    }
  }

  const shortEmail = email.length > 26 ? `${email.slice(0, 23)}…` : email

  return (
    <div className="flex items-center gap-2.5 shrink-0">
      {/* Identity */}
      <div className="hidden sm:flex items-center gap-1.5 text-xs font-mono text-terminal-muted/60 select-none">
        <User size={11} className="shrink-0" />
        <span title={email}>{shortEmail}</span>
        <span className="text-terminal-muted/30">·</span>
        <span title={lastSignIn ? new Date(lastSignIn).toLocaleString() : undefined}>
          {relativeTime(lastSignIn)}
        </span>
      </div>

      {/* Sign-out button */}
      <button
        onClick={handleSignOut}
        disabled={loading}
        title="Sign out"
        className="flex items-center gap-1.5 px-2.5 py-1 rounded border border-terminal-border/50 text-terminal-muted/50 hover:text-bear-default hover:border-bear-default/30 transition-colors text-xs font-mono disabled:opacity-40"
      >
        {loading
          ? <Loader2 size={11} className="animate-spin" />
          : <><LogOut size={11} /><span className="hidden sm:inline">Sign out</span></>
        }
      </button>
    </div>
  )
}
