/**
 * #317 — Client Weather API helper (server-mediated Open-Meteo).
 * Browser never calls Open-Meteo directly with user tokens mixed in.
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
 * POST /api/weather — auth required. Coords sent transiently only.
 * @param {object} body
 */
export async function requestWeather(body) {
  const auth = await resolveChatAuthForRequest()
  if (!auth.authorization) {
    return {
      status: 'provider_error',
      failureCode: 'auth_required',
    }
  }

  const url = `${resolveBase()}/api/weather`
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
        operation: body.operation || 'current',
        language: body.language || 'it',
        timeHint: body.timeHint || null,
        ...(typeof body.latitude === 'number' ? { latitude: body.latitude } : {}),
        ...(typeof body.longitude === 'number' ? { longitude: body.longitude } : {}),
        ...(body.locationText ? { locationText: body.locationText } : {}),
        ...(body.timezone ? { timezone: body.timezone } : {}),
        forecastDays: 7,
      }),
    })
  } catch {
    return { status: 'offline', failureCode: 'network' }
  }

  let json = {}
  try {
    json = await res.json()
  } catch {
    json = {}
  }

  if (res.status === 429) {
    return {
      status: 'rate_limited',
      failureCode: 'rate_limited',
      requestId: typeof json.requestId === 'string' ? json.requestId : null,
    }
  }

  if (!res.ok && !json.status) {
    return {
      status: 'provider_error',
      failureCode: typeof json.code === 'string' ? json.code : 'http_error',
      requestId: typeof json.requestId === 'string' ? json.requestId : null,
    }
  }

  return {
    status: typeof json.status === 'string' ? json.status : 'provider_error',
    failureCode: json.failureCode || null,
    location: json.location || null,
    current: json.current || null,
    hourly: Array.isArray(json.hourly) ? json.hourly : [],
    daily: Array.isArray(json.daily) ? json.daily : [],
    geocodeCandidates: Array.isArray(json.geocodeCandidates) ? json.geocodeCandidates : null,
    provider: typeof json.provider === 'string' ? json.provider : 'open_meteo',
    providerRequestReached: Boolean(json.providerRequestReached),
    providerHttpStatus:
      typeof json.providerHttpStatus === 'number' ? json.providerHttpStatus : null,
    geocodeReached: Boolean(json.geocodeReached),
    requestId: typeof json.requestId === 'string' ? json.requestId : null,
    attribution: typeof json.attribution === 'string' ? json.attribution : 'Weather data: Open-Meteo',
  }
}
