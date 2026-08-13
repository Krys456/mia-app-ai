#!/usr/bin/env node
/**
 * Chat persistence resilience tests (A–O).
 * Run: node --experimental-strip-types src/lib/chatPersistence/chat-persistence.test.mjs
 */

import { webcrypto } from 'node:crypto'

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
  deleteCachedConversation,
  getActiveConversationId,
  listCachedConversations,
  loadActiveConversationForStartup,
  loadCachedConversation,
  persistActiveSnapshot,
  saveCachedConversation,
  setActiveConversationId,
} = await import('./localCache.ts')

const {
  reconcileConversations,
  reconcileMessages,
  reconstructConversationStateFromMessages,
  isUsableConversationState,
} = await import('./reconcile.ts')

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

function msg(id, role, content, createdAt = Date.now()) {
  return { id, role, content, createdAt, syncStatus: 'pending' }
}

console.log('Chat persistence tests\n')

test('A. Refresh preserves chat (startup loads cache)', () => {
  const id = createConversationId()
  persistActiveSnapshot({
    conversationId: id,
    messages: [
      msg('u1', 'user', 'Ciao', 1),
      msg('a1', 'assistant', 'Ciao!', 2),
      msg('u2', 'user', 'Come stai?', 3),
    ],
  })
  // Simulate refresh: new load
  const loaded = loadActiveConversationForStartup()
  assert(loaded, 'loaded')
  assertEqual(loaded.conversationId, id, 'id')
  assertEqual(loaded.messages.length, 3, 'count')
  assertEqual(loaded.messages[0].content, 'Ciao', 'first')
})

test('B. Navigation away/back preserves active id + messages', () => {
  const id = createConversationId()
  setActiveConversationId(id)
  persistActiveSnapshot({
    conversationId: id,
    messages: [msg('u1', 'user', 'Mi annoio', 1)],
  })
  assertEqual(getActiveConversationId(), id, 'active')
  const again = loadCachedConversation(id)
  assertEqual(again?.messages.length, 1, 'still there')
})

test('C. Offline save failure does not remove user message', () => {
  const id = createConversationId()
  const snap = persistActiveSnapshot({
    conversationId: id,
    messages: [msg('u1', 'user', 'Offline msg', 1)],
    syncStatus: 'error',
  })
  assert(snap)
  assertEqual(loadCachedConversation(id)?.messages[0].content, 'Offline msg', 'kept')
  assertEqual(loadCachedConversation(id)?.syncStatus, 'error', 'error status')
})

test('D. Assistant save failure does not remove assistant message', () => {
  const id = createConversationId()
  persistActiveSnapshot({
    conversationId: id,
    messages: [
      msg('u1', 'user', 'Hi', 1),
      { ...msg('a1', 'assistant', 'Hello there', 2), syncStatus: 'error' },
    ],
    syncStatus: 'error',
  })
  assertEqual(loadCachedConversation(id)?.messages.length, 2, 'both kept')
})

test('E. Reconnect retries unsynced messages (pending retained)', () => {
  const id = createConversationId()
  persistActiveSnapshot({
    conversationId: id,
    messages: [{ ...msg('u1', 'user', 'queued', 1), syncStatus: 'pending' }],
    syncStatus: 'pending',
  })
  const cached = loadCachedConversation(id)
  assert(cached.messages.some((m) => m.syncStatus === 'pending'), 'pending')
})

test('F. Empty remote fetch does not wipe local cache', () => {
  const id = createConversationId()
  const local = {
    conversationId: id,
    title: 'Local',
    messages: [msg('u1', 'user', 'Keep me', 1)],
    updatedAt: 10,
    createdAt: 1,
    engine: 'v1',
    conversationState: null,
    syncStatus: 'pending',
  }
  const merged = reconcileConversations(local, {
    ...local,
    messages: [],
    syncStatus: 'synced',
  })
  assertEqual(merged.messages.length, 1, 'kept local')
  assertEqual(merged.messages[0].content, 'Keep me', 'content')
})

test('G. Local+remote reconciliation does not duplicate messages', () => {
  const local = [msg('u1', 'user', 'Ciao', 1), msg('a1', 'assistant', 'Hey', 2)]
  const remote = [
    { ...msg('u1', 'user', 'Ciao', 1), serverId: 's1', syncStatus: 'synced' },
    { ...msg('a1', 'assistant', 'Hey', 2), serverId: 's2', syncStatus: 'synced' },
    msg('u2', 'user', 'Extra', 3),
  ]
  const merged = reconcileMessages(local, remote)
  assertEqual(merged.length, 3, 'deduped to 3')
  assertEqual(merged.filter((m) => m.content === 'Ciao').length, 1, 'one ciao')
})

