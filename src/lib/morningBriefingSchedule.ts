/**
 * #334D1 — Client API for morning briefing schedule (server-authoritative).
 */

import { resolveChatAuthForRequest } from './chatAuth'

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

/** Consume ?briefing=morning once (StrictMode-safe via sessionStorage). */
export function consumeMorningBriefingDeepLink(
  search: string = typeof window !== 'undefined' ? window.location.search : '',
): boolean {
  try {
    const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
    if (params.get('briefing') !== 'morning') return false
    const key = 'shinkaido.morningBriefing.deeplink.consumed'
    const stamp = `${Date.now()}`
    const prev = sessionStorage.getItem(key)
    // Allow at most one consumption per navigation burst (~2s StrictMode).
    if (prev && Date.now() - Number(prev) < 2000) {
      params.delete('briefing')
      const next = params.toString()
      const url = `${window.location.pathname}${next ? `?${next}` : ''}${window.location.hash}`
      window.history.replaceState({}, '', url)
      return false
    }
    sessionStorage.setItem(key, stamp)
    params.delete('briefing')
    const next = params.toString()
    const url = `${window.location.pathname}${next ? `?${next}` : ''}${window.location.hash}`
    window.history.replaceState({}, '', url)
    return true
  } catch {
    return false
  }
}
