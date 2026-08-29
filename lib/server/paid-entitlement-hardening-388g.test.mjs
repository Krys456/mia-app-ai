/**
 * #388G — Paid entitlement hardening: advancedMemory + advancedModel + shadow decisionStage.
 * Run: node --test lib/server/paid-entitlement-hardening-388g.test.mjs
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import {
  ENTITLEMENT_ENFORCEMENT_ENV,
  ENTITLEMENT_SHADOW_ENV,
  canUse,
  requireEntitlement,
  resolveEntitlements,
  resolveRuntimePlanId,
} from './entitlements.js'
import {
  decideAdvancedMemoryEntitlement,
  decideImageGenerationTools,
  decideRouteEntitlementAsync,
  decideWebSearchTools,
  extractClientPlanClaims,
  maybeLogEntitlementShadow,
} from './entitlement-gates.js'
import {
  ENTITLEMENT_SHADOW_ALLOW_CODE,
  ENTITLEMENT_SHADOW_DENY_CODE,
  buildEntitlementShadowPayload,
  normalizeEntitlementShadowDecisionStage,
  shadowPayloadHasSensitiveKeys,
} from './entitlement-shadow.js'
import {
  STANDARD_CHAT_MODEL,
  isAdvancedChatModel,
  resolveConfiguredChatModel,
  resolveEntitledChatModel,
} from './chat-model.js'

const root = process.cwd()
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

function captureLogs(fn) {
  const logs = []
  const orig = console.log
  console.log = (...args) => {
    logs.push(args.map(String).join(' '))
  }
  try {
    const result = fn()
    return { logs, result }
  } finally {
    console.log = orig
  }
}

async function captureLogsAsync(fn) {
  const logs = []
  const orig = console.log
  console.log = (...args) => {
    logs.push(args.map(String).join(' '))
  }
  try {
    const result = await fn()
    return { logs, result }
  } finally {
    console.log = orig
  }
}

// —— decisionStage allowlist ——
test('388G: decisionStage normalize + payload field', () => {
  assert.equal(normalizeEntitlementShadowDecisionStage('offered'), 'offered')
  assert.equal(normalizeEntitlementShadowDecisionStage('REQUIRED'), 'required')
  assert.equal(normalizeEntitlementShadowDecisionStage('invoked'), 'invoked')
  assert.equal(normalizeEntitlementShadowDecisionStage('maybe'), null)
  assert.equal(normalizeEntitlementShadowDecisionStage(''), null)

  const payload = buildEntitlementShadowPayload({
    feature: 'imageGeneration',
    effectivePlan: 'free',
    wouldAllow: false,
    decisionStage: 'offered',
    route: '/api/chat',
    env: { VERCEL_ENV: 'preview' },
  })
  assert.equal(payload.code, ENTITLEMENT_SHADOW_DENY_CODE)
  assert.equal(payload.decisionStage, 'offered')
  assert.equal(shadowPayloadHasSensitiveKeys(payload), false)
  assert.equal('prompt' in payload, false)
})

test('388G telemetry: webSearch-only vs imageGeneration offered stages', () => {
  const free = resolveEntitlements('free')
  const { logs } = captureLogs(() => {
    decideWebSearchTools({
      intent: 'require',
      forceWebSearch: true,
      webTools: [{ type: 'web_search' }],
      entitlements: free,
      planId: 'free',
      enforcementEnabled: false,
      shadowEnabled: true,
      requestId: 'req-ws-1',
    })
    decideImageGenerationTools({
      imageTools: [{ type: 'image_generation' }],
      entitlements: free,
      planId: 'free',
      enforcementEnabled: false,
      shadowEnabled: true,
      requestId: 'req-ws-1',
    })
  })

  const ws = logs.find((l) => l.includes(ENTITLEMENT_SHADOW_DENY_CODE) && l.includes('webSearch'))
  const img = logs.find(
    (l) => l.includes(ENTITLEMENT_SHADOW_DENY_CODE) && l.includes('imageGeneration'),
  )
  assert.ok(ws, 'webSearch shadow deny expected')
  assert.ok(img, 'imageGeneration shadow deny expected')
  assert.match(ws, /"decisionStage":"required"/)
  assert.match(img, /"decisionStage":"offered"/)
})

test('388G: Base webSearch under enforcement succeeds; imageGeneration soft-omitted', () => {
  const base = resolveEntitlements('base')
  const ws = decideWebSearchTools({
    intent: 'optional',
    webTools: [{ type: 'web_search' }],
    entitlements: base,
    planId: 'base',
    enforcementEnabled: true,
    shadowEnabled: false,
  })
  assert.equal(ws.mode, 'allow')
  assert.equal(ws.webTools.length, 1)

  const img = decideImageGenerationTools({
    imageTools: [{ type: 'image_generation' }],
    entitlements: base,
    planId: 'base',
    enforcementEnabled: true,
    shadowEnabled: false,
  })
  assert.equal(img.mode, 'omit')
  assert.equal(img.imageTools.length, 0)

  // No request-level denial for optional webSearch when Base is entitled.
  assert.equal(ws.mode === 'deny', false)
})

// —— advancedMemory ——
test('388G advancedMemory: Free shadow deny + behavior preserved (enforcement OFF)', () => {
  const free = resolveEntitlements('free')
  const { logs, result } = captureLogs(() =>
    decideAdvancedMemoryEntitlement({
      entitlements: free,
      planId: 'free',
      enforcementEnabled: false,
      shadowEnabled: true,
      requestId: 'mem-free-shadow',
      route: '/api/chat',
    }),
  )
  assert.equal(result.allowed, true)
  assert.equal(result.reason, 'enforcement_disabled')
  assert.ok(logs.some((l) => l.includes(ENTITLEMENT_SHADOW_DENY_CODE) && l.includes('advancedMemory')))
  assert.ok(logs.some((l) => l.includes('"decisionStage":"required"')))
})

test('388G advancedMemory: Base + Pro shadow allow', () => {
  for (const plan of ['base', 'pro']) {
    const ents = resolveEntitlements(plan)
    const { logs, result } = captureLogs(() =>
      decideAdvancedMemoryEntitlement({
        entitlements: ents,
        planId: plan,
        enforcementEnabled: false,
        shadowEnabled: true,
        route: '/api/memories',
      }),
    )
    assert.equal(result.allowed, true, plan)
    assert.ok(
      logs.some((l) => l.includes(ENTITLEMENT_SHADOW_ALLOW_CODE) && l.includes('advancedMemory')),
      plan,
    )
  }
})

test('388G advancedMemory: Free enforcement deny; Base/Pro allow', () => {
  assert.equal(
    decideAdvancedMemoryEntitlement({
      entitlements: resolveEntitlements('free'),
      planId: 'free',
      enforcementEnabled: true,
      shadowEnabled: false,
    }).allowed,
    false,
  )
  assert.equal(
    decideAdvancedMemoryEntitlement({
      entitlements: resolveEntitlements('base'),
      planId: 'base',
      enforcementEnabled: true,
      shadowEnabled: false,
    }).allowed,
    true,
  )
  assert.equal(
    decideAdvancedMemoryEntitlement({
      entitlements: resolveEntitlements('pro'),
      planId: 'pro',
      enforcementEnabled: true,
      shadowEnabled: false,
    }).allowed,
    true,
  )
})

test('388G advancedMemory: Free forget/privacy stays Free (basicMemory + no gate on DELETE)', async () => {
  const free = resolveEntitlements('free')
  assert.equal(canUse(free, 'basicMemory'), true)
  assert.equal(canUse(free, 'advancedMemory'), false)

  // DELETE paths must not call advancedMemory gate — source contracts.
  const indexSrc = read('api/memories/index.ts')
  const idSrc = read('api/memories/[id].ts')
  assert.match(indexSrc, /requireAdvancedMemoryManage/)
  assert.match(idSrc, /requireAdvancedMemoryManage/)
  // DELETE block appears without advanced gate call immediately before it.
  assert.match(indexSrc, /Privacy forget-all/)
  assert.match(idSrc, /Privacy forget/)
  assert.doesNotMatch(
    indexSrc.slice(indexSrc.indexOf("if (req.method === 'DELETE')"), indexSrc.indexOf("if (req.method !== 'POST')")),
    /requireAdvancedMemoryManage/,
  )

  // Direct manage bypass closed under enforcement simulation.
  const { result } = await captureLogsAsync(() =>
    decideRouteEntitlementAsync({
      userId: 'user-free',
      entitlement: 'advancedMemory',
      entitlements: free,
      planId: 'free',
      enforcementEnabled: true,
      shadowEnabled: false,
      route: '/api/memories',
    }),
  )
  assert.equal(result.allowed, false)
  assert.equal(result.body?.entitlement, 'advancedMemory')
})

test('388G advancedMemory: spoofed plan cannot grant manage access under enforcement', async () => {
  const claims = extractClientPlanClaims(
    { plan: 'pro', effectivePlan: 'pro', entitlements: { advancedMemory: true } },
    { 'x-plan': 'pro' },
    { plan: 'pro' },
  )
  // Runtime plan ignores client claims.
  assert.equal(resolveRuntimePlanId({ claimedPlanId: claims.bodyPlanId }), 'free')
  const decision = await decideRouteEntitlementAsync({
    userId: 'spoof-user',
    entitlement: 'advancedMemory',
    entitlements: resolveEntitlements('free'),
    planId: 'free',
    enforcementEnabled: true,
    shadowEnabled: false,
  })
  assert.equal(decision.allowed, false)
})

// —— advancedModel ——
test('388G advancedModel: classification + configured resolve', () => {
  assert.equal(isAdvancedChatModel('gpt-5.6-sol'), true)
  assert.equal(isAdvancedChatModel('gpt-5.6'), true)
  assert.equal(isAdvancedChatModel('gpt-4o'), false)
  assert.equal(isAdvancedChatModel('gpt-4o-mini'), false)
  assert.equal(resolveConfiguredChatModel({}), STANDARD_CHAT_MODEL)
  assert.equal(resolveConfiguredChatModel({ OPENAI_MODEL: 'gpt-40' }), 'gpt-4o')
  assert.equal(resolveConfiguredChatModel({ OPENAI_MODEL: 'gpt-5.6-sol' }), 'gpt-5.6-sol')
})

test('388G advancedModel: Free/Base shadow deny preserves current model; Pro allow', () => {
  const env = { OPENAI_MODEL: 'gpt-5.6-sol', [ENTITLEMENT_SHADOW_ENV]: '1' }

  for (const plan of ['free', 'base']) {
    const { logs, result } = captureLogs(() =>
      resolveEntitledChatModel({
        entitlements: resolveEntitlements(plan),
        planId: plan,
        env,
        shadowEnabled: true,
        enforcementEnabled: false,
        route: '/api/chat',
      }),
    )
    assert.equal(result.model, 'gpt-5.6-sol', plan)
    assert.equal(result.usedFallback, false, plan)
    assert.equal(result.advancedAllowed, false, plan)
    assert.ok(logs.some((l) => l.includes(ENTITLEMENT_SHADOW_DENY_CODE) && l.includes('advancedModel')), plan)
  }

  const { logs, result } = captureLogs(() =>
    resolveEntitledChatModel({
      entitlements: resolveEntitlements('pro'),
      planId: 'pro',
      env,
      shadowEnabled: true,
      enforcementEnabled: false,
      route: '/api/chat',
    }),
  )
  assert.equal(result.model, 'gpt-5.6-sol')
  assert.equal(result.advancedAllowed, true)
  assert.ok(logs.some((l) => l.includes(ENTITLEMENT_SHADOW_ALLOW_CODE) && l.includes('advancedModel')))
})

test('388G advancedModel: enforcement fallback Free/Base → standard; Pro keeps advanced', () => {
  const env = { OPENAI_MODEL: 'gpt-5.6-sol', [ENTITLEMENT_ENFORCEMENT_ENV]: '1' }

  const free = resolveEntitledChatModel({
    entitlements: resolveEntitlements('free'),
    planId: 'free',
    env,
    enforcementEnabled: true,
    shadowEnabled: false,
  })
  assert.equal(free.model, STANDARD_CHAT_MODEL)
  assert.equal(free.usedFallback, true)
  assert.equal(free.configuredModel, 'gpt-5.6-sol')

  const base = resolveEntitledChatModel({
    entitlements: resolveEntitlements('base'),
    planId: 'base',
    env,
    enforcementEnabled: true,
    shadowEnabled: false,
  })
  assert.equal(base.model, STANDARD_CHAT_MODEL)
  assert.equal(base.usedFallback, true)

  const pro = resolveEntitledChatModel({
    entitlements: resolveEntitlements('pro'),
    planId: 'pro',
    env,
    enforcementEnabled: true,
    shadowEnabled: false,
  })
  assert.equal(pro.model, 'gpt-5.6-sol')
  assert.equal(pro.usedFallback, false)
})

test('388G advancedModel: spoofed body model/plan cannot bypass', () => {
  const free = resolveEntitlements('free')
  const result = resolveEntitledChatModel({
    entitlements: free,
    planId: resolveRuntimePlanId({ claimedPlanId: 'pro' }),
    env: { OPENAI_MODEL: 'gpt-4o' },
    enforcementEnabled: true,
    shadowEnabled: false,
    claimedModel: 'gpt-5.6-sol',
  })
  // Env says gpt-4o (not advanced); claimed model ignored.
  assert.equal(result.model, 'gpt-4o')
  assert.equal(result.isAdvanced, false)

  const advancedEnv = resolveEntitledChatModel({
    entitlements: free,
    planId: 'free',
    env: { OPENAI_MODEL: 'gpt-5.6-sol' },
    enforcementEnabled: true,
    shadowEnabled: false,
    claimedModel: 'gpt-5.6-sol',
  })
  assert.equal(advancedEnv.model, STANDARD_CHAT_MODEL)
  assert.equal(advancedEnv.usedFallback, true)
})

test('388G source wiring: chat/selection/memories use shared gates', () => {
  const chat = read('api/chat.ts')
  assert.match(chat, /decideAdvancedMemoryEntitlement/)
  assert.match(chat, /resolveEntitledChatModel/)
  assert.match(chat, /advancedMemoryAllowed/)
  // Forget path must remain before advanced gate usage for overview.
  assert.match(chat, /tryHandleMemoryControl/)
  assert.doesNotMatch(chat, /function resolveChatModel/)

  const selection = read('api/selection.ts')
  assert.match(selection, /resolveEntitledChatModel/)
  assert.doesNotMatch(selection, /function resolveChatModel/)

  const memories = read('api/memories/index.ts')
  assert.match(memories, /advancedMemory/)
  assert.match(memories, /decideRouteEntitlementAsync/)

  const modelHelper = read('lib/server/chat-model.js')
  assert.match(modelHelper, /STANDARD_CHAT_MODEL/)
  assert.match(modelHelper, /isAdvancedChatModel/)
  assert.match(modelHelper, /claimedModel/)
})

test('388G: maybeLogEntitlementShadow passes decisionStage', () => {
  const { logs } = captureLogs(() => {
    maybeLogEntitlementShadow({
      shadowEnabled: true,
      feature: 'webSearch',
      entitlements: resolveEntitlements('base'),
      planId: 'base',
      decisionStage: 'invoked',
      route: '/api/chat',
    })
  })
  assert.ok(logs.some((l) => l.includes(ENTITLEMENT_SHADOW_ALLOW_CODE)))
  assert.ok(logs.some((l) => l.includes('"decisionStage":"invoked"')))
})

test('388G: Free advancedMemory requireEntitlement reasons', () => {
  const free = resolveEntitlements('free')
  assert.equal(
    requireEntitlement({
      entitlements: free,
      entitlement: 'advancedMemory',
      enforcementEnabled: false,
    }).reason,
    'enforcement_disabled',
  )
  assert.equal(
    requireEntitlement({
      entitlements: free,
      entitlement: 'advancedMemory',
      enforcementEnabled: true,
    }).body.requiredPlan,
    'base',
  )
})
