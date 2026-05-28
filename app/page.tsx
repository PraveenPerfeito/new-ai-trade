import Link from 'next/link'
import { PublicNav } from '@/components/public/nav'
import { PublicFooter } from '@/components/public/footer'
import { LiveMarketStrip } from '@/components/public/live-ticker'
import {
  ArrowRight, Brain, BarChart2, Shield, Zap,
  TrendingUp, Globe, Lock, CheckCircle2, Activity,
  Layers, Target, AlertTriangle, ExternalLink,
} from 'lucide-react'

export const metadata = {
  title: 'SignalEdge AI — Quantitative Crypto Intelligence Platform',
}

// ── Sample signal data ────────────────────────────────────────────────────────

const SAMPLE_SIGNALS = [
  {
    symbol:     'BTC/USDT',
    type:       'LONG',
    grade:      'A',
    confidence: 91,
    mode:       'HIGH_CONFIDENCE',
    rationale:  'Multi-timeframe momentum aligns across 1h/4h/1d. RSI recovery confirmed above 52 with expanding volume. Funding rate neutral — no leverage overextension. Institutional accumulation pattern detected in OI.',
    rr:         '2.8R',
    locked:     false,
  },
  {
    symbol:     'SOL/USDT',
    type:       'LONG',
    grade:      'B',
    confidence: 84,
    mode:       'FUTURES',
    rationale:  '',
    rr:         '2.3R',
    locked:     true,
  },
  {
    symbol:     'ETH/USDT',
    type:       'LONG',
    grade:      'A',
    confidence: 88,
    mode:       'INSTITUTIONAL',
    rationale:  '',
    rr:         '2.6R',
    locked:     true,
  },
]

// ── AI Pipeline steps ─────────────────────────────────────────────────────────

const PIPELINE = [
  { icon: '📡', label: 'Market Data',      desc: '200+ coins via CoinMarketCap + Binance' },
  { icon: '📊', label: 'MTF Confirmation', desc: '1h / 4h / 1d timeframe alignment' },
  { icon: '⚡', label: 'Volatility Gate',  desc: 'ATR-based volatility screening' },
  { icon: '📈', label: 'Trend Strength',   desc: 'EMA / MACD trend confirmation' },
  { icon: '🎯', label: 'Setup Scoring',    desc: 'Pattern quality 0–100 score' },
  { icon: '⚖️', label: 'Risk Engine',      desc: 'Grade A–F, max leverage cap' },
  { icon: '🔮', label: 'Futures Intel',    desc: 'Funding rate, OI, liquidation zones' },
  { icon: '🤖', label: 'Claude AI',        desc: 'Haiku validation + reasoning' },
  { icon: '✅', label: 'Signal Output',    desc: 'Realtime alert via Telegram' },
]

// ── Features ──────────────────────────────────────────────────────────────────

const FEATURES = [
  { icon: Brain,       title: 'Claude AI Validation',    desc: 'Every signal validated by Anthropic Claude Haiku. AI reasoning attached to each setup. Heuristic fallback ensures 100% coverage.' },
  { icon: Globe,       title: 'Multi-Provider Coverage', desc: 'CoinMarketCap + Binance cross-validation. Provider failover ensures 99%+ uptime. Market data from 6 independent sources.' },
  { icon: BarChart2,   title: 'Quantitative Edge',       desc: 'Win rate, expectancy, RR distribution tracked across all signals. Confidence calibration ECE scoring. Real statistics, no hype.' },
  { icon: Shield,      title: 'Risk Intelligence',       desc: 'Grade A–F risk scoring. Futures leverage intelligence. Liquidation zone detection. Portfolio risk caps enforced.' },
  { icon: Activity,    title: '10-Mode Scanner',         desc: 'Spot, Futures, High-Confidence, Momentum, Trending, Watchlist, Rotation, Sniper, Multi-asset, Cross-Validation modes.' },
  { icon: TrendingUp,  title: 'Market Regime Detection', desc: 'BTC trend regime classification. Sector momentum tracking. Correction warning system. Market breadth analytics.' },
]

