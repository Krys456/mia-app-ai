/**
 * #332E1 — Provider-neutral billing core
 * Run: node --test lib/server/billing-332e1.test.mjs
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  applyBillingEvent,
  createBillingMemoryStore,
  memoryStoreAddUser,
  memoryStoreSubscriptionsForUser,
} from './billing-apply.js'
import {
  buildVerifiedBillingEvent,
  mapProviderProductToPlanId,
} from './billing-event.js'
import { resolveVerifiedPlanForUser } from './subscription-lookup.js'
import { resolveEffectivePlanFromSubscriptions as resolveEffective } from './subscriptions.js'
import {
  canUse,
  isEntitlementEnforcementEnabled,
  requireEntitlement,
  resolveEntitlements,
} from './entitlements.js'

const root = process.cwd()
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

/** Test-only product map — never shipped as a runtime fake provider. */
const TEST_PRODUCT_MAP = Object.freeze({
  stripe: Object.freeze({
    price_base_monthly: 'base',
    price_pro_monthly: 'pro',
  }),
  google_play: Object.freeze({
    shinkaido_base_monthly: 'base',
    shinkaido_pro_monthly: 'pro',
  }),
  app_store: Object.freeze({
    shinkaido_base_monthly: 'base',
    shinkaido_pro_monthly: 'pro',
  }),
  manual: Object.freeze({
    manual_base: 'base',
    manual_pro: 'pro',
  }),
})

const USER = '11111111-1111-1111-1111-111111111111'
const USER_B = '22222222-2222-2222-2222-222222222222'

/**
 * @param {Partial<import('./billing-event.js').BillingEventInput>} partial
 */
function baseEvent(partial = {}) {
  return {
    provider: 'stripe',
    providerEventId: 'evt_1',
    eventType: 'subscription.updated',
    eventTimestamp: '2026-08-20T12:00:00.000Z',
    environment: 'live',
    userId: USER,
    providerCustomerId: 'cus_1',
    providerSubscriptionId: 'sub_stripe_1',
    providerProductId: 'price_base_monthly',
    status: 'active',
    currentPeriodStart: '2026-08-01T00:00:00.000Z',
    currentPeriodEnd: '2026-09-01T00:00:00.000Z',
    graceUntil: null,
    cancelAtPeriodEnd: false,
    ...partial,
  }
}

async function apply(partial, store, extra = {}) {
  return applyBillingEvent(baseEvent(partial), {
    memoryStore: store,
    productMap: TEST_PRODUCT_MAP,
    allowManual: extra.allowManual === true,
    ...extra,
  })
}

// —— Product mapping: ignore planId / unknown ——
{
  assert.equal(
    mapProviderProductToPlanId('stripe', 'price_pro_monthly', { productMap: TEST_PRODUCT_MAP }),
    'pro',
  )
  assert.equal(
    mapProviderProductToPlanId('stripe', 'unknown_sku', { productMap: TEST_PRODUCT_MAP }),
    null,
  )
  const built = buildVerifiedBillingEvent(
    { ...baseEvent({ providerProductId: 'nope', planId: 'pro' }) },
    { productMap: TEST_PRODUCT_MAP },
  )
  assert.equal(built.ok, false)
  assert.equal(built.result, 'unknown_product')
}

// —— Manual blocked unless allowManual ——
{
  const denied = buildVerifiedBillingEvent(
    baseEvent({ provider: 'manual', providerProductId: 'manual_base' }),
    { productMap: TEST_PRODUCT_MAP },
  )
  assert.equal(denied.ok, false)
  assert.equal(denied.detail, 'manual_not_allowed')
}

// —— Valid Base / Pro ——
{
  const store = createBillingMemoryStore()
  memoryStoreAddUser(store, USER)
  const base = await apply({}, store)
  assert.equal(base.result, 'applied')
  assert.equal(base.planId, 'base')
  const rows = memoryStoreSubscriptionsForUser(store, USER)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].plan_id, 'base')
  assert.equal(rows[0].environment, 'live')

  const pro = await apply(
    {
      providerEventId: 'evt_pro',
      providerSubscriptionId: 'sub_stripe_pro',
      providerProductId: 'price_pro_monthly',
    },
    store,
  )
  assert.equal(pro.result, 'applied')
  assert.equal(pro.planId, 'pro')
}

