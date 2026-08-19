/**
 * #317 — Apply Weather intents (client orchestration).
 */

import {
  clearPendingWeatherRequest,
  createWeatherContext,
  isWeatherContextFresh,
  loadPendingWeatherRequest,
  savePendingWeatherRequest,
} from './active-context.js'
import {
  buildDeterministicWeatherReply,
  buildWeatherCardModel,
  buildWeatherContextBlock,
} from './answers.js'
import { getCachedWeatherForOperation, saveWeatherCacheEntry } from './cache.js'
import { geoFailureCopy, weatherCopy } from './copy.js'
import {
  detectWeatherIntent,
  WEATHER_ENTER_AREA_TRIGGER,
  WEATHER_USE_LOCATION_TRIGGER,
} from './intent.js'

/**
 * Sync path: location-required, enter-area, cache hit follow-ups.
 * Async provider fetch is done by ChatContext via requestWeather.
 */
export function applyWeatherFollowUp(input) {
  const lang = input.languageHint === 'en' ? 'en' : 'it'
  const ctx = isWeatherContextFresh(input.weatherContext) ? input.weatherContext : null
  const intent = detectWeatherIntent(input.text, {
    languageHint: lang,
    hasWeatherContext: Boolean(ctx),
    stickyTimeHint: ctx?.lastTimeHint || null,
  })

  if (intent.intent !== 'weather') {
    return { handled: false, reply: null, diag: { weatherIntent: 'none' } }
  }

  if (
    intent.followUpKind === 'prompt_area' ||
    String(input.text).trim() === WEATHER_ENTER_AREA_TRIGGER
  ) {
    return {
      handled: true,
      reply: weatherCopy('enter_area', intent.language || lang),
      status: 'location_required',
      weatherUi: null,
      weatherContext: ctx,
      diag: {
        weatherIntent: 'weather',
        operation: 'follow_up',
        failureCode: 'prompt_area',
        status: 'location_required',
      },
    }
  }

  // Follow-up with fresh context / cache — may answer without network
  if (intent.followUp && ctx?.forecastSnapshot) {
    const weather = ctx.forecastSnapshot
    const reply = buildDeterministicWeatherReply(weather, {
      operation: intent.operation,
      timeHint: intent.timeHint,
      language: intent.language || lang,
    })
    const card = buildWeatherCardModel(weather)
    return {
      handled: true,
      reply,
      status: 'ok',
      weather,
      weatherUi: card
        ? { kind: 'card', card, attribution: weatherCopy('attribution', lang) }
        : null,
      weatherContext: {
        ...ctx,
        lastOperation: intent.operation,
        lastTimeHint: intent.timeHint,
      },
      cacheHit: true,
      diag: {
        weatherIntent: 'weather',
        operation: intent.operation,
        timeHint: intent.timeHint,
        locationSource: 'context',
        cacheHit: true,
        status: 'ok',
      },
    }
  }

  // New request needing GPS — permission UI (no silent prompt)
  if (intent.requiresCurrentLocation && !input.latitude && !input.longitude && !intent.locationText) {
    // If we still have context location, reuse without GPS
    if (ctx?.forecastSnapshot) {
      const weather = ctx.forecastSnapshot
      const reply = buildDeterministicWeatherReply(weather, {
        operation: intent.operation,
        timeHint: intent.timeHint,
        language: intent.language || lang,
      })
      const card = buildWeatherCardModel(weather)
      return {
        handled: true,
        reply,
        status: 'ok',
        weather,
        weatherUi: card
          ? { kind: 'card', card, attribution: weatherCopy('attribution', lang) }
          : null,
        weatherContext: {
          ...ctx,
          lastOperation: intent.operation,
          lastTimeHint: intent.timeHint,
        },
        cacheHit: true,
        locationSource: 'context',
        diag: {
          weatherIntent: 'weather',
          operation: intent.operation,
          locationSource: 'context',
          cacheHit: true,
          status: 'ok',
        },
      }
    }

    savePendingWeatherRequest({
      operation: intent.operation,
      timeHint: intent.timeHint,
      language: intent.language || lang,
      complexAdvice: Boolean(intent.complexAdvice),
    })
    return {
      handled: true,
      reply: weatherCopy('location_required', intent.language || lang),
      status: 'location_required',
      weatherUi: {
        kind: 'location_permission',
        actions: [
          { id: 'use_location', label: weatherCopy('use_location_btn', intent.language || lang) },
          { id: 'enter_area', label: weatherCopy('enter_area_btn', intent.language || lang) },
        ],
      },
      weatherContext: ctx,
      pendingSaved: true,
      intent,
      diag: {
        weatherIntent: 'weather',
        operation: intent.operation,
        locationPermissionRequested: true,
        status: 'location_required',
        failureCode: 'location_required',
      },
    }
  }

  // Try client cache before signaling provider
  if (intent.locationText || (input.latitude != null && input.longitude != null)) {
    const cached = getCachedWeatherForOperation(
      {
        locationText: intent.locationText,
        latitude: input.latitude,
        longitude: input.longitude,
      },
      intent.operation,
    )
    if (cached.hit && cached.weather) {
      const reply = buildDeterministicWeatherReply(cached.weather, {
        operation: intent.operation,
        timeHint: intent.timeHint,
        language: intent.language || lang,
      })
      const card = buildWeatherCardModel(cached.weather)
      const nextCtx = createWeatherContext({
        locationLabel: cached.weather.location?.name,
        country: cached.weather.location?.country,
        timezone: cached.weather.location?.timezone,
        latitude: input.latitude,
        longitude: input.longitude,
        locationSource: intent.locationText ? 'explicit' : 'gps',
        forecastSnapshot: cached.weather,
        lastOperation: intent.operation,
        lastTimeHint: intent.timeHint,
        language: intent.language || lang,
      })
      return {
        handled: true,
        reply,
        status: 'ok',
        weather: cached.weather,
        weatherUi: card
          ? { kind: 'card', card, attribution: weatherCopy('attribution', lang) }
          : null,
        weatherContext: nextCtx,
        cacheHit: true,
        diag: {
          weatherIntent: 'weather',
          operation: intent.operation,
          locationSource: intent.locationText ? 'explicit' : 'gps',
          cacheHit: true,
          status: 'ok',
        },
      }
    }
  }

  return {
    handled: true,
    needsProvider: true,
    intent,
    reply: null,
    weatherContext: ctx,
    diag: {
      weatherIntent: 'weather',
      operation: intent.operation,
      timeHint: intent.timeHint,
      locationSource: intent.locationText ? 'explicit' : input.latitude != null ? 'gps' : null,
      status: 'pending_provider',
    },
  }
}

