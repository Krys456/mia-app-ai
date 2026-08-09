/**
 * ONLY server-side Supabase client for this repo.
 * Plain JS so Vercel Node ESM can load it at runtime.
 *
 * All API routes and lib/server/* must use getServiceSupabase() from here.
 * Do not call createClient() elsewhere on the backend.
 * Browser code uses src/lib/supabase.ts (anon key) instead.
 */

let client = null

function cleanEnv(value) {
  if (typeof value !== 'string') return ''
  return value.trim().replace(/^['"]|['"]$/g, '')
}

function isValidHttpUrl(value) {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

function resolveSupabaseUrl() {
  return (
    cleanEnv(process.env.SUPABASE_URL) ||
    cleanEnv(process.env.VITE_SUPABASE_URL) ||
    ''
  )
}

function resolveServiceRoleKey() {
  return cleanEnv(process.env.SUPABASE_SERVICE_ROLE_KEY)
}

/**
 * Startup validation for Supabase server env.
 * Logs URL diagnostics only — never logs secret keys.
 */
export function validateSupabaseStartupEnv() {
  const url = resolveSupabaseUrl()
  const key = resolveServiceRoleKey()
  const urlExists = Boolean(url)
  const urlValid = urlExists && isValidHttpUrl(url)
  const keyExists = Boolean(key)

  const prefix =
    url.length === 0 ? '' : url.length <= 20 ? url : `${url.slice(0, 20)}...`

  console.info('[supabase] startup validation', {
    SUPABASE_URL_exists: urlExists,
    SUPABASE_URL_length: url.length,
    SUPABASE_URL_starts_with_https: url.startsWith('https://'),
    SUPABASE_URL_prefix: prefix,
    SUPABASE_URL_valid: urlValid,
    SUPABASE_SERVICE_ROLE_KEY_exists: keyExists,
    used_vite_url_fallback:
      !cleanEnv(process.env.SUPABASE_URL) && Boolean(cleanEnv(process.env.VITE_SUPABASE_URL)),
  })

  if (!urlExists) {
    throw new Error(
      'Missing SUPABASE_URL (set SUPABASE_URL or VITE_SUPABASE_URL on Vercel)',
    )
  }

  if (!urlValid) {
    throw new Error(
      'Invalid SUPABASE_URL (must be a full https://….supabase.co URL)',
    )
  }

  if (!keyExists) {
    throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY')
  }

  // Normalize: no trailing slash
  const normalizedUrl = url.replace(/\/+$/, '')
  return { url: normalizedUrl, key }
}

function networkErrorMessage(error, targetOrigin) {
  const cause = error && typeof error === 'object' ? error.cause : null
  const causeCode =
    cause && typeof cause === 'object'
      ? cause.code || cause.errno || cause.syscall || ''
      : ''
  const causeMsg =
    cause instanceof Error
      ? cause.message
      : cause && typeof cause === 'object' && typeof cause.message === 'string'
        ? cause.message
        : ''
  const base = error instanceof Error ? error.message : String(error)
  const detail = [causeCode, causeMsg].filter(Boolean).join(' ')
  return `Supabase network error contacting ${targetOrigin}: ${base}${
    detail ? ` (${detail})` : ''
  }. Check SUPABASE_URL and that the Supabase project is online.`
}

/**
 * Singleton service-role client for API routes / serverless.
 * Requires SUPABASE_URL (or VITE_SUPABASE_URL) + SUPABASE_SERVICE_ROLE_KEY.
 * This is the only backend createClient() call site.
 */
export async function getServiceSupabase() {
  if (client) return client

  const { url, key } = validateSupabaseStartupEnv()
  const origin = new URL(url).origin

  const spec = '@supabase/' + 'supabase-js'
  const { createClient } = await import(spec)

  client = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global: {
      fetch: async (input, init) => {
        try {
          return await fetch(input, init)
        } catch (error) {
          throw new Error(networkErrorMessage(error, origin))
        }
      },
    },
  })

  return client
}
