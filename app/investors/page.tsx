import Link from 'next/link'
import { Zap, Brain, TrendingUp, Shield, Database, Cpu, Globe, BarChart2, ExternalLink, CheckCircle } from 'lucide-react'
import { PublicNav } from '@/components/public/nav'
import { PublicFooter } from '@/components/public/footer'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Investors',
  description: 'SignalEdge AI investor overview — AI-native quantitative crypto intelligence with institutional-grade signal infrastructure.',
}

const INFRA_PILLARS = [
  {
    icon: Cpu,
    title: '9-Step Quantitative Pipeline',
    desc: 'Every signal passes multi-timeframe confirmation, volatility gate, trend strength, setup scoring, risk-reward check, risk engine, futures intelligence, and Claude AI validation before delivery. Each gate is independently tunable.',
  },
  {
    icon: Brain,
    title: 'Claude AI as Signal Validator',
    desc: 'Anthropic Claude Haiku validates signal quality, adjusts confidence scores, and provides reasoning traces. Heuristic fallbacks ensure 100% uptime even when AI quotas are exhausted.',
  },
  {
    icon: Database,
    title: 'Supabase PostgreSQL + RLS',
    desc: 'Row-level security enforced on all tables. Signals, scan runs, and backtest data stored with full audit trail. Admin access is dual-gated at middleware and API layers.',
  },
  {
    icon: BarChart2,
    title: 'Futures Intelligence Layer',
    desc: 'Open interest, funding rates, long/short ratios, and liquidation zone analysis run per-signal for futures-eligible setups. Data sourced directly from Binance Futures API.',
  },
  {
    icon: Shield,
    title: 'Risk Engine First',
    desc: 'Grade-F signals are rejected before spending Anthropic tokens. Risk grade (A–F), position sizing, leverage tiers, and dynamic stop placement are computed deterministically.',
  },
  {
    icon: Globe,
    title: 'Real-Time Market Coverage',
    desc: 'Top-100 cryptocurrencies by market cap continuously scanned. Scanner runs on a distributed lock-protected scheduler with in-process hot-reload resilience.',
  },
]

const ROADMAP = [
  { phase: 'Q2 2026', title: 'Platform Foundation', status: 'done', items: ['Quantitative signal pipeline', 'Admin Command Center', 'Telegram alert delivery', 'Supabase auth + RLS', 'Public landing experience'] },
  { phase: 'Q3 2026', title: 'SaaS Commercialization', status: 'active', items: ['Subscription tiers (Free / Pro / Institutional)', 'Stripe billing integration', 'Premium subscriber dashboard', 'Signal API with webhook delivery', 'Performance transparency pages'] },
  { phase: 'Q4 2026', title: 'Intelligence Expansion', status: 'planned', items: ['On-chain data integration (DeFi, whale wallets)', 'Sentiment layer (news, social volume)', 'Portfolio correlation & regime analytics', 'Custom model fine-tuning for institutional', 'Mobile-first PWA'] },
  { phase: '2027', title: 'Institutional & White-Label', status: 'planned', items: ['White-label signal feeds for funds', 'Multi-asset coverage (forex, equities)', 'Co-location signal delivery SLA', 'Institutional API partner program', 'Regulatory compliance framework'] },
]

const METRICS = [
  { label: 'Coins Monitored', value: '200+', sub: 'Top by market cap' },
  { label: 'Signal Pipeline Steps', value: '9', sub: 'Quality gates' },
  { label: 'Target Win Rate', value: '>65%', sub: 'A-grade setups' },
  { label: 'Data Sources', value: '3', sub: 'Binance · CoinMarketCap · Claude AI' },
]

