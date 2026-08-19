/**
 * #315 — Browser/OS handoff helpers (injectable for tests).
 */

import { isAllowedHttpsUrl } from './destinations.js'

/**
 * @typedef {object} HandoffEnv
 * @property {(url: string, target?: string, features?: string) => Window|null} [open]
 * @property {{ href: string, assign?: (u: string) => void }} [location]
 * @property {{ share?: Function, canShare?: Function }} [navigator]
 * @property {(text: string) => Promise<boolean>} [copyText]
 * @property {(view: string) => void} [navigateApp]
 */

export function createDefaultHandoffEnv() {
  return {
    open: typeof window !== 'undefined' ? window.open.bind(window) : null,
    location: typeof window !== 'undefined' ? window.location : null,
    navigator: typeof navigator !== 'undefined' ? navigator : null,
    copyText: null,
    navigateApp: null,
  }
}

export function openHttps(url, env) {
  if (!isAllowedHttpsUrl(url)) {
    return { ok: false, failureCode: 'url_not_allowlisted' }
  }
  try {
    if (env.open) {
      const w = env.open(url, '_blank', 'noopener,noreferrer')
      // Popup blocked still counts as handoff attempted when we tried.
      return { ok: true, handoffAttempted: true, popupBlocked: !w }
    }
    if (env.location) {
      if (typeof env.location.assign === 'function') env.location.assign(url)
      else env.location.href = url
      return { ok: true, handoffAttempted: true }
    }
    return { ok: false, failureCode: 'no_navigation_api' }
  } catch {
    return { ok: false, failureCode: 'open_failed' }
  }
}

/** tel: / sms: / mailto: — prefer location assign for mobile gesture chain. */
export function openUriScheme(uri, env) {
  const s = String(uri || '')
  if (!/^(tel|sms|mailto):/i.test(s)) {
    return { ok: false, failureCode: 'scheme_blocked' }
  }
  if (/^(javascript|data|vbscript|file|intent):/i.test(s)) {
    return { ok: false, failureCode: 'scheme_blocked' }
  }
  try {
    if (env.location) {
      if (typeof env.location.assign === 'function') env.location.assign(s)
      else env.location.href = s
      return { ok: true, handoffAttempted: true }
    }
    if (env.open) {
      env.open(s, '_self')
      return { ok: true, handoffAttempted: true }
    }
    return { ok: false, failureCode: 'no_navigation_api' }
  } catch {
    return { ok: false, failureCode: 'open_failed' }
  }
}

export async function shareText(text, env) {
  const payload = { text: String(text || '').slice(0, 8000) }
  if (!payload.text.trim()) {
    return { ok: false, failureCode: 'empty', fallbackUsed: false }
  }
  const nav = env.navigator
  if (nav && typeof nav.share === 'function') {
    try {
      if (typeof nav.canShare === 'function' && !nav.canShare(payload)) {
        /* fall through to copy */
      } else {
        await nav.share(payload)
        return { ok: true, handoffAttempted: true, fallbackUsed: false }
      }
    } catch (err) {
      // User cancel is not a hard failure for UX; treat as attempted.
      if (err && (err.name === 'AbortError' || err.name === 'NotAllowedError')) {
        return { ok: true, handoffAttempted: true, cancelled: true, fallbackUsed: false }
      }
      /* fall through */
    }
  }
  if (typeof env.copyText === 'function') {
    const copied = await env.copyText(payload.text)
    return {
      ok: copied,
      handoffAttempted: false,
      fallbackUsed: true,
      failureCode: copied ? null : 'copy_failed',
    }
  }
  return { ok: false, failureCode: 'share_unavailable', fallbackUsed: false }
}
