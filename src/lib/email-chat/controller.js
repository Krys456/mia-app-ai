/**
 * #337B — Apply Gmail chat intent (client orchestration).
 * Zero model calls. LOCAL_EXCHANGE path only. Read-only: never sends,
 * replies to, or deletes messages.
 */

import { createEmailContext, isEmailContextFresh } from './active-context.js'
import { detectEmailIntent } from './intent.js'
import { extractiveSummary, failureReply, renderEmailList, renderFollowUp } from './render.js'

function browserTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

// #337B — backend treats no_sender_match as ok:true (a successful query with
// zero results), so it renders via the normal empty-list path below — NOT
// as a hard failure. Only these need a failureReply / Settings CTA.
const FAILURE_STATUSES = new Set([
  'disabled',
  'disconnected',
  'reconnect_required',
  'timeout',
  'error',
  'auth_required',
])

function buildEmailUi(status) {
  if (status === 'disconnected' || status === 'reconnect_required' || status === 'auth_required') {
    return {
      kind: 'status',
      chip: status === 'reconnect_required' ? 'Ricollega Gmail' : 'Gmail',
      actions: [{ id: 'open_settings', label: 'Apri Impostazioni' }],
    }
  }
  return { kind: 'status', chip: 'Gmail', actions: [] }
}

/**
 * @param {{
 *   text: string
 *   languageHint?: 'it'|'en'
 *   emailContext?: object | null
 *   timeZone?: string
 *   requestFn?: typeof import('./api.js').requestEmailQuery
 * }} input
 */
