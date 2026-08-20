/**
 * #332C — Entitlement enforcement foundation (rollout OFF by default)
 * Run: node --test lib/server/entitlement-enforcement-332c.test.mjs
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  ENTITLEMENT_ENFORCEMENT_ENV,
  canUse,
  isEntitlementEnforcementEnabled,
  requireEntitlement,
  resolveEntitlements,
  resolveEntitlementsForUser,
  resolveRuntimePlanId,
} from './entitlements.js'
import {
  decideDocumentsEntitlement,
  decideImageGenerationTools,
  decideRouteEntitlement,
  decideVisionEntitlement,
  decideWebSearchTools,
  extractClientPlanClaims,
  loadUserEntitlements,
} from './entitlement-gates.js'

const root = process.cwd()
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

// —— Rollout config ——
assert.equal(isEntitlementEnforcementEnabled({}), false)
assert.equal(isEntitlementEnforcementEnabled({ [ENTITLEMENT_ENFORCEMENT_ENV]: '' }), false)
assert.equal(isEntitlementEnforcementEnabled({ [ENTITLEMENT_ENFORCEMENT_ENV]: 'false' }), false)
assert.equal(isEntitlementEnforcementEnabled({ [ENTITLEMENT_ENFORCEMENT_ENV]: '0' }), false)
assert.equal(isEntitlementEnforcementEnabled({ [ENTITLEMENT_ENFORCEMENT_ENV]: 'yes' }), false)
assert.equal(isEntitlementEnforcementEnabled({ [ENTITLEMENT_ENFORCEMENT_ENV]: 'TRUE' }), true)
assert.equal(isEntitlementEnforcementEnabled({ [ENTITLEMENT_ENFORCEMENT_ENV]: 'True' }), true)
assert.equal(isEntitlementEnforcementEnabled({ [ENTITLEMENT_ENFORCEMENT_ENV]: '1' }), true)
assert.equal(isEntitlementEnforcementEnabled({ [ENTITLEMENT_ENFORCEMENT_ENV]: ' 1 ' }), true)

// —— requireEntitlement reasons ——
{
  const free = resolveEntitlements('free')
  const off = requireEntitlement({
    entitlements: free,
    entitlement: 'webSearch',
    enforcementEnabled: false,
  })
  assert.equal(off.allowed, true)
  assert.equal(off.reason, 'enforcement_disabled')

  const denied = requireEntitlement({
    entitlements: free,
    entitlement: 'webSearch',
    enforcementEnabled: true,
  })
  assert.equal(denied.allowed, false)
  assert.equal(denied.reason, 'entitlement_required')
  assert.equal(denied.body.entitlement, 'webSearch')
  assert.equal(denied.body.requiredPlan, 'base')

  const allowed = requireEntitlement({
    entitlements: resolveEntitlements('base'),
    entitlement: 'webSearch',
    enforcementEnabled: true,
  })
  assert.equal(allowed.allowed, true)
  assert.equal(allowed.reason, 'allowed')
}

// —— OFF + Free: premium capabilities allowed (compatibility) ——
{
  const free = resolveEntitlements('free')
  for (const key of ['webSearch', 'documents', 'voice', 'vision', 'imageGeneration']) {
    const d = requireEntitlement({
      entitlements: free,
      entitlement: key,
      enforcementEnabled: false,
    })
    assert.equal(d.allowed, true, `${key} should pass when enforcement OFF`)
  }
  assert.equal(
    decideWebSearchTools({
      intent: 'require',
      webTools: [{ type: 'web_search' }],
      entitlements: free,
      enforcementEnabled: false,
    }).mode,
    'allow',
  )
  assert.equal(
    decideVisionEntitlement({ hasImage: true, entitlements: free, enforcementEnabled: false })
      .allowed,
    true,
  )
}

// —— ON + Free matrix ——
{
  const free = resolveEntitlements('free')
  assert.equal(canUse(free, 'coreChat'), true)
  assert.equal(
    requireEntitlement({ entitlements: free, entitlement: 'coreChat', enforcementEnabled: true })
      .allowed,
    true,
  )
  assert.equal(
    requireEntitlement({ entitlements: free, entitlement: 'webSearch', enforcementEnabled: true })
      .body.requiredPlan,
    'base',
  )
  assert.equal(
    requireEntitlement({ entitlements: free, entitlement: 'documents', enforcementEnabled: true })
      .body.requiredPlan,
    'base',
  )
  assert.equal(
    requireEntitlement({ entitlements: free, entitlement: 'voice', enforcementEnabled: true }).body
      .requiredPlan,
    'base',
  )
  assert.equal(
    requireEntitlement({ entitlements: free, entitlement: 'vision', enforcementEnabled: true }).body
      .requiredPlan,
    'pro',
  )
}

// —— ON + Base matrix ——
{
  const base = resolveEntitlements('base')
  for (const key of ['coreChat', 'webSearch', 'documents', 'voice']) {
    assert.equal(
      requireEntitlement({ entitlements: base, entitlement: key, enforcementEnabled: true }).allowed,
      true,
      key,
    )
  }
  assert.equal(
    requireEntitlement({ entitlements: base, entitlement: 'vision', enforcementEnabled: true })
      .allowed,
    false,
  )
}

// —— ON + Pro matrix ——
{
  const pro = resolveEntitlements('pro')
  for (const key of ['coreChat', 'webSearch', 'documents', 'voice', 'vision', 'imageGeneration']) {
    assert.equal(
      requireEntitlement({ entitlements: pro, entitlement: key, enforcementEnabled: true }).allowed,
      true,
      key,
    )
  }
}

// —— Web search: ordinary vs explicit ——
{
  const free = resolveEntitlements('free')
  const ordinary = decideWebSearchTools({
    intent: 'optional',
    webTools: [{ type: 'web_search' }],
    entitlements: free,
    enforcementEnabled: true,
  })
  assert.equal(ordinary.mode, 'omit')
  assert.equal(ordinary.webTools.length, 0)

  const explicit = decideWebSearchTools({
    intent: 'require',
    webTools: [{ type: 'web_search' }],
    entitlements: free,
    enforcementEnabled: true,
  })
  assert.equal(explicit.mode, 'deny')
  assert.equal(explicit.decision?.body?.entitlement, 'webSearch')
}

// —— Text chat vs Vision ——
{
  const free = resolveEntitlements('free')
  assert.equal(
    decideVisionEntitlement({ hasImage: false, entitlements: free, enforcementEnabled: true })
      .allowed,
    true,
  )
  assert.equal(
    decideVisionEntitlement({ hasImage: true, entitlements: free, enforcementEnabled: true })
      .allowed,
    false,
  )
  assert.equal(
    decideVisionEntitlement({
      hasImage: true,
      entitlements: resolveEntitlements('base'),
      enforcementEnabled: true,
    }).allowed,
    false,
  )
  assert.equal(
    decideVisionEntitlement({
      hasImage: true,
      entitlements: resolveEntitlements('pro'),
      enforcementEnabled: true,
    }).allowed,
    true,
  )
}

// —— Documents / image gen ——
{
  const free = resolveEntitlements('free')
  assert.equal(
    decideDocumentsEntitlement({ hasDocument: true, entitlements: free, enforcementEnabled: true })
      .allowed,
    false,
  )
  assert.equal(
    decideImageGenerationTools({
      imageTools: [{ type: 'image_generation' }],
      entitlements: free,
      enforcementEnabled: true,
    }).mode,
    'omit',
  )
}

// —— Runtime always Free; client claims ignored ——
assert.equal(resolveRuntimePlanId({ claimedPlanId: 'pro' }), 'free')
assert.equal(resolveEntitlementsForUser('u', { claimedPlanId: 'pro' }).planId, 'free')
{
  const claims = extractClientPlanClaims(
    { planId: 'pro', currentPlanId: 'pro' },
    { 'x-plan': 'pro' },
    { plan: 'pro' },
  )
  assert.equal(claims.bodyPlanId, 'pro')
  // Production resolver still Free — claims are not fed into resolveRuntimePlanId.
  assert.equal(loadUserEntitlements('u').planId, 'free')
  assert.equal(canUse(loadUserEntitlements('u').entitlements, 'vision'), false)
}

// —— Route helper with injected Base entitlements (tests only) ——
{
  const decision = decideRouteEntitlement({
    userId: 'u',
    entitlement: 'webSearch',
    entitlements: resolveEntitlements('base'),
    enforcementEnabled: true,
  })
  assert.equal(decision.allowed, true)
}

// —— Wiring present; default OFF ——
{
  const tts = read('api/tts.ts')
  assert.match(tts, /entitlement:\s*'voice'/)
  const files = read('api/files.ts')
  assert.match(files, /entitlement:\s*'documents'/)
  const selection = read('api/selection.ts')
  assert.match(selection, /decideRouteEntitlement/)
  assert.match(selection, /webSearch/)
  const chat = read('api/chat.ts')
  assert.match(chat, /decideVisionEntitlement/)
  assert.match(chat, /decideDocumentsEntitlement/)
  assert.match(chat, /decideWebSearchTools|resolveHostedToolsForTurn/)
  assert.match(chat, /loadUserEntitlements/)
  // Chat route itself is not Base-gated
  assert.match(chat, /bucket: 'chat' \}/)
  assert.doesNotMatch(chat, /bucket: 'chat',\s*entitlement/)
}

// —— No billing-provider schema (subscriptions_332d is allowed persistence) ——
{
  const migrations = fs.readdirSync(path.join(root, 'supabase/migrations'))
  assert.equal(
    migrations.filter((n) => /billing_provider|stripe_customers|entitlement_enforcement/i.test(n))
      .length,
    0,
  )
  assert.doesNotMatch(read('lib/server/entitlements.js'), /RevenueCat|StoreKit/i)
  assert.doesNotMatch(read('api/chat.ts'), /OPENAI_API_KEY[\s\S]{0,40}entitlement/)
}

// —— Core / Personality untouched ——
{
  assert.doesNotMatch(read('src/lib/personality.ts').slice(0, 400), /ENTITLEMENT_ENFORCEMENT/)
  assert.doesNotMatch(read('lib/server/natural-response-policy.js').slice(0, 120), /requireEntitlement/)
}

console.log('entitlement-enforcement-332c: ok')
