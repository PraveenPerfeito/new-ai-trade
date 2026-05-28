import Link from 'next/link'
import { Zap, Brain, BarChart2, Shield, Database, Cpu, TrendingUp, ExternalLink, ArrowRight } from 'lucide-react'
import { PublicNav } from '@/components/public/nav'
import { PublicFooter } from '@/components/public/footer'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'About',
  description: 'SignalEdge AI — how we built institutional-grade quantitative crypto signal infrastructure with AI at its core.',
}

const STACK = [
  { name: 'Next.js 14', role: 'App Router + Server Components', color: 'text-white' },
  { name: 'TypeScript', role: 'End-to-end type safety', color: 'text-blue-400' },
  { name: 'Supabase', role: 'PostgreSQL + Auth + RLS', color: 'text-emerald-400' },
  { name: 'Claude AI', role: 'Signal validation (Haiku)', color: 'text-violet-400' },
  { name: 'Binance API', role: 'Spot + Futures market data', color: 'text-yellow-400' },
  { name: 'CoinMarketCap', role: 'Top-200 rankings + prices (primary)', color: 'text-blue-400' },
  { name: 'Tailwind CSS', role: 'Glassmorphism UI system', color: 'text-cyan-400' },
  { name: 'FastAPI', role: 'Python backend (admin ops)', color: 'text-green-400' },
]

