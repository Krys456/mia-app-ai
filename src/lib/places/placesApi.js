/**
 * #316 — Client Places API helper (server-mediated; never holds Places key).
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
 * POST /api/places — auth required. Coords sent transiently only.
 * @param {object} body
 */
export async function requestPlacesSearch(body) {
  const auth = await resolveChatAuthForRequest()
  if (!auth.authorization) {
    return {
      status: 'provider_error',
      failureCode: 'auth_required',
      places: [],
    }
  }

  const url = `${resolveBase()}/api/places`
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
        query: body.query,
        operation: body.operation,
        ...(typeof body.latitude === 'number' ? { latitude: body.latitude } : {}),
        ...(typeof body.longitude === 'number' ? { longitude: body.longitude } : {}),
        ...(body.explicitLocationText
          ? { explicitLocationText: body.explicitLocationText }
          : {}),
        openNowRequested: Boolean(body.openNowRequested),
        sort: body.sort || 'relevance',
        language: body.language || 'it',
      }),
    })
  } catch {
    return { status: 'offline', failureCode: 'network', places: [] }
  }

  let json = {}
  try {
    json = await res.json()
  } catch {
    json = {}
  }

  if (!res.ok && !json.status) {
    return {
      status: res.status === 503 ? 'disabled' : 'provider_error',
      failureCode: typeof json.code === 'string' ? json.code : 'http_error',
      places: [],
    }
  }

  return {
    status: typeof json.status === 'string' ? json.status : 'provider_error',
    failureCode: json.failureCode || null,
    places: Array.isArray(json.places) ? json.places : [],
    provider: typeof json.provider === 'string' ? json.provider : 'google_places',
    providerRequestReached: Boolean(json.providerRequestReached),
    providerHttpStatus:
      typeof json.providerHttpStatus === 'number' ? json.providerHttpStatus : null,
    distancesCalculated: Boolean(json.distancesCalculated),
    requestId: typeof json.requestId === 'string' ? json.requestId : null,
  }
}
