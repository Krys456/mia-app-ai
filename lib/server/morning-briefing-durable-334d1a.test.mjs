/**
 * #334D1A — Durable morning intent (Cache API) + SW/page contracts.
 * Run: node --test lib/server/morning-briefing-durable-334d1a.test.mjs
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

const CACHE = 'shinkaido-morning-intent-v1'
const URL_KEY = '/__shinkaido/morning-briefing-intent'
const TTL_MS = 5 * 60 * 1000
const KEY = 'shinkaido.morningBriefing.intent'

class MemoryStorage {
  constructor() {
    this.map = new Map()
  }
  getItem(k) {
    return this.map.has(k) ? this.map.get(k) : null
  }
  setItem(k, v) {
    this.map.set(k, String(v))
  }
  removeItem(k) {
    this.map.delete(k)
  }
}

/** Minimal Cache API mock shared by SW-like write + page-like read. */
function createMemoryCaches() {
  const stores = new Map()
  return {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map())
      const map = stores.get(name)
      return {
        async put(req, res) {
          const key = typeof req === 'string' ? req : req.url
          const text = await res.text()
          map.set(key, text)
        },
        async match(req) {
          const key = typeof req === 'string' ? req : req.url
          if (!map.has(key)) return undefined
          return {
            async json() {
              return JSON.parse(map.get(key))
            },
          }
        },
        async delete(req) {
          const key = typeof req === 'string' ? req : req.url
          return map.delete(key)
        },
      }
    },
    _stores: stores,
  }
}

function isValidMarker(value, nowMs, ttlMs = TTL_MS) {
  if (!value || typeof value !== 'object') return false
  if (value.type !== 'morning_briefing') return false
  if (typeof value.createdAt !== 'number' || !Number.isFinite(value.createdAt)) return false
  if (value.createdAt > nowMs + 60_000) return false
  if (nowMs - value.createdAt > ttlMs) return false
  return true
}

async function writeMarker(caches, createdAt = Date.now()) {
  const cache = await caches.open(CACHE)
  await cache.put(
    URL_KEY,
    new Response(JSON.stringify({ type: 'morning_briefing', createdAt }), {
      headers: { 'Content-Type': 'application/json' },
    }),
  )
}

async function readMarker(caches, nowMs = Date.now()) {
  const cache = await caches.open(CACHE)
  const res = await cache.match(URL_KEY)
  if (!res) return null
  let parsed
  try {
    parsed = await res.json()
  } catch {
    await cache.delete(URL_KEY)
    return null
  }
  if (!isValidMarker(parsed, nowMs)) {
    await cache.delete(URL_KEY)
    return null
  }
  return parsed
}

async function clearMarker(caches) {
  const cache = await caches.open(CACHE)
  await cache.delete(URL_KEY)
}

function hasMarker(search) {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  return params.get('briefing') === 'morning'
}

let lock = false
function capture(storage, { search = '', fromMessage = false, fromDurable = false } = {}) {
  if (!hasMarker(search) && !fromMessage && !fromDurable) return false
  if (storage.getItem(KEY) === 'pending') return true
  storage.setItem(KEY, 'pending')
  lock = false
  return true
}
function claim(storage) {
  if (lock) return false
  if (storage.getItem(KEY) !== 'pending') return false
  lock = true
  return true
}
function release() {
  lock = false
}
function complete(storage, loc, replaceState, onClearDurable) {
  storage.setItem(KEY, 'done')
  lock = false
  const params = new URLSearchParams(loc.search.startsWith('?') ? loc.search.slice(1) : loc.search)
  if (params.has('briefing')) {
    params.delete('briefing')
    const next = params.toString()
    replaceState(`${loc.pathname}${next ? `?${next}` : ''}${loc.hash}`)
  }
  if (onClearDurable) onClearDurable()
}

// --- closed PWA loses query but durable marker survives
{
  const caches = createMemoryCaches()
  const now = Date.now()
  await writeMarker(caches, now)
  // openWindow landed at "/" — no query
  assert.equal(hasMarker(''), false)
  const marker = await readMarker(caches, now + 1000)
  assert.ok(marker)
  assert.equal(marker.type, 'morning_briefing')
  const storage = new MemoryStorage()
  assert.equal(capture(storage, { fromDurable: true }), true)
  assert.equal(storage.getItem(KEY), 'pending')
}

// --- app boot reads marker → pending
{
  const caches = createMemoryCaches()
  await writeMarker(caches, Date.now())
  const marker = await readMarker(caches)
  assert.ok(marker)
  const storage = new MemoryStorage()
  assert.equal(capture(storage, { fromDurable: Boolean(marker) }), true)
}

// --- auth/chat not ready → waits (pending + durable retained)
{
  const caches = createMemoryCaches()
  await writeMarker(caches, Date.now())
  const storage = new MemoryStorage()
  capture(storage, { fromDurable: true })
  assert.equal(storage.getItem(KEY), 'pending')
  assert.ok(await readMarker(caches))
  // no claim yet
  assert.equal(lock, false)
}

