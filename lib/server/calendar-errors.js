/**
 * #304A2 — Typed Calendar errors (safe codes only; never Google bodies/tokens).
 */

export const CALENDAR_ERROR_CODES = Object.freeze([
  'owner_required',
  'calendar_disabled',
  'not_connected',
  'reconnect_required',
  'google_unauthorized',
  'google_forbidden',
  'google_rate_limited',
  'google_timeout',
  'google_unavailable',
  'invalid_range',
  'range_too_large',
  'malformed_google_response',
  'encryption_failure',
])

export class CalendarError extends Error {
  /**
   * @param {string} code
   * @param {string} [message]
   * @param {{ status?: number, retryable?: boolean }} [opts]
   */
  constructor(code, message, opts = {}) {
    const safeCode = CALENDAR_ERROR_CODES.includes(code) ? code : 'google_unavailable'
    super(message || safeCode)
    this.name = 'CalendarError'
    this.code = safeCode
    this.status = typeof opts.status === 'number' ? opts.status : undefined
    this.retryable = Boolean(opts.retryable)
  }
}

/**
 * @param {unknown} err
 * @returns {err is CalendarError}
 */
export function isCalendarError(err) {
  return err instanceof CalendarError || (err && err.name === 'CalendarError' && typeof err.code === 'string')
}

/**
 * Map HTTP status from Google Calendar/token APIs to CalendarError.
 * @param {number | null | undefined} status
 * @param {string} [fallbackCode]
 */
export function calendarErrorFromHttpStatus(status, fallbackCode = 'google_unavailable') {
  if (status === 401) {
    return new CalendarError('google_unauthorized', 'google_unauthorized', { status, retryable: false })
  }
  if (status === 403) {
    return new CalendarError('google_forbidden', 'google_forbidden', { status, retryable: false })
  }
  if (status === 429) {
    return new CalendarError('google_rate_limited', 'google_rate_limited', { status, retryable: true })
  }
  if (status === 408) {
    return new CalendarError('google_timeout', 'google_timeout', { status, retryable: true })
  }
  if (status != null && status >= 500) {
    return new CalendarError('google_unavailable', 'google_unavailable', { status, retryable: true })
  }
  return new CalendarError(fallbackCode, fallbackCode, {
    status: status ?? undefined,
    retryable: false,
  })
}
