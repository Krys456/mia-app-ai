/**
 * #316 Places tests.
 * Run: node src/lib/places/places.test.mjs
 */
import assert from 'node:assert/strict'
import { haversineMeters, formatDistanceMeters } from './haversine.js'
import {
  detectPlacesIntent,
  detectPlacesFollowUp,
  extractExplicitLocationText,
  looksQuotedOrInjectedPlaces,
  PLACES_USE_LOCATION_TRIGGER,
} from './intent.js'
import {
  createPlacesContext,
  selectPlaceInContext,
  selectNearestInContext,
  getSelectedPlace,
  isPlacesContextFresh,
} from './active-context.js'
import { getBrowserPosition } from './geolocation.js'
import { buildPlacesSuccessExchange, applyPlacesFollowUp } from './controller.js'
import { normalizeGooglePlace, normalizeGooglePlacesList, sortPlacesByDistance } from '../../../lib/server/places/normalize.js'
import { googlePlacesSearch } from '../../../lib/server/places/google-places-provider.js'
import { runPlacesSearch } from '../../../lib/server/places/index.js'
import { detectPhoneActionIntent, isDeicticNavigateDestination } from '../phone-action/intent.js'

// --- Intent positives ---
{
  const a = detectPlacesIntent('Trova un supermercato vicino a me.')
  assert.equal(a.intent, 'places')
  assert.equal(a.operation, 'nearby')
  assert.equal(a.requiresCurrentLocation, true)
  assert.match(a.query || '', /supermercato/i)
}

{
  const a = detectPlacesIntent('Qual è la farmacia più vicina?')
  assert.equal(a.intent, 'places')
  assert.ok(a.requiresCurrentLocation || a.sort === 'nearest')
}

{
  const a = detectPlacesIntent('Trovami un ristorante giapponese qui vicino.')
  assert.equal(a.intent, 'places')
  assert.equal(a.operation, 'nearby')
  assert.match(a.query || '', /ristorante|giapponese/i)
}

{
  const a = detectPlacesIntent('Ci sono distributori nelle vicinanze?')
  assert.equal(a.intent, 'places')
}

{
  const a = detectPlacesIntent('Dove posso prendere un caffè?')
  assert.equal(a.intent, 'places')
}

{
  const a = detectPlacesIntent('Trova un hotel a Milano.')
  assert.equal(a.intent, 'places')
  assert.equal(a.operation, 'text_search')
  assert.equal(a.requiresCurrentLocation, false)
  assert.ok(a.explicitLocationText)
  assert.match(a.explicitLocationText || '', /Milano/i)
}

{
  const a = detectPlacesIntent('Farmacie vicino a Piazza Yenne, Cagliari.')
  assert.equal(a.intent, 'places')
  assert.equal(a.operation, 'text_search')
  assert.equal(a.requiresCurrentLocation, false)
  assert.match(a.explicitLocationText || '', /Piazza Yenne/i)
}

{
  const a = detectPlacesIntent('Find a supermarket near me.')
  assert.equal(a.intent, 'places')
  assert.equal(a.requiresCurrentLocation, true)
}

{
  const a = detectPlacesIntent('Find a hotel in London.')
  assert.equal(a.intent, 'places')
  assert.equal(a.operation, 'text_search')
  assert.equal(a.requiresCurrentLocation, false)
}

{
  const a = detectPlacesIntent('Trova una farmacia aperta vicino a me.')
  assert.equal(a.intent, 'places')
  assert.equal(a.openNowRequested, true)
}

// --- Negatives ---
for (const n of [
  'Parliamo dei supermercati.',
  "Cos'è una farmacia?",
  'Scrivi un articolo sui ristoranti.',
  'Come funziona Google Maps?',
  'Cosa significa geolocalizzazione?',
]) {
  assert.equal(detectPlacesIntent(n).intent, 'none', n)
}
assert.equal(looksQuotedOrInjectedPlaces('"Trova una farmacia vicino a me"'), true)
assert.equal(detectPlacesIntent('"Trova una farmacia vicino a me"').intent, 'none')

// --- Haversine ---
{
  const d = haversineMeters(39.215, 9.11, 39.216, 9.111)
  assert.ok(typeof d === 'number' && d > 0 && d < 500)
  assert.equal(formatDistanceMeters(350), '350 m')
  assert.ok(formatDistanceMeters(1200)?.includes('km'))
}

