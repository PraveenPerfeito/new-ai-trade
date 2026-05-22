import Link from 'next/link'
import { Check, X, Zap, Shield, Brain, TrendingUp, ExternalLink } from 'lucide-react'
import { PublicNav } from '@/components/public/nav'
import { PublicFooter } from '@/components/public/footer'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Pricing & Plans',
  description: 'Choose your intelligence tier. Free signals, Pro quant tools, or Institutional-grade infrastructure.',
}

const TIERS = [
  {
    name: 'Free',
    price: null,
    tagline: 'Explore the signal layer',
    color: 'border-white/[0.08]',
    badge: null,
    cta: { label: 'Start Free', href: '/login', style: 'bg-white/[0.07] hover:bg-white/[0.12] border border-white/[0.12] text-white' },
    features: [
      { label: 'Top 3 signals per day', included: true },
      { label: 'Market regime indicator', included: true },
      { label: 'Live price ticker', included: true },
      { label: 'Public signal dashboard', included: true },
      { label: 'Telegram community access', included: true },
      { label: 'Full signal details & targets', included: false },
      { label: 'Real-time scanner alerts', included: false },
      { label: 'Risk grade + position sizing', included: false },
      { label: 'Futures intelligence (OI, funding)', included: false },
      { label: 'Win rate & expectancy metrics', included: false },
      { label: 'API access', included: false },
      { label: 'Priority Telegram alerts', included: false },
    ],
  },
  {
    name: 'Pro',
    price: 29,
    tagline: 'Full quantitative edge',
    color: 'border-cyan-500/40',
    badge: 'Most Popular',
    cta: { label: 'Get Pro Access', href: 'https://t.me/signaledgeai', style: 'bg-cyan-500 hover:bg-cyan-400 text-[#070711] font-bold shadow-[0_0_24px_rgba(0,212,255,0.35)]' },
    features: [
      { label: 'Unlimited signals, all markets', included: true },
      { label: 'Market regime indicator', included: true },
      { label: 'Live price ticker', included: true },
      { label: 'Full signal details & targets', included: true },
      { label: 'Real-time scanner alerts', included: true },
      { label: 'Risk grade + position sizing', included: true },
      { label: 'Futures intelligence (OI, funding)', included: true },
      { label: 'Win rate & expectancy metrics', included: true },
      { label: 'Multi-timeframe confirmation', included: true },
      { label: 'Telegram priority alerts', included: true },
      { label: 'API access', included: false },
      { label: 'White-glove onboarding', included: false },
    ],
  },
  {
    name: 'Institutional',
    price: 99,
    tagline: 'Infrastructure-grade access',
    color: 'border-violet-500/30',
    badge: 'Enterprise',
    cta: { label: 'Contact Us', href: 'https://t.me/signaledgeai', style: 'bg-violet-600 hover:bg-violet-500 text-white font-semibold shadow-[0_0_24px_rgba(139,92,246,0.25)]' },
    features: [
      { label: 'Everything in Pro', included: true },
      { label: 'Raw API access (JSON)', included: true },
      { label: 'Webhook delivery to your systems', included: true },
      { label: 'Historical signal archive', included: true },
      { label: 'Backtest data export', included: true },
      { label: 'Custom scan frequency', included: true },
      { label: 'Portfolio correlation analysis', included: true },
      { label: 'Dedicated Telegram group', included: true },
      { label: 'White-glove onboarding', included: true },
      { label: 'SLA uptime guarantee', included: true },
      { label: 'Custom model tuning (roadmap)', included: true },
      { label: 'Priority support', included: true },
    ],
  },
]

