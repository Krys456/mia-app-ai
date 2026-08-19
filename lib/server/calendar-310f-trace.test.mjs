/**
 * #310F — prove exact text entering Calendar intent detector (safe previews).
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..')

describe('#310F detector text trace', () => {
  it('inspectCalendarChatIntent exposes raw + normalized for Cos\'ho', async () => {
    const mod = await import(
      pathToFileURL(path.join(root, 'lib/server/calendar-chat-intent.js')).href
    )
    const inspected = mod.inspectCalendarChatIntent("Cos'ho domani?")
    assert.equal(inspected.raw, "Cos'ho domani?")
    assert.equal(inspected.normalized, 'cosa ho domani?')
    assert.equal(inspected.intent, 'events')
    assert.equal(inspected.rawPreview, "Cos'ho domani?")
    assert.equal(inspected.normalizedPreview, 'cosa ho domani?')
    assert.equal(mod.safeDiagTextPreview('x'.repeat(100), 80).length, 81) // 80 + ellipsis
  })

  it('enrichment intent_none still returns detectorInput previews', async () => {
    const pack = await import(
      pathToFileURL(path.join(root, 'lib/server/calendar-chat-pack.js')).href
    )
    const enrichment = await pack.maybeBuildCalendarChatEnrichment({
      userMessage: 'Come stai?',
      userId: '11111111-1111-1111-1111-111111111111',
      env: { CALENDAR_ENABLED: 'true' },
    })
    assert.equal(enrichment.detectorInput, 'Come stai?')
    assert.equal(enrichment.detectorNormalized, 'come stai?')
    assert.equal(enrichment.detectorResult, 'none')
    assert.equal(enrichment.enrichmentSelectedPreview, 'Come stai?')
  })

  it('chat diag payload forwards detectorInput/Normalized', async () => {
    const diag = await import(pathToFileURL(path.join(root, 'lib/server/calendar-diag.js')).href)
    const payload = diag.buildChatCalendarDiagPayload({
      correlationId: 'req-f',
      authUserId: '11111111-1111-1111-1111-111111111111',
      apiParsedLastUserLen: 14,
      apiParsedLastUserPreview: "Cos'ho domani?",
      visibleUiLastUserLen: 14,
      visibleUiLastUserPreview: "Cos'ho domani?",
      clientOutboundLastUserLen: 14,
      clientOutboundLastUserPreview: "Cos'ho domani?",
      messageSource: 'messages[]…',
      selectedMessageRole: 'user',
      enrichment: {
        used: true,
        intent: 'events',
        status: 'disabled',
        pack: 'CALENDAR CONTEXT',
        detectorInput: "Cos'ho domani?",
        detectorNormalized: 'cosa ho domani?',
        detectorResult: 'events',
        enrichmentSelectedPreview: "Cos'ho domani?",
        enrichmentSelectedLen: 14,
        detectorRawLen: 14,
        tokenDecrypt: 'NOT_REACHED',
        preGoogleFailureCode: 'calendar_disabled',
      },
      env: { VERCEL_ENV: 'preview', CALENDAR_ENABLED: 'true' },
    })
    assert.equal(payload.detectorInput, "Cos'ho domani?")
    assert.equal(payload.detectorNormalized, 'cosa ho domani?')
    assert.equal(payload.apiParsedLastUserPreview, "Cos'ho domani?")
    assert.equal(payload.visibleUiLastUserPreview, "Cos'ho domani?")
    assert.equal(payload.diagBuild, '310F-1')
  })
})
