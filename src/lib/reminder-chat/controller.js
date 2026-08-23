/**
 * #357B — Apply Reminder chat intent (client orchestration).
 * Zero model calls. Propose→confirm before any write. LOCAL_EXCHANGE only.
 */

import {
  clearPendingReminderProposal,
  createRemindersContext,
  focusIndexInContext,
  getFocusedReminder,
  isRemindersContextFresh,
  loadPendingReminderProposal,
  savePendingReminderProposal,
  saveRemindersContext,
} from './active-context.js'
import { parseReminderDateTime } from './datetime.js'
import { detectReminderIntent } from './intent.js'
import {
  buildProposalUi,
  failureReply,
  reminderCopy,
  renderProposalText,
  renderReminderList,
  renderSavedText,
} from './render.js'
import { readBrowserReminderTimeZone } from './timezone.js'

function browserTimeZone() {
  // #380C — never treat Etc/GMT* as authoritative.
  return readBrowserReminderTimeZone() || undefined
}

function localLabelsForFireAt(fireAtIso, timeZone) {
  try {
    const d = new Date(fireAtIso)
    const dateFmt = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    const timeFmt = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
    return {
      localDateLabel: dateFmt.format(d),
      localTimeLabel: timeFmt.format(d),
    }
  } catch {
    return { localDateLabel: undefined, localTimeLabel: undefined }
  }
}

function toContextItems(reminders, timeZone) {
  return (reminders || []).map((r) => {
    const labels = localLabelsForFireAt(r.fireAt, r.timezone || timeZone)
    return {
      id: r.id,
      title: r.title,
      fireAt: r.fireAt,
      timezone: r.timezone,
      status: r.status,
      ...labels,
    }
  })
}

function filterToday(items, timeZone, now = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const today = fmt.format(now)
  return items.filter((r) => (r.localDateLabel || '').startsWith(today) || r.localDateLabel === today)
}

function resolveIndex(ctx, index) {
  if (!ctx?.reminders?.length) return null
  if (typeof index === 'number' && index >= 0 && index < ctx.reminders.length) {
    return { reminder: ctx.reminders[index], focusIndex: index }
  }
  if (ctx.reminders.length === 1) {
    return { reminder: ctx.reminders[0], focusIndex: 0 }
  }
  const focused = getFocusedReminder(ctx)
  if (focused && ctx.reminders.length === 1) return { reminder: focused, focusIndex: 0 }
  if (typeof index !== 'number' && ctx.reminders.length === 1) {
    return { reminder: ctx.reminders[0], focusIndex: 0 }
  }
  if (typeof index !== 'number' && focused && ctx.focusIndex >= 0) {
    return { reminder: focused, focusIndex: ctx.focusIndex }
  }
  return null
}

async function defaultApi() {
  return import('../reminderApi.ts')
}

/**
 * @param {{
 *   text: string
 *   languageHint?: 'it'|'en'
 *   remindersContext?: object|null
 *   timeZone?: string
 *   now?: Date
 *   pushLikelyEnabled?: boolean
 *   api?: {
 *     listUpcomingReminders?: Function
 *     createReminderFromProposal?: Function
 *     completeReminder?: Function
 *     cancelReminder?: Function
 *     updateReminder?: Function
 *   }
 *   storage?: Storage|null
 * }} input
 */
