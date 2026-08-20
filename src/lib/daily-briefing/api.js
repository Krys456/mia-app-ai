/**
 * #321 — Client API helper for /api/daily-briefing.
 */

import { resolveChatAuthForRequest } from '../chatAuth'

function resolveBase() {
  try {
    const env = typeof import.meta !== 'undefined' ? import.meta.env : null
    const raw = env && typeof env.VITE_API_BASE_URL === 'string' ? env.VITE_API_BASE_URL.trim() : ''
    return raw.replace(/\/$/, '')
  } catch {
    return ''
  }
}

/**
 * @param {{
 *   timeZone: string
 *   target?: 'today'|'tomorrow'
 *   language?: 'it'|'en'
 * }} body
 */
export async function requestDailyBriefingPack(body) {
  const auth = await resolveChatAuthForRequest()
  if (!auth.authorization) {
    return {
      status: 'error',
      failureCode: 'auth_required',
      calendar: { status: 'unavailable', items: [] },
      reminders: { status: 'unavailable', overdue: [], today: [] },
    }
  }

  const url = `${resolveBase()}/api/daily-briefing`
  let res
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: auth.authorization,
      },
      body: JSON.stringify({
        timeZone: body.timeZone,
        target: body.target || 'today',
        language: body.language || 'it',
      }),
    })
  } catch {
    return {
      status: 'error',
      failureCode: 'network',
      calendar: { status: 'unavailable', items: [] },
      reminders: { status: 'unavailable', overdue: [], today: [] },
    }
  }

  let json = {}
  try {
    json = await res.json()
  } catch {
    json = {}
  }

  if (!res.ok && !json.status) {
    return {
      status: 'error',
      failureCode: typeof json.code === 'string' ? json.code : 'http_error',
      calendar: { status: 'error', items: [] },
      reminders: { status: 'error', overdue: [], today: [] },
    }
  }

  return json
}
