/**
 * #334D1 fix — Morning briefing deep-link intent state machine + SW contracts.
 * Run: node --test lib/server/morning-briefing-deeplink-334d1.test.mjs
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

// Exercise pure deep-link intent helpers (mirrored) + source contracts.

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

const KEY = 'shinkaido.morningBriefing.intent'
const SW_TYPE = 'shinkaido.morning_briefing'

function hasMarker(search) {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  return params.get('briefing') === 'morning'
}

function readState(storage) {
  const raw = storage.getItem(KEY)
  return raw === 'pending' || raw === 'done' ? raw : null
}

function capture(storage, { search = '', fromMessage = false } = {}) {
  if (!hasMarker(search) && !fromMessage) return false
  const state = readState(storage)
  if (state === 'pending') return true
  storage.setItem(KEY, 'pending')
  lock = false
  return true
}

let lock = false
function claim(storage) {
  if (lock) return false
  if (readState(storage) !== 'pending') return false
  lock = true
  return true
}
function release() {
  lock = false
}
function complete(storage, loc, replaceState) {
  storage.setItem(KEY, 'done')
  lock = false
  const params = new URLSearchParams(loc.search.startsWith('?') ? loc.search.slice(1) : loc.search)
  if (!params.has('briefing')) return
  params.delete('briefing')
  const next = params.toString()
  replaceState(`${loc.pathname}${next ? `?${next}` : ''}${loc.hash}`)
}

// --- closed app → open ?briefing=morning → briefing once
{
  lock = false
  const storage = new MemoryStorage()
  const urls = []
  assert.equal(capture(storage, { search: '?briefing=morning' }), true)
  assert.equal(storage.getItem(KEY), 'pending')
  assert.equal(claim(storage), true)
  assert.equal(claim(storage), false, 'second claim suppressed (StrictMode)')
  complete(storage, { pathname: '/', search: '?briefing=morning', hash: '' }, (u) => urls.push(u))
  assert.equal(storage.getItem(KEY), 'done')
  assert.equal(urls[0], '/')
  assert.equal(claim(storage), false, 'no duplicate after handoff')
}

// --- existing app window → SW message → briefing once
{
  lock = false
  const storage = new MemoryStorage()
  assert.equal(capture(storage, { fromMessage: true }), true)
  assert.equal(storage.getItem(KEY), 'pending')
  assert.equal(claim(storage), true)
  complete(storage, { pathname: '/', search: '', hash: '' }, () => {})
  assert.equal(storage.getItem(KEY), 'done')
}

// --- auth/bootstrap not ready → waits (pending retained; no premature done)
{
  lock = false
  const storage = new MemoryStorage()
  assert.equal(capture(storage, { search: '?briefing=morning' }), true)
  assert.equal(storage.getItem(KEY), 'pending')
  // simulate not claiming yet (auth pending)
  assert.equal(hasMarker('?briefing=morning'), true)
  assert.notEqual(storage.getItem(KEY), 'done')
  // later ready:
  assert.equal(claim(storage), true)
  complete(storage, { pathname: '/', search: '?briefing=morning', hash: '' }, () => {})
  assert.equal(storage.getItem(KEY), 'done')
}

// --- marker not consumed prematurely (URL still has marker while pending)
{
  lock = false
  const storage = new MemoryStorage()
  const loc = { pathname: '/', search: '?briefing=morning', hash: '' }
  capture(storage, { search: loc.search })
  assert.equal(hasMarker(loc.search), true)
  assert.equal(storage.getItem(KEY), 'pending')
}

// --- successful handoff → URL cleaned
{
  lock = false
  const storage = new MemoryStorage()
  let url = '/?briefing=morning'
  capture(storage, { search: '?briefing=morning' })
  claim(storage)
  complete(
    storage,
    { pathname: '/', search: '?briefing=morning', hash: '' },
    (u) => {
      url = u
    },
  )
  assert.equal(url, '/')
  assert.equal(hasMarker(url.includes('?') ? url.slice(url.indexOf('?')) : ''), false)
}

// --- React remount / StrictMode-like double effect → no duplicate
{
  lock = false
  const storage = new MemoryStorage()
  capture(storage, { search: '?briefing=morning' })
  assert.equal(claim(storage), true)
  // remount effect before complete:
  assert.equal(claim(storage), false)
  release() // failed sendMessage
  assert.equal(storage.getItem(KEY), 'pending')
  assert.equal(claim(storage), true)
  complete(storage, { pathname: '/', search: '?briefing=morning', hash: '' }, () => {})
  assert.equal(claim(storage), false)
}

// --- normal app open without marker → no briefing
{
  lock = false
  const storage = new MemoryStorage()
  assert.equal(capture(storage, { search: '' }), false)
  assert.equal(capture(storage, { search: '?foo=1' }), false)
  assert.equal(storage.getItem(KEY), null)
  assert.equal(claim(storage), false)
}

// --- new notification re-arms after prior done
{
  lock = false
  const storage = new MemoryStorage()
  storage.setItem(KEY, 'done')
  assert.equal(capture(storage, { fromMessage: true }), true)
  assert.equal(storage.getItem(KEY), 'pending')
  assert.equal(claim(storage), true)
  complete(storage, { pathname: '/', search: '', hash: '' }, () => {})
  assert.equal(storage.getItem(KEY), 'done')
}

// --- no marker and no message → no re-arm
{
  lock = false
  const storage = new MemoryStorage()
  storage.setItem(KEY, 'done')
  assert.equal(capture(storage, { search: '' }), false)
  assert.equal(storage.getItem(KEY), 'done')
}

// Source contracts: host waits for auth, uses sendMessage('Briefing'), no /api/chat
{
  const host = read('src/components/MorningBriefingDeepLinkHost.tsx')
  assert.match(host, /useAuthBootstrap/)
  assert.match(host, /sendMessage\('Briefing'\)/)
  assert.match(host, /claimMorningBriefingHandoff/)
  assert.match(host, /completeMorningBriefingHandoff/)
  assert.match(host, /releaseMorningBriefingHandoffClaim/)
  assert.match(host, /MORNING_BRIEFING_SW_MESSAGE_TYPE/)
  assert.doesNotMatch(host, /\/api\/chat/)
  assert.doesNotMatch(host, /requestChatCompletion|openai/)
  // Must not consume/strip before handoff
  assert.doesNotMatch(host, /consumeMorningBriefingDeepLink/)
}

// SW: existing-window morning path posts message; reminder path unchanged
{
  const sw = read('public/sw.js')
  assert.match(sw, /shinkaido\.morning_briefing/)
  assert.match(sw, /postMessage/)
  assert.match(sw, /isMorning/)
  assert.match(sw, /deliverMorningIntent/)
  // Reminder branch still navigate-or-focus without morning postMessage requirement
  assert.match(sw, /\/\/ Reminder path/)
  assert.match(sw, /clients\.openWindow/)
  assert.match(sw, /briefing=morning/)
  assert.match(sw, /reminderId/)
}

// Schedule module exports the new API
{
  const mod = read('src/lib/morningBriefingSchedule.ts')
  assert.match(mod, /captureMorningBriefingIntent/)
  assert.match(mod, /claimMorningBriefingHandoff/)
  assert.match(mod, /completeMorningBriefingHandoff/)
  assert.match(mod, /hasPendingMorningBriefingIntent/)
  // No premature replaceState inside capture
  const captureBlock = mod.slice(
    mod.indexOf('export function captureMorningBriefingIntent'),
    mod.indexOf('export function hasPendingMorningBriefingIntent'),
  )
  assert.doesNotMatch(captureBlock, /replaceState/)
}

// Architecture freeze
assert.equal(Object.keys(JSON.parse(read('vercel.json')).functions).length, 11)
assert.doesNotMatch(read('src/components/MorningBriefingDeepLinkHost.tsx'), /requestDailyBriefingPack/)
assert.match(read('src/components/DueReminderHost.tsx'), /\?reminder=/)

console.log('morning-briefing-deeplink-334d1.test.mjs: ok')
