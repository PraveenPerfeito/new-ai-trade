import type { ReactNode } from 'react'
import { AdminSidebar } from '@/components/admin/sidebar'
import { AdminTopbar } from '@/components/admin/topbar'

export const metadata = { title: 'Admin — Scanner Command Center' }

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden bg-terminal-bg">
      <AdminSidebar />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <AdminTopbar />
        <main className="flex-1 overflow-y-auto p-5 space-y-0">
          {children}
        </main>
      </div>
    </div>
  )
}