// ── Grade component ───────────────────────────────────────────────────────────

function GradeBadge({ grade }: { grade: string }) {
  const colors: Record<string, string> = {
    A: 'text-emerald-400 border-emerald-400/30 bg-emerald-400/5',
    B: 'text-blue-400 border-blue-400/30 bg-blue-400/5',
    C: 'text-yellow-400 border-yellow-400/30 bg-yellow-400/5',
  }
  return (
    <span className={`text-xs font-bold px-1.5 py-0.5 rounded border ${colors[grade] ?? 'text-gray-400 border-gray-600'}`}>
      {grade}
    </span>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function HomePage() {
  return (
    <div className="min-h-screen bg-[#070711] text-white">
      <PublicNav />

      {/* ── HERO ─────────────────────────────────────────────────────────── */}
      <section className="relative pt-28 pb-16 overflow-hidden">

        {/* Background glows */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[500px] rounded-full bg-cyan-500/[0.06] blur-[120px]" />
          <div className="absolute top-40 right-0 w-[500px] h-[400px] rounded-full bg-blue-600/[0.05] blur-[100px]" />
          <div className="absolute top-60 left-0 w-[400px] h-[300px] rounded-full bg-purple-600/[0.04] blur-[100px]" />
          {/* Dot grid */}
          <div className="absolute inset-0 opacity-[0.015]"
            style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,0.8) 1px, transparent 1px)', backgroundSize: '28px 28px' }}
          />
        </div>

        <div className="relative max-w-7xl mx-auto px-6 text-center">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 mb-8 px-3.5 py-1.5 rounded-full border border-cyan-400/20 bg-cyan-400/[0.06] text-cyan-400 text-xs font-semibold">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
            Beta · Claude AI-Powered · Realtime Intelligence
          </div>

          {/* Headline */}
          <h1 className="text-5xl sm:text-6xl md:text-7xl font-bold tracking-tight leading-[1.05] mb-6">
            <span className="text-white">Quantitative </span>
            <span className="bg-gradient-to-r from-cyan-400 via-blue-400 to-purple-500 bg-clip-text text-transparent">AI Crypto</span>
            <br />
            <span className="text-white">Intelligence Platform</span>
          </h1>

          {/* Subheadline */}
          <p className="text-gray-400 text-lg sm:text-xl max-w-2xl mx-auto leading-relaxed mb-10">
            Institutional-grade signal intelligence powered by Claude AI.
            Multi-provider market validation. Quantitative edge tracking for modern crypto markets.
          </p>

          {/* CTAs */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-12">
            <Link href="/pricing"
              className="flex items-center gap-2 px-7 py-3.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-[#070711] font-bold text-sm transition-all shadow-[0_0_24px_rgba(0,212,255,0.35)] hover:shadow-[0_0_32px_rgba(0,212,255,0.5)]">
              Start Free
              <ArrowRight size={15} />
            </Link>
            <a href="https://t.me/signaledgeai" target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-2 px-7 py-3.5 rounded-xl bg-white/[0.05] hover:bg-white/[0.09] text-white border border-white/[0.09] font-semibold text-sm transition-all">
              <ExternalLink size={14} />
              Join Telegram
            </a>
          </div>

          {/* Trust badges */}
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-gray-600 text-xs">
            {['Claude AI Validated', 'Binance Data', 'CMC Verified', '200+ Coins', 'Realtime Signals', 'A–F Risk Grading'].map(b => (
              <span key={b} className="flex items-center gap-1.5">
                <CheckCircle2 size={10} className="text-gray-700" />
                {b}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ── LIVE MARKET STRIP ─────────────────────────────────────────────── */}
      <LiveMarketStrip />

      {/* ── PLATFORM OVERVIEW ─────────────────────────────────────────────── */}
      <section id="intelligence" className="py-24 px-6">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <p className="text-cyan-400 text-xs font-semibold uppercase tracking-widest mb-3">Three Experiences</p>
            <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">Built for Every Layer</h2>
            <p className="text-gray-500 max-w-xl mx-auto text-sm leading-relaxed">
              A clearly separated platform architecture. Public intelligence, premium signals, and a private founder command center.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-5">
            {[
              {
                icon:    Globe,
                badge:   'PUBLIC',
                title:   'Market Intelligence',
                sub:     'Free access',
                color:   'text-gray-400',
                border:  'border-white/[0.07]',
                features: ['Live market overview', 'Sample signal previews', 'AI market commentary', 'Trend indicators', 'Public Telegram channel'],
              },
              {
                icon:    Zap,
                badge:   'PREMIUM',
                title:   'Signal Intelligence',
                sub:     'Pro & Institutional',
                color:   'text-cyan-400',
                border:  'border-cyan-400/20',
                glow:    true,
                features: ['Realtime AI-validated signals', 'Claude AI reasoning', 'All 10 scan modes', 'Premium Telegram', 'Signal history & analytics'],
              },
              {
                icon:    Layers,
                badge:   'PRIVATE',
                title:   'Founder Terminal',
                sub:     'Admin only',
                color:   'text-purple-400',
                border:  'border-white/[0.07]',
                features: ['Realtime telemetry', 'Provider orchestration', 'Quantitative analytics', 'Runtime configuration', 'AI effectiveness monitoring'],
              },
            ].map(({ icon: Icon, badge, title, sub, color, border, glow, features }) => (
              <div key={title} className={`relative rounded-2xl bg-white/[0.03] border ${border} p-6 ${glow ? 'shadow-[0_0_32px_rgba(0,212,255,0.08)]' : ''}`}>
                {glow && (
                  <div className="absolute -top-px left-8 right-8 h-px bg-gradient-to-r from-transparent via-cyan-400/40 to-transparent" />
                )}
                <div className="flex items-center justify-between mb-5">
                  <div className={`w-9 h-9 rounded-xl bg-white/[0.05] flex items-center justify-center ${color}`}>
                    <Icon size={16} />
                  </div>
                  <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-full border ${
                    badge === 'PREMIUM' ? 'text-cyan-400 border-cyan-400/20 bg-cyan-400/5' :
                    badge === 'PRIVATE' ? 'text-purple-400 border-purple-400/20 bg-purple-400/5' :
                    'text-gray-500 border-white/10 bg-white/[0.03]'
                  }`}>
                    {badge}
                  </span>
                </div>
                <h3 className="text-white font-bold text-lg mb-1">{title}</h3>
                <p className={`text-xs mb-5 ${color}`}>{sub}</p>
                <ul className="space-y-2.5">
                  {features.map(f => (
                    <li key={f} className="flex items-center gap-2.5 text-gray-400 text-sm">
                      <CheckCircle2 size={13} className={color} />
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── AI PIPELINE ────────────────────────────────────────────────────── */}
      <section id="pipeline" className="py-20 px-6 bg-white/[0.015] border-y border-white/[0.05]">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-14">
            <p className="text-cyan-400 text-xs font-semibold uppercase tracking-widest mb-3">Signal Intelligence Engine</p>
            <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">9-Step Validation Pipeline</h2>
            <p className="text-gray-500 max-w-xl mx-auto text-sm leading-relaxed">
              Every coin runs through a rigorous quantitative pipeline before reaching AI validation. Most are rejected. Only institutional-grade setups pass.
            </p>
          </div>

          {/* Pipeline steps */}
          <div className="grid grid-cols-3 md:grid-cols-9 gap-3">
            {PIPELINE.map((step, i) => (
              <div key={step.label} className="flex flex-col items-center gap-2 group relative">
                {/* Connector */}
                {i < PIPELINE.length - 1 && (
                  <div className="hidden md:block absolute top-6 left-[calc(50%+20px)] w-[calc(100%-24px)] h-px bg-gradient-to-r from-cyan-400/20 to-transparent" />
                )}
                <div className="w-12 h-12 rounded-2xl bg-white/[0.04] border border-white/[0.07] flex items-center justify-center text-xl group-hover:border-cyan-400/20 group-hover:bg-cyan-400/[0.04] transition-all">
                  {step.icon}
                </div>
                <p className="text-white text-[11px] font-semibold text-center leading-tight">{step.label}</p>
                <p className="text-gray-600 text-[10px] text-center leading-snug hidden md:block">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── SIGNAL SHOWCASE ────────────────────────────────────────────────── */}
      <section id="signals" className="py-24 px-6">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-14">
            <p className="text-cyan-400 text-xs font-semibold uppercase tracking-widest mb-3">Intelligence Preview</p>
            <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">Signal Intelligence Format</h2>
            <p className="text-gray-500 max-w-xl mx-auto text-sm">
              Each signal includes AI reasoning, risk grade, setup quality score, and quantitative validation. Premium unlocks realtime access.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-5">
            {SAMPLE_SIGNALS.map((sig) => (
              <div key={sig.symbol} className={`relative rounded-2xl border p-5 ${
                sig.locked
                  ? 'bg-white/[0.02] border-white/[0.06]'
                  : 'bg-white/[0.04] border-cyan-400/[0.15] shadow-[0_0_24px_rgba(0,212,255,0.06)]'
              }`}>
                {!sig.locked && (
                  <div className="absolute -top-px left-8 right-8 h-px bg-gradient-to-r from-transparent via-cyan-400/30 to-transparent" />
                )}

                {/* Header */}
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-white text-sm">{sig.symbol}</span>
                    <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${sig.type === 'LONG' ? 'text-emerald-400 bg-emerald-400/10' : 'text-red-400 bg-red-400/10'}`}>
                      {sig.type}
                    </span>
                    <GradeBadge grade={sig.grade} />
                  </div>
                  <span className="text-[10px] font-mono text-gray-600 uppercase">{sig.mode.replace('_', ' ')}</span>
                </div>

                {/* Confidence */}
                <div className="flex items-center gap-2 mb-4">
                  <div className="flex-1 h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-blue-500"
                      style={{ width: `${sig.confidence}%` }}
                    />
                  </div>
                  <span className="text-cyan-400 font-mono text-xs font-bold">{sig.confidence}%</span>
                </div>

                {sig.locked ? (
                  <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 flex flex-col items-center gap-2">
                    <Lock size={16} className="text-gray-600" />
                    <p className="text-gray-500 text-xs text-center">AI reasoning + entry levels locked</p>
                    <Link href="/pricing"
                      className="mt-1 text-xs px-3 py-1.5 rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-400/20 hover:bg-cyan-500/20 transition-colors">
                      Unlock Premium →
                    </Link>
                  </div>
                ) : (
                  <>
                    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3.5 mb-4">
                      <p className="text-gray-500 text-[10px] uppercase tracking-wider font-semibold mb-1.5 flex items-center gap-1.5">
                        <Brain size={10} className="text-cyan-400" />
                        Claude AI Reasoning
                      </p>
                      <p className="text-gray-300 text-xs leading-relaxed">{sig.rationale}</p>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-center">
                      {['Entry', 'Target', 'Stop'].map(l => (
                        <div key={l} className="rounded-lg bg-white/[0.02] border border-white/[0.04] px-2 py-2">
                          <p className="text-gray-600 text-[10px] uppercase mb-0.5">{l}</p>
                          <p className="text-white font-mono text-xs font-bold">—</p>
                        </div>
                      ))}
                    </div>
                    <div className="flex items-center justify-between mt-3 pt-3 border-t border-white/[0.05]">
                      <span className="text-gray-500 text-xs">Risk/Reward</span>
                      <span className="text-emerald-400 font-mono text-sm font-bold">{sig.rr}</span>
                    </div>
                    <div className="mt-3 text-center">
                      <span className="text-[10px] text-gray-600 uppercase tracking-wider">Sample · Illustrative · Not Financial Advice</span>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FEATURES ───────────────────────────────────────────────────────── */}
      <section className="py-20 px-6 bg-white/[0.01] border-y border-white/[0.05]">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-14">
            <p className="text-cyan-400 text-xs font-semibold uppercase tracking-widest mb-3">Infrastructure</p>
            <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">Built for Institutional Quality</h2>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {FEATURES.map(({ icon: Icon, title, desc }) => (
              <div key={title} className="rounded-2xl bg-white/[0.03] border border-white/[0.06] p-5 hover:border-white/[0.12] hover:bg-white/[0.05] transition-all group">
                <div className="w-9 h-9 rounded-xl bg-white/[0.05] flex items-center justify-center text-cyan-400 mb-4 group-hover:bg-cyan-400/[0.08] transition-colors">
                  <Icon size={16} />
                </div>
                <h3 className="text-white font-semibold text-sm mb-2">{title}</h3>
                <p className="text-gray-500 text-xs leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── PERFORMANCE STATS ─────────────────────────────────────────────── */}
      <section id="performance" className="py-20 px-6">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-12">
            <p className="text-cyan-400 text-xs font-semibold uppercase tracking-widest mb-3">Transparency</p>
            <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">Honest Performance Metrics</h2>
            <p className="text-gray-500 max-w-xl mx-auto text-sm leading-relaxed">
              Real statistics from the scanner. No cherry-picked results. Metrics populate automatically as signals resolve. System is in early burn-in phase.
            </p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-5 mb-8">
            {[
              { label: 'Scan Modes',      value: '10',    unit: '',    sub: 'Spot to Institutional' },
              { label: 'Coins Monitored', value: '100+',  unit: '',    sub: 'Top market cap' },
              { label: 'Providers',       value: '6',     unit: '',    sub: 'Cross-validated' },
              { label: 'AI Validation',   value: '100',   unit: '%',   sub: 'Coverage (w/ fallback)' },
            ].map(({ label, value, unit, sub }) => (
              <div key={label} className="rounded-2xl bg-white/[0.03] border border-white/[0.07] p-5 text-center">
                <p className="text-3xl font-bold text-white mb-1">
                  {value}<span className="text-cyan-400">{unit}</span>
                </p>
                <p className="text-gray-400 text-sm font-medium">{label}</p>
                <p className="text-gray-600 text-xs mt-0.5">{sub}</p>
              </div>
            ))}
          </div>

          <div className="rounded-2xl border border-yellow-500/20 bg-yellow-500/[0.03] px-6 py-4 flex items-start gap-3">
            <AlertTriangle size={14} className="text-yellow-500 mt-0.5 shrink-0" />
            <p className="text-gray-500 text-xs leading-relaxed">
              <span className="text-yellow-500 font-semibold">Statistical metrics warm up over time. </span>
              Win rate, expectancy, and calibration data require 30+ resolved signals before statistical validity. Early-phase metrics are building. Full performance dashboard available in the admin terminal.
            </p>
          </div>
        </div>
      </section>

      {/* ── PRICING PREVIEW ───────────────────────────────────────────────── */}
      <section className="py-20 px-6 bg-white/[0.015] border-y border-white/[0.05]">
        <div className="max-w-4xl mx-auto text-center">
          <p className="text-cyan-400 text-xs font-semibold uppercase tracking-widest mb-3">Pricing</p>
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">Start Free, Scale When Ready</h2>
          <p className="text-gray-500 text-sm mb-12">Choose your intelligence tier. No credit card required to start.</p>

          <div className="grid md:grid-cols-3 gap-5 text-left mb-10">
            {[
              {
                name:     'Free',
                price:    '$0',
                sub:      'forever',
                color:    'border-white/[0.07]',
                features: ['Market overview', 'Signal previews (delayed)', 'Free Telegram channel', 'Basic watchlist'],
                cta:      'Get Started',
                ctaStyle: 'bg-white/[0.06] hover:bg-white/[0.10] text-white border border-white/[0.09]',
              },
              {
                name:     'Pro',
                price:    '$29',
                sub:      '/ month',
                color:    'border-cyan-400/20 shadow-[0_0_32px_rgba(0,212,255,0.08)]',
                badge:    'Most Popular',
                features: ['Realtime signals', 'Claude AI reasoning', 'Premium Telegram', 'All 10 scan modes', 'Signal history (30d)'],
                cta:      'Start Pro',
                ctaStyle: 'bg-cyan-500 hover:bg-cyan-400 text-[#070711] font-bold shadow-[0_0_16px_rgba(0,212,255,0.3)]',
              },
              {
                name:     'Institutional',
                price:    '$99',
                sub:      '/ month',
                color:    'border-white/[0.07]',
                features: ['Everything in Pro', 'REST API access', 'Webhook delivery', 'Custom configuration', 'Priority support'],
                cta:      'Contact Us',
                ctaStyle: 'bg-white/[0.06] hover:bg-white/[0.10] text-white border border-white/[0.09]',
              },
            ].map(({ name, price, sub, color, badge, features, cta, ctaStyle }) => (
              <div key={name} className={`relative rounded-2xl bg-white/[0.03] border ${color} p-6`}>
                {badge && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-cyan-400 text-[#070711] text-[11px] font-bold">
                    {badge}
                  </div>
                )}
                <p className="text-gray-400 text-sm font-semibold mb-2">{name}</p>
                <div className="flex items-baseline gap-1 mb-5">
                  <span className="text-3xl font-bold text-white">{price}</span>
                  <span className="text-gray-500 text-sm">{sub}</span>
                </div>
                <ul className="space-y-2.5 mb-6">
                  {features.map(f => (
                    <li key={f} className="flex items-center gap-2 text-gray-400 text-sm">
                      <CheckCircle2 size={13} className="text-cyan-400 shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>
                <Link href="/pricing" className={`block text-center py-2.5 rounded-xl text-sm transition-all ${ctaStyle}`}>
                  {cta}
                </Link>
              </div>
            ))}
          </div>

          <Link href="/pricing" className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-300 transition-colors">
            View full pricing & feature comparison
            <ArrowRight size={13} />
          </Link>
        </div>
      </section>

      {/* ── TELEGRAM CTA ─────────────────────────────────────────────────── */}
      <section className="py-24 px-6">
        <div className="max-w-3xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 mb-6 px-3 py-1.5 rounded-full border border-cyan-400/20 bg-cyan-400/[0.05] text-cyan-400 text-xs font-semibold">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
            Free Community Access
          </div>
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-5">
            Join the Intelligence Community
          </h2>
          <p className="text-gray-400 text-base mb-10 leading-relaxed">
            Free Telegram channel with market commentary, regime analysis, and curated intelligence. Premium channel delivers realtime AI-validated signals.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <a href="https://t.me/signaledgeai" target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-2 px-7 py-3.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-[#070711] font-bold text-sm transition-all shadow-[0_0_24px_rgba(0,212,255,0.3)]">
              <ExternalLink size={14} />
              Join Free Telegram
            </a>
            <Link href="/pricing"
              className="flex items-center gap-2 px-7 py-3.5 rounded-xl bg-white/[0.05] hover:bg-white/[0.09] text-white border border-white/[0.09] font-semibold text-sm transition-all">
              Upgrade to Premium
              <ArrowRight size={14} />
            </Link>
          </div>
        </div>
      </section>

      {/* ── FOOTER ────────────────────────────────────────────────────────── */}
      <PublicFooter />
    </div>
  )
}
