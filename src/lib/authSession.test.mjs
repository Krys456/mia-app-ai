/**
 * Phase 1A step 1 — silent anonymous auth bootstrap tests.
 * Run: node --experimental-strip-types src/lib/authSession.test.mjs
 * (or: node with ts stripped via vitest-less pure JS mirror)
 */

import assert from 'node:assert/strict'
import {
  bootstrapLaifeAuth,
  ensureAnonymousAuthSession,
} from './authSession.ts'

function createMockClient(options) {
  const {
    sessionUser = null,
    getSessionError = null,
    anonymousUser = { id: 'anon-1', is_anonymous: true },
    signInError = null,
    throwOnGetSession = false,
  } = options

  let signInCalls = 0
  let getSessionCalls = 0

  const client = {
    auth: {
      async getSession() {
        getSessionCalls += 1
        if (throwOnGetSession) throw new Error('getSession exploded')
        if (getSessionError) {
          return { data: { session: null }, error: { message: getSessionError } }
        }
        return {
          data: {
            session: sessionUser ? { user: sessionUser } : null,
          },
          error: null,
        }
      },
      async signInAnonymously() {
        signInCalls += 1
        if (signInError) {
          return { data: { session: null, user: null }, error: { message: signInError } }
        }
        return {
          data: {
            session: anonymousUser ? { user: anonymousUser } : null,
            user: anonymousUser,
          },
          error: null,
        }
      },
    },
  }

  return {
    client,
    get signInCalls() {
      return signInCalls
    },
    get getSessionCalls() {
      return getSessionCalls
    },
  }
}

// Existing session reused — no anonymous sign-in
{
  const mock = createMockClient({
    sessionUser: { id: 'existing-user', is_anonymous: true },
  })
  const result = await ensureAnonymousAuthSession(mock.client)
  assert.equal(result.status, 'ready')
  assert.equal(result.userId, 'existing-user')
  assert.equal(result.signedInAnonymously, false)
  assert.equal(mock.signInCalls, 0)
}

// Missing session creates anonymous sign-in
{
  const mock = createMockClient({ sessionUser: null })
  const result = await ensureAnonymousAuthSession(mock.client)
  assert.equal(result.status, 'ready')
  assert.equal(result.userId, 'anon-1')
  assert.equal(result.isAnonymous, true)
  assert.equal(result.signedInAnonymously, true)
  assert.equal(mock.signInCalls, 1)
}

// Reload simulation: second ensure with persisted session does not create a second identity
{
  const persisted = { id: 'anon-stable', is_anonymous: true }
  const first = createMockClient({ sessionUser: null, anonymousUser: persisted })
  const firstResult = await ensureAnonymousAuthSession(first.client)
  assert.equal(firstResult.userId, 'anon-stable')
  assert.equal(first.signInCalls, 1)

  const second = createMockClient({ sessionUser: persisted })
  const secondResult = await ensureAnonymousAuthSession(second.client)
  assert.equal(secondResult.userId, 'anon-stable')
  assert.equal(secondResult.signedInAnonymously, false)
  assert.equal(second.signInCalls, 0)
}

// Auth failure does not throw / crash
{
  const mock = createMockClient({ signInError: 'Anonymous provider disabled' })
  const result = await ensureAnonymousAuthSession(mock.client)
  assert.equal(result.status, 'error')
  assert.match(result.error || '', /Anonymous provider disabled/)
}

{
  const mock = createMockClient({ throwOnGetSession: true })
  const result = await ensureAnonymousAuthSession(mock.client)
  assert.equal(result.status, 'error')
  assert.match(result.error || '', /getSession exploded/)
}

// bootstrap skips when not configured
{
  const result = await bootstrapLaifeAuth({
    isConfigured: () => false,
    getClient: () => {
      throw new Error('should not create client')
    },
  })
  assert.equal(result.status, 'skipped')
}

// bootstrap soft-fails when getClient throws
{
  const result = await bootstrapLaifeAuth({
    isConfigured: () => true,
    getClient: () => {
      throw new Error('client boom')
    },
  })
  assert.equal(result.status, 'error')
  assert.match(result.error || '', /client boom/)
}

console.log('ok: authSession anonymous bootstrap')
