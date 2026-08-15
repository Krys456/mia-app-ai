/**
 * Chat client auth → Bearer attachment for /api/chat (Phase 1A.4).
 * Run: node --experimental-strip-types src/lib/chatAuth.test.mjs
 */

import assert from 'node:assert/strict'
import { resetAuthBootstrapForTests } from './authSession.ts'
import { resolveChatAuthForRequest } from './chatAuth.ts'

function createClient(options = {}) {
  const {
    session = null,
    anonymousSession = {
      user: { id: 'anon-1', is_anonymous: true },
      access_token: 'recovered-token',
    },
    signInError = null,
    signInDelayMs = 0,
  } = options

  let current = session
  let signInCalls = 0

  return {
    client: {
      auth: {
        async initialize() {
          return { error: null }
        },
        async getSession() {
          return { data: { session: current }, error: null }
        },
        async signInAnonymously() {
          signInCalls += 1
          if (signInDelayMs > 0) {
            await new Promise((r) => setTimeout(r, signInDelayMs))
          }
          if (signInError) {
            return { data: { session: null, user: null }, error: { message: signInError } }
          }
          current = anonymousSession
          return {
            data: { session: anonymousSession, user: anonymousSession?.user ?? null },
            error: null,
          }
        },
      },
    },
    get signInCalls() {
      return signInCalls
    },
  }
}

resetAuthBootstrapForTests()

// Existing anonymous session → Bearer attached (no new sign-in)
{
  const mock = createClient({
    session: {
      user: { id: 'existing', is_anonymous: true },
      access_token: 'existing-token',
    },
  })

  const result = await resolveChatAuthForRequest({
    memoryEnabled: true,
    isConfigured: () => true,
    getClient: () => mock.client,
  })

  assert.equal(result.authorization, 'Bearer existing-token')
  assert.equal(mock.signInCalls, 0)
}

// Missing session → bootstrap/recover then Bearer attached
{
  const mock = createClient({ session: null })

  const result = await resolveChatAuthForRequest({
    memoryEnabled: true,
    isConfigured: () => true,
    getClient: () => mock.client,
  })

  assert.equal(result.authorization, 'Bearer recovered-token')
  assert.equal(mock.signInCalls, 1)
}

// Slow sign-in: concurrent chat resolves await the same in-flight sign-in
{
  const mock = createClient({ session: null, signInDelayMs: 40 })

  const [a, b] = await Promise.all([
    resolveChatAuthForRequest({
      memoryEnabled: true,
      isConfigured: () => true,
      getClient: () => mock.client,
    }),
    resolveChatAuthForRequest({
      memoryEnabled: true,
      isConfigured: () => true,
      getClient: () => mock.client,
    }),
  ])

  assert.equal(a.authorization, 'Bearer recovered-token')
  assert.equal(b.authorization, 'Bearer recovered-token')
  assert.equal(mock.signInCalls, 1)
}

// Reload / second call reuses session — still one identity, Bearer attached
{
  const mock = createClient({ session: null })

  const first = await resolveChatAuthForRequest({
    memoryEnabled: true,
    isConfigured: () => true,
    getClient: () => mock.client,
  })
  assert.equal(first.authorization, 'Bearer recovered-token')
  assert.equal(mock.signInCalls, 1)

  const second = await resolveChatAuthForRequest({
    memoryEnabled: true,
    isConfigured: () => true,
    getClient: () => mock.client,
  })
  assert.equal(second.authorization, 'Bearer recovered-token')
  assert.equal(mock.signInCalls, 1)
}

// Auth bootstrap failure → no Bearer; chat path can continue without memory
{
  const mock = createClient({ session: null, signInError: 'Anonymous provider disabled' })

  const result = await resolveChatAuthForRequest({
    memoryEnabled: true,
    isConfigured: () => true,
    getClient: () => mock.client,
  })

  assert.equal(result.authorization, null)
}

// Supabase not configured → no Bearer
{
  const result = await resolveChatAuthForRequest({
    memoryEnabled: true,
    isConfigured: () => false,
    getClient: () => {
      throw new Error('should not create client')
    },
  })

  assert.equal(result.authorization, null)
}

// Memory OFF does not force anonymous sign-in
{
  const mock = createClient({ session: null })

  const result = await resolveChatAuthForRequest({
    memoryEnabled: false,
    isConfigured: () => true,
    getClient: () => mock.client,
  })

  assert.equal(mock.signInCalls, 0)
  assert.equal(result.authorization, null)
}

// Memory OFF still attaches Bearer when session already exists
{
  const mock = createClient({
    session: {
      user: { id: 'existing', is_anonymous: true },
      access_token: 'existing-token',
    },
  })

  const result = await resolveChatAuthForRequest({
    memoryEnabled: false,
    isConfigured: () => true,
    getClient: () => mock.client,
  })

  assert.equal(mock.signInCalls, 0)
  assert.equal(result.authorization, 'Bearer existing-token')
}

// Authorization header merge: resolve output is a full Bearer value (not dropped)
{
  const mock = createClient({
    session: {
      user: { id: 'existing', is_anonymous: true },
      access_token: 'hdr-token',
    },
  })
  const auth = await resolveChatAuthForRequest({
    memoryEnabled: true,
    isConfigured: () => true,
    getClient: () => mock.client,
  })
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
  if (auth.authorization) headers.Authorization = auth.authorization

  assert.equal(headers.Authorization, 'Bearer hdr-token')
}

console.log('ok: chatAuth Bearer resolution')
