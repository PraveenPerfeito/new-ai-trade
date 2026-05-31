import { createServerClient } from '@supabase/ssr'
import { NextRequest, NextResponse } from 'next/server'

// ─── Protected path prefixes ──────────────────────────────────────────────────
// Everything under these prefixes requires an authenticated admin session.
// /login, /auth/callback, /api/health, and all public routes pass through freely.

const ADMIN_PREFIXES = [
  '/admin',
  '/api/admin',
  '/api/scanner',
  '/api/scheduler',
]

function isAdminPath(pathname: string): boolean {
  return ADMIN_PREFIXES.some(
    p => pathname === p || pathname.startsWith(p + '/'),
  )
}

// ─── Admin e-mail allowlist ───────────────────────────────────────────────────
// Set ADMIN_EMAILS=you@example.com in .env.local (comma-separated for multiple).
// DENY-BY-DEFAULT: empty allowlist blocks ALL access in production.
// In development (NODE_ENV !== 'production') an empty list allows any
// authenticated user — useful for local dev without needing to set ADMIN_EMAILS.

function getAllowedEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean)
}

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production'
}

// ─── Security headers ─────────────────────────────────────────────────────────

const SECURITY_HEADERS: [string, string][] = [
  ['X-Frame-Options',           'DENY'],
  ['X-Content-Type-Options',    'nosniff'],
  ['X-XSS-Protection',          '1; mode=block'],
  ['Referrer-Policy',           'strict-origin-when-cross-origin'],
  ['Permissions-Policy',        'camera=(), microphone=(), geolocation=()'],
  // HSTS: tell browsers to always use HTTPS for the next year (sent over HTTP too
  // but only enforced once the first HTTPS response is seen).
  ['Strict-Transport-Security', 'max-age=31536000; includeSubDomains'],
]

// ─── CORS ─────────────────────────────────────────────────────────────────────

function isCorsAllowed(origin: string | null): boolean {
  if (!origin) return false
  const allowed = process.env.ALLOWED_ORIGINS
  if (!allowed) {
    // In production, deny all cross-origin requests when no allowlist is set.
    // In development, allow localhost origins for convenience.
    if (isProduction()) return false
    return origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1')
  }
  return allowed.split(',').map(o => o.trim()).includes(origin)
}

// ─── Middleware ───────────────────────────────────────────────────────────────

export async function middleware(req: NextRequest) {
  const { method, nextUrl: { pathname } } = req
  const requestId = crypto.randomUUID()

  // ── Auth gate ─────────────────────────────────────────────────────────────
  if (isAdminPath(pathname)) {
    // @supabase/ssr middleware client: reads session from cookies and refreshes
    // tokens by writing updated cookies to the response.
    let supabaseRes = NextResponse.next({ request: req })

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll: () => req.cookies.getAll(),
          setAll: (cookiesToSet) => {
            cookiesToSet.forEach(({ name, value }) => req.cookies.set(name, value))
            supabaseRes = NextResponse.next({ request: req })
            cookiesToSet.forEach(({ name, value, options }) =>
              supabaseRes.cookies.set(name, value, options),
            )
          },
        },
      },
    )

    // getUser() validates the JWT with Supabase — not just a local cookie check
    const { data: { user } } = await supabase.auth.getUser()
    const email     = user?.email?.toLowerCase() ?? null
    const allowlist = getAllowedEmails()

    // Must be authenticated AND email must be in the allowlist.
    // In production, an empty allowlist blocks everyone (fail-safe).
    // In development, an empty allowlist allows any authenticated user.
    const allowlistConfigured = allowlist.length > 0
    const isAllowed = !!user && (
      (!isProduction() && !allowlistConfigured) ||
      (allowlistConfigured && !!email && allowlist.includes(email))
    )

    if (!isAllowed) {
      console.warn(
        `[auth] blocked ${user ? 'authenticated non-admin user' : 'unauthenticated'} → ${pathname}`,
      )  // Fix 4: email address removed from logs (PII)

      if (pathname.startsWith('/api/')) {
        return NextResponse.json(
          { error: 'Unauthorized', message: 'Admin authentication required' },
          { status: 401 },
        )
      }

      const loginUrl = new URL('/login', req.url)
      loginUrl.searchParams.set('next', pathname)
      return NextResponse.redirect(loginUrl)
    }

    // Authenticated — stamp headers and return with refreshed session cookies
    supabaseRes.headers.set('X-Request-Id', requestId)
    for (const [k, v] of SECURITY_HEADERS) supabaseRes.headers.set(k, v)
    return supabaseRes
  }

  // ── Non-protected paths ───────────────────────────────────────────────────
  const reqHeaders = new Headers(req.headers)
  reqHeaders.set('x-request-id',    requestId)
  reqHeaders.set('x-request-start', Date.now().toString())

  const res = NextResponse.next({ request: { headers: reqHeaders } })
  for (const [k, v] of SECURITY_HEADERS) res.headers.set(k, v)
  res.headers.set('X-Request-Id', requestId)

  // CORS for non-admin API routes (/api/signals, /api/backtest, etc.)
  if (pathname.startsWith('/api/')) {
    const origin = req.headers.get('origin')
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
        })
      }
      return new NextResponse(null, { status: 403 })
    }
    if (origin && isCorsAllowed(origin)) {
      res.headers.set('Access-Control-Allow-Origin',  origin)
      res.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
      res.headers.set('Vary', 'Origin')
    }
  }

  return res
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico).*)'],
}
