/**
 * #310C3 — durable calendar diag client store + OAuth diag flag in state.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..')

describe('#310C3 calendar diag durability', () => {
  it('client store dual-writes and keeps expected keys', () => {
    const src = fs.readFileSync(path.join(root, 'src/lib/calendarDiagClient.ts'), 'utf8')
    assert.match(src, /shinkaido\.calendar\.lastOauthStartDiag/)
    assert.match(src, /shinkaido\.calendar\.lastConnectionDiag/)
    assert.match(src, /shinkaido\.calendar\.lastChatDiag/)
    assert.match(src, /localStorage/)
    assert.match(src, /sessionStorage/)
    assert.match(src, /calendar_diag/)
    assert.match(src, /310F-1/)
  })

  it('panel is mounted from App and lists safe fields only', () => {
    const app = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8')
    const panel = fs.readFileSync(
      path.join(root, 'src/components/CalendarDiagnosticsPanel.tsx'),
      'utf8',
    )
    assert.match(app, /CalendarDiagnosticsPanel/)
    assert.match(panel, /Calendar Diagnostics/)
    assert.match(panel, /buildId/)
    assert.match(panel, /eventCount/)
    assert.match(panel, /requestId/)
    assert.doesNotMatch(panel, /access_token|refresh_token|Authorization|JWT/i)
  })

  it('oauth state round-trips calendarDiag flag for callback restore', async () => {
    const mod = await import(pathToFileURL(path.join(root, 'lib/server/calendar-oauth.js')).href)
    const key = Buffer.from('0123456789abcdef0123456789abcdef').toString('hex')
    const signed = await mod.createSignedOAuthState(
      {
        userId: '11111111-1111-1111-1111-111111111111',
        nonce: mod.generateOAuthNonce(),
        codeVerifier: mod.generateCodeVerifier(),
        returnOrigin: 'https://mia-app-ai.vercel.app',
        correlationId: 'cid-test-1',
        calendarDiag: true,
      },
      key,
    )
    assert.equal(signed.ok, true)
    assert.equal(signed.calendarDiag, true)
    const verified = await mod.verifySignedOAuthState(signed.state, {}, key)
    assert.equal(verified.ok, true)
    assert.equal(verified.calendarDiag, true)
    assert.equal(verified.correlationId, 'cid-test-1')

    const off = await mod.createSignedOAuthState(
      {
        userId: '11111111-1111-1111-1111-111111111111',
        nonce: mod.generateOAuthNonce(),
        codeVerifier: mod.generateCodeVerifier(),
      },
      key,
    )
    const verifiedOff = await mod.verifySignedOAuthState(off.state, {}, key)
    assert.equal(verifiedOff.calendarDiag, false)
  })

  it('callback appends calendar_diag=1 when state carries diag', () => {
    const cb = fs.readFileSync(
      path.join(root, 'supabase/functions/calendar-oauth-callback/index.ts'),
      'utf8',
    )
    assert.match(cb, /calendar_diag=1/)
    assert.match(cb, /verified\.calendarDiag/)
  })

  it('chat diag payload includes requestId alias', async () => {
    const mod = await import(pathToFileURL(path.join(root, 'lib/server/calendar-diag.js')).href)
    const payload = mod.buildChatCalendarDiagPayload({
      correlationId: 'req-abc',
      authUserId: '5313abcd-xxxx-xxxx-xxxx-yyyyyyyy48d2',
      enrichment: { used: false, intent: 'none', status: null, pack: '' },
      env: { VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_SHA: 'abcdef1234567' },
    })
    assert.equal(payload.requestId, 'req-abc')
    assert.equal(payload.diagBuild, '310F-1')
  })
})
