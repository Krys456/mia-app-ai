/**
 * #355B — Apply Places chat intent (client orchestration).
 * Zero model calls. LOCAL_EXCHANGE path only. Always terminates locally
 * when intent === 'places' — never falls through to /api/chat.
 *
 * openNow is DEFERRED: this controller never filters/claims verified
 * opening hours. When the intent detected an "open now" cue, the query is
 * still a plain nearby_category search and the reply adds an honest
 * disclaimer instead of a fabricated status.
 */

import {
  createPlacesContext,
  focusIndexInContext,
  getFocusedPlace,
  isPlacesContextFresh,
  savePendingPlacesRequest,
  clearPendingPlacesRequest,
} from './active-context.js'
import { haversineMeters } from './haversine.js'
import { detectPlacesIntent, detectPlacesFollowUp } from './intent.js'
import { failureReply, placesCopy, renderFollowUp, renderPlacesList } from './render.js'
import { buildMapsDirectionsUrl } from '../phone-action/destinations.js'
import { openHttps, createDefaultHandoffEnv } from '../phone-action/handoff.js'

/** Fill a missing distanceMeters using origin coords (display-only; origin is discarded right after). */
function enrichDistance(place, latitude, longitude) {
  if (typeof place.distanceMeters === 'number') return place
  if (typeof latitude !== 'number' || typeof longitude !== 'number') return place
  const computed = haversineMeters(latitude, longitude, place.latitude, place.longitude)
  return computed === null ? place : { ...place, distanceMeters: computed }
}

function resolveFollowUp(intent, ctx, input, language) {
  if (!ctx) {
    return {
      handled: true,
      reply: placesCopy('no_active_places', language),
      placesContext: null,
      placesUi: null,
      status: 'no_context',
      diag: {
        placesIntent: 'places',
        operation: 'follow_up',
        failureCode: 'no_context',
        modelCalls: 0,
        terminatesLocally: true,
      },
    }
  }

  const kind = intent.followUpKind
  let nextCtx = ctx
  if (kind === 'select_index') {
    nextCtx = focusIndexInContext(ctx, intent.followUpIndex ?? 0) || ctx
  } else if (kind === 'select_next') {
    nextCtx = focusIndexInContext(ctx, (ctx.focusIndex ?? 0) + 1) || ctx
  }

  const place = getFocusedPlace(nextCtx)
  if (!place) {
    return {
      handled: true,
      reply: failureReply('empty', language),
      placesContext: null,
      placesUi: null,
      status: 'empty',
      diag: {
        placesIntent: 'places',
        operation: 'follow_up',
        failureCode: 'empty_context',
        modelCalls: 0,
        terminatesLocally: true,
      },
    }
  }

  if (kind === 'select_index' || kind === 'select_next') {
    return {
      handled: true,
      reply: renderFollowUp('select', place, language),
      placesContext: nextCtx,
      placesUi: null,
      status: 'ok',
      diag: {
        placesIntent: 'places',
        operation: 'follow_up',
        followUpKind: kind,
        modelCalls: 0,
        terminatesLocally: true,
      },
    }
  }

  if (kind === 'distance') {
    return {
      handled: true,
      reply: renderFollowUp('distance', place, language),
      placesContext: nextCtx,
      placesUi: null,
      status: 'ok',
      diag: { placesIntent: 'places', operation: 'follow_up', followUpKind: kind, modelCalls: 0, terminatesLocally: true },
    }
  }

  if (kind === 'where') {
    return {
      handled: true,
      reply: renderFollowUp('where', place, language),
      placesContext: nextCtx,
      placesUi: null,
      status: 'ok',
      diag: { placesIntent: 'places', operation: 'follow_up', followUpKind: kind, modelCalls: 0, terminatesLocally: true },
    }
  }

  if (kind === 'ask_open') {
    return {
      handled: true,
      reply: renderFollowUp('ask_open', place, language),
      placesContext: nextCtx,
      placesUi: null,
      status: 'ok',
      diag: {
        placesIntent: 'places',
        operation: 'follow_up',
        followUpKind: kind,
        failureCode: 'open_now_deferred',
        modelCalls: 0,
        terminatesLocally: true,
      },
    }
  }

  if (kind === 'navigate' || kind === 'open_maps') {
    if (typeof place.latitude !== 'number' || typeof place.longitude !== 'number') {
      return {
        handled: true,
        reply: placesCopy('maps_failed', language),
        placesContext: nextCtx,
        placesUi: null,
        mapsUrl: null,
        status: 'error',
        diag: {
          placesIntent: 'places',
          operation: 'follow_up',
          followUpKind: kind,
          failureCode: 'bad_destination',
          modelCalls: 0,
          terminatesLocally: true,
        },
      }
    }
    // Reuse the phone-action Maps-directions builder — lat,lng is a valid
    // Google Maps destination string, no address geocoding required.
    const url = buildMapsDirectionsUrl(`${place.latitude},${place.longitude}`)
    const env = { ...createDefaultHandoffEnv(), ...(input.env || {}) }
    const hop = url ? openHttps(url, env) : { ok: false, failureCode: 'bad_destination' }
    return {
      handled: true,
      reply: hop.ok ? renderFollowUp('navigate', place, language) : placesCopy('maps_failed', language),
      placesContext: nextCtx,
      placesUi: null,
      status: hop.ok ? 'ok' : 'error',
      mapsUrl: hop.ok ? url : null,
      diag: {
        placesIntent: 'places',
        operation: 'follow_up',
        followUpKind: kind,
        mapsHandoffAttempted: true,
        failureCode: hop.ok ? null : hop.failureCode,
        modelCalls: 0,
        terminatesLocally: true,
      },
    }
  }

  return {
    handled: true,
    reply: failureReply('error', language),
    placesContext: nextCtx,
    placesUi: null,
    status: 'error',
    diag: { placesIntent: 'places', operation: 'follow_up', modelCalls: 0, terminatesLocally: true },
  }
}

