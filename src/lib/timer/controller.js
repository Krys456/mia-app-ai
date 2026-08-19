/**
 * #314 — Apply timer intents to active timer state.
 */

import {
  addTimeToTimer,
  cancelTimer,
  completeTimer,
  createRunningTimer,
  remainingMs,
} from './active-context.js'
import {
  alarmHonestMessage,
  timerAddedMessage,
  timerCancelledMessage,
  timerCompletedMessage,
  timerFailedMessage,
  timerNeedsDurationMessage,
  timerNoActiveMessage,
  timerRemainingMessage,
  timerReplaceDeclinedMessage,
  timerReplacePrompt,
  timerStartedMessage,
} from './copy.js'
import { detectTimerIntent } from './intent.js'
import { formatDurationLabel } from './duration.js'

function emptyDiag(intent, active) {
  return {
    timerIntent: intent.kind,
    timerAction: null,
    parsedDurationMs: intent.durationMs ?? intent.addMs ?? null,
    activeTimerFound: Boolean(active && active.status === 'running'),
    timerStarted: false,
    endsAt: active?.endsAt ?? null,
    remainingMs: active ? remainingMs(active) : null,
    timerCompleted: active?.status === 'completed',
    failureCode: intent.failureCode ?? null,
  }
}

export function applyTimerIntent(input) {
  const now = input.nowMs ?? Date.now()
  let active =
    input.activeTimer && input.activeTimer.status === 'running' ? input.activeTimer : null
  if (input.activeTimer?.status === 'running' && input.activeTimer.endsAt <= now) {
    active = null
  }

  const intent = detectTimerIntent(input.text, {
    hasActiveTimer: Boolean(active),
    hasPendingReplace: Boolean(input.pendingReplace),
    languageHint: input.languageHint,
  })

  if (intent.kind === 'none') {
    return {
      handled: false,
      reply: null,
      timer: input.activeTimer,
      pendingReplace: input.pendingReplace,
      diag: emptyDiag(intent, active),
    }
  }

  const lang = intent.language

  if (intent.kind === 'alarm_honest') {
    return {
      handled: true,
      reply: alarmHonestMessage(lang),
      timer: input.activeTimer,
      pendingReplace: null,
      diag: {
        ...emptyDiag(intent, active),
        timerAction: 'alarm_honest',
        failureCode: null,
      },
    }
  }

  if (intent.kind === 'confirm_replace' && input.pendingReplace) {
    const next = createRunningTimer({
      durationMs: input.pendingReplace.durationMs,
      label: input.pendingReplace.label || 'Timer',
      nowMs: now,
    })
    return {
      handled: true,
      reply: timerStartedMessage(next.durationMs, input.pendingReplace.language || lang),
      timer: next,
      pendingReplace: null,
      diag: {
        ...emptyDiag(intent, active),
        timerAction: 'replace_start',
        parsedDurationMs: next.durationMs,
        timerStarted: true,
        endsAt: next.endsAt,
        remainingMs: remainingMs(next, now),
        failureCode: null,
      },
    }
  }

  if (intent.kind === 'decline_replace') {
    return {
      handled: true,
      reply: timerReplaceDeclinedMessage(lang),
      timer: input.activeTimer,
      pendingReplace: null,
      diag: {
        ...emptyDiag(intent, active),
        timerAction: 'replace_declined',
        failureCode: null,
      },
    }
  }

  if (intent.kind === 'start') {
    if (intent.needsDuration || intent.durationMs == null) {
      return {
        handled: true,
        reply: timerNeedsDurationMessage(lang),
        timer: input.activeTimer,
        pendingReplace: input.pendingReplace,
        diag: {
          ...emptyDiag(intent, active),
          timerAction: 'start_needs_duration',
          failureCode: 'duration_unparsed',
        },
      }
    }
    if (active) {
      const pending = {
        durationMs: intent.durationMs,
        label: 'Timer',
        language: lang,
        createdAt: now,
      }
      return {
        handled: true,
        reply: timerReplacePrompt(remainingMs(active, now), intent.durationMs, lang),
        timer: input.activeTimer,
        pendingReplace: pending,
        diag: {
          ...emptyDiag(intent, active),
          timerAction: 'start_needs_confirm',
          parsedDurationMs: intent.durationMs,
          failureCode: 'timer_already_active',
        },
      }
    }
    const next = createRunningTimer({ durationMs: intent.durationMs, nowMs: now })
    return {
      handled: true,
      reply: timerStartedMessage(next.durationMs, lang),
      timer: next,
      pendingReplace: null,
      diag: {
        ...emptyDiag(intent, active),
        timerAction: 'start',
        parsedDurationMs: next.durationMs,
        timerStarted: true,
        endsAt: next.endsAt,
        remainingMs: remainingMs(next, now),
        activeTimerFound: true,
        failureCode: null,
      },
    }
  }

  if (intent.kind === 'status') {
    if (!active) {
      return {
        handled: true,
        reply: timerNoActiveMessage(lang),
        timer: input.activeTimer,
        pendingReplace: input.pendingReplace,
        diag: {
          ...emptyDiag(intent, active),
          timerAction: 'status',
          failureCode: 'no_active_timer',
        },
      }
    }
    return {
      handled: true,
      reply: timerRemainingMessage(active, lang, now),
      timer: input.activeTimer,
      pendingReplace: input.pendingReplace,
      diag: {
        ...emptyDiag(intent, active),
        timerAction: 'status',
        remainingMs: remainingMs(active, now),
        endsAt: active.endsAt,
        failureCode: null,
      },
    }
  }

  if (intent.kind === 'cancel') {
    if (!active) {
      return {
        handled: true,
        reply: timerNoActiveMessage(lang),
        timer: input.activeTimer,
        pendingReplace: null,
        diag: {
          ...emptyDiag(intent, active),
          timerAction: 'cancel',
          failureCode: 'no_active_timer',
        },
      }
    }
    const cancelled = cancelTimer(active, now)
    return {
      handled: true,
      reply: timerCancelledMessage(lang),
      timer: cancelled,
      pendingReplace: null,
      clearTimer: true,
      diag: {
        ...emptyDiag(intent, active),
        timerAction: 'cancel',
        remainingMs: 0,
        failureCode: null,
      },
    }
  }

  if (intent.kind === 'add') {
    if (!active || intent.addMs == null) {
      return {
        handled: true,
        reply: active ? timerFailedMessage(lang) : timerNoActiveMessage(lang),
        timer: input.activeTimer,
        pendingReplace: input.pendingReplace,
        diag: {
          ...emptyDiag(intent, active),
          timerAction: 'add',
          failureCode: active ? 'add_failed' : 'no_active_timer',
        },
      }
    }
    const next = addTimeToTimer(active, intent.addMs, now)
    if (!next) {
      return {
        handled: true,
        reply: timerFailedMessage(lang),
        timer: input.activeTimer,
        pendingReplace: input.pendingReplace,
        diag: {
          ...emptyDiag(intent, active),
          timerAction: 'add',
          failureCode: 'add_failed',
        },
      }
    }
    return {
      handled: true,
      reply: timerAddedMessage(intent.addMs, lang),
      timer: next,
      pendingReplace: input.pendingReplace,
      diag: {
        ...emptyDiag(intent, active),
        timerAction: 'add',
        parsedDurationMs: intent.addMs,
        endsAt: next.endsAt,
        remainingMs: remainingMs(next, now),
        activeTimerFound: true,
        failureCode: null,
      },
    }
  }

  return {
    handled: false,
    reply: null,
    timer: input.activeTimer,
    pendingReplace: input.pendingReplace,
    diag: emptyDiag(intent, active),
  }
}

export function expireRunningTimer(timer, lang, nowMs = Date.now()) {
  const done = completeTimer(timer, nowMs)
  return { timer: done, reply: timerCompletedMessage(lang) }
}

export { formatDurationLabel }
