'use client'

import { FormEvent, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AlertCircle, Loader2, Lock, Terminal } from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { recordLoginEvent } from '@/app/actions/auth'

export default function LoginPage() {
  const router   = useRouter()
  const params   = useSearchParams()
  const next     = params.get('next') ?? '/admin'

  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState<string | null>(null)
  const [loading,  setLoading]  = useState(false)
  const [checking, setChecking] = useState(true)

  // Skip login if a valid session already exists
  useEffect(() => {
    createSupabaseBrowserClient()
      .auth.getSession()
      .then(({ data: { session } }) => {
        if (session) router.replace(next)
        else setChecking(false)
      })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      const { error: authError } = await createSupabaseBrowserClient()
        .auth.signInWithPassword({ email, password })

      if (authError) {
        setError(authError.message)
        await recordLoginEvent('login_failed', email, authError.message)
        return
      }

      await recordLoginEvent('login', email)
      router.replace(next)
    } catch (err) {
      setError('Unexpected error — please try again.')
      console.error('[login]', err)
    } finally {
      setLoading(false)
    }
  }

  if (checking) {
    return (
      <div className="min-h-screen bg-terminal-bg flex items-center justify-center">
        <Loader2 size={18} className="text-terminal-muted animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-terminal-bg flex items-center justify-center px-4">
      <div className="w-full max-w-sm">

        {/* Branding */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2 mb-3">
            <Terminal size={18} className="text-bull-default" />
            <span className="font-mono text-terminal-text text-sm font-semibold tracking-tight">
              Scanner Command Center
            </span>
          </div>
          <p className="text-terminal-muted/50 text-[11px] font-mono">
            Restricted access · Authorised personnel only
          </p>
        </div>

        {/* Card */}
        <div className="glass-card rounded-lg p-6 space-y-4 border border-terminal-border">

          <div className="flex items-center gap-1.5 text-terminal-muted/50 text-[10px] font-mono">
            <Lock size={9} />
            <span>Admin authentication required</span>
          </div>

          {error && (
            <div className="flex items-start gap-2 px-3 py-2.5 rounded bg-bear-default/8 border border-bear-default/20 text-bear-default text-xs">
              <AlertCircle size={12} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="block text-[10px] text-terminal-muted/60 font-mono mb-1.5">
                Email
              </label>
              <input
                type="email"
                required
                autoComplete="email"
                autoFocus
                value={email}
                onChange={e => setEmail(e.target.value)}
                disabled={loading}
                className="w-full bg-terminal-bg border border-terminal-border rounded px-3 py-2 font-mono text-xs text-terminal-text focus:outline-none focus:border-bull-default/40 placeholder:text-terminal-muted/25 disabled:opacity-50"
                placeholder="admin@example.com"
              />
            </div>

            <div>
              <label className="block text-[10px] text-terminal-muted/60 font-mono mb-1.5">
                Password
              </label>
              <input
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                disabled={loading}
                className="w-full bg-terminal-bg border border-terminal-border rounded px-3 py-2 font-mono text-xs text-terminal-text focus:outline-none focus:border-bull-default/40 placeholder:text-terminal-muted/25 disabled:opacity-50"
                placeholder="••••••••"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 mt-2 py-2 rounded bg-bull-default/10 border border-bull-default/25 text-bull-default font-mono text-xs hover:bg-bull-default/18 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <><Loader2 size={11} className="animate-spin" /> Authenticating…</>
              ) : (
                'Sign in'
              )}
            </button>
          </form>
        </div>

        <p className="text-center text-[10px] text-terminal-muted/25 font-mono mt-5">
          Set your password via the Supabase Auth dashboard
        </p>
      </div>
    </div>
  )
}