export default function InvestorsPage() {
  return (
    <div className="min-h-screen bg-[#070711] text-white">
      <PublicNav />

      {/* Hero */}
      <section className="pt-32 pb-20 px-6">
        <div className="max-w-4xl mx-auto">
          <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-cyan-400/70 border border-cyan-400/20 rounded-full px-4 py-1.5 mb-6 bg-cyan-400/5">
            <Zap size={10} />
            Investor Overview
          </div>
          <h1 className="text-4xl md:text-6xl font-black tracking-tight mb-6 leading-[1.1]">
            Quantitative intelligence<br />
            <span className="bg-gradient-to-r from-cyan-400 via-blue-400 to-violet-400 bg-clip-text text-transparent">
              built for the AI era
            </span>
          </h1>
          <p className="text-gray-400 text-xl leading-relaxed max-w-2xl mb-8">
            SignalEdge AI is an AI-native signal infrastructure company. We&apos;ve built production-grade quantitative tooling that previously required a team of quant engineers — now available as a subscription API.
          </p>
          <div className="flex flex-wrap gap-3">
            <a href="https://t.me/signaledgeai" target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-sm px-5 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-[#070711] font-bold transition-colors">
              <ExternalLink size={13} />
              Connect via Telegram
            </a>
            <Link href="/about"
              className="text-sm px-5 py-2.5 rounded-xl border border-white/[0.1] text-gray-300 hover:text-white hover:border-white/[0.2] transition-all">
              About the Project
            </Link>
          </div>
        </div>
      </section>

      {/* Key metrics */}
      <section className="pb-20 px-6">
        <div className="max-w-4xl mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {METRICS.map(m => (
              <div key={m.label} className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-5 text-center">
                <p className="text-3xl font-black text-white mb-1">{m.value}</p>
                <p className="text-gray-300 text-sm font-semibold mb-0.5">{m.label}</p>
                <p className="text-gray-600 text-xs">{m.sub}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Thesis */}
      <section className="pb-20 px-6">
        <div className="max-w-4xl mx-auto grid md:grid-cols-2 gap-8 items-center">
          <div>
            <h2 className="text-2xl font-bold mb-4">The market opportunity</h2>
            <div className="space-y-4 text-gray-400 text-sm leading-relaxed">
              <p>
                Retail crypto traders lose systematically because they lack the infrastructure institutional desks take for granted: multi-timeframe confirmation, real-time risk scoring, funding-rate awareness, and AI-assisted pattern validation.
              </p>
              <p>
                SignalEdge AI compresses that institutional stack into a subscription API. We scan 100+ markets continuously, run a 9-step quality pipeline, and deliver only high-confidence setups with full risk metadata.
              </p>
              <p>
                The SaaS model converts infrastructure into recurring revenue. API and webhook tiers serve hedge funds and prop trading desks who need structured signal feeds without building the pipeline themselves.
              </p>
            </div>
          </div>
          <div className="space-y-3">
            {[
              'AI models are now cost-efficient enough for per-signal validation',
              'Binance + CoinMarketCap APIs provide institutional-grade market data at zero marginal cost',
              'Telegram delivery reaches crypto-native audiences where they already live',
              'Supabase + Next.js stack enables rapid iteration without infrastructure overhead',
              'No data labeling required — market outcomes provide natural ground truth',
            ].map(point => (
              <div key={point} className="flex items-start gap-3 bg-white/[0.02] border border-white/[0.06] rounded-lg p-3.5">
                <CheckCircle size={14} className="text-emerald-400 shrink-0 mt-0.5" />
                <span className="text-gray-300 text-sm">{point}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Infrastructure pillars */}
      <section className="pb-20 px-6">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-2xl font-bold mb-3">Infrastructure maturity</h2>
            <p className="text-gray-500 text-sm max-w-xl mx-auto">
              Production-hardened signal infrastructure. Not a prototype — a fully operational quantitative platform.
            </p>
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            {INFRA_PILLARS.map(({ icon: Icon, title, desc }) => (
              <div key={title} className="bg-white/[0.025] border border-white/[0.06] rounded-xl p-6">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-8 h-8 rounded-lg bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center">
                    <Icon size={14} className="text-cyan-400" />
                  </div>
                  <h3 className="text-white text-sm font-semibold">{title}</h3>
                </div>
                <p className="text-gray-500 text-xs leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* AI differentiation */}
      <section className="pb-20 px-6">
        <div className="max-w-4xl mx-auto bg-gradient-to-br from-cyan-500/5 to-blue-600/5 border border-cyan-500/10 rounded-2xl p-8">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-400 to-blue-600 flex items-center justify-center">
              <Brain size={18} className="text-white" />
            </div>
            <div>
              <h2 className="text-xl font-bold">AI-native from day one</h2>
              <p className="text-gray-500 text-xs">Not AI-bolted-on — built around model inference</p>
            </div>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {[
              {
                title: 'Claude AI as last gate',
                desc: 'Anthropic Claude Haiku runs at the end of the pipeline. It reviews all upstream signals and either validates or flags each setup with a reasoning trace.',
              },
              {
                title: 'Cost-engineered inference',
                desc: 'The 8 pre-AI gates reject low-quality setups without spending AI tokens. Claude only sees grade A–C candidates — cutting inference cost by ~70%.',
              },
              {
                title: 'Heuristic fallback layer',
                desc: 'When AI quota is exhausted, the system falls back to deterministic heuristics with no signal delivery gap. Platform uptime is decoupled from API availability.',
              },
            ].map(({ title, desc }) => (
              <div key={title}>
                <p className="text-cyan-400 text-sm font-semibold mb-2">{title}</p>
                <p className="text-gray-500 text-xs leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Roadmap */}
      <section className="pb-20 px-6">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-2xl font-bold mb-3">Product roadmap</h2>
            <p className="text-gray-500 text-sm">From infrastructure to institutional-grade intelligence platform.</p>
          </div>
          <div className="relative">
            <div className="absolute left-[11px] top-4 bottom-4 w-px bg-white/[0.05] hidden md:block" />
            <div className="space-y-6">
              {ROADMAP.map(phase => (
                <div key={phase.phase} className="flex gap-6">
                  <div className="hidden md:flex flex-col items-center pt-1">
                    <div className={`w-6 h-6 rounded-full border-2 shrink-0 flex items-center justify-center ${
                      phase.status === 'done'   ? 'bg-emerald-500/20 border-emerald-500/60' :
                      phase.status === 'active' ? 'bg-cyan-500/20 border-cyan-500/60' :
                      'bg-white/[0.04] border-white/[0.12]'
                    }`}>
                      {phase.status === 'done' && <span className="w-2 h-2 rounded-full bg-emerald-400" />}
                      {phase.status === 'active' && <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />}
                    </div>
                  </div>
                  <div className={`flex-1 bg-white/[0.02] border rounded-xl p-5 ${
                    phase.status === 'done'   ? 'border-emerald-500/15' :
                    phase.status === 'active' ? 'border-cyan-500/20' :
                    'border-white/[0.06]'
                  }`}>
                    <div className="flex items-center gap-3 mb-3">
                      <span className="text-xs font-mono text-gray-500">{phase.phase}</span>
                      <span className={`text-xs font-bold uppercase tracking-widest px-2 py-0.5 rounded-full ${
                        phase.status === 'done'   ? 'text-emerald-400 bg-emerald-500/10' :
                        phase.status === 'active' ? 'text-cyan-400 bg-cyan-500/10' :
                        'text-gray-600 bg-white/[0.03]'
                      }`}>
                        {phase.status === 'done' ? 'Shipped' : phase.status === 'active' ? 'In Progress' : 'Planned'}
                      </span>
                      <span className="text-white text-sm font-semibold">{phase.title}</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {phase.items.map(item => (
                        <span key={item} className="text-[11px] text-gray-500 bg-white/[0.03] border border-white/[0.05] rounded-md px-2 py-0.5">
                          {item}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="pb-24 px-6">
        <div className="max-w-xl mx-auto text-center">
          <TrendingUp size={32} className="text-cyan-400 mx-auto mb-4" />
          <h2 className="text-2xl font-bold mb-3">Interested in the project?</h2>
          <p className="text-gray-500 text-sm mb-6 leading-relaxed">
            We&apos;re building the quantitative intelligence infrastructure that retail and institutional crypto traders need. Reach out via Telegram to discuss partnership, investment, or API integration.
          </p>
          <a href="https://t.me/signaledgeai" target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-sm px-8 py-3 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-[#070711] font-bold transition-colors shadow-[0_0_24px_rgba(0,212,255,0.3)]">
            <ExternalLink size={14} />
            Connect on Telegram
          </a>
        </div>
      </section>

      <PublicFooter />
    </div>
  )
}
