'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Menu, X, Zap, ExternalLink } from 'lucide-react'

const NAV_LINKS = [
  { href: '#intelligence', label: 'Intelligence' },
  { href: '/pricing',      label: 'Pricing' },
  { href: '/investors',    label: 'Investors' },
  { href: '/about',        label: 'About' },
]

export function PublicNav() {
  const [open,    setOpen]    = useState(false)
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 24)
    window.addEventListener('scroll', handler, { passive: true })
    return () => window.removeEventListener('scroll', handler)
  }, [])

  return (
    <header className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
      scrolled ? 'bg-[#070711]/90 backdrop-blur-xl border-b border-white/[0.06] shadow-[0_1px_20px_rgba(0,0,0,0.4)]' : ''
    }`}>
      <nav className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">

        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 group">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-cyan-400 to-blue-600 flex items-center justify-center shadow-[0_0_12px_rgba(0,212,255,0.4)]">
            <Zap size={13} className="text-white" fill="white" />
          </div>
          <span className="text-white font-bold text-[17px] tracking-tight">
            Signal<span className="text-cyan-400">Edge</span>
          </span>
          <span className="hidden sm:inline text-[9px] font-semibold uppercase tracking-widest text-cyan-400/60 border border-cyan-400/20 rounded px-1.5 py-0.5 ml-0.5">
            AI
          </span>
        </Link>

        {/* Desktop nav */}
        <div className="hidden md:flex items-center gap-7">
          {NAV_LINKS.map(link => (
            <Link key={link.href} href={link.href}
              className="text-gray-400 hover:text-white text-sm font-medium transition-colors duration-150">
              {link.label}
            </Link>
          ))}
        </div>

        {/* Desktop CTAs */}
        <div className="hidden md:flex items-center gap-3">
          <a
            href="https://t.me/signaledgeai"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-cyan-400 transition-colors"
          >
            <ExternalLink size={13} />
            Telegram
          </a>
          <Link href="/login"
            className="text-sm px-4 py-1.5 rounded-lg bg-white/[0.05] hover:bg-white/[0.09] text-white border border-white/[0.09] hover:border-white/[0.16] transition-all">
            Sign In
          </Link>
          <Link href="/pricing"
            className="text-sm px-4 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-[#070711] font-semibold transition-colors shadow-[0_0_16px_rgba(0,212,255,0.3)]">
            Get Started
          </Link>
        </div>

        {/* Mobile toggle */}
        <button
          onClick={() => setOpen(o => !o)}
          className="md:hidden text-gray-400 hover:text-white transition-colors p-1"
          aria-label="Toggle menu"
        >
          {open ? <X size={20} /> : <Menu size={20} />}
        </button>
      </nav>

      {/* Mobile menu */}
      {open && (
        <div className="md:hidden bg-[#070711]/98 backdrop-blur-xl border-b border-white/[0.06] px-6 py-5 space-y-1">
          {NAV_LINKS.map(link => (
            <Link key={link.href} href={link.href}
              onClick={() => setOpen(false)}
              className="block text-gray-400 hover:text-white text-sm font-medium py-2.5 border-b border-white/[0.04] transition-colors">
              {link.label}
            </Link>
          ))}
          <div className="pt-4 flex flex-col gap-2">
            <a href="https://t.me/signaledgeai" target="_blank" rel="noopener noreferrer"
              className="text-sm py-2.5 text-center text-gray-400 border border-white/[0.09] rounded-lg">
              Join Telegram
            </a>
            <Link href="/login" onClick={() => setOpen(false)}
              className="text-sm py-2.5 text-center text-white bg-white/[0.06] border border-white/[0.09] rounded-lg">
              Sign In
            </Link>
            <Link href="/pricing" onClick={() => setOpen(false)}
              className="text-sm py-2.5 text-center text-[#070711] bg-cyan-400 font-semibold rounded-lg">
              Get Started Free
            </Link>
          </div>
        </div>
      )}
    </header>
  )
}
