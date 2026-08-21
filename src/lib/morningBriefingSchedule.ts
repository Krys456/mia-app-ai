/**
 * #334D1 — Client API for morning briefing schedule (server-authoritative).
 */

import { resolveChatAuthForRequest } from './chatAuth'
import { clearMorningBriefingDurableIntent } from './morningBriefingDurableIntent'

export type MorningBriefingSchedule = {
  enabled: boolean
  localTime: string
  daysOfWeek: number[]
  timezone: string
  lastDeliveredLocalDate: string | null
  updatedAt?: string | null
  createdAt?: string | null
  exists?: boolean
}

export const MORNING_DAY_LABELS: { value: number; short: string; aria: string }[] = [
  { value: 1, short: 'L', aria: 'Lunedì' },
  { value: 2, short: 'M', aria: 'Martedì' },
  { value: 3, short: 'M', aria: 'Mercoledì' },
  { value: 4, short: 'G', aria: 'Giovedì' },
  { value: 5, short: 'V', aria: 'Venerdì' },
  { value: 6, short: 'S', aria: 'Sabato' },
  { value: 7, short: 'D', aria: 'Domenica' },
]

function guessBrowserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

async function dailyBriefingFetch(
  method: string,
  body?: Record<string, unknown>,
  query = '',
): Promise<Response> {
  const auth = await resolveChatAuthForRequest()
  if (!auth.authorization) {
    const err = new Error('unauthorized')
    ;(err as Error & { status?: number }).status = 401
    throw err
  }
  const headers: Record<string, string> = {
    Accept: 'application/json',
    Authorization: auth.authorization,
  }
  if (body) headers['Content-Type'] = 'application/json'
  return fetch(`/api/daily-briefing${query}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
}

export async function fetchMorningBriefingSchedule(): Promise<MorningBriefingSchedule> {
  const res = await dailyBriefingFetch('GET', undefined, '?morning_schedule=1')
  if (!res.ok) {
    const err = new Error(`schedule_fetch_${res.status}`)
    ;(err as Error & { status?: number }).status = res.status
    throw err
  }
  const json = (await res.json()) as { schedule?: MorningBriefingSchedule }
  return (
    json.schedule || {
      enabled: false,
      localTime: '08:00',
      daysOfWeek: [1, 2, 3, 4, 5],
      timezone: guessBrowserTimeZone(),
      lastDeliveredLocalDate: null,
      exists: false,
    }
  )
}

export async function upsertMorningBriefingScheduleClient(input: {
  enabled: boolean
  localTime: string
  daysOfWeek: number[]
  timezone?: string
}): Promise<MorningBriefingSchedule> {
  const timezone = input.timezone || guessBrowserTimeZone()
  const res = await dailyBriefingFetch('POST', {
    action: 'morning_schedule_upsert',
    enabled: input.enabled,
    localTime: input.localTime,
    daysOfWeek: input.daysOfWeek,
    timezone,
  })
  const json = (await res.json()) as {
    schedule?: MorningBriefingSchedule
    errors?: Record<string, string>
    code?: string
  }
  if (!res.ok) {
    const err = new Error(json.code || `schedule_upsert_${res.status}`)
    ;(err as Error & { status?: number; errors?: Record<string, string> }).status = res.status
    ;(err as Error & { errors?: Record<string, string> }).errors = json.errors
    throw err
  }
  return json.schedule as MorningBriefingSchedule
}

export async function disableMorningBriefingScheduleClient(): Promise<MorningBriefingSchedule> {
  const res = await dailyBriefingFetch('POST', { action: 'morning_schedule_disable' })
  const json = (await res.json()) as { schedule?: MorningBriefingSchedule }
  if (!res.ok) {
    const err = new Error(`schedule_disable_${res.status}`)
    ;(err as Error & { status?: number }).status = res.status
    throw err
  }
  return json.schedule as MorningBriefingSchedule
}

export { guessBrowserTimeZone }

/** sessionStorage state machine for morning-briefing deep-link intent. */
export const MORNING_BRIEFING_INTENT_KEY = 'shinkaido.morningBriefing.intent'
export const MORNING_BRIEFING_SW_MESSAGE_TYPE = 'shinkaido.morning_briefing'

export type MorningBriefingIntentState = 'pending' | 'done'

/** Module lock — StrictMode / remount must not double-fire the first handoff. */
let morningBriefingHandoffClaimed = false

function readIntentState(storage?: Storage | null): MorningBriefingIntentState | null {
  try {
    const store = storage ?? (typeof sessionStorage !== 'undefined' ? sessionStorage : null)
    if (!store) return null
    const raw = store.getItem(MORNING_BRIEFING_INTENT_KEY)
    if (raw === 'pending' || raw === 'done') return raw
    return null
  } catch {
    return null
  }
}

function writeIntentState(state: MorningBriefingIntentState, storage?: Storage | null): void {
  const store = storage ?? (typeof sessionStorage !== 'undefined' ? sessionStorage : null)
  if (!store) return
  store.setItem(MORNING_BRIEFING_INTENT_KEY, state)
}

/** True when URL carries the safe morning-briefing marker. */
export function hasMorningBriefingUrlMarker(
  search: string = typeof window !== 'undefined' ? window.location.search : '',
): boolean {
  try {
    const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
    return params.get('briefing') === 'morning'
  } catch {
    return false
  }
}

/**
 * Capture intent from URL, SW postMessage, or durable Cache API marker without consuming.
 * Does NOT strip ?briefing=morning — cleanup happens only after successful handoff.
 * A fresh notification tap (message / durable / URL) re-arms even after a prior done.
 */
export function captureMorningBriefingIntent(options?: {
  search?: string
  fromMessage?: boolean
  fromDurable?: boolean
  storage?: Storage | null
}): boolean {
  try {
    const fromUrl = hasMorningBriefingUrlMarker(
      options?.search ?? (typeof window !== 'undefined' ? window.location.search : ''),
    )
    if (!fromUrl && !options?.fromMessage && !options?.fromDurable) return false
    const state = readIntentState(options?.storage)
    if (state === 'pending') return true
    // Re-arm after prior handoff when a new explicit intent arrives.
    writeIntentState('pending', options?.storage)
    morningBriefingHandoffClaimed = false
    return true
  } catch {
    return false
  }
}

export function hasPendingMorningBriefingIntent(storage?: Storage | null): boolean {
  return readIntentState(storage) === 'pending'
}

/**
 * Claim the one in-flight handoff. Returns false if already done, not pending,
 * or another claim holds the module lock (StrictMode-safe).
 */
export function claimMorningBriefingHandoff(storage?: Storage | null): boolean {
  if (morningBriefingHandoffClaimed) return false
  if (readIntentState(storage) !== 'pending') return false
  morningBriefingHandoffClaimed = true
  return true
}

/** Release claim after failed sendMessage so a later ready tick can retry. */
export function releaseMorningBriefingHandoffClaim(): void {
  morningBriefingHandoffClaimed = false
}

/**
 * Mark intent consumed AFTER successful handoff to #334C sendMessage('Briefing').
 * Strips ?briefing=morning via history.replaceState and clears durable Cache marker.
 */
export function completeMorningBriefingHandoff(options?: {
  storage?: Storage | null
  location?: { pathname: string; search: string; hash: string }
  replaceState?: (url: string) => void
  clearDurable?: () => void | Promise<void>
}): void {
  try {
    writeIntentState('done', options?.storage)
    morningBriefingHandoffClaimed = false
    const loc =
      options?.location ??
      (typeof window !== 'undefined'
        ? { pathname: window.location.pathname, search: window.location.search, hash: window.location.hash }
        : null)
    if (loc) {
      const params = new URLSearchParams(loc.search.startsWith('?') ? loc.search.slice(1) : loc.search)
      if (params.has('briefing')) {
        params.delete('briefing')
        const next = params.toString()
        const url = `${loc.pathname}${next ? `?${next}` : ''}${loc.hash}`
        if (options?.replaceState) {
          options.replaceState(url)
        } else if (typeof window !== 'undefined') {
          window.history.replaceState({}, '', url)
        }
      }
    }
    // Clear durable marker only after successful handoff (fire-and-forget).
    try {
      const clear = options?.clearDurable
      if (clear) {
        void Promise.resolve(clear()).catch(() => undefined)
      } else {
        void clearMorningBriefingDurableIntent().catch(() => undefined)
      }
    } catch {
      /* ignore */
    }
  } catch {
    morningBriefingHandoffClaimed = false
  }
}

/** @internal test helper — reset module lock between cases. */
export function resetMorningBriefingHandoffLockForTests(): void {
  morningBriefingHandoffClaimed = false
}

/**
 * @deprecated Use captureMorningBriefingIntent + claim/complete.
 * Captures pending intent from the URL marker without stripping or marking done.
 */
export function consumeMorningBriefingDeepLink(
  search: string = typeof window !== 'undefined' ? window.location.search : '',
): boolean {
  return captureMorningBriefingIntent({ search })
}
