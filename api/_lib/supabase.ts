/**
 * Server-side Supabase client helper.
 * Lazily loads @supabase/supabase-js so importing this module cannot crash
 * Vercel function cold-start if the package graph misbehaves.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

let client: SupabaseClient | null = null

/**
 * Server-side Supabase client for API routes / MemoryService.
 * Requires SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY.
 */
export async function getServiceSupabase(): Promise<SupabaseClient> {
  if (client) return client

  const url =
    process.env.SUPABASE_URL?.trim() || process.env.VITE_SUPABASE_URL?.trim() || ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || ''

  if (!url) {
    throw new Error(
      'Missing SUPABASE_URL. Set SUPABASE_URL (preferred) or VITE_SUPABASE_URL in the environment.',
    )
  }

  if (!key) {
    throw new Error(
      'Missing SUPABASE_SERVICE_ROLE_KEY. Set SUPABASE_SERVICE_ROLE_KEY in the environment for memory API inserts.',
    )
  }

  const { createClient } = await import('@supabase/supabase-js')
  client = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })

  return client
}
