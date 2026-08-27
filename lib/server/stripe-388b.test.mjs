/**
 * #388B — Stripe Test Mode foundation tests.
 * No live Stripe network calls. No Production mutations.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import Stripe from 'stripe'

import {
  applyBillingEvent,
  createBillingMemoryStore,
  memoryStoreAddUser,
} from './billing-apply.js'
import {
  buildStripeProductPlanMap,
  mapInternalPlanToStripePriceId,
  mapStripePriceIdToPlanId,
  resolveStripeConfig,
  resolveStripePublicCapabilities,
} from './stripe-config.js'
import { mapStripeSubscriptionStatus, STRIPE_STATUS_MAPPING_TABLE } from './stripe-status.js'
import {
  createCheckoutSession,
  createPortalSession,
  cancelStripeSubscriptionsForDeletion,
  findCancelableStripeSubscriptionIds,
  findOwnedStripeCustomerId,
} from './stripe-billing.js'
import {
  extractSubscriptionPriceId,
  handleStripeWebhook,
  normalizeStripeSubscriptionEvent,
  processStripeWebhookEvent,
  verifyStripeWebhook,
} from './stripe-webhook.js'
import { runAccountDeletion, ACCOUNT_DELETION_STEPS } from './account-deletion.js'
import { isEntitlementEnforcementEnabled } from './entitlements.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '../..')
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

const USER = '11111111-1111-4111-8111-111111111111'
const PRICE_BASE = 'price_test_base_monthly_388b'
const PRICE_PRO = 'price_test_pro_monthly_388b'
const WHSEC = 'whsec_test_388b_secret_value_only_for_unit_tests'

function testEnv(overrides = {}) {
  return {
    VERCEL_ENV: 'preview',
    STRIPE_BILLING_ENABLED: '1',
    STRIPE_SECRET_KEY: 'sk_test_388b_dummy_key_not_real',
    STRIPE_WEBHOOK_SECRET: WHSEC,
    STRIPE_PRICE_BASE_MONTHLY: PRICE_BASE,
    STRIPE_PRICE_PRO_MONTHLY: PRICE_PRO,
    BILLING_ENVIRONMENT: 'sandbox',
    STRIPE_RETURN_URL: 'https://mia-app-ai-preview.vercel.app',
    ...overrides,
  }
}

function makeFakeStripe(handlers = {}) {
  return {
    customers: {
      create: async (params) => {
        if (handlers.customersCreate) return handlers.customersCreate(params)
        return { id: 'cus_test_1', metadata: params.metadata || {} }
      },
      retrieve: async (id) => {
        if (handlers.customersRetrieve) return handlers.customersRetrieve(id)
        return { id, metadata: { shinkaido_user_id: USER }, deleted: false }
      },
    },
    checkout: {
      sessions: {
        create: async (params) => {
          if (handlers.checkoutCreate) return handlers.checkoutCreate(params)
          return { id: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1' }
        },
      },
    },
    billingPortal: {
      sessions: {
        create: async (params) => {
          if (handlers.portalCreate) return handlers.portalCreate(params)
          return { id: 'bps_test_1', url: 'https://billing.stripe.com/p/session/test' }
        },
      },
    },
    subscriptions: {
      retrieve: async (id) => {
        if (handlers.subscriptionsRetrieve) return handlers.subscriptionsRetrieve(id)
        return makeStripeSubscription({ id })
      },
      cancel: async (id) => {
        if (handlers.subscriptionsCancel) return handlers.subscriptionsCancel(id)
        return { id, status: 'canceled' }
      },
    },
    webhooks: Stripe.webhooks || new Stripe('sk_test_x').webhooks,
  }
}

function makeStripeSubscription(partial = {}) {
  return {
    id: 'sub_test_1',
    object: 'subscription',
    status: 'active',
    customer: 'cus_test_1',
    cancel_at_period_end: false,
    current_period_start: 1_700_000_000,
    current_period_end: 1_700_267_200,
    metadata: { shinkaido_user_id: USER, shinkaido_plan_id: 'base' },
    items: {
      data: [{ price: { id: PRICE_BASE } }],
    },
    ...partial,
  }
}

// —— Config / allowlist ——
{
  assert.equal(resolveStripeConfig({ VERCEL_ENV: 'production', STRIPE_BILLING_ENABLED: '1' }).ok, false)
  assert.equal(resolveStripeConfig(testEnv()).ok, true)
  assert.equal(
    resolveStripeConfig(testEnv({ STRIPE_SECRET_KEY: 'sk_live_should_fail' })).code,
    'stripe_live_key_forbidden',
  )
  assert.equal(resolveStripeConfig(testEnv({ STRIPE_BILLING_ENABLED: '0' })).ok, false)

  const capsProd = resolveStripePublicCapabilities({
    VERCEL_ENV: 'production',
    STRIPE_BILLING_ENABLED: '1',
    STRIPE_SECRET_KEY: 'sk_test_x',
    STRIPE_WEBHOOK_SECRET: 'whsec_x',
    STRIPE_PRICE_BASE_MONTHLY: PRICE_BASE,
    STRIPE_PRICE_PRO_MONTHLY: PRICE_PRO,
  })
  assert.equal(capsProd.billingEnabled, false)

  assert.equal(mapInternalPlanToStripePriceId('base', testEnv()).priceId, PRICE_BASE)
  assert.equal(mapInternalPlanToStripePriceId('pro', testEnv()).priceId, PRICE_PRO)
  assert.equal(mapInternalPlanToStripePriceId('free', testEnv()).code, 'plan_not_purchasable')
  assert.equal(mapInternalPlanToStripePriceId('enterprise', testEnv()).code, 'plan_unknown')
  assert.equal(mapInternalPlanToStripePriceId(undefined, testEnv()).code, 'plan_required')
  assert.equal(mapStripePriceIdToPlanId(PRICE_BASE, testEnv()), 'base')
  assert.equal(mapStripePriceIdToPlanId(PRICE_PRO, testEnv()), 'pro')
  assert.equal(mapStripePriceIdToPlanId('price_unknown', testEnv()), null)

  const map = buildStripeProductPlanMap(testEnv())
  assert.equal(map.stripe[PRICE_BASE], 'base')
  assert.equal(map.stripe[PRICE_PRO], 'pro')
}

// —— Status mapping ——
{
  assert.equal(mapStripeSubscriptionStatus('active'), 'active')
  assert.equal(mapStripeSubscriptionStatus('trialing'), 'trialing')
  assert.equal(mapStripeSubscriptionStatus('past_due'), 'past_due')
  assert.equal(mapStripeSubscriptionStatus('unpaid'), 'past_due')
  assert.equal(mapStripeSubscriptionStatus('canceled'), 'canceled')
  assert.equal(mapStripeSubscriptionStatus('incomplete'), 'expired')
  assert.equal(mapStripeSubscriptionStatus('incomplete_expired'), 'expired')
  assert.equal(mapStripeSubscriptionStatus('paused'), 'expired')
  assert.equal(mapStripeSubscriptionStatus('nope'), null)
  assert.ok(STRIPE_STATUS_MAPPING_TABLE.length >= 8)
}

// —— Checkout ——
await test('checkout rejects non-durable and bad plans', async () => {
  const stripe = makeFakeStripe()
  const anon = await createCheckoutSession({
    userId: USER,
    durable: false,
    planId: 'base',
    env: testEnv(),
    stripe,
  })
  assert.equal(anon.code, 'not_durable')

  const free = await createCheckoutSession({
    userId: USER,
    durable: true,
    planId: 'free',
    env: testEnv(),
    stripe,
  })
  assert.equal(free.code, 'plan_not_purchasable')

  const unknown = await createCheckoutSession({
    userId: USER,
    durable: true,
    planId: 'gold',
    env: testEnv(),
    stripe,
  })
  assert.equal(unknown.code, 'plan_unknown')

  const missingCfg = await createCheckoutSession({
    userId: USER,
    durable: true,
    planId: 'base',
    env: testEnv({ STRIPE_BILLING_ENABLED: '0' }),
  })
  assert.equal(missingCfg.ok, false)
})

await test('checkout maps base/pro to allowlisted prices only', async () => {
  /** @type {any} */
  let seen = null
  const stripe = makeFakeStripe({
    checkoutCreate: (params) => {
      seen = params
      return { id: 'cs_test_base', url: 'https://checkout.stripe.com/c/pay/cs_test_base' }
    },
  })

  const base = await createCheckoutSession({
    userId: USER,
    durable: true,
    planId: 'base',
    email: 'qa@example.com',
    env: testEnv(),
    stripe,
  })
  assert.equal(base.ok, true)
  assert.equal(base.planId, 'base')
  assert.equal(seen.line_items[0].price, PRICE_BASE)
  assert.equal(seen.line_items[0].quantity, 1)
  assert.equal(seen.mode, 'subscription')
  assert.equal(seen.metadata.shinkaido_user_id, USER)
  assert.ok(!JSON.stringify(seen).includes('price_test_pro'))

  const pro = await createCheckoutSession({
    userId: USER,
    durable: true,
    planId: 'pro',
    env: testEnv(),
    stripe: makeFakeStripe({
      checkoutCreate: (params) => {
        seen = params
        return { id: 'cs_test_pro', url: 'https://checkout.stripe.com/c/pay/cs_test_pro' }
      },
    }),
  })
  assert.equal(pro.ok, true)
  assert.equal(seen.line_items[0].price, PRICE_PRO)
})

