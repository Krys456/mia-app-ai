/**
 * Memory CRUD JWT isolation tests (Memory 2.0 Phase 1A.3).
 * Run: node lib/server/memory-api-auth.test.mjs
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AuthError } from './auth.js'
import {
  DEFAULT_API_USER_EMAIL,
  resolveMemoryUserId,
} from './brain-memory.js'
import { memoryOwnerScope, requireMemoryApiUser } from './memory-api-auth.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')

function mockRes() {
  /** @type {{ statusCode: number, body: any }} */
  const state = { statusCode: 0, body: null }
  return {
    state,
    setHeader() {},
    status(code) {
      state.statusCode = code
      return this
    },
    json(payload) {
      state.body = payload
      return this
    },
  }
}

// --- resolveMemoryUserId ---

{
  const id = await resolveMemoryUserId(
    { userId: 'auth-user-a', requireExplicitUserId: true },
    /** @type {any} */ ({}),
  )
  assert.equal(id, 'auth-user-a')
}

{
  try {
    await resolveMemoryUserId({ requireExplicitUserId: true }, /** @type {any} */ ({}))
    assert.fail('expected explicit userId error')
  } catch (error) {
    assert.match(String(error.message), /Explicit userId is required/)
  }
}

{
  let ensureCalled = false
  const fakeSupabase = {
    from() {
      ensureCalled = true
      throw new Error('ensureDefaultUserId must not run for explicit API scope')
    },
  }
  const id = await resolveMemoryUserId(
    { userId: 'only-explicit', requireExplicitUserId: true },
    /** @type {any} */ (fakeSupabase),
  )
  assert.equal(id, 'only-explicit')
  assert.equal(ensureCalled, false)
}

assert.equal(DEFAULT_API_USER_EMAIL, 'brain-api@local')

// --- memoryOwnerScope ---

{
  const scope = memoryOwnerScope('uid-a')
  assert.deepEqual(scope, { userId: 'uid-a', requireExplicitUserId: true })
}

// --- requireMemoryApiUser ---

{
  const res = mockRes()
  const owner = await requireMemoryApiUser(
    { headers: {} },
    res,
    {
      requireAuthenticatedUser: async () => {
        throw new AuthError('missing_token', 'Missing Authorization Bearer token')
      },
    },
  )
  assert.equal(owner, null)
  assert.equal(res.state.statusCode, 401)
  assert.equal(res.state.body?.code, 'missing_token')
}

{
  const res = mockRes()
  const owner = await requireMemoryApiUser(
    { headers: { authorization: 'Bearer bad' } },
    res,
    {
      requireAuthenticatedUser: async () => {
        throw new AuthError('invalid_token', 'Invalid JWT')
      },
    },
  )
  assert.equal(owner, null)
  assert.equal(res.state.statusCode, 401)
  assert.equal(res.state.body?.code, 'invalid_token')
}

{
  const res = mockRes()
  let ensuredFor = ''
  const owner = await requireMemoryApiUser(
    {
      headers: {
        authorization: 'Bearer good',
        'x-laife-user-id': 'forged-header',
      },
      body: { userId: 'forged-body' },
    },
    res,
    {
      requireAuthenticatedUser: async (req) => {
        // Prove forged ids are not used as authority by this helper.
        assert.notEqual(req.body?.userId, 'auth-uid-a')
        return {
          userId: 'auth-uid-a',
          isAnonymous: true,
          user: { id: 'auth-uid-a' },
          accessToken: 'good',
        }
      },
      getServiceSupabase: async () => ({ fake: true }),
      ensureAuthUserRow: async (_supabase, authUserId) => {
        ensuredFor = authUserId
        return authUserId
      },
    },
  )
  assert.ok(owner)
  assert.equal(owner.userId, 'auth-uid-a')
  assert.equal(ensuredFor, 'auth-uid-a')
  assert.notEqual(owner.userId, 'forged-body')
  assert.notEqual(owner.userId, 'forged-header')
  assert.equal(res.state.statusCode, 0)
}

