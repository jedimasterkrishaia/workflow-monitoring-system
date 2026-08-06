import 'server-only'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Server-side only Supabase client. The service role key must never reach the
 * browser (spec §Stack), so this module is marked `server-only`: importing it
 * from a client component is a build error.
 */

let cached: SupabaseClient | null = null

function isPlaceholder(value: string | undefined): boolean {
  return !value || value.trim() === '' || value.startsWith('REPLACE_ME')
}

/** True once both SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY hold real values. */
export function isSupabaseConfigured(): boolean {
  return !isPlaceholder(process.env.SUPABASE_URL) && !isPlaceholder(process.env.SUPABASE_SERVICE_ROLE_KEY)
}

/** Returns null (instead of throwing) while credentials are still placeholders. */
export function getSupabase(): SupabaseClient | null {
  if (!isSupabaseConfigured()) return null
  if (cached) return cached

  cached = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'x-application-name': 'korefi-workflow-monitor' } },
  })
  return cached
}
