import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { logAuthEvent } from '@/lib/auth-audit'

export async function POST(_req: NextRequest) {
  const supabase = createSupabaseServerClient()

  // Capture email before signing out
  const { data: { user } } = await supabase.auth.getUser()
  const email = user?.email ?? null

  await supabase.auth.signOut()
  await logAuthEvent('logout', email)

  return NextResponse.json({ success: true })
}
