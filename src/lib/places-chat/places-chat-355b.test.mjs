/**
 * #355B — Places client/chat layer contracts.
 * Run: node --test src/lib/places-chat/places-chat-355b.test.mjs
 *
 * Covers: intent claims/non-claims, follow-ups, controller flows (needs
 * location / ok / failures), privacy (no origin lat/lon persisted, no API
 * key on the client), the real places-query Edge contract (action +
 * queryType + Italian category), and write-path guardrails shared with
 * lib/server/places-355b.test.mjs (vercel.json count, no api/places.ts,
 * calendar/email untouched).
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import { detectPlacesIntent, detectPlacesFollowUp } from './intent.js'
import { foldPlacesText } from './normalize.js'
import { haversineMeters } from './haversine.js'
import {
  createPlacesContext,
  isPlacesContextFresh,
  focusIndexInContext,
  getFocusedPlace,
} from './active-context.js'
import { failureReply, formatDistanceMeters, renderPlacesList, renderNearest } from './render.js'
import { applyPlacesIntent } from './controller.js'

const root = process.cwd()
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')
const exists = (rel) => fs.existsSync(path.join(root, rel))

describe('places-chat-355b write-path guardrails', () => {
  it('does not create api/places.ts and keeps vercel.json at 13 functions', () => {
    assert.equal(exists('api/places.ts'), false)
    const vercelJson = JSON.parse(read('vercel.json'))
    const fnCount = Object.keys(vercelJson.functions || {}).length
    assert.equal(fnCount, 13)
    assert.ok(!Object.keys(vercelJson.functions).some((f) => f.includes('places')))
  })

  it('never touches calendar-* / email-* product files (source-level)', () => {
    // ChatContext.tsx INSERT is the one explicitly permitted exception.
    const filesThatMustStayClean = [
      'src/lib/calendar-chat/intent.js',
      'src/lib/calendar-chat/controller.js',
      'src/lib/calendar-chat/active-context.js',
      'src/lib/email-chat/intent.js',
      'src/lib/email-chat/controller.js',
      'src/lib/email-chat/active-context.js',
    ]
    for (const rel of filesThatMustStayClean) {
      const src = read(rel)
      assert.doesNotMatch(src, /places-chat|placesApi/i, rel)
    }
  })

  it('places-chat modules never import calendar-* or email-* modules', () => {
    const placesFiles = fs
      .readdirSync(path.join(root, 'src/lib/places-chat'))
      .filter((f) => f.endsWith('.js'))
      .map((f) => `src/lib/places-chat/${f}`)
    for (const rel of placesFiles) {
      const src = read(rel)
      assert.doesNotMatch(src, /from\s+['"][^'"]*calendar[^'"]*['"]/i, rel)
      assert.doesNotMatch(src, /from\s+['"][^'"]*email[^'"]*['"]/i, rel)
    }
  })

  it('ChatContext inserts Places after Email and before Daily Briefing', () => {
    const ctx = read('src/context/ChatContext.tsx')
    const emailIdx = ctx.indexOf('#337B — Gmail read-only chat')
    const placesIdx = ctx.indexOf('#355B — Places (nearby search)')
    const briefingIdx = ctx.indexOf('#321/#334C — Daily Briefing')
    assert.ok(emailIdx > 0, 'Email block marker not found')
    assert.ok(placesIdx > emailIdx, 'Places block must come after Email')
    assert.ok(briefingIdx > placesIdx, 'Places block must come before Daily Briefing')
    assert.match(ctx, /applyPlacesIntent/)
    assert.match(ctx, /detectPlacesIntent/)
  })

  it('ChatContext Places block always returns true (terminates locally)', () => {
    const ctx = read('src/context/ChatContext.tsx')
    const start = ctx.indexOf('#355B — Places (nearby search)')
    const end = ctx.indexOf('#321/#334C — Daily Briefing')
    const block = ctx.slice(start, end)
    assert.match(block, /placesIntent\.intent === 'places'/)
    assert.match(block, /return true/)
  })
})

describe('places-chat-355b privacy', () => {
  it('placesApi.ts never references the private provider API key / secret client-side', () => {
    const src = read('src/lib/placesApi.ts')
    // The Google Places *provider* key is server-only; the client must never
    // name or embed it. The Supabase `apikey` header below is the public
    // anon key (same pattern as emailApi.ts / calendarApi.ts) and is fine.
    assert.doesNotMatch(src, /SHINKAIDO_PLACES_API_KEY/)
    assert.doesNotMatch(src, /GOOGLE_PLACES_API_KEY/)
    assert.doesNotMatch(src, /AIza[0-9A-Za-z_-]{10,}/, 'no literal Google API key value')
    assert.match(src, /NEVER stores or forwards a provider API key/i)
  })

  it('createPlacesContext never accepts/stores latitude/longitude of the user origin', () => {
    const ctx = createPlacesContext({
      queryType: 'nearby_category',
      places: [
        { id: 'p1', name: 'Farmacia', latitude: 45.1, longitude: 9.1, distanceMeters: 100, provider: 'google_places' },
      ],
      // Attempted origin-shaped keys must be dropped — the context shape
      // is a fixed allowlist, not a passthrough of the input object.
      latitude: 45.0,
      longitude: 9.0,
      userLatitude: 45.0,
      userLongitude: 9.0,
    })
    assert.equal('latitude' in ctx, false)
    assert.equal('longitude' in ctx, false)
    assert.equal('userLatitude' in ctx, false)
    assert.equal(ctx.places[0].latitude, 45.1, 'per-place coordinates are fine — only user origin is excluded')
  })

  it('controller never forwards a persisted context back with origin coordinates', async () => {
    const requestFn = async () => ({
      ok: true,
      status: 'ok',
      queryType: 'nearby_category',
      fetchedAt: new Date().toISOString(),
      places: [
        { id: 'p1', name: 'Farmacia Centrale', address: 'Via Roma 1', latitude: 45.0, longitude: 9.0, distanceMeters: 320, provider: 'google_places' },
      ],
    })
    const result = await applyPlacesIntent({
      text: 'Farmacia vicino a me',
      languageHint: 'it',
      latitude: 45.1234,
      longitude: 9.5678,
      requestFn,
    })
    assert.ok(result.placesContext)
    assert.equal(JSON.stringify(result.placesContext).includes('45.1234'), false)
    assert.equal(JSON.stringify(result.placesContext).includes('9.5678'), false)
  })
})

describe('places-chat-355b intents — claims', () => {
  const positives = [
    'Trova una farmacia vicino a me',
    "C'è un supermercato qui vicino?",
    'Bar più vicino',
    'Ristorante vicino a me',
    'Benzinaio più vicino',
    'Palestra vicino a me',
    'Cerco un cafè qui vicino',
  ]
  for (const phrase of positives) {
    it(`claims: ${phrase}`, () => {
      const r = detectPlacesIntent(phrase, { languageHint: 'it' })
      assert.equal(r.intent, 'places', phrase)
      assert.equal(r.operation, 'nearby_category', phrase)
      assert.ok(r.categoryLabel, phrase)
    })
  }

  it('named place search: "Dov\'è il McDonald\'s più vicino?"', () => {
    const r = detectPlacesIntent("Dov'è il McDonald's più vicino?", { languageHint: 'it' })
    assert.equal(r.intent, 'places')
    assert.equal(r.operation, 'named')
    assert.equal(r.textQuery, "McDonald's")
  })

  it('open_now cue maps to nearby_category + disclaimer flag (never a verified filter)', () => {
    const r = detectPlacesIntent('palestra aperta adesso', { languageHint: 'it' })
    assert.equal(r.intent, 'places')
    assert.equal(r.operation, 'nearby_category')
    assert.equal(r.openNowRequested, true)
  })
})

describe('places-chat-355b intents — must NOT claim', () => {
  const negatives = [
    'Apri Google Maps',
    "Cos'è una farmacia?",
    'Che tempo fa?',
    'Piove oggi?',
    'Cosa ho oggi?',
    'Che impegni ho domani?',
    'Ho nuove email?',
    'Riassumi le mie email di oggi',
  ]
  for (const phrase of negatives) {
    it(`does not claim: ${phrase}`, () => {
      const r = detectPlacesIntent(phrase, { languageHint: 'it' })
      assert.equal(r.intent, 'none', phrase)
    })
  }
})

describe('places-chat-355b follow-ups (require hasPlacesContext)', () => {
  const cases = [
    ['il primo', 'select_index'],
    ['il secondo', 'select_index'],
    ['la terza', 'select_index'],
    ['il prossimo', 'select_next'],
    ['quanto dista?', 'distance'],
    ["dov'è?", 'where'],
    ['aprilo su maps', 'open_maps'],
    ['portami lì', 'navigate'],
    ['è aperto?', 'ask_open'],
  ]
  for (const [phrase, kind] of cases) {
    it(`follow-up "${phrase}" -> ${kind}`, () => {
      const r = detectPlacesIntent(phrase, { languageHint: 'it', hasPlacesContext: true })
      assert.equal(r.intent, 'places', phrase)
      assert.equal(r.followUpKind, kind, phrase)
    })
    it(`"${phrase}" is inert without an active context`, () => {
      const follow = detectPlacesFollowUp(phrase, { hasPlacesContext: false })
      assert.equal(follow, false, phrase)
    })
  }

  it('"È aperto?" always answers honestly — openNow is deferred, never verified', () => {
    assert.match(
      failureReply('open_deferred', 'it') || '',
      /non verifico|ancora/i,
    )
  })
})

describe('places-chat-355b haversine + distance formatting', () => {
  it('haversineMeters(x,x) is 0', () => {
    assert.equal(haversineMeters(41.9, 12.5, 41.9, 12.5), 0)
  })

  it('formatDistanceMeters renders "circa 320 m" and "circa 1,2 km"', () => {
    assert.equal(formatDistanceMeters(320, 'it'), 'circa 320 m')
    assert.equal(formatDistanceMeters(1200, 'it'), 'circa 1,2 km')
    assert.equal(formatDistanceMeters(null, 'it'), null)
  })
})

describe('places-chat-355b controller — fresh queries', () => {
  it('needs location: no coords -> handled + needsLocation + location_permission chip', async () => {
    const result = await applyPlacesIntent({ text: 'Farmacia vicino a me', languageHint: 'it' })
    assert.equal(result.handled, true)
    assert.equal(result.needsLocation, true)
    assert.equal(result.placesUi?.kind, 'location_permission')
    assert.equal(result.pendingIntent.operation, 'nearby_category')
    assert.match(result.reply, /posizione/i)
  })

  it('sends the real Edge Function contract shape (action-agnostic here; queryType + Italian category)', async () => {
    let seen = null
    const requestFn = async (payload) => {
      seen = payload
      return { ok: true, status: 'ok', queryType: payload.queryType, fetchedAt: new Date().toISOString(), places: [] }
    }
    await applyPlacesIntent({
      text: 'Trova un supermercato vicino a me',
      languageHint: 'it',
      latitude: 45,
      longitude: 9,
      requestFn,
    })
    assert.equal(seen.queryType, 'nearby_category')
    assert.equal(seen.category, 'supermercato')
    assert.equal(seen.latitude, 45)
    assert.equal(seen.longitude, 9)
  })

  it('named search sends queryType named_place + textQuery (no category)', async () => {
    let seen = null
    const requestFn = async (payload) => {
      seen = payload
      return { ok: true, status: 'ok', queryType: payload.queryType, fetchedAt: new Date().toISOString(), places: [] }
    }
    await applyPlacesIntent({
      text: "Dov'è il McDonald's più vicino?",
      languageHint: 'it',
      latitude: 45,
      longitude: 9,
      requestFn,
    })
    assert.equal(seen.queryType, 'named_place')
    assert.equal(seen.textQuery, "McDonald's")
    assert.equal(seen.category, undefined)
  })

  it('with coords: ok status renders a list + results chip + zero model calls', async () => {
    const requestFn = async () => ({
      ok: true,
      status: 'ok',
      queryType: 'nearby_category',
      fetchedAt: new Date().toISOString(),
      places: [
        { id: 'p1', name: 'Farmacia Centrale', address: 'Via Roma 1', latitude: 45.001, longitude: 9.001, distanceMeters: 320, provider: 'google_places' },
        { id: 'p2', name: 'Farmacia Nord', address: 'Via Milano 5', latitude: 45.01, longitude: 9.01, distanceMeters: 1200, provider: 'google_places' },
      ],
    })
    const result = await applyPlacesIntent({
      text: 'Farmacia vicino a me',
      languageHint: 'it',
      latitude: 45,
      longitude: 9,
      requestFn,
    })
    assert.equal(result.handled, true)
    assert.equal(result.status, 'ok')
    assert.match(result.reply, /Farmacia Centrale/)
    assert.match(result.reply, /circa 320 m/)
    assert.match(result.reply, /circa 1,2 km/)
    assert.equal(result.placesUi.kind, 'results')
    assert.equal(result.diag.modelCalls, 0)
    assert.equal(result.diag.terminatesLocally, true)
    assert.ok(isPlacesContextFresh(result.placesContext))
  })

  for (const status of ['empty', 'no_match', 'provider_disabled', 'provider_error', 'timeout', 'error']) {
    it(`failure status "${status}" renders a grounded failureReply, never invents places`, async () => {
      const requestFn = async () => ({
        ok: false,
        status,
        queryType: 'nearby_category',
        fetchedAt: new Date().toISOString(),
        places: [],
      })
      const result = await applyPlacesIntent({
        text: 'Farmacia vicino a me',
        languageHint: 'it',
        latitude: 45,
        longitude: 9,
        requestFn,
      })
      assert.equal(result.handled, true)
      assert.equal(result.placesContext, null)
      assert.equal(result.reply, failureReply(status === 'ok' ? 'error' : status, 'it'))
      assert.equal(result.diag.modelCalls, 0)
      assert.equal(result.diag.terminatesLocally, true)
    })
  }
})

describe('places-chat-355b controller — follow-ups', () => {
  function freshContext() {
    return createPlacesContext({
      queryType: 'nearby_category',
      places: [
        { id: 'p1', name: 'Farmacia Centrale', address: 'Via Roma 1', latitude: 45.001, longitude: 9.001, distanceMeters: 320, provider: 'google_places' },
        { id: 'p2', name: 'Farmacia Nord', address: 'Via Milano 5', latitude: 45.01, longitude: 9.01, distanceMeters: 1200, provider: 'google_places' },
      ],
      focusIndex: 0,
      status: 'ok',
      language: 'it',
    })
  }

  it('no active context -> honest "no active search" reply (never invents one)', async () => {
    const result = await applyPlacesIntent({ text: 'il primo', languageHint: 'it', placesContext: null })
    assert.equal(result.handled, true)
    assert.match(result.reply, /non ho una ricerca/i)
    assert.equal(result.diag.failureCode, 'no_context')
  })

  it('"il secondo" focuses index 1 and reports its distance', async () => {
    const result = await applyPlacesIntent({ text: 'il secondo', languageHint: 'it', placesContext: freshContext() })
    assert.match(result.reply, /Farmacia Nord/)
    assert.match(result.reply, /circa 1,2 km/)
    assert.equal(result.placesContext.focusIndex, 1)
  })

  it('"quanto dista?" answers with the focused place distance only', async () => {
    const result = await applyPlacesIntent({ text: 'quanto dista?', languageHint: 'it', placesContext: freshContext() })
    assert.match(result.reply, /Farmacia Centrale/)
    assert.match(result.reply, /circa 320 m/)
  })

  it('"dov\'è?" answers with the focused place address only', async () => {
    const result = await applyPlacesIntent({ text: "dov'è?", languageHint: 'it', placesContext: freshContext() })
    assert.match(result.reply, /Via Roma 1/)
  })

  it('"è aperto?" is honest — never claims verified opening hours', async () => {
    const result = await applyPlacesIntent({ text: 'è aperto?', languageHint: 'it', placesContext: freshContext() })
    assert.match(result.reply, /non verifico/i)
    assert.doesNotMatch(result.reply, /aperta adesso|chiusa adesso|is open now|is closed now/i)
  })

  it('"portami lì" builds a lat,lng Google Maps directions URL and calls the injected open()', async () => {
    let openedUrl = null
    const env = {
      open: (url) => {
        openedUrl = url
        return {}
      },
    }
    const result = await applyPlacesIntent({
      text: 'portami lì',
      languageHint: 'it',
      placesContext: freshContext(),
      env,
    })
    assert.equal(result.status, 'ok')
    assert.equal(openedUrl, 'https://www.google.com/maps/dir/?api=1&destination=45.001%2C9.001')
    assert.match(result.reply, /Farmacia Centrale/)
  })

  it('"aprilo su maps" also resolves via the shared phone-action Maps builder', async () => {
    let openedUrl = null
    const env = { open: (url) => (openedUrl = url) }
    const result = await applyPlacesIntent({
      text: 'aprilo su maps',
      languageHint: 'it',
      placesContext: freshContext(),
      env,
    })
    assert.equal(result.status, 'ok')
    assert.ok(openedUrl.startsWith('https://www.google.com/maps/dir/?api=1&destination='))
  })
})

describe('places-chat-355b context helpers', () => {
  it('focusIndexInContext clamps to bounds', () => {
    const ctx = createPlacesContext({
      queryType: 'nearby_category',
      places: [
        { id: 'a', name: 'A', latitude: 1, longitude: 1, provider: 'google_places' },
        { id: 'b', name: 'B', latitude: 2, longitude: 2, provider: 'google_places' },
      ],
      status: 'ok',
      language: 'it',
    })
    const clampedHigh = focusIndexInContext(ctx, 99)
    assert.equal(clampedHigh.focusIndex, 1)
    const clampedLow = focusIndexInContext(ctx, -5)
    assert.equal(clampedLow.focusIndex, 0)
    assert.equal(getFocusedPlace(clampedHigh).id, 'b')
  })

  it('expires after TTL', () => {
    const ctx = createPlacesContext({
      queryType: 'nearby_category',
      places: [{ id: 'a', name: 'A', latitude: 1, longitude: 1, provider: 'google_places' }],
      status: 'ok',
      language: 'it',
      createdAt: Date.now() - 60 * 60 * 1000,
      expiresAt: Date.now() - 1,
    })
    assert.equal(isPlacesContextFresh(ctx), false)
  })
})

describe('places-chat-355b renderers', () => {
  it('renderPlacesList adds the open-now-deferred note only when requested', () => {
    const places = [{ id: 'p1', name: 'Palestra Uno', distanceMeters: 500 }]
    const withNote = renderPlacesList(places, 'it', { category: 'palestra', openNowRequested: true })
    const withoutNote = renderPlacesList(places, 'it', { category: 'palestra', openNowRequested: false })
    assert.match(withNote, /non è verificato/i)
    assert.doesNotMatch(withoutNote, /non è verificato/i)
    assert.doesNotMatch(withNote, /aperta adesso|aperto adesso/i)
  })

  it('renderNearest picks the minimum distanceMeters', () => {
    const places = [
      { id: 'a', name: 'Lontano', distanceMeters: 5000 },
      { id: 'b', name: 'Vicino', distanceMeters: 100 },
    ]
    assert.match(renderNearest(places, 'it'), /Vicino/)
  })
})

describe('places-chat-355b text normalization', () => {
  it('foldPlacesText strips accents and normalizes apostrophes', () => {
    assert.equal(foldPlacesText("Dov'è il più vicino?"), "dov'e il piu vicino?")
  })
})
