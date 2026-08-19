/**
 * #311 — Reusable Gmail READ service (Node / server only).
 *
 * Public API:
 *   getConnectionStatus(userId, opts?)
 *   listRecentEmails(userId, opts?)
 *   listUnreadEmails(userId, opts?)
 *   searchEmails(userId, query, opts?)
 *   getEmail(userId, messageId, opts?)
 *
 * Never exposes Google tokens. Never logs subjects/bodies/tokens.
 */

import { isEmailEnabled } from './email-enabled.js'
import { EmailError, isEmailError } from './email-errors.js'
import { gmailMessagesGet, gmailMessagesList } from './gmail-http.js'
import { normalizeGmailMessage, scoreImportantEmail } from './email-parse.js'
import {
  getEmailConnectionStatus,
  getValidGmailAccessToken,
} from './email-token-refresh.js'
import { logApiEvent } from './safe-log.js'

export { getEmailConnectionStatus }

/**
 * @param {unknown} userId
 */
function requireOwnerUserId(userId) {
  const id = typeof userId === 'string' ? userId.trim() : ''
  if (!id) throw new EmailError('owner_required', 'owner_required')
  return id
}

/**
 * @param {Record<string, unknown>} fields
 */
function logEmailSafe(fields) {
  logApiEvent({
    route: 'email-read',
    ...fields,
  })
}

/**
 * @param {{
 *   userId: string
 *   q?: string
 *   maxResults?: number
 *   fetchBodies?: boolean
 *   supabase?: any
 *   fetchImpl?: typeof fetch
 *   env?: Record<string, string | undefined>
 *   now?: Date
 * }} opts
 */
async function listAndHydrate(opts) {
  const env = opts.env || process.env
  if (!isEmailEnabled(env)) {
    throw new EmailError('email_disabled', 'email_disabled')
  }
  const userId = requireOwnerUserId(opts.userId)
  const tokenBundle = await getValidGmailAccessToken({
    userId,
    supabase: opts.supabase,
    fetchImpl: opts.fetchImpl,
    now: opts.now,
    env,
  })

  const listRes = await gmailMessagesList({
    accessToken: tokenBundle.accessToken,
    q: opts.q,
    maxResults: opts.maxResults || 10,
    fetchImpl: opts.fetchImpl,
  })

  const messagesMeta = Array.isArray(listRes.json?.messages) ? listRes.json.messages : []
  const resultSizeEstimate =
    typeof listRes.json?.resultSizeEstimate === 'number' ? listRes.json.resultSizeEstimate : null

  /** @type {ReturnType<typeof normalizeGmailMessage>[]} */
  const messages = []
  const fetchBodies = opts.fetchBodies !== false
  for (const meta of messagesMeta.slice(0, opts.maxResults || 10)) {
    const id = typeof meta?.id === 'string' ? meta.id : ''
    if (!id) continue
    if (!fetchBodies) {
      messages.push(
        normalizeGmailMessage({
          id,
          threadId: typeof meta.threadId === 'string' ? meta.threadId : '',
          snippet: '',
          labelIds: [],
          payload: { headers: [] },
        }),
      )
      continue
    }
    try {
      const full = await gmailMessagesGet({
        accessToken: tokenBundle.accessToken,
        messageId: id,
        format: 'full',
        fetchImpl: opts.fetchImpl,
      })
      const normalized = normalizeGmailMessage(full.json)
      const scored = scoreImportantEmail(normalized)
      messages.push({ ...normalized, importantReason: scored.importantReason })
    } catch (err) {
      if (isEmailError(err) && err.code === 'google_unauthorized') throw err
      // Soft-skip malformed single messages
      messages.push(
        normalizeGmailMessage({
          id,
          threadId: typeof meta.threadId === 'string' ? meta.threadId : '',
          snippet: '',
          labelIds: [],
          payload: { headers: [] },
        }),
      )
    }
  }

  logEmailSafe({
    operation: 'list',
    ok: true,
    count: messages.length,
    resultSizeEstimate,
    refreshed: Boolean(tokenBundle.refreshed),
  })

  return {
    messages,
    resultSizeEstimate,
    googleHttpStatus: listRes.status,
    tokenDecrypt: tokenBundle.tokenDecrypt || 'ok',
    tokenRefreshAttempted: Boolean(tokenBundle.tokenRefreshAttempted),
    googleRequestReached: true,
  }
}

