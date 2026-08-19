/**
 * #311 — Gmail Email Phase 1 contracts + unit tests.
 * Run: node --test lib/server/email-311.test.mjs
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import { pathToFileURL } from 'node:url'

const root = process.cwd()
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

const migration = read('supabase/migrations/20260819180000_email_connections_311.sql')
const configToml = read('supabase/config.toml')
const oauthStart = read('supabase/functions/email-oauth-start/index.ts')
const oauthCallback = read('supabase/functions/email-oauth-callback/index.ts')
const emailConnection = read('supabase/functions/email-connection/index.ts')
const chatApi = read('api/chat.ts')
const settings = read('src/components/SettingsDrawer.tsx')
const envExample = read('.env.example')

function testKeyHex() {
  return 'b'.repeat(64)
}

describe('#311 migration + RLS', () => {
  it('creates email_connections with required columns', () => {
    assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.email_connections/)
    assert.match(migration, /user_id UUID NOT NULL REFERENCES public\.users/)
    assert.match(migration, /access_token_enc TEXT NULL/)
    assert.match(migration, /refresh_token_enc TEXT NULL/)
    assert.match(migration, /email_connections_one_google_per_user UNIQUE \(user_id, provider\)/)
    assert.match(migration, /ALTER TABLE public\.email_connections ENABLE ROW LEVEL SECURITY/)
    assert.doesNotMatch(migration, /^\s*CREATE POLICY/m)
    assert.match(migration, /REVOKE ALL ON TABLE public\.email_connections FROM anon/)
  })
})

describe('#311 OAuth state + scopes + return origin', () => {
  it('signs/verifies state with owner binding and return origin', async () => {
    const mod = await import(pathToFileURL(path.join(root, 'lib/server/email-oauth.js')).href)
    const key = testKeyHex()
    const signed = await mod.createSignedOAuthState(
      {
        userId: '11111111-1111-1111-1111-111111111111',
        nonce: 'nonce1',
        codeVerifier: 'verifier-abc',
        returnOrigin: 'https://mia-app-ai-git-preview.vercel.app',
      },
      key,
    )
    assert.equal(signed.ok, true)
    const verified = await mod.verifySignedOAuthState(signed.state, {}, key)
    assert.equal(verified.ok, true)
    assert.equal(verified.userId, '11111111-1111-1111-1111-111111111111')
    assert.equal(verified.returnOrigin, 'https://mia-app-ai-git-preview.vercel.app')

    const bad = await mod.verifySignedOAuthState(signed.state + 'x', {}, key)
    assert.equal(bad.ok, false)

    const mismatch = await mod.verifySignedOAuthState(
      signed.state,
      { expectedUserId: '22222222-2222-2222-2222-222222222222' },
      key,
    )
    assert.equal(mismatch.ok, false)
    assert.equal(mismatch.code, 'oauth_state_user_mismatch')
  })

  it('rejects write Gmail scopes and open redirects', async () => {
    const mod = await import(pathToFileURL(path.join(root, 'lib/server/email-oauth.js')).href)
    const bad = mod.assertReadOnlyGmailScopes(
      'https://www.googleapis.com/auth/gmail.modify openid',
    )
    assert.equal(bad.ok, false)

    const good = mod.assertReadOnlyGmailScopes(mod.GOOGLE_EMAIL_OAUTH_SCOPES)
    assert.equal(good.ok, true)

    const evil = mod.resolveOAuthCallbackReturnUrl({
      returnOrigin: 'https://evil.example',
      allowedBases: 'https://mia-app-ai.vercel.app',
      flag: 'connected',
    })
    assert.equal(evil.ok, true)
    assert.match(evil.url, /^https:\/\/mia-app-ai\.vercel\.app\//)
    assert.doesNotMatch(evil.url, /evil/)
  })

  it('Edge callback has verify_jwt false and binds return origin', () => {
    assert.match(configToml, /\[functions\.email-oauth-callback\]/)
    assert.match(configToml, /verify_jwt = false/)
    assert.match(oauthCallback, /resolveOAuthCallbackReturnUrl/)
    assert.match(oauthCallback, /verified\.returnOrigin/)
    assert.match(oauthStart, /returnOrigin/)
    assert.match(oauthStart, /email_connections/)
    assert.match(emailConnection, /action !== 'disconnect'/)
    assert.match(emailConnection, /user_id_spoof_rejected/)
  })
})

describe('#311 AES-GCM encryption', () => {
  it('roundtrips with EMAIL key and fails closed on tamper', async () => {
    const mod = await import(
      pathToFileURL(path.join(root, 'lib/server/email-token-crypto.js')).href
    )
    const key = testKeyHex()
    const enc = await mod.encryptToken('secret-gmail-token', key)
    assert.equal(enc.ok, true)
    const dec = await mod.decryptToken(enc.ciphertext, key)
    assert.equal(dec.ok, true)
    assert.equal(dec.plaintext, 'secret-gmail-token')
    const tampered = await mod.decryptToken(enc.ciphertext.replace(/\./g, '.') + 'aa', key)
    assert.equal(tampered.ok, false)
  })
})

describe('#311 intent routing', () => {
  it('routes Italian and English positives', async () => {
    const mod = await import(
      pathToFileURL(path.join(root, 'lib/server/email-chat-intent.js')).href
    )
    const cases = [
      ["Ci sono email non lette?", 'unread'],
      ['Ho email importanti?', 'important'],
      ["Cosa mi è arrivato oggi?", 'today'],
      ['Controlla la posta', 'recent'],
      ['Cerca le email su LAIfe', 'search'],
      ['Ho ricevuto una mail da Marco?', 'from_sender'],
      ['Riassumimi le ultime email', 'summarize'],
      ['Any unread emails?', 'unread'],
      ['What emails did I get today?', 'today'],
      ['Check my inbox', 'recent'],
      ['Find emails from Marco', 'from_sender'],
      ["Summarize today's emails", 'summarize'],
    ]
    for (const [text, op] of cases) {
      const r = mod.routeEmailChatIntent(text)
      assert.equal(r.intent, 'email', text)
      assert.equal(r.operation, op, `${text} → ${r.operation}`)
    }
    const from = mod.routeEmailChatIntent('Ho ricevuto qualcosa da Luca?')
    assert.equal(from.intent, 'email')
    assert.equal(from.operation, 'from_sender')
    assert.match(String(from.sender || ''), /luca/i)
  })

  it('negative regressions stay none', async () => {
    const mod = await import(
      pathToFileURL(path.join(root, 'lib/server/email-chat-intent.js')).href
    )
    const negatives = [
      'Come stai?',
      'Che tempo fa?',
      'Vado all’ufficio postale',
      'Posta prioritaria dove si compra?',
      'Scrivi un template email marketing',
      'Messaggio WhatsApp da Marco',
      'Cosa ho in calendario domani?',
      'Pubblica un post su Instagram',
    ]
    for (const text of negatives) {
      const r = mod.routeEmailChatIntent(text)
      assert.equal(r.intent, 'none', text)
    }
  })
})

describe('#311 Gmail parsing', () => {
  it('handles plain, html-only, multipart, missing headers', async () => {
    const mod = await import(pathToFileURL(path.join(root, 'lib/server/email-parse.js')).href)
    const b64 = (s) =>
      Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')

    const plain = mod.normalizeGmailMessage({
      id: '1',
      threadId: 't1',
      snippet: 'hello',
      labelIds: ['UNREAD'],
      payload: {
        mimeType: 'text/plain',
        headers: [
          { name: 'From', value: 'a@example.com' },
          { name: 'Subject', value: 'Hi' },
          { name: 'Date', value: 'Wed, 19 Aug 2026 12:00:00 +0000' },
        ],
        body: { data: b64('Plain body') },
      },
    })
    assert.equal(plain.bodyText, 'Plain body')
    assert.equal(plain.subject, 'Hi')

    const htmlOnly = mod.normalizeGmailMessage({
      id: '2',
      threadId: 't2',
      snippet: 'x',
      payload: {
        mimeType: 'text/html',
        headers: [],
        body: { data: b64('<p>Hello <b>HTML</b></p>') },
      },
    })
    assert.match(htmlOnly.bodyText, /Hello HTML/)
    assert.equal(htmlOnly.subject, '(senza oggetto)')
    assert.equal(htmlOnly.from, '')

    const multi = mod.normalizeGmailMessage({
      id: '3',
      threadId: 't3',
      snippet: 'm',
      payload: {
        mimeType: 'multipart/alternative',
        headers: [{ name: 'From', value: 'b@example.com' }],
        parts: [
          { mimeType: 'text/plain', body: { data: b64('Prefer plain') } },
          { mimeType: 'text/html', body: { data: b64('<p>Ignore</p>') } },
        ],
      },
    })
    assert.equal(multi.bodyText, 'Prefer plain')
    assert.equal(multi.from, 'b@example.com')
  })
})

describe('#311 operations + pack', () => {
  it('builds pack statuses and enrichment unread happy path with mock fetch', async () => {
    const packMod = await import(
      pathToFileURL(path.join(root, 'lib/server/email-chat-pack.js')).href
    )
    const okPack = packMod.buildEmailContextPack({
      status: 'ok',
      operation: 'unread',
      count: 1,
      messages: [
        {
          from: 'a@x.com',
          subject: 'Test',
          date: 'today',
          snippet: 'hi',
          importantReason: null,
        },
      ],
    })
    assert.match(okPack, /EMAIL_CONTEXT/)
    assert.match(okPack, /status: ok/)
    assert.doesNotMatch(okPack, /access_token|refresh_token/i)

    const nonePack = packMod.buildEmailContextPack({
      status: 'no_results',
      operation: 'unread',
      count: 0,
    })
    assert.match(nonePack, /status: no_results/)

    const notConn = packMod.buildEmailContextPack({
      status: 'not_connected',
      operation: 'unread',
      count: 0,
      hint: 'connect',
    })
    assert.match(notConn, /status: not_connected/)

    // Mock enrichment with disabled gate
    const disabled = await packMod.maybeBuildEmailChatEnrichment({
      userMessage: 'Ci sono email non lette?',
      userId: '11111111-1111-1111-1111-111111111111',
      env: { EMAIL_ENABLED: 'false' },
    })
    assert.equal(disabled.used, true)
    assert.equal(disabled.packStatus, 'disabled')
    assert.match(disabled.pack, /EMAIL_CONTEXT/)

    // Intent none
    const none = await packMod.maybeBuildEmailChatEnrichment({
      userMessage: 'Come stai?',
      userId: '11111111-1111-1111-1111-111111111111',
      env: { EMAIL_ENABLED: 'true' },
    })
    assert.equal(none.used, false)
    assert.equal(none.preGoogleFailureCode, 'intent_none')
  })

  it('listUnreadEmails uses mock Google + supabase', async () => {
    const read = await import(pathToFileURL(path.join(root, 'lib/server/email-read.js')).href)
    const key = testKeyHex()
    const crypto = await import(
      pathToFileURL(path.join(root, 'lib/server/email-token-crypto.js')).href
    )
    const enc = await crypto.encryptToken('access-token-value', key)
    assert.equal(enc.ok, true)

    const supabase = {
      from() {
        return {
          select() {
            return {
              eq() {
                return {
                  eq() {
                    return {
                      async maybeSingle() {
                        return {
                          data: {
                            id: 'c1',
                            user_id: '11111111-1111-1111-1111-111111111111',
                            status: 'connected',
                            access_token_enc: enc.ciphertext,
                            refresh_token_enc: enc.ciphertext,
                            token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
                            account_email: 'u@example.com',
                          },
                          error: null,
                        }
                      },
                    }
                  },
                }
              },
            }
          },
          update() {
            return {
              eq() {
                return {
                  eq() {
                    return {
                      select() {
                        return {
                          async maybeSingle() {
                            return { data: null, error: null }
                          },
                        }
                      },
                    }
                  },
                }
              },
            }
          },
        }
      },
    }

    const b64 = (s) =>
      Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')

    /** @type {typeof fetch} */
    const fetchImpl = async (url) => {
      const u = String(url)
      if (u.includes('/gmail/v1/users/me/messages?') || u.includes('/messages&') || /\/messages\?/.test(u)) {
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          async text() {
            return JSON.stringify({ messages: [{ id: 'm1', threadId: 't1' }], resultSizeEstimate: 1 })
          },
        }
      }
      if (u.includes('/messages/m1')) {
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          async text() {
            return JSON.stringify({
              id: 'm1',
              threadId: 't1',
              snippet: 'Unread hello',
              labelIds: ['UNREAD', 'INBOX'],
              payload: {
                headers: [
                  { name: 'From', value: 'boss@example.com' },
                  { name: 'Subject', value: 'Urgent payment' },
                  { name: 'Date', value: 'Wed, 19 Aug 2026' },
                ],
                mimeType: 'text/plain',
                body: { data: b64('Please pay invoice') },
              },
            })
          },
        }
      }
      throw new Error(`unexpected url ${u}`)
    }

    const result = await read.listUnreadEmails({
      userId: '11111111-1111-1111-1111-111111111111',
      supabase,
      fetchImpl,
      env: {
        EMAIL_ENABLED: 'true',
        EMAIL_TOKEN_ENCRYPTION_KEY: key,
        GOOGLE_OAUTH_CLIENT_ID: 'cid',
        GOOGLE_OAUTH_CLIENT_SECRET: 'sec',
      },
    })
    assert.equal(result.messages.length, 1)
    assert.equal(result.messages[0].subject, 'Urgent payment')
    assert.equal(result.googleRequestReached, true)
  })
})

describe('#311 security + wiring', () => {
  it('chat wires email pack; settings mounts Gmail; no token leakage patterns', () => {
    assert.match(chatApi, /maybeBuildEmailChatEnrichment/)
    assert.match(chatApi, /appendEmailPackToInstructions/)
    assert.match(chatApi, /emailDiag/)
    assert.match(settings, /EmailIntegrationsSettings/)
    assert.match(envExample, /EMAIL_ENABLED/)
    assert.match(envExample, /EMAIL_TOKEN_ENCRYPTION_KEY/)
    assert.match(oauthCallback, /encryptToken/)
    assert.match(oauthStart, /secret_relay_forbidden/)
    assert.doesNotMatch(oauthStart, /GOOGLE_OAUTH_CLIENT_SECRET/)
    assert.match(emailConnection, /account_email, scopes, last_error_code/)
  })

  it('user A row filter is always eq user_id from JWT', () => {
    assert.match(emailConnection, /\.eq\('user_id', userId\)/)
    assert.match(oauthCallback, /\.eq\('user_id', userId\)/)
  })
})
