import Link from 'next/link'
import { Zap } from 'lucide-react'

const LINKS = {
  Platform: [
    { href: '#intelligence', label: 'Intelligence Engine' },
    { href: '/pricing',      label: 'Pricing & Plans' },
    { href: '/dashboard',    label: 'Market Scanner' },
    { href: '/about',        label: 'How It Works' },
  ],
  Intelligence: [
    { href: '#signals',  label: 'Signal Showcase' },
    { href: '#pipeline', label: 'AI Pipeline' },
    { href: '#performance', label: 'Performance' },
    { href: '/pricing',  label: 'Premium Access' },
  ],
  Company: [
    { href: '/about',     label: 'About' },
    { href: '/investors', label: 'Investors' },
    { href: '/about#roadmap', label: 'Roadmap' },
    { href: 'https://t.me/signaledgeai', label: 'Telegram Community' },
  ],
  Legal: [
    { href: '#disclaimer', label: 'Disclaimer' },
    { href: '#privacy',    label: 'Privacy Policy' },
    { href: '#terms',      label: 'Terms of Service' },
    { href: '#risk',       label: 'Risk Disclosure' },
  ],
}

export function PublicFooter() {
  return (
    <footer className="border-t border-white/[0.06] bg-[#070711]">
      <div className="max-w-7xl mx-auto px-6 py-16">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-8 mb-12">

          {/* Brand block */}
          <div className="col-span-2 md:col-span-1">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-cyan-400 to-blue-600 flex items-center justify-center">
                <Zap size={13} className="text-white" fill="white" />
              </div>
              <span className="text-white font-bold text-[17px] tracking-tight">
                Signal<span className="text-cyan-400">Edge</span>
              </span>
            </div>
            <p className="text-gray-500 text-xs leading-relaxed mb-4 max-w-[180px]">
              Quantitative AI crypto intelligence. Institutional-grade signal infrastructure.
            </p>
            <p className="text-gray-600 text-[11px]">
              Powered by Claude AI · Binance · CoinMarketCap
            </p>
          </div>

          {/* Link columns */}
          {Object.entries(LINKS).map(([section, links]) => (
            <div key={section}>
              <p className="text-gray-400 text-xs font-semibold uppercase tracking-widest mb-4">{section}</p>
              <ul className="space-y-3">
                {links.map(link => (
                  <li key={link.href}>
                    <Link href={link.href}
                      className="text-gray-500 hover:text-gray-300 text-sm transition-colors">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Disclaimer */}
        <div className="border-t border-white/[0.05] pt-8 space-y-4">
          <p className="text-gray-600 text-xs leading-relaxed max-w-4xl" id="disclaimer">
            <span className="text-gray-400 font-semibold">Risk Disclaimer:</span> SignalEdge AI provides quantitative market intelligence for informational purposes only. Nothing on this platform constitutes financial advice, investment advice, or a recommendation to buy or sell any financial instrument. Cryptocurrency markets are highly volatile and carry substantial risk of loss. Past performance of signals, win rates, or expectancy metrics does not guarantee future results. Always conduct your own due diligence and consult a qualified financial advisor before making any investment decisions.
          </p>
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <p className="text-gray-600 text-xs">
              © {new Date().getFullYear()} SignalEdge AI. All rights reserved.
            </p>
            <p className="text-gray-700 text-xs">
              Built with Next.js · Claude AI · Supabase · Binance API
            </p>
          </div>
        </div>
      </div>
    </footer>
  )
}