/**
 * @param {{
 *   userId: string
 *   maxResults?: number
 *   supabase?: any
 *   fetchImpl?: typeof fetch
 *   env?: Record<string, string | undefined>
 *   now?: Date
 * }} opts
 */
export async function listRecentEmails(opts) {
  return listAndHydrate({ ...opts, q: 'in:inbox', maxResults: opts.maxResults || 8 })
}

/**
 * @param {{
 *   userId: string
 *   maxResults?: number
 *   supabase?: any
 *   fetchImpl?: typeof fetch
 *   env?: Record<string, string | undefined>
 *   now?: Date
 * }} opts
 */
export async function listUnreadEmails(opts) {
  return listAndHydrate({
    ...opts,
    q: 'in:inbox is:unread',
    maxResults: opts.maxResults || 10,
  })
}

/**
 * @param {{
 *   userId: string
 *   query: string
 *   maxResults?: number
 *   supabase?: any
 *   fetchImpl?: typeof fetch
 *   env?: Record<string, string | undefined>
 *   now?: Date
 * }} opts
 */
export async function searchEmails(opts) {
  const q = typeof opts.query === 'string' ? opts.query.trim() : ''
  if (!q) throw new EmailError('invalid_query', 'invalid_query')
  return listAndHydrate({ ...opts, q, maxResults: opts.maxResults || 10 })
}

/**
 * @param {{
 *   userId: string
 *   messageId: string
 *   supabase?: any
 *   fetchImpl?: typeof fetch
 *   env?: Record<string, string | undefined>
 *   now?: Date
 * }} opts
 */
export async function getEmail(opts) {
  const env = opts.env || process.env
  if (!isEmailEnabled(env)) {
    throw new EmailError('email_disabled', 'email_disabled')
  }
  const userId = requireOwnerUserId(opts.userId)
  const messageId = typeof opts.messageId === 'string' ? opts.messageId.trim() : ''
  if (!messageId) throw new EmailError('invalid_query', 'invalid_query')

  const tokenBundle = await getValidGmailAccessToken({
    userId,
    supabase: opts.supabase,
    fetchImpl: opts.fetchImpl,
    now: opts.now,
    env,
  })

  const res = await gmailMessagesGet({
    accessToken: tokenBundle.accessToken,
    messageId,
    format: 'full',
    fetchImpl: opts.fetchImpl,
  })
  const normalized = normalizeGmailMessage(res.json)
  const scored = scoreImportantEmail(normalized)
  return {
    message: { ...normalized, importantReason: scored.importantReason },
    googleHttpStatus: res.status,
    tokenDecrypt: tokenBundle.tokenDecrypt || 'ok',
    tokenRefreshAttempted: Boolean(tokenBundle.tokenRefreshAttempted),
    googleRequestReached: true,
  }
}

/**
 * Today's inbox messages (local calendar day in optional timeZone).
 * @param {{
 *   userId: string
 *   timeZone?: string
 *   maxResults?: number
 *   supabase?: any
 *   fetchImpl?: typeof fetch
 *   env?: Record<string, string | undefined>
 *   now?: Date
 * }} opts
 */
export async function listTodayEmails(opts) {
  const now = opts.now instanceof Date ? opts.now : new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  // Gmail after:YYYY/M/D is exclusive of prior days; good enough for Phase 1 "today".
  return listAndHydrate({
    ...opts,
    q: `in:inbox after:${y}/${Number(m)}/${Number(d)}`,
    maxResults: opts.maxResults || 12,
  })
}

/**
 * From-sender search.
 * @param {{
 *   userId: string
 *   sender: string
 *   maxResults?: number
 *   supabase?: any
 *   fetchImpl?: typeof fetch
 *   env?: Record<string, string | undefined>
 *   now?: Date
 * }} opts
 */
export async function listEmailsFromSender(opts) {
  const sender = typeof opts.sender === 'string' ? opts.sender.trim() : ''
  if (!sender) throw new EmailError('invalid_query', 'invalid_query')
  // Escape quotes in sender for Gmail q
  const safe = sender.replace(/"/g, '')
  return listAndHydrate({
    ...opts,
    q: `in:inbox from:${safe.includes(' ') ? `"${safe}"` : safe}`,
    maxResults: opts.maxResults || 10,
  })
}
