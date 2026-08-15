/**
 * Server Supabase auth verification tests (Memory 2.0 Phase 1A step 2).
 * Run: node lib/server/auth.test.mjs
 */

import assert from 'node:assert/strict'
import {
  AuthError,
  extractBearerToken,
  requireAuthenticatedUser,
  verifySupabaseAccessToken,
} from './auth.js'

function mockGetSupabase(handler) {
  return async () => ({
    auth: {
      getUser: handler,
    },
  })
}

// --- extractBearerToken ---

{
  try {
    extractBearerToken({ headers: {} })
    assert.fail('expected missing_token')
  } catch (error) {
    assert.ok(error instanceof AuthError)
    assert.equal(error.code, 'missing_token')
    assert.equal(error.status, 401)
  }
}

{
  try {
    extractBearerToken({ headers: { authorization: 'Basic abc' } })
    assert.fail('expected malformed_authorization')
  } catch (error) {
    assert.ok(error instanceof AuthError)
    assert.equal(error.code, 'malformed_authorization')
  }
}

{
  try {
    extractBearerToken({ headers: { authorization: 'Bearer' } })
    assert.fail('expected malformed_authorization')
  } catch (error) {
    assert.ok(error instanceof AuthError)
    assert.equal(error.code, 'malformed_authorization')
  }
}

{
  const token = extractBearerToken({ headers: { authorization: 'Bearer good-token' } })
  assert.equal(token, 'good-token')
}

{
  const token = extractBearerToken({
    headers: { Authorization: 'Bearer Case-Token' },
  })
  assert.equal(token, 'Case-Token')
}

// --- verifySupabaseAccessToken ---

{
  const verified = await verifySupabaseAccessToken('valid-jwt', {
    getSupabase: mockGetSupabase(async (jwt) => {
      assert.equal(jwt, 'valid-jwt')
      return {
        data: { user: { id: 'user-abc', is_anonymous: true } },
        error: null,
      }
    }),
  })
  assert.equal(verified.userId, 'user-abc')
  assert.equal(verified.isAnonymous, true)
  assert.equal(verified.user.id, 'user-abc')
}

{
  try {
    await verifySupabaseAccessToken('bad-jwt', {
      getSupabase: mockGetSupabase(async () => ({
        data: { user: null },
        error: { message: 'Invalid JWT', status: 401 },
      })),
    })
    assert.fail('expected invalid_token')
  } catch (error) {
    assert.ok(error instanceof AuthError)
    assert.equal(error.code, 'invalid_token')
  }
}

{
  try {
    await verifySupabaseAccessToken('boom', {
      getSupabase: mockGetSupabase(async () => {
        throw new Error('network down')
      }),
    })
    assert.fail('expected verification_failed')
  } catch (error) {
    assert.ok(error instanceof AuthError)
    assert.equal(error.code, 'verification_failed')
    assert.match(error.message, /network down/)
  }
}

{
  try {
    await verifySupabaseAccessToken('no-user', {
      getSupabase: mockGetSupabase(async () => ({
        data: { user: { id: '' } },
        error: null,
      })),
    })
    assert.fail('expected invalid_token for empty user id')
  } catch (error) {
    assert.ok(error instanceof AuthError)
    assert.equal(error.code, 'invalid_token')
  }
}

// --- requireAuthenticatedUser ---

{
  const result = await requireAuthenticatedUser(
    {
      headers: { authorization: 'Bearer session-jwt' },
      body: { userId: 'forged-client-id' },
    },
    {
      getSupabase: mockGetSupabase(async (jwt) => {
        assert.equal(jwt, 'session-jwt')
        return {
          data: { user: { id: 'auth-uid-real', is_anonymous: true } },
          error: null,
        }
      }),
    },
  )
  assert.equal(result.userId, 'auth-uid-real')
  assert.notEqual(result.userId, 'forged-client-id')
  assert.equal(result.accessToken, 'session-jwt')
}

// Forged client identifiers must have no effect (header + body ignored as authority)
{
  const result = await requireAuthenticatedUser(
    {
      headers: {
        authorization: 'Bearer real-token',
        'x-laife-user-id': 'header-forged-id',
        'X-LAIfe-User-Id': 'header-forged-id',
      },
      body: { userId: 'body-forged-id' },
    },
    {
      getSupabase: mockGetSupabase(async () => ({
        data: { user: { id: 'verified-only', is_anonymous: false } },
        error: null,
      })),
    },
  )
  assert.equal(result.userId, 'verified-only')
  assert.notEqual(result.userId, 'body-forged-id')
  assert.notEqual(result.userId, 'header-forged-id')
}

{
  try {
    await requireAuthenticatedUser(
      {
        headers: {},
        body: { userId: 'only-forged' },
      },
      {
        getSupabase: mockGetSupabase(async () => {
          assert.fail('getUser must not be called without Bearer token')
        }),
      },
    )
    assert.fail('expected missing_token')
  } catch (error) {
    assert.ok(error instanceof AuthError)
    assert.equal(error.code, 'missing_token')
  }
}

console.log('ok: server auth.verifySupabaseAccessToken')
