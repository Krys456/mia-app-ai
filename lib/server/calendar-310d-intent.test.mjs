/**
 * #310D — intent normalize + tokenDecrypt diag fields.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..')

describe('#310D calendar intent normalize + diag', () => {
  it('strips ZWSP so Cosa\\u200bho domani? detects as events', async () => {
    const mod = await import(
      pathToFileURL(path.join(root, 'lib/server/calendar-chat-intent.js')).href
    )
    assert.equal(mod.detectCalendarChatIntent('Cosa ho domani?'), 'events')
    assert.equal(mod.detectCalendarChatIntent('Cosa\u200bho domani?'), 'events')
    assert.equal(mod.detectCalendarChatIntent('Cosa\u200cho domani?'), 'events')
    assert.equal(mod.normalizeCalendarIntentText('Cosa\u200bho  domani?'), 'cosa ho domani?')
  })

  it('intent_none enrichment exposes tokenDecrypt NOT_REACHED + preGoogleFailureCode', async () => {
    const pack = await import(
      pathToFileURL(path.join(root, 'lib/server/calendar-chat-pack.js')).href
    )
    const diag = await import(pathToFileURL(path.join(root, 'lib/server/calendar-diag.js')).href)
    const enrichment = await pack.maybeBuildCalendarChatEnrichment({
      userMessage: 'Come stai?',
      userId: '11111111-1111-1111-1111-111111111111',
      env: { CALENDAR_ENABLED: 'true' },
    })
    assert.equal(enrichment.used, false)
    assert.equal(enrichment.intent, 'none')
    assert.equal(enrichment.tokenDecrypt, 'NOT_REACHED')
    assert.equal(enrichment.preGoogleFailureCode, 'intent_none')

    const payload = diag.buildChatCalendarDiagPayload({
      correlationId: 'req-1',
      authUserId: '11111111-1111-1111-1111-111111111111',
      enrichment,
      env: { VERCEL_ENV: 'preview', CALENDAR_ENABLED: 'true' },
    })
    assert.equal(payload.tokenDecrypt, 'NOT_REACHED')
    assert.equal(payload.preGoogleFailureCode, 'intent_none')
    assert.equal(payload.used, false)
    assert.equal(payload.diagBuild, '310F-1')
  })

  it('ZWSP calendar question builds events enrichment when enabled+mocked', async () => {
    const pack = await import(
      pathToFileURL(path.join(root, 'lib/server/calendar-chat-pack.js')).href
    )
    const enrichment = await pack.maybeBuildCalendarChatEnrichment({
      userMessage: 'Cosa\u200bho domani?',
      userId: '11111111-1111-1111-1111-111111111111',
      env: { CALENDAR_ENABLED: 'false' },
    })
    assert.equal(enrichment.used, true)
    assert.equal(enrichment.intent, 'events')
    assert.equal(enrichment.status, 'disabled')
    assert.equal(enrichment.tokenDecrypt, 'NOT_REACHED')
    assert.equal(enrichment.preGoogleFailureCode, 'calendar_disabled')
  })
})
