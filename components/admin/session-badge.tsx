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
      // Server route clears cookies + writes audit log
      await fetch('/api/auth/signout', { method: 'POST' })
      // Client-side clear (catches any in-memory state)
      await createSupabaseBrowserClient().auth.signOut()
      router.replace('/login')
    } finally {
      setLoading(false)
    }
  }

  const shortEmail = email.length > 24 ? `${email.slice(0, 21)}…` : email

  return (
    <div className="flex items-center gap-2 shrink-0">
      {/* Identity */}
      <div className="hidden sm:flex items-center gap-1.5 text-[10px] font-mono text-terminal-muted/50 select-none">
        <User size={9} className="shrink-0" />
        <span title={email}>{shortEmail}</span>
        <span className="text-terminal-muted/25">·</span>
        <span title={lastSignIn ? new Date(lastSignIn).toLocaleString() : undefined}>
          {relativeTime(lastSignIn)}
        </span>
      </div>

      {/* Sign-out button */}
      <button
        onClick={handleSignOut}
        disabled={loading}
        title="Sign out"
        className="flex items-center gap-1 px-1.5 py-1 rounded border border-terminal-border/50 text-terminal-muted/40 hover:text-bear-default hover:border-bear-default/25 transition-colors text-[10px] font-mono disabled:opacity-40"
      >
        {loading
          ? <Loader2 size={10} className="animate-spin" />
          : <><LogOut size={10} /><span className="hidden sm:inline ml-0.5">Out</span></>
        }
      </button>
    </div>
  )
}
