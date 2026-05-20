import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'

let _instance: SupabaseClient | null = null

/**
 * Browser-side Supabase client singleton.
 * Use in Client Components — never on the server.
 */
export function createSupabaseBrowserClient(): SupabaseClient {
  if (!_instance) {
    _instance = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    )
  }
  return _instance
}
