/**
 * #314 — Safe timer diagnostics (?timer_diag=1).
 */

export const TIMER_DIAG_BUILD = '314-1'

export function isTimerDiagClientEnabled(search) {
  try {
    const q =
      search != null
        ? String(search)
        : typeof window !== 'undefined'
          ? window.location.search
          : ''
    if (!q) return false
    const params = new URLSearchParams(q.startsWith('?') ? q.slice(1) : q)
    const v = params.get('timer_diag')
    return v === '1' || v === 'true'
  } catch {
    return false
  }
}

export function buildTimerDiag(partial = {}) {
  let buildId = TIMER_DIAG_BUILD
  try {
    if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_BUILD_ID) {
      buildId = import.meta.env.VITE_BUILD_ID
    }
  } catch {
    /* ignore */
  }
  return {
    route: 'timer-action',
    diagBuild: TIMER_DIAG_BUILD,
    buildId,
    requestId: partial.requestId || `timer_${Date.now().toString(36)}`,
    timerIntent: partial.timerIntent ?? null,
    timerAction: partial.timerAction ?? null,
    parsedDurationMs: partial.parsedDurationMs ?? null,
    activeTimerFound: Boolean(partial.activeTimerFound),
    timerStarted: Boolean(partial.timerStarted),
    endsAt: partial.endsAt ?? null,
    remainingMs: partial.remainingMs ?? null,
    timerCompleted: Boolean(partial.timerCompleted),
    completionSoundAttempted: Boolean(partial.completionSoundAttempted),
    notificationAttempted: Boolean(partial.notificationAttempted),
    failureCode: partial.failureCode ?? null,
  }
}

export function rememberTimerDiag(payload) {
  if (!payload || typeof payload !== 'object') return
  if (payload.route !== 'timer-action') return
  try {
    if (typeof console !== 'undefined' && console.info) {
      console.info('[timer-diag]', payload)
    }
    if (typeof window !== 'undefined') {
      window.__SHINKAIDO_TIMER_DIAG__ = payload
    }
  } catch {
    /* ignore */
  }
}

export function logTimerSafe(event) {
  try {
    if (typeof console !== 'undefined' && console.info) {
      console.info('[timer-action]', {
        route: 'timer-action',
        action: event.action,
        durationMs: event.durationMs ?? null,
        remainingMs: event.remainingMs ?? null,
        requestId: event.requestId ?? null,
        status: event.status ?? null,
      })
    }
  } catch {
    /* ignore */
  }
}
