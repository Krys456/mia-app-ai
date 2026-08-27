/**
 * #388B.1 — Stripe webhook raw-body (Web fetch export) + JSON action regressions.
 *
 * Proves application/json bytes reach constructEvent without re-stringify,
 * and that checkout/portal JSON parsing still works via the same raw path.
 */
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");

function stripeTestSignature(payload, secret) {
  const timestamp = Math.floor(Date.now() / 1000);
  const signed = createHmac("sha256", secret)
    .update(`${timestamp}.${payload}`, "utf8")
    .digest("hex");
  return `t=${timestamp},v1=${signed}`;
}

test("388B.1: subscription.ts uses Web Standard fetch export (not Node helper)", () => {
  const src = readFileSync(join(ROOT, "api/subscription.ts"), "utf8");
  assert.match(src, /export default\s*\{[\s\S]*async fetch\s*\(\s*request:\s*Request/);
  assert.match(src, /rawBodyFromWebRequest|request\.text\(/);
  assert.doesNotMatch(src, /^export default async function/m);
  assert.doesNotMatch(src, /api:\s*\{\s*bodyParser:\s*false/);
  assert.doesNotMatch(src, /\bfrom ['"]express['"]/);
});

test("388B.1: rawBodyFromWebRequest returns exact application/json bytes", async () => {
  const { rawBodyFromWebRequest } = await import(
    pathToFileURL(join(ROOT, "lib/server/web-request.js")).href
  );
  const payload = '{"id":"evt_exact","object":"event"}';
  const request = new Request("https://example.test/api/stripe/webhook", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: payload,
  });
  const buf = await rawBodyFromWebRequest(request);
  assert.ok(Buffer.isBuffer(buf));
  assert.equal(buf.toString("utf8"), payload);
});

test("388B.1 A: application/json + valid signature → accepted by constructEvent", async () => {
  process.env.STRIPE_BILLING_ENABLED = "true";
  process.env.BILLING_ENVIRONMENT = "preview";
  process.env.VERCEL_ENV = "preview";
  process.env.STRIPE_SECRET_KEY = "sk_test_388b1_valid";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_388b1_test_secret";
  process.env.STRIPE_PRICE_BASE_MONTHLY = "price_base_test";
  process.env.STRIPE_PRICE_PRO_MONTHLY = "price_pro_test";

  const { verifyStripeWebhook } = await import(
    pathToFileURL(join(ROOT, "lib/server/stripe-webhook.js")).href
  );

  const payload =
    '{"id":"evt_388b1_ok","object":"event","type":"customer.subscription.updated","data":{"object":{"id":"sub_x","object":"subscription","status":"active","customer":"cus_x","metadata":{},"items":{"data":[{"price":{"id":"price_base_test"}}]}}}}';
  const signature = stripeTestSignature(payload, process.env.STRIPE_WEBHOOK_SECRET);
  const rawBody = Buffer.from(payload, "utf8");

  const result = verifyStripeWebhook({
    rawBody,
    signature,
    env: process.env,
  });

  assert.equal(result.ok, true);
  assert.notEqual(result.code, "raw_body_unavailable");
  assert.notEqual(result.code, "stripe_webhook_invalid_signature");
});

test("388B.1 B: application/json + invalid signature → rejected", async () => {
  process.env.STRIPE_BILLING_ENABLED = "true";
  process.env.BILLING_ENVIRONMENT = "preview";
  process.env.VERCEL_ENV = "preview";
  process.env.STRIPE_SECRET_KEY = "sk_test_388b1_valid";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_388b1_test_secret";
  process.env.STRIPE_PRICE_BASE_MONTHLY = "price_base_test";
  process.env.STRIPE_PRICE_PRO_MONTHLY = "price_pro_test";

  const { verifyStripeWebhook } = await import(
    pathToFileURL(join(ROOT, "lib/server/stripe-webhook.js")).href
  );

  const payload =
    '{"id":"evt_388b1_bad","object":"event","type":"customer.subscription.updated","data":{"object":{}}}';
  const result = verifyStripeWebhook({
    rawBody: Buffer.from(payload, "utf8"),
    signature: "t=1,v1=deadbeef",
    env: process.env,
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "stripe_webhook_invalid_signature");
});

test("388B.1 C: tampered payload after signature → rejected", async () => {
  process.env.STRIPE_BILLING_ENABLED = "true";
  process.env.BILLING_ENVIRONMENT = "preview";
  process.env.VERCEL_ENV = "preview";
  process.env.STRIPE_SECRET_KEY = "sk_test_388b1_valid";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_388b1_test_secret";
  process.env.STRIPE_PRICE_BASE_MONTHLY = "price_base_test";
  process.env.STRIPE_PRICE_PRO_MONTHLY = "price_pro_test";

  const { verifyStripeWebhook } = await import(
    pathToFileURL(join(ROOT, "lib/server/stripe-webhook.js")).href
  );

  const original =
    '{"id":"evt_388b1_tamper","object":"event","type":"customer.subscription.updated","data":{"object":{}}}';
  const signature = stripeTestSignature(original, process.env.STRIPE_WEBHOOK_SECRET);
  const tampered = original.replace("evt_388b1_tamper", "evt_388b1_HACKED");

  const result = verifyStripeWebhook({
    rawBody: Buffer.from(tampered, "utf8"),
    signature,
    env: process.env,
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "stripe_webhook_invalid_signature");
});

test("388B.1 D: missing Stripe-Signature → rejected", async () => {
  process.env.STRIPE_BILLING_ENABLED = "true";
  process.env.BILLING_ENVIRONMENT = "preview";
  process.env.VERCEL_ENV = "preview";
  process.env.STRIPE_SECRET_KEY = "sk_test_388b1_valid";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_388b1_test_secret";
  process.env.STRIPE_PRICE_BASE_MONTHLY = "price_base_test";
  process.env.STRIPE_PRICE_PRO_MONTHLY = "price_pro_test";

  const { verifyStripeWebhook } = await import(
    pathToFileURL(join(ROOT, "lib/server/stripe-webhook.js")).href
  );

  const payload =
    '{"id":"evt_388b1_nosig","object":"event","type":"customer.subscription.updated","data":{"object":{}}}';
  const result = verifyStripeWebhook({
    rawBody: Buffer.from(payload, "utf8"),
    signature: "",
    env: process.env,
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "stripe_signature_missing");
});

test("388B.1 E+F: checkout/portal JSON parses from exact raw bytes", async () => {
  const { parseJsonFromRawBody } = await import(
    pathToFileURL(join(ROOT, "lib/server/raw-body.js")).href
  );
  const { rawBodyFromWebRequest } = await import(
    pathToFileURL(join(ROOT, "lib/server/web-request.js")).href
  );

  const checkoutPayload = JSON.stringify({ action: "checkout", planId: "base" });
  const checkoutReq = new Request("https://example.test/api/subscription", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: checkoutPayload,
  });
  const checkoutBody = parseJsonFromRawBody(await rawBodyFromWebRequest(checkoutReq));
  assert.equal(checkoutBody.action, "checkout");
  assert.equal(checkoutBody.planId, "base");

  const portalPayload = JSON.stringify({ action: "portal" });
  const portalReq = new Request("https://example.test/api/subscription", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: portalPayload,
  });
  const portalBody = parseJsonFromRawBody(await rawBodyFromWebRequest(portalReq));
  assert.equal(portalBody.action, "portal");
});

test("388B.1: never re-stringify parsed objects for signatures", async () => {
  const { readRawBody } = await import(
    pathToFileURL(join(ROOT, "lib/server/raw-body.js")).href
  );
  await assert.rejects(
    () => readRawBody({ body: { id: "evt_obj" }, readable: false }),
    (err) => err && err.code === "raw_body_unavailable",
  );
});