/**
 * @param {{
 *   text: string
 *   languageHint?: 'it'|'en'
 *   placesContext?: object|null
 *   latitude?: number
 *   longitude?: number
 *   maxResults?: number
 *   radiusMeters?: number
 *   env?: object
 *   requestFn?: typeof import('./api.js').requestPlacesQuery
 * }} input
 */
export async function applyPlacesIntent(input) {
  const langHint = input.languageHint === 'en' ? 'en' : 'it'
  const ctx = isPlacesContextFresh(input.placesContext) ? input.placesContext : null
  const intent = detectPlacesIntent(input.text, {
    languageHint: langHint,
    hasPlacesContext: Boolean(ctx),
  })

  if (intent.intent !== 'places') {
    // The phrase itself is shaped like a Places follow-up (e.g. "il primo",
    // "quanto dista?") but there is no fresh context — either it never
    // existed or it expired (TTL). Rather than silently falling through to
    // another module (which could hallucinate a list that was never
    // fetched), answer honestly that there is no active search.
    if (!ctx && detectPlacesFollowUp(input.text, { hasPlacesContext: true })) {
      return resolveFollowUp({ operation: 'follow_up', followUpKind: null }, null, input, langHint)
    }
    return {
      handled: false,
      reply: null,
      placesContext: null,
      placesUi: null,
      diag: { placesIntent: 'none', failureCode: intent.failureCode || null },
    }
  }

  const language = intent.language || langHint

  if (intent.operation === 'follow_up') {
    return resolveFollowUp(intent, ctx, input, language)
  }

  const hasCoords =
    typeof input.latitude === 'number' &&
    typeof input.longitude === 'number' &&
    Number.isFinite(input.latitude) &&
    Number.isFinite(input.longitude)

  if (!hasCoords) {
    savePendingPlacesRequest({
      text: String(input.text || '').slice(0, 300),
      operation: intent.operation,
      category: intent.category || null,
      categoryLabel: intent.categoryLabel || null,
      textQuery: intent.textQuery || null,
      openNowRequested: Boolean(intent.openNowRequested),
      language,
    })
    return {
      handled: true,
      needsLocation: true,
      pendingIntent: intent,
      reply: placesCopy('location_required', language),
      placesUi: {
        kind: 'location_permission',
        actions: [{ id: 'use_location', label: placesCopy('use_location_btn', language) }],
      },
      placesContext: ctx,
      status: 'location_required',
      diag: {
        placesIntent: 'places',
        operation: intent.operation,
        failureCode: 'location_required',
        modelCalls: 0,
        terminatesLocally: true,
      },
    }
  }

  const requestFn =
    typeof input.requestFn === 'function' ? input.requestFn : (await import('./api.js')).requestPlacesQuery
  const pack = await requestFn({
    // Edge Function contract (supabase/functions/places-query): 'category'
    // must be the Italian word from its CATEGORY_TYPE_MAP (e.g. "farmacia"),
    // never the English provider type slug.
    queryType: intent.operation === 'named' ? 'named_place' : 'nearby_category',
    category: intent.categoryLabel || undefined,
    textQuery: intent.textQuery || undefined,
    latitude: input.latitude,
    longitude: input.longitude,
    language,
    maxResults: input.maxResults || 5,
    radiusMeters: input.radiusMeters || 3000,
  })

  clearPendingPlacesRequest()

  const status = typeof pack?.status === 'string' ? pack.status : 'error'
  const rawPlaces = Array.isArray(pack?.places) ? pack.places : []

  if (status !== 'ok' && status !== 'empty') {
    return {
      handled: true,
      reply: failureReply(status, language),
      placesContext: null,
      placesUi: null,
      status,
      diag: {
        placesIntent: 'places',
        operation: intent.operation,
        failureCode: pack?.code || status,
        modelCalls: 0,
        terminatesLocally: true,
      },
    }
  }

  if (!rawPlaces.length) {
    return {
      handled: true,
      reply: failureReply('empty', language),
      placesContext: null,
      placesUi: null,
      status: 'empty',
      diag: {
        placesIntent: 'places',
        operation: intent.operation,
        failureCode: 'empty',
        modelCalls: 0,
        terminatesLocally: true,
      },
    }
  }

  const places = rawPlaces
    .slice(0, input.maxResults || 5)
    .map((p) => enrichDistance(p, input.latitude, input.longitude))

  const placesContext = createPlacesContext({
    queryType: intent.operation,
    places,
    focusIndex: 0,
    status: 'ok',
    language,
    fetchedAt: pack.fetchedAt,
  })

  const reply = renderPlacesList(places, language, {
    category: intent.categoryLabel || intent.category || null,
    textQuery: intent.textQuery || null,
    openNowRequested: Boolean(intent.openNowRequested),
  })

  return {
    handled: true,
    reply,
    placesContext,
    status: 'ok',
    placesUi: {
      kind: 'results',
      chip:
        language === 'en'
          ? `${places.length} ${places.length === 1 ? 'result' : 'results'}`
          : `${places.length} ${places.length === 1 ? 'risultato' : 'risultati'}`,
      actions: [
        { id: 'navigate', label: placesCopy('take_me_btn', language) },
        { id: 'maps', label: placesCopy('maps_btn', language) },
      ],
    },
    diag: {
      placesIntent: 'places',
      operation: intent.operation,
      resultCount: places.length,
      openNowRequested: Boolean(intent.openNowRequested),
      modelCalls: 0,
      terminatesLocally: true,
    },
  }
}

export { loadPendingPlacesRequest } from './active-context.js'
export { PLACES_USE_LOCATION_TRIGGER } from './intent.js'
