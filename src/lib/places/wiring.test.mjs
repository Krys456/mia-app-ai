/**
 * #316 wiring smoke — Places before Phone; API + ChatContext hooks.
 * Run: node src/lib/places/wiring.test.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const chatCtx = readFileSync(join(root, 'src/context/ChatContext.tsx'), 'utf8')
const apiPlaces = readFileSync(join(root, 'api/places.ts'), 'utf8')
const vercel = readFileSync(join(root, 'vercel.json'), 'utf8')
const envExample = readFileSync(join(root, '.env.example'), 'utf8')

assert.match(chatCtx, /applyPlacesFollowUp/)
assert.match(chatCtx, /handlePlacesUiAction/)
assert.match(chatCtx, /#316/)
// Places block appears before Phone Actions comment
const placesIdx = chatCtx.indexOf('#316 — Places')
const phoneIdx = chatCtx.indexOf('#315 — deterministic Phone Actions')
assert.ok(placesIdx > 0 && phoneIdx > placesIdx, 'Places router must run before Phone Actions')

assert.match(apiPlaces, /runPlacesSearch/)
assert.match(apiPlaces, /bucket: 'places'/)
assert.match(apiPlaces, /locationProvided/)
assert.doesNotMatch(apiPlaces, /latitude.*console/)

assert.match(vercel, /api\/places\.ts/)
assert.match(envExample, /PLACES_ENABLED/)
assert.match(envExample, /GOOGLE_PLACES_API_KEY/)
assert.doesNotMatch(envExample, /VITE_GOOGLE_PLACES/)

console.log('places wiring.test.mjs: ok')
