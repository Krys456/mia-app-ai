/**
 * #303C — Push notification Settings toggle contracts.
 * Run: node --experimental-strip-types --test src/lib/webPush.toggle.test.mjs
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import { pathToFileURL } from 'node:url'

const root = process.cwd()
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

const webPushSrc = read('src/lib/webPush.ts')
const notificationsSrc = read('src/components/NotificationsSettings.tsx')
const vercel = JSON.parse(read('vercel.json'))
const apiIndex = read('api/reminders/index.ts')

describe('#303C Settings notification toggle model', () => {
  it('maps permission + subscription to ON/OFF correctly', async () => {
    const mod = await import(pathToFileURL(path.join(root, 'src/lib/pushToggleModel.ts')).href)
    const { resolvePushToggleModel } = mod

    // granted + active subscription = ON
    assert.deepEqual(
      resolvePushToggleModel({
        support: 'supported',
        permission: 'granted',
        hasSubscription: true,
      }).visual,
      'on',
    )
    assert.equal(
      resolvePushToggleModel({
        support: 'supported',
        permission: 'granted',
        hasSubscription: true,
      }).statusLabel,
      'Attive',
    )

    // granted + no subscription = OFF
    const grantedUnsub = resolvePushToggleModel({
      support: 'supported',
      permission: 'granted',
      hasSubscription: false,
    })
    assert.equal(grantedUnsub.visual, 'off')
    assert.equal(grantedUnsub.statusLabel, 'Disattivate')
    assert.equal(grantedUnsub.canEnable, true)

    // default = OFF
    const def = resolvePushToggleModel({
      support: 'supported',
      permission: 'default',
      hasSubscription: false,
    })
    assert.equal(def.visual, 'off')
    assert.equal(def.canEnable, true)

    // denied = OFF
    const denied = resolvePushToggleModel({
      support: 'supported',
      permission: 'denied',
      hasSubscription: false,
    })
    assert.equal(denied.visual, 'off')
    assert.equal(denied.statusCode, 'permission_denied')
    assert.equal(denied.statusLabel, 'Permesso browser negato')
    assert.equal(denied.canEnable, false)

    // unsupported
    assert.equal(
      resolvePushToggleModel({
        support: 'unsupported',
        permission: 'default',
        hasSubscription: false,
      }).statusLabel,
      'Non supportate da questo browser',
    )

    // config disabled (VITE_PUSH_ENABLED / missing key gate)
    assert.equal(
      resolvePushToggleModel({
        support: 'disabled',
        permission: 'default',
        hasSubscription: false,
      }).statusLabel,
      'Disabilitate dalla configurazione',
    )
    assert.equal(
      resolvePushToggleModel({
        support: 'missing_vapid',
        permission: 'default',
        hasSubscription: false,
      }).statusLabel,
      'Disabilitate dalla configurazione',
    )
  })

  it('enable path requests permission only when default; disable uses push_unsubscribe', () => {
    assert.match(webPushSrc, /current === 'default'/)
    assert.match(webPushSrc, /Notification\.requestPermission/)
    assert.match(webPushSrc, /do not call requestPermission again|already "granted"/i)
    assert.match(webPushSrc, /action:\s*['"]push_unsubscribe['"]/)
    assert.match(webPushSrc, /action:\s*['"]push_subscribe['"]/)
    assert.match(webPushSrc, /Does not delete reminders|#303A next-open/)
    assert.match(webPushSrc, /Separate from the user's per-device notification toggle/)
  })

  it('Settings UI uses primary Notifiche ON/OFF switch from subscription state', () => {
    assert.match(notificationsSrc, /resolvePushToggleModel/)
    assert.match(notificationsSrc, /hasActiveLocalPushSubscription/)
    assert.match(notificationsSrc, />\s*OFF\s*</)
    assert.match(notificationsSrc, />\s*ON\s*</)
    assert.match(notificationsSrc, /setToggle\('on'\)/)
    assert.match(notificationsSrc, /setToggle\('off'\)/)
    assert.match(notificationsSrc, /enableWebPushFromUserGesture/)
    assert.match(notificationsSrc, /disableWebPush/)
    assert.match(notificationsSrc, /model\.statusLabel/)
  })

  it('keeps 8 Vercel functions and existing reminders subscription actions', () => {
    assert.equal(Object.keys(vercel.functions || {}).length, 8)
    assert.ok(!Object.keys(vercel.functions || {}).some((f) => f.includes('cron')))
    assert.match(apiIndex, /push_subscribe/)
    assert.match(apiIndex, /push_unsubscribe/)
  })
})

console.log('ok: #303C notification toggle contracts')