test('H. New Chat does not overwrite old conversation', () => {
  const oldId = createConversationId()
  persistActiveSnapshot({
    conversationId: oldId,
    messages: [msg('u1', 'user', 'Old chat', 1)],
  })
  const newId = createConversationId()
  setActiveConversationId(newId)
  persistActiveSnapshot({
    conversationId: newId,
    messages: [],
  })
  assertEqual(loadCachedConversation(oldId)?.messages[0].content, 'Old chat', 'old kept')
  assert(listCachedConversations().some((c) => c.conversationId === oldId), 'in index')
})

test('I. Engine field preserved across snapshots (V1/V2 toggle safe)', () => {
  const id = createConversationId()
  persistActiveSnapshot({
    conversationId: id,
    messages: [msg('u1', 'user', 'Hi', 1)],
    engine: 'v2',
  })
  persistActiveSnapshot({
    conversationId: id,
    messages: [
      msg('u1', 'user', 'Hi', 1),
      msg('a1', 'assistant', 'Hey', 2),
    ],
    engine: 'v2',
  })
  assertEqual(loadCachedConversation(id)?.engine, 'v2', 'engine')
})

test('J. Conversation State restores with correct conversation', () => {
  const id = createConversationId()
  persistActiveSnapshot({
    conversationId: id,
    messages: [msg('u1', 'user', 'Topic X', 1)],
    conversationState: { activeTopic: 'Topic X', conversationId: id },
  })
  const loaded = loadCachedConversation(id)
  assertEqual(loaded?.conversationState?.activeTopic, 'Topic X', 'state')
  assertEqual(loaded?.conversationState?.conversationId, id, 'id match')
})

test('K. Malformed Conversation State reconstructs safely', () => {
  assertEqual(isUsableConversationState(null), false, 'null')
  assertEqual(isUsableConversationState('x'), false, 'string')
  const rebuilt = reconstructConversationStateFromMessages(
    [msg('u1', 'user', 'Mi annoio', 1)],
    'cid-1',
  )
  assert(rebuilt.reconstructed === true, 'flag')
  assertEqual(rebuilt.conversationId, 'cid-1', 'id')
})

test('L. Explicit delete deletes only selected conversation', () => {
  const a = createConversationId()
  const b = createConversationId()
  persistActiveSnapshot({ conversationId: a, messages: [msg('1', 'user', 'A', 1)] })
  persistActiveSnapshot({ conversationId: b, messages: [msg('2', 'user', 'B', 1)] })
  deleteCachedConversation(a)
  assertEqual(loadCachedConversation(a), null, 'a gone')
  assertEqual(loadCachedConversation(b)?.messages[0].content, 'B', 'b kept')
})

test('M. Persistence failure is isolated (local remains after error status)', () => {
  const id = createConversationId()
  persistActiveSnapshot({
    conversationId: id,
    messages: [msg('u1', 'user', 'Survives', 1)],
    syncStatus: 'error',
  })
  // Simulates API failure logged elsewhere — cache intact
  assert(loadCachedConversation(id), 'still present')
})

test('N. Rapid refresh after send preserves optimistic message', () => {
  const id = createConversationId()
  persistActiveSnapshot({
    conversationId: id,
    messages: [msg('opt-1', 'user', 'Optimistic', Date.now())],
    syncStatus: 'pending',
  })
  const loaded = loadActiveConversationForStartup()
  assert(loaded.messages.some((m) => m.content === 'Optimistic'), 'optimistic kept')
})

test('O. Assistant response persists across refresh before server sync', () => {
  const id = createConversationId()
  persistActiveSnapshot({
    conversationId: id,
    messages: [
      msg('u1', 'user', 'Ciao', 1),
      { ...msg('a1', 'assistant', 'Risposta lunga', 2), syncStatus: 'pending' },
    ],
    syncStatus: 'pending',
  })
  const loaded = loadActiveConversationForStartup()
  assertEqual(loaded.messages.length, 2, 'both')
  assertEqual(loaded.messages[1].content, 'Risposta lunga', 'assistant')
})

test('stable conversation id is not regenerated on save', () => {
  const id = createConversationId()
  persistActiveSnapshot({ conversationId: id, messages: [msg('u1', 'user', 'x', 1)] })
  persistActiveSnapshot({
    conversationId: id,
    messages: [msg('u1', 'user', 'x', 1), msg('a1', 'assistant', 'y', 2)],
  })
  assertEqual(loadCachedConversation(id)?.conversationId, id, 'same')
})

test('null remote does not erase local', () => {
  const local = {
    conversationId: 'c1',
    title: 'T',
    messages: [msg('u1', 'user', 'Hi', 1)],
    updatedAt: 1,
    createdAt: 1,
    engine: 'v1',
    conversationState: null,
    syncStatus: 'pending',
  }
  const merged = reconcileConversations(local, null)
  assertEqual(merged.messages.length, 1, 'kept')
})

console.log('')
if (failed > 0) {
  console.error(`FAILED: ${failed}  passed: ${passed}`)
  process.exit(1)
}
console.log(`All ${passed} tests passed.`)
process.exit(0)
