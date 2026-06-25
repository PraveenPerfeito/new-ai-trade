'use client'

import { useEffect, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import type { User } from '@supabase/supabase-js'
import type { PlanId } from '@/types'
import Link from 'next/link'

const PLAN_FEATURES: Record<PlanId, string[]> = {
  free:       ['10 signals/day', 'Spot mode only', 'Dashboard access'],
  pro:        ['Unlimited signals', 'All scan modes', 'Telegram alerts', 'Priority support'],
  enterprise: ['Everything in Pro', 'API access', 'Custom integrations', 'Dedicated support'],
}

export default function SettingsPage() {
  const [user, setUser]               = useState<User | null>(null)
  const [planId, setPlanId]           = useState<PlanId>('free')
  const [phone, setPhone]             = useState('')
  const [phoneSaved, setPhoneSaved]   = useState(false)
  const [phoneSaving, setPhoneSaving] = useState(false)
  const [phoneError, setPhoneError]   = useState('')

  useEffect(() => {
    const sb = createSupabaseBrowserClient()
    sb.auth.getUser().then(({ data }) => {
      if (data.user) {
        setUser(data.user)
        setPhone(
          (data.user.user_metadata as Record<string, string>)?.whatsapp_phone ?? '',
        )
      }
    })
    fetch('/api/member/plan')
      .then(r => r.json())
      .then((d: { planId?: string }) => {
        if (d.planId) setPlanId(d.planId as PlanId)
      })
      .catch(() => {})
  }, [])

  async function savePhone() {
    setPhoneSaving(true)
    setPhoneError('')
    try {
      const sb = createSupabaseBrowserClient()
      const { error } = await sb.auth.updateUser({ data: { whatsapp_phone: phone } })
      if (error) throw error
      setPhoneSaved(true)
      setTimeout(() => setPhoneSaved(false), 3000)
    } catch (e) {
      setPhoneError(e instanceof Error ? e.message : 'Failed to save')
    } finally {
      setPhoneSaving(false)
    }
  }

  async function signOut() {
    await createSupabaseBrowserClient().auth.signOut()
    window.location.href = '/'
  }

  const memberSince = user?.created_at
    ? new Date(user.created_at).toLocaleDateString('en-US', {
        month: 'long', year: 'numeric',
      })
    : '—'

  return (
    <div className="max-w-xl">
      <h1 className="text-xl font-bold text-white mb-8">Settings</h1>

      {/* Account section */}
      <section className="bg-[#0d0d14] border border-white/[0.07] rounded-xl p-6 mb-4">
        <h2 className="text-sm font-semibold text-white mb-4">Account</h2>
        <div className="space-y-3">
          <div>
            <p className="text-xs uppercase tracking-wider text-gray-500 mb-1">Email</p>
            <p className="text-sm text-gray-300">{user?.email ?? '…'}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-gray-500 mb-1">Plan</p>
            <span
              className={`inline-flex text-xs font-bold px-2 py-0.5 rounded-full uppercase tracking-wider border ${
                planId === 'enterprise'
                  ? 'bg-purple-500/15 text-purple-400 border-purple-500/25'
                  : planId === 'pro'
                  ? 'bg-cyan-400/10 text-cyan-400 border-cyan-400/20'
                  : 'bg-gray-500/15 text-gray-400 border-gray-500/25'
              }`}
            >
              {planId}
            </span>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-gray-500 mb-1">Member Since</p>
            <p className="text-sm text-gray-300">{memberSince}</p>
          </div>
        </div>
      </section>

      {/* Notifications section */}
      <section className="bg-[#0d0d14] border border-white/[0.07] rounded-xl p-6 mb-4">
        <h2 className="text-sm font-semibold text-white mb-4">Notifications</h2>
        <div className="space-y-4">
          <div>
            <label className="text-xs uppercase tracking-wider text-gray-500 block mb-1.5">
              WhatsApp / Telegram Number
            </label>
            <div className="flex gap-2">
              <input
                type="tel"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                placeholder="+1 555 000 0000"
                className="flex-1 bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-cyan-400/50"
              />
              <button
                onClick={savePhone}
                disabled={phoneSaving}
                className="px-4 py-2 bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-[#070711] text-sm font-bold rounded-lg transition-colors"
              >
                {phoneSaving ? '…' : phoneSaved ? 'Saved ✓' : 'Save'}
              </button>
            </div>
            {phoneError && (
              <p className="text-red-400 text-xs mt-1">{phoneError}</p>
            )}
            <p className="text-gray-600 text-xs mt-2">Used for signal alert delivery</p>
          </div>

          {/* Signal alerts toggle — cosmetic */}
          <div className="flex items-center justify-between py-2">
            <div>
              <p className="text-sm text-white">Signal Alerts</p>
              <p className="text-xs text-gray-600 mt-0.5">
                Receive alerts when new signals are detected
              </p>
            </div>
            <div className="w-10 h-5 bg-emerald-500 rounded-full relative cursor-pointer">
              <div className="absolute right-0.5 top-0.5 w-4 h-4 bg-white rounded-full" />
            </div>
          </div>
        </div>
      </section>

      {/* Plan section */}
      <section className="bg-[#0d0d14] border border-white/[0.07] rounded-xl p-6 mb-4">
        <h2 className="text-sm font-semibold text-white mb-4">
          Your Plan · {planId.charAt(0).toUpperCase() + planId.slice(1)}
        </h2>
        <ul className="space-y-1.5 mb-4">
          {PLAN_FEATURES[planId].map(f => (
            <li key={f} className="text-sm text-gray-300 flex items-center gap-2">
              <span className="text-emerald-400 text-xs">✓</span> {f}
            </li>
          ))}
        </ul>
        {planId !== 'enterprise' && (
          <Link
            href="/pricing"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-[#070711] font-bold text-sm transition-colors"
          >
            Upgrade Plan →
          </Link>
        )}
      </section>

      {/* Security section */}
      <section className="bg-[#0d0d14] border border-white/[0.07] rounded-xl p-6">
        <h2 className="text-sm font-semibold text-white mb-4">Security</h2>
        <div className="space-y-3">
          <div className="flex items-center justify-between py-2 border-b border-white/[0.06]">
            <p className="text-sm text-gray-300">Change Password</p>
            <span className="text-xs text-gray-600">Via email link</span>
          </div>
          <button
            onClick={signOut}
            className="text-sm text-red-400 hover:text-red-300 transition-colors"
          >
            Sign out →
          </button>
        </div>
      </section>
    </div>
  )
}
