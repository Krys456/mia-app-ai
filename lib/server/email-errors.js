/**
 * #311 — Typed Email/Gmail errors (safe codes only; never Google bodies/tokens).
 */

export const EMAIL_ERROR_CODES = Object.freeze([
  'owner_required',
  'email_disabled',
  'not_connected',
  'reconnect_required',
  'google_unauthorized',
  'google_forbidden',
  'google_rate_limited',
  'google_timeout',
  'google_unavailable',
  'malformed_google_response',
  'encryption_failure',
  'invalid_query',
])

export class EmailError extends Error {
  /**
   * @param {string} code
   * @param {string} [message]
   * @param {{ status?: number, retryable?: boolean }} [opts]
   */
  constructor(code, message, opts = {}) {
    const safeCode = EMAIL_ERROR_CODES.includes(code) ? code : 'google_unavailable'
    super(message || safeCode)
    this.name = 'EmailError'
    this.code = safeCode
    this.status = typeof opts.status === 'number' ? opts.status : undefined
    this.retryable = Boolean(opts.retryable)
  }
}

/**
 * @param {unknown} err
 * @returns {err is EmailError}
 */
export function isEmailError(err) {
  return err instanceof EmailError || (err && err.name === 'EmailError' && typeof err.code === 'string')
}

/**
 * @param {number | null | undefined} status
 * @param {string} [fallbackCode]
 */
export function emailErrorFromHttpStatus(status, fallbackCode = 'google_unavailable') {
  if (status === 401) {
    return new EmailError('google_unauthorized', 'google_unauthorized', { status, retryable: false })
  }
  if (status === 403) {
    return new EmailError('google_forbidden', 'google_forbidden', { status, retryable: false })
  }
  if (status === 429) {
    return new EmailError('google_rate_limited', 'google_rate_limited', { status, retryable: true })
  }
  if (status === 408) {
    return new EmailError('google_timeout', 'google_timeout', { status, retryable: true })
  }
  if (status != null && status >= 500) {
    return new EmailError('google_unavailable', 'google_unavailable', { status, retryable: true })
  }
  return new EmailError(fallbackCode, fallbackCode, {
    status: status ?? undefined,
    retryable: false,
  })
}
