/**
 * #316 /api/places — structured Places lookup (Google Places server-side).
 * Never returns API keys or exact logs of coordinates.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { applyCors, sendCorsPreflight, sendJson } from '../lib/server/http.js'
import { requirePaidApiAccess } from '../lib/server/paid-api-guard.js'
import { ensureRequestContext } from '../lib/server/request-id.js'
import { runPlacesSearch } from '../lib/server/places/index.js'

export const config = {
  runtime: 'nodejs',
  maxDuration: 30,
}

function parseBody(req: VercelRequest): Record<string, unknown> {
  if (req.body == null) return {}
  if (typeof req.body === 'string') {
    const trimmed = req.body.trim()
    if (!trimmed) return {}
    return JSON.parse(trimmed) as Record<string, unknown>
  }
  if (typeof req.body === 'object') return req.body as Record<string, unknown>
  return {}
}

function sanitizeCoord(n: unknown): number | undefined {
  const v = typeof n === 'number' ? n : typeof n === 'string' ? Number(n) : NaN
  if (!Number.isFinite(v)) return undefined
  return v
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(res, req)
  const obs = ensureRequestContext(req as any, res)

  if (req.method === 'OPTIONS') {
    return sendCorsPreflight(res, req)
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS')
    return sendJson(res, 405, { error: 'Method not allowed', code: 'method_not_allowed' }, req)
  }

  const access = await requirePaidApiAccess(req, res, { bucket: 'places' })
  if (!access) return

  let body: Record<string, unknown>
  try {
    body = parseBody(req)
  } catch {
    return sendJson(res, 400, { error: 'Invalid JSON body', code: 'invalid_body' }, req)
  }

  const query = typeof body.query === 'string' ? body.query.trim().slice(0, 200) : ''
  const operation = body.operation === 'nearby' ? 'nearby' : 'text_search'
  const explicitLocationText =
    typeof body.explicitLocationText === 'string'
      ? body.explicitLocationText.trim().slice(0, 200)
      : null
  const latitude = sanitizeCoord(body.latitude)
  const longitude = sanitizeCoord(body.longitude)
  const openNowRequested = body.openNowRequested === true
  const sort = body.sort === 'nearest' ? 'nearest' : 'relevance'

  if (!query) {
    return sendJson(
      res,
      400,
      {
        status: 'invalid_query',
        failureCode: 'empty_query',
        places: [],
        requestId: obs.requestId,
      },
      req,
    )
  }

  if (operation === 'nearby' && (latitude == null || longitude == null) && !explicitLocationText) {
    return sendJson(
      res,
      400,
      {
        status: 'location_required',
        failureCode: 'location_required',
        places: [],
        requestId: obs.requestId,
      },
      req,
    )
  }

  // Privacy: never log exact coordinates
  console.info(
    '[places-action]',
    JSON.stringify({
      route: 'places-action',
      requestId: obs.requestId,
      operation,
      locationProvided: latitude != null && longitude != null,
      explicitLocationProvided: Boolean(explicitLocationText),
      openNowRequested,
    }),
  )

  const result = await runPlacesSearch({
    operation: explicitLocationText ? 'text_search' : operation,
    query,
    latitude,
    longitude,
    explicitLocationText,
    openNowRequested,
    sort: operation === 'nearby' ? 'nearest' : sort,
  })

  return sendJson(
    res,
    200,
    {
      status: result.status,
      failureCode: result.failureCode ?? null,
      places: result.places || [],
      provider: result.provider || 'google_places',
      providerRequestReached: Boolean(result.providerRequestReached),
      providerHttpStatus: result.providerHttpStatus ?? null,
      distancesCalculated: Boolean(result.distancesCalculated),
      requestId: obs.requestId,
    },
    req,
  )
}
