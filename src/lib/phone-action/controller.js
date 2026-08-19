/**
 * #315 — Apply Phone Action intents with real handoffs (sync for gesture chain).
 */

import { phoneCopy } from './copy.js'
import { buildMapsDirectionsUrl, getOpenAppTarget } from './destinations.js'
import {
  createDefaultHandoffEnv,
  openHttps,
  openUriScheme,
} from './handoff.js'
import { detectPhoneActionIntent } from './intent.js'
import {
  buildMailtoUri,
  buildSmsUri,
  buildTelUri,
  maskEmail,
  maskPhone,
} from './parse.js'
import { SAFETY } from './safety.js'

function emptyDiag(intent) {
  return {
    phoneActionIntent: intent.kind,
    action: null,
    target: intent.target || null,
    safetyClass: null,
    validationPassed: false,
    handoffAttempted: false,
    fallbackUsed: false,
    failureCode: intent.failureCode || null,
    maskedPhone: intent.phone ? maskPhone(intent.phone) : null,
    maskedEmail: intent.email ? maskEmail(intent.email) : null,
  }
}

function copyTextSync(text, env) {
  const t = String(text || '')
  if (!t) return false
  if (typeof env.copyTextSync === 'function') {
    try {
      return Boolean(env.copyTextSync(t))
    } catch {
      return false
    }
  }
  try {
    if (typeof document === 'undefined') return false
    const area = document.createElement('textarea')
    area.value = t
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(area)
    return ok
  } catch {
    return false
  }
}

/**
 * Synchronous apply — keeps open/share inside the user-gesture turn.
 */
