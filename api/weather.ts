/**
 * #317 /api/weather — authenticated Open-Meteo weather (no API key).
 * Never returns raw provider dumps or logs precise GPS.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { applyCors, sendCorsPreflight, sendJson } from '../lib/server/http.js'
import { requirePaidApiAccess } from '../lib/server/paid-api-guard.js'
import { ensureRequestContext } from '../lib/server/request-id.js'
import { runWeatherLookup, WEATHER_ATTRIBUTION } from '../lib/server/weather/index.js'

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
  if (v < -90 || v > 90) {
    // longitude check applied separately
  }
  return v
}

function queryFlag(req: VercelRequest, key: string): boolean {
  const raw = req.query[key]
  if (raw === '1' || raw === 'true') return true
  if (Array.isArray(raw) && (raw[0] === '1' || raw[0] === 'true')) return true
  return false
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

  const access = await requirePaidApiAccess(req, res, { bucket: 'weather' })
  if (!access) return

  let body: Record<string, unknown>
  try {
    body = parseBody(req)
  } catch {
    return sendJson(res, 400, { error: 'Invalid JSON body', code: 'invalid_body' }, req)
  }

  const locationText =
    typeof body.locationText === 'string' ? body.locationText.trim().slice(0, 120) : null
  const latitude = sanitizeCoord(body.latitude)
  const longitude = sanitizeCoord(body.longitude)
  // longitude range
  const lonOk = longitude == null || (longitude >= -180 && longitude <= 180)
  const latOk = latitude == null || (latitude >= -90 && latitude <= 90)
  if (!lonOk || !latOk) {
    return sendJson(
      res,
      400,
      {
        status: 'invalid_request',
        failureCode: 'invalid_coordinates',
        attribution: WEATHER_ATTRIBUTION,
        requestId: obs.requestId,
      },
      req,
    )
  }

  const language = body.language === 'en' ? 'en' : 'it'
  const timezone = typeof body.timezone === 'string' ? body.timezone.slice(0, 64) : null
  const operation = typeof body.operation === 'string' ? body.operation.slice(0, 40) : 'current'
  const timeHint = typeof body.timeHint === 'string' ? body.timeHint.slice(0, 40) : null
  const forecastDays =
    typeof body.forecastDays === 'number' && body.forecastDays >= 1 && body.forecastDays <= 7
      ? Math.floor(body.forecastDays)
      : 7

  const locationSource =
    latitude != null && longitude != null ? 'gps' : locationText ? 'explicit' : null

  // Privacy: never log exact coordinates
  console.info(
    '[weather-action]',
    JSON.stringify({
      route: 'weather-action',
      requestId: obs.requestId,
      operation,
      timeHint,
      locationSource,
      language,
    }),
  )

  const result = (await runWeatherLookup({
    locationText,
    latitude: latitude ?? null,
    longitude: longitude ?? null,
    timezone,
    language,
    forecastDays,
  })) as Record<string, unknown>

  const diagEnabled = queryFlag(req, 'weather_diag')
  const payload: Record<string, unknown> = {
    status: result.status,
    failureCode: result.failureCode ?? null,
    location: result.location ?? null,
    current: result.current ?? null,
    hourly: Array.isArray(result.hourly) ? result.hourly : [],
    daily: Array.isArray(result.daily) ? result.daily : [],
    provider: 'open_meteo',
    providerRequestReached: Boolean(result.providerRequestReached),
    providerHttpStatus: result.providerHttpStatus ?? null,
    geocodeReached: Boolean(result.geocodeReached),
    attribution: result.attribution || WEATHER_ATTRIBUTION,
    requestId: obs.requestId,
  }

  if (result.status === 'geocode_ambiguous' && Array.isArray(result.geocodeCandidates)) {
    payload.geocodeCandidates = (result.geocodeCandidates as Array<Record<string, unknown>>).map(
      (c) => ({
        name: c.name,
        country: c.country ?? null,
        admin1: c.admin1 ?? null,
        latitude: c.latitude,
        longitude: c.longitude,
        timezone: c.timezone,
      }),
    )
  }

  if (diagEnabled) {
    payload.diag = {
      route: 'weather-action',
      buildId: process.env.VITE_BUILD_ID || process.env.VERCEL_GIT_COMMIT_SHA || '317',
      requestId: obs.requestId,
      weatherIntent: 'weather',
      operation,
      timeHint,
      locationSource,
      geocodeReached: Boolean(result.geocodeReached),
      provider: 'open_meteo',
      providerRequestReached: Boolean(result.providerRequestReached),
      providerHttpStatus: result.providerHttpStatus ?? null,
      hourlyDataPresent: Boolean(result.hourlyDataPresent),
      dailyDataPresent: Boolean(result.dailyDataPresent),
      forecastDays,
      failureCode: result.failureCode ?? null,
    }
  }

  return sendJson(res, 200, payload, req)
}
