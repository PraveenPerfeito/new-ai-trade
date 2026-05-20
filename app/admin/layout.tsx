import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import { AdminSidebar } from '@/components/admin/sidebar'
import { AdminTopbar } from '@/components/admin/topbar'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export const metadata = { title: 'Admin — Scanner Command Center' }

export default async function AdminLayout({ children }: { children: ReactNode }) {
  // Secondary auth check — middleware is the primary gate, this is defence-in-depth.
  const supabase = createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  return (
    <div className="flex h-screen overflow-hidden bg-terminal-bg">
      <AdminSidebar />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <AdminTopbar
          email={user.email ?? ''}
          lastSignIn={user.last_sign_in_at ?? null}
        />
        <main className="flex-1 overflow-y-auto p-5 space-y-0">
          {children}
        </main>
      </div>
    </div>
  )
}
