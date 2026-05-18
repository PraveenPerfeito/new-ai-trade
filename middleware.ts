import { NextRequest, NextResponse } from 'next/server';

// ─── Security headers ─────────────────────────────────────────────────────────

const SECURITY_HEADERS: [string, string][] = [
  ['X-Frame-Options',           'DENY'],
  ['X-Content-Type-Options',    'nosniff'],
  ['X-XSS-Protection',          '1; mode=block'],
  ['Referrer-Policy',           'strict-origin-when-cross-origin'],
  ['Permissions-Policy',        'camera=(), microphone=(), geolocation=()'],
];

// ─── CORS ─────────────────────────────────────────────────────────────────────

function isCorsAllowed(origin: string | null): boolean {
  if (!origin) return false;
  const allowed = process.env.ALLOWED_ORIGINS;
  if (!allowed) return true; // open in dev — tighten by setting ALLOWED_ORIGINS in prod
  return allowed.split(',').map(o => o.trim()).includes(origin);
}

// ─── Middleware ───────────────────────────────────────────────────────────────
// Rate limiting has been moved to lib/rate-limit.ts (Redis-backed) and is
// applied per-route in the individual API route handlers. Edge runtime cannot
// use ioredis, so per-IP rate limiting cannot be centralised here.

export function middleware(req: NextRequest) {
  const { method, nextUrl: { pathname } } = req;
  const requestId = crypto.randomUUID();
  const requestTs = Date.now().toString();

  // Forward request ID + timestamp to the origin
  const reqHeaders = new Headers(req.headers);
  reqHeaders.set('x-request-id',    requestId);
  reqHeaders.set('x-request-start', requestTs);

  const res = NextResponse.next({ request: { headers: reqHeaders } });

  // Security headers on every response
  for (const [k, v] of SECURITY_HEADERS) res.headers.set(k, v);
  res.headers.set('X-Request-Id', requestId);

  // ── API-only middleware ────────────────────────────────────────────────────
  if (pathname.startsWith('/api/')) {
    // Handle pre-flight
    const origin = req.headers.get('origin');
    if (method === 'OPTIONS') {
      if (isCorsAllowed(origin)) {
        return new NextResponse(null, {
          status: 204,
          headers: {
            'Access-Control-Allow-Origin':  origin!,
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Request-Id',
            'Access-Control-Max-Age':       '86400',
          },
        });
      }
      return new NextResponse(null, { status: 403 });
    }

    // CORS response headers
    if (origin && isCorsAllowed(origin)) {
      res.headers.set('Access-Control-Allow-Origin',  origin);
      res.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.headers.set('Vary', 'Origin');
    }
  }

  return res;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico).*)'],
};
