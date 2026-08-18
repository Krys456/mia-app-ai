/**
 * #303C — Platform verify_jwt correction + worker-secret auth contract.
 *
 * Proves the intended Production cron contract for reminder-push-dispatch:
 *   - platform verify_jwt is false for THIS function only (not global)
 *   - missing worker secret  -> 401
 *   - wrong worker secret    -> 401
 *   - correct worker secret  -> accepted (via Authorization: Bearer OR header)
 *   - PUSH_ENABLED=false     -> safe push_disabled response
 *   - the worker cannot become a public push relay
 *   - 8 Vercel Functions remain unchanged; no cron function
 *
 * Run: node --experimental-strip-types --test lib/server/reminders-303c-verify-jwt.test.mjs
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import { pathToFileURL } from 'node:url'

const root = process.cwd()
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

const configToml = read('supabase/config.toml')
const edge = read('supabase/functions/reminder-push-dispatch/index.ts')
const vercel = JSON.parse(read('vercel.json'))
const deployed = Object.keys(vercel.functions || {})

const importAuth = () =>
  import(pathToFileURL(path.join(root, 'lib/server/reminder-worker-auth.js')).href)

describe('#303C platform verify_jwt is false for THIS function only', () => {
  it('config.toml scopes verify_jwt=false to reminder-push-dispatch', () => {
    assert.match(configToml, /\[functions\.reminder-push-dispatch\]/)
    const start = configToml.indexOf('[functions.reminder-push-dispatch]')
    const rest = configToml.slice(start + 1)
    const nextHeader = rest.search(/\n\[/)
    const scoped = nextHeader === -1 ? configToml.slice(start) : configToml.slice(start, start + 1 + nextHeader)
    assert.match(scoped, /verify_jwt\s*=\s*false/)
  })

  it('does NOT disable JWT verification globally', () => {
    // No bare [functions] table (which would apply to every function).
    assert.doesNotMatch(configToml, /^\s*\[functions\]\s*$/m)
    // No global edge_runtime/api verify_jwt disable.
    assert.doesNotMatch(configToml, /\[edge_runtime\][\s\S]*?verify_jwt\s*=\s*false/)
    // Exactly one verify_jwt=false declaration exists in the whole file.
    const matches = configToml.match(/verify_jwt\s*=\s*false/g) || []
    assert.equal(matches.length, 1)
  })
})

describe('#303C worker-secret auth preserved (missing / wrong / correct)', () => {
  it('authorizeWorkerRequest enforces the secret via both header forms', async () => {
    const mod = await importAuth()
    const SECRET = 'unit-test-worker-secret-xyz'

    // missing secret -> unauthorized
    assert.equal(mod.authorizeWorkerRequest({}, SECRET), false)
    // wrong secret (either header) -> unauthorized
    assert.equal(mod.authorizeWorkerRequest({ authorization: 'Bearer nope' }, SECRET), false)
    assert.equal(mod.authorizeWorkerRequest({ 'x-reminder-push-secret': 'nope' }, SECRET), false)
    // correct via Authorization: Bearer (the Production contract) -> authorized
    assert.equal(mod.authorizeWorkerRequest({ authorization: `Bearer ${SECRET}` }, SECRET), true)
    // correct via dedicated worker-secret header -> authorized
    assert.equal(mod.authorizeWorkerRequest({ 'x-reminder-push-secret': SECRET }, SECRET), true)
    // an empty configured secret must never authorize (fail-closed)
    assert.equal(mod.authorizeWorkerRequest({ authorization: `Bearer ${SECRET}` }, ''), false)
    // Headers-object (Web API) shape also works
    const h = new Headers({ Authorization: `Bearer ${SECRET}` })
    assert.equal(mod.authorizeWorkerRequest(h, SECRET), true)
  })

  it('gate returns 401 for missing/wrong and 405 for non-POST', async () => {
    const mod = await importAuth()
    const SECRET = 's3cr3t'
    const auth = { authorization: `Bearer ${SECRET}` }

    assert.equal(mod.evaluateWorkerGate({ headers: {}, secret: SECRET, pushEnabledRaw: 'false' }).status, 401)
    assert.equal(
      mod.evaluateWorkerGate({ headers: { authorization: 'Bearer x' }, secret: SECRET, pushEnabledRaw: 'false' }).status,
      401,
    )
    assert.equal(
      mod.evaluateWorkerGate({ method: 'GET', headers: auth, secret: SECRET, pushEnabledRaw: 'true' }).status,
      405,
    )
  })
})

describe('#303C PUSH_ENABLED=false -> safe push_disabled; not a public relay', () => {
  it('correct auth + PUSH_ENABLED=false returns push_disabled without sending', async () => {
    const mod = await importAuth()
    const SECRET = 'k'
    const auth = { authorization: `Bearer ${SECRET}` }
    const disabled = mod.evaluateWorkerGate({ headers: auth, secret: SECRET, pushEnabledRaw: 'false' })
    assert.deepEqual(disabled, { status: 200, body: { ok: true, skipped: 'push_disabled' } })

    assert.equal(mod.isPushEnabled('false'), false)
    assert.equal(mod.isPushEnabled(''), false)
    assert.equal(mod.isPushEnabled('true'), true)
    assert.equal(mod.isPushEnabled('1'), true)
  })

  it('relay attempts are rejected 400 even when authorized and push enabled', async () => {
    const mod = await importAuth()
    const SECRET = 'k'
    const auth = { authorization: `Bearer ${SECRET}` }
    for (const relay of [
      { endpoint: 'https://evil.example' },
      { payload: { x: 1 } },
      { title: 'spoof' },
      { user_id: 'attacker' },
      { reminder_id: 'r' },
    ]) {
      const r = mod.evaluateWorkerGate({ headers: auth, body: relay, secret: SECRET, pushEnabledRaw: 'true' })
      assert.equal(r.status, 400)
      assert.equal(r.body.code, 'worker_not_a_push_relay')
    }
    // A benign body (mode) is not a relay attempt.
    assert.equal(mod.isPushRelayAttempt({ mode: 'manual_smoke' }), false)
  })

  it('deployed Edge function mirrors the same worker-secret contract', () => {
    assert.match(edge, /REMINDER_PUSH_WORKER_SECRET/)
    assert.match(edge, /x-reminder-push-secret/)
    assert.match(edge, /startsWith\('bearer '\)/)
    assert.match(edge, /worker_unauthorized/)
    assert.match(edge, /worker_not_a_push_relay/)
    assert.match(edge, /skipped:\s*'push_disabled'/)
    assert.match(edge, /timingSafeEqual/)
    // Worker auth is secret-based, NOT a Supabase user/anon JWT check.
    assert.doesNotMatch(edge, /auth\.getUser\(/)
  })
})

describe('#303C protected invariants (8 Vercel functions, no cron)', () => {
  it('keeps exactly 8 deployed functions and no cron function', () => {
    assert.equal(deployed.length, 8)
    assert.ok(!deployed.some((f) => f.includes('cron')))
    assert.equal(fs.existsSync(path.join(root, 'api/cron')), false)
  })
})

console.log('ok: #303C verify_jwt + worker-secret contract')
