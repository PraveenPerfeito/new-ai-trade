/** @type {import('next').NextConfig} */
const nextConfig = {
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