// —— Portal ——
await test('portal ownership + reject client customer id', async () => {
  const stripe = makeFakeStripe()
  const unauthStyle = await createPortalSession({
    userId: USER,
    durable: false,
    ownedCustomerId: 'cus_test_1',
    env: testEnv(),
    stripe,
  })
  assert.equal(unauthStyle.code, 'not_durable')

  const spoof = await createPortalSession({
    userId: USER,
    durable: true,
    customerId: 'cus_attacker',
    ownedCustomerId: 'cus_test_1',
    env: testEnv(),
    stripe,
  })
  assert.equal(spoof.code, 'customer_id_not_accepted')

  const missing = await createPortalSession({
    userId: USER,
    durable: true,
    ownedCustomerId: null,
    env: testEnv(),
    stripe,
  })
  assert.equal(missing.code, 'no_billing_customer')

  const ok = await createPortalSession({
    userId: USER,
    durable: true,
    ownedCustomerId: 'cus_test_1',
    env: testEnv(),
    stripe,
  })
  assert.equal(ok.ok, true)
  assert.match(ok.url, /^https:\/\//)
})

// —— Webhook signature + normalize + apply ——
await test('webhook signature verify + idempotency + status paths', async () => {
  const env = testEnv()
  const stripeTool = new Stripe('sk_test_388b_dummy_key_not_real')
  const store = createBillingMemoryStore()
  memoryStoreAddUser(store, USER)
  const productMap = buildStripeProductPlanMap(env)

  const sub = makeStripeSubscription()
  const payload = {
    id: 'evt_test_1',
    object: 'event',
    type: 'customer.subscription.created',
    created: 1_700_000_100,
    data: { object: sub },
  }
  const rawBody = JSON.stringify(payload)
  const signature = stripeTool.webhooks.generateTestHeaderString({
    payload: rawBody,
    secret: WHSEC,
  })

  const bad = verifyStripeWebhook({
    rawBody,
    signature: 't=1,v1=bad',
    env,
    stripe: stripeTool,
  })
  assert.equal(bad.code, 'stripe_webhook_invalid_signature')

  const first = await handleStripeWebhook({
    rawBody,
    signature,
    env,
    stripe: stripeTool,
    productMap,
    applyBillingEventFn: (input, deps) =>
      applyBillingEvent(input, { ...deps, memoryStore: store, productMap }),
  })
  assert.equal(first.ok, true)
  assert.equal(first.code, 'billing_event_applied')
  assert.equal(first.planId, 'base')
  assert.equal(first.status, 'active')

  const dup = await handleStripeWebhook({
    rawBody,
    signature,
    env,
    stripe: stripeTool,
    productMap,
    applyBillingEventFn: (input, deps) =>
      applyBillingEvent(input, { ...deps, memoryStore: store, productMap }),
  })
  assert.equal(dup.ok, true)
  assert.equal(dup.code, 'stripe_webhook_duplicate')

  // Pro price
  const proSub = makeStripeSubscription({
    id: 'sub_test_pro',
    items: { data: [{ price: { id: PRICE_PRO } }] },
    metadata: { shinkaido_user_id: USER, shinkaido_plan_id: 'pro' },
  })
  const proPayload = {
    id: 'evt_test_pro',
    object: 'event',
    type: 'customer.subscription.updated',
    created: 1_700_000_200,
    data: { object: proSub },
  }
  const proRaw = JSON.stringify(proPayload)
  const proSig = stripeTool.webhooks.generateTestHeaderString({
    payload: proRaw,
    secret: WHSEC,
  })
  const proRes = await handleStripeWebhook({
    rawBody: proRaw,
    signature: proSig,
    env,
    stripe: stripeTool,
    productMap,
    applyBillingEventFn: (input, deps) =>
      applyBillingEvent(input, { ...deps, memoryStore: store, productMap }),
  })
  assert.equal(proRes.planId, 'pro')

  // Unknown price → no paid grant
  const unkSub = makeStripeSubscription({
    id: 'sub_unk',
    items: { data: [{ price: { id: 'price_unknown_xxx' } }] },
  })
  const unkNorm = normalizeStripeSubscriptionEvent({
    subscription: unkSub,
    eventId: 'evt_unk',
    eventType: 'customer.subscription.updated',
    eventCreated: 1_700_000_300,
    environment: 'sandbox',
    env,
  })
  assert.equal(unkNorm.code, 'unknown_price')

  // past_due / canceled / deleted
  for (const [stripeStatus, expect] of [
    ['trialing', 'trialing'],
    ['past_due', 'past_due'],
    ['canceled', 'canceled'],
  ]) {
    const mapped = mapStripeSubscriptionStatus(stripeStatus)
    assert.equal(mapped, expect)
  }

  const del = await processStripeWebhookEvent({
    event: {
      id: 'evt_del',
      type: 'customer.subscription.deleted',
      created: 1_700_000_400,
      data: { object: makeStripeSubscription({ status: 'canceled' }) },
    },
    environment: 'sandbox',
    env,
    productMap,
    applyBillingEventFn: (input, deps) =>
      applyBillingEvent(input, { ...deps, memoryStore: store, productMap }),
  })
  assert.equal(del.ok, true)
  assert.equal(del.status, 'canceled')
})

await test('out-of-order webhook does not overwrite newer state', async () => {
  const env = testEnv()
  const store = createBillingMemoryStore()
  memoryStoreAddUser(store, USER)
  const productMap = buildStripeProductPlanMap(env)

  const newer = await applyBillingEvent(
    {
      provider: 'stripe',
      providerEventId: 'evt_new',
      eventType: 'customer.subscription.updated',
      eventTimestamp: '2026-08-20T12:00:00.000Z',
      environment: 'sandbox',
      userId: USER,
      providerCustomerId: 'cus_1',
      providerSubscriptionId: 'sub_order',
      providerProductId: PRICE_PRO,
      status: 'active',
      currentPeriodStart: '2026-08-01T00:00:00.000Z',
      currentPeriodEnd: '2026-09-01T00:00:00.000Z',
      cancelAtPeriodEnd: false,
    },
    { memoryStore: store, productMap },
  )
  assert.equal(newer.result, 'applied')
  assert.equal(newer.planId, 'pro')

  const older = await applyBillingEvent(
    {
      provider: 'stripe',
      providerEventId: 'evt_old',
      eventType: 'customer.subscription.updated',
      eventTimestamp: '2026-08-20T11:00:00.000Z',
      environment: 'sandbox',
      userId: USER,
      providerCustomerId: 'cus_1',
      providerSubscriptionId: 'sub_order',
      providerProductId: PRICE_BASE,
      status: 'active',
      currentPeriodStart: '2026-08-01T00:00:00.000Z',
      currentPeriodEnd: '2026-09-01T00:00:00.000Z',
      cancelAtPeriodEnd: false,
    },
    { memoryStore: store, productMap },
  )
  assert.equal(older.result, 'stale')
  assert.equal(older.planId, 'pro')
})

await test('extract price id helpers', () => {
  assert.equal(
    extractSubscriptionPriceId({ items: { data: [{ price: { id: PRICE_BASE } }] } }),
    PRICE_BASE,
  )
  assert.equal(
    extractSubscriptionPriceId({ items: { data: [{ price: PRICE_PRO }] } }),
    PRICE_PRO,
  )
})

// —— Account deletion Stripe CRITICAL ——
await test('account deletion cancels Stripe before erase; failure blocks success', async () => {
  assert.ok(ACCOUNT_DELETION_STEPS.includes('stripe_cancel'))
  assert.ok(
    ACCOUNT_DELETION_STEPS.indexOf('stripe_cancel') <
      ACCOUNT_DELETION_STEPS.indexOf('defensive_schema'),
  )
  assert.ok(
    ACCOUNT_DELETION_STEPS.indexOf('stripe_cancel') <
      ACCOUNT_DELETION_STEPS.indexOf('auth_user'),
  )

  const rows = [
    {
      provider: 'stripe',
      environment: 'sandbox',
      provider_customer_id: 'cus_pay',
      provider_subscription_id: 'sub_pay',
      status: 'active',
      plan_id: 'base',
    },
  ]
  assert.deepEqual(findCancelableStripeSubscriptionIds(rows, 'sandbox'), ['sub_pay'])
  assert.equal(findOwnedStripeCustomerId(rows, 'sandbox'), 'cus_pay')

  const cancelFail = await cancelStripeSubscriptionsForDeletion({
    subscriptionIds: ['sub_pay'],
    stripe: makeFakeStripe({
      subscriptionsRetrieve: async () => ({ id: 'sub_pay', status: 'active' }),
      subscriptionsCancel: async () => {
        throw new Error('stripe_down')
      },
    }),
  })
  assert.equal(cancelFail.ok, false)
  assert.equal(cancelFail.code, 'stripe_cancel_failed')

  const owner = USER
  function makeMockSupabase(seed) {
    const state = {
      jobs: [...(seed.jobs || [])],
      tables: {
        calendar_connections: [],
        email_connections: [],
        push_subscriptions: [],
        morning_briefing_schedules: [],
        reminders: [],
        memories: [],
        messages: [],
        conversations: [],
        settings: [],
        subscriptions: [...(seed.subscriptions || [])],
        users: [...(seed.users || [])],
        billing_events: [...(seed.billing_events || [])],
      },
      authDeleted: [],
    }
    function matchEq(row, filters) {
      return filters.every(([k, v]) => (Array.isArray(v) ? v.includes(row[k]) : row[k] === v))
    }
    function from(table) {
      const filters = []
      let orderCol = null
      let orderAsc = true
      let limitN = null
      let op = 'select'
      let payload = null
      let wantOne = false
      const api = {
        select() {
          if (op !== 'insert' && op !== 'update') op = 'select'
          return api
        },
        insert(row) {
          op = 'insert'
          payload = row
          return api
        },
        update(row) {
          op = 'update'
          payload = row
          return api
        },
        delete() {
          op = 'delete'
          return api
        },
        eq(k, v) {
          filters.push([k, v])
          return api
        },
        in(k, vals) {
          filters.push([k, vals])
          return api
        },
        order(col, opts) {
          orderCol = col
          orderAsc = !opts || opts.ascending !== false
          return api
        },
        limit(n) {
          limitN = n
          return api
        },
        maybeSingle() {
          wantOne = true
          return api
        },
        single() {
          wantOne = true
          return api
        },
        then(resolve, reject) {
          Promise.resolve()
            .then(() => exec())
            .then(resolve, reject)
        },
      }
      function exec() {
        if (table === 'account_deletion_jobs') {
          if (op === 'insert') {
            const row = {
              id: `job-${state.jobs.length + 1}`,
              last_completed_step: null,
              last_error_code: null,
              calendar_revoke_status: null,
              gmail_revoke_status: null,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              completed_at: null,
              ...payload,
            }
            state.jobs.push(row)
            return { data: row, error: null }
          }
          if (op === 'update') {
            const idx = state.jobs.findIndex((j) => matchEq(j, filters))
            if (idx < 0) return { data: null, error: { message: 'not_found' } }
            state.jobs[idx] = {
              ...state.jobs[idx],
              ...payload,
              updated_at: new Date().toISOString(),
            }
            return { data: state.jobs[idx], error: null }
          }
          let jobRows = state.jobs.filter((j) => matchEq(j, filters))
          if (orderCol) {
            jobRows = [...jobRows].sort((a, b) => {
              const av = a[orderCol]
              const bv = b[orderCol]
              if (av === bv) return 0
              const cmp = av > bv ? 1 : -1
              return orderAsc ? cmp : -cmp
            })
          }
          if (limitN != null) jobRows = jobRows.slice(0, limitN)
          return { data: wantOne ? jobRows[0] || null : jobRows, error: null }
        }
        if (table === 'users' && op === 'delete') {
          const removedIds = state.tables.users.filter((r) => matchEq(r, filters)).map((r) => r.id)
          state.tables.users = state.tables.users.filter((r) => !matchEq(r, filters))
          state.tables.billing_events = state.tables.billing_events.map((e) =>
            removedIds.includes(e.user_id) ? { ...e, user_id: null } : e,
          )
          return { data: removedIds.map((id) => ({ id })), error: null }
        }
        const tableRows = state.tables[table]
        if (!tableRows) return { data: null, error: { message: 'unknown_table' } }
        if (op === 'delete') {
          state.tables[table] = tableRows.filter((r) => !matchEq(r, filters))
          return { data: [], error: null }
        }
        const found = tableRows.filter((r) => matchEq(r, filters))
        return { data: wantOne ? found[0] || null : found, error: null }
      }
      return api
    }
    return {
      state,
      client: {
        from,
        auth: {
          admin: {
            async deleteUser(id) {
              state.authDeleted.push(id)
              return { data: {}, error: null }
            },
          },
        },
      },
    }
  }

  const prevFetch = globalThis.fetch
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) })

  try {
    const mock = makeMockSupabase({
      users: [{ id: owner }],
      subscriptions: [
        {
          user_id: owner,
          provider: 'stripe',
          environment: 'sandbox',
          provider_customer_id: 'cus_pay',
          provider_subscription_id: 'sub_pay',
          status: 'active',
          plan_id: 'base',
        },
      ],
      billing_events: [
        { id: 'be_1', user_id: owner, provider: 'stripe', provider_event_id: 'evt_keep' },
      ],
    })

    const failed = await runAccountDeletion({
      userId: owner,
      accessToken: 'test-jwt',
      env: {
        ACCOUNT_DELETION_ENABLED: '1',
        SUPABASE_URL: 'https://example.supabase.co',
        VITE_SUPABASE_ANON_KEY: 'anon',
        BILLING_ENVIRONMENT: 'sandbox',
      },
      getServiceSupabase: async () => mock.client,
      cancelStripeSubscriptions: async () => ({
        ok: false,
        code: 'stripe_cancel_failed',
        canceledIds: [],
        failedIds: ['sub_pay'],
      }),
    })
    assert.equal(failed.ok, false)
    assert.equal(failed.retryable, true)
    assert.equal(mock.state.authDeleted.length, 0)
    assert.equal(mock.state.tables.subscriptions.length, 1)
    assert.equal(mock.state.tables.billing_events[0].user_id, owner)

    // Resume after cancel succeeds
    const ok = await runAccountDeletion({
      userId: owner,
      accessToken: 'test-jwt',
      env: {
        ACCOUNT_DELETION_ENABLED: '1',
        SUPABASE_URL: 'https://example.supabase.co',
        VITE_SUPABASE_ANON_KEY: 'anon',
        BILLING_ENVIRONMENT: 'sandbox',
      },
      getServiceSupabase: async () => mock.client,
      cancelStripeSubscriptions: async () => ({
        ok: true,
        code: 'stripe_cancel_succeeded',
        canceledIds: ['sub_pay'],
        failedIds: [],
      }),
    })
    assert.equal(ok.ok, true)
    assert.deepEqual(mock.state.authDeleted, [owner])
    assert.equal(mock.state.tables.billing_events[0].user_id, null)
  } finally {
    globalThis.fetch = prevFetch
  }
})

