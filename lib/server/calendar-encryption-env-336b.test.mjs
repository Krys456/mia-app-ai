/**
 * #336B — Calendar encryption env rename: SHINKAIDO_CALENDAR_ENCRYPTION_KEY.
 * Config-name migration only; crypto semantics unchanged.
 * Run: node --test lib/server/calendar-encryption-env-336b.test.mjs
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import { decryptToken, encryptToken, parseEncryptionKey } from './calendar-token-crypto.js'

const root = process.cwd()
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

const NEW_KEY = 'SHINKAIDO_CALENDAR_ENCRYPTION_KEY'
const OLD_KEY = 'CALENDAR_TOKEN_ENCRYPTION_KEY'

function testKeyHex() {
  return 'a'.repeat(64)
}

describe('calendar encryption env rename #336B', () => {
  it('Edge runtime reads only the new secret name', () => {
    const files = [
      'supabase/functions/calendar-oauth-start/index.ts',
      'supabase/functions/calendar-oauth-callback/index.ts',
      'supabase/functions/calendar-connection/index.ts',
    ]
    for (const rel of files) {
      const src = read(rel)
      assert.match(src, new RegExp(`env\\('${NEW_KEY}'\\)`), rel)
      assert.doesNotMatch(src, new RegExp(OLD_KEY), rel)
    }
  })

  it('Node runtime reads only the new secret name', () => {
    const files = [
      'lib/server/calendar-token-crypto.js',
      'lib/server/calendar-token-refresh.js',
      'lib/server/calendar-oauth.js',
      'scripts/calendar-read-smoke.mjs',
    ]
    for (const rel of files) {
      const src = read(rel)
      assert.match(src, new RegExp(NEW_KEY), rel)
      assert.doesNotMatch(src, new RegExp(OLD_KEY), rel)
    }
  })

  it('docs and .env.example document the new name only', () => {
    const files = [
      '.env.example',
      'supabase/migrations/README-304A1-CALENDAR.md',
      'supabase/migrations/README-304A2-CALENDAR-READ.md',
    ]
    for (const rel of files) {
      const src = read(rel)
      assert.match(src, new RegExp(NEW_KEY), rel)
      // Mentions of the old name are allowed only as "retired" guidance.
      if (src.includes(OLD_KEY)) {
        assert.match(src, /retired|do not set/i, `${rel} must mark old name retired`)
      }
    }
  })

  it('repo has no required runtime dependency on the old name', () => {
    // Walk key runtime dirs; skip this test file's OLD_KEY constant.
    const roots = ['api', 'lib/server', 'supabase/functions', 'scripts', 'src']
    const hits = []
    for (const dir of roots) {
      const abs = path.join(root, dir)
      if (!fs.existsSync(abs)) continue
      const walk = (d) => {
        for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
          if (ent.name === 'node_modules' || ent.name === 'dist') continue
          const p = path.join(d, ent.name)
          if (ent.isDirectory()) walk(p)
          else if (/\.(js|ts|mjs|tsx)$/.test(ent.name)) {
            if (p.endsWith('calendar-encryption-env-336b.test.mjs')) continue
            const text = fs.readFileSync(p, 'utf8')
            if (text.includes(OLD_KEY)) hits.push(path.relative(root, p))
          }
        }
      }
      walk(abs)
    }
    assert.deepEqual(hits, [], `old env still referenced: ${hits.join(', ')}`)
  })

  it('missing new key yields encryption_key_missing (safe code)', async () => {
    const prev = process.env[NEW_KEY]
    try {
      delete process.env[NEW_KEY]
      const enc = await encryptToken('probe-token')
      assert.equal(enc.ok, false)
      assert.equal(enc.code, 'encryption_key_missing')
      const parsed = parseEncryptionKey('')
      assert.equal(parsed.ok, false)
      assert.equal(parsed.code, 'encryption_key_missing')
    } finally {
      if (prev !== undefined) process.env[NEW_KEY] = prev
      else delete process.env[NEW_KEY]
    }
  })

  it('encrypt/decrypt round-trip still works with new env name', async () => {
    const key = testKeyHex()
    const enc = await encryptToken('round-trip-token-value', key)
    assert.equal(enc.ok, true)
    assert.match(enc.ciphertext, /^v1\./)
    const dec = await decryptToken(enc.ciphertext, key)
    assert.equal(dec.ok, true)
    assert.equal(dec.plaintext, 'round-trip-token-value')

    process.env[NEW_KEY] = key
    try {
      const enc2 = await encryptToken('from-process-env')
      assert.equal(enc2.ok, true)
      const dec2 = await decryptToken(enc2.ciphertext)
      assert.equal(dec2.ok, true)
      assert.equal(dec2.plaintext, 'from-process-env')
    } finally {
      delete process.env[NEW_KEY]
    }
  })

  it('oauth-start misconfigured only when new key missing (source contract)', () => {
    const start = read('supabase/functions/calendar-oauth-start/index.ts')
    assert.match(start, /oauth_misconfigured/)
    assert.match(start, new RegExp(`env\\('${NEW_KEY}'\\)`))
    assert.match(start, /if \(!clientId \|\| !redirectUri \|\| !encKey\)/)
  })

  it('#336B Calendar router unchanged by this rename', () => {
    const api = read('api/daily-briefing.ts')
    assert.match(api, /calendar_query/)
    assert.match(api, /runCalendarQuery/)
    assert.doesNotMatch(api, new RegExp(NEW_KEY))
    assert.doesNotMatch(api, new RegExp(OLD_KEY))
    const chat = read('api/chat.ts')
    assert.doesNotMatch(chat, /listEvents|calendar_query|SHINKAIDO_CALENDAR/)
  })

  it('does not log secret values (source contract)', () => {
    const files = [
      'lib/server/calendar-token-crypto.js',
      'lib/server/calendar-token-refresh.js',
      'supabase/functions/calendar-oauth-callback/index.ts',
      'supabase/functions/calendar-oauth-start/index.ts',
    ]
    for (const rel of files) {
      const src = read(rel)
      assert.doesNotMatch(src, /console\.(log|info|warn|error)\([^)]*encKey/)
      assert.doesNotMatch(src, /console\.(log|info|warn|error)\([^)]*ciphertext/)
      assert.doesNotMatch(src, /console\.(log|info|warn|error)\([^)]*plaintext/)
    }
  })
})