/**
 * Build success exchange after /api/weather returns ok.
 */
export function buildWeatherSuccessExchange(input) {
  const lang = input.language === 'en' ? 'en' : 'it'
  const weather = input.weather
  if (!weather || weather.status !== 'ok') {
    return {
      reply: weatherCopy(mapStatusToCopyKey(weather?.status), lang),
      status: weather?.status || 'provider_error',
      weatherUi: null,
      weatherContext: null,
    }
  }

  saveWeatherCacheEntry(
    {
      locationText: input.locationText,
      latitude: input.latitude,
      longitude: input.longitude,
    },
    weather,
  )

  const operation = input.operation || 'current'
  const timeHint = input.timeHint || null
  let reply = buildDeterministicWeatherReply(weather, {
    operation,
    timeHint,
    language: lang,
  })

  // Complex advice: append grounded context note (ChatContext may also pass to Core later)
  if (input.complexAdvice) {
    const block = buildWeatherContextBlock(weather, { operation, timeHint })
    reply = `${reply}\n\n(${lang === 'en' ? 'Advice grounded in forecast above' : 'Consiglio basato sulle previsioni sopra'} — non invento altri valori.)`
    // Keep block available for optional Core; not shown raw to user by default
    void block
  }

  const card = buildWeatherCardModel(weather)
  const weatherContext = createWeatherContext({
    locationLabel: weather.location?.name,
    country: weather.location?.country,
    timezone: weather.location?.timezone,
    latitude: input.latitude,
    longitude: input.longitude,
    locationSource: input.locationSource || (input.locationText ? 'explicit' : 'gps'),
    forecastSnapshot: weather,
    lastOperation: operation,
    lastTimeHint: timeHint,
    language: lang,
  })

  return {
    reply,
    status: 'ok',
    weather,
    weatherUi: card
      ? {
          kind: 'card',
          card,
          attribution: weather.attribution || weatherCopy('attribution', lang),
        }
      : {
          kind: 'attribution',
          attribution: weather.attribution || weatherCopy('attribution', lang),
        },
    weatherContext,
    activeWeatherContextCreated: Boolean(weatherContext),
  }
}

export function mapStatusToCopyKey(status) {
  if (status === 'location_required') return 'location_required'
  if (status === 'location_denied') return 'location_denied'
  if (status === 'location_unavailable') return 'location_unavailable'
  if (status === 'geocode_empty') return 'geocode_empty'
  if (status === 'geocode_ambiguous') return 'geocode_ambiguous'
  if (status === 'rate_limited') return 'rate_limited'
  if (status === 'offline') return 'offline'
  if (status === 'invalid_request') return 'invalid_request'
  return 'provider_error'
}

export { geoFailureCopy, weatherCopy, WEATHER_USE_LOCATION_TRIGGER, WEATHER_ENTER_AREA_TRIGGER }

export function resumePendingAfterGeo(lang = 'it') {
  return loadPendingWeatherRequest()
}

export function clearWeatherPending() {
  clearPendingWeatherRequest()
}
