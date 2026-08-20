/**
 * #332D — Subscription effective-plan + verified lookup contracts
 * Run: node --test lib/server/subscriptions-332d.test.mjs
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  evaluateSubscriptionAccess,
  mapProviderProductToPlanId,
  resolveEffectivePlanFromSubscriptions,
  toPublicSubscriptionView,
} from './subscriptions.js'
import { resolveRuntimePlanId, resolveEntitlements, canUse, requireEntitlement } from './entitlements.js'
import { loadUserEntitlementsAsync } from './entitlement-gates.js'
import { resolveVerifiedPlanForUser } from './subscription-lookup.js'

const root = process.cwd()
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')
const now = new Date('2026-08-20T12:00:00.000Z')
const future = '2026-09-20T12:00:00.000Z'
const past = '2026-07-20T12:00:00.000Z'

function row(partial) {
  return {
    user_id: 'u1',
    provider: 'manual',
    plan_id: 'base',
    status: 'active',
    cancel_at_period_end: false,
    ...partial,
  }
}

// —— No subscription → free ——
{
  const effective = resolveEffectivePlanFromSubscriptions([], now)
  assert.equal(effective.planId, 'free')
  assert.equal(effective.reason, 'free_no_subscription')
}

// —— Active Base / Pro ——
assert.equal(resolveEffectivePlanFromSubscriptions([row({ plan_id: 'base' })], now).planId, 'base')
assert.equal(resolveEffectivePlanFromSubscriptions([row({ plan_id: 'pro' })], now).planId, 'pro')
assert.equal(
  resolveEffectivePlanFromSubscriptions([row({ plan_id: 'base', status: 'active' })], now).reason,
  'paid_active',
)

// —— Canceled with future end → paid until end ——
{
  const effective = resolveEffectivePlanFromSubscriptions(
    [row({ plan_id: 'base', status: 'canceled', current_period_end: future })],
    now,
  )
  assert.equal(effective.planId, 'base')
  assert.equal(effective.reason, 'paid_canceled_until_period_end')
}

// —— Canceled past end → free ——
{
  const effective = resolveEffectivePlanFromSubscriptions(
    [row({ plan_id: 'base', status: 'canceled', current_period_end: past })],
    now,
  )
  assert.equal(effective.planId, 'free')
  assert.equal(effective.reason, 'expired')
}

// —— Grace Pro valid ——
{
  const effective = resolveEffectivePlanFromSubscriptions(
    [row({ plan_id: 'pro', status: 'grace', grace_until: future })],
    now,
  )
  assert.equal(effective.planId, 'pro')
  assert.equal(effective.reason, 'paid_grace')
}

// —— Expired / revoked ——
assert.equal(
  resolveEffectivePlanFromSubscriptions([row({ plan_id: 'pro', status: 'expired' })], now).planId,
  'free',
)
assert.equal(
  resolveEffectivePlanFromSubscriptions([row({ plan_id: 'pro', status: 'revoked' })], now)
    .reason,
  'revoked',
)

// —— Unknown status / plan → safe free ——
assert.equal(
  evaluateSubscriptionAccess(row({ status: 'weird' }), now).reason,
  'fallback_unknown',
)
assert.equal(
  evaluateSubscriptionAccess(row({ plan_id: 'enterprise', status: 'active' }), now).planId,
  'free',
)

// —— Multiple rows: highest granting tier ——
{
  const effective = resolveEffectivePlanFromSubscriptions(
    [
      row({ plan_id: 'base', status: 'active', provider: 'stripe' }),
      row({
        plan_id: 'pro',
        status: 'canceled',
        current_period_end: future,
        provider: 'app_store',
        provider_subscription_id: 'ios-1',
      }),
      row({ plan_id: 'base', status: 'expired', provider: 'google_play' }),
    ],
    now,
  )
  assert.equal(effective.planId, 'pro')
}

// —— Runtime plan honors verifiedPlanId; ignores client claim ——
assert.equal(resolveRuntimePlanId({ verifiedPlanId: 'pro' }), 'pro')
assert.equal(resolveRuntimePlanId({ claimedPlanId: 'pro' }), 'free')
assert.equal(resolveRuntimePlanId({ claimedPlanId: 'pro', verifiedPlanId: 'base' }), 'base')

// —— Product map empty until billing ——
assert.equal(mapProviderProductToPlanId('stripe', 'price_x'), null)

// —— Public view has no secrets ——
{
  const view = toPublicSubscriptionView(
    resolveEffectivePlanFromSubscriptions(
      [row({ plan_id: 'base', provider_customer_id: 'cus_secret', current_period_end: future })],
      now,
    ),
  )
  assert.equal(view.planId, 'base')
  assert.equal('provider_customer_id' in view, false)
  assert.equal(typeof view.provider, 'string')
}

// —— Verified lookup with injected fetch (no real DB) ——
{
  const verified = await resolveVerifiedPlanForUser('user-a', {
    billingEnvironment: 'live',
    fetchSubscriptionsForUser: async () => ({
      rows: [row({ user_id: 'user-a', plan_id: 'pro', status: 'active', environment: 'live' })],
      error: null,
    }),
    getServiceSupabase: async () => ({}),
  })
  assert.equal(verified.planId, 'pro')
  assert.equal(verified.lookupError, undefined)
  assert.equal(canUse(verified.entitlements, 'vision'), true)
}

// —— Lookup error surfaces ——
{
  const verified = await resolveVerifiedPlanForUser('user-b', {
    billingEnvironment: 'live',
    fetchSubscriptionsForUser: async () => ({
      rows: [],
      error: new Error('db down'),
    }),
    getServiceSupabase: async () => ({}),
  })
  assert.equal(verified.lookupError, true)
  assert.equal(verified.planId, 'free')
}

// —— loadUserEntitlementsAsync: OFF ⇒ no DB / Free ——
{
  const loaded = await loadUserEntitlementsAsync('u', {
    enforcementEnabled: false,
    resolveVerifiedPlanForUser: async () => {
      throw new Error('should not call lookup when enforcement OFF')
    },
  })
  assert.equal(loaded.planId, 'free')
  assert.equal(loaded.lookupError, false)
}

// —— Entitlement integration ON + verified Base/Pro via inject ——
{
  const freeE = resolveEntitlements('free')
  const baseE = resolveEntitlements('base')
  const proE = resolveEntitlements('pro')
  assert.equal(
    requireEntitlement({ entitlements: freeE, entitlement: 'webSearch', enforcementEnabled: true })
      .allowed,
    false,
  )
  assert.equal(
    requireEntitlement({ entitlements: baseE, entitlement: 'webSearch', enforcementEnabled: true })
      .allowed,
    true,
  )
  assert.equal(
    requireEntitlement({ entitlements: baseE, entitlement: 'vision', enforcementEnabled: true })
      .allowed,
    false,
  )
  assert.equal(
    requireEntitlement({ entitlements: proE, entitlement: 'vision', enforcementEnabled: true })
      .allowed,
    true,
  )
}

// —— Migration + RLS + API wiring ——
{
  const migration = read('supabase/migrations/20260820143000_subscriptions_332d.sql')
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.subscriptions/)
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/)
  assert.match(migration, /REVOKE ALL ON TABLE public\.subscriptions FROM anon/)
  assert.match(migration, /REVOKE ALL ON TABLE public\.subscriptions FROM authenticated/)
  assert.doesNotMatch(migration, /^CREATE POLICY/m)
  assert.doesNotMatch(migration, /\nCREATE POLICY/)
  assert.match(migration, /plan_id IN \('base', 'pro'\)/)
  assert.match(read('api/subscription.ts'), /resolveVerifiedPlanForUser/)
  assert.match(read('api/subscription.ts'), /subscription_lookup_unavailable/)
  assert.match(read('src/lib/subscriptionApi.ts'), /fetchVerifiedSubscription/)
  assert.match(read('src/pages/Plans.tsx'), /fetchVerifiedSubscription/)
  assert.match(read('lib/server/entitlement-gates.js'), /loadUserEntitlementsAsync/)
  assert.match(read('lib/server/paid-api-guard.js'), /decideRouteEntitlementAsync/)
  // Dynamic import keeps OFF-path bundles free of subscription-lookup.
  assert.match(read('lib/server/entitlement-gates.js'), /import\('\.\/subscription-lookup\.js'\)/)
  assert.doesNotMatch(
    read('lib/server/entitlement-gates.js'),
    /import \{ resolveVerifiedPlanForUser \} from '\.\/subscription-lookup\.js'/,
  )
  // Hobby ≤12 serverless functions: ignore api test probes so /api/subscription fits.
  const vercelIgnore = read('.vercelignore')
  assert.match(vercelIgnore, /api\/chat\.core\.test\.mjs/)
  assert.match(vercelIgnore, /api\/resolve-chat-model\.test\.mjs/)
}

// —— Enforcement still not activated in code defaults ——
{
  assert.match(read('lib/server/entitlements.js'), /ENTITLEMENT_ENFORCEMENT_ENABLED/)
  assert.doesNotMatch(read('api/subscription.ts'), /ENTITLEMENT_ENFORCEMENT_ENABLED\s*=\s*['"]true['"]/)
  assert.doesNotMatch(read('.env.example'), /ENTITLEMENT_ENFORCEMENT_ENABLED=true/)
}

// —— No billing SDKs ——
assert.doesNotMatch(read('package.json'), /revenuecat|storekit|@stripe\/stripe-js/i)
assert.match(read('package.json'), /"stripe"/)


console.log('subscriptions-332d: ok')
