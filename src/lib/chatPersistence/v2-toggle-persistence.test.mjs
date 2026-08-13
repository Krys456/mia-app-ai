#!/usr/bin/env node
/**
 * Regression: V2 Experimental toggle must survive chat-persistence work.
 * Run: npx tsx src/lib/chatPersistence/v2-toggle-persistence.test.mjs
 */

import { webcrypto } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

class MemoryStorage {
  constructor() {
    this.map = new Map()
  }
  getItem(key) {
    return this.map.has(key) ? this.map.get(key) : null
  }
  setItem(key, value) {
    this.map.set(String(key), String(value))
  }
  removeItem(key) {
    this.map.delete(String(key))
  }
  clear() {
    this.map.clear()
  }
}

globalThis.localStorage = new MemoryStorage()
if (!globalThis.crypto?.randomUUID) {
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    configurable: true,
  })
}

const {
  clearChatPersistenceForTests,
  createConversationId,
  getActiveConversationId,
  loadCachedConversation,
  persistActiveSnapshot,
  setActiveConversationId,
} = await import('./localCache.ts')

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..')

let passed = 0
let failed = 0

function test(name, fn) {
  clearChatPersistenceForTests()
  globalThis.localStorage = new MemoryStorage()
  try {
    fn()
    passed += 1
    console.log(`  ok  — ${name}`)
  } catch (error) {
    failed += 1
    console.error(`  FAIL — ${name}`)
    console.error(`        ${error instanceof Error ? error.message : String(error)}`)
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

function assertEqual(a, b, msg) {
  if (a !== b) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`)
}

function readSrc(rel) {
  return readFileSync(join(root, rel), 'utf8')
}

console.log('V2 toggle × persistence regression tests\n')

test('SettingsDrawer still renders LAIfe V2 Experimental ON/OFF', () => {
  const src = readSrc('src/components/SettingsDrawer.tsx')
  assert(/LAIfe V2 Experimental/.test(src), 'label present')
  assert(/updateDeveloper\(\{ v2Experimental: true \}\)/.test(src), 'ON handler')
  assert(/updateDeveloper\(\{ v2Experimental: false \}\)/.test(src), 'OFF handler')
  assert(/settings-developer/.test(src), 'developer section')
})

test('types expose DeveloperSettings.v2Experimental', () => {
  const src = readSrc('src/types.ts')
  assert(/export interface DeveloperSettings/.test(src), 'DeveloperSettings')
  assert(/v2Experimental: boolean/.test(src), 'flag')
  assert(/developer: DeveloperSettings/.test(src), 'on AppSettings')
  assert(/export interface V2DebugInfo/.test(src), 'V2DebugInfo kept')
})

test('ChatContext updateDeveloper does not create a new conversation id', () => {
  const src = readSrc('src/context/ChatContext.tsx')
  assert(/UPDATE_DEVELOPER/.test(src), 'developer action')
  assert(/updateDeveloper/.test(src), 'callback exported')
  // Toggle must mirror engine without NEW_CHAT
  const updateBlock = src.slice(src.indexOf('const updateDeveloper'), src.indexOf('const runAssistantCompletion'))
  assert(!/NEW_CHAT/.test(updateBlock), 'no NEW_CHAT in updateDeveloper')
  assert(!/createConversationId\(\)/.test(updateBlock), 'no new id in updateDeveloper')
  assert(/engine: nextV2 \? 'v2' : 'v1'/.test(updateBlock) || /v2Experimental/.test(updateBlock), 'mirrors engine')
})

test('ChatContext requests use settings.developer.v2Experimental for engine', () => {
  const src = readSrc('src/context/ChatContext.tsx')
  assert(/const useV2 = developer\.v2Experimental === true/.test(src), 'useV2 from toggle')
  assert(/engine: 'v2' as const/.test(src), 'sends v2')
  assert(/engine: 'v1' as const/.test(src), 'sends v1')
  assert(/developerMode: true/.test(src), 'developerMode')
})

test('Hydration must not override Developer toggle from cached engine', () => {
  const src = readSrc('src/context/ChatContext.tsx')
  assert(
    /Do not let remote\/cached engine override the Developer toggle/.test(src) ||
      /engine: state\.settings\.developer\?\.v2Experimental \? 'v2' : 'v1'/.test(src),
    'hydrate prefers toggle',
  )
  assert(
    /Source of truth for routing remains settings\.developer\.v2Experimental/.test(src) ||
      /engineFromToggle/.test(src),
    'initial state prefers toggle',
  )
})

test('Header.tsx did not remove V2 toggle (toggle lives in SettingsDrawer)', () => {
  const header = readSrc('src/components/Header.tsx')
  // Persistence only changed confirm copy — no V2 control lived in Header.
  assert(!/v2Experimental/.test(header), 'Header never owned the toggle')
  assert(/resta salvata nella cronologia/.test(header), 'persistence confirm copy only')
})

test('Switching engine metadata keeps same conversationId in cache', () => {
  const id = createConversationId()
  setActiveConversationId(id)
  persistActiveSnapshot({
    conversationId: id,
    messages: [{ id: 'u1', role: 'user', content: 'Ciao', createdAt: 1 }],
    engine: 'v1',
  })
  // Simulate toggle ON → mirror engine on same id
  persistActiveSnapshot({
    conversationId: id,
    messages: [{ id: 'u1', role: 'user', content: 'Ciao', createdAt: 1 }],
    engine: 'v2',
  })
  assertEqual(getActiveConversationId(), id, 'same active id')
  assertEqual(loadCachedConversation(id)?.engine, 'v2', 'engine mirrored')
  assertEqual(loadCachedConversation(id)?.messages.length, 1, 'messages kept')
})

test('V2DebugPanel still present for diagnostics', () => {
  const panel = readSrc('src/components/chat/V2DebugPanel.tsx')
  const bubble = readSrc('src/components/chat/MessageBubble.tsx')
  assert(/V2 Experimental/.test(panel), 'badge')
  assert(/showV2Debug/.test(bubble), 'bubble gates on toggle')
  assert(/settings\.developer\?\.v2Experimental === true/.test(bubble), 'uses toggle')
})

console.log('')
if (failed > 0) {
  console.error(`FAILED: ${failed}  passed: ${passed}`)
  process.exit(1)
}
console.log(`All ${passed} tests passed.`)
process.exit(0)
