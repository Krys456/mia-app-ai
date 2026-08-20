/**
 * #332E2B — Change email / same auth.uid contracts
 * Run: node --test src/lib/change-email-332e2b.test.mjs
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

// Load client durableIdentity via experimental strip if needed — use server mirror for unit bits.
const {
  resolveIdentityStatus,
  isDurableIdentity,
  identityStatusEquals,
  maskEmail,
} = await import('../../lib/server/durable-identity.js')

const linking = read('src/lib/accountLinking.ts')
const panel = read('src/components/IdentityAccountPanel.tsx')
const clientId = read('src/lib/durableIdentity.ts')
const brain = read('lib/server/brain-memory.js')

// —— API: change email uses updateUser, not signInWithOtp ——
assert.match(linking, /export async function changeEmailForCurrentUser/)
assert.match(linking, /changeEmailForCurrentUser[\s\S]*?updateUser\(/)
assert.match(linking, /emailRedirectTo/)
// First function body only until next export — ensure no OTP in change path
{
  const start = linking.indexOf('export async function changeEmailForCurrentUser')
  const end = linking.indexOf('export async function signInExistingWithEmailOtp', start)
  const body = linking.slice(start, end)
  assert.ok(end > start)
  assert.doesNotMatch(body, /signInWithOtp/)
  assert.match(body, /beforeId !== afterId/)
  assert.match(body, /same_email/)
  assert.match(body, /not_durable/)
  assert.match(body, /invalid_email/)
  assert.match(body, /if \(error\) return mapAuthError\(error\)/)
}
assert.match(linking, /Questa email è già associata a un altro account/)

// —— UI: durable email users see Cambia email; anonymous does not get primary change CTA ——
assert.match(panel, /Cambia email/)
assert.match(panel, /changeEmailForCurrentUser|onChangeEmail/)
assert.match(panel, /mode === 'change-email'|change-email/)
assert.match(panel, /emailLinked/)
assert.match(panel, /Nuova email/)
assert.match(panel, /Secure Email Change|secure email change/i)
// Anonymous primary CTA remains Collega account, not Cambia email as primary for !durable
assert.match(panel, /!durable[\s\S]*Collega account/)
assert.match(panel, /emailLinked \? \([\s\S]*Cambia email/)

// —— Pending fields on identity ——
assert.match(clientId, /pendingEmailMasked/)
assert.match(clientId, /emailChangePending/)
assert.match(clientId, /new_email/)

{
  const durableUser = {
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    is_anonymous: false,
    email: 'old@example.com',
    email_confirmed_at: '2026-08-20T00:00:00.000Z',
    identities: [{ provider: 'email' }],
  }
  assert.equal(isDurableIdentity(durableUser), true)
  const pending = resolveIdentityStatus({
    ...durableUser,
    new_email: 'new@example.com',
    email_change_sent_at: '2026-08-20T12:00:00.000Z',
  })
  assert.equal(pending.durable, true)
  assert.equal(pending.userId, durableUser.id)
  assert.equal(pending.emailChangePending, true)
  assert.equal(pending.pendingEmailMasked, maskEmail('new@example.com'))
  assert.equal(pending.emailMasked, maskEmail('old@example.com'))

  const confirmed = resolveIdentityStatus({
    ...durableUser,
    email: 'new@example.com',
    new_email: null,
  })
  assert.equal(confirmed.durable, true)
  assert.equal(confirmed.userId, durableUser.id)
  assert.equal(confirmed.emailChangePending, false)
  assert.ok(identityStatusEquals(pending, pending))
  assert.equal(identityStatusEquals(pending, confirmed), false)
}

{
  const anon = resolveIdentityStatus({
    id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    is_anonymous: true,
  })
  assert.equal(anon.durable, false)
  assert.equal(anon.emailChangePending, false)
}

// —— public.users sync same id (existing mechanism) ——
assert.match(brain, /export async function syncPublicUserProfile/)
assert.match(brain, /ensureAuthUserRow\(supabase, authUserId\)/)
assert.match(brain, /\.update\(\{ email \}\)\.eq\('id', id\)/)
assert.doesNotMatch(brain, /syncPublicUserProfile[\s\S]{0,400}insert\([\s\S]{0,80}email/)

// —— No Stripe / billing / enforcement in this patch surface ——
assert.doesNotMatch(linking, /stripe|STRIPE_|create_checkout/i)
assert.doesNotMatch(panel, /stripe|checkoutUrl|createCheckout/i)

// —— package still has supabase ——
assert.match(read('package.json'), /@supabase\/supabase-js/)

console.log('change-email-332e2b: ok')