export function applyPhoneAction(input) {
  const env = { ...createDefaultHandoffEnv(), ...(input.env || {}) }
  const intent = detectPhoneActionIntent(input.text, {
    languageHint: input.languageHint,
  })
  const lang = intent.language

  if (intent.kind === 'none') {
    return {
      handled: false,
      reply: null,
      action: null,
      target: null,
      safetyClass: null,
      navigateVision: false,
      diag: emptyDiag(intent),
    }
  }

  if (intent.kind === 'native_required') {
    const key = intent.target === 'alarm' ? 'native_alarm' : 'native_required'
    return {
      handled: true,
      reply: phoneCopy(key, lang),
      action: 'native_required',
      target: intent.target || null,
      safetyClass: SAFETY.NATIVE_REQUIRED,
      navigateVision: false,
      diag: {
        ...emptyDiag(intent),
        action: 'native_required',
        safetyClass: SAFETY.NATIVE_REQUIRED,
        validationPassed: true,
        failureCode: 'native_required',
      },
    }
  }

  if (intent.kind === 'call_needs_number') {
    return {
      handled: true,
      reply: phoneCopy('call_needs_number', lang),
      action: 'call',
      target: null,
      safetyClass: SAFETY.USER_HANDOFF,
      navigateVision: false,
      diag: {
        ...emptyDiag(intent),
        action: 'call',
        safetyClass: SAFETY.USER_HANDOFF,
        failureCode: 'contacts_unavailable',
      },
    }
  }

  if (intent.kind === 'sms_needs_number') {
    return {
      handled: true,
      reply: phoneCopy('sms_needs_number', lang),
      action: 'sms',
      target: null,
      safetyClass: SAFETY.USER_HANDOFF,
      navigateVision: false,
      diag: {
        ...emptyDiag(intent),
        action: 'sms',
        safetyClass: SAFETY.USER_HANDOFF,
        failureCode: 'phone_required',
      },
    }
  }

  if (intent.kind === 'email_needs_address') {
    return {
      handled: true,
      reply: phoneCopy('email_needs_address', lang),
      action: 'email',
      target: null,
      safetyClass: SAFETY.USER_HANDOFF,
      navigateVision: false,
      diag: {
        ...emptyDiag(intent),
        action: 'email',
        safetyClass: SAFETY.USER_HANDOFF,
        failureCode: 'email_required',
      },
    }
  }

  if (intent.kind === 'open_app') {
    const app = getOpenAppTarget(intent.target)
    if (!app) {
      return {
        handled: true,
        reply: phoneCopy('blocked', lang),
        action: 'open_app',
        target: intent.target,
        safetyClass: SAFETY.BLOCKED,
        navigateVision: false,
        diag: {
          ...emptyDiag(intent),
          action: 'open_app',
          safetyClass: SAFETY.BLOCKED,
          failureCode: 'unknown_target',
        },
      }
    }
    const hop = openHttps(app.url, env)
    const replyKey =
      intent.target === 'spotify'
        ? 'open_spotify'
        : intent.target === 'youtube'
          ? 'open_youtube'
          : 'open_maps'
    return {
      handled: true,
      reply: hop.ok ? phoneCopy(replyKey, lang) : phoneCopy('failed', lang),
      action: 'open_app',
      target: intent.target,
      safetyClass: SAFETY.LOW_RISK,
      navigateVision: false,
      diag: {
        ...emptyDiag(intent),
        action: 'open_app',
        target: intent.target,
        safetyClass: SAFETY.LOW_RISK,
        validationPassed: true,
        handoffAttempted: Boolean(hop.handoffAttempted),
        failureCode: hop.ok ? null : hop.failureCode,
      },
    }
  }

  if (intent.kind === 'navigate') {
    const url = buildMapsDirectionsUrl(intent.destination)
    if (!url) {
      return {
        handled: true,
        reply: phoneCopy('failed', lang),
        action: 'navigate',
        target: 'google_maps',
        safetyClass: SAFETY.USER_HANDOFF,
        navigateVision: false,
        diag: {
          ...emptyDiag(intent),
          action: 'navigate',
          safetyClass: SAFETY.USER_HANDOFF,
          failureCode: 'bad_destination',
        },
      }
    }
    const hop = openHttps(url, env)
    return {
      handled: true,
      reply: hop.ok
        ? phoneCopy('navigate', lang, { destination: intent.destination })
        : phoneCopy('failed', lang),
      action: 'navigate',
      target: 'google_maps',
      safetyClass: SAFETY.USER_HANDOFF,
      navigateVision: false,
      diag: {
        ...emptyDiag(intent),
        action: 'navigate',
        target: 'google_maps',
        safetyClass: SAFETY.USER_HANDOFF,
        validationPassed: true,
        handoffAttempted: Boolean(hop.handoffAttempted),
        failureCode: hop.ok ? null : hop.failureCode,
      },
    }
  }

  if (intent.kind === 'call') {
    const uri = buildTelUri(intent.phone)
    if (!uri) {
      return {
        handled: true,
        reply: phoneCopy('call_needs_number', lang),
        action: 'call',
        target: null,
        safetyClass: SAFETY.USER_HANDOFF,
        navigateVision: false,
        diag: {
          ...emptyDiag(intent),
          action: 'call',
          safetyClass: SAFETY.USER_HANDOFF,
          failureCode: 'bad_phone',
        },
      }
    }
    const hop = openUriScheme(uri, env)
    return {
      handled: true,
      reply: hop.ok
        ? phoneCopy('call', lang, { phone: intent.phone })
        : phoneCopy('failed', lang),
      action: 'call',
      target: null,
      safetyClass: SAFETY.USER_HANDOFF,
      navigateVision: false,
      diag: {
        ...emptyDiag(intent),
        action: 'call',
        safetyClass: SAFETY.USER_HANDOFF,
        validationPassed: true,
        handoffAttempted: Boolean(hop.handoffAttempted),
        failureCode: hop.ok ? null : hop.failureCode,
        maskedPhone: maskPhone(intent.phone),
      },
    }
  }

  if (intent.kind === 'sms') {
    const uri = buildSmsUri(intent.phone, intent.body)
    if (!uri) {
      return {
        handled: true,
        reply: phoneCopy('sms_needs_number', lang),
        action: 'sms',
        target: null,
        safetyClass: SAFETY.USER_HANDOFF,
        navigateVision: false,
        diag: {
          ...emptyDiag(intent),
          action: 'sms',
          safetyClass: SAFETY.USER_HANDOFF,
          failureCode: 'bad_phone',
        },
      }
    }
    const hop = openUriScheme(uri, env)
    return {
      handled: true,
      reply: hop.ok ? phoneCopy('sms', lang) : phoneCopy('failed', lang),
      action: 'sms',
      target: null,
      safetyClass: SAFETY.USER_HANDOFF,
      navigateVision: false,
      diag: {
        ...emptyDiag(intent),
        action: 'sms',
        safetyClass: SAFETY.USER_HANDOFF,
        validationPassed: true,
        handoffAttempted: Boolean(hop.handoffAttempted),
        failureCode: hop.ok ? null : hop.failureCode,
        maskedPhone: maskPhone(intent.phone),
      },
    }
  }

  if (intent.kind === 'email') {
    const uri = buildMailtoUri(intent.email, {
      subject: intent.subject,
      body: intent.body,
    })
    if (!uri) {
      return {
        handled: true,
        reply: phoneCopy('email_needs_address', lang),
        action: 'email',
        target: null,
        safetyClass: SAFETY.USER_HANDOFF,
        navigateVision: false,
        diag: {
          ...emptyDiag(intent),
          action: 'email',
          safetyClass: SAFETY.USER_HANDOFF,
          failureCode: 'bad_email',
        },
      }
    }
    const hop = openUriScheme(uri, env)
    return {
      handled: true,
      reply: hop.ok ? phoneCopy('email', lang) : phoneCopy('failed', lang),
      action: 'email',
      target: null,
      safetyClass: SAFETY.USER_HANDOFF,
      navigateVision: false,
      diag: {
        ...emptyDiag(intent),
        action: 'email',
        safetyClass: SAFETY.USER_HANDOFF,
        validationPassed: true,
        handoffAttempted: Boolean(hop.handoffAttempted),
        failureCode: hop.ok ? null : hop.failureCode,
        maskedEmail: maskEmail(intent.email),
      },
    }
  }

  if (intent.kind === 'share') {
    const text = String(input.lastAssistantText || '').trim()
    if (!text) {
      return {
        handled: true,
        reply: phoneCopy('share_empty', lang),
        action: 'share',
        target: null,
        safetyClass: SAFETY.LOW_RISK,
        navigateVision: false,
        diag: {
          ...emptyDiag(intent),
          action: 'share',
          safetyClass: SAFETY.LOW_RISK,
          failureCode: 'empty',
        },
      }
    }
    const nav = env.navigator
    if (nav && typeof nav.share === 'function') {
      try {
        const payload = { text: text.slice(0, 8000) }
        const ret = nav.share(payload)
        if (ret && typeof ret.catch === 'function') {
          ret.catch(() => {})
        }
        return {
          handled: true,
          reply: phoneCopy('share_ok', lang),
          action: 'share',
          target: null,
          safetyClass: SAFETY.LOW_RISK,
          navigateVision: false,
          diag: {
            ...emptyDiag(intent),
            action: 'share',
            safetyClass: SAFETY.LOW_RISK,
            validationPassed: true,
            handoffAttempted: true,
            failureCode: null,
          },
        }
      } catch {
        /* fallback copy */
      }
    }
    const copied = copyTextSync(text, env)
    return {
      handled: true,
      reply: copied ? phoneCopy('share_fallback_copy', lang) : phoneCopy('failed', lang),
      action: 'share',
      target: null,
      safetyClass: SAFETY.LOW_RISK,
      navigateVision: false,
      diag: {
        ...emptyDiag(intent),
        action: 'share',
        safetyClass: SAFETY.LOW_RISK,
        validationPassed: true,
        handoffAttempted: false,
        fallbackUsed: true,
        failureCode: copied ? null : 'share_unavailable',
      },
    }
  }

  if (intent.kind === 'copy') {
    const text = String(input.lastAssistantText || '').trim()
    if (!text) {
      return {
        handled: true,
        reply: phoneCopy('copy_empty', lang),
        action: 'copy',
        target: null,
        safetyClass: SAFETY.LOW_RISK,
        navigateVision: false,
        diag: {
          ...emptyDiag(intent),
          action: 'copy',
          safetyClass: SAFETY.LOW_RISK,
          failureCode: 'empty',
        },
      }
    }
    const ok = copyTextSync(text, env)
    return {
      handled: true,
      reply: ok ? phoneCopy('copy_ok', lang) : phoneCopy('copy_fail', lang),
      action: 'copy',
      target: null,
      safetyClass: SAFETY.LOW_RISK,
      navigateVision: false,
      diag: {
        ...emptyDiag(intent),
        action: 'copy',
        safetyClass: SAFETY.LOW_RISK,
        validationPassed: true,
        failureCode: ok ? null : 'copy_failed',
      },
    }
  }

  if (intent.kind === 'open_vision') {
    if (typeof env.navigateApp === 'function') {
      env.navigateApp('vision')
    }
    return {
      handled: true,
      reply: phoneCopy('vision', lang),
      action: 'open_vision',
      target: 'vision',
      safetyClass: SAFETY.LOW_RISK,
      navigateVision: true,
      diag: {
        ...emptyDiag(intent),
        action: 'open_vision',
        target: 'vision',
        safetyClass: SAFETY.LOW_RISK,
        validationPassed: true,
        handoffAttempted: true,
        failureCode: null,
      },
    }
  }

  return {
    handled: false,
    reply: null,
    action: null,
    target: null,
    safetyClass: null,
    navigateVision: false,
    diag: emptyDiag(intent),
  }
}

export { detectPhoneActionIntent }
