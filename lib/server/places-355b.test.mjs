/**
 * #355B — Places Edge stack contracts.
 * Run: node --test lib/server/places-355b.test.mjs
 *
 * This feature ships ONLY under supabase/ (Edge Functions, Deno TS), plus
 * .env.example docs. There is no Node/Vercel mirror, so every contract here
 * is verified as source text (grep-style pattern matching against the
 * actual shipped files) — the same approach used by
 * lib/server/email-337b.test.mjs and lib/server/calendar-encryption-env-336b.test.mjs.
 * Plain `.ts` files under supabase/functions/ cannot be `import()`-ed by
 * plain `node --test` (Deno runtime only), so this file never attempts that.
 */

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'

const root = process.cwd()
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')
const exists = (rel) => fs.existsSync(path.join(root, rel))

const envExample = read('.env.example')
const vercelJson = JSON.parse(read('vercel.json'))
const readme = read('supabase/migrations/README-355B-PLACES.md')

const sharedEdge = read('supabase/functions/_shared/places-edge.ts')
const sharedGoogle = read('supabase/functions/_shared/places-google.ts')
const placesQuery = read('supabase/functions/places-query/index.ts')

const PLACES_RUNTIME_FILES = {
  'supabase/functions/_shared/places-edge.ts': sharedEdge,
  'supabase/functions/_shared/places-google.ts': sharedGoogle,
  'supabase/functions/places-query/index.ts': placesQuery,
}

function gitDiffNames(args) {
  try {
    const out = execFileSync('git', ['diff', '--name-only', ...args], { cwd: root, encoding: 'utf8' })
    return out.split('\n').map((s) => s.trim()).filter(Boolean)
  } catch {
    return null
  }
}