// —— Unknown product → no paid grant ——
{
  const store = createBillingMemoryStore()
  memoryStoreAddUser(store, USER)
  const res = await apply({ providerProductId: 'not_a_real_price', providerEventId: 'evt_x' }, store)
  assert.equal(res.result, 'unknown_product')
  assert.equal(memoryStoreSubscriptionsForUser(store, USER).length, 0)
}

// —— Duplicate event ——
{
  const store = createBillingMemoryStore()
  memoryStoreAddUser(store, USER)
  assert.equal((await apply({ providerEventId: 'evt_dup' }, store)).result, 'applied')
  const second = await apply({ providerEventId: 'evt_dup' }, store)
  assert.equal(second.result, 'duplicate')
  assert.equal(memoryStoreSubscriptionsForUser(store, USER).length, 1)
}

// —— Stale event ignored ——
{
  const store = createBillingMemoryStore()
  memoryStoreAddUser(store, USER)
  await apply(
    {
      providerEventId: 'evt_new',
      eventTimestamp: '2026-08-20T12:00:00.000Z',
      providerProductId: 'price_pro_monthly',
    },
    store,
  )
  const stale = await apply(
    {
      providerEventId: 'evt_old',
      eventTimestamp: '2026-08-20T11:00:00.000Z',
      providerProductId: 'price_base_monthly',
    },
    store,
  )
  assert.equal(stale.result, 'stale')
  assert.equal(memoryStoreSubscriptionsForUser(store, USER)[0].plan_id, 'pro')
}

// —— Renewal updates period, same row ——
{
  const store = createBillingMemoryStore()
  memoryStoreAddUser(store, USER)
  await apply({ providerEventId: 'evt_r1', currentPeriodEnd: '2026-09-01T00:00:00.000Z' }, store)
  const renewed = await apply(
    {
      providerEventId: 'evt_r2',
      eventTimestamp: '2026-08-21T12:00:00.000Z',
      currentPeriodEnd: '2026-10-01T00:00:00.000Z',
    },
    store,
  )
  assert.equal(renewed.result, 'applied')
  const rows = memoryStoreSubscriptionsForUser(store, USER)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].current_period_end, '2026-10-01T00:00:00.000Z')
}

// —— Base → Pro upgrade ——
{
  const store = createBillingMemoryStore()
  memoryStoreAddUser(store, USER)
  await apply({ providerEventId: 'evt_u1' }, store)
  const up = await apply(
    {
      providerEventId: 'evt_u2',
      eventTimestamp: '2026-08-20T13:00:00.000Z',
      providerProductId: 'price_pro_monthly',
    },
    store,
  )
  assert.equal(up.result, 'applied')
  assert.equal(up.planId, 'pro')
  assert.equal(memoryStoreSubscriptionsForUser(store, USER)[0].plan_id, 'pro')
}

// —— Cancellation future → retains paid via #332D resolver ——
{
  const store = createBillingMemoryStore()
  memoryStoreAddUser(store, USER)
  await apply({ providerEventId: 'evt_c1' }, store)
  await apply(
    {
      providerEventId: 'evt_c2',
      eventTimestamp: '2026-08-20T14:00:00.000Z',
      status: 'canceled',
      cancelAtPeriodEnd: true,
      currentPeriodEnd: '2026-09-01T00:00:00.000Z',
    },
    store,
  )
  const effective = resolveEffective(
    memoryStoreSubscriptionsForUser(store, USER),
    new Date('2026-08-20T15:00:00.000Z'),
  )
  assert.equal(effective.planId, 'base')
  assert.equal(effective.reason, 'paid_canceled_until_period_end')
}

// —— Expired → Free ——
{
  const store = createBillingMemoryStore()
  memoryStoreAddUser(store, USER)
  await apply(
    {
      providerEventId: 'evt_e1',
      status: 'expired',
      currentPeriodEnd: '2026-07-01T00:00:00.000Z',
    },
    store,
  )
  const effective = resolveEffective(
    memoryStoreSubscriptionsForUser(store, USER),
    new Date('2026-08-20T12:00:00.000Z'),
  )
  assert.equal(effective.planId, 'free')
}

