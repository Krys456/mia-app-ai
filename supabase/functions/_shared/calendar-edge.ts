/**
 * #304A1 — Deno shared helpers for calendar Edge Functions.
 */

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { parseCalendarReturnAllowlist } from './calendar-oauth.ts'
import { redactTokenFields } from './calendar-token-crypto.ts'

export function env(name: string): string {
  return (Deno.env.get(name) || '').trim()
}

export function isTruthy(raw: string): boolean {
  const v = raw.toLowerCase()
  return v === '1' || v === 'true' || v === 'yes'
}

export function isCalendarEnabled(): boolean {
  return isTruthy(env('CALENDAR_ENABLED'))
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
  for (const origin of parseCalendarReturnAllowlist(env('CALENDAR_RETURN_URL'))) {
    allow.add(origin)
  }
  if (allow.has(origin)) return origin
  if (/\.vercel\.app$/i.test(new URL(origin).hostname)) return origin
  return null
}

export function corsHeaders(req: Request): Record<string, string> {
  const origin = resolveCorsOrigin(req)
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  }
  if (origin) {
    headers['Access-Control-Allow-Origin'] = origin
    headers['Vary'] = 'Origin'
  }
  return headers
}

export function logSafe(route: string, fields: Record<string, unknown>) {
  console.log(JSON.stringify({ route, ...redactTokenFields(fields) }))
}

export function extractBearer(req: Request): string | null {
  const header = req.headers.get('authorization') || ''
  if (!header.toLowerCase().startsWith('bearer ')) return null
  const token = header.slice(7).trim()
  return token || null
}

export function serviceClient(): SupabaseClient {
  const url = env('SUPABASE_URL')
  const key = env('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) {
    throw new Error('supabase_service_misconfigured')
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
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

export async function ensureAuthUserRow(supabase: SupabaseClient, authUserId: string) {
  const id = authUserId.trim()
  if (!id) throw new Error('user_id_required')

  const { data: existing, error: lookupError } = await supabase
    .from('users')
    .select('id')
    .eq('id', id)
    .maybeSingle()
  if (lookupError) throw new Error(`user_lookup_failed`)
  if (existing?.id) return String(existing.id)

  const { data: created, error: createError } = await supabase
    .from('users')
    .insert({
      id,
      email: `auth:${id}@laife.local`,
      display_name: 'LAIfe user',
    })
    .select('id')
    .single()

  if (createError) {
    const { data: raced } = await supabase.from('users').select('id').eq('id', id).maybeSingle()
    if (raced?.id) return String(raced.id)
    throw new Error('user_create_failed')
  }
  return String(created.id)
}

/** Public connection metadata — never includes token material. */
export type CalendarConnectionPublic = {
  status: string
  provider: string
  accountEmail: string | null
  scopes: string[]
  connected: boolean
  readOnly: boolean
  lastErrorCode: string | null
  disconnectedAt: string | null
  updatedAt: string | null
}

export function toPublicConnection(row: Record<string, unknown> | null): CalendarConnectionPublic {
  if (!row) {
    return {
      status: 'disconnected',
      provider: 'google',
      accountEmail: null,
      scopes: [],
      connected: false,
      readOnly: true,
      lastErrorCode: null,
      disconnectedAt: null,
      updatedAt: null,
    }
  }
  const status = String(row.status || 'disconnected')
  return {
    status,
    provider: String(row.provider || 'google'),
    accountEmail: typeof row.account_email === 'string' ? row.account_email : null,
    scopes: Array.isArray(row.scopes) ? row.scopes.map(String) : [],
    connected: status === 'connected',
    readOnly: true,
    lastErrorCode: typeof row.last_error_code === 'string' ? row.last_error_code : null,
    disconnectedAt: typeof row.disconnected_at === 'string' ? row.disconnected_at : null,
    updatedAt: typeof row.updated_at === 'string' ? row.updated_at : null,
  }
}

/**
 * Refresh-token preservation when Google omits refresh_token on reconnect.
 */
export function resolveRefreshTokenEnc(opts: {
  newRefreshToken: string | null | undefined
  existingRefreshTokenEnc: string | null | undefined
  newRefreshEnc: string | null | undefined
}): { refreshTokenEnc: string | null; status: 'connected' | 'reconnect_required' } {
  if (opts.newRefreshToken && opts.newRefreshEnc) {
    return { refreshTokenEnc: opts.newRefreshEnc, status: 'connected' }
  }
  if (opts.existingRefreshTokenEnc) {
    return { refreshTokenEnc: opts.existingRefreshTokenEnc, status: 'connected' }
  }
  return { refreshTokenEnc: null, status: 'reconnect_required' }
}
