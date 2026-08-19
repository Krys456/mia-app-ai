/**
 * #304A1 — Client helpers for Google Calendar connection (metadata only).
 *
 * Calls Supabase Edge Functions with the anonymous ShinkAIdo JWT.
 * NEVER stores Google tokens in localStorage or React state.
 *
 * Settings UI is always visible. Server CALENDAR_ENABLED gates real OAuth/ops
 * (Edge returns calendar_disabled / 404 when off).
 */

import { resolveChatAuthForRequest } from './chatAuth.ts'
import { isSupabaseConfigured } from './supabase.ts'

export type CalendarConnectionStatus =
  | 'disconnected'
  | 'pending'
  | 'connecting'
  | 'connected'
  | 'error'
  | 'reconnect_required'
  | 'revoked'

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

function supabaseFunctionsBase(): string | null {
  const url = (import.meta.env.VITE_SUPABASE_URL || '').trim().replace(/\/+$/, '')
  const anon = (import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim()
  if (!url || !anon) return null
  return url
}

function anonKey(): string {
  return (import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim()
}

async function edgeHeaders(): Promise<HeadersInit | null> {
  if (!isSupabaseConfigured()) return null
  const { authorization } = await resolveChatAuthForRequest()
  if (!authorization) return null
  return {
    Authorization: authorization,
    apikey: anonKey(),
    Accept: 'application/json',
    'Content-Type': 'application/json',
  }
}

export async function fetchCalendarConnectionStatus(): Promise<{
  ok: boolean
  connection: CalendarConnectionPublic | null
  code?: string
}> {
  const base = supabaseFunctionsBase()
  const headers = await edgeHeaders()
  if (!base || !headers) return { ok: false, connection: null, code: 'auth_unavailable' }

  const res = await fetch(`${base}/functions/v1/calendar-connection`, {
    method: 'GET',
    headers,
  })
  if (res.status === 404) return { ok: false, connection: null, code: 'calendar_disabled' }
  if (!res.ok) {
    let code = 'status_failed'
    try {
      const body = await res.json()
      if (typeof body?.code === 'string') code = body.code
    } catch {
      /* soft */
    }
    return { ok: false, connection: null, code }
  }
  const body = (await res.json()) as { connection?: CalendarConnectionPublic }
  return { ok: true, connection: body.connection ?? null }
}

export async function startGoogleCalendarOAuth(): Promise<{
  ok: boolean
  authorizeUrl?: string
  code?: string
}> {
  const base = supabaseFunctionsBase()
  const headers = await edgeHeaders()
  if (!base || !headers) return { ok: false, code: 'auth_unavailable' }

  const res = await fetch(`${base}/functions/v1/calendar-oauth-start`, {
    method: 'POST',
    headers,
    // Bind callback return to THIS browser origin (HMAC-signed server-side).
    body: JSON.stringify({
      returnOrigin: typeof window !== 'undefined' ? window.location.origin : '',
    }),
  })
  if (res.status === 404) return { ok: false, code: 'calendar_disabled' }
  if (!res.ok) {
    let code = 'oauth_start_failed'
    try {
      const body = await res.json()
      if (typeof body?.code === 'string') code = body.code
    } catch {
      /* soft */
    }
    return { ok: false, code }
  }
  const body = (await res.json()) as { authorizeUrl?: string }
  if (!body.authorizeUrl || !body.authorizeUrl.startsWith('https://accounts.google.com/')) {
    return { ok: false, code: 'authorize_url_invalid' }
  }
  return { ok: true, authorizeUrl: body.authorizeUrl }
}

export async function disconnectGoogleCalendar(): Promise<{
  ok: boolean
  connection: CalendarConnectionPublic | null
  code?: string
}> {
  const base = supabaseFunctionsBase()
  const headers = await edgeHeaders()
  if (!base || !headers) return { ok: false, connection: null, code: 'auth_unavailable' }

  const res = await fetch(`${base}/functions/v1/calendar-connection`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ action: 'disconnect' }),
  })
  if (res.status === 404) return { ok: false, connection: null, code: 'calendar_disabled' }
  if (!res.ok) {
    let code = 'disconnect_failed'
    try {
      const body = await res.json()
      if (typeof body?.code === 'string') code = body.code
    } catch {
      /* soft */
    }
    return { ok: false, connection: null, code }
  }
  const body = (await res.json()) as { connection?: CalendarConnectionPublic }
  return { ok: true, connection: body.connection ?? null }
}

/** Map URL query ?calendar=… after OAuth return. */
export function consumeCalendarReturnQuery(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const url = new URL(window.location.href)
    const flag = url.searchParams.get('calendar')
    if (!flag) return null
    url.searchParams.delete('calendar')
    url.searchParams.delete('code')
    const next = `${url.pathname}${url.search}${url.hash}`
    window.history.replaceState({}, '', next || '/')
    return flag
  } catch {
    return null
  }
}
