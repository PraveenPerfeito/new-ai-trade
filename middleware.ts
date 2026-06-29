import { createServerClient } from '@supabase/ssr'
import { NextRequest, NextResponse } from 'next/server'

// ─── Protected path prefixes ──────────────────────────────────────────────────
// Admin paths require an authenticated admin session (email allowlist).
// Member paths require any authenticated Supabase session.
// /login, /auth/callback, /api/health, and all public routes pass through freely.

const ADMIN_PREFIXES = [
  '/admin',
  '/api/admin',
  '/api/scanner',
  '/api/scheduler',
  '/api/analytics',
]

const MEMBER_PREFIXES = [
  '/dashboard',
  '/api/member',
]

function isAdminPath(pathname: string): boolean {
  return ADMIN_PREFIXES.some(
    p => pathname === p || pathname.startsWith(p + '/'),
  )
}

function isMemberPath(pathname: string): boolean {
  return MEMBER_PREFIXES.some(
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

  // ── Auth gate (admin + member paths) ─────────────────────────────────────
  if (isAdminPath(pathname) || isMemberPath(pathname)) {
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

    // All protected paths require authentication
    if (!user) {
      console.warn(`[auth] unauthenticated → ${pathname}`)

      if (pathname.startsWith('/api/')) {
        return NextResponse.json(
          { error: 'Unauthorized', message: 'Authentication required' },
          { status: 401 },
        )
      }

      const loginUrl = new URL('/login', req.url)
      loginUrl.searchParams.set('next', pathname)
      return NextResponse.redirect(loginUrl)
    }

    // Admin paths additionally require email allowlist membership
    if (isAdminPath(pathname)) {
      const email     = user.email?.toLowerCase() ?? null
      const allowlist = getAllowedEmails()

      const allowlistConfigured = allowlist.length > 0
      const isAllowed = (
        (!isProduction() && !allowlistConfigured) ||
        (allowlistConfigured && !!email && allowlist.includes(email))
      )

      if (!isAllowed) {
        console.warn(`[auth] authenticated non-admin blocked → ${pathname}`)

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
    }

    // Authenticated (and admin if required) — stamp headers and return
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
