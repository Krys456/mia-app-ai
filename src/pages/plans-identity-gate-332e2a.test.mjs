/**
 * #332E2A — Plans identity gate render-loop + visibility contracts
 * Run: node --test src/pages/plans-identity-gate-332e2a.test.mjs
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { identityStatusEquals, resolveIdentityStatus } from '../../lib/server/durable-identity.js'

const root = process.cwd()
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

const plans = read('src/pages/Plans.tsx')
const panel = read('src/components/IdentityAccountPanel.tsx')
const clientId = read('src/lib/durableIdentity.ts')

// —— Anonymous Base/Pro Upgrade opens gate (same handler) ——
assert.match(plans, /onUpgradeClick/)
assert.match(plans, /setShowIdentityGate\(true\)/)
assert.match(plans, /!durable/)
assert.match(plans, /onClick=\{\(\) => onUpgradeClick\(plan\.planId\)\}/)
assert.doesNotMatch(plans, /planId === 'base'[\s\S]*setShowIdentityGate\(true\)[\s\S]*planId === 'pro'/)

// —— Durable skips gate ——
assert.match(
  plans,
  /setShowIdentityGate\(false\)[\s\S]*pagamenti Base saranno disponibili|Account collegato\. I pagamenti/,
)

// —— Loop fix: stable callback + equality ——
assert.match(plans, /const onIdentityChange = useCallback/)
assert.match(plans, /identityStatusEquals\(prev, next\) \? prev : next/)
assert.match(clientId, /export function identityStatusEquals/)
assert.match(panel, /onIdentityChangeRef/)
assert.match(panel, /reportIfChanged/)
assert.match(panel, /lastReportedRef/)

// Mount effect must NOT re-subscribe when parent callback identity changes
assert.match(panel, /intentional mount-only/)
assert.doesNotMatch(panel, /}, \[refresh\]\)/)

// —— Visibility ——
assert.match(plans, /autoFocus/)
assert.match(panel, /scrollIntoView/)
assert.match(panel, /plans-identity-gate/)

// —— Loading / error recoverability ——
assert.match(panel, /Caricamento stato account/)
assert.match(panel, /loadError/)
assert.match(panel, /Riprova/)

// —— Equality unit ——
{
  const anon = resolveIdentityStatus({
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    is_anonymous: true,
  })
  assert.equal(anon.durable, false)
  let parentSets = 0
  let prev = /** @type {ReturnType<typeof resolveIdentityStatus> | null} */ (null)
  const notify = (next) => {
    if (identityStatusEquals(prev, next)) return
    prev = next
    parentSets += 1
  }
  notify(anon)
  notify(anon)
  notify({ ...anon })
  assert.equal(parentSets, 1)

  const durable = resolveIdentityStatus({
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    is_anonymous: false,
    email: 'a@b.com',
    email_confirmed_at: '2026-08-20T00:00:00.000Z',
    identities: [{ provider: 'email' }],
  })
  notify(durable)
  notify(durable)
  assert.equal(parentSets, 2)
}

console.log('plans-identity-gate-332e2a: ok')