const PIPELINE_STEPS = [
  { n: '01', label: 'Multi-Timeframe Confirmation', desc: '1h + 4h + 1d candles must agree on trend direction' },
  { n: '02', label: 'Volatility Gate', desc: 'ATR-based filter rejects low-volatility setups' },
  { n: '03', label: 'Trend Strength', desc: 'EMA alignment + ADX minimum threshold' },
  { n: '04', label: 'Setup Scoring', desc: 'Composite score from RSI, MACD, volume spike' },
  { n: '05', label: 'Risk-Reward Check', desc: 'Minimum 1.5:1 R:R required before continuing' },
  { n: '06', label: 'Risk Engine', desc: 'Grade A–F; grade F rejected without AI tokens spent' },
  { n: '07', label: 'Futures Intelligence', desc: 'OI, funding rate, L/S ratio, liquidation zones' },
  { n: '08', label: 'Claude AI Validation', desc: 'Anthropic Haiku validates quality + confidence' },
  { n: '09', label: 'Signal Delivery', desc: 'Telegram alert + dashboard + supabase persist' },
]

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-[#070711] text-white">
      <PublicNav />

      {/* Hero */}
      <section className="pt-32 pb-20 px-6">
        <div className="max-w-4xl mx-auto">
          <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-cyan-400/70 border border-cyan-400/20 rounded-full px-4 py-1.5 mb-6 bg-cyan-400/5">
            <Zap size={10} />
            About SignalEdge AI
          </div>
          <h1 className="text-4xl md:text-5xl font-black tracking-tight mb-6 leading-[1.1]">
            Institutional intelligence,<br />
            <span className="bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">
              made accessible
            </span>
          </h1>
          <p className="text-gray-400 text-xl leading-relaxed max-w-2xl">
            We built the quantitative signal infrastructure that used to require a team of quant engineers — and compressed it into a subscription platform any trader can access.
          </p>
        </div>
      </section>

      {/* Mission */}
      <section className="pb-20 px-6">
        <div className="max-w-4xl mx-auto grid md:grid-cols-2 gap-8">
          <div className="bg-white/[0.025] border border-white/[0.06] rounded-2xl p-8">
            <Brain size={22} className="text-cyan-400 mb-4" />
            <h2 className="text-lg font-bold mb-3">Why we built this</h2>
            <p className="text-gray-400 text-sm leading-relaxed">
              Retail crypto traders operate with incomplete information. They see price and volume — but not funding rates, open interest divergence, multi-timeframe confluence, or AI-scored pattern quality. Institutional desks have all of this. We wanted to change that.
            </p>
          </div>
          <div className="bg-white/[0.025] border border-white/[0.06] rounded-2xl p-8">
            <TrendingUp size={22} className="text-emerald-400 mb-4" />
            <h2 className="text-lg font-bold mb-3">What we built</h2>
            <p className="text-gray-400 text-sm leading-relaxed">
              A production-grade AI signal platform: a 9-step quantitative pipeline that scans 100+ coins continuously, validates setups with Claude AI, scores risk deterministically, and delivers only high-confidence setups — with full metadata — via Telegram and API.
            </p>
          </div>
        </div>
      </section>

      {/* How it works — pipeline */}
      <section className="pb-20 px-6">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-10">
            <h2 className="text-2xl font-bold mb-3">How SignalEdge AI works</h2>
            <p className="text-gray-500 text-sm max-w-lg mx-auto">
              Every signal traverses 9 quality gates. Only setups that clear all of them reach your feed.
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-3">
            {PIPELINE_STEPS.map(step => (
              <div key={step.n} className="flex gap-3 bg-white/[0.02] border border-white/[0.05] rounded-xl p-4">
                <span className="text-xs font-mono text-gray-600 shrink-0 w-6 mt-0.5">{step.n}</span>
                <div>
                  <p className="text-white text-xs font-semibold mb-1">{step.label}</p>
                  <p className="text-gray-600 text-xs leading-relaxed">{step.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Technology stack */}
      <section className="pb-20 px-6">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-10">
            <h2 className="text-2xl font-bold mb-3">Technology stack</h2>
            <p className="text-gray-500 text-sm">Chosen for reliability, cost-efficiency, and developer velocity.</p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {STACK.map(({ name, role, color }) => (
              <div key={name} className="bg-white/[0.025] border border-white/[0.06] rounded-xl p-4">
                <p className={`text-sm font-bold mb-1 ${color}`}>{name}</p>
                <p className="text-gray-600 text-xs">{role}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Design principles */}
      <section className="pb-20 px-6">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-10">
            <h2 className="text-2xl font-bold mb-3">Design principles</h2>
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            {[
              {
                icon: Shield,
                title: 'Safety before profit',
                desc: 'The risk engine runs before AI. Grade-F signals never reach users — and never spend tokens. Every signal includes a risk grade, stop loss, and position sizing recommendation.',
              },
              {
                icon: Cpu,
                title: 'Determinism over magic',
                desc: 'The first 8 pipeline steps are deterministic, auditable, and tunable. AI is the last gate — an intelligent filter, not a black box oracle.',
              },
              {
                icon: Database,
                title: 'Every decision is logged',
                desc: 'Scan runs, signal decisions, AI validation traces, and admin actions are all persisted. Win rates and expectancy metrics are computed from real resolved outcomes.',
              },
              {
                icon: BarChart2,
                title: 'Graceful degradation',
                desc: "When AI quotas are exhausted, heuristic fallback continues signal delivery. When market data is stale, the scanner pauses rather than delivering bad signals. The system fails safely.",
              },
            ].map(({ icon: Icon, title, desc }) => (
              <div key={title} className="flex gap-4 bg-white/[0.02] border border-white/[0.06] rounded-xl p-5">
                <div className="w-9 h-9 rounded-lg bg-cyan-500/10 border border-cyan-500/15 flex items-center justify-center shrink-0">
                  <Icon size={15} className="text-cyan-400" />
                </div>
                <div>
                  <p className="text-white text-sm font-semibold mb-1.5">{title}</p>
                  <p className="text-gray-500 text-xs leading-relaxed">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Roadmap teaser */}
      <section className="pb-20 px-6">
        <div className="max-w-4xl mx-auto bg-gradient-to-br from-cyan-500/5 to-violet-600/5 border border-white/[0.07] rounded-2xl p-8">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
            <div>
              <h2 className="text-xl font-bold mb-2">Where we&apos;re going</h2>
              <p className="text-gray-400 text-sm max-w-lg leading-relaxed">
                Q3 2026: Stripe subscriptions, premium subscriber dashboard, signal API with webhook delivery. Q4 2026: On-chain data, sentiment layer, portfolio correlation analytics. 2027: White-label signal feeds for institutional desks.
              </p>
            </div>
            <Link href="/investors"
              className="flex items-center gap-2 text-sm px-5 py-2.5 rounded-xl bg-white/[0.05] hover:bg-white/[0.09] border border-white/[0.1] text-white transition-all shrink-0">
              Full roadmap
              <ArrowRight size={13} />
            </Link>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="pb-24 px-6">
        <div className="max-w-xl mx-auto text-center">
          <h2 className="text-2xl font-bold mb-3">Join the early community</h2>
          <p className="text-gray-500 text-sm mb-6">
            Get real signals, see the platform in action, and help shape what we build next.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link href="/login"
              className="text-sm px-6 py-3 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-[#070711] font-bold transition-colors">
              Get Started Free
            </Link>
            <a href="https://t.me/signaledgeai" target="_blank" rel="noopener noreferrer"
              className="flex items-center justify-center gap-1.5 text-sm px-6 py-3 rounded-xl border border-white/[0.1] text-gray-300 hover:text-white transition-all">
              <ExternalLink size={13} />
              Telegram Community
            </a>
          </div>
        </div>
      </section>

      <PublicFooter />
    </div>
  )
}
