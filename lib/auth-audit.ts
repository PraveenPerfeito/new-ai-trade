import { headers } from 'next/headers'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

export type AuthEvent = 'login' | 'logout' | 'login_failed' | 'unauthorized'

/**
 * Write an auth event to admin_auth_log.
 * Non-fatal — never throws; a logging failure must not break the auth flow.
 */
export async function logAuthEvent(
  event: AuthEvent,
  email: string | null,
  detail?: string,
): Promise<void> {
  try {
    const h  = headers()
    const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? h.get('x-real-ip') ?? null
    const ua = h.get('user-agent')?.slice(0, 300) ?? null

    await createSupabaseAdminClient()
      .from('admin_auth_log')
      .insert({ event, email, ip, user_agent: ua, detail: detail ?? null })
  } catch (err) {
    console.warn('[auth-audit] failed to write event:', event, err)
  }
}
