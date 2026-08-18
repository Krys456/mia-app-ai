import type { Reminder, ReminderProposal } from './reminderTypes'
import { getSupabase, isSupabaseConfigured } from './supabase'
import { getOrCreateUserId } from './userId'
import { parseApiErrorResponse, withErrorReference, userFacingApiMessage } from './apiError'

export class ReminderApiError extends Error {
  readonly status: number
  readonly code?: string
  readonly requestId?: string
  readonly retryAfter?: number
  readonly errors?: Record<string, string>

  constructor(
    message: string,
    status: number,
    opts?: {
      code?: string
      requestId?: string
      retryAfter?: number
      errors?: Record<string, string>
    },
  ) {
    super(message)
    this.name = 'ReminderApiError'
    this.status = status
    this.code = opts?.code
    this.requestId = opts?.requestId
    this.retryAfter = opts?.retryAfter
    this.errors = opts?.errors
  }
}

function resolveBase(): string {
  const base = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ?? ''
  return base.replace(/\/$/, '')
}

function remindersUrl(path = '', query?: Record<string, string | undefined>) {
  const url = new URL(`${resolveBase()}/api/reminders${path}`, window.location.origin)
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value) url.searchParams.set(key, value)
    }
  }
  return url.toString()
}

async function authHeaders(json = false): Promise<HeadersInit> {
  const headers: Record<string, string> = {
    'X-LAIfe-User-Id': getOrCreateUserId(),
  }
  if (json) headers['Content-Type'] = 'application/json'

  if (isSupabaseConfigured()) {
    try {
      const { data, error } = await getSupabase().auth.getSession()
      if (!error) {
        const token = data.session?.access_token?.trim()
        if (token) {
          headers.Authorization = `Bearer ${token}`
        }
      }
    } catch {
      // Soft: server 401 if missing.
    }
  }

  return headers
}

function italianReminderError(
  status: number,
  code?: string,
  errors?: Record<string, string>,
): string {
  if (code === 'reminder_in_past' || errors?.fire_at === 'reminder_in_past') {
    return 'La data e l’ora del promemoria sono già passate. Scegli un momento futuro.'
  }
  if (code === 'reminder_too_far' || errors?.fire_at === 'reminder_too_far') {
    return 'La data è troppo lontana. Scegli un momento entro circa due anni.'
  }
  if (errors?.timezone) {
    return 'Fuso orario non valido. Usa un fuso IANA (es. Europe/Rome).'
  }
  if (errors?.title) {
    return 'Il titolo del promemoria non è valido.'
  }
  if (code === 'not_found') {
    return 'Promemoria non trovato.'
  }
  if (code === 'reminders_disabled') {
    return 'I promemoria non sono disponibili in questo momento.'
  }
  if (code === 'status_transition_invalid') {
    return 'Questa azione non è consentita per lo stato attuale del promemoria.'
  }
  if (status === 401) {
    return 'Sessione non pronta. Attendi un momento e riprova.'
  }
  return userFacingApiMessage({
    code,
    message: 'Impossibile gestire i promemoria. Riprova tra poco.',
  })
}

async function parseReminderResponse<T>(response: Response): Promise<T> {
  let data: T & {
    error?: string
    code?: string
    requestId?: string
    retryAfter?: number
    errors?: Record<string, string>
  }
  try {
    data = (await response.json()) as typeof data
  } catch {
    const headerId = response.headers.get('X-Request-Id')?.trim() || undefined
    throw new ReminderApiError(
      withErrorReference('Risposta non valida dal server.', headerId),
      response.status,
      { requestId: headerId },
    )
  }

  if (!response.ok) {
    const parsed = parseApiErrorResponse(
      response,
      data,
      'Impossibile gestire i promemoria. Riprova tra poco.',
    )
    const message = withErrorReference(
      italianReminderError(response.status, parsed.code || data.code, data.errors),
      parsed.requestId,
    )
    throw new ReminderApiError(message, response.status, {
      code: parsed.code,
      requestId: parsed.requestId,
      retryAfter: parsed.retryAfter,
      errors: data.errors,
    })
  }

  return data
}

/** Confirm a proposal → persist. Never call with an unconfirmed draft accidentally. */
export async function createReminderFromProposal(proposal: ReminderProposal): Promise<Reminder> {
  const response = await fetch(remindersUrl(), {
    method: 'POST',
    headers: await authHeaders(true),
    body: JSON.stringify({
      title: proposal.title,
      body: proposal.body ?? null,
      fire_at: proposal.fireAt,
      timezone: proposal.timezone,
      source: proposal.source,
      source_ref: proposal.sourceRef ?? null,
    }),
  })
  const data = await parseReminderResponse<{ reminder: Reminder }>(response)
  return data.reminder
}

