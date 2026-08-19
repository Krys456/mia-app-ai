/**
 * #311 — Bounded EMAIL_CONTEXT pack + chat enrichment orchestration.
 * Pack is ephemeral DATA for one responses.create turn. Never log the body.
 */

import { isEmailEnabled } from './email-enabled.js'
import { EmailError, isEmailError } from './email-errors.js'
import { routeEmailChatIntent } from './email-chat-intent.js'
import {
  listEmailsFromSender,
  listRecentEmails,
  listTodayEmails,
  listUnreadEmails,
  searchEmails,
} from './email-read.js'
import { scoreImportantEmail } from './email-parse.js'
import { logApiEvent } from './safe-log.js'

export const EMAIL_CHAT_PACK_MAX_CHARS = 3500
export const EMAIL_CHAT_MAX_MESSAGES = 8

/**
 * @param {Record<string, unknown>} fields
 */
function logSafe(fields) {
  logApiEvent({
    route: 'email-chat',
    ...fields,
  })
}

/**
 * @param {ReturnType<typeof import('./email-parse.js').normalizeGmailMessage>[]} messages
 * @param {number} max
 */
function formatMessagesForPack(messages, max = EMAIL_CHAT_MAX_MESSAGES) {
  const lines = []
  let i = 1
  for (const m of messages.slice(0, max)) {
    lines.push(`${i}.`)
    lines.push(`from: ${m.from || '(sconosciuto)'}`)
    lines.push(`subject: ${m.subject || '(senza oggetto)'}`)
    lines.push(`date: ${m.date || ''}`)
    lines.push(`snippet: ${m.snippet || ''}`)
    if (m.importantReason) lines.push(`note: potentially_important (${m.importantReason})`)
    lines.push('')
    i += 1
  }
  return lines.join('\n').trim()
}

/**
 * @param {{
 *   status: string
 *   operation: string
 *   count: number
 *   messages?: any[]
 *   hint?: string
 * }} opts
 */
export function buildEmailContextPack(opts) {
  const lines = [
    'EMAIL_CONTEXT',
    `status: ${opts.status}`,
    `operation: ${opts.operation}`,
    `count: ${opts.count}`,
    '',
    'Rules for the assistant:',
    '- Answer ONLY from this EMAIL_CONTEXT.',
    '- If status is not ok/no_results, do NOT claim you checked the inbox.',
    '- Never invent email contents, senders, or subjects.',
    '- Prefer a natural summary over dumping raw metadata.',
    '',
  ]
  if (opts.hint) {
    lines.push(`hint: ${opts.hint}`)
    lines.push('')
  }
  if (opts.messages && opts.messages.length) {
    lines.push('messages:')
    lines.push(formatMessagesForPack(opts.messages))
  } else if (opts.status === 'no_results') {
    lines.push('messages: (none)')
  }
  let pack = lines.join('\n').trim()
  if (pack.length > EMAIL_CHAT_PACK_MAX_CHARS) {
    pack = `${pack.slice(0, EMAIL_CHAT_PACK_MAX_CHARS - 1)}…`
  }
  return pack
}

/**
 * @param {string} instructions
 * @param {string} pack
 */
export function appendEmailPackToInstructions(instructions, pack) {
  const base = typeof instructions === 'string' ? instructions : ''
  const p = typeof pack === 'string' ? pack.trim() : ''
  if (!p) return base
  return `${base}\n\n${p}`
}

/**
 * @param {{
 *   userMessage: unknown
 *   userId: string
 *   timeZone?: unknown
 *   requestId?: string
 *   now?: Date
 *   env?: Record<string, string | undefined>
 *   supabase?: any
 *   fetchImpl?: typeof fetch
 * }} opts
 */
