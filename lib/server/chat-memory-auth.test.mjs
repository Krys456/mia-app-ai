/**
 * Core chat memory ownership binding (Memory 2.0 Phase 1A.4).
 * Run: node lib/server/chat-memory-auth.test.mjs
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AuthError } from './auth.js'
import { resolveChatMemoryOwnerUserId } from './chat-memory-auth.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')

// Soft-fail missing token → null (chat continues, memory skipped)
{
  const owner = await resolveChatMemoryOwnerUserId(
    { headers: {}, body: { userId: 'forged-body' } },
    {
      requireAuthenticatedUser: async () => {
        throw new AuthError('missing_token', 'Missing Authorization Bearer token')
      },
      getServiceSupabase: async () => {
        assert.fail('supabase must not be opened without auth')
      },
      ensureAuthUserRow: async () => {
        assert.fail('ensureAuthUserRow must not run without auth')
      },
    },
  )
  assert.equal(owner, null)
}

// Soft-fail invalid token → null
{
  const owner = await resolveChatMemoryOwnerUserId(
    {
      headers: {
        authorization: 'Bearer bad',
        'x-laife-user-id': 'forged-header',
      },
      body: { userId: 'forged-body' },
    },
    {
      requireAuthenticatedUser: async () => {
        throw new AuthError('invalid_token', 'Invalid JWT')
      },
    },
  )
  assert.equal(owner, null)
}

// Authenticated user A → ownership A (forged ids ignored)
{
  const owner = await resolveChatMemoryOwnerUserId(
    {
      headers: {
        authorization: 'Bearer a-token',
        'x-laife-user-id': 'forged-header',
      },
      body: { userId: 'forged-body' },
    },
    {
      requireAuthenticatedUser: async () => ({
        userId: 'user-a',
        isAnonymous: true,
        user: { id: 'user-a' },
        accessToken: 'a-token',
      }),
      getServiceSupabase: async () => ({ tag: 'sb' }),
      ensureAuthUserRow: async (supabase, authUserId) => {
        assert.equal(supabase.tag, 'sb')
        assert.equal(authUserId, 'user-a')
        assert.notEqual(authUserId, 'forged-body')
        assert.notEqual(authUserId, 'forged-header')
        return authUserId
      },
    },
  )
  assert.equal(owner, 'user-a')
}

// Authenticated user B → ownership B
{
  const owner = await resolveChatMemoryOwnerUserId(
    { headers: { authorization: 'Bearer b-token' } },
    {
      requireAuthenticatedUser: async () => ({
        userId: 'user-b',
        isAnonymous: true,
        user: { id: 'user-b' },
        accessToken: 'b-token',
      }),
      getServiceSupabase: async () => ({}),
      ensureAuthUserRow: async (_sb, id) => id,
    },
  )
  assert.equal(owner, 'user-b')
}

// Non-AuthError bridge failure still soft-fails (chat must not crash)
{
  const owner = await resolveChatMemoryOwnerUserId(
    { headers: { authorization: 'Bearer ok' } },
    {
      requireAuthenticatedUser: async () => ({
        userId: 'user-c',
        isAnonymous: true,
        user: { id: 'user-c' },
        accessToken: 'ok',
      }),
      getServiceSupabase: async () => ({}),
      ensureAuthUserRow: async () => {
        throw new Error('users insert failed')
      },
    },
  )
  assert.equal(owner, null)
}

// Pipeline contract: explicit userId required path never invents default
{
  const { runMemoryPipeline } = await import('./brain-memory.js')
  const disabled = await runMemoryPipeline({
    userMessage: 'x',
    assistantMessage: 'y',
    memoryEnabled: false,
    userId: 'user-a',
    requireExplicitUserId: true,
  })
  assert.equal(disabled.skipped, true)
  assert.equal(disabled.reason, 'memory_disabled')

  try {
    await runMemoryPipeline({
      userMessage: 'Mi chiamo Luca',
      assistantMessage: 'Ciao Luca',
      memoryEnabled: true,
      requireExplicitUserId: true,
    })
    assert.fail('expected missing explicit userId to throw')
  } catch (error) {
    assert.match(String(error.message), /Explicit userId is required/)
  }
}

// Source contracts for live Core path
{
  const chatSrc = readFileSync(join(root, 'api/chat.ts'), 'utf8')
  const chatApiSrc = readFileSync(join(root, 'src/lib/chatApi.ts'), 'utf8')
  const pipelineSrc = readFileSync(join(root, 'lib/server/brain-memory.js'), 'utf8')

  assert.equal((chatSrc.match(/\.responses\.create\s*\(/g) || []).length, 1)
  assert.match(chatSrc, /resolveChatMemoryOwnerUserId/)
  assert.match(chatSrc, /requireExplicitUserId:\s*true/)
  assert.match(chatSrc, /if \(!ownerUserId\) return null/)
  assert.doesNotMatch(chatSrc, /ensureDefaultUserId/)
  assert.doesNotMatch(chatSrc, /DEFAULT_API_USER_EMAIL/)
  assert.doesNotMatch(chatSrc, /LAIFE_BASE_SYSTEM_PROMPT\s*=/)

  assert.match(chatApiSrc, /Authorization/)
  assert.match(chatApiSrc, /getSession/)
  assert.match(chatApiSrc, /Bearer/)

  // runMemoryPipeline must forward explicit ownership into upsertMemory
  assert.match(pipelineSrc, /requireExplicitUserId/)
  assert.match(
    pipelineSrc,
    /Explicit userId is required for authenticated memory pipeline/,
  )
}

console.log('ok: chat memory auth binding (Phase 1A.4)')
