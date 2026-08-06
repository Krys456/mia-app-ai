import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let client: SupabaseClient | null = null

/**
 * Server-side Supabase client for API routes.
 * Prefer SUPABASE_SERVICE_ROLE_KEY; falls back to anon key if unset.
 */
export function getServiceSupabase(): SupabaseClient {
  if (client) return client

  const url =
    process.env.SUPABASE_URL?.trim() || process.env.VITE_SUPABASE_URL?.trim() || ''
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.SUPABASE_ANON_KEY?.trim() ||
    process.env.VITE_SUPABASE_ANON_KEY?.trim() ||
    ''

  if (!url || !key) {
    throw new Error(
      'Missing Supabase configuration. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY ' +
        '(or VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY) in the environment.',
    )
  }

  client = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })

  return client
}
