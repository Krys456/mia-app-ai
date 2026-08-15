/**
 * Client→server memory-write flow contracts for PR #242.
 *
 * Proves auth attachment, owner resolve, pipeline gates, and Core invariants
 * without temporary memoryDiag UI.
 *
 * Run: node --experimental-strip-types src/lib/chat-memory-flow.test.mjs
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AuthError } from '../../lib/server/auth.js'
import { resolveChatMemoryOwnerUserId } from '../../lib/server/chat-memory-auth.js'
import { analyzeConversation } from '../../lib/server/brain-memory.js'
import { buildCoreResponsesCreateParams } from '../../lib/server/core-responses-params.js'
import { resolveChatAuthForRequest } from './chatAuth.ts'
import { resetAuthBootstrapForTests } from './authSession.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')

function createAuthClient(options = {}) {
  const {
    session = null,
    anonymousSession = {
      user: { id: 'anon-flow', is_anonymous: true },
      access_token: 'flow-access-token',
    },
    signInError = null,
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

/** Mirrors src/lib/chatApi.ts: resolve auth → Authorization header for /api/chat. */
async function buildChatRequestAuthHeaders(payload, authOptions) {
  const headers = { 'Content-Type': 'application/json' }
  const auth = await resolveChatAuthForRequest({
    memoryEnabled: payload.memoryEnabled !== false,
    ...authOptions,
  })
  if (auth.authorization) {
    headers.Authorization = auth.authorization
  }
  return { headers, auth }
}

resetAuthBootstrapForTests()

// 1) memory ON + existing anonymous session → /api/chat receives Bearer
{
  const mock = createAuthClient({
    session: {
      user: { id: 'existing', is_anonymous: true },
      access_token: 'existing-jwt',
    },
  })
  const { headers, auth } = await buildChatRequestAuthHeaders(
    { memoryEnabled: true },
    { isConfigured: () => true, getClient: () => mock.client },
  )
  assert.equal(auth.authorization, 'Bearer existing-jwt')
  assert.equal(headers.Authorization, 'Bearer existing-jwt')
  assert.equal(mock.signInCalls, 0)
}

// 2) memory ON + no session → bootstrap completes and Bearer is attached
{
  const mock = createAuthClient({ session: null })
  const { headers } = await buildChatRequestAuthHeaders(
    { memoryEnabled: true },
    { isConfigured: () => true, getClient: () => mock.client },
  )
  assert.equal(headers.Authorization, 'Bearer flow-access-token')
  assert.equal(mock.signInCalls, 1)
}

// 2b) concurrent ensureAnonymousAuthSession → one sign-in (mount/chat race lock)
{
  resetAuthBootstrapForTests()
  let signInCalls = 0
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
        signInCalls += 1
        await gate
        return {
          data: {
            session: {
              user: { id: 'shared-anon', is_anonymous: true },
              access_token: 'shared-token',
            },
            user: { id: 'shared-anon', is_anonymous: true },
          },
          error: null,
        }
      },
    },
  }

  const { ensureAnonymousAuthSession } = await import('./authSession.ts')
  const p1 = ensureAnonymousAuthSession(client)
  const p2 = ensureAnonymousAuthSession(client)
  releaseSignIn()
  const [r1, r2] = await Promise.all([p1, p2])
  assert.equal(signInCalls, 1)
  assert.equal(r1.accessToken, 'shared-token')
  assert.equal(r2.accessToken, 'shared-token')
}

// 3) authenticated /api/chat → memory pipeline gets verified auth.uid()
{
  const owner = await resolveChatMemoryOwnerUserId(
    {
      headers: {
        authorization: 'Bearer real-jwt',
        'x-laife-user-id': 'forged-header',
      },
      body: { userId: 'forged-body' },
    },
    {
      requireAuthenticatedUser: async () => ({
        userId: 'auth-uid-aaaa-bbbb',
        isAnonymous: true,
        user: { id: 'auth-uid-aaaa-bbbb' },
        accessToken: 'real-jwt',
      }),
      getServiceSupabase: async () => ({ ok: true }),
      ensureAuthUserRow: async (_sb, authUserId) => {
        assert.equal(authUserId, 'auth-uid-aaaa-bbbb')
        return authUserId
      },
    },
  )
  assert.equal(owner, 'auth-uid-aaaa-bbbb')
}

// 3b) End-to-end-ish: client Bearer header → server owner resolve
{
  const mock = createAuthClient({
    session: {
      user: { id: 'client-uid', is_anonymous: true },
      access_token: 'client-bearer-jwt',
    },
  })
  const { headers } = await buildChatRequestAuthHeaders(
    { memoryEnabled: true },
    { isConfigured: () => true, getClient: () => mock.client },
  )

  const owner = await resolveChatMemoryOwnerUserId(
    { headers: { authorization: headers.Authorization } },
    {
      requireAuthenticatedUser: async (req) => {
        const raw = req.headers.authorization || ''
        assert.match(raw, /^Bearer client-bearer-jwt$/)
        return {
          userId: 'verified-from-jwt',
          isAnonymous: true,
          user: { id: 'verified-from-jwt' },
          accessToken: 'client-bearer-jwt',
        }
      },
      getServiceSupabase: async () => ({}),
      ensureAuthUserRow: async (_sb, id) => id,
    },
  )
  assert.equal(owner, 'verified-from-jwt')
}

