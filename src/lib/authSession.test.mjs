/**
 * Phase 1A step 1 — silent anonymous auth bootstrap tests.
 * Run: node --experimental-strip-types src/lib/authSession.test.mjs
 */

import assert from 'node:assert/strict'
import {
  bootstrapLaifeAuth,
  ensureAnonymousAuthSession,
  resetAuthBootstrapForTests,
} from './authSession.ts'

function createMockClient(options = {}) {
  const {
    sessionUser = null,
    sessionAccessToken = sessionUser ? 'existing-access-token' : null,
    getSessionError = null,
    anonymousUser = { id: 'anon-1', is_anonymous: true },
    anonymousAccessToken = 'anon-access-token',
    signInError = null,
    throwOnGetSession = false,
    persistSignInToGetSession = true,
  } = options

  let signInCalls = 0
  let getSessionCalls = 0
  let persistedUser = sessionUser
  let persistedToken = sessionAccessToken

  const client = {
    auth: {
      async initialize() {
        return { error: null }
      },
      async getSession() {
        getSessionCalls += 1
        if (throwOnGetSession) throw new Error('getSession exploded')
        if (getSessionError) {
          return { data: { session: null }, error: { message: getSessionError } }
        }
        return {
          data: {
            session: persistedUser
              ? { user: persistedUser, access_token: persistedToken }
              : null,
          },
          error: null,
        }
      },
      async signInAnonymously() {
        signInCalls += 1
        if (signInError) {
          return { data: { session: null, user: null }, error: { message: signInError } }
        }
        if (persistSignInToGetSession && anonymousUser) {
          persistedUser = anonymousUser
          persistedToken = anonymousAccessToken
        }
        return {
          data: {
            session: anonymousUser
              ? { user: anonymousUser, access_token: anonymousAccessToken }
              : null,
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

resetAuthBootstrapForTests()

// Existing session reused — no anonymous sign-in; token returned
{
  const mock = createMockClient({
    sessionUser: { id: 'existing-user', is_anonymous: true },
    sessionAccessToken: 'tok-existing',
  })
  const result = await ensureAnonymousAuthSession(mock.client)
  assert.equal(result.status, 'ready')
  assert.equal(result.userId, 'existing-user')
  assert.equal(result.accessToken, 'tok-existing')
  assert.equal(result.signedInAnonymously, false)
  assert.equal(result.diag.sessionHasAccessToken, true)
  assert.equal(mock.signInCalls, 0)
}

// Missing session creates anonymous sign-in with access token
{
  const mock = createMockClient({ sessionUser: null })
  const result = await ensureAnonymousAuthSession(mock.client)
  assert.equal(result.status, 'ready')
  assert.equal(result.userId, 'anon-1')
  assert.equal(result.isAnonymous, true)
  assert.equal(result.signedInAnonymously, true)
  assert.equal(result.accessToken, 'anon-access-token')
  assert.equal(result.diag.signInAttempted, true)
  assert.equal(result.diag.signInSucceeded, true)
  assert.equal(mock.signInCalls, 1)
}

// Concurrent ensures share one anonymous sign-in (no duplicate identities)
{
  let signInStarts = 0
  let releaseSignIn
  const gate = new Promise((resolve) => {
    releaseSignIn = resolve
  })
  const client = {
    auth: {
      async initialize() {
        return { error: null }
      },
      async getSession() {
        return { data: { session: null }, error: null }
      },
      async signInAnonymously() {
        signInStarts += 1
        await gate
        return {
          data: {
            session: {
              user: { id: 'anon-shared', is_anonymous: true },
              access_token: 'shared-token',
            },
            user: { id: 'anon-shared', is_anonymous: true },
          },
          error: null,
        }
      },
    },
  }

  const p1 = ensureAnonymousAuthSession(client)
  const p2 = ensureAnonymousAuthSession(client)
  await Promise.resolve()
  releaseSignIn()
  const [a, b] = await Promise.all([p1, p2])
  assert.equal(signInStarts, 1)
  assert.equal(a.userId, 'anon-shared')
  assert.equal(b.userId, 'anon-shared')
  assert.equal(a.accessToken, 'shared-token')
  assert.equal(b.accessToken, 'shared-token')
}

// Session with user but no access token recovers via anonymous sign-in
{
  const mock = createMockClient({
    sessionUser: { id: 'partial-user', is_anonymous: true },
    sessionAccessToken: null,
    anonymousUser: { id: 'recovered-user', is_anonymous: true },
    anonymousAccessToken: 'recovered-token',
  })
  const result = await ensureAnonymousAuthSession(mock.client)
  assert.equal(result.status, 'ready')
  assert.equal(result.accessToken, 'recovered-token')
  assert.equal(result.diag.signInAttempted, true)
  assert.equal(mock.signInCalls, 1)
}

// bootstrap with injected client returns token (sign-in path)
{
  resetAuthBootstrapForTests()
  let signInStarts = 0
  const client = {
    auth: {
      async initialize() {
        return { error: null }
      },
      async getSession() {
        return { data: { session: null }, error: null }
      },
      async signInAnonymously() {
        signInStarts += 1
        return {
          data: {
            session: {
              user: { id: 'flight-user', is_anonymous: true },
              access_token: 'flight-token',
            },
            user: { id: 'flight-user', is_anonymous: true },
          },
          error: null,
        }
      },
    },
  }

  const boot = await bootstrapLaifeAuth({
    isConfigured: () => true,
    getClient: () => client,
  })
  assert.equal(boot.status, 'ready')
  assert.equal(boot.accessToken, 'flight-token')
  assert.equal(signInStarts, 1)
}

// Reload simulation: second ensure with persisted session does not create a second identity
{
  const persisted = { id: 'anon-stable', is_anonymous: true }
  const first = createMockClient({
    sessionUser: null,
    anonymousUser: persisted,
    anonymousAccessToken: 'stable-token',
  })
  const firstResult = await ensureAnonymousAuthSession(first.client)
  assert.equal(firstResult.userId, 'anon-stable')
  assert.equal(firstResult.accessToken, 'stable-token')
  assert.equal(first.signInCalls, 1)

  const second = createMockClient({
    sessionUser: persisted,
    sessionAccessToken: 'stable-token',
  })
  const secondResult = await ensureAnonymousAuthSession(second.client)
  assert.equal(secondResult.userId, 'anon-stable')
  assert.equal(secondResult.accessToken, 'stable-token')
  assert.equal(secondResult.signedInAnonymously, false)
  assert.equal(second.signInCalls, 0)
}

// Auth failure does not throw / crash — diag captures sanitized error
{
  const mock = createMockClient({ signInError: 'Anonymous provider disabled' })
  const result = await ensureAnonymousAuthSession(mock.client)
  assert.equal(result.status, 'error')
  assert.equal(result.accessToken, null)
  assert.equal(result.diag.signInFailed, true)
  assert.match(result.error || '', /Anonymous provider disabled/)
  assert.match(result.diag.authErrorMessage || '', /Anonymous provider disabled/)
}

{
  const mock = createMockClient({ throwOnGetSession: true })
  const result = await ensureAnonymousAuthSession(mock.client)
  assert.equal(result.status, 'error')
  assert.match(result.error || '', /getSession exploded/)
}

// Sign-in without access token is an error (cannot attach Bearer)
{
  const mock = createMockClient({
    sessionUser: null,
    anonymousAccessToken: null,
    persistSignInToGetSession: false,
  })
  mock.client.auth.signInAnonymously = async () => ({
    data: {
      session: { user: { id: 'anon-notoken', is_anonymous: true } },
      user: { id: 'anon-notoken', is_anonymous: true },
    },
    error: null,
  })
  const result = await ensureAnonymousAuthSession(mock.client)
  assert.equal(result.status, 'error')
  assert.match(result.error || '', /no access token/)
  assert.equal(result.diag.signInFailed, true)
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
  assert.equal(result.accessToken, null)
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
