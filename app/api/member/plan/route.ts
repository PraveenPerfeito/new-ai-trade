import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { getUserPlan } from '@/lib/access-control'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET /api/member/plan — returns the authenticated user's plan ID */
export async function GET() {
  try {
    const cookieStore = await cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll: () => cookieStore.getAll() } },
    )

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const planId = await getUserPlan(user.id)
    return NextResponse.json({ planId, email: user.email })
  } catch {
    return NextResponse.json({ planId: 'free' })
  }
}
