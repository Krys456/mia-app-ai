/**
 * #332B — Entitlements foundation contracts
 * Run: node --test lib/server/entitlements-332b.test.mjs
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  ENTITLEMENT_KEYS,
  ENTITLEMENT_MATRIX,
  PLAN_IDS,
  REQUIRED_PLAN_BY_ENTITLEMENT,
  buildEntitlementRequiredBody,
  canUse,
  denyAllEntitlements,
  normalizeEntitlementKey,
  normalizePlanId,
  requiredPlanForEntitlement,
  resolveEntitlements,
  resolveEntitlementsForUser,
  resolveRuntimePlanId,
} from './entitlements.js'

const root = process.cwd()
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

// —— FREE matrix ——
{
  const e = resolveEntitlements('free')
  assert.equal(canUse(e, 'coreChat'), true)
  assert.equal(canUse(e, 'basicMemory'), true)
  assert.equal(canUse(e, 'advancedMemory'), false)
  assert.equal(canUse(e, 'webSearch'), false)
  assert.equal(canUse(e, 'documents'), false)
  assert.equal(canUse(e, 'voice'), false)
  assert.equal(canUse(e, 'gmail'), false)
  assert.equal(canUse(e, 'calendar'), false)
  assert.equal(canUse(e, 'vision'), false)
  assert.equal(canUse(e, 'advancedModel'), false)
  assert.equal(canUse(e, 'imageGeneration'), false)
}

// —— BASE matrix ——
{
  const e = resolveEntitlements('base')
  assert.equal(canUse(e, 'coreChat'), true)
  assert.equal(canUse(e, 'basicMemory'), true)
  assert.equal(canUse(e, 'advancedMemory'), true)
  assert.equal(canUse(e, 'webSearch'), true)
  assert.equal(canUse(e, 'documents'), true)
  assert.equal(canUse(e, 'voice'), true)
  assert.equal(canUse(e, 'gmail'), true)
  assert.equal(canUse(e, 'calendar'), true)
  assert.equal(canUse(e, 'vision'), false)
  assert.equal(canUse(e, 'advancedModel'), false)
  assert.equal(canUse(e, 'imageGeneration'), false)
}

// —— PRO matrix ——
{
  const e = resolveEntitlements('pro')
  for (const key of ENTITLEMENT_KEYS) {
    assert.equal(canUse(e, key), true, `pro should allow ${key}`)
  }
  assert.equal(e.vision.window, 'month')
  assert.equal(e.imageGeneration.window, 'month')
  assert.equal(e.vision.limit, null)
}

// —— Unknown plan / entitlement fail safely ——
assert.equal(normalizePlanId('enterprise'), null)
assert.equal(normalizePlanId(''), null)
assert.equal(normalizeEntitlementKey('telepathy'), null)
{
  const denied = resolveEntitlements('not-a-plan')
  assert.equal(canUse(denied, 'coreChat'), false)
  assert.equal(canUse(denied, 'webSearch'), false)
  assert.equal(canUse(denyAllEntitlements(), 'coreChat'), false)
}
assert.equal(canUse(resolveEntitlements('free'), 'not-real'), false)

// —— Runtime always Free; client claim ignored ——
assert.equal(resolveRuntimePlanId({}), 'free')
assert.equal(resolveRuntimePlanId({ claimedPlanId: 'pro' }), 'free')
assert.equal(resolveRuntimePlanId({ claimedPlanId: 'base', verifiedPlanId: 'pro' }), 'free')
{
  const runtime = resolveEntitlementsForUser('user-123', { claimedPlanId: 'pro' })
  assert.equal(runtime.planId, 'free')
  assert.equal(canUse(runtime.entitlements, 'vision'), false)
  assert.equal(canUse(runtime.entitlements, 'coreChat'), true)
}

// —— entitlement_required contract ——
{
  const body = buildEntitlementRequiredBody({ entitlement: 'webSearch' })
  assert.equal(body.code, 'entitlement_required')
  assert.equal(body.error, 'entitlement_required')
  assert.equal(body.entitlement, 'webSearch')
  assert.equal(body.requiredPlan, 'base')
  assert.equal(REQUIRED_PLAN_BY_ENTITLEMENT.vision, 'pro')
  assert.equal(requiredPlanForEntitlement('vision'), 'pro')
  assert.equal(requiredPlanForEntitlement('nope'), null)
  const visionBody = buildEntitlementRequiredBody({ entitlement: 'vision' })
  assert.equal(visionBody.requiredPlan, 'pro')
  // No Stripe / RevenueCat leakage
  assert.equal('stripe' in body, false)
  assert.equal('subscriptionId' in body, false)
}

// —— Extensibility shape (boolean + future usage) ——
{
  const free = ENTITLEMENT_MATRIX.free.webSearch
  assert.equal(free.enabled, false)
  assert.equal('limit' in free, true)
  assert.equal('window' in free, true)
  const proVision = ENTITLEMENT_MATRIX.pro.vision
  assert.equal(proVision.enabled, true)
  assert.ok(PLAN_IDS.includes('free') && PLAN_IDS.includes('pro'))
}

// —— Architecture: plan catalog strings do not authorize ——
{
  const catalog = read('src/lib/planCatalog.ts')
  assert.match(catalog, /Presentation only|Authorization lives/)
  assert.doesNotMatch(catalog, /canUse\(|ENTITLEMENT_MATRIX|resolveEntitlements/)
  const entitlements = read('lib/server/entitlements.js')
  assert.doesNotMatch(entitlements, /€1,99|€7,99|Scegli l/)
  assert.match(entitlements, /claimedPlanId/)
  assert.match(entitlements, /server-authoritative|Server-authoritative/i)
}

// —— No scattered plan checks introduced in chat Core ——
{
  const chat = read('api/chat.ts')
  assert.doesNotMatch(chat, /planId\s*===\s*['"]pro['"]|if\s*\(\s*plan\s*===/)
  assert.doesNotMatch(chat, /resolveEntitlements|denyUnlessEntitled|ENTITLEMENT_MATRIX/)
}

// —— #332A Plans UI still present; App uses getCurrentPlanId ——
{
  const app = read('src/App.tsx')
  assert.match(app, /getCurrentPlanId/)
  assert.doesNotMatch(app, /UI_FOUNDATION_CURRENT_PLAN_ID/)
  const ui = read('src/lib/entitlementsUi.ts')
  assert.match(ui, /getCurrentPlanId/)
  assert.match(ui, /non-authoritative|never grant/i)
  assert.match(ui, /PLANS_APP_VIEW/)
}

// —— Client apiError maps entitlement_required ——
{
  const apiError = read('src/lib/apiError.ts')
  assert.match(apiError, /entitlement_required/)
  assert.match(apiError, /userFacingEntitlementMessage/)
}

// —— No schema / billing ——
{
  const migrations = fs.readdirSync(path.join(root, 'supabase/migrations'))
  assert.equal(
    migrations.filter((n) => /subscription|entitlement|billing|plan_/i.test(n)).length,
    0,
  )
  const entitlementsSrc = read('lib/server/entitlements.js')
  assert.doesNotMatch(entitlementsSrc, /stripe|RevenueCat|StoreKit|Play Billing/i)
}

// —— paid-api-guard may optionally take entitlement (#332C); chat stays ungated ——
{
  const guard = read('lib/server/paid-api-guard.js')
  assert.match(guard, /entitlement/)
  assert.match(guard, /decideRouteEntitlement|decideEntitlement/)
  const chat = read('api/chat.ts')
  assert.match(chat, /requirePaidApiAccess\(req, res, \{ bucket: 'chat' \}\)/)
  assert.doesNotMatch(chat, /requirePaidApiAccess\(req, res, \{ bucket: 'chat', entitlement:/)
}

console.log('entitlements-332b: ok')
