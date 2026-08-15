/**
 * ONLY browser-side Supabase client for this repo.
 * Uses the anon key (safe with RLS). Server code must use
 * lib/server/supabase.js → getServiceSupabase() instead.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

function readRequiredEnv(
  name: 'VITE_SUPABASE_URL' | 'VITE_SUPABASE_ANON_KEY',
  value: string | undefined,
): string {
  const trimmed = value?.trim() ?? ''

  if (!trimmed) {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
        `Add it to .env.local for local Vite development, or set it in your host’s Environment Variables ` +
        `(Vercel → Project → Settings → Environment Variables). ` +
        `Supabase client cannot be created without VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.`,
    )
  }

  return trimmed
}

let supabaseClient: SupabaseClient | null = null

/**
 * Returns the singleton browser Supabase client (anon key).
 * Creates the client once; does not run queries or inserts.
 *
 * Explicit auth options so Preview / mobile localStorage recovery is deterministic
 * and mount + chatApi always share the same persisted session key.
 */
export function getSupabase(): SupabaseClient {
  if (supabaseClient) {
    return supabaseClient
  }

  const url = readRequiredEnv('VITE_SUPABASE_URL', import.meta.env.VITE_SUPABASE_URL)
  const anonKey = readRequiredEnv(
    'VITE_SUPABASE_ANON_KEY',
    import.meta.env.VITE_SUPABASE_ANON_KEY,
  )

  supabaseClient = createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storage: typeof window !== 'undefined' ? window.localStorage : undefined,
    },
  })
  return supabaseClient
}

/** True when both Supabase env vars are present (does not open a network connection). */
export function isSupabaseConfigured(): boolean {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim() ?? ''
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ?? ''
  return Boolean(url && anonKey)
}

/** Test helper — clears the browser client singleton. */
export function resetSupabaseClientForTests(): void {
  supabaseClient = null
}