export async function applyReminderIntent(input) {
  const langHint = input.languageHint === 'en' ? 'en' : 'it'
  const timeZone = input.timeZone || browserTimeZone()
  const now = input.now instanceof Date ? input.now : new Date()
  const storage =
    input.storage !== undefined
      ? input.storage
      : typeof sessionStorage !== 'undefined'
        ? sessionStorage
        : null

  const ctx = isRemindersContextFresh(input.remindersContext)
    ? input.remindersContext
    : null
  const pending = loadPendingReminderProposal(storage, now.getTime())

  const intent = detectReminderIntent(input.text, {
    languageHint: langHint,
    hasRemindersContext: Boolean(ctx),
    hasPendingProposal: Boolean(pending),
    timeZone,
    now,
  })

  if (intent.intent !== 'reminder') {
    return {
      handled: false,
      reply: null,
      diag: { reminderIntent: 'none', failureCode: intent.failureCode || null },
    }
  }

  const language = intent.language || langHint
  const api = input.api || (await defaultApi())

  // --- Follow-ups ---
  if (intent.operation === 'follow_up') {
    const kind = intent.followUpKind

    if (kind === 'confirm_pending') {
      if (!pending) {
        return {
          handled: true,
          reply: failureReply('not_found', language),
          diag: { reminderIntent: 'reminder', operation: 'confirm', failureCode: 'not_found' },
        }
      }
      try {
        const created = await api.createReminderFromProposal(pending)
        clearPendingReminderProposal(storage)
        const labels = localLabelsForFireAt(created.fireAt, created.timezone || timeZone)
        const pushHint = input.pushLikelyEnabled === false
        const reply = renderSavedText(
          { ...created, ...labels },
          language,
          pushHint,
        )
        return {
          handled: true,
          reply,
          remindersContext: ctx,
          offerPushOptIn: pushHint,
          diag: {
            reminderIntent: 'reminder',
            operation: 'confirm',
            persisted: true,
            modelCalls: 0,
            terminatesLocally: true,
          },
        }
      } catch (err) {
        const code = err?.code === 'reminders_disabled' ? 'reminders_disabled' : 'create_failed'
        return {
          handled: true,
          reply: failureReply(code, language),
          diag: { reminderIntent: 'reminder', operation: 'confirm', failureCode: code },
        }
      }
    }

    if (kind === 'discard_pending') {
      clearPendingReminderProposal(storage)
      return {
        handled: true,
        reply: reminderCopy('discarded', language),
        diag: { reminderIntent: 'reminder', operation: 'discard', modelCalls: 0 },
      }
    }

    if (kind === 'select_index' || kind === 'select_next') {
      if (!ctx?.reminders?.length) {
        return {
          handled: true,
          reply: failureReply('not_found', language),
          diag: { reminderIntent: 'reminder', failureCode: 'not_found' },
        }
      }
      let idx =
        kind === 'select_next'
          ? Math.min((ctx.focusIndex || 0) + 1, ctx.reminders.length - 1)
          : intent.followUpIndex
      const next = focusIndexInContext(ctx, idx)
      saveRemindersContext(next, storage)
      const r = getFocusedReminder(next)
      const line = r
        ? `${r.localTimeLabel || ''} — ${r.title}`.replace(/^\s—\s/, '')
        : failureReply('not_found', language)
      return {
        handled: true,
        reply: language === 'en' ? `Selected: ${line}` : `Selezionato: ${line}`,
        remindersContext: next,
        diag: { reminderIntent: 'reminder', operation: 'select', modelCalls: 0 },
      }
    }

    if (kind === 'complete' || kind === 'cancel' || kind === 'reschedule') {
      if (!ctx?.reminders?.length) {
        return {
          handled: true,
          reply: failureReply('not_found', language),
          diag: { reminderIntent: 'reminder', failureCode: 'not_found' },
        }
      }
      const resolved = resolveIndex(ctx, intent.followUpIndex)
      if (!resolved) {
        return {
          handled: true,
          reply: failureReply('ambiguous', language),
          diag: { reminderIntent: 'reminder', failureCode: 'ambiguous' },
        }
      }

      if (kind === 'complete') {
        try {
          await api.completeReminder(resolved.reminder.id)
          const nextList = ctx.reminders.filter((r) => r.id !== resolved.reminder.id)
          const nextCtx = createRemindersContext({
            ...ctx,
            reminders: nextList,
            focusIndex: nextList.length ? 0 : -1,
          })
          saveRemindersContext(nextCtx, storage)
          return {
            handled: true,
            reply: reminderCopy('completed', language),
            remindersContext: nextCtx,
            diag: { reminderIntent: 'reminder', operation: 'complete', persisted: true },
          }
        } catch {
          return {
            handled: true,
            reply: failureReply('update_failed', language),
            diag: { reminderIntent: 'reminder', failureCode: 'update_failed' },
          }
        }
      }

      if (kind === 'cancel') {
        try {
          await api.cancelReminder(resolved.reminder.id)
          const nextList = ctx.reminders.filter((r) => r.id !== resolved.reminder.id)
          const nextCtx = createRemindersContext({
            ...ctx,
            reminders: nextList,
            focusIndex: nextList.length ? 0 : -1,
          })
          saveRemindersContext(nextCtx, storage)
          return {
            handled: true,
            reply: reminderCopy('cancelled', language),
            remindersContext: nextCtx,
            diag: { reminderIntent: 'reminder', operation: 'cancel', persisted: true },
          }
        } catch {
          return {
            handled: true,
            reply: failureReply('cancel_failed', language),
            diag: { reminderIntent: 'reminder', failureCode: 'cancel_failed' },
          }
        }
      }

      // reschedule
      const when = parseReminderDateTime(input.text, { timeZone, now })
      if (!when.ok) {
        return {
          handled: true,
          reply: failureReply(when.code, language),
          diag: { reminderIntent: 'reminder', failureCode: when.code },
        }
      }
      try {
        const updated = await api.updateReminder(resolved.reminder.id, {
          fire_at: when.fireAtUtc,
          timezone: when.timezone,
        })
        const labels = {
          localDateLabel: when.localDate,
          localTimeLabel: when.localTime,
        }
        const nextList = ctx.reminders.map((r) =>
          r.id === updated.id
            ? {
                id: updated.id,
                title: updated.title,
                fireAt: updated.fireAt,
                timezone: updated.timezone,
                status: updated.status,
                ...labels,
              }
            : r,
        )
        const nextCtx = createRemindersContext({
          ...ctx,
          reminders: nextList,
          focusIndex: resolved.focusIndex,
        })
        saveRemindersContext(nextCtx, storage)
        return {
          handled: true,
          reply: `${reminderCopy('updated', language)} alle ${when.localTime}.`,
          remindersContext: nextCtx,
          diag: { reminderIntent: 'reminder', operation: 'update', persisted: true },
        }
      } catch {
        return {
          handled: true,
          reply: failureReply('update_failed', language),
          diag: { reminderIntent: 'reminder', failureCode: 'update_failed' },
        }
      }
    }

    return {
      handled: true,
      reply: failureReply(intent.failureCode || 'not_found', language),
      diag: { reminderIntent: 'reminder', failureCode: intent.failureCode || 'not_found' },
    }
  }

  // --- List ---
  if (intent.operation === 'list') {
    try {
      const all = await api.listUpcomingReminders()
      let items = toContextItems(all, timeZone)
      const queryType = intent.queryType || 'upcoming'
      if (queryType === 'today') items = filterToday(items, timeZone, now)
      if (queryType === 'next') items = items.slice(0, 1)
      const nextCtx = createRemindersContext({
        queryType,
        reminders: items,
        focusIndex: items.length ? 0 : -1,
        language,
      })
      saveRemindersContext(nextCtx, storage)
      return {
        handled: true,
        reply: renderReminderList(items, queryType, language),
        remindersContext: nextCtx,
        diag: {
          reminderIntent: 'reminder',
          operation: 'list',
          count: items.length,
          modelCalls: 0,
          terminatesLocally: true,
        },
      }
    } catch (err) {
      const code = err?.code === 'reminders_disabled' ? 'reminders_disabled' : 'list_failed'
      return {
        handled: true,
        reply: failureReply(code, language),
        diag: { reminderIntent: 'reminder', failureCode: code },
      }
    }
  }

  // --- Create (propose only) ---
  if (intent.operation === 'create') {
    if (intent.failureCode === 'unsupported_recurrence') {
      return {
        handled: true,
        reply: failureReply('unsupported_recurrence', language),
        diag: { reminderIntent: 'reminder', failureCode: 'unsupported_recurrence' },
      }
    }
    if (intent.failureCode) {
      return {
        handled: true,
        reply: failureReply(intent.failureCode, language),
        diag: { reminderIntent: 'reminder', failureCode: intent.failureCode },
      }
    }
    const title = (intent.title || '').trim()
    if (!title) {
      return {
        handled: true,
        reply: failureReply('missing_title', language),
        diag: { reminderIntent: 'reminder', failureCode: 'missing_title' },
      }
    }
    const when = intent.when
    if (!when?.ok) {
      return {
        handled: true,
        reply: failureReply(when?.code || 'ambiguous_time', language),
        diag: { reminderIntent: 'reminder', failureCode: when?.code || 'ambiguous_time' },
      }
    }
    const proposal = {
      title,
      body: null,
      fireAt: when.fireAtUtc,
      timezone: when.timezone,
      source: 'conversation',
      localDateLabel: when.localDate,
      localTimeLabel: when.localTime,
    }
    savePendingReminderProposal(proposal, storage)
    return {
      handled: true,
      reply: renderProposalText(proposal, language),
      reminderUi: buildProposalUi(),
      pendingProposal: proposal,
      diag: {
        reminderIntent: 'reminder',
        operation: 'propose',
        persisted: false,
        modelCalls: 0,
        terminatesLocally: true,
      },
    }
  }

  return {
    handled: true,
    reply: failureReply('invalid_time', language),
    diag: { reminderIntent: 'reminder', failureCode: 'invalid_time' },
  }
}

