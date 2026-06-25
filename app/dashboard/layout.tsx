import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { getUserPlan } from '@/lib/access-control'
import { MemberSidebar } from '@/components/member/sidebar'
import type { PlanId } from '@/types'

export const metadata = {
  title: 'Dashboard — SignalEdge AI',
}

export default async function MemberLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies()

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } },
  )

  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login?next=/dashboard')
  }

  const planId = await getUserPlan(user.id) as PlanId

  return (
    <div className="flex min-h-screen bg-[#070711]">
      <MemberSidebar planId={planId} email={user.email ?? ''} />
      <div className="flex-1 min-w-0 lg:ml-[220px]">
        <main className="px-4 sm:px-6 py-8 max-w-[1400px]">{children}</main>
      </div>
    </div>
  )
}
