'use client'

import { FormEvent, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  AlertCircle, Loader2, Lock, Shield, Activity,
  ArrowRight, Cpu, Zap, BarChart3, Brain,
} from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { recordLoginEvent } from '@/app/actions/auth'

// ─── Types ────────────────────────────────────────────────────────────────────

interface MarketTicker { price: number; change24: number }
interface ProviderDot  { name: string; healthy: boolean }

// ─── Market session ───────────────────────────────────────────────────────────

function getMarketSession() {
  const h = new Date().getUTCHours()
  if (h >= 0  && h <  8) return { label: 'Asia Session',     color: '#f59e0b' }
  if (h >= 8  && h < 13) return { label: 'London Session',   color: '#3b82f6' }
  if (h >= 13 && h < 22) return { label: 'New York Session', color: '#00d084' }
  return                          { label: 'Off-hours',        color: '#4a5568' }
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function LoginPage() {
  const router = useRouter()
  const params = useSearchParams()
  const next   = params.get('next') ?? '/admin'

  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState<string | null>(null)
  const [loading,  setLoading]  = useState(false)
  const [checking, setChecking] = useState(true)

  const [btc,       setBtc]       = useState<MarketTicker | null>(null)
  const [providers, setProviders] = useState<ProviderDot[]>([])
  const [clockUtc,  setClockUtc]  = useState('')
  const [session,   setSession]   = useState(getMarketSession())

  // Session check
  useEffect(() => {
    createSupabaseBrowserClient()
      .auth.getSession()
      .then(({ data: { session } }) => {
        if (session) router.replace(next)
        else setChecking(false)
      })
  }, []) // eslint-disable-line

  // UTC clock
  useEffect(() => {
    const tick = () => {
      setClockUtc(new Date().toUTCString().slice(17, 25))
      setSession(getMarketSession())
    }
    tick()
    const t = setInterval(tick, 1_000)
    return () => clearInterval(t)
  }, [])

  // Live BTC ticker
  useEffect(() => {
    async function fetchBTC() {
      try {
        const [priceRes, statsRes] = await Promise.all([
          fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT'),
          fetch('https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT'),
        ])
        const priceJson = await priceRes.json()
        const statsJson = await statsRes.json()
        setBtc({
          price:    parseFloat(priceJson.price),
          change24: parseFloat(statsJson.priceChangePercent),
        })
      } catch {}
    }
    fetchBTC()
    const t = setInterval(fetchBTC, 15_000)
    return () => clearInterval(t)
  }, [])

  // Provider health
  useEffect(() => {
    fetch('/api/health/providers')
      .then(r => r.json())
      .then(j => {
        if (j.success) setProviders(
          (j.providers as ProviderDot[]).map(p => ({ name: p.name, healthy: p.healthy })),
        )
      })
      .catch(() => {})
  }, [])

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
    } catch {
      setError('Unexpected error — please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (checking) {
    return (
      <div className="min-h-screen bg-terminal-bg flex items-center justify-center">
        <Loader2 size={20} className="text-terminal-muted animate-spin" />
      </div>
    )
  }

  const btcUp = (btc?.change24 ?? 0) >= 0

  return (
    <div className="min-h-screen bg-terminal-bg relative overflow-hidden flex">

      {/* Animated dot-grid background */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: `
            radial-gradient(circle at 1px 1px, rgba(255,255,255,0.035) 1px, transparent 0),
            radial-gradient(circle at 25px 25px, rgba(255,255,255,0.015) 1px, transparent 0)
          `,
          backgroundSize: '48px 48px, 96px 96px',
        }}
      />

      {/* Ambient glow blobs */}
      <div
        className="absolute pointer-events-none opacity-[0.07]"
        style={{
          top: '-20%', right: '-10%', width: 600, height: 600,
          borderRadius: '50%',
          background: 'radial-gradient(circle, #3b82f6, transparent 65%)',
        }}
      />
      <div
        className="absolute pointer-events-none opacity-[0.05]"
        style={{
          bottom: '-20%', left: '-10%', width: 500, height: 500,
          borderRadius: '50%',
          background: 'radial-gradient(circle, #00d084, transparent 65%)',
        }}
      />

      {/* ── Left panel: market intelligence ─────────────────────────────────── */}
      <div className="hidden lg:flex w-[420px] shrink-0 flex-col justify-between p-10 border-r border-terminal-border/30 relative">

        <div>
          {/* Brand */}
          <div className="flex items-center gap-3 mb-10">
            <div className="w-10 h-10 rounded-xl bg-bull-default/12 border border-bull-default/25 flex items-center justify-center">
              <span className="text-bull-default font-bold text-base font-mono">◈</span>
            </div>
            <div>
              <p className="text-terminal-text font-mono font-bold text-sm tracking-tight">QUANT INTELLIGENCE</p>
              <p className="text-terminal-muted/40 text-[10px] uppercase tracking-[0.2em]">Institutional Terminal</p>
            </div>
          </div>

          <h1 className="text-[26px] font-bold text-terminal-text leading-snug mb-2.5">
            Secure Founder<br />Access Portal
          </h1>
          <p className="text-terminal-muted/55 text-sm leading-relaxed mb-8">
            Real-time quantitative signal intelligence.<br />
            Multi-layer authentication required.
          </p>

          {/* BTC live ticker */}
          <div className="glass-card rounded-xl p-4 mb-3 border border-terminal-border/40">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] text-terminal-muted uppercase tracking-widest">BTC / USDT · Live</span>
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-bull-default animate-pulse" />
                <span className="text-[9px] text-bull-text font-mono font-bold">LIVE</span>
              </div>
            </div>
            {btc ? (
              <>
                <p className="font-mono font-bold text-2xl text-terminal-text tabular-nums">
                  ${btc.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
                <div className="flex items-center gap-2 mt-1">
                  <span className={`text-sm font-mono font-bold ${btcUp ? 'text-bull-text' : 'text-bear-text'}`}>
                    {btcUp ? '▲' : '▼'} {Math.abs(btc.change24).toFixed(2)}%
                  </span>
                  <span className="text-[10px] text-terminal-dim">24h change</span>
                </div>
              </>
            ) : (
              <>
                <div className="h-7 w-44 skeleton rounded mb-1.5" />
                <div className="h-4 w-24 skeleton rounded" />
              </>
            )}
          </div>

          {/* Market session */}
          <div className="glass-card rounded-xl p-3.5 mb-3 border border-terminal-border/40 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: session.color }} />
              <span className="text-sm text-terminal-text font-mono font-semibold">{session.label}</span>
            </div>
            <span className="text-sm text-terminal-muted font-mono tabular-nums">{clockUtc} UTC</span>
          </div>

          {/* Provider health */}
          {providers.length > 0 && (
            <div className="glass-card rounded-xl p-3.5 border border-terminal-border/40">
              <p className="text-[10px] text-terminal-muted uppercase tracking-widest mb-3">Data Provider Status</p>
              <div className="flex flex-col gap-2.5">
                {providers.map(p => (
                  <div key={p.name} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full shrink-0"
                        style={{ backgroundColor: p.healthy ? '#00d084' : '#ff3b5c' }} />
                      <span className="text-[11px] text-terminal-muted font-mono">{p.name}</span>
                    </div>
                    <span className="text-[10px] font-mono font-bold"
                      style={{ color: p.healthy ? '#00d084' : '#ff3b5c' }}>
                      {p.healthy ? 'ONLINE' : 'OFFLINE'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Capabilities */}
        <div className="flex flex-col gap-2.5 pt-6 border-t border-terminal-border/20">
          {[
            { Icon: Cpu,       label: 'AI-Powered Signal Detection' },
            { Icon: Zap,       label: 'Real-Time Market Scanning' },
            { Icon: BarChart3, label: 'Institutional Risk Engine' },
            { Icon: Brain,     label: 'Claude Haiku · AI Validation' },
          ].map(({ Icon, label }) => (
            <div key={label} className="flex items-center gap-2.5">
              <Icon size={12} className="text-terminal-muted/30 shrink-0" />
              <span className="text-[11px] text-terminal-muted/40 font-mono">{label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Right panel: login form ──────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-10 relative">

        {/* Mobile brand */}
        <div className="lg:hidden flex items-center gap-3 mb-8">
          <div className="w-9 h-9 rounded-xl bg-bull-default/12 border border-bull-default/25 flex items-center justify-center">
            <span className="text-bull-default font-bold text-sm font-mono">◈</span>
          </div>
          <div>
            <p className="text-terminal-text font-mono font-bold text-sm">QUANT INTELLIGENCE</p>
            <p className="text-terminal-muted/40 text-[10px] uppercase tracking-[0.2em]">Institutional Terminal</p>
          </div>
        </div>

        <div className="w-full max-w-md">

          {/* Header */}
          <div className="mb-7">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-bull-default/20 bg-bull-default/7 mb-4">
              <Shield size={10} className="text-bull-default" />
              <span className="text-[10px] font-mono text-bull-text font-bold tracking-wider">SECURE ACCESS</span>
              <span className="w-1 h-1 rounded-full bg-bull-default animate-pulse ml-0.5" />
            </div>
            <h2 className="text-2xl font-bold text-terminal-text font-mono mb-2">Founder Login</h2>
            <p className="text-terminal-muted/55 text-sm font-mono">
              Session tokens · Audit trail · IP logged
            </p>
          </div>

          {/* Login card */}
          <div
            className="glass-card rounded-2xl p-7 border border-terminal-border/55"
            style={{ boxShadow: '0 0 60px rgba(0,208,132,0.04), 0 24px 80px rgba(0,0,0,0.35)' }}
          >
            {/* Status row */}
            <div className="flex items-center gap-2.5 mb-6 pb-5 border-b border-terminal-border/25">
              <Activity size={11} className="text-terminal-muted/35" />
              <span className="text-[11px] font-mono text-terminal-muted/40">
                Restricted · Authorised personnel only
              </span>
              <div className="ml-auto flex items-center gap-1.5">
                {providers.slice(0, 3).map(p => (
                  <span key={p.name} className="w-1.5 h-1.5 rounded-full"
                    style={{ backgroundColor: p.healthy ? '#00d084' : '#ff3b5c' }}
                    title={p.name} />
                ))}
                {providers.length === 0 && (
                  <span className="text-[9px] text-terminal-dim font-mono">connecting…</span>
                )}
              </div>
            </div>

            {error && (
              <div className="flex items-start gap-2.5 px-3.5 py-3 rounded-xl bg-bear-default/8 border border-bear-default/20 text-bear-default text-sm mb-5">
                <AlertCircle size={14} className="shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="block text-[11px] text-terminal-muted/55 font-mono mb-2 uppercase tracking-wider">
                  Email address
                </label>
                <input
                  type="email" required autoComplete="email" autoFocus
                  value={email} onChange={e => setEmail(e.target.value)} disabled={loading}
                  className="w-full bg-terminal-bg/70 border border-terminal-border rounded-xl px-4 py-3 font-mono text-sm text-terminal-text focus:outline-none focus:border-bull-default/50 placeholder:text-terminal-muted/20 disabled:opacity-50 transition-all"
                  placeholder="founder@example.com"
                />
              </div>

              <div>
                <label className="block text-[11px] text-terminal-muted/55 font-mono mb-2 uppercase tracking-wider">
                  Password
                </label>
                <input
                  type="password" required autoComplete="current-password"
                  value={password} onChange={e => setPassword(e.target.value)} disabled={loading}
                  className="w-full bg-terminal-bg/70 border border-terminal-border rounded-xl px-4 py-3 font-mono text-sm text-terminal-text focus:outline-none focus:border-bull-default/50 placeholder:text-terminal-muted/20 disabled:opacity-50 transition-all"
                  placeholder="••••••••••••"
                />
              </div>

              <button
                type="submit" disabled={loading}
                className="w-full flex items-center justify-center gap-2.5 py-3.5 rounded-xl font-mono text-sm font-bold transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed mt-1"
                style={{
                  background:  loading ? 'rgba(0,208,132,0.07)' : 'linear-gradient(135deg,rgba(0,208,132,0.14),rgba(0,208,132,0.07))',
                  border:      '1px solid rgba(0,208,132,0.28)',
                  color:       '#00d084',
                  boxShadow:   loading ? 'none' : '0 0 24px rgba(0,208,132,0.09)',
                }}
              >
                {loading
                  ? <><Loader2 size={14} className="animate-spin" /> Authenticating…</>
                  : <>Authenticate <ArrowRight size={14} /></>
                }
              </button>
            </form>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between mt-5 px-1">
            <a href="/dashboard"
              className="text-[11px] text-terminal-muted/35 hover:text-terminal-muted font-mono transition-colors">
              ← Back to Dashboard
            </a>
            <div className="flex items-center gap-1.5">
              <Lock size={9} className="text-terminal-muted/25" />
              <p className="text-[10px] text-terminal-muted/30 font-mono">Supabase Auth</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