await test('non-paying deletion unchanged (no stripe ids)', async () => {
  const result = await cancelStripeSubscriptionsForDeletion({ subscriptionIds: [] })
  assert.equal(result.ok, true)
  assert.equal(result.code, 'no_stripe_subscriptions')
})

// —— Enforcement still OFF ——
{
  assert.equal(isEntitlementEnforcementEnabled({}), false)
  assert.equal(isEntitlementEnforcementEnabled({ ENTITLEMENT_ENFORCEMENT_ENABLED: 'true' }), true)
  // Default process env in CI must not flip ON from this suite.
  assert.notEqual(process.env.ENTITLEMENT_ENFORCEMENT_ENABLED, '1')
}

// —— Architecture / Hobby safety ——
{
  const pkg = read('package.json')
  assert.match(pkg, /"stripe"/)
  assert.doesNotMatch(pkg, /revenuecat|storekit/i)

  assert.match(read('api/subscription.ts'), /rawBodyFromWebRequest|request\.text/)
  assert.match(read('api/subscription.ts'), /probe=stripe_webhook|stripe_webhook/)
  assert.match(read('vercel.json'), /api\/stripe\/webhook/)
  assert.ok(!fs.existsSync(path.join(root, 'api/stripe-webhook.ts')))
  assert.ok(!fs.existsSync(path.join(root, 'api/billing.ts')))

  // #388B.1: Next.js bodyParser disable must NOT be in export config (ignored on Vite).
  assert.doesNotMatch(read('api/subscription.ts'), /export const config = \{[\s\S]*bodyParser:\s*false/)
  assert.match(read('api/subscription.ts'), /Request\): Promise<Response>|request: Request/)

  // Still ≤12 deployable functions
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
        if (!ignore.has(rel) && !rel.includes('.test.')) deployable.push(rel)
      }
    }
  }
  walk(apiRoot)
  assert.ok(deployable.length <= 12, `deployable=${deployable.length} ${deployable.join(',')}`)

  assert.match(read('lib/server/account-deletion.js'), /stripe_cancel/)
  assert.match(read('lib/server/account-deletion.js'), /CRITICAL/)
  assert.doesNotMatch(read('src/lib/subscriptionApi.ts'), /STRIPE_SECRET|sk_test|whsec_/)
  assert.doesNotMatch(read('src/pages/Plans.tsx'), /STRIPE_SECRET|price_/)
}

console.log('stripe-388b: ok')