// Isolation semantics for cross-user id access (scoped queries return null / 0)
{
  const store = new Map([
    ['mem-a', { id: 'mem-a', user_id: 'user-a', title: 'A' }],
    ['mem-b', { id: 'mem-b', user_id: 'user-b', title: 'B' }],
  ])

  function scopedGet(id, userId) {
    const row = store.get(id)
    if (!row || row.user_id !== userId) return null
    return row
  }
  function scopedList(userId) {
    return [...store.values()].filter((row) => row.user_id === userId)
  }
  function scopedDelete(id, userId) {
    const row = scopedGet(id, userId)
    if (!row) return false
    store.delete(id)
    return true
  }
  function scopedClear(userId) {
    let n = 0
    for (const [id, row] of store) {
      if (row.user_id === userId) {
        store.delete(id)
        n += 1
      }
    }
    return n
  }
  function scopedCreate(userId, title) {
    const id = `mem-${title}`
    store.set(id, { id, user_id: userId, title })
    return store.get(id)
  }

  assert.deepEqual(
    scopedList('user-a').map((r) => r.id),
    ['mem-a'],
  )
  assert.equal(scopedGet('mem-b', 'user-a'), null)
  assert.equal(scopedDelete('mem-b', 'user-a'), false)
  assert.ok(store.has('mem-b'))

  const created = scopedCreate('user-a', 'new')
  assert.equal(created.user_id, 'user-a')
  assert.notEqual(created.user_id, 'brain-api@local')

  const cleared = scopedClear('user-a')
  assert.equal(cleared, 2)
  assert.ok(store.has('mem-b'))
  assert.equal(scopedList('user-a').length, 0)
}

// --- Route source contracts ---

{
  const indexSrc = readFileSync(join(root, 'api/memories/index.ts'), 'utf8')
  const idSrc = readFileSync(join(root, 'api/memories/[id].ts'), 'utf8')
  const chatSrc = readFileSync(join(root, 'api/chat.ts'), 'utf8')
  const clientSrc = readFileSync(join(root, 'src/lib/memoryApi.ts'), 'utf8')
  const memoryTestSrc = readFileSync(join(root, 'api/memory-test.ts'), 'utf8')

  for (const [name, src] of [
    ['api/memories/index.ts', indexSrc],
    ['api/memories/[id].ts', idSrc],
  ]) {
    assert.match(src, /requireMemoryApiUser/, `${name} must require JWT user`)
    assert.match(src, /memoryOwnerScope/, `${name} must scope by owner`)
    assert.doesNotMatch(src, /assertMemoryAdminAccess/, `${name} must not use Phase 0 admin secret`)
    assert.doesNotMatch(src, /ensureDefaultUserId/, `${name} must not use default user`)
    assert.doesNotMatch(src, /brain-api@local/, `${name} must not reference shared fallback`)
  }

  assert.match(indexSrc, /requireExplicitUserId:\s*true/)
  assert.match(idSrc, /getMemoryById\(id,\s*scope\)/)
  assert.match(idSrc, /updateMemory\(id,.*scope\)/)
  assert.match(idSrc, /deleteMemory\(id,\s*scope\)/)

  // Chat Core memory writes still JWT-owned via paid-api-guard (#298A); one responses.create
  assert.doesNotMatch(chatSrc, /requireMemoryApiUser/)
  assert.match(chatSrc, /requirePaidApiAccess/)
  assert.equal((chatSrc.match(/\.responses\.create\s*\(/g) || []).length, 1)

  // Client sends Bearer from Supabase session
  assert.match(clientSrc, /Authorization/)
  assert.match(clientSrc, /getSession/)
  assert.match(clientSrc, /Bearer/)

  // memory-test keeps Phase 0 for non-production developer curl; production returns 404
  assert.match(memoryTestSrc, /assertMemoryAdminAccess/)
  assert.match(memoryTestSrc, /VERCEL_ENV === 'production'/)
}

console.log('ok: memory CRUD JWT isolation')
