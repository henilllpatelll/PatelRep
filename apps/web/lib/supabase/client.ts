import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'

// Multiple independent GoTrueClient instances (one per createClient() call)
// each run their own auto-refresh timer against the same stored session.
// When two instances race to refresh the same single-use refresh token near
// expiry, one wins and the other gets "already used" — surfacing as every
// in-flight request 401ing at once. Memoize to a single instance per tab.
let browserClient: SupabaseClient | undefined

export function createClient() {
  if (!browserClient) {
    browserClient = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
      (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '').trim()
    )
  }
  return browserClient
}
