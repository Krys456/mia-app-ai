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
 * Returns a configured Supabase client.
 * Creates the client once; does not run queries or inserts.
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

  supabaseClient = createClient(url, anonKey)
  return supabaseClient
}

/** True when both Supabase env vars are present (does not open a network connection). */
export function isSupabaseConfigured(): boolean {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim() ?? ''
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ?? ''
  return Boolean(url && anonKey)
}