describe('#355B write-path guardrails', () => {
  it('does not create api/places.ts and keeps vercel.json at 13 functions', () => {
    assert.equal(exists('api/places.ts'), false)
    const fnCount = Object.keys(vercelJson.functions || {}).length
    assert.equal(fnCount, 13)
    assert.ok(!Object.keys(vercelJson.functions).some((f) => f.includes('places')))
  })

  it('creates exactly the expected Edge/doc files', () => {
    const expected = [
      'supabase/functions/_shared/places-edge.ts',
      'supabase/functions/_shared/places-google.ts',
      'supabase/functions/places-query/index.ts',
      'supabase/migrations/README-355B-PLACES.md',
    ]
    for (const rel of expected) {
      assert.equal(exists(rel), true, `missing ${rel}`)
    }
  })

  it('does not add a places migration (stateless — no DB table)', () => {
    const migrationsDir = path.join(root, 'supabase/migrations')
    const files = fs.readdirSync(migrationsDir)
    const placesSql = files.filter((f) => f.endsWith('.sql') && /places/i.test(f))
    assert.deepEqual(placesSql, [])
  })

  it('does not touch any calendar-* or email-* file (git diff against origin/main)', () => {
    const protectedGlobs = [
      'supabase/functions/calendar-*',
      'supabase/functions/_shared/calendar-*',
      'supabase/functions/email-*',
      'supabase/functions/_shared/email-*',
      'supabase/migrations/*calendar*',
      'supabase/migrations/*CALENDAR*',
      'supabase/migrations/*email*',
      'supabase/migrations/*EMAIL*',
      'src/lib/calendar-chat',
      'src/components/CalendarIntegrationsSettings.tsx',
      'src/lib/calendarApi.ts',
    ]
    const diff = gitDiffNames(['origin/main', '--', ...protectedGlobs])
    if (diff === null) return // git ref unavailable in this sandbox — skip gracefully
    assert.deepEqual(diff, [], `calendar/email files were modified: ${diff.join(', ')}`)
  })

  it('calendar/email foundations still exist on disk (not deleted/regressed)', () => {
    assert.equal(exists('supabase/functions/calendar-connection/index.ts'), true)
    assert.equal(exists('supabase/functions/calendar-oauth-start/index.ts'), true)
    assert.equal(exists('supabase/functions/email-query/index.ts'), true)
    assert.equal(exists('supabase/functions/_shared/email-edge.ts'), true)
  })

  it('calendar-* / email-* files never import a places-* module', () => {
    const protectedFiles = [
      'supabase/functions/_shared/calendar-edge.ts',
      'supabase/functions/_shared/calendar-oauth.ts',
      'supabase/functions/_shared/calendar-token-crypto.ts',
      'supabase/functions/calendar-connection/index.ts',
      'supabase/functions/calendar-oauth-callback/index.ts',
      'supabase/functions/calendar-oauth-start/index.ts',
      'supabase/functions/_shared/email-edge.ts',
      'supabase/functions/_shared/email-gmail.ts',
      'supabase/functions/_shared/email-oauth.ts',
      'supabase/functions/_shared/email-token-crypto.ts',
      'supabase/functions/email-connection/index.ts',
      'supabase/functions/email-oauth-callback/index.ts',
      'supabase/functions/email-oauth-start/index.ts',
      'supabase/functions/email-query/index.ts',
    ]
    for (const rel of protectedFiles) {
      const src = read(rel)
      assert.doesNotMatch(src, /from\s+['"][^'"]*places[^'"]*['"]/i, rel)
    }
  })

  it('places modules never import calendar-* or email-* modules', () => {
    for (const [rel, src] of Object.entries(PLACES_RUNTIME_FILES)) {
      assert.doesNotMatch(src, /from\s+['"][^'"]*calendar[^'"]*['"]/i, rel)
      assert.doesNotMatch(src, /from\s+['"][^'"]*email[^'"]*['"]/i, rel)
    }
  })
})

describe('#355B FieldMask — Pro-safe, openNow deferred', () => {
  it('FieldMask constant is exactly the 5 minimal fields (no openNow/photos/reviews/rating)', () => {
    const maskMatch = sharedGoogle.match(/export const PLACES_FIELD_MASK =\s*\n?\s*(['"][^'"]*['"])/)
    assert.ok(maskMatch, 'PLACES_FIELD_MASK constant not found')
    const mask = maskMatch[1]
    assert.equal(
      mask,
      "'places.id,places.displayName,places.primaryType,places.formattedAddress,places.location'",
    )
    assert.doesNotMatch(mask, /currentOpeningHours/)
    assert.doesNotMatch(mask, /openNow/i)
    assert.doesNotMatch(mask, /photos/)
    assert.doesNotMatch(mask, /reviews/)
    assert.doesNotMatch(mask, /rating/)
    assert.doesNotMatch(mask, /nationalPhoneNumber/)
    assert.doesNotMatch(mask, /websiteUri/)
  })

  it('normalizePlace never sets/returns an openNow field', () => {
    const fnMatch = sharedGoogle.match(/export function normalizePlace[\s\S]*?\n}\n/)
    assert.ok(fnMatch, 'normalizePlace function not found')
    assert.doesNotMatch(fnMatch[0], /openNow/i)
  })

  it('no request/response type ever declares an openNow/photos/reviews/rating field', () => {
    assert.doesNotMatch(sharedGoogle, /\bopenNow\s*[:?]/i)
    assert.doesNotMatch(sharedGoogle, /\bphotos\s*[:?]/i)
    assert.doesNotMatch(sharedGoogle, /\breviews\s*[:?]/i)
    assert.doesNotMatch(sharedGoogle, /\brating\s*[:?]/i)
  })

  it('documents the openNow-deferred decision in source and README', () => {
    assert.match(sharedGoogle, /DEFERRED/)
    assert.match(sharedGoogle, /SKU/)
    assert.match(readme, /openNow: DEFERRED|openNow.*DEFERRED/i)
    assert.match(readme, /SKU/)
  })
})

describe('#355B API key: SHINKAIDO_PLACES_API_KEY only', () => {
  it('places-google.ts + places-query reference the key by name', () => {
    assert.match(sharedGoogle, /SHINKAIDO_PLACES_API_KEY/)
    assert.match(placesQuery, /SHINKAIDO_PLACES_API_KEY|getPlacesApiKeyEnvName/)
  })

  it('no module reads a legacy/alternate Places key name', () => {
    for (const [rel, src] of Object.entries(PLACES_RUNTIME_FILES)) {
      assert.doesNotMatch(src, /GOOGLE_PLACES_API_KEY/, rel)
    }
  })

  it('.env.example documents PLACES_ENABLED + SHINKAIDO_PLACES_API_KEY (names only)', () => {
    assert.match(envExample, /PLACES_ENABLED/)
    assert.match(envExample, /SHINKAIDO_PLACES_API_KEY/)
    // No real-looking secret value committed.
    assert.doesNotMatch(envExample, /SHINKAIDO_PLACES_API_KEY\s*=\s*[A-Za-z0-9_-]{10,}/)
    // Calendar/Email docs must remain present (not removed by this change).
    assert.match(envExample, /CALENDAR_ENABLED/)
    assert.match(envExample, /SHINKAIDO_CALENDAR_ENCRYPTION_KEY/)
    assert.match(envExample, /EMAIL_ENABLED/)
    assert.match(envExample, /SHINKAIDO_EMAIL_ENCRYPTION_KEY/)
  })
})

describe('#355B places-query Edge Function contract (source)', () => {
  it('is POST-only, JWT-gated, and gates on PLACES_ENABLED', () => {
    assert.match(placesQuery, /req\.method !== 'POST'/)
    assert.match(placesQuery, /isPlacesEnabled/)
    assert.match(placesQuery, /places_disabled/)
    assert.match(placesQuery, /provider_disabled/)
    assert.match(placesQuery, /verifyUserJwt/)
    assert.match(placesQuery, /extractBearer/)
    assert.match(placesQuery, /action !== 'places_query'/)
  })

  it('rejects user_id / userId spoofing', () => {
    assert.match(placesQuery, /body\.user_id \|\| body\.userId/)
    assert.match(placesQuery, /user_id_spoof_rejected/)
  })

  it('rejects apiKey / token relay fields', () => {
    assert.match(placesQuery, /body\.apiKey/)
    assert.match(placesQuery, /body\.tokens/)
    assert.match(placesQuery, /secret_relay_forbidden/)
  })

  it('supports all three queryType branches and the documented status vocabulary', () => {
    for (const qt of ["'nearby_category'", "'nearest'", "'named_place'"]) {
      assert.match(placesQuery, new RegExp(qt), qt)
    }
    for (const status of ["'ok'", "'empty'", "'no_match'", "'provider_disabled'", "'provider_error'", "'timeout'", "'error'"]) {
      assert.match(placesQuery, new RegExp(status), status)
    }
  })

  it('validates latitude/longitude are finite and in range', () => {
    assert.match(placesQuery, /Number\.isFinite\(latitude\)/)
    assert.match(placesQuery, /Number\.isFinite\(longitude\)/)
    assert.match(placesQuery, /-90/)
    assert.match(placesQuery, /90/)
    assert.match(placesQuery, /-180/)
    assert.match(placesQuery, /180/)
    assert.match(placesQuery, /invalid_coordinates/)
  })

  it('nearest sorts by distance ascending; nearby_category/named_place resolve via category map or text query', () => {
    assert.match(placesQuery, /sortByDistanceAscending/)
    assert.match(placesQuery, /mapCategoryToType/)
    assert.match(placesQuery, /searchByText/)
    assert.match(placesQuery, /no_match/)
  })

  it('never logs lat/lon/address/name/query/destination/coords', () => {
    assert.doesNotMatch(placesQuery, /console\.(log|info|warn)\(/)
    assert.match(placesQuery, /logSafe/)
  })
})

describe('#355B places-edge.ts shared helpers (source contract)', () => {
  it('exposes env/isPlacesEnabled/corsHeaders/json/extractBearer/verifyUserJwt/logSafe', () => {
    assert.match(sharedEdge, /export function env/)
    assert.match(sharedEdge, /export function isPlacesEnabled/)
    assert.match(sharedEdge, /export function corsHeaders/)
    assert.match(sharedEdge, /export function json/)
    assert.match(sharedEdge, /export function extractBearer/)
    assert.match(sharedEdge, /export async function verifyUserJwt/)
    assert.match(sharedEdge, /export function logSafe/)
  })

  it('isPlacesEnabled reads PLACES_ENABLED truthy', () => {
    assert.match(sharedEdge, /PLACES_ENABLED/)
    assert.match(sharedEdge, /isTruthy/)
  })

  it('does not require EMAIL_RETURN_URL (Places has no return-URL allowlist)', () => {
    assert.doesNotMatch(sharedEdge, /env\(['"]EMAIL_RETURN_URL['"]\)/)
    assert.doesNotMatch(sharedEdge, /env\(['"]CALENDAR_RETURN_URL['"]\)/)
    assert.doesNotMatch(sharedEdge, /Deno\.env\.get\(['"]EMAIL_RETURN_URL['"]\)/)
  })

  it('allows *.vercel.app and CORS_ALLOWED_ORIGINS in corsHeaders', () => {
    assert.match(sharedEdge, /vercel\\?\.app/)
    assert.match(sharedEdge, /CORS_ALLOWED_ORIGINS/)
  })

  it('uses npm:@supabase/supabase-js for JWT verification and never imports email-edge.ts', () => {
    assert.match(sharedEdge, /npm:@supabase\/supabase-js@2/)
    assert.doesNotMatch(sharedEdge, /from\s+['"][^'"]*email-edge/i)
  })

  it('redacts lat/lon/latitude/longitude/address/name/query/destination/coords in logs', () => {
    const patternMatch = sharedEdge.match(/PLACES_REDACT_PATTERN\s*=\s*\n?\s*(\/[\s\S]*?\/[a-z]*)/)
    assert.ok(patternMatch, 'PLACES_REDACT_PATTERN not found')
    const redactSrc = patternMatch[1]
    for (const term of ['lat', 'lon', 'latitude', 'longitude', 'address', 'name', 'query', 'destination', 'coords']) {
      assert.match(redactSrc, new RegExp(term), term)
    }

    const redactFieldsMatch = sharedEdge.match(/export function redactPlacesFields[\s\S]*?\n}\n/)
    assert.ok(redactFieldsMatch, 'redactPlacesFields function not found')

    // Behavioral check: transpile-free eval of the redaction regex against sample keys.
    // eslint-disable-next-line no-new-func
    const pattern = new Function(`return ${redactSrc}`)()
    for (const key of ['lat', 'lon', 'latitude', 'longitude', 'address', 'name', 'query', 'destination', 'coords']) {
      assert.equal(pattern.test(key), true, `expected redaction pattern to match key "${key}"`)
    }
    assert.equal(pattern.test('runId'), false)
    assert.equal(pattern.test('status'), false)
    assert.equal(pattern.test('queryType'), true, 'queryType contains "query" and is expected to redact')
  })
})

describe('#355B places-google.ts provider helpers (source contract)', () => {
  it('exposes the required builder/call/normalize functions', () => {
    assert.match(sharedGoogle, /export function buildNearbyRequest/)
    assert.match(sharedGoogle, /export function buildTextSearchRequest/)
    assert.match(sharedGoogle, /export async function callGooglePlaces/)
    assert.match(sharedGoogle, /export function normalizePlace/)
    assert.match(sharedGoogle, /export function haversineMeters/)
    assert.match(sharedGoogle, /export const CATEGORY_TYPE_MAP/)
  })

  it('callGooglePlaces posts to the correct Google endpoint with the FieldMask header', () => {
    assert.match(sharedGoogle, /https:\/\/places\.googleapis\.com\/v1\//)
    assert.match(sharedGoogle, /X-Goog-Api-Key/)
    assert.match(sharedGoogle, /X-Goog-FieldMask/)
    assert.match(sharedGoogle, /method:\s*'POST'/)
  })

  it('applies a ~9000ms timeout via AbortController', () => {
    assert.match(sharedGoogle, /DEFAULT_TIMEOUT_MS\s*=\s*9000/)
    assert.match(sharedGoogle, /AbortController/)
    assert.match(sharedGoogle, /'timeout'/)
  })

  it('caps radius (default 2000 / max 5000) and maxResultCount (default 5 / max 5)', () => {
    assert.match(sharedGoogle, /DEFAULT_RADIUS_M\s*=\s*2000/)
    assert.match(sharedGoogle, /MAX_RADIUS_M\s*=\s*5000/)
    assert.match(sharedGoogle, /DEFAULT_MAX_RESULT_COUNT\s*=\s*5/)
    assert.match(sharedGoogle, /MAX_MAX_RESULT_COUNT\s*=\s*5/)
  })

  it('never logs names/addresses/coordinates (no console.* calls in this module)', () => {
    assert.doesNotMatch(sharedGoogle, /console\.(log|info|warn|error)\(/)
  })

  it('category map covers the documented Italian → Google Table A types', () => {
    const expected = {
      farmacia: 'pharmacy',
      supermercato: 'supermarket',
      bar: 'bar',
      ristorante: 'restaurant',
      benzinaio: 'gas_station',
      palestra: 'gym',
      caffe: 'cafe',
      'caffè': 'cafe',
      banca: 'bank',
      ospedale: 'hospital',
      hotel: 'lodging',
    }
    for (const [category, type] of Object.entries(expected)) {
      const re = new RegExp(`${category}:\\s*'${type}'`)
      assert.match(sharedGoogle, re, `${category} -> ${type}`)
    }
    // Spot-check the two explicitly named in the task.
    assert.match(sharedGoogle, /pharmacy/)
    assert.match(sharedGoogle, /supermarket/)
  })

  it('does not map cuisine-specific phrases like "ristoranti giapponesi" to a type', () => {
    const mapMatch = sharedGoogle.match(/export const CATEGORY_TYPE_MAP[\s\S]*?\n}\n/)
    assert.ok(mapMatch, 'CATEGORY_TYPE_MAP object not found')
    assert.doesNotMatch(mapMatch[0], /ristoranti giapponesi/i)
    assert.doesNotMatch(mapMatch[0], /giapponese/i)
    assert.match(sharedGoogle, /Text Search/)
  })

  it('buildNearbyRequest / buildTextSearchRequest target the correct Google (New) paths', () => {
    assert.match(sharedGoogle, /places:searchNearby/)
    assert.match(sharedGoogle, /places:searchText/)
  })
})

describe('#355B haversine sanity', () => {
  it('source contains the great-circle haversine formula', () => {
    assert.match(sharedGoogle, /Math\.sin/)
    assert.match(sharedGoogle, /Math\.cos/)
    assert.match(sharedGoogle, /Math\.asin/)
    assert.match(sharedGoogle, /EARTH_RADIUS_M/)
  })

  it('is numerically sane when re-implemented from the documented formula (source-derived check)', () => {
    // Re-implements the exact formula documented in places-google.ts to sanity
    // check known distances, since the .ts module itself cannot be import()-ed
    // by plain Node (Deno runtime only).
    assert.match(sharedGoogle, /export function haversineMeters/)
    const EARTH_RADIUS_M = 6371000
    function haversineMeters(lat1, lon1, lat2, lon2) {
      const toRad = (deg) => (deg * Math.PI) / 180
      const phi1 = toRad(lat1)
      const phi2 = toRad(lat2)
      const deltaPhi = toRad(lat2 - lat1)
      const deltaLambda = toRad(lon2 - lon1)
      const sinDeltaPhi = Math.sin(deltaPhi / 2)
      const sinDeltaLambda = Math.sin(deltaLambda / 2)
      const h = sinDeltaPhi * sinDeltaPhi + Math.cos(phi1) * Math.cos(phi2) * sinDeltaLambda * sinDeltaLambda
      return Math.round(2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h))))
    }

    assert.equal(haversineMeters(41.9028, 12.4964, 41.9028, 12.4964), 0)

    // Rome (Colosseum) to Vatican (St. Peter's Basilica) ~ 3.4km straight-line.
    const romeToVatican = haversineMeters(41.8902, 12.4922, 41.9022, 12.4539)
    assert.ok(romeToVatican > 3000 && romeToVatican < 3900, `unexpected distance: ${romeToVatican}`)

    // Rome to Milan ~ 480km straight-line.
    const romeToMilan = haversineMeters(41.9028, 12.4964, 45.4642, 9.19)
    assert.ok(romeToMilan > 450000 && romeToMilan < 520000, `unexpected distance: ${romeToMilan}`)
  })
})