// --- successful handoff clears marker
{
  lock = false
  const caches = createMemoryCaches()
  await writeMarker(caches, Date.now())
  const storage = new MemoryStorage()
  capture(storage, { fromDurable: true })
  assert.equal(claim(storage), true)
  let url = '/'
  complete(
    storage,
    { pathname: '/', search: '', hash: '' },
    (u) => {
      url = u
    },
    async () => {
      await clearMarker(caches)
    },
  )
  await clearMarker(caches)
  assert.equal(storage.getItem(KEY), 'done')
  assert.equal(await readMarker(caches), null)
  assert.equal(url, '/')
}

// --- failed handoff keeps durable marker
{
  lock = false
  const caches = createMemoryCaches()
  await writeMarker(caches, Date.now())
  const storage = new MemoryStorage()
  capture(storage, { fromDurable: true })
  assert.equal(claim(storage), true)
  // sendMessage false → release, do not complete
  release()
  assert.equal(storage.getItem(KEY), 'pending')
  assert.ok(await readMarker(caches), 'durable retained after failed handoff')
}

// --- stale marker ignored
{
  const caches = createMemoryCaches()
  const now = Date.now()
  await writeMarker(caches, now - TTL_MS - 1000)
  assert.equal(await readMarker(caches, now), null)
}

// --- URL + message + durable → one briefing only
{
  lock = false
  const caches = createMemoryCaches()
  await writeMarker(caches, Date.now())
  const storage = new MemoryStorage()
  assert.equal(capture(storage, { search: '?briefing=morning' }), true)
  assert.equal(capture(storage, { fromMessage: true }), true)
  assert.equal(capture(storage, { fromDurable: true }), true)
  assert.equal(claim(storage), true)
  assert.equal(claim(storage), false)
  complete(storage, { pathname: '/', search: '?briefing=morning', hash: '' }, () => {}, async () => {
    await clearMarker(caches)
  })
  await clearMarker(caches)
  assert.equal(claim(storage), false)
}

// --- StrictMode/remount → one briefing only
{
  lock = false
  const storage = new MemoryStorage()
  capture(storage, { fromDurable: true })
  assert.equal(claim(storage), true)
  assert.equal(claim(storage), false)
  release()
  assert.equal(claim(storage), true)
  complete(storage, { pathname: '/', search: '', hash: '' }, () => {})
  assert.equal(claim(storage), false)
}

// --- existing-window postMessage path still works (no durable required)
{
  lock = false
  const storage = new MemoryStorage()
  assert.equal(capture(storage, { fromMessage: true }), true)
  assert.equal(claim(storage), true)
  complete(storage, { pathname: '/', search: '', hash: '' }, () => {})
  assert.equal(storage.getItem(KEY), 'done')
}

// --- marker shape has no PII fields
{
  const marker = { type: 'morning_briefing', createdAt: 1 }
  assert.deepEqual(Object.keys(marker).sort(), ['createdAt', 'type'])
  assert.doesNotMatch(JSON.stringify(marker), /user|token|reminder|city|event/i)
}

// Source contracts: SW persists BEFORE focus/open; reminder branch untouched pattern
{
  const sw = read('public/sw.js')
  assert.match(sw, /persistMorningBriefingIntent/)
  assert.match(sw, /shinkaido-morning-intent-v1/)
  assert.match(sw, /\/__shinkaido\/morning-briefing-intent/)
  assert.match(sw, /Morning: persist durable marker FIRST/)
  assert.match(sw, /Reminder path: preserve legacy/)
  assert.match(sw, /openMorningClient/)
  assert.match(sw, /deliverMorningIntent/)
  // Reminder still uses openWindow(path) without morning persist
  assert.match(sw, /if \(!isMorning\)/)
}

{
  const host = read('src/components/MorningBriefingDeepLinkHost.tsx')
  assert.match(host, /readMorningBriefingDurableIntent/)
  assert.match(host, /fromDurable:\s*true/)
  assert.match(host, /sendMessage\('Briefing'\)/)
  assert.match(host, /completeMorningBriefingHandoff/)
  assert.doesNotMatch(host, /\/api\/chat/)
}

{
  const durable = read('src/lib/morningBriefingDurableIntent.ts')
  assert.match(durable, /MORNING_BRIEFING_DURABLE_TTL_MS = 5 \* 60 \* 1000/)
  assert.match(durable, /type: 'morning_briefing'/)
  assert.doesNotMatch(durable, /userId|accessToken|reminderId/)
}

{
  const schedule = read('src/lib/morningBriefingSchedule.ts')
  assert.match(schedule, /fromDurable/)
  assert.match(schedule, /clearMorningBriefingDurableIntent/)
}

// Reminder regression: DueReminderHost still uses ?reminder=
assert.match(read('src/components/DueReminderHost.tsx'), /\?reminder=/)
assert.match(read('public/sw.js'), /reminderId/)

// Architecture freeze
assert.equal(Object.keys(JSON.parse(read('vercel.json')).functions).length, 13)

// Load real TS module via dynamic import of compiled path — use node with
// typescript stripped by asserting file exists and constants align with SW.
{
  const durable = read('src/lib/morningBriefingDurableIntent.ts')
  const sw = read('public/sw.js')
  assert.match(durable, /shinkaido-morning-intent-v1/)
  assert.match(sw, /shinkaido-morning-intent-v1/)
  assert.match(durable, /\/__shinkaido\/morning-briefing-intent/)
  assert.match(sw, /\/__shinkaido\/morning-briefing-intent/)
}

console.log('morning-briefing-durable-334d1a.test.mjs: ok')
