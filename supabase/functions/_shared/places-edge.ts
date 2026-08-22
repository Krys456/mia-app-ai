/**
 * #355B — Deno shared helpers for the Places Edge Function.
 * Mirrors supabase/functions/_shared/email-edge.ts — kept as a SEPARATE
 * module (different provider, different env vars, no DB table, no
 * EMAIL_RETURN_URL). Do NOT import email-edge.ts from here.
 */

import { createClient } from 'npm:@supabase/supabase-js@2'

export function env(name: string): string {
  return (Deno.env.get(name) || '').trim()
}

export function isTruthy(raw: string): boolean {
  const v = raw.toLowerCase()
  return v === '1' || v === 'true' || v === 'yes'
}

export function isPlacesEnabled(): boolean {
  return isTruthy(env('PLACES_ENABLED'))
}

export function json(status: number, body: Record<string, unknown>, extraHeaders: HeadersInit = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
  })
}

const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
]

export function resolveCorsOrigin(req: Request): string | null {
  const origin = (req.headers.get('Origin') || '').trim()
  if (!origin) return null
  const extra = env('CORS_ALLOWED_ORIGINS')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const allow = new Set(DEFAULT_ALLOWED_ORIGINS.concat(extra))
  if (allow.has(origin)) return origin
  try {
    if (/\.vercel\.app$/i.test(new URL(origin).hostname)) return origin
  } catch {
    /* ignore */
  }
  return null
}

export function corsHeaders(req: Request): Record<string, string> {
  const origin = resolveCorsOrigin(req)
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
  if (origin) {
    headers['Access-Control-Allow-Origin'] = origin
    headers['Vary'] = 'Origin'
  }
  return headers
}

export function extractBearer(req: Request): string | null {
  const header = req.headers.get('authorization') || ''
  if (!header.toLowerCase().startsWith('bearer ')) return null
  const token = header.slice(7).trim()
  return token || null
}

export async function verifyUserJwt(
  accessToken: string,
): Promise<{ ok: true; userId: string; isAnonymous: boolean | null } | { ok: false; code: string }> {
  const url = env('SUPABASE_URL')
  const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceKey) return { ok: false, code: 'supabase_service_misconfigured' }

  const client = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await client.auth.getUser(accessToken)
  if (error || !data.user?.id) return { ok: false, code: 'unauthorized' }
  const isAnonymous =
    typeof data.user.is_anonymous === 'boolean'
      ? data.user.is_anonymous
      : data.user.app_metadata?.provider === 'anonymous' || null
  return { ok: true, userId: data.user.id, isAnonymous }
}

/**
 * Places queries carry raw location + place text — never log them.
 * Redact lat/lon/latitude/longitude/address/name/query/destination/coords
 * on every field key, in addition to the usual token-like keys.
 */
const PLACES_REDACT_PATTERN =
  /lat|lon|latitude|longitude|address|name|query|destination|coords|token|secret|apikey|api_key/i

export function redactPlacesFields(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(fields || {})) {
    out[k] = PLACES_REDACT_PATTERN.test(k) ? '[redacted]' : v
  }
  return out
}

/** Never pass lat/lon/address/name/query/destination through this — it is also redacted. */
export function logSafe(route: string, fields: Record<string, unknown>) {
  console.log(JSON.stringify({ route, ...redactPlacesFields(fields) }))
}
