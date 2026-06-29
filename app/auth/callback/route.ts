import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'

/**
 * Handles the PKCE code exchange for magic-link and OAuth flows.
 * Supabase redirects here after email confirmation with ?code=<code>.
 */
export async function GET(req: NextRequest) {
  const { searchParams, origin } = new URL(req.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/admin'

  if (code) {
    const supabase = await createSupabaseServerClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`)
    }
    console.error('[auth/callback] code exchange failed:', error.message)
  }

  // On any failure, redirect to login with an error hint
  const loginUrl = new URL('/login', origin)
  loginUrl.searchParams.set('error', 'auth_callback_failed')
  return NextResponse.redirect(loginUrl)
}
