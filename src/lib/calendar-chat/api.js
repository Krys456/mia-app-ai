/**
 * #336B — Client helper: calendar_query via existing /api/daily-briefing.
 */

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
 *   range?: string
 *   timeMin?: string
 *   timeMax?: string
 *   language?: 'it'|'en'
 *   limit?: number
 * }} body
 */
export async function requestCalendarQuery(body) {
  // Lazy import so Node unit tests can load controller without Vite TS resolution.
  const { resolveChatAuthForRequest } = await import('../chatAuth.ts')
  const auth = await resolveChatAuthForRequest()
  if (!auth.authorization) {
    return {
      status: 'disconnected',
      failureCode: 'auth_required',
      items: [],
      fetchedAt: new Date().toISOString(),
      timeZone: body.timeZone || null,
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
        action: 'calendar_query',
        timeZone: body.timeZone,
        range: body.range || undefined,
        timeMin: body.timeMin || undefined,
        timeMax: body.timeMax || undefined,
        language: body.language || 'it',
        limit: body.limit || 40,
      }),
    })
  } catch {
    return {
      status: 'error',
      failureCode: 'network',
      items: [],
      fetchedAt: new Date().toISOString(),
      timeZone: body.timeZone || null,
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
      items: [],
      fetchedAt: new Date().toISOString(),
      timeZone: body.timeZone || null,
    }
  }

  return json
}
