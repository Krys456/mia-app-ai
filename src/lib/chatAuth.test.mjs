/**
 * Chat client auth → Bearer attachment for /api/chat (Phase 1A.4).
 * Run: node --experimental-strip-types src/lib/chatAuth.test.mjs
 */

import assert from 'node:assert/strict'
import { resetAuthBootstrapForTests } from './authSession.ts'
import { resolveChatAuthForRequest, chatAuthFlowDiagFields } from './chatAuth.ts'

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

  assert.equal(result.clientBearerAttached, true)
  assert.equal(result.authorization, 'Bearer existing-token')
  assert.equal(result.clientAuthHint, 'present')
  assert.equal(result.supabaseConfigured, true)
  assert.equal(result.flowDiag.sessionHasAccessToken, true)
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

  assert.equal(result.clientBearerAttached, true)
  assert.equal(result.authorization, 'Bearer recovered-token')
  assert.equal(result.recoveredSession, true)
  assert.equal(result.flowDiag.signInAttempted, true)
  assert.equal(result.flowDiag.signInSucceeded, true)
  assert.equal(mock.signInCalls, 1)
}

// Slow sign-in: concurrent chat resolves await the same in-flight sign-in (no second user)
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
  assert.equal(second.recoveredSession, false)
  assert.equal(mock.signInCalls, 1)
}

// Auth bootstrap failure → no Bearer; diag captures error; chat path can continue
{
  const mock = createClient({ session: null, signInError: 'Anonymous provider disabled' })

  const result = await resolveChatAuthForRequest({
    memoryEnabled: true,
    isConfigured: () => true,
    getClient: () => mock.client,
  })

  assert.equal(result.clientBearerAttached, false)
  assert.equal(result.authorization, null)
  assert.equal(result.clientAuthHint, 'absent')
  assert.equal(result.bootstrapStatus, 'error')
  assert.equal(result.flowDiag.signInFailed, true)
  assert.match(result.flowDiag.authErrorMessage || '', /Anonymous provider disabled/)

  const flat = chatAuthFlowDiagFields(result)
  assert.equal(flat.signInFailed, true)
  assert.ok(flat.authErrorMessage)
}

// Supabase not configured → unconfigured, no Bearer
{
  const result = await resolveChatAuthForRequest({
    memoryEnabled: true,
    isConfigured: () => false,
    getClient: () => {
      throw new Error('should not create client')
    },
  })

  assert.equal(result.supabaseConfigured, false)
  assert.equal(result.clientAuthHint, 'unconfigured')
  assert.equal(result.authorization, null)
  assert.equal(result.clientBearerAttached, false)
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
  assert.equal(result.clientAuthHint, 'absent')
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
  assert.equal(result.clientBearerAttached, true)
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
  headers['X-LAIfe-Client-Auth'] = auth.clientAuthHint

  assert.equal(headers.Authorization, 'Bearer hdr-token')
  assert.equal(headers['X-LAIfe-Client-Auth'], 'present')
}

console.log('ok: chatAuth Bearer resolution')
