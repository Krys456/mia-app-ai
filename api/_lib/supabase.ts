/**
 * Server-side Supabase client helper.
 * Lazily loads @supabase/supabase-js so importing this module cannot crash
 * Vercel function cold-start if the package graph misbehaves.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

let client: SupabaseClient | null = null

function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Startup validation for Supabase server env.
 * Logs URL presence/shape diagnostics only — never logs secret keys.
 */
export function validateSupabaseStartupEnv(): {
  url: string
  key: string
} {
  const url = process.env.SUPABASE_URL?.trim() || ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || ''
  const urlExists = Boolean(url)
  const urlValid = urlExists && isValidHttpUrl(url)
  const keyExists = Boolean(key)

  const prefix =
    url.length === 0
      ? ''
      : url.length <= 20
        ? url
        : `${url.slice(0, 20)}...`

  console.info('[supabase] startup validation', {
    SUPABASE_URL_exists: urlExists,
    SUPABASE_URL_length: url.length,
    SUPABASE_URL_starts_with_https: url.startsWith('https://'),
    SUPABASE_URL_prefix: prefix,
    SUPABASE_URL_valid: urlValid,
  })

  if (!urlExists) {
    throw new Error('Missing SUPABASE_URL')
  }

  if (!urlValid) {
    throw new Error('Invalid SUPABASE_URL')
  }

  if (!keyExists) {
    throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY')
  }

  return { url, key }
}

/**
 * Server-side Supabase client for API routes / MemoryService.
 * Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
 */
export async function getServiceSupabase(): Promise<SupabaseClient> {
  if (client) return client

  const { url, key } = validateSupabaseStartupEnv()

  const spec = '@supabase/' + 'supabase-js'
  const { createClient } = await import(spec)
  client = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })

  return client
}