export async function maybeBuildEmailChatEnrichment(opts) {
  const started = Date.now()
  const env = opts.env || process.env
  const routed = routeEmailChatIntent(opts.userMessage)
  const textTrace = {
    emailIntent: routed.intent,
    emailOperation: routed.operation,
    emailQueryPresent: Boolean(routed.query),
    emailSenderPresent: Boolean(routed.sender),
  }

  if (routed.intent !== 'email' || routed.operation === 'none') {
    logSafe({
      requestId: opts.requestId,
      intent: 'none',
      operation: 'intent',
      code: 'intent_none',
      durationMs: Date.now() - started,
      ok: false,
    })
    return {
      used: false,
      intent: 'none',
      operation: 'none',
      pack: '',
      skipMemoryExtraction: false,
      status: null,
      packStatus: null,
      tokenDecrypt: 'NOT_REACHED',
      tokenRefreshAttempted: false,
      googleRequestReached: false,
      googleHttpStatus: null,
      resultCount: null,
      emailContextSent: false,
      rowFound: null,
      preGoogleFailureCode: 'intent_none',
      durationMs: Date.now() - started,
      ...textTrace,
    }
  }

  if (!isEmailEnabled(env)) {
    const pack = buildEmailContextPack({
      status: 'disabled',
      operation: routed.operation,
      count: 0,
      hint: 'Gmail integration is disabled on this environment.',
    })
    logSafe({
      requestId: opts.requestId,
      intent: 'email',
      operation: 'gate',
      code: 'email_disabled',
      durationMs: Date.now() - started,
      ok: false,
    })
    return {
      used: true,
      intent: 'email',
      operation: routed.operation,
      pack,
      skipMemoryExtraction: true,
      status: 'disabled',
      packStatus: 'disabled',
      tokenDecrypt: 'NOT_REACHED',
      tokenRefreshAttempted: false,
      googleRequestReached: false,
      googleHttpStatus: null,
      resultCount: 0,
      emailContextSent: true,
      rowFound: null,
      preGoogleFailureCode: 'email_disabled',
      durationMs: Date.now() - started,
      ...textTrace,
    }
  }

  if (!opts.userId) {
    const pack = buildEmailContextPack({
      status: 'error',
      operation: routed.operation,
      count: 0,
      hint: 'Missing authenticated owner.',
    })
    return {
      used: true,
      intent: 'email',
      operation: routed.operation,
      pack,
      skipMemoryExtraction: true,
      status: 'error',
      packStatus: 'error',
      tokenDecrypt: 'NOT_REACHED',
      tokenRefreshAttempted: false,
      googleRequestReached: false,
      googleHttpStatus: null,
      resultCount: 0,
      emailContextSent: true,
      rowFound: false,
      preGoogleFailureCode: 'missing_owner',
      durationMs: Date.now() - started,
      ...textTrace,
    }
  }

  try {
    const common = {
      userId: opts.userId,
      supabase: opts.supabase,
      fetchImpl: opts.fetchImpl,
      env,
      now: opts.now,
      maxResults: EMAIL_CHAT_MAX_MESSAGES,
    }

    let result
    let op = routed.operation

    if (op === 'unread') {
      result = await listUnreadEmails(common)
    } else if (op === 'today') {
      result = await listTodayEmails(common)
    } else if (op === 'from_sender' && routed.sender) {
      result = await listEmailsFromSender({ ...common, sender: routed.sender })
    } else if (op === 'search') {
      const q = routed.query || String(opts.userMessage || '').slice(0, 120)
      result = await searchEmails({ ...common, query: q })
    } else if (op === 'important') {
      result = await listUnreadEmails({ ...common, maxResults: 12 })
      const filtered = (result.messages || []).filter((m) => scoreImportantEmail(m).important)
      // If none unread important, fall back to recent scored
      if (filtered.length === 0) {
        const recent = await listRecentEmails({ ...common, maxResults: 12 })
        result = {
          ...recent,
          messages: (recent.messages || []).filter((m) => scoreImportantEmail(m).important),
        }
      } else {
        result = { ...result, messages: filtered }
      }
    } else if (op === 'summarize') {
      result =
        routed.timeframe === 'today'
          ? await listTodayEmails(common)
          : await listRecentEmails(common)
    } else {
      op = 'recent'
      result = await listRecentEmails(common)
    }

    const messages = Array.isArray(result.messages) ? result.messages : []
    const count = messages.length
    const packStatus = count === 0 ? 'no_results' : 'ok'
    const pack = buildEmailContextPack({
      status: packStatus,
      operation: op,
      count,
      messages,
      hint:
        packStatus === 'no_results'
          ? 'No matching emails. Tell the user clearly — do not invent.'
          : 'Summarize naturally from the listed messages.',
    })

    logSafe({
      requestId: opts.requestId,
      intent: 'email',
      operation: op,
      code: packStatus,
      ok: true,
      resultCount: count,
      googleHttpStatus: result.googleHttpStatus ?? null,
      durationMs: Date.now() - started,
    })

    return {
      used: true,
      intent: 'email',
      operation: op,
      pack,
      skipMemoryExtraction: true,
      status: packStatus,
      packStatus,
      tokenDecrypt: result.tokenDecrypt || 'ok',
      tokenRefreshAttempted: Boolean(result.tokenRefreshAttempted),
      googleRequestReached: Boolean(result.googleRequestReached),
      googleHttpStatus: result.googleHttpStatus ?? null,
      resultCount: count,
      emailContextSent: true,
      rowFound: true,
      preGoogleFailureCode: null,
      durationMs: Date.now() - started,
      ...textTrace,
      emailOperation: op,
    }
  } catch (err) {
    const code = isEmailError(err) ? err.code : 'error'
    let packStatus = 'error'
    let hint = 'Inbox could not be checked right now.'
    if (code === 'not_connected' || code === 'email_disabled') {
      packStatus = 'not_connected'
      hint = 'Gmail is not connected. Ask the user to connect Gmail in Settings → Integrations.'
    } else if (code === 'reconnect_required' || code === 'google_unauthorized') {
      packStatus = 'auth_expired'
      hint = 'Gmail authorization expired. Ask the user to reconnect Gmail.'
    }

    const pack = buildEmailContextPack({
      status: packStatus,
      operation: routed.operation,
      count: 0,
      hint,
    })

    logSafe({
      requestId: opts.requestId,
      intent: 'email',
      operation: routed.operation,
      code,
      ok: false,
      durationMs: Date.now() - started,
    })

    return {
      used: true,
      intent: 'email',
      operation: routed.operation,
      pack,
      skipMemoryExtraction: true,
      status: packStatus,
      packStatus,
      tokenDecrypt:
        code === 'encryption_failure'
          ? 'failed'
          : code === 'not_connected' || code === 'email_disabled'
            ? 'NOT_REACHED'
            : 'ok_or_partial',
      tokenRefreshAttempted: false,
      googleRequestReached: code === 'google_rate_limited' || code === 'google_unavailable',
      googleHttpStatus: isEmailError(err) ? err.status ?? null : null,
      resultCount: 0,
      emailContextSent: true,
      rowFound: code !== 'not_connected',
      preGoogleFailureCode: code,
      durationMs: Date.now() - started,
      ...textTrace,
    }
  }
}
