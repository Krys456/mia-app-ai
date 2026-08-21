/**
 * #336B TEMPORARY calendar crypto diag UI contracts.
 * Run: node --test src/lib/calendarCryptoDiag-336b.test.mjs
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import { describe, it } from 'node:test'

const read = (rel) => fs.readFileSync(rel, 'utf8')

describe('calendar crypto diag UI temporary #336B', () => {
  it('wires Preview-only panel into Calendar settings without new API function', () => {
    const settings = read('src/components/CalendarIntegrationsSettings.tsx')
    assert.match(settings, /CalendarCryptoDiagPanel/)
    assert.match(settings, /TEMPORARY|REMOVE BEFORE MERGE/)
    assert.ok(fs.existsSync('src/components/CalendarCryptoDiagPanel.tsx'))
    assert.ok(fs.existsSync('src/lib/calendarCryptoDiag.ts'))
    assert.equal(fs.existsSync('api/calendar-crypto-diag.ts'), false)
    const fnCount = Object.keys(JSON.parse(read('vercel.json')).functions).length
    assert.equal(fnCount, 11)
  })

  it('client calls existing calendar_crypto_diag actions only', () => {
    const lib = read('src/lib/calendarCryptoDiag.ts')
    assert.match(lib, /calendar_crypto_diag/)
    assert.match(lib, /\/api\/daily-briefing/)
    assert.match(lib, /calendar-connection/)
    assert.match(lib, /isTempCalendarCryptoDiagUiEnabled/)
    assert.match(lib, /REMOVE BEFORE MERGE/)
    assert.doesNotMatch(lib, /access_token|refresh_token|ciphertext|SHINKAIDO_CALENDAR_ENCRYPTION_KEY\s*\+/)
  })

  it('panel never renders secret field names as data sources', () => {
    const panel = read('src/components/CalendarCryptoDiagPanel.tsx')
    assert.match(panel, /Calendar crypto diagnostic — temporary/)
    assert.match(panel, /Run diagnostic/)
    assert.match(panel, /Copy safe JSON/)
    assert.match(panel, /effectiveFingerprint12/)
    assert.doesNotMatch(panel, /access_token_enc|refresh_token_enc|client_secret/)
  })
})