// --- Geolocation mocks ---
{
  const denied = await getBrowserPosition({
    geolocation: {
      getCurrentPosition(_ok, err) {
        err({ code: 1 })
      },
    },
  })
  assert.equal(denied.ok, false)
  assert.equal(denied.code, 'denied')

  const ok = await getBrowserPosition({
    geolocation: {
      getCurrentPosition(success) {
        success({ coords: { latitude: 41.9, longitude: 12.5, accuracy: 10 } })
      },
    },
  })
  assert.equal(ok.ok, true)
  if (ok.ok) {
    assert.equal(ok.latitude, 41.9)
    assert.equal(ok.longitude, 12.5)
  }

  const unsupported = await getBrowserPosition({ geolocation: null })
  assert.equal(unsupported.ok, false)
  assert.equal(unsupported.code, 'unsupported')
}

// --- Provider normalize ---
{
  const p = normalizeGooglePlace({
    id: 'places/abc',
    displayName: { text: 'Farmacia Rossi' },
    formattedAddress: 'Via Roma 1',
    location: { latitude: 39.22, longitude: 9.12 },
    rating: 4.6,
    userRatingCount: 12,
    currentOpeningHours: { openNow: true },
  })
  assert.ok(p)
  assert.equal(p.name, 'Farmacia Rossi')
  assert.equal(p.openNow, true)
  assert.equal(p.rating, 4.6)
  assert.ok(p.mapsDestination.includes('Farmacia'))

  const unknownOpen = normalizeGooglePlace({
    id: 'x',
    displayName: { text: 'Bar' },
    location: { latitude: 1, longitude: 2 },
  })
  assert.equal(unknownOpen.openNow, undefined)

  const list = normalizeGooglePlacesList(
    [
      {
        id: 'a',
        displayName: { text: 'A' },
        location: { latitude: 39.22, longitude: 9.12 },
      },
      {
        id: 'b',
        displayName: { text: 'B' },
        location: { latitude: 39.23, longitude: 9.13 },
      },
    ],
    { originLat: 39.215, originLng: 9.11, haversine: haversineMeters, limit: 5 },
  )
  assert.equal(list.length, 2)
  assert.ok(typeof list[0].distanceMeters === 'number')
}

// --- Provider disabled / mock ---
{
  const disabled = await runPlacesSearch({
    operation: 'nearby',
    query: 'farmacia',
    latitude: 41.9,
    longitude: 12.5,
    env: { PLACES_ENABLED: 'false' },
  })
  assert.equal(disabled.status, 'disabled')
  assert.equal(disabled.places.length, 0)

  const missingKey = await runPlacesSearch({
    operation: 'nearby',
    query: 'farmacia',
    latitude: 41.9,
    longitude: 12.5,
    env: { PLACES_ENABLED: 'true' },
  })
  assert.equal(missingKey.status, 'disabled')
  assert.equal(missingKey.failureCode, 'missing_api_key')

  const mockFetch = async () => ({
    ok: true,
    status: 200,
    async json() {
      return {
        places: [
          {
            id: 'places/1',
            displayName: { text: 'Farmacia Uno' },
            formattedAddress: 'Via 1',
            location: { latitude: 41.901, longitude: 12.501 },
            currentOpeningHours: { openNow: true },
            rating: 4.2,
          },
          {
            id: 'places/2',
            displayName: { text: 'Farmacia Due' },
            formattedAddress: 'Via 2',
            location: { latitude: 41.91, longitude: 12.51 },
            rating: 4.8,
          },
        ],
      }
    },
  })

  const okSearch = await googlePlacesSearch({
    query: 'farmacia',
    latitude: 41.9,
    longitude: 12.5,
    sort: 'nearest',
    env: { PLACES_ENABLED: 'true', GOOGLE_PLACES_API_KEY: 'test-key' },
    fetchImpl: mockFetch,
  })
  assert.equal(okSearch.status, 'ok')
  assert.equal(okSearch.places.length, 2)
  assert.ok(okSearch.distancesCalculated)
  assert.ok(okSearch.places[0].distanceMeters <= okSearch.places[1].distanceMeters)

  const errSearch = await googlePlacesSearch({
    query: 'farmacia',
    latitude: 41.9,
    longitude: 12.5,
    env: { PLACES_ENABLED: 'true', GOOGLE_PLACES_API_KEY: 'test-key' },
    fetchImpl: async () => ({ ok: false, status: 500, async json() { return {} } }),
  })
  assert.equal(errSearch.status, 'provider_error')

  const emptySearch = await googlePlacesSearch({
    query: 'farmacia',
    latitude: 41.9,
    longitude: 12.5,
    env: { PLACES_ENABLED: 'true', GOOGLE_PLACES_API_KEY: 'test-key' },
    fetchImpl: async () => ({ ok: true, status: 200, async json() { return { places: [] } } }),
  })
  assert.equal(emptySearch.status, 'no_results')
}

