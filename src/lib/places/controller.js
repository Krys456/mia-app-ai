/**
 * #316 — Apply Places intents (client orchestration).
 */

import {
  createPlacesContext,
  getSelectedPlace,
  isPlacesContextFresh,
  loadPendingPlacesRequest,
  savePendingPlacesRequest,
  clearPendingPlacesRequest,
  selectNearestInContext,
  selectPlaceInContext,
} from './active-context.js'
import { formatPlacesResultsReply, placesCopy } from './copy.js'
import {
  detectPlacesIntent,
  PLACES_ENTER_AREA_TRIGGER,
  PLACES_USE_LOCATION_TRIGGER,
} from './intent.js'
import { buildMapsDirectionsUrl } from '../phone-action/destinations.js'
import { openHttps, createDefaultHandoffEnv } from '../phone-action/handoff.js'

/**
 * Synchronous follow-up / location-required handling (no network).
 * Async search is done by ChatContext via requestPlacesSearch.
 */
export function applyPlacesFollowUp(input) {
  const lang = input.languageHint === 'en' ? 'en' : 'it'
  const ctx = isPlacesContextFresh(input.placesContext) ? input.placesContext : null
  const intent = detectPlacesIntent(input.text, {
    languageHint: lang,
    hasPlacesContext: Boolean(ctx),
  })

  if (intent.intent !== 'places') {
    return { handled: false, reply: null, diag: { placesIntent: 'none' } }
  }

  // Chip: enter area
  if (
    intent.followUpKind === 'prompt_area' ||
    String(input.text).trim() === PLACES_ENTER_AREA_TRIGGER
  ) {
    return {
      handled: true,
      reply: placesCopy('enter_area', intent.language || lang),
      status: 'location_required',
      placesUi: null,
      placesContext: ctx,
      diag: {
        placesIntent: 'places',
        operation: 'follow_up',
        failureCode: 'prompt_area',
        status: 'location_required',
      },
    }
  }

  if (intent.operation === 'follow_up' && ctx) {
    return resolveFollowUp(intent, ctx, input)
  }

  if (intent.operation === 'follow_up' && !ctx) {
    // Portami lì without context — do not invent navigation
    if (intent.followUpKind === 'navigate' || intent.followUpKind === 'open_maps') {
      return {
        handled: true,
        reply: placesCopy('navigate_need_place', intent.language || lang),
        status: 'invalid_query',
        placesContext: null,
        diag: {
          placesIntent: 'places',
          operation: 'follow_up',
          failureCode: 'no_active_places',
          status: 'invalid_query',
        },
      }
    }
    return { handled: false, reply: null, diag: { placesIntent: 'none' } }
  }

  // New search needing GPS — ask for permission UI (no fake results)
  if (intent.requiresCurrentLocation && !input.latitude && !input.longitude) {
    savePendingPlacesRequest({
      query: intent.query,
      openNowRequested: Boolean(intent.openNowRequested),
      sort: intent.sort || 'nearest',
      language: intent.language || lang,
      operation: 'nearby',
    })
    return {
      handled: true,
      reply: placesCopy('location_required', intent.language || lang),
      status: 'location_required',
      placesUi: {
        kind: /** @type {const} */ ('location_permission'),
        actions: [
          { id: 'use_location', label: placesCopy('use_location_btn', intent.language || lang) },
          { id: 'enter_area', label: placesCopy('enter_area_btn', intent.language || lang) },
        ],
      },
      placesContext: ctx,
      pendingSaved: true,
      intent,
      diag: {
        placesIntent: 'places',
        operation: 'nearby',
        explicitLocationProvided: false,
        locationPermissionRequested: true,
        status: 'location_required',
        failureCode: 'location_required',
      },
    }
  }

  // Signal caller to run async provider search
  return {
    handled: true,
    needsProvider: true,
    intent,
    reply: null,
    placesContext: ctx,
    diag: {
      placesIntent: 'places',
      operation: intent.operation,
      explicitLocationProvided: Boolean(intent.explicitLocationText),
      status: 'pending_provider',
    },
  }
}

