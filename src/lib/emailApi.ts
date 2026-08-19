/**
 * #311 — Client helpers for Google Gmail connection (metadata only).
 * NEVER stores Google tokens in localStorage or React state.
 */

import { resolveChatAuthForRequest } from './chatAuth.ts'
import { isSupabaseConfigured } from './supabase.ts'

export type EmailConnectionPublic = {
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

export async function fetchEmailConnectionStatus(): Promise<{
  ok: boolean
  connection: EmailConnectionPublic | null
  code?: string
}> {
  const base = supabaseFunctionsBase()
  const headers = await edgeHeaders()
  if (!base || !headers) return { ok: false, connection: null, code: 'auth_unavailable' }

  const res = await fetch(`${base}/functions/v1/email-connection`, {
    method: 'GET',
    headers,
  })
  if (res.status === 404) return { ok: false, connection: null, code: 'email_disabled' }
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
  const body = (await res.json()) as { connection?: EmailConnectionPublic }
  return { ok: true, connection: body.connection ?? null }
}

export async function startGoogleGmailOAuth(): Promise<{
  ok: boolean
  authorizeUrl?: string
  code?: string
}> {
  const base = supabaseFunctionsBase()
  const headers = await edgeHeaders()
  if (!base || !headers) return { ok: false, code: 'auth_unavailable' }

  let returnOrigin: string | undefined
  try {
    returnOrigin = window.location.origin
  } catch {
    /* soft */
  }

  const res = await fetch(`${base}/functions/v1/email-oauth-start`, {
    method: 'POST',
    headers,
    body: JSON.stringify(returnOrigin ? { returnOrigin } : {}),
  })
  if (res.status === 404) return { ok: false, code: 'email_disabled' }
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

export async function disconnectGoogleGmail(): Promise<{
  ok: boolean
  connection: EmailConnectionPublic | null
  code?: string
}> {
  const base = supabaseFunctionsBase()
  const headers = await edgeHeaders()
  if (!base || !headers) return { ok: false, connection: null, code: 'auth_unavailable' }

  const res = await fetch(`${base}/functions/v1/email-connection`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ action: 'disconnect' }),
  })
  if (res.status === 404) return { ok: false, connection: null, code: 'email_disabled' }
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
  const body = (await res.json()) as { connection?: EmailConnectionPublic }
  return { ok: true, connection: body.connection ?? null }
}

/** Map URL query ?email=… after OAuth return. */
export function consumeEmailReturnQuery(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const url = new URL(window.location.href)
    const flag = url.searchParams.get('email')
    if (!flag) return null
    url.searchParams.delete('email')
    url.searchParams.delete('code')
    const next = `${url.pathname}${url.search}${url.hash}`
    window.history.replaceState({}, '', next || '/')
    return flag
  } catch {
    return null
  }
}