// --- Context follow-ups ---
{
  const ctx = createPlacesContext({
    query: 'farmacia',
    language: 'it',
    originProvided: true,
    results: [
      { id: 'a', name: 'A', latitude: 1, longitude: 1, distanceMeters: 400, mapsDestination: 'A' },
      { id: 'b', name: 'B', latitude: 1, longitude: 1, distanceMeters: 200, mapsDestination: 'B' },
      { id: 'c', name: 'C', latitude: 1, longitude: 1, distanceMeters: 800, mapsDestination: 'C' },
    ],
  })
  assert.ok(isPlacesContextFresh(ctx))
  const second = selectPlaceInContext(ctx, 1)
  assert.equal(getSelectedPlace(second).name, 'B')
  const nearest = selectNearestInContext(ctx)
  assert.equal(getSelectedPlace(nearest).name, 'B')

  const follow = detectPlacesFollowUp('La seconda.', { hasPlacesContext: true })
  assert.equal(follow.kind, 'select_index')
  assert.equal(follow.index, 1)

  const nav = applyPlacesFollowUp({
    text: 'Portami lì',
    placesContext: second,
    languageHint: 'it',
    env: {
      open: () => ({}),
      location: null,
      navigator: {},
    },
  })
  assert.equal(nav.handled, true)
  assert.ok(nav.diag.mapsHandoffAttempted)

  const openQ = applyPlacesFollowUp({
    text: 'È aperta?',
    placesContext: {
      ...second,
      results: [
        { id: 'b', name: 'B', openNow: true, mapsDestination: 'B', latitude: 1, longitude: 1 },
      ],
      selectedIndex: 0,
      selectedPlaceId: 'b',
    },
    languageHint: 'it',
  })
  assert.equal(openQ.handled, true)
  assert.match(openQ.reply || '', /apert/i)
}

// --- Success exchange no invent ---
{
  const built = buildPlacesSuccessExchange({
    status: 'ok',
    query: 'farmacia',
    language: 'it',
    places: [
      {
        id: '1',
        name: 'Farmacia X',
        address: 'Via 1',
        distanceMeters: 350,
        openNow: true,
        rating: 4.5,
        mapsDestination: 'Farmacia X, Via 1',
        latitude: 1,
        longitude: 2,
      },
    ],
    originProvided: true,
  })
  assert.match(built.reply, /Farmacia X/)
  assert.match(built.reply, /350 m/)
  assert.doesNotMatch(built.reply, /N\/A/i)
}

// --- #315 Portami lì regression ---
assert.equal(isDeicticNavigateDestination('lì'), true)
assert.equal(isDeicticNavigateDestination('there'), true)
assert.equal(isDeicticNavigateDestination('Roma Termini'), false)
assert.equal(detectPhoneActionIntent('Portami lì.').kind, 'none')
assert.equal(detectPhoneActionIntent('Portami a Roma Termini').kind, 'navigate')
assert.equal(detectPhoneActionIntent('Portami a Roma Termini').destination, 'Roma Termini')

// Location required path (no provider call)
{
  const loc = applyPlacesFollowUp({
    text: 'Trova un supermercato vicino a me.',
    languageHint: 'it',
    placesContext: null,
  })
  assert.equal(loc.handled, true)
  assert.equal(loc.status, 'location_required')
  assert.ok(loc.placesUi?.actions?.some((a) => a.id === 'use_location'))
  assert.equal(loc.needsProvider, undefined)
}

console.log('places.test.mjs: all assertions passed')
