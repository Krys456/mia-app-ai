/**
 * #310C — Calendar live-trace helpers (safe fields only).
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..')

describe('#310C calendar diag', () => {
  it('masks uids and maps enrichment to safe trace', async () => {
    const mod = await import(pathToFileURL(path.join(root, 'lib/server/calendar-diag.js')).href)
    assert.equal(mod.maskUid('5313abcd-xxxx-xxxx-xxxx-yyyyyyyy48d2'), '5313…48d2')
    assert.equal(mod.supabaseProjectRefFromUrl('https://scrvnhwlkorgxbmmsrmv.supabase.co'), 'scrvnhwlkorgxbmmsrmv')
    assert.equal(mod.isCalendarDiagEnvAllowed({ VERCEL_ENV: 'preview' }), true)
    assert.equal(mod.isCalendarDiagEnvAllowed({ VERCEL_ENV: 'production' }), false)
    assert.equal(mod.isCalendarDiagEnvAllowed({ CALENDAR_DIAG: 'true' }), true)

    const ok = mod.buildCalendarTraceFromEnrichment({
      used: true,
      intent: 'events',
      status: 'ok',
      eventCount: 1,
      pack: 'CALENDAR CONTEXT — UNTRUSTED USER DATA\nStatus: ok',
    })
    assert.equal(ok.rowFound, true)
    assert.equal(ok.decryptReached, true)
    assert.equal(ok.googleRequestReached, true)
    assert.equal(ok.googleHttpResult, '200')
    assert.equal(ok.packAppended, true)

    const missing = mod.buildCalendarTraceFromEnrichment({
      used: true,
      intent: 'events',
      status: 'not_connected',
      code: 'not_connected',
      pack: 'CALENDAR CONTEXT — UNTRUSTED USER DATA\nStatus: not_connected',
    })
    assert.equal(missing.rowFound, false)
    assert.equal(missing.googleRequestReached, false)
  })
})
