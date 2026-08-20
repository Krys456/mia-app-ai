/**
 * #332E2 — Durable identity helpers + continuity contracts
 * Run: node --test lib/server/durable-identity-332e2.test.mjs
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  isDurableIdentity,
  maskEmail,
  requireDurableIdentity,
  resolveIdentityStatus,
} from './durable-identity.js'

const root = process.cwd()
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

// —— Anonymous → not durable ——
{
  const user = {
    id: '11111111-1111-1111-1111-111111111111',
    is_anonymous: true,
    email: null,
    identities: [{ provider: 'anonymous' }],
  }
  assert.equal(isDurableIdentity(user), false)
  assert.equal(resolveIdentityStatus(user).durable, false)
  assert.equal(requireDurableIdentity(user).ok, false)
  assert.equal(requireDurableIdentity(user).code, 'not_durable')
}

// —— Email confirmed → durable ——
{
  const user = {
    id: '11111111-1111-1111-1111-111111111111',
    is_anonymous: false,
    email: 'alex@example.com',
    email_confirmed_at: '2026-08-20T12:00:00.000Z',
    identities: [{ provider: 'email' }],
  }
  assert.equal(isDurableIdentity(user), true)
  assert.equal(resolveIdentityStatus(user).emailMasked, 'al***@example.com')
  assert.equal(requireDurableIdentity(user).ok, true)
}

// —— Google linked → durable ——
{
  const user = {
    id: '11111111-1111-1111-1111-111111111111',
    is_anonymous: false,
    email: 'alex@gmail.com',
    identities: [{ provider: 'google' }],
  }
  assert.equal(isDurableIdentity(user), true)
  assert.deepEqual(resolveIdentityStatus(user).providers, ['google'])
}

// —— Apple linked → durable ——
{
  const user = {
    id: '11111111-1111-1111-1111-111111111111',
    is_anonymous: false,
    identities: [{ provider: 'apple' }],
  }
  assert.equal(isDurableIdentity(user), true)
}

// —— Unknown / empty → fail safe ——
assert.equal(isDurableIdentity(null), false)
assert.equal(isDurableIdentity({}), false)
assert.equal(requireDurableIdentity(null).code, 'not_authenticated')

// —— Placeholder laife email not masked as real ——
assert.equal(maskEmail('auth:111@laife.local'), null)

// —— Continuity: link path must preserve user id (code contract) ——
{
  const linking = read('src/lib/accountLinking.ts')
  assert.match(linking, /updateUser/)
  assert.match(linking, /beforeId/)
  assert.match(linking, /beforeId !== afterId/)
  assert.match(linking, /linkIdentity/)
  assert.match(linking, /shouldCreateUser:\s*false/)
  assert.match(linking, /non verranno uniti|non viene(?:ranno)? unit/)
}

// —— syncPublicUserProfile never changes id ——
{
  const brain = read('lib/server/brain-memory.js')
  assert.match(brain, /syncPublicUserProfile/)
  assert.match(brain, /Never changes id/)
}

// —— No new serverless route ——
{
  assert.ok(!fs.existsSync(path.join(root, 'api/account.ts')))
  assert.ok(!fs.existsSync(path.join(root, 'api/identity.ts')))
  const ignore = new Set(
    read('.vercelignore')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#')),
  )
  const apiRoot = path.join(root, 'api')
  /** @type {string[]} */
  const deployable = []
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name)
      if (ent.isDirectory()) walk(full)
      else if (/\.(ts|js|mjs)$/.test(ent.name)) {
        const rel = path.relative(root, full).split(path.sep).join('/')
        if (!ignore.has(rel)) deployable.push(rel)
      }
    }
  }
  walk(apiRoot)
  assert.equal(deployable.length, 11)
  assert.ok(deployable.length <= 12)
}

// —— Plans identity gate ——
{
  const plans = read('src/pages/Plans.tsx')
  assert.match(plans, /IdentityAccountPanel/)
  assert.match(plans, /showIdentityGate/)
  assert.match(plans, /proteggere e ripristinare/)
  assert.match(plans, /pagamenti saranno disponibili|Pagamenti.*breve/i)
  assert.doesNotMatch(plans, /checkout|stripe|purchase\(/i)
}

// —— Enforcement / billing untouched ——
assert.doesNotMatch(read('lib/server/entitlements.js'), /ENTITLEMENT_ENFORCEMENT_ENABLED\s*=\s*['"]true['"]/)
assert.doesNotMatch(read('package.json'), /stripe|revenuecat|storekit/i)
assert.match(read('lib/server/billing-apply.js'), /applyBillingEvent/)

// —— detectSessionInUrl for email confirm ——
assert.match(read('src/lib/supabase.ts'), /detectSessionInUrl:\s*true/)

console.log('durable-identity-332e2: ok')
