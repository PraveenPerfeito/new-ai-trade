import { NextRequest, NextResponse } from 'next/server'

const BACKEND = process.env.BACKEND_URL ?? 'http://localhost:8000'

/**
 * Proxy all /api/admin/* requests to the Python FastAPI backend.
 *
 * Routing:
 *   /api/admin/health         → BACKEND/health
 *   /api/admin/health/ready   → BACKEND/health/ready
 *   /api/admin/burnin/*       → BACKEND/api/burnin/*
 *   /api/admin/analytics/*    → BACKEND/api/analytics/*
 *   /api/admin/scanner/*      → BACKEND/api/scanner/*
 */
function buildUpstream(segments: string[], search: URLSearchParams): string {
  const path = segments.join('/')
  const qs = search.toString()
  const prefix = segments[0] === 'health' ? '' : '/api'
  return `${BACKEND}${prefix}/${path}${qs ? `?${qs}` : ''}`
}

async function proxy(req: NextRequest, segments: string[]): Promise<NextResponse> {
  const upstream = buildUpstream(segments, req.nextUrl.searchParams)

  try {
    const init: RequestInit = { method: req.method, cache: 'no-store' as RequestCache }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      init.headers = { 'Content-Type': 'application/json' }
      init.body = await req.text()
    }

    const res = await fetch(upstream, init)
    const ct = res.headers.get('content-type') ?? ''

    if (ct.includes('application/json')) {
      return NextResponse.json(await res.json(), { status: res.status })
    }
    return new NextResponse(await res.text(), {
      status: res.status,
      headers: { 'Content-Type': ct || 'text/plain' },
    })
  } catch (err) {
    return NextResponse.json(
      { error: 'Backend unreachable', detail: String(err) },
      { status: 502 },
    )
  }
}

type Ctx = { params: { path: string[] } }

export async function GET(req: NextRequest, { params }: Ctx) {
  return proxy(req, params.path)
}

export async function POST(req: NextRequest, { params }: Ctx) {
  return proxy(req, params.path)
}

export async function PUT(req: NextRequest, { params }: Ctx) {
  return proxy(req, params.path)
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  return proxy(req, params.path)
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  return proxy(req, params.path)
}
