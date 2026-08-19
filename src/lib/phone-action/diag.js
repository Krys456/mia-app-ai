/**
 * #315 — Safe phone-action diagnostics (?phone_action_diag=1).
 */

export const PHONE_ACTION_DIAG_BUILD = '315-1'

export function isPhoneActionDiagEnabled(search) {
  try {
    const q =
      search != null
        ? String(search)
        : typeof window !== 'undefined'
          ? window.location.search
          : ''
    if (!q) return false
    const params = new URLSearchParams(q.startsWith('?') ? q.slice(1) : q)
    const v = params.get('phone_action_diag')
    return v === '1' || v === 'true'
  } catch {
    return false
  }
}

export function buildPhoneActionDiag(partial = {}) {
  let buildId = PHONE_ACTION_DIAG_BUILD
  try {
    if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_BUILD_ID) {
      buildId = import.meta.env.VITE_BUILD_ID
    }
  } catch {
    /* ignore */
  }
  let platform = 'unknown'
  try {
    if (typeof navigator !== 'undefined') {
      platform = navigator.userAgentData?.platform || navigator.platform || 'web'
    }
  } catch {
    /* ignore */
  }
  return {
    route: 'phone-action',
    diagBuild: PHONE_ACTION_DIAG_BUILD,
    buildId,
    actionId: partial.actionId || `pa_${Date.now().toString(36)}`,
    phoneActionIntent: partial.phoneActionIntent ?? null,
    action: partial.action ?? null,
    target: partial.target ?? null,
    safetyClass: partial.safetyClass ?? null,
    validationPassed: Boolean(partial.validationPassed),
    handoffAttempted: Boolean(partial.handoffAttempted),
    fallbackUsed: Boolean(partial.fallbackUsed),
    platform: String(platform).slice(0, 80),
    failureCode: partial.failureCode ?? null,
    maskedPhone: partial.maskedPhone ?? null,
    maskedEmail: partial.maskedEmail ?? null,
  }
}

export function rememberPhoneActionDiag(payload) {
  if (!payload || typeof payload !== 'object') return
  if (payload.route !== 'phone-action') return
  try {
    if (typeof console !== 'undefined' && console.info) {
      console.info('[phone-action-diag]', payload)
    }
    if (typeof window !== 'undefined') {
      window.__SHINKAIDO_PHONE_ACTION_DIAG__ = payload
    }
  } catch {
    /* ignore */
  }
}

export function logPhoneActionSafe(event) {
  try {
    if (typeof console !== 'undefined' && console.info) {
      console.info('[phone-action]', {
        route: 'phone-action',
        action: event.action ?? null,
        target: event.target ?? null,
        safetyClass: event.safetyClass ?? null,
        handoffAttempted: Boolean(event.handoffAttempted),
        failureCode: event.failureCode ?? null,
      })
    }
  } catch {
    /* ignore */
  }
}
