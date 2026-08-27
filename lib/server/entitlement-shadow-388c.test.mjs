/**
 * #388C — Entitlement shadow mode tests.
 * Run: node --test lib/server/entitlement-shadow-388c.test.mjs
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import {
  ENTITLEMENT_ENFORCEMENT_ENV,
  ENTITLEMENT_SHADOW_ENV,
  isEntitlementEnforcementEnabled,
  isEntitlementShadowEnabled,
  needsVerifiedPlanLookup,
  requireEntitlement,
  resolveEntitlements,
} from './entitlements.js'
import {
  decideDocumentsEntitlement,
  decideRouteEntitlementAsync,
  decideVisionEntitlement,
  decideWebSearchTools,
  loadUserEntitlementsAsync,
  maybeLogEntitlementShadow,
} from './entitlement-gates.js'
import {
  ENTITLEMENT_SHADOW_ALLOW_CODE,
  ENTITLEMENT_SHADOW_DENY_CODE,
  buildEntitlementShadowPayload,
  shadowPayloadHasSensitiveKeys,
} from './entitlement-shadow.js'

const root = process.cwd()
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

test('388C: shadow env defaults OFF; explicit true|1 only', () => {
  assert.equal(isEntitlementShadowEnabled({}), false)
  assert.equal(isEntitlementShadowEnabled({ [ENTITLEMENT_SHADOW_ENV]: '' }), false)
  assert.equal(isEntitlementShadowEnabled({ [ENTITLEMENT_SHADOW_ENV]: 'false' }), false)
  assert.equal(isEntitlementShadowEnabled({ [ENTITLEMENT_SHADOW_ENV]: 'yes' }), false)
  assert.equal(isEntitlementShadowEnabled({ [ENTITLEMENT_SHADOW_ENV]: '1' }), true)
  assert.equal(isEntitlementShadowEnabled({ [ENTITLEMENT_SHADOW_ENV]: 'TRUE' }), true)
})

test('388C: needsVerifiedPlanLookup = enforcement OR shadow', () => {
  assert.equal(needsVerifiedPlanLookup({}), false)
  assert.equal(
    needsVerifiedPlanLookup({ [ENTITLEMENT_SHADOW_ENV]: '1' }),
    true,
  )
  assert.equal(
    needsVerifiedPlanLookup({ [ENTITLEMENT_ENFORCEMENT_ENV]: '1' }),
    true,
  )
})

test('388C A: enforcement OFF + shadow OFF → allow, no shadow emit', async () => {
  const env = {}
  assert.equal(isEntitlementEnforcementEnabled(env), false)
  assert.equal(isEntitlementShadowEnabled(env), false)

  const logs = []
  const orig = console.log
  console.log = (...args) => {
    logs.push(args.join(' '))
  }
  try {
    const decision = await decideRouteEntitlementAsync({
      userId: 'user-a',
      entitlement: 'webSearch',
      env,
      entitlements: resolveEntitlements('free'),
      planId: 'free',
    })
    assert.equal(decision.allowed, true)
    assert.equal(decision.reason, 'enforcement_disabled')
    assert.equal(logs.some((l) => l.includes(ENTITLEMENT_SHADOW_DENY_CODE)), false)
    assert.equal(logs.some((l) => l.includes(ENTITLEMENT_SHADOW_ALLOW_CODE)), false)
  } finally {
    console.log = orig
  }
})

test('388C B: enforcement OFF + shadow ON + entitled → allow + shadow allow', async () => {
  const env = { [ENTITLEMENT_SHADOW_ENV]: '1' }
  const logs = []
  const orig = console.log
  console.log = (...args) => {
    logs.push(args.join(' '))
  }
  try {
    const decision = await decideRouteEntitlementAsync({
      userId: 'user-b',
      entitlement: 'webSearch',
      env,
      shadowEnabled: true,
      enforcementEnabled: false,
      entitlements: resolveEntitlements('base'),
      planId: 'base',
      requestId: 'req-b-1111',
      route: '/api/tts',
    })
    assert.equal(decision.allowed, true)
    assert.equal(decision.reason, 'enforcement_disabled')
    assert.ok(logs.some((l) => l.includes(ENTITLEMENT_SHADOW_ALLOW_CODE)))
    assert.equal(logs.some((l) => l.includes(ENTITLEMENT_SHADOW_DENY_CODE)), false)
  } finally {
    console.log = orig
  }
})

test('388C C: enforcement OFF + shadow ON + not entitled → allow + shadow deny', async () => {
  const env = { [ENTITLEMENT_SHADOW_ENV]: '1' }
  const logs = []
  const orig = console.log
  console.log = (...args) => {
    logs.push(args.join(' '))
  }
  try {
    const decision = await decideRouteEntitlementAsync({
      userId: 'user-c',
      entitlement: 'vision',
      env,
      shadowEnabled: true,
      enforcementEnabled: false,
      entitlements: resolveEntitlements('free'),
      planId: 'free',
      requestId: 'req-c-2222',
      route: '/api/chat',
    })
    assert.equal(decision.allowed, true)
    assert.equal(decision.reason, 'enforcement_disabled')
    assert.ok(logs.some((l) => l.includes(ENTITLEMENT_SHADOW_DENY_CODE)))
    // Must not actually block.
    assert.equal(logs.some((l) => /"status":403/.test(l) && l.includes('entitlement_required')), false)
  } finally {
    console.log = orig
  }
})

test('388C D: enforcement ON + not entitled → deny; shadow cannot override', async () => {
  const env = {
    [ENTITLEMENT_ENFORCEMENT_ENV]: '1',
    [ENTITLEMENT_SHADOW_ENV]: '1',
  }
  const decision = await decideRouteEntitlementAsync({
    userId: 'user-d',
    entitlement: 'documents',
    env,
    enforcementEnabled: true,
    shadowEnabled: true,
    entitlements: resolveEntitlements('free'),
    planId: 'free',
  })
  assert.equal(decision.allowed, false)
  assert.equal(decision.reason, 'entitlement_required')
  assert.equal(decision.body?.code, 'entitlement_required')
})

test('388C E: enforcement ON + entitled → allow', async () => {
  const decision = await decideRouteEntitlementAsync({
    userId: 'user-e',
    entitlement: 'voice',
    enforcementEnabled: true,
    shadowEnabled: true,
    entitlements: resolveEntitlements('base'),
    planId: 'base',
  })
  assert.equal(decision.allowed, true)
  assert.equal(decision.reason, 'allowed')
})

test('388C F: anonymous/free resolution behaves correctly under shadow', async () => {
  const loaded = await loadUserEntitlementsAsync('anon-user', {
    shadowEnabled: true,
    enforcementEnabled: false,
    resolveVerifiedPlanForUser: async () => ({
      planId: 'free',
      reason: 'no_subscription',
    }),
  })
  assert.equal(loaded.planId, 'free')
  assert.equal(loaded.lookupError, false)

  const vision = decideVisionEntitlement({
    hasImage: true,
    entitlements: loaded.entitlements,
    planId: loaded.planId,
    enforcementEnabled: false,
    shadowEnabled: true,
  })
  assert.equal(vision.allowed, true)
  assert.equal(vision.reason, 'enforcement_disabled')
})

test('388C G: subscription lookup failure preserves fail behavior', async () => {
  // Enforcement ON → deny with lookup_unavailable (existing).
  const on = await decideRouteEntitlementAsync({
    userId: 'user-g',
    entitlement: 'webSearch',
    enforcementEnabled: true,
    shadowEnabled: false,
    resolveVerifiedPlanForUser: async () => ({
      planId: 'free',
      lookupError: true,
    }),
  })
  assert.equal(on.allowed, false)
  assert.equal(on.reason, 'lookup_unavailable')

  // Enforcement OFF + shadow ON + lookup error → still allow (shadow skipped).
  const off = await decideRouteEntitlementAsync({
    userId: 'user-g2',
    entitlement: 'webSearch',
    enforcementEnabled: false,
    shadowEnabled: true,
    resolveVerifiedPlanForUser: async () => ({
      planId: 'free',
      lookupError: true,
    }),
  })
  assert.equal(off.allowed, true)
  assert.equal(off.reason, 'enforcement_disabled')
})

test('388C H: shadow payload is privacy-safe (no sensitive keys)', () => {
  const payload = buildEntitlementShadowPayload({
    feature: 'webSearch',
    effectivePlan: 'free',
    wouldAllow: false,
    resolution: 'no_subscription',
    requestId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    route: '/api/selection',
    env: { VERCEL_ENV: 'preview' },
  })
  assert.equal(payload.code, ENTITLEMENT_SHADOW_DENY_CODE)
  assert.equal(payload.feature, 'webSearch')
  assert.equal(payload.effectivePlan, 'free')
  assert.equal(payload.wouldAllow, false)
  assert.equal(payload.wouldDeny, true)
  assert.equal(shadowPayloadHasSensitiveKeys(payload), false)
  assert.equal('userId' in payload, false)
  assert.equal('email' in payload, false)
  assert.equal('prompt' in payload, false)
  assert.equal('customerId' in payload, false)
})

test('388C: vision/documents skip shadow when feature not requested', () => {
  const logs = []
  const orig = console.log
  console.log = (...args) => {
    logs.push(args.join(' '))
  }
  try {
    decideVisionEntitlement({
      hasImage: false,
      entitlements: resolveEntitlements('free'),
      shadowEnabled: true,
      enforcementEnabled: false,
    })
    decideDocumentsEntitlement({
      hasDocument: false,
      entitlements: resolveEntitlements('free'),
      shadowEnabled: true,
      enforcementEnabled: false,
    })
    assert.equal(logs.length, 0)
  } finally {
    console.log = orig
  }
})

test('388C: webSearch tools still allowed under shadow deny path', () => {
  const free = resolveEntitlements('free')
  const result = decideWebSearchTools({
    intent: 'require',
    webTools: [{ type: 'web_search' }],
    entitlements: free,
    planId: 'free',
    enforcementEnabled: false,
    shadowEnabled: true,
  })
  assert.equal(result.mode, 'allow')
  assert.equal(result.webTools.length, 1)
})

test('388C I: requireEntitlement unchanged; enforcement still authoritative', () => {
  const free = resolveEntitlements('free')
  assert.equal(
    requireEntitlement({
      entitlements: free,
      entitlement: 'voice',
      enforcementEnabled: false,
    }).allowed,
    true,
  )
  assert.equal(
    requireEntitlement({
      entitlements: free,
      entitlement: 'voice',
      enforcementEnabled: true,
    }).allowed,
    false,
  )
})

test('388C: architecture wiring present', () => {
  assert.match(read('lib/server/entitlements.js'), /ENTITLEMENT_SHADOW_ENABLED/)
  assert.match(read('lib/server/entitlement-gates.js'), /maybeLogEntitlementShadow/)
  assert.match(read('lib/server/entitlement-shadow.js'), /entitlement_shadow_deny/)
  assert.match(read('lib/server/paid-api-guard.js'), /requestId/)
  assert.match(read('api/chat.ts'), /entitlementPlanId|planId: entitlementPlanId/)
  assert.match(read('.env.example'), /ENTITLEMENT_SHADOW_ENABLED/)
  // Shadow must never be an auth mechanism.
  assert.doesNotMatch(read('lib/server/entitlement-shadow.js'), /sendJson|status:\s*403/)
})

test('388C: maybeLogEntitlementShadow no-ops when shadow OFF', () => {
  const logs = []
  const orig = console.log
  console.log = (...args) => logs.push(args.join(' '))
  try {
    const out = maybeLogEntitlementShadow({
      shadowEnabled: false,
      feature: 'voice',
      entitlements: resolveEntitlements('free'),
      planId: 'free',
    })
    assert.equal(out, null)
    assert.equal(logs.length, 0)
  } finally {
    console.log = orig
  }
})
