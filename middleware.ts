import { NextRequest, NextResponse } from 'next/server';

// ─── Rate limiter (in-memory per edge instance) ───────────────────────────────
// For distributed deployments, replace this with an upstash/redis adapter.

interface RateBucket { count: number; resetAt: number; }
const buckets = new Map<string, RateBucket>();

const WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? '60000', 10);
const MAX_REQ   = parseInt(process.env.RATE_LIMIT_MAX       ?? '100',   10);

function clientIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'
  );
}

function rateLimit(ip: string): { allowed: boolean; remaining: number; resetAt: number } {
  const now    = Date.now();
  const bucket = buckets.get(ip);

  if (!bucket || bucket.resetAt < now) {
    buckets.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true, remaining: MAX_REQ - 1, resetAt: now + WINDOW_MS };
  }

  bucket.count++;
  return {
    allowed:   bucket.count <= MAX_REQ,
    remaining: Math.max(0, MAX_REQ - bucket.count),
    resetAt:   bucket.resetAt,
  };
}

function purgeExpired(): void {
  if (buckets.size < 5_000) return;
  const now = Date.now();
  buckets.forEach((b, k) => { if (b.resetAt < now) buckets.delete(k); });
}

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

  const isApi = pathname.startsWith('/api/');

  // ── API-only middleware ────────────────────────────────────────────────────
  if (isApi) {
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

    // Rate limiting — skip health + static
    if (!pathname.startsWith('/api/health')) {
      purgeExpired();
      const ip = clientIp(req);
      const { allowed, remaining, resetAt } = rateLimit(ip);

      res.headers.set('X-RateLimit-Limit',     String(MAX_REQ));
      res.headers.set('X-RateLimit-Remaining', String(remaining));
      res.headers.set('X-RateLimit-Reset',     String(Math.ceil(resetAt / 1000)));

      if (!allowed) {
        const retryAfter = Math.ceil((resetAt - Date.now()) / 1000);
        return new NextResponse(
          JSON.stringify({ success: false, error: 'Too many requests', retryAfterSeconds: retryAfter }),
          {
            status:  429,
            headers: {
              'Content-Type':          'application/json',
              'Retry-After':           String(retryAfter),
              'X-RateLimit-Limit':     String(MAX_REQ),
              'X-RateLimit-Remaining': '0',
              'X-RateLimit-Reset':     String(Math.ceil(resetAt / 1000)),
              'X-Request-Id':          requestId,
            },
          },
        );
      }
    }
  }

  return res;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico).*)'],
};
