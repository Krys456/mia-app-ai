/**
 * #332E3A — Billing environment isolation + Stripe sandbox contracts
 * Run: node --test lib/server/billing-332e3a.test.mjs
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  filterSubscriptionsByEnvironment,
  normalizeBillingEnvironment,
  requireRuntimeBillingEnvironment,
  resolveRuntimeBillingEnvironment,
} from './billing-environment.js'
import {
  detectStripeKeyMode,
  loadStripeBillingConfig,
  mapStripePriceToPlanId,
  resolvePriceIdForPlan,
  stripeProductMapFromConfig,
} from './stripe-config.js'
import {
  billingEventFromStripeSubscription,
  evaluateCheckoutEligibility,
  extractSubscriptionPeriodUnix,
  extractSubscriptionPriceId,
  mapStripeSubscriptionStatus,
  STRIPE_HANDLED_EVENTS,
} from './stripe-billing.js'
import { resolveEffectivePlanFromSubscriptions } from './subscriptions.js'
import { resolveVerifiedPlanForUser } from './subscription-lookup.js'
import { applyBillingEvent, createBillingMemoryStore, memoryStoreAddUser } from './billing-apply.js'
import { isEntitlementEnforcementEnabled } from './entitlements.js'

const root = process.cwd()
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

const USER = '11111111-1111-1111-1111-111111111111'
const now = new Date('2026-08-20T12:00:00.000Z')

function row(partial) {
  return {
    user_id: USER,
    provider: 'stripe',
    environment: 'sandbox',
    provider_customer_id: 'cus_x',
    provider_subscription_id: 'sub_x',
    product_id: 'price_base',
    plan_id: 'base',
    status: 'active',
    current_period_start: '2026-08-01T00:00:00.000Z',
    current_period_end: '2026-09-01T00:00:00.000Z',
    cancel_at_period_end: false,
    grace_until: null,
    ...partial,
  }
}

// —— Environment parser ——
assert.equal(normalizeBillingEnvironment('sandbox'), 'sandbox')
assert.equal(normalizeBillingEnvironment('LIVE'), 'live')
assert.equal(normalizeBillingEnvironment('prod'), null)
assert.equal(resolveRuntimeBillingEnvironment({}), null)
assert.equal(resolveRuntimeBillingEnvironment({ BILLING_ENVIRONMENT: 'nope' }), null)
assert.equal(requireRuntimeBillingEnvironment({}).ok, false)
assert.equal(
  requireRuntimeBillingEnvironment({ BILLING_ENVIRONMENT: 'sandbox' }).environment,
  'sandbox',
)

// —— Cross-environment isolation (critical) ——
{
  const sandboxPro = row({
    environment: 'sandbox',
    plan_id: 'pro',
    product_id: 'price_pro_sb',
    provider_subscription_id: 'sub_sb',
  })
  const liveFreeOnly = [] // no live rows
  const liveRows = filterSubscriptionsByEnvironment([sandboxPro], 'live')
  assert.equal(liveRows.length, 0)
  assert.equal(resolveEffectivePlanFromSubscriptions(liveRows, now).planId, 'free')
  assert.equal(
    resolveEffectivePlanFromSubscriptions(
      filterSubscriptionsByEnvironment([sandboxPro], 'sandbox'),
      now,
    ).planId,
    'pro',
  )
}

{
  const sandboxBase = row({
    environment: 'sandbox',
    plan_id: 'base',
    provider_subscription_id: 'sub_sb_base',
  })
  const livePro = row({
    environment: 'live',
    plan_id: 'pro',
    product_id: 'price_pro_live',
    provider_subscription_id: 'sub_live_pro',
  })
  const both = [sandboxBase, livePro]
  assert.equal(
    resolveEffectivePlanFromSubscriptions(filterSubscriptionsByEnvironment(both, 'sandbox'), now)
      .planId,
    'base',
  )
  assert.equal(
    resolveEffectivePlanFromSubscriptions(filterSubscriptionsByEnvironment(both, 'live'), now)
      .planId,
    'pro',
  )
  // Unfiltered highest-tier would wrongly pick Pro for sandbox — prove we filter first
  assert.equal(resolveEffectivePlanFromSubscriptions(both, now).planId, 'pro')
}

{
  const verifiedSandbox = await resolveVerifiedPlanForUser(USER, {
    billingEnvironment: 'sandbox',
    fetchSubscriptionsForUser: async (_sb, _id, opts) => {
      assert.equal(opts.environment, 'sandbox')
      return {
        rows: [
          row({ environment: 'sandbox', plan_id: 'pro', provider_subscription_id: 'sub_sb' }),
          row({ environment: 'live', plan_id: 'base', provider_subscription_id: 'sub_live' }),
        ],
        error: null,
      }
    },
    getServiceSupabase: async () => ({}),
  })
  assert.equal(verifiedSandbox.planId, 'pro')

  const verifiedLive = await resolveVerifiedPlanForUser(USER, {
    billingEnvironment: 'live',
    fetchSubscriptionsForUser: async (_sb, _id, opts) => {
      assert.equal(opts.environment, 'live')
      return {
        rows: [
          row({ environment: 'sandbox', plan_id: 'pro', provider_subscription_id: 'sub_sb' }),
          row({ environment: 'live', plan_id: 'base', provider_subscription_id: 'sub_live' }),
        ],
        error: null,
      }
    },
    getServiceSupabase: async () => ({}),
  })
  assert.equal(verifiedLive.planId, 'base')
}

{
  const missingEnv = await resolveVerifiedPlanForUser(USER, {
    env: {},
    fetchSubscriptionsForUser: async () => ({
      rows: [row({ plan_id: 'pro' })],
      error: null,
    }),
    getServiceSupabase: async () => ({}),
  })
  assert.equal(missingEnv.lookupError, true)
  assert.equal(missingEnv.planId, 'free')
}

// —— Stripe config ——
assert.equal(detectStripeKeyMode('sk_test_abc'), 'sandbox')
assert.equal(detectStripeKeyMode('sk_live_abc'), 'live')
assert.equal(detectStripeKeyMode('pk_test_abc'), null)

{
  const bad = loadStripeBillingConfig({
    BILLING_ENVIRONMENT: 'sandbox',
    STRIPE_SECRET_KEY: 'sk_live_xxx',
    STRIPE_WEBHOOK_SECRET: 'whsec_x',
    STRIPE_PRICE_BASE_MONTHLY: 'price_base',
    STRIPE_PRICE_PRO_MONTHLY: 'price_pro',
  })
  assert.equal(bad.ok, false)
  assert.equal(bad.code, 'billing_configuration_error')
}

{
  const incomplete = loadStripeBillingConfig({
    BILLING_ENVIRONMENT: 'sandbox',
    STRIPE_SECRET_KEY: 'sk_test_xxx',
  })
  assert.equal(incomplete.ok, false)
  assert.equal(incomplete.code, 'billing_unavailable')
}

{
  const ok = loadStripeBillingConfig({
    BILLING_ENVIRONMENT: 'sandbox',
    STRIPE_SECRET_KEY: 'sk_test_xxx',
    STRIPE_WEBHOOK_SECRET: 'whsec_x',
    STRIPE_PRICE_BASE_MONTHLY: 'price_base_monthly',
    STRIPE_PRICE_PRO_MONTHLY: 'price_pro_monthly',
  })
  assert.equal(ok.ok, true)
  assert.equal(resolvePriceIdForPlan(ok.config, 'base').priceId, 'price_base_monthly')
  assert.equal(resolvePriceIdForPlan(ok.config, 'enterprise').ok, false)
  assert.equal(mapStripePriceToPlanId(ok.config, 'price_pro_monthly'), 'pro')
  assert.equal(mapStripePriceToPlanId(ok.config, 'price_unknown'), null)
  assert.deepEqual(stripeProductMapFromConfig(ok.config).stripe, {
    price_base_monthly: 'base',
    price_pro_monthly: 'pro',
  })
}

// —— Checkout eligibility ——
assert.equal(evaluateCheckoutEligibility({ planId: 'free', status: 'none' }, 'base').ok, true)
assert.equal(
  evaluateCheckoutEligibility({ planId: 'base', status: 'active' }, 'base').code,
  'subscription_already_active',
)
assert.equal(
  evaluateCheckoutEligibility({ planId: 'base', status: 'active' }, 'pro').code,
  'billing_management_required',
)
assert.equal(
  evaluateCheckoutEligibility({ planId: 'pro', status: 'active' }, 'base').code,
  'billing_management_required',
)
assert.equal(
  evaluateCheckoutEligibility({ planId: 'base', status: 'past_due' }, 'pro').code,
  'billing_management_required',
)
assert.equal(
  evaluateCheckoutEligibility({ planId: 'free', status: 'none', lookupError: true }, 'base').code,
  'subscription_lookup_unavailable',
)

// —— Status mapping ——
assert.equal(mapStripeSubscriptionStatus('active'), 'active')
assert.equal(mapStripeSubscriptionStatus('trialing'), 'trialing')
assert.equal(mapStripeSubscriptionStatus('past_due'), 'past_due')
assert.equal(mapStripeSubscriptionStatus('unpaid'), 'past_due')
assert.equal(mapStripeSubscriptionStatus('incomplete'), null)
assert.equal(mapStripeSubscriptionStatus('paused'), null)
assert.equal(mapStripeSubscriptionStatus('incomplete_expired'), 'expired')
assert.equal(
  mapStripeSubscriptionStatus('canceled', {
    periodEndMs: Date.parse('2026-09-01T00:00:00.000Z'),
    nowMs: Date.parse('2026-08-20T00:00:00.000Z'),
  }),
  'canceled',
)
assert.equal(
  mapStripeSubscriptionStatus('canceled', {
    periodEndMs: Date.parse('2026-08-01T00:00:00.000Z'),
    nowMs: Date.parse('2026-08-20T00:00:00.000Z'),
  }),
  'expired',
)

// —— BillingEvent from Stripe subscription shape ——
{
  const config = loadStripeBillingConfig({
    BILLING_ENVIRONMENT: 'sandbox',
    STRIPE_SECRET_KEY: 'sk_test_xxx',
    STRIPE_WEBHOOK_SECRET: 'whsec_x',
    STRIPE_PRICE_BASE_MONTHLY: 'price_base_monthly',
    STRIPE_PRICE_PRO_MONTHLY: 'price_pro_monthly',
  }).config

  const subscription = {
    id: 'sub_1',
    status: 'active',
    cancel_at_period_end: false,
    customer: 'cus_1',
    items: {
      data: [
        {
          price: { id: 'price_base_monthly' },
          current_period_start: 1722470400,
          current_period_end: 1725148800,
        },
      ],
    },
  }
  assert.equal(extractSubscriptionPriceId(subscription), 'price_base_monthly')
  assert.deepEqual(extractSubscriptionPeriodUnix(subscription), {
    start: 1722470400,
    end: 1725148800,
  })

  const event = {
    id: 'evt_1',
    type: 'customer.subscription.updated',
    created: 1722500000,
  }
  const built = billingEventFromStripeSubscription({
    event,
    subscription,
    config,
    userId: USER,
  })
  assert.equal(built.ok, true)
  assert.equal(built.input.environment, 'sandbox')
  assert.equal(built.input.providerProductId, 'price_base_monthly')
  assert.equal(built.input.status, 'active')

  const store = createBillingMemoryStore()
  memoryStoreAddUser(store, USER)
  const applied = await applyBillingEvent(built.input, {
    memoryStore: store,
    productMap: stripeProductMapFromConfig(config),
  })
  assert.equal(applied.result, 'applied')

  const dup = await applyBillingEvent(built.input, {
    memoryStore: store,
    productMap: stripeProductMapFromConfig(config),
  })
  assert.equal(dup.result, 'duplicate')

  const unknown = billingEventFromStripeSubscription({
    event: { ...event, id: 'evt_unknown' },
    subscription: {
      ...subscription,
      items: { data: [{ price: { id: 'price_nope' }, current_period_end: 1, current_period_start: 1 }] },
    },
    config,
    userId: USER,
  })
  assert.equal(unknown.ok, false)
  assert.equal(unknown.result, 'unknown_product')
}

// —— Event set ——
assert.ok(STRIPE_HANDLED_EVENTS.includes('checkout.session.completed'))
assert.ok(STRIPE_HANDLED_EVENTS.includes('invoice.payment_failed'))
assert.equal(STRIPE_HANDLED_EVENTS.includes('charge.refunded'), false)

// —— Enforcement OFF ——
assert.equal(isEntitlementEnforcementEnabled({}), false)

// —— Wiring contracts ——
{
  const billingApi = read('api/billing.ts')
  assert.match(billingApi, /bodyParser:\s*false/)
  assert.match(billingApi, /stripe-signature|Stripe-Signature/i)
  assert.match(billingApi, /create_checkout/)
  assert.match(billingApi, /durable_identity_required/)
  assert.doesNotMatch(billingApi, /VITE_/)

  const vercel = read('vercel.json')
  assert.match(vercel, /api\/billing\.ts/)
  const fnCount = Object.keys(JSON.parse(vercel).functions).length
  assert.equal(fnCount, 12)

  const plans = read('src/pages/Plans.tsx')
  assert.match(plans, /createCheckoutSession/)
  assert.match(plans, /Attivazione del piano in corso/)
  assert.match(plans, /readCheckoutReturnMarker/)
  assert.doesNotMatch(plans, /setVerifiedPlanId\(\s*['"]pro['"]\s*\)/)

  const pkg = JSON.parse(read('package.json'))
  assert.ok(pkg.dependencies.stripe)

  assert.equal(fs.existsSync(path.join(root, 'lib/server/stripe-billing.js')), true)
  assert.doesNotMatch(read('.env.example'), /VITE_STRIPE/)
  assert.match(read('.env.example'), /BILLING_ENVIRONMENT/)
  assert.match(read('.env.example'), /STRIPE_SECRET_KEY/)
}

console.log('billing-332e3a: ok')
