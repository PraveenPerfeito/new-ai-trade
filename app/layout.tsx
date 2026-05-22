import type { Metadata, Viewport } from 'next';
import './globals.css';
import { ErrorBoundary } from '@/components/error-boundary';

export const metadata: Metadata = {
  metadataBase: new URL('https://signaledge.ai'),
  title: {
    default: 'SignalEdge AI — Quantitative Crypto Intelligence Platform',
    template: '%s | SignalEdge AI',
  },
  description: 'Institutional-grade AI-powered crypto signal intelligence. Multi-provider market analysis, Claude AI validation, and quantitative edge tracking for modern crypto markets.',
  keywords: ['crypto signals', 'AI trading', 'quantitative crypto', 'Bitcoin signals', 'crypto intelligence', 'institutional crypto', 'trading signals', 'Claude AI'],
  openGraph: {
    type: 'website',
    siteName: 'SignalEdge AI',
    title: 'SignalEdge AI — Quantitative Crypto Intelligence Platform',
    description: 'Institutional-grade AI-powered crypto signal intelligence. Multi-provider market analysis with quantitative edge tracking.',
    images: [{ url: '/og-image.png', width: 1200, height: 630, alt: 'SignalEdge AI' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'SignalEdge AI — Quantitative Crypto Intelligence',
    description: 'AI-powered quantitative crypto intelligence platform. Realtime signals. Institutional grade.',
    images: ['/og-image.png'],
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width:        'device-width',
  initialScale: 1,
  themeColor:   '#070711',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body>
        <ErrorBoundary>{children}</ErrorBoundary>
      </body>
    </html>
  );
}
