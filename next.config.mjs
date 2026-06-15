/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack(config, { dev }) {
    if (dev) {
      // Webpack's gzip cache serialization fails under memory pressure on Windows.
      // Disable filesystem cache in dev — hot reload still works via in-memory cache.
      config.cache = false;
    }
    return config;
  },

  // Produce a self-contained .next/standalone directory for Docker
  output: 'standalone',

  // Remove X-Powered-By: Next.js header
  poweredByHeader: false,

  // Enable gzip/brotli compression
  compress: true,

  // pino uses Node.js streams — keep it server-side only
  experimental: {
    serverComponentsExternalPackages: ['pino', 'pino-pretty'],
  },

  // PLATFORM.SIMPLIFICATION.1 — 5 centers → 3 centers (June 2026)
  async redirects() {
    return [
      // Legacy Phase 7 renames
      { source: '/admin/operations', destination: '/admin/market',      permanent: true },
      { source: '/admin/readiness',  destination: '/admin/regime',       permanent: true },
      { source: '/admin/ai',         destination: '/admin/calibration',  permanent: true },
      // Old 4-center URLs → new 3-center URLs
      { source: '/admin/trading',     destination: '/admin/signals',              permanent: false },
      { source: '/admin/analytics',   destination: '/admin/performance',          permanent: false },
      { source: '/admin/intelligence', destination: '/admin/system?tab=health',   permanent: false },
      { source: '/admin/settings',    destination: '/admin/system?tab=settings',  permanent: false },
      // Legacy individual pages → new centers
      { source: '/admin/overview',   destination: '/admin/signals',                       permanent: true },
      { source: '/admin/scanner',    destination: '/admin/system?tab=health',             permanent: false },
      { source: '/admin/tactical',   destination: '/admin/signals?tab=signals',           permanent: false },
      { source: '/admin/regime',     destination: '/admin/signals?tab=regime',            permanent: false },
      { source: '/admin/providers',  destination: '/admin/system?tab=health',             permanent: true },
      { source: '/admin/cache',      destination: '/admin/system?tab=health',             permanent: false },
      { source: '/admin/sectors',    destination: '/admin/system?tab=health',             permanent: false },
      { source: '/admin/market',     destination: '/admin/system?tab=health',             permanent: false },
      { source: '/admin/calibration', destination: '/admin/performance?tab=attribution',  permanent: false },
      { source: '/admin/anomalies',  destination: '/admin/system?tab=anomalies',          permanent: false },
    ];
  },

  // Security + performance headers applied at the CDN/edge layer
  // (middleware.ts applies the same headers at runtime as a fallback)
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-DNS-Prefetch-Control',      value: 'on' },
          { key: 'X-Frame-Options',              value: 'DENY' },
          { key: 'X-Content-Type-Options',       value: 'nosniff' },
          { key: 'X-XSS-Protection',             value: '1; mode=block' },
          { key: 'Referrer-Policy',              value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy',           value: 'camera=(), microphone=(), geolocation=()' },
          {
            key:   'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          {
            key:   'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'", // Next.js requires unsafe-eval in dev
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob:",
              "font-src 'self'",
              "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.coingecko.com https://api.binance.com https://fapi.binance.com",
              "frame-ancestors 'none'",
            ].join('; '),
          },
        ],
      },
      {
        // Long cache for static assets
        source: '/_next/static/(.*)',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
      {
        // No cache for API routes
        source: '/api/(.*)',
        headers: [
          { key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate' },
        ],
      },
    ];
  },

  images: {
    remotePatterns: [],
    minimumCacheTTL: 60,
  },
};

export default nextConfig;
