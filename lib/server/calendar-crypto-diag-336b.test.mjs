/**
 * #336B TEMPORARY calendar crypto diag contracts.
 * Run: node --test lib/server/calendar-crypto-diag-336b.test.mjs
 */

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { describe, it } from 'node:test'
import {
  buildCalendarCryptoDiag,
  CALENDAR_ENCRYPTION_ENV_NAME,
} from './calendar-crypto-diag.js'

const read = (rel) => fs.readFileSync(rel, 'utf8')

describe('calendar-crypto-diag temporary #336B', () => {
  it('wires authenticated action on existing /api/daily-briefing only', () => {
    const api = read('api/daily-briefing.ts')
    assert.match(api, /calendar_crypto_diag/)
    assert.match(api, /buildCalendarCryptoDiag/)
    assert.match(api, /TEMPORARY/)
    assert.match(api, /REMOVE BEFORE MERGE/)
    assert.equal(fs.existsSync('api/calendar-crypto-diag.ts'), false)
    const fnCount = Object.keys(JSON.parse(read('vercel.json')).functions).length
    assert.equal(fnCount, 11)
  })

  it('wires gated Edge diag on existing calendar-connection', () => {
    const conn = read('supabase/functions/calendar-connection/index.ts')
    assert.match(conn, /calendar_crypto_diag/)
    assert.match(conn, /fingerprintEncryptionKeyEnv/)
    assert.match(conn, /TEMPORARY/)
  })

  it('missing key returns safe empty fingerprints', () => {
    const diag = buildCalendarCryptoDiag({})
    assert.equal(diag.exists, false)
    assert.equal(diag.trimmedLength, 0)
    assert.equal(diag.stringFingerprint12, null)
    assert.equal(diag.parseOk, false)
    assert.equal(diag.effectiveByteLength, null)
    assert.equal(diag.effectiveFingerprint12, null)
  })

  it('valid hex key fingerprints without exposing secret', () => {
    const key = 'b'.repeat(64)
    const diag = buildCalendarCryptoDiag({ [CALENDAR_ENCRYPTION_ENV_NAME]: `  ${key}  ` })
    assert.equal(diag.exists, true)
    assert.equal(diag.trimmedLength, 64)
    assert.equal(diag.parseOk, true)
    assert.equal(diag.effectiveByteLength, 32)
    assert.equal(
      diag.stringFingerprint12,
      createHash('sha256').update(key, 'utf8').digest('hex').slice(0, 12),
    )
    assert.match(diag.effectiveFingerprint12 || '', /^[0-9a-f]{12}$/)
    assert.doesNotMatch(JSON.stringify(diag), /bbbbbbbb/)
  })

  it('never logs secret field names with values in handler source', () => {
    const api = read('api/daily-briefing.ts')
    assert.doesNotMatch(api, /console\.[^(]+\([^)]*SHINKAIDO_CALENDAR_ENCRYPTION_KEY\s*\+/)
    assert.match(api, /stringFingerprint12/)
  })
})
