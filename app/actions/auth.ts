'use server'

import { logAuthEvent, type AuthEvent } from '@/lib/auth-audit'

/**
 * Server Actions called from the Login page Client Component.
 * Lets the browser-side login form write to the server-only audit log.
 */
export async function recordLoginEvent(
  event: Extract<AuthEvent, 'login' | 'login_failed'>,
  email: string,
  detail?: string,
): Promise<void> {
  await logAuthEvent(event, email, detail)
}