// —— Revoke immediate + stale after revoke ——
{
  const store = createBillingMemoryStore()
  memoryStoreAddUser(store, USER)
  await apply(
    {
      providerEventId: 'evt_v1',
      providerProductId: 'price_pro_monthly',
      eventTimestamp: '2026-08-20T12:00:00.000Z',
    },
    store,
  )
  const revoked = await apply(
    {
      providerEventId: 'evt_v2',
      providerProductId: 'price_pro_monthly',
      status: 'revoked',
      eventTimestamp: '2026-08-20T13:00:00.000Z',
    },
    store,
  )
  assert.equal(revoked.result, 'revoked')
  const effective = resolveEffective(
    memoryStoreSubscriptionsForUser(store, USER),
    new Date('2026-08-20T14:00:00.000Z'),
  )
  assert.equal(effective.planId, 'free')
  assert.equal(effective.reason, 'revoked')

  const staleRenew = await apply(
    {
      providerEventId: 'evt_v3',
      providerProductId: 'price_pro_monthly',
      status: 'active',
      eventTimestamp: '2026-08-20T12:30:00.000Z',
    },
    store,
  )
  assert.equal(staleRenew.result, 'stale')
  assert.equal(
    resolveEffective(memoryStoreSubscriptionsForUser(store, USER), new Date('2026-08-20T14:00:00.000Z'))
      .planId,
    'free',
  )
}

// —— Grace ——
{
  const store = createBillingMemoryStore()
  memoryStoreAddUser(store, USER)
  await apply(
    {
      providerEventId: 'evt_g1',
      providerProductId: 'price_pro_monthly',
      status: 'grace',
      graceUntil: '2026-08-25T00:00:00.000Z',
    },
    store,
  )
  const effective = resolveEffective(
    memoryStoreSubscriptionsForUser(store, USER),
    new Date('2026-08-20T12:00:00.000Z'),
  )
  assert.equal(effective.planId, 'pro')
  assert.equal(effective.reason, 'paid_grace')
}

// —— Multiple providers → highest tier ——
{
  const store = createBillingMemoryStore()
  memoryStoreAddUser(store, USER)
  await apply(
    {
      provider: 'stripe',
      providerEventId: 'evt_mp1',
      providerSubscriptionId: 'sub_web',
      providerProductId: 'price_base_monthly',
    },
    store,
  )
  await apply(
    {
      provider: 'app_store',
      providerEventId: 'evt_mp2',
      providerSubscriptionId: 'orig_tx_ios',
      providerProductId: 'shinkaido_pro_monthly',
    },
    store,
  )
  const rows = memoryStoreSubscriptionsForUser(store, USER)
  assert.equal(rows.length, 2)
  assert.equal(resolveEffective(rows, new Date('2026-08-20T12:00:00.000Z')).planId, 'pro')
}

// —— Invalid / missing user ——
{
  const store = createBillingMemoryStore()
  const res = await apply({ providerEventId: 'evt_nouser' }, store)
  assert.equal(res.result, 'user_not_found')
}

// —— User mismatch on same provider subscription ——
{
  const store = createBillingMemoryStore()
  memoryStoreAddUser(store, USER)
  memoryStoreAddUser(store, USER_B)
  await apply({ providerEventId: 'evt_own1' }, store)
  const mismatch = await apply(
    {
      providerEventId: 'evt_own2',
      eventTimestamp: '2026-08-20T15:00:00.000Z',
      userId: USER_B,
    },
    store,
  )
  assert.equal(mismatch.result, 'user_mismatch')
  assert.equal(memoryStoreSubscriptionsForUser(store, USER)[0].user_id, USER)
}