// 4) durable fact → write attempted (extractor + requireExplicitUserId path)
{
  const durableMsg = 'Il mio colore preferito è il blu.'
  const durable = analyzeConversation(durableMsg, 'Ok')
  assert.equal(durable.save, true)
  assert.ok((durable.items || []).length >= 1)

  const { runMemoryPipeline } = await import('../../lib/server/brain-memory.js')
  try {
    await runMemoryPipeline({
      userMessage: durableMsg,
      assistantMessage: 'Ok',
      memoryEnabled: true,
      requireExplicitUserId: true,
      // missing userId → must throw before upsert
    })
    assert.fail('expected explicit userId to be required')
  } catch (error) {
    assert.match(String(error.message), /Explicit userId is required/)
  }

  // With owner + durable fact, api/chat wires pipeline with explicit verified uid.
  const chatSrc = readFileSync(join(root, 'api/chat.ts'), 'utf8')
  assert.match(
    chatSrc,
    /runMemoryPipeline\(\{\s*[\s\S]*?userId:\s*ownerUserId,\s*[\s\S]*?requireExplicitUserId:\s*true/,
  )
  assert.match(chatSrc, /if\s*\(\s*!memoryEnabled\s*\|\|\s*!ownerUserId\s*\)/)
}

// 4b) Extraction V2 PR2: natural favorites work without Ricorda; explicit intent still preferences.
{
  const bare = analyzeConversation('Il mio animale preferito è il lupo.', 'Ok')
  assert.equal(bare.save, true)
  assert.equal(bare.category, 'preferences')

  const withRicorda = analyzeConversation(
    'Ricorda che il mio animale preferito è il lupo.',
    'Ok',
  )
  assert.equal(withRicorda.save, true)
  assert.equal(withRicorda.category, 'preferences')
  assert.equal(withRicorda.source, 'explicit')

  const ricordaColore = analyzeConversation(
    'Ricorda che il mio colore preferito è il verde.',
    'Ok',
  )
  assert.equal(ricordaColore.save, true)
  assert.equal(ricordaColore.category, 'preferences')
  assert.equal(ricordaColore.source, 'explicit')

  const colore = analyzeConversation('Il mio colore preferito è il verde.', 'Ok')
  assert.equal(colore.save, true)
  assert.equal(colore.source, 'automatic')
}

// 5) no auth → chat would succeed but memory skips (owner null; no Bearer)
{
  const owner = await resolveChatMemoryOwnerUserId(
    { headers: {} },
    {
      requireAuthenticatedUser: async () => {
        throw new AuthError('missing_token', 'Missing Authorization Bearer token')
      },
      getServiceSupabase: async () => {
        assert.fail('must not open supabase without auth')
      },
      ensureAuthUserRow: async () => {
        assert.fail('must not ensure user without auth')
      },
    },
  )
  assert.equal(owner, null)

  const auth = await resolveChatAuthForRequest({
    memoryEnabled: true,
    isConfigured: () => true,
    getClient: () =>
      createAuthClient({ session: null, signInError: 'Anonymous provider disabled' }).client,
  })
  assert.equal(auth.authorization, null)
}

// 6) exactly one responses.create on live Core path; no memoryDiag UI leak
{
  const chatSrc = readFileSync(join(root, 'api/chat.ts'), 'utf8')
  assert.equal((chatSrc.match(/\.responses\.create\s*\(/g) || []).length, 1)
  assert.doesNotMatch(chatSrc, /memoryDiag/)
  assert.doesNotMatch(readFileSync(join(root, 'src/lib/chatApi.ts'), 'utf8'), /memoryDiag/)
}

// 7) GPT-5.6 Sol request behavior unchanged (no temperature; reasoning none)
{
  const sol = buildCoreResponsesCreateParams({
    model: 'gpt-5.6-sol',
    instructions: 'test',
    maxOutputTokens: 100,
    input: [{ type: 'message', role: 'user', content: 'hi' }],
  })
  assert.equal(sol.model, 'gpt-5.6-sol')
  assert.equal('temperature' in sol, false)
  assert.deepEqual(sol.reasoning, { effort: 'none' })

  const gpt54 = buildCoreResponsesCreateParams({
    model: 'gpt-5.4',
    instructions: 'test',
    maxOutputTokens: 100,
    input: [{ type: 'message', role: 'user', content: 'hi' }],
  })
  assert.equal(gpt54.temperature, 0.85)
  assert.equal('reasoning' in gpt54, false)
}

// Source: chatApi still attaches Authorization from resolveChatAuthForRequest
{
  const chatApiSrc = readFileSync(join(root, 'src/lib/chatApi.ts'), 'utf8')
  assert.match(chatApiSrc, /resolveChatAuthForRequest/)
  assert.match(chatApiSrc, /headers\.Authorization\s*=\s*auth\.authorization/)
  assert.match(chatApiSrc, /memoryEnabled:\s*payload\.memoryEnabled\s*!==\s*false/)
}

console.log('ok: chat memory write flow contracts')