export async function listUpcomingReminders(): Promise<Reminder[]> {
  const response = await fetch(remindersUrl(), {
    method: 'GET',
    headers: await authHeaders(),
  })
  const data = await parseReminderResponse<{ reminders: Reminder[] }>(response)
  return data.reminders ?? []
}

export async function listDueReminders(): Promise<Reminder[]> {
  const response = await fetch(remindersUrl('', { due: '1' }), {
    method: 'GET',
    headers: await authHeaders(),
  })
  const data = await parseReminderResponse<{ reminders: Reminder[] }>(response)
  return data.reminders ?? []
}

export async function updateReminder(
  id: string,
  patch: {
    title?: string
    body?: string | null
    fire_at?: string
    timezone?: string
    status?: string
    snooze_until?: string | null
  },
): Promise<Reminder> {
  const response = await fetch(remindersUrl(`/${encodeURIComponent(id)}`), {
    method: 'PUT',
    headers: await authHeaders(true),
    body: JSON.stringify(patch),
  })
  const data = await parseReminderResponse<{ reminder: Reminder }>(response)
  return data.reminder
}

export async function markReminderDelivered(id: string): Promise<Reminder> {
  return updateReminder(id, { status: 'delivered' })
}

export async function completeReminder(id: string): Promise<Reminder> {
  return updateReminder(id, { status: 'completed' })
}

export async function cancelReminder(id: string): Promise<Reminder> {
  const response = await fetch(remindersUrl(`/${encodeURIComponent(id)}`, { cancel: '1' }), {
    method: 'DELETE',
    headers: await authHeaders(),
  })
  const data = await parseReminderResponse<{ reminder: Reminder }>(response)
  return data.reminder
}

/**
 * Build a ReminderProposal from local date/time inputs (manual entry).
 * Does not persist.
 */
export function buildManualReminderProposal(input: {
  title: string
  body?: string
  date: string
  time: string
  timezone: string
}): ReminderProposal | { error: string } {
  const title = input.title.trim()
  if (!title) return { error: 'Inserisci un titolo.' }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return { error: 'Data non valida.' }
  if (!/^\d{2}:\d{2}$/.test(input.time)) return { error: 'Ora non valida.' }

  const timezone = input.timezone.trim() || guessBrowserTimeZone()
  const localStamp = `${input.date}T${input.time}:00`
  const fireAt = zonedLocalToUtcIso(localStamp, timezone)
  if (!fireAt) return { error: 'Data/ora o fuso orario non validi.' }

  if (new Date(fireAt).getTime() < Date.now() - 30_000) {
    return { error: 'La data e l’ora del promemoria sono già passate.' }
  }

  return {
    title,
    body: input.body?.trim() || null,
    fireAt,
    timezone,
    source: 'user',
    localDateLabel: input.date,
    localTimeLabel: input.time,
  }
}

export function guessBrowserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

/**
 * Convert a naive local datetime in an IANA zone to UTC ISO.
 * Uses iterative offset resolution (no extra deps).
 */
export function zonedLocalToUtcIso(localIsoWithoutOffset: string, timeZone: string): string | null {
  const m = localIsoWithoutOffset.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/,
  )
  if (!m) return null
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  const hour = Number(m[4])
  const minute = Number(m[5])
  const second = Number(m[6] || '0')

  try {
    // Initial guess: treat as UTC then correct by zone offset.
    let utc = Date.UTC(year, month - 1, day, hour, minute, second)
    for (let i = 0; i < 3; i++) {
      const parts = getTzParts(new Date(utc), timeZone)
      if (!parts) return null
      const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
      const desired = Date.UTC(year, month - 1, day, hour, minute, second)
      const delta = desired - asUtc
      utc += delta
      if (delta === 0) break
    }
    const verify = getTzParts(new Date(utc), timeZone)
    if (
      !verify ||
      verify.year !== year ||
      verify.month !== month ||
      verify.day !== day ||
      verify.hour !== hour ||
      verify.minute !== minute
    ) {
      // DST gap/fold — still return best effort if within 1 hour ambiguity.
      return new Date(utc).toISOString()
    }
    return new Date(utc).toISOString()
  } catch {
    return null
  }
}

function getTzParts(date: Date, timeZone: string) {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
    const parts = fmt.formatToParts(date)
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value)
    return {
      year: get('year'),
      month: get('month'),
      day: get('day'),
      hour: get('hour'),
      minute: get('minute'),
      second: get('second'),
    }
  } catch {
    return null
  }
}

export function formatReminderWhen(reminder: Reminder): string {
  try {
    const d = new Date(reminder.fireAt)
    return new Intl.DateTimeFormat(undefined, {
      timeZone: reminder.timezone || undefined,
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(d)
  } catch {
    return reminder.fireAt
  }
}
