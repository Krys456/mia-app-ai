/**
 * #388B.1 — application/json raw-body + Web Fetch subscription handler tests.
 * No live Stripe / Production mutations.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import Stripe from 'stripe'

import {
  createWebRequestShim,
  rawBodyFromWebRequest,
  webJson,
} from './web-request.js'
import { readRawBody, parseJsonFromRawBody } from './raw-body.js'
import { handleStripeWebhook, verifyStripeWebhook } from './stripe-webhook.js'
import {
  applyBillingEvent,
  createBillingMemoryStore,
  memoryStoreAddUser,
} from './billing-apply.js'
import { buildStripeProductPlanMap } from './stripe-config.js'
import { isPublicHealthProbe } from './worker-health.js'
import { isStripeWebhookProbe } from './stripe-webhook.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '../..')
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

const USER = '11111111-1111-4111-8111-111111111111'
const PRICE_BASE = 'price_test_base_monthly_388b'
const PRICE_PRO = 'price_test_pro_monthly_388b'
const WHSEC = 'whsec_test_388b1_raw_body_secret'

function testEnv(overrides = {}) {
  return {
    VERCEL_ENV: 'preview',
    STRIPE_BILLING_ENABLED: '1',
    STRIPE_SECRET_KEY: 'sk_test_388b1_dummy_key_not_real',
    STRIPE_WEBHOOK_SECRET: WHSEC,
    STRIPE_PRICE_BASE_MONTHLY: PRICE_BASE,
    STRIPE_PRICE_PRO_MONTHLY: PRICE_PRO,
    BILLING_ENVIRONMENT: 'sandbox',
    STRIPE_RETURN_URL: 'https://mia-app-ai-preview.vercel.app',
    ...overrides,
  }
}

function makeStripeSubscription() {
  return {
    id: 'sub_test_388b1',
    object: 'subscription',
    status: 'active',
    customer: 'cus_test_388b1',
    cancel_at_period_end: false,
    current_period_start: 1_700_000_000,
    current_period_end: 1_700_267_200,
    metadata: { shinkaido_user_id: USER, shinkaido_plan_id: 'base' },
    items: { data: [{ price: { id: PRICE_BASE } }] },
  }
}

// —— Architecture contract ——
{
  const sub = read('api/subscription.ts')
  assert.match(sub, /request\.text\(|rawBodyFromWebRequest/)
  assert.match(sub, /Request\): Promise<Response>|request: Request/)
  assert.match(sub, /388B\.1|raw bytes/)
  // Must not ship Next.js-only bodyParser disable (ignored on Vite); comment prose may mention it.
  assert.doesNotMatch(sub, /export const config = \{[\s\S]*bodyParser:\s*false/)
  assert.match(read('lib/server/web-request.js'), /rawBodyFromWebRequest/)
  assert.match(read('lib/server/raw-body.js'), /Never JSON\.stringify|Fail closed/)
  assert.ok(!fs.existsSync(path.join(root, 'api/stripe-webhook.ts')))
}

await test('rawBodyFromWebRequest preserves exact application/json bytes', async () => {
  const payload = '{"id":"evt_x","type":"customer.subscription.updated","spaced": true}'
  const request = new Request('https://example.test/api/stripe/webhook?probe=stripe_webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload,
  })
  const buf = await rawBodyFromWebRequest(request)
  assert.equal(buf.toString('utf8'), payload)
  // Must NOT be a re-serialized form (spacing preserved).
  assert.match(buf.toString('utf8'), /"spaced": true/)
})

await test('Node readRawBody fails closed on parsed JSON object', async () => {
  await assert.rejects(
    () => readRawBody({ body: { id: 'evt' }, readable: false }),
    (err) => err && err.code === 'raw_body_unavailable',
  )
})

await test('application/json + valid signature accepted', async () => {
  const env = testEnv()
  const stripeTool = new Stripe('sk_test_388b1_dummy_key_not_real')
  const store = createBillingMemoryStore()
  memoryStoreAddUser(store, USER)
  const productMap = buildStripeProductPlanMap(env)

  const eventObj = {
    id: 'evt_388b1_valid',
    object: 'event',
    type: 'customer.subscription.created',
    created: 1_700_000_100,
    data: { object: makeStripeSubscription() },
  }
  const raw = JSON.stringify(eventObj)
  const signature = stripeTool.webhooks.generateTestHeaderString({
    payload: raw,
    secret: WHSEC,
  })

  // Prove Web Request path yields the same exact bytes Stripe signed.
  const request = new Request('https://example.test/api/subscription?probe=stripe_webhook', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Stripe-Signature': signature,
    },
    body: raw,
  })
  const rawBody = await rawBodyFromWebRequest(request)
  assert.equal(rawBody.toString('utf8'), raw)

  const result = await handleStripeWebhook({
    rawBody,
    signature,
    env,
    stripe: stripeTool,
    productMap,
    applyBillingEventFn: (input, deps) =>
      applyBillingEvent(input, { ...deps, memoryStore: store, productMap }),
  })
  assert.equal(result.ok, true)
  assert.equal(result.code, 'billing_event_applied')
  assert.equal(result.planId, 'base')
})

await test('application/json + invalid signature rejected', async () => {
  const env = testEnv()
  const stripeTool = new Stripe('sk_test_388b1_dummy_key_not_real')
  const raw = JSON.stringify({
    id: 'evt_388b1_bad',
    object: 'event',
    type: 'customer.subscription.updated',
    created: 1_700_000_100,
    data: { object: makeStripeSubscription() },
  })
  const request = new Request('https://example.test/api/stripe/webhook', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Stripe-Signature': 't=1,v1=deadbeef',
    },
    body: raw,
  })
  const rawBody = await rawBodyFromWebRequest(request)
  const verified = verifyStripeWebhook({
    rawBody,
    signature: 't=1,v1=deadbeef',
    env,
    stripe: stripeTool,
  })
  assert.equal(verified.ok, false)
  assert.equal(verified.code, 'stripe_webhook_invalid_signature')
})

await test('tampered payload after signature rejected', async () => {
  const env = testEnv()
  const stripeTool = new Stripe('sk_test_388b1_dummy_key_not_real')
  const original = JSON.stringify({
    id: 'evt_388b1_tamper',
    object: 'event',
    type: 'customer.subscription.updated',
    created: 1_700_000_100,
    data: { object: makeStripeSubscription() },
  })
  const signature = stripeTool.webhooks.generateTestHeaderString({
    payload: original,
    secret: WHSEC,
  })
  const tampered = original.replace('"active"', '"canceled"')
  assert.notEqual(tampered, original)

  const verified = verifyStripeWebhook({
    rawBody: Buffer.from(tampered, 'utf8'),
    signature,
    env,
    stripe: stripeTool,
  })
  assert.equal(verified.ok, false)
  assert.equal(verified.code, 'stripe_webhook_invalid_signature')
})

await test('missing Stripe-Signature rejected', async () => {
  const env = testEnv()
  const stripeTool = new Stripe('sk_test_388b1_dummy_key_not_real')
  const verified = verifyStripeWebhook({
    rawBody: Buffer.from('{}', 'utf8'),
    signature: '',
    env,
    stripe: stripeTool,
  })
  assert.equal(verified.ok, false)
  assert.equal(verified.code, 'stripe_signature_missing')
})

await test('checkout/portal JSON still parses from raw bytes', () => {
  const checkout = parseJsonFromRawBody(
    Buffer.from(JSON.stringify({ action: 'checkout', planId: 'base' }), 'utf8'),
  )
  assert.equal(checkout.action, 'checkout')
  assert.equal(checkout.planId, 'base')

  const portal = parseJsonFromRawBody(Buffer.from(JSON.stringify({ action: 'portal' }), 'utf8'))
  assert.equal(portal.action, 'portal')
})

await test('probe helpers detect health + stripe webhook rewrites', () => {
  assert.equal(
    isPublicHealthProbe({
      url: 'https://x.vercel.app/api/subscription?probe=public_health',
      query: { probe: 'public_health' },
    }),
    true,
  )
  assert.equal(
    isPublicHealthProbe({ url: 'https://x.vercel.app/api/health', query: {} }),
    true,
  )
  assert.equal(
    isStripeWebhookProbe({
      url: 'https://x.vercel.app/api/subscription?probe=stripe_webhook',
      query: { probe: 'stripe_webhook' },
    }),
    true,
  )
  assert.equal(
    isStripeWebhookProbe({ url: 'https://x.vercel.app/api/stripe/webhook', query: {} }),
    true,
  )
})

await test('createWebRequestShim exposes query + headers', () => {
  const request = new Request(
    'https://example.test/api/subscription?probe=stripe_webhook',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Stripe-Signature': 't=1,v1=abc',
        Authorization: 'Bearer tok',
      },
      body: '{}',
    },
  )
  const shim = createWebRequestShim(request)
  assert.equal(shim.query.probe, 'stripe_webhook')
  assert.equal(shim.headers['stripe-signature'] || shim.headers['Stripe-Signature'], 't=1,v1=abc')
  assert.match(shim.headers.authorization || shim.headers.Authorization || '', /Bearer/)
})

await test('webJson returns serializable Response', async () => {
  const req = { headers: {}, url: '/api/subscription', query: {} }
  const res = webJson(200, { ok: true, code: 'test' }, req)
  assert.equal(res.status, 200)
  assert.match(res.headers.get('content-type') || '', /application\/json/)
  const body = await res.json()
  assert.equal(body.ok, true)
  assert.equal(body.code, 'test')
})

console.log('stripe-388b1-raw-body: ok')
