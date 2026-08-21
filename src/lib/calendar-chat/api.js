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
 * Map HTTP / auth failures to Calendar safe statuses (never invent events).
 * @param {{ status: number }} res
 * @param {Record<string, unknown>} json
 * @param {string | null} timeZone
 */
export function mapCalendarQueryResponse(res, json, timeZone) {
  const fetchedAt = new Date().toISOString()
  if (json && typeof json.status === 'string') {
    return {
      status: json.status,
      items: Array.isArray(json.items) ? json.items : [],
      fetchedAt: typeof json.fetchedAt === 'string' ? json.fetchedAt : fetchedAt,
      timeZone: json.timeZone || timeZone,
      failureCode: typeof json.failureCode === 'string' ? json.failureCode : undefined,
      code: typeof json.code === 'string' ? json.code : undefined,
    }
  }

  const code = typeof json?.code === 'string' ? json.code : ''
  if (
    res.status === 401 ||
    res.status === 403 ||
    code === 'unauthorized' ||
    code === 'auth_required' ||
    code === 'auth_unavailable'
  ) {
    return {
      status: 'disconnected',
      failureCode: code || 'auth_required',
      items: [],
      fetchedAt,
      timeZone,
    }
  }
  if (res.status === 404 || code === 'calendar_disabled') {
    return {
      status: 'disabled',
      failureCode: code || 'calendar_disabled',
      items: [],
      fetchedAt,
      timeZone,
    }
  }
  if (res.status === 429 || code === 'rate_limit_exceeded') {
    return {
      status: 'timeout',
      failureCode: code || 'rate_limit_exceeded',
      items: [],
      fetchedAt,
      timeZone,
    }
  }
  if (res.status === 503 || code === 'rate_limit_unavailable') {
    return {
      status: 'timeout',
      failureCode: code || 'rate_limit_unavailable',
      items: [],
      fetchedAt,
      timeZone,
    }
  }

  return {
    status: 'error',
    failureCode: code || (res.ok ? 'invalid_pack' : 'http_error'),
    items: [],
    fetchedAt,
    timeZone,
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

  return mapCalendarQueryResponse(res, json, body.timeZone || null)
}
