import { createClient } from '@supabase/supabase-js'

/**
 * Service-role Supabase client — bypasses Row Level Security.
 * Server-only. Never import in Client Components or expose to the browser.
 */
export function createSupabaseAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}