const FAQ = [
  {
    q: 'How are signals generated?',
    a: 'SignalEdge AI runs a 9-step quantitative pipeline: multi-timeframe confirmation → volatility gate → trend strength → setup scoring → risk-reward check → risk engine → futures intelligence → Claude AI validation. Only setups that clear all gates are surfaced.',
  },
  {
    q: 'What markets does SignalEdge cover?',
    a: 'We scan the top 100 cryptocurrencies by market cap on Binance, covering spot and perpetual futures markets. The scanner runs automatically on a rolling schedule and on-demand.',
  },
  {
    q: 'How are win rates calculated?',
    a: 'Win rate and expectancy metrics are computed from resolved signals — those where price has hit a target or stop level. Early-stage metrics show warmup states until sufficient sample size is reached (minimum 30 resolved signals).',
  },
  {
    q: 'Can I cancel anytime?',
    a: 'Yes. All plans are month-to-month with no lock-in. Downgrade or cancel through Telegram — changes take effect at the end of your current billing period.',
  },
  {
    q: 'Is this financial advice?',
    a: 'No. SignalEdge AI provides quantitative market intelligence for informational purposes only. Nothing constitutes financial advice or a recommendation to trade. All decisions are yours; please manage your risk accordingly.',
  },
  {
    q: 'How do I get API access?',
    a: 'API access is available on the Institutional plan. Authentication uses bearer tokens; endpoints return structured JSON. Reach out via Telegram for documentation and onboarding.',
  },
]

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-[#070711] text-white">
      <PublicNav />

      {/* Hero */}
      <section className="pt-32 pb-16 px-6 text-center">
        <div className="max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-cyan-400/70 border border-cyan-400/20 rounded-full px-4 py-1.5 mb-6 bg-cyan-400/5">
            <Zap size={10} />
            Transparent Pricing
          </div>
          <h1 className="text-4xl md:text-5xl font-black tracking-tight mb-4 leading-[1.1]">
            Choose your
            <span className="bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent"> intelligence tier</span>
          </h1>
          <p className="text-gray-400 text-lg leading-relaxed max-w-xl mx-auto">
            From exploratory free signals to full institutional-grade infrastructure. No lock-in, cancel anytime.
          </p>
        </div>
      </section>

      {/* Tier cards */}
      <section className="pb-24 px-6">
        <div className="max-w-5xl mx-auto grid md:grid-cols-3 gap-6 items-start">
          {TIERS.map(tier => (
            <div
              key={tier.name}
              className={`relative rounded-2xl border bg-white/[0.025] backdrop-blur-xl p-7 flex flex-col gap-6 ${tier.color} ${tier.badge === 'Most Popular' ? 'ring-1 ring-cyan-500/20' : ''}`}
            >
              {tier.badge && (
                <div className={`absolute -top-3 left-1/2 -translate-x-1/2 text-[11px] font-bold uppercase tracking-widest px-3 py-1 rounded-full ${
                  tier.badge === 'Most Popular' ? 'bg-cyan-500 text-[#070711]' : 'bg-violet-600 text-white'
                }`}>
                  {tier.badge}
                </div>
              )}

              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-1">{tier.name}</p>
                <div className="flex items-end gap-1 mb-1">
                  {tier.price === null ? (
                    <span className="text-3xl font-black text-white">Free</span>
                  ) : (
                    <>
                      <span className="text-3xl font-black text-white">${tier.price}</span>
                      <span className="text-gray-500 text-sm mb-1">/mo</span>
                    </>
                  )}
                </div>
                <p className="text-gray-400 text-sm">{tier.tagline}</p>
              </div>

              <Link
                href={tier.cta.href}
                {...(tier.cta.href.startsWith('http') ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                className={`block text-center text-sm py-2.5 rounded-xl transition-all ${tier.cta.style}`}
              >
                {tier.cta.label}
              </Link>

              <ul className="space-y-2.5">
                {tier.features.map(f => (
                  <li key={f.label} className="flex items-start gap-2.5 text-sm">
                    {f.included
                      ? <Check size={14} className="text-emerald-400 shrink-0 mt-0.5" />
                      : <X size={14} className="text-gray-700 shrink-0 mt-0.5" />
                    }
                    <span className={f.included ? 'text-gray-300' : 'text-gray-600'}>{f.label}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* Trust signals */}
      <section className="pb-20 px-6">
        <div className="max-w-4xl mx-auto">
          <div className="grid sm:grid-cols-3 gap-4">
            {[
              { icon: Shield, title: 'No lock-in contracts', desc: 'Month-to-month on all tiers. Cancel anytime through Telegram.' },
              { icon: Brain, title: 'Real AI validation', desc: 'Every signal passes Claude Haiku scoring before delivery.' },
              { icon: TrendingUp, title: 'Transparent metrics', desc: 'Win rate and expectancy computed from real resolved signals.' },
            ].map(({ icon: Icon, title, desc }) => (
              <div key={title} className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-5">
                <Icon size={18} className="text-cyan-400 mb-3" />
                <p className="text-white text-sm font-semibold mb-1">{title}</p>
                <p className="text-gray-500 text-xs leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="pb-24 px-6">
        <div className="max-w-2xl mx-auto">
          <h2 className="text-2xl font-bold text-center mb-10">Frequently asked questions</h2>
          <div className="space-y-4">
            {FAQ.map(({ q, a }) => (
              <div key={q} className="border border-white/[0.06] rounded-xl p-5 bg-white/[0.02]">
                <p className="text-white text-sm font-semibold mb-2">{q}</p>
                <p className="text-gray-500 text-sm leading-relaxed">{a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA bar */}
      <section className="pb-24 px-6">
        <div className="max-w-xl mx-auto text-center">
          <h2 className="text-2xl font-bold mb-3">Start with free signals today</h2>
          <p className="text-gray-500 text-sm mb-6">No credit card. No commitment. Upgrade when you&apos;re ready.</p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link href="/login"
              className="text-sm px-6 py-3 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-[#070711] font-bold transition-colors">
              Create Free Account
            </Link>
            <a href="https://t.me/signaledgeai" target="_blank" rel="noopener noreferrer"
              className="flex items-center justify-center gap-1.5 text-sm px-6 py-3 rounded-xl border border-white/[0.1] text-gray-300 hover:text-white hover:border-white/[0.2] transition-all">
              <ExternalLink size={13} />
              Join Telegram
            </a>
          </div>
        </div>
      </section>

      <PublicFooter />
    </div>
  )
}