export async function applyEmailIntent(input) {
  const langHint = input.languageHint === 'en' ? 'en' : 'it'
  const ctx = isEmailContextFresh(input.emailContext) ? input.emailContext : null
  const intent = detectEmailIntent(input.text, {
    languageHint: langHint,
    hasEmailContext: Boolean(ctx),
  })

  if (intent.intent !== 'email') {
    return {
      handled: false,
      reply: null,
      diag: { emailIntent: 'none', failureCode: intent.failureCode || null },
    }
  }

  const language = intent.language || langHint
  const timeZone = input.timeZone || browserTimeZone()
  const requestFn =
    typeof input.requestFn === 'function'
      ? input.requestFn
      : (await import('./api.js')).requestEmailQuery

  // --- Follow-ups from verified context ---
  if (intent.followUp && ctx) {
    if (intent.followUpKind === 'summarize') {
      const focusIdx =
        typeof ctx.focusIndex === 'number' && ctx.focusIndex >= 0 ? ctx.focusIndex : 0
      const focused = Array.isArray(ctx.messages) ? ctx.messages[focusIdx] : null
      if (!focused) {
        return {
          handled: true,
          reply:
            language === 'en'
              ? 'I don’t have an email in context for that.'
              : 'Non ho un’email in memoria per quella domanda.',
          emailContext: ctx,
          emailUi: buildEmailUi(ctx.status || 'ok'),
          diag: {
            emailIntent: 'email',
            operation: 'follow_up_summarize_no_context',
            failureCode: 'no_context',
            modelCalls: 0,
            terminatesLocally: true,
          },
        }
      }

      // #337B — riassumila: request the full body for ONE message via
      // queryType 'body_one' + messageId + includeBody, or fall back to
      // extractive-from-snippet when the body fetch fails.
      let target = focused
      try {
        const pack = await requestFn({
          queryType: 'body_one',
          messageId: focused.id,
          includeBody: true,
          timeZone: ctx.timezone || timeZone,
        })
        if (pack && pack.status === 'ok' && Array.isArray(pack.messages) && pack.messages.length) {
          target = { ...focused, ...pack.messages[0] }
        }
      } catch {
        /* soft — extractive-from-snippet fallback below */
      }

      const reply = renderFollowUp('summarize', ctx, { message: target })
      return {
        handled: true,
        reply,
        emailContext: ctx,
        emailUi: buildEmailUi(ctx.status || 'ok'),
        diag: {
          emailIntent: 'email',
          operation: 'follow_up_summarize',
          contextReused: true,
          modelCalls: 0,
          terminatesLocally: true,
        },
      }
    }

    const reply = renderFollowUp(intent.followUpKind, ctx, { ordinalIndex: intent.ordinalIndex })
    let nextCtx = ctx
    if (intent.followUpKind === 'ordinal' && intent.ordinalIndex != null) {
      nextCtx = { ...ctx, focusIndex: intent.ordinalIndex }
    } else if (intent.followUpKind === 'next_after') {
      const focus = typeof ctx.focusIndex === 'number' ? ctx.focusIndex : -1
      const nextIdx = focus >= 0 ? focus + 1 : 0
      if (nextIdx < (ctx.messages || []).length) nextCtx = { ...ctx, focusIndex: nextIdx }
    } else if (intent.followUpKind === 'previous') {
      const focus = typeof ctx.focusIndex === 'number' ? ctx.focusIndex : 0
      const prevIdx = focus - 1
      if (prevIdx >= 0) nextCtx = { ...ctx, focusIndex: prevIdx }
    }
    return {
      handled: true,
      reply,
      emailContext: nextCtx,
      emailUi: buildEmailUi(ctx.status || 'ok'),
      diag: {
        emailIntent: 'email',
        operation: 'follow_up',
        followUpKind: intent.followUpKind,
        contextReused: true,
        modelCalls: 0,
        terminatesLocally: true,
      },
    }
  }

  if (intent.followUp && !ctx) {
    return {
      handled: true,
      reply:
        language === 'en'
          ? 'Ask about your email first, then I can go deeper.'
          : 'Chiedi prima le tue email, poi posso approfondire.',
      diag: {
        emailIntent: 'email',
        operation: 'follow_up_no_context',
        failureCode: 'no_context',
        modelCalls: 0,
        terminatesLocally: true,
      },
    }
  }

  // --- Fresh query ---
  const pack = await requestFn({
    queryType: intent.queryType,
    sender: intent.sender || undefined,
    timeWindow: intent.timeWindow || undefined,
    timeZone,
    maxResults: 20,
  })

  const status = typeof pack?.status === 'string' ? pack.status : 'error'
  if (FAILURE_STATUSES.has(status)) {
    const emailContext = createEmailContext({
      queryType: intent.queryType,
      timezone: timeZone,
      fetchedAt: pack?.fetchedAt,
      messages: [],
      focusIndex: -1,
      status,
      language,
    })
    return {
      handled: true,
      reply: failureReply(status, language),
      emailContext,
      emailUi: buildEmailUi(status),
      diag: {
        emailIntent: 'email',
        operation: intent.operation || 'query',
        emailStatus: status,
        failureCode: pack?.code || status,
        modelCalls: 0,
        terminatesLocally: true,
      },
    }
  }

  const messages = Array.isArray(pack?.messages) ? pack.messages : []
  const effectiveStatus = messages.length ? 'ok' : status === 'no_sender_match' ? 'no_sender_match' : 'empty'

  const reply =
    intent.queryType === 'summary'
      ? extractiveSummary(messages, { language, timeZone, timeWindow: intent.timeWindow })
      : renderEmailList(messages, intent.queryType, {
          language,
          timeZone,
          timeWindow: intent.timeWindow,
          sender: intent.sender,
        })

  const emailContext = createEmailContext({
    queryType: intent.queryType,
    timezone: timeZone,
    fetchedAt: pack?.fetchedAt,
    messages,
    focusIndex: messages.length ? 0 : -1,
    status: effectiveStatus,
    language,
  })

  return {
    handled: true,
    reply,
    emailContext,
    emailUi: buildEmailUi(effectiveStatus),
    diag: {
      emailIntent: 'email',
      operation: intent.operation || 'query',
      emailStatus: effectiveStatus,
      queryType: intent.queryType,
      messageCount: messages.length,
      modelCalls: 0,
      terminatesLocally: true,
    },
  }
}
