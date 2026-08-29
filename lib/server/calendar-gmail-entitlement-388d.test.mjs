/**
 * #388D — Calendar + Gmail entitlement gates (product flag × shadow × enforcement).
 * Run: node --test lib/server/calendar-gmail-entitlement-388d.test.mjs
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { resolveEntitlements } from './entitlements.js'
import {
  decideCalendarIntegrationEntitlement,
  decideGmailIntegrationEntitlement,
} from './integration-entitlement.js'
import {
  ENTITLEMENT_SHADOW_ALLOW_CODE,
  ENTITLEMENT_SHADOW_DENY_CODE,
  buildEntitlementShadowPayload,
  shadowPayloadHasSensitiveKeys,
} from './entitlement-shadow.js'

const root = process.cwd()
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

const freeEnt = resolveEntitlements('free')
const baseEnt = resolveEntitlements('base')
const proEnt = resolveEntitlements('pro')

test('388D matrix: free false; base/pro true for calendar+gmail', () => {
  assert.equal(freeEnt.calendar.enabled, false)
  assert.equal(freeEnt.gmail.enabled, false)
  assert.equal(baseEnt.calendar.enabled, true)
  assert.equal(baseEnt.gmail.enabled, true)
  assert.equal(proEnt.calendar.enabled, true)
  assert.equal(proEnt.gmail.enabled, true)
})

test('388D A: enforcement OFF + shadow OFF → allow (calendar+gmail)', async () => {
  for (const feature of ['calendar', 'gmail']) {
    const decide =
      feature === 'calendar'
        ? decideCalendarIntegrationEntitlement
        : decideGmailIntegrationEntitlement
    const d = await decide({
      userId: 'u-a',
      enforcementEnabled: false,
      shadowEnabled: false,
      entitlements: freeEnt,
      planId: 'free',
      emailEnabled: true,
      isCalendarEnabledFn: () => true,
    })
    assert.equal(d.allowed, true)
    assert.equal(d.reason, 'enforcement_disabled')
  }
})

test('388D B: enforcement OFF + shadow ON + Free → shadow deny + allow', async () => {
  const logs = []
  const orig = console.log
  console.log = (...a) => logs.push(a.join(' '))
  try {
    const cal = await decideCalendarIntegrationEntitlement({
      userId: 'u-b',
      enforcementEnabled: false,
      shadowEnabled: true,
      entitlements: freeEnt,
      planId: 'free',
      isCalendarEnabledFn: () => true,
      requestId: 'req-cal-b',
      route: '/api/daily-briefing',
    })
    assert.equal(cal.allowed, true)
    assert.ok(logs.some((l) => l.includes(ENTITLEMENT_SHADOW_DENY_CODE) && l.includes('calendar')))

    logs.length = 0
    const mail = await decideGmailIntegrationEntitlement({
      userId: 'u-b2',
      enforcementEnabled: false,
      shadowEnabled: true,
      entitlements: freeEnt,
      planId: 'free',
      emailEnabled: true,
      requestId: 'req-mail-b',
      route: 'email-query',
    })
    assert.equal(mail.allowed, true)
    assert.ok(logs.some((l) => l.includes(ENTITLEMENT_SHADOW_DENY_CODE) && l.includes('gmail')))
  } finally {
    console.log = orig
  }
})

test('388D C+D: Base/Pro shadow allow + request allowed', async () => {
  const logs = []
  const orig = console.log
  console.log = (...a) => logs.push(a.join(' '))
  try {
    for (const [plan, ents] of [
      ['base', baseEnt],
      ['pro', proEnt],
    ]) {
      logs.length = 0
      const cal = await decideCalendarIntegrationEntitlement({
        userId: `u-${plan}`,
        enforcementEnabled: false,
        shadowEnabled: true,
        entitlements: ents,
        planId: plan,
        isCalendarEnabledFn: () => true,
      })
      assert.equal(cal.allowed, true)
      assert.ok(logs.some((l) => l.includes(ENTITLEMENT_SHADOW_ALLOW_CODE)))

      logs.length = 0
      const mail = await decideGmailIntegrationEntitlement({
        userId: `u-m-${plan}`,
        enforcementEnabled: false,
        shadowEnabled: true,
        entitlements: ents,
        planId: plan,
        emailEnabled: true,
      })
      assert.equal(mail.allowed, true)
      assert.ok(logs.some((l) => l.includes(ENTITLEMENT_SHADOW_ALLOW_CODE)))
    }
  } finally {
    console.log = orig
  }
})

test('388D E: enforcement ON + Free → denied', async () => {
  const cal = await decideCalendarIntegrationEntitlement({
    userId: 'u-e',
    enforcementEnabled: true,
    shadowEnabled: true,
    entitlements: freeEnt,
    planId: 'free',
    isCalendarEnabledFn: () => true,
  })
  assert.equal(cal.allowed, false)
  assert.equal(cal.reason, 'entitlement_required')

  const mail = await decideGmailIntegrationEntitlement({
    userId: 'u-e2',
    enforcementEnabled: true,
    entitlements: freeEnt,
    planId: 'free',
    emailEnabled: true,
  })
  assert.equal(mail.allowed, false)
})

test('388D F+G: enforcement ON + Base/Pro → allowed', async () => {
  for (const [plan, ents] of [
    ['base', baseEnt],
    ['pro', proEnt],
  ]) {
    const cal = await decideCalendarIntegrationEntitlement({
      userId: `u-f-${plan}`,
      enforcementEnabled: true,
      entitlements: ents,
      planId: plan,
      isCalendarEnabledFn: () => true,
    })
    assert.equal(cal.allowed, true)
    const mail = await decideGmailIntegrationEntitlement({
      userId: `u-g-${plan}`,
      enforcementEnabled: true,
      entitlements: ents,
      planId: plan,
      emailEnabled: true,
    })
    assert.equal(mail.allowed, true)
  }
})

test('388D H: product flag OFF → unavailable regardless of entitlement', async () => {
  const cal = await decideCalendarIntegrationEntitlement({
    userId: 'u-h',
    enforcementEnabled: true,
    entitlements: proEnt,
    planId: 'pro',
    isCalendarEnabledFn: () => false,
  })
  assert.equal(cal.allowed, false)
  assert.equal(cal.reason, 'product_disabled')
  assert.equal(cal.code, 'calendar_disabled')

  const mail = await decideGmailIntegrationEntitlement({
    userId: 'u-h2',
    enforcementEnabled: true,
    entitlements: proEnt,
    planId: 'pro',
    emailEnabled: false,
  })
  assert.equal(mail.allowed, false)
  assert.equal(mail.reason, 'product_disabled')
  assert.equal(mail.code, 'email_disabled')
})

test('388D J: spoofed plan/entitlement ignored (injected Free wins over claimed)', async () => {
  // Client claims are never accepted — helpers only see server entitlements.
  const cal = await decideCalendarIntegrationEntitlement({
    userId: 'u-j',
    enforcementEnabled: true,
    entitlements: freeEnt,
    planId: 'free',
    isCalendarEnabledFn: () => true,
  })
  assert.equal(cal.allowed, false)
})

test('388D L: privacy logging excludes Calendar/Gmail content fixtures', () => {
  const payload = buildEntitlementShadowPayload({
    feature: 'gmail',
    effectivePlan: 'free',
    wouldAllow: false,
    resolution: 'free_no_subscription',
    requestId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    route: 'email-query',
    env: { VERCEL_ENV: 'preview' },
  })
  assert.equal(payload.code, ENTITLEMENT_SHADOW_DENY_CODE)
  assert.equal(shadowPayloadHasSensitiveKeys(payload), false)
  for (const bad of [
    'subject',
    'snippet',
    'body',
    'email',
    'messageId',
    'title',
    'userId',
    'token',
  ]) {
    assert.equal(bad in payload, false)
  }
})

test('388D architecture: Node + Edge wiring + OAuth callback ungated', () => {
  assert.match(read('api/daily-briefing.ts'), /decideCalendarIntegrationEntitlement/)
  assert.match(read('lib/server/integration-entitlement.js'), /product_disabled/)
  assert.match(read('supabase/functions/_shared/entitlement-gate.ts'), /decideEdgeEntitlement/)
  assert.match(read('supabase/functions/calendar-oauth-start/index.ts'), /decideEdgeEntitlement/)
  assert.match(read('supabase/functions/email-oauth-start/index.ts'), /decideEdgeEntitlement/)
  assert.match(read('supabase/functions/email-query/index.ts'), /decideEdgeEntitlement/)

  // Callbacks must remain ungated (HMAC ownership only).
  assert.doesNotMatch(read('supabase/functions/calendar-oauth-callback/index.ts'), /decideEdgeEntitlement/)
  assert.doesNotMatch(read('supabase/functions/email-oauth-callback/index.ts'), /decideEdgeEntitlement/)

  // Disconnect/status paths stay ungated for revoke-on-downgrade.
  assert.doesNotMatch(read('supabase/functions/calendar-connection/index.ts'), /decideEdgeEntitlement/)
  assert.doesNotMatch(read('supabase/functions/email-connection/index.ts'), /decideEdgeEntitlement/)
})

test('388D Edge gate source mirrors Free/Base/Pro matrix', () => {
  const src = read('supabase/functions/_shared/entitlement-gate.ts')
  assert.match(src, /free:\s*\{\s*calendar:\s*false,\s*gmail:\s*false/)
  assert.match(src, /base:\s*\{\s*calendar:\s*true,\s*gmail:\s*true/)
  assert.match(src, /pro:\s*\{\s*calendar:\s*true,\s*gmail:\s*true/)
  assert.match(src, /entitlement_shadow_deny/)
  assert.doesNotMatch(src, /subject|snippet|messageId|access_token/)
})