// —— Sandbox / live isolation ——
{
  const store = createBillingMemoryStore()
  memoryStoreAddUser(store, USER)
  await apply(
    {
      providerEventId: 'evt_live',
      environment: 'live',
      providerSubscriptionId: 'same_sub_id',
      providerProductId: 'price_base_monthly',
    },
    store,
  )
  await apply(
    {
      providerEventId: 'evt_sand',
      environment: 'sandbox',
      providerSubscriptionId: 'same_sub_id',
      providerProductId: 'price_pro_monthly',
    },
    store,
  )
  const rows = memoryStoreSubscriptionsForUser(store, USER)
  assert.equal(rows.length, 2)
  assert.equal(rows.filter((r) => r.environment === 'live')[0].plan_id, 'base')
  assert.equal(rows.filter((r) => r.environment === 'sandbox')[0].plan_id, 'pro')
}

// —— Client plan claim irrelevant (input planId ignored) ——
{
  const store = createBillingMemoryStore()
  memoryStoreAddUser(store, USER)
  const res = await apply(
    {
      providerEventId: 'evt_claim',
      providerProductId: 'price_base_monthly',
      planId: 'pro',
    },
    store,
  )
  assert.equal(res.result, 'applied')
  assert.equal(res.planId, 'base')
}

// —— Entitlement integration via #332D resolver ——
{
  const store = createBillingMemoryStore()
  memoryStoreAddUser(store, USER)
  await apply(
    {
      providerEventId: 'evt_ent',
      providerProductId: 'price_pro_monthly',
    },
    store,
  )
  const verified = await resolveVerifiedPlanForUser(USER, {
    fetchSubscriptionsForUser: async () => ({
      rows: memoryStoreSubscriptionsForUser(store, USER),
      error: null,
    }),
    getServiceSupabase: async () => ({}),
  })
  assert.equal(verified.planId, 'pro')
  const ents = resolveEntitlements(verified.planId)
  assert.equal(canUse(ents, 'vision'), true)
  assert.equal(canUse(ents, 'webSearch'), true)
  assert.equal(
    requireEntitlement({ entitlements: ents, entitlement: 'vision', enforcementEnabled: true })
      .allowed,
    true,
  )
}

// —— Enforcement still OFF by default ——
assert.equal(isEntitlementEnforcementEnabled({}), false)
assert.equal(isEntitlementEnforcementEnabled({ ENTITLEMENT_ENFORCEMENT_ENABLED: 'false' }), false)

// —— Migration + security wiring ——
{
  const migration = read('supabase/migrations/20260820160000_billing_core_332e1.sql')
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.billing_events/)
  assert.match(migration, /billing_events_provider_env_event_unique/)
  assert.match(migration, /last_provider_event_at/)
  assert.match(migration, /subscriptions_provider_env_sub_unique/)
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.apply_billing_event/)
  assert.match(migration, /SECURITY DEFINER/)
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/)
  assert.match(migration, /REVOKE ALL ON TABLE public\.billing_events FROM anon/)
  assert.match(migration, /REVOKE ALL ON TABLE public\.billing_events FROM authenticated/)
  assert.doesNotMatch(migration, /\nCREATE POLICY/)
  assert.doesNotMatch(migration, /raw_payload|webhook_body|receipt|purchase_token/i)

  assert.match(read('lib/server/billing-apply.js'), /applyBillingEvent/)
  assert.match(read('lib/server/billing-event.js'), /BillingProviderAdapter|ProviderAdapter/)
  // #388B adds Stripe SDK + Hobby rewrite; still no dedicated webhook serverless file.
  assert.doesNotMatch(read('vercel.json'), /google-play-webhook|apple-webhook/)
  assert.match(read('package.json'), /"stripe"/)
  assert.doesNotMatch(read('package.json'), /revenuecat|storekit/i)

  // No extra serverless function for billing (#332E1/#388B Hobby-safe)
  assert.ok(!fs.existsSync(path.join(root, 'api/billing.ts')))
  assert.ok(!fs.existsSync(path.join(root, 'api/stripe-webhook.ts')))
}

// —— Hobby function budget still respected ——
{
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
  assert.ok(deployable.length <= 12, `function count ${deployable.length} exceeds Hobby 12`)
  assert.ok(!deployable.some((f) => /webhook/i.test(f)))
}

console.log('billing-332e1: ok')