function resolveFollowUp(intent, ctx, input) {
  const lang = intent.language || 'it'
  const env = { ...createDefaultHandoffEnv(), ...(input.env || {}) }
  let nextCtx = ctx

  if (intent.followUpKind === 'select_index') {
    nextCtx = selectPlaceInContext(ctx, intent.followUpIndex ?? 0)
  } else if (intent.followUpKind === 'select_nearest') {
    nextCtx = selectNearestInContext(ctx)
  } else if (intent.followUpKind === 'select_current') {
    nextCtx = ctx
  }

  const place = getSelectedPlace(nextCtx)
  if (!place) {
    return {
      handled: true,
      reply: placesCopy('no_results', lang),
      status: 'no_results',
      placesContext: null,
      diag: { failureCode: 'empty_context', status: 'no_results' },
    }
  }

  if (intent.followUpKind === 'ask_open') {
    let reply
    if (typeof place.openNow === 'boolean') {
      reply = place.openNow ? placesCopy('open_yes', lang) : placesCopy('open_no', lang)
    } else {
      reply = placesCopy('open_unknown', lang)
    }
    return {
      handled: true,
      reply,
      status: 'ok',
      placesContext: nextCtx,
      selectedPlace: place,
      diag: {
        placesIntent: 'places',
        operation: 'follow_up',
        selectedPlaceIndex: nextCtx.selectedIndex,
        status: 'ok',
      },
    }
  }

  if (
    intent.followUpKind === 'select_index' ||
    intent.followUpKind === 'select_nearest' ||
    intent.followUpKind === 'select_current'
  ) {
    const distNote =
      typeof place.distanceMeters === 'number'
        ? ` (${place.distanceMeters < 1000 ? `${place.distanceMeters} m` : `${(place.distanceMeters / 1000).toFixed(1)} km`})`
        : ''
    const prefix =
      intent.followUpKind === 'select_nearest'
        ? placesCopy('nearest_prefix', lang)
        : placesCopy('selected_prefix', lang)
    return {
      handled: true,
      reply: `${prefix} ${place.name}${distNote}${place.address ? `\n${place.address}` : ''}`,
      status: 'ok',
      placesContext: nextCtx,
      selectedPlace: place,
      placesUi: {
        kind: /** @type {const} */ ('place_actions'),
        placeId: place.id,
        actions: [
          { id: 'navigate', label: placesCopy('take_me_btn', lang) },
          { id: 'maps', label: placesCopy('maps_btn', lang) },
        ],
      },
      diag: {
        placesIntent: 'places',
        operation: 'follow_up',
        selectedPlaceIndex: nextCtx.selectedIndex,
        status: 'ok',
      },
    }
  }

  if (intent.followUpKind === 'navigate' || intent.followUpKind === 'open_maps') {
    const dest = String(place.mapsDestination || place.name || '').trim()
    const url = buildMapsDirectionsUrl(dest)
    if (!url) {
      return {
        handled: true,
        reply: placesCopy('maps_failed', lang),
        status: 'provider_error',
        placesContext: nextCtx,
        diag: { mapsHandoffAttempted: true, failureCode: 'bad_destination' },
      }
    }
    const hop = openHttps(url, env)
    return {
      handled: true,
      reply: hop.ok
        ? lang === 'en'
          ? `Opening directions to ${place.name} in Maps.`
          : `Ti apro le indicazioni per ${place.name} in Maps.`
        : placesCopy('maps_failed', lang),
      status: hop.ok ? 'ok' : 'provider_error',
      placesContext: nextCtx,
      selectedPlace: place,
      diag: {
        placesIntent: 'places',
        operation: 'follow_up',
        mapsHandoffAttempted: true,
        selectedPlaceIndex: nextCtx.selectedIndex,
        status: hop.ok ? 'ok' : 'provider_error',
        failureCode: hop.ok ? null : hop.failureCode,
      },
    }
  }

  return { handled: false, reply: null, diag: {} }
}

/**
 * Build LOCAL_EXCHANGE payload from a successful provider response.
 */
export function buildPlacesSuccessExchange(input) {
  const lang = input.language === 'en' ? 'en' : 'it'
  const places = Array.isArray(input.places) ? input.places : []
  const status = input.status || 'ok'

  if (status === 'disabled') {
    clearPendingPlacesRequest()
    return {
      reply: placesCopy('disabled', lang),
      placesUi: null,
      placesContext: null,
      status: 'disabled',
    }
  }
  if (status === 'no_results') {
    clearPendingPlacesRequest()
    return {
      reply: placesCopy('no_results', lang),
      placesUi: null,
      placesContext: null,
      status: 'no_results',
    }
  }
  if (status === 'provider_error' || status === 'offline') {
    return {
      reply: placesCopy(status === 'offline' ? 'provider_error' : 'provider_error', lang),
      placesUi: null,
      placesContext: input.placesContext || null,
      status,
    }
  }
  if (status === 'invalid_query') {
    return {
      reply: placesCopy('invalid_query', lang),
      placesUi: null,
      placesContext: null,
      status,
    }
  }
  if (!places.length) {
    return {
      reply: placesCopy('no_results', lang),
      placesUi: null,
      placesContext: null,
      status: 'no_results',
    }
  }

  const ctx = createPlacesContext({
    query: input.query || '',
    results: places,
    originProvided: Boolean(input.originProvided),
    explicitLocationText: input.explicitLocationText || null,
    language: lang,
    selectedIndex: 0,
  })
  clearPendingPlacesRequest()

  const reply = formatPlacesResultsReply(places, lang, {
    query: input.query,
    area: input.explicitLocationText || null,
  })

  return {
    reply,
    placesContext: ctx,
    status: 'ok',
    placesUi: {
      kind: /** @type {const} */ ('results'),
      places: places.map((p) => ({
        id: p.id,
        name: p.name,
        address: p.address || null,
        distanceMeters: p.distanceMeters ?? null,
        openNow: typeof p.openNow === 'boolean' ? p.openNow : null,
        rating: typeof p.rating === 'number' ? p.rating : null,
      })),
      actions: [
        { id: 'navigate', label: placesCopy('take_me_btn', lang) },
        { id: 'maps', label: placesCopy('maps_btn', lang) },
      ],
    },
  }
}

export function geoFailureCopy(code, lang) {
  if (code === 'denied') return placesCopy('location_denied', lang)
  if (code === 'timeout') return placesCopy('location_timeout', lang)
  if (code === 'unsupported') return placesCopy('location_unsupported', lang)
  return placesCopy('location_unavailable', lang)
}

export { loadPendingPlacesRequest, PLACES_USE_LOCATION_TRIGGER, PLACES_ENTER_AREA_TRIGGER }
