/**
 * #336B TEMPORARY — Calendar crypto fingerprint client helpers.
 * REMOVE BEFORE MERGE. Never stores or displays secret material.
 */

import { resolveChatAuthForRequest } from './chatAuth.ts'
import { isSupabaseConfigured } from './supabase.ts'

export type CalendarCryptoDiagSafe = {
  exists: boolean
  trimmedLength: number
  stringFingerprint12: string | null
  parseOk: boolean
  effectiveByteLength: number | null
  effectiveFingerprint12: string | null
}

const SAFE_KEYS = [
  'exists',
  'trimmedLength',
  'stringFingerprint12',
  'parseOk',
  'effectiveByteLength',
  'effectiveFingerprint12',
] as const

/** Preview / local only — never Production. */
export function isTempCalendarCryptoDiagUiEnabled(): boolean {
  if (import.meta.env.DEV) return true
  if (typeof window === 'undefined') return false
  try {
    const host = window.location.hostname.toLowerCase()
    if (host === 'localhost' || host === '127.0.0.1') return true
    // Vercel Preview / branch / deployment URLs (not bare production alias).
    if (!host.endsWith('.vercel.app')) return false
    if (host === 'mia-app-ai.vercel.app') return false
    return true
  } catch {
    return false
  }
}

function pickSafeDiag(raw: unknown): CalendarCryptoDiagSafe | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const exists = o.exists === true
  const trimmedLength =
    typeof o.trimmedLength === 'number' && Number.isFinite(o.trimmedLength)
      ? o.trimmedLength
      : 0
  const stringFingerprint12 =
    typeof o.stringFingerprint12 === 'string' ? o.stringFingerprint12.slice(0, 12) : null
  const parseOk = o.parseOk === true
  const effectiveByteLength =
    typeof o.effectiveByteLength === 'number' && Number.isFinite(o.effectiveByteLength)
      ? o.effectiveByteLength
      : null
  const effectiveFingerprint12 =
    typeof o.effectiveFingerprint12 === 'string'
      ? o.effectiveFingerprint12.slice(0, 12)
      : null
  return {
    exists,
    trimmedLength,
    stringFingerprint12,
    parseOk,
    effectiveByteLength,
    effectiveFingerprint12,
  }
}

export function formatCalendarCryptoDiagJson(payload: {
  vercelPreview?: CalendarCryptoDiagSafe | null
  supabaseEdge?: CalendarCryptoDiagSafe | null
  vercelPreviewError?: string | null
  supabaseEdgeError?: string | null
}): string {
  const out: Record<string, unknown> = {}
  if (payload.vercelPreview) out.vercelPreview = payload.vercelPreview
  if (payload.vercelPreviewError) out.vercelPreviewError = payload.vercelPreviewError
  if (payload.supabaseEdge) out.supabaseEdge = payload.supabaseEdge
  if (payload.supabaseEdgeError) out.supabaseEdgeError = payload.supabaseEdgeError
  return JSON.stringify(out, null, 2)
}

/** Authenticated Preview Node diagnostic via existing /api/daily-briefing. */
export async function runVercelCalendarCryptoDiag(): Promise<
  { ok: true; diag: CalendarCryptoDiagSafe } | { ok: false; code: string }
> {
  const auth = await resolveChatAuthForRequest()
  if (!auth.authorization) return { ok: false, code: 'auth_unavailable' }
  const res = await fetch('/api/daily-briefing', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: auth.authorization,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action: 'calendar_crypto_diag' }),
  })
  if (!res.ok) {
    let code = `http_${res.status}`
    try {
      const body = await res.json()
      if (typeof body?.code === 'string') code = body.code
    } catch {
      /* soft */
    }
    return { ok: false, code }
  }
  const body = await res.json()
  const diag = pickSafeDiag(body)
  if (!diag) return { ok: false, code: 'diag_malformed' }
  // Defense: drop any unexpected keys from display path.
  for (const k of Object.keys(body || {})) {
    if (k === 'requestId') continue
    if (!(SAFE_KEYS as readonly string[]).includes(k)) {
      /* ignore extras */
    }
  }
  return { ok: true, diag }
}

/** Authenticated Edge diagnostic via existing calendar-connection (if available). */
export async function runEdgeCalendarCryptoDiag(): Promise<
  { ok: true; diag: CalendarCryptoDiagSafe } | { ok: false; code: string }
> {
  if (!isSupabaseConfigured()) return { ok: false, code: 'auth_unavailable' }
  const auth = await resolveChatAuthForRequest()
  const url = (import.meta.env.VITE_SUPABASE_URL || '').trim().replace(/\/+$/, '')
  const anon = (import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim()
  if (!auth.authorization || !url || !anon) return { ok: false, code: 'auth_unavailable' }

  const res = await fetch(`${url}/functions/v1/calendar-connection`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: auth.authorization,
      apikey: anon,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action: 'calendar_crypto_diag' }),
  })
  if (res.status === 404) return { ok: false, code: 'calendar_disabled' }
  if (!res.ok) {
    let code = `http_${res.status}`
    try {
      const body = await res.json()
      if (typeof body?.code === 'string') code = body.code
    } catch {
      /* soft */
    }
    return { ok: false, code }
  }
  const body = await res.json()
  const diag = pickSafeDiag(body)
  if (!diag) return { ok: false, code: 'diag_malformed' }
  return { ok: true, diag }
}