/** Confirm pending proposal from UI button (no new user turn text required). */
export async function confirmPendingReminderProposal(input = {}) {
  const storage =
    input.storage !== undefined
      ? input.storage
      : typeof sessionStorage !== 'undefined'
        ? sessionStorage
        : null
  const language = input.language === 'en' ? 'en' : 'it'
  const pending = loadPendingReminderProposal(storage)
  if (!pending) {
    return { ok: false, reply: failureReply('not_found', language) }
  }
  const api = input.api || (await defaultApi())
  try {
    const created = await api.createReminderFromProposal(pending)
    clearPendingReminderProposal(storage)
    const labels = localLabelsForFireAt(
      created.fireAt,
      created.timezone || input.timeZone || browserTimeZone(),
    )
    const pushHint = input.pushLikelyEnabled === false
    return {
      ok: true,
      reminder: created,
      reply: renderSavedText({ ...created, ...labels }, language, pushHint),
      offerPushOptIn: pushHint,
    }
  } catch (err) {
    const code = err?.code === 'reminders_disabled' ? 'reminders_disabled' : 'create_failed'
    return { ok: false, reply: failureReply(code, language) }
  }
}

export async function discardPendingReminderProposal(input = {}) {
  const storage =
    input.storage !== undefined
      ? input.storage
      : typeof sessionStorage !== 'undefined'
        ? sessionStorage
        : null
  clearPendingReminderProposal(storage)
  return {
    ok: true,
    reply: reminderCopy('discarded', input.language === 'en' ? 'en' : 'it'),
  }
}
