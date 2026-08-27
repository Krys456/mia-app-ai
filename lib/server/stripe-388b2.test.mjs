/**
 * #388B.2 — Stripe API-version compatibility hardening.
 *
 * Covers invoice → subscription-id resolution across Stripe API shapes
 * (legacy top-level, 2026-07-29.dahlia parent/line-item), subscription period
 * extraction with item-level fallback, and the invoice.payment_failed
 * normalization using authoritative subscription state.
 *
 * Run: node --test lib/server/stripe-388b2.test.mjs
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  resolveStripeInvoiceSubscriptionId,
  resolveSubscriptionPeriod,
  normalizeStripeSubscriptionEvent,
  processStripeWebhookEvent,
} from './stripe-webhook.js'
import {
  applyBillingEvent,
  createBillingMemoryStore,
  memoryStoreAddUser,
} from './billing-apply.js'
import { buildStripeProductPlanMap } from './stripe-config.js'

const USER = '22222222-2222-4222-8222-222222222222'
const PRICE_BASE = 'price_test_base_monthly_388b2'
const PRICE_PRO = 'price_test_pro_monthly_388b2'
const SUB_ID = 'sub_388b2_live'

function testEnv(overrides = {}) {
  return {
    VERCEL_ENV: 'preview',
    STRIPE_BILLING_ENABLED: '1',
    STRIPE_SECRET_KEY: 'sk_test_388b2_dummy',
    STRIPE_WEBHOOK_SECRET: 'whsec_388b2_dummy',
    STRIPE_PRICE_BASE_MONTHLY: PRICE_BASE,
    STRIPE_PRICE_PRO_MONTHLY: PRICE_PRO,
    BILLING_ENVIRONMENT: 'sandbox',
    ...overrides,
  }
}

// Authoritative subscription as returned by SDK retrieval (dahlia: item-level period).
function makeDahliaSubscription(partial = {}) {
  return {
    id: SUB_ID,
    object: 'subscription',
    status: 'past_due',
    customer: 'cus_388b2',
    cancel_at_period_end: false,
    metadata: { shinkaido_user_id: USER, shinkaido_plan_id: 'base' },
    items: {
      data: [
        {
          price: { id: PRICE_BASE },
          current_period_start: 1_800_000_000,
          current_period_end: 1_802_678_400,
        },
      ],
    },
    ...partial,
  }
}

function fakeStripe(sub) {
  return {
    subscriptions: {
      retrieve: async (id) => ({ ...sub, id }),
    },
  }
}

// ——— A. Legacy top-level invoice.subscription (string) ———
test('A. legacy invoice.subscription string resolves', () => {
  assert.equal(resolveStripeInvoiceSubscriptionId({ subscription: 'sub_legacy' }), 'sub_legacy')
})

// ——— B. Current parent.subscription_details.subscription ———
test('B. invoice.parent.subscription_details.subscription resolves', () => {
  const invoice = {
    object: 'invoice',
    subscription: undefined,
    parent: { subscription_details: { subscription: 'sub_parent' } },
  }
  assert.equal(resolveStripeInvoiceSubscriptionId(invoice), 'sub_parent')
})

// ——— C. Current line-item parent.subscription_item_details.subscription ———
test('C. invoice.lines.data[].parent.subscription_item_details.subscription resolves', () => {
  const invoice = {
    object: 'invoice',
    lines: {
      data: [
        { parent: { some_other_details: {} } },
        { parent: { subscription_item_details: { subscription: 'sub_line' } } },
      ],
    },
  }
  assert.equal(resolveStripeInvoiceSubscriptionId(invoice), 'sub_line')
})

// ——— D. Expandable object form (both top-level and nested) ———
test('D. expandable subscription object resolves via .id', () => {
  assert.equal(
    resolveStripeInvoiceSubscriptionId({ subscription: { id: 'sub_obj', object: 'subscription' } }),
    'sub_obj',
  )
  assert.equal(
    resolveStripeInvoiceSubscriptionId({
      parent: { subscription_details: { subscription: { id: 'sub_obj_nested' } } },
    }),
    'sub_obj_nested',
  )
})

// ——— E. No subscription anywhere ———
test('E. no subscription reference returns null', () => {
  assert.equal(resolveStripeInvoiceSubscriptionId({ object: 'invoice', lines: { data: [{}] } }), null)
  assert.equal(resolveStripeInvoiceSubscriptionId({}), null)
  assert.equal(resolveStripeInvoiceSubscriptionId(null), null)
})

test('E2. invoice.payment_failed with no subscription is safely ignored', async () => {
  const res = await processStripeWebhookEvent({
    event: {
      id: 'evt_pf_nosub',
      type: 'invoice.payment_failed',
      created: 1_800_000_100,
      data: { object: { object: 'invoice' } },
    },
    environment: 'sandbox',
    env: testEnv(),
    stripe: fakeStripe(makeDahliaSubscription()),
  })
  assert.equal(res.ok, true)
  assert.equal(res.code, 'invoice_without_subscription')
  assert.equal(res.ignored, true)
})

// ——— F. invoice.payment_failed current shape → retrieve authoritative → past_due applied ———
test('F. invoice.payment_failed resolves, retrieves authoritative sub, applies past_due', async () => {
  const store = createBillingMemoryStore()
  memoryStoreAddUser(store, USER)
  const productMap = buildStripeProductPlanMap(testEnv())

  const invoice = {
    object: 'invoice',
    billing_reason: 'subscription_cycle',
    parent: { subscription_details: { subscription: SUB_ID } },
    lines: { data: [{ parent: { subscription_item_details: { subscription: SUB_ID } } }] },
  }
  const res = await processStripeWebhookEvent({
    event: {
      id: 'evt_pf_1',
      type: 'invoice.payment_failed',
      created: 1_800_000_200,
      data: { object: invoice },
    },
    environment: 'sandbox',
    env: testEnv(),
    stripe: fakeStripe(makeDahliaSubscription({ status: 'past_due' })),
    productMap,
    applyBillingEventFn: (input, deps) =>
      applyBillingEvent(input, { ...deps, memoryStore: store, productMap }),
  })
  assert.equal(res.ok, true)
  assert.equal(res.code, 'billing_event_applied')
  assert.equal(res.planId, 'base')
  assert.equal(res.status, 'past_due')

  // Mirror reflects past_due for the user.
  const rows = [...store.subscriptions.values()].filter((r) => r.user_id === USER)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].status, 'past_due')
  assert.equal(rows[0].plan_id, 'base')
  // period end populated from item-level fallback
  assert.equal(rows[0].current_period_end, new Date(1_802_678_400 * 1000).toISOString())
})

// ——— F2. authoritative state wins (do not invent past_due) ———
test('F2. authoritative active subscription is not forced to past_due', async () => {
  const store = createBillingMemoryStore()
  memoryStoreAddUser(store, USER)
  const productMap = buildStripeProductPlanMap(testEnv())
  const res = await processStripeWebhookEvent({
    event: {
      id: 'evt_pf_active',
      type: 'invoice.payment_failed',
      created: 1_800_000_250,
      data: { object: { parent: { subscription_details: { subscription: SUB_ID } } } },
    },
    environment: 'sandbox',
    env: testEnv(),
    stripe: fakeStripe(makeDahliaSubscription({ status: 'active' })),
    productMap,
    applyBillingEventFn: (input, deps) =>
      applyBillingEvent(input, { ...deps, memoryStore: store, productMap }),
  })
  assert.equal(res.ok, true)
  assert.equal(res.status, 'active')
})

// ——— G. Duplicate payment_failed webhook is idempotent ———
test('G. duplicate invoice.payment_failed is idempotent', async () => {
  const store = createBillingMemoryStore()
  memoryStoreAddUser(store, USER)
  const productMap = buildStripeProductPlanMap(testEnv())
  const event = {
    id: 'evt_pf_dup',
    type: 'invoice.payment_failed',
    created: 1_800_000_300,
    data: { object: { parent: { subscription_details: { subscription: SUB_ID } } } },
  }
  const deps = {
    environment: 'sandbox',
    env: testEnv(),
    stripe: fakeStripe(makeDahliaSubscription({ status: 'past_due' })),
    productMap,
    applyBillingEventFn: (input, d) =>
      applyBillingEvent(input, { ...d, memoryStore: store, productMap }),
  }
  const first = await processStripeWebhookEvent({ event, ...deps })
  const second = await processStripeWebhookEvent({ event, ...deps })
  assert.equal(first.code, 'billing_event_applied')
  assert.equal(second.code, 'stripe_webhook_duplicate')
})

// ——— H. Top-level period fields preserved ———
test('H. resolveSubscriptionPeriod prefers top-level fields', () => {
  const p = resolveSubscriptionPeriod({
    current_period_start: 1_700_000_000,
    current_period_end: 1_702_678_400,
    items: { data: [{ current_period_start: 9, current_period_end: 9 }] },
  })
  assert.equal(p.currentPeriodStart, 1_700_000_000)
  assert.equal(p.currentPeriodEnd, 1_702_678_400)
})

// ——— I. Item-level fallback populated ———
test('I. resolveSubscriptionPeriod falls back to item period', () => {
  const p = resolveSubscriptionPeriod({
    items: { data: [{ current_period_start: 1_800_000_000, current_period_end: 1_802_678_400 }] },
  })
  assert.equal(p.currentPeriodStart, 1_800_000_000)
  assert.equal(p.currentPeriodEnd, 1_802_678_400)
})

// ——— J. Missing period everywhere → null, no crash ———
test('J. resolveSubscriptionPeriod returns nulls when absent', () => {
  assert.deepEqual(resolveSubscriptionPeriod({ items: { data: [{ price: { id: PRICE_BASE } }] } }), {
    currentPeriodStart: null,
    currentPeriodEnd: null,
  })
  assert.deepEqual(resolveSubscriptionPeriod({}), { currentPeriodStart: null, currentPeriodEnd: null })
  assert.deepEqual(resolveSubscriptionPeriod(null), {
    currentPeriodStart: null,
    currentPeriodEnd: null,
  })
})

// ——— K. cancel_at_period_end lifecycle retains period via fallback ———
test('K. cancel_at_period_end retains item-level current_period_end in normalization', () => {
  const sub = makeDahliaSubscription({ status: 'active', cancel_at_period_end: true })
  const norm = normalizeStripeSubscriptionEvent({
    subscription: sub,
    eventId: 'evt_cape',
    eventType: 'customer.subscription.updated',
    eventCreated: 1_800_000_400,
    environment: 'sandbox',
    env: testEnv(),
  })
  assert.equal(norm.ok, true)
  assert.equal(norm.input.cancelAtPeriodEnd, true)
  assert.equal(norm.input.status, 'active')
  assert.equal(norm.input.currentPeriodEnd, new Date(1_802_678_400 * 1000).toISOString())
  assert.equal(norm.input.currentPeriodStart, new Date(1_800_000_000 * 1000).toISOString())
})
