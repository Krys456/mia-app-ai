/**
 * #303C — Web Push contracts.
 * Run: node --experimental-strip-types --test lib/server/reminders-303c.test.mjs
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import { pathToFileURL } from 'node:url'

const root = process.cwd()
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

const migration = read('supabase/migrations/20260818120000_reminders_push_303c.sql')
const readme = read('supabase/migrations/README-303C-PUSH.md')
const migration303b = read('supabase/migrations/20260818100000_reminders_scheduler_303b.sql')
const apiIndex = read('api/reminders/index.ts')
const pushSubs = read('lib/server/push-subscriptions.js')
const protocol = read('lib/server/reminder-push-protocol.js')
const scheduler = read('lib/server/reminder-scheduler.js')
const remindersJs = read('lib/server/reminders.js')
const edge = read('supabase/functions/reminder-push-dispatch/index.ts')
const sw = read('public/sw.js')
const manifest = read('public/manifest.webmanifest')
const indexHtml = read('index.html')
const webPushClient = read('src/lib/webPush.ts')
const privacyCopy = read('src/lib/privacyCopy.ts')
const settings = read('src/components/SettingsDrawer.tsx')
const notificationsSettings = read('src/components/NotificationsSettings.tsx')
const optIn = read('src/components/PushOptInPrompt.tsx')
const vercel = JSON.parse(read('vercel.json'))
const vercelignore = read('.vercelignore')
const envExample = read('.env.example')
const chatApi = read('api/chat.ts')
const coreParams = read('lib/server/core-responses-params.js')
const rateLimit = read('lib/server/rate-limit.js')

const deployed = Object.keys(vercel.functions || {})

describe('#303C migration + RLS', () => {
  it('creates push_subscriptions with RLS and zero policies', () => {
    assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.push_subscriptions/)
    assert.match(migration, /endpoint TEXT NOT NULL/)
    assert.match(migration, /p256dh TEXT NOT NULL/)
    assert.match(migration, /auth TEXT NOT NULL/)
    assert.match(migration, /UNIQUE \(endpoint\)/)
    assert.match(migration, /ALTER TABLE public\.push_subscriptions ENABLE ROW LEVEL SECURITY/)
    assert.match(migration, /Intentionally NO CREATE POLICY/)
    assert.doesNotMatch(migration, /^\s*CREATE POLICY/m)
    assert.match(migration, /ADD COLUMN IF NOT EXISTS push_sent_at TIMESTAMPTZ NULL/)
    assert.doesNotMatch(migration, /ALTER COLUMN delivered_at|delivered_at\s+TIMESTAMPTZ/)
    assert.doesNotMatch(migration, /SELECT\s+cron\.schedule|PERFORM\s+cron\.schedule/i)
    assert.doesNotMatch(migration, /SET\s+enabled\s*=\s*true/i)
  })

  it('updates claim_due_reminders to exclude push_sent_at', () => {
    assert.match(migration, /AND r\.push_sent_at IS NULL/)
    assert.match(migration, /CREATE OR REPLACE FUNCTION public\.claim_due_reminders/)
    assert.match(migration303b, /enabled BOOLEAN NOT NULL DEFAULT false/)
  })
})

describe('#303C subscription API on existing reminders function', () => {
  it('uses action discriminator without new Vercel function', () => {
    assert.match(apiIndex, /push_subscribe/)
    assert.match(apiIndex, /push_unsubscribe/)
    assert.match(apiIndex, /user_id: _ignoredUserId/)
    assert.match(apiIndex, /['"]push_subscriptions['"]/)
    assert.match(rateLimit, /push_subscriptions:\s*\{\s*requests:\s*10/)
    // Deployed count grew after #303C (weather/briefing/subscription); push still shares reminders API.
    assert.equal(deployed.length, 11)
    assert.ok(!deployed.some((f) => f.includes('cron')))
    assert.ok(!deployed.includes('api/push.ts'))
    assert.match(vercelignore, /api\/memory-test\.ts/)
    assert.equal(fs.existsSync(path.join(root, 'api/cron')), false)
  })

  it('validates subscribe input and ignores spoofed user_id', async () => {
    const mod = await import(pathToFileURL(path.join(root, 'lib/server/push-subscriptions.js')).href)
    const bad = mod.validatePushSubscribeInput({
      endpoint: 'http://insecure.example/x',
      keys: { p256dh: 'a', auth: 'b' },
      user_id: 'attacker',
    })
    assert.equal(bad.ok, false)

    const ok = mod.validatePushSubscribeInput({
      endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
      keys: { p256dh: 'p256', auth: 'authk' },
      user_id: 'attacker-ignored-by-validator',
    })
    assert.equal(ok.ok, true)
    assert.equal(ok.data.endpoint.startsWith('https://'), true)
  })
})

describe('#303C push protocol + push_sent_at', () => {
  it('classifies failures and builds safe payloads', async () => {
    const mod = await import(
      pathToFileURL(path.join(root, 'lib/server/reminder-push-protocol.js')).href
    )
    assert.equal(mod.classifyPushSendResult(410).disableSubscription, true)
    assert.equal(mod.classifyPushSendResult(401).retryable, false)
    assert.equal(mod.classifyPushSendResult(429).retryable, true)
    assert.equal(mod.classifyPushSendResult(503).retryable, true)
    assert.equal(mod.classifyPushSendResult(201).code, 'push_accepted')

    const payload = mod.buildReminderPushPayload({
      reminderId: '11111111-1111-1111-1111-111111111111',
      title: 'Preparare i documenti',
    })
    assert.equal(payload.tag, payload.reminderId)
    assert.equal(payload.body, '')
    assert.match(payload.url, /^\//)

    const swOk = mod.validateServiceWorkerPushPayload(payload)
    assert.equal(swOk.ok, true)
    const swBad = mod.validateServiceWorkerPushPayload({
      reminderId: 'x',
      url: 'https://evil.example',
    })
    assert.equal(swBad.ok, false)

    assert.equal(mod.isEligibleForPushClaimBySentAt({ push_sent_at: null }), true)
    assert.equal(mod.isEligibleForPushClaimBySentAt({ push_sent_at: '2026-01-01T00:00:00Z' }), false)
  })

  it('scheduler eligibility excludes push_sent_at and clears on reschedule', async () => {
    const mod = await import(pathToFileURL(path.join(root, 'lib/server/reminder-scheduler.js')).href)
    const now = new Date('2026-08-18T12:00:00.000Z')
    assert.equal(
      mod.isEligibleForSchedulerClaim(
        {
          status: 'pending',
          fire_at: '2026-08-18T11:00:00.000Z',
          push_sent_at: '2026-08-18T11:01:00.000Z',
        },
        now,
      ),
      false,
    )
    assert.match(remindersJs, /push_sent_at = null/)
    assert.match(remindersJs, /patch\.status === 'snoozed'|patch\.fire_at/)
  })
})

describe('#303C Edge worker contracts', () => {
  it('authenticates, fail-closes, is not a push relay, uses negrel webpush', () => {
    assert.match(edge, /REMINDER_PUSH_WORKER_SECRET/)
    assert.match(edge, /PUSH_ENABLED/)
    assert.match(edge, /claim_due_reminders/)
    assert.match(edge, /release_reminder_claim/)
    assert.match(edge, /push_sent_at/)
    assert.match(edge, /worker_not_a_push_relay/)
    assert.match(edge, /jsr:@negrel\/webpush/)
    assert.doesNotMatch(edge, /from ['"]openai['"]|responses\.create/)
    assert.match(edge, /Never calls OpenAI/)
    assert.match(edge, /manual_smoke/)
    assert.match(edge, /reminder_scheduler_config/)
    assert.match(edge, /subscriptionId/)
    assert.doesNotMatch(edge, /console\.(log|info|warn)\([^)]*\bendpoint\b/)
  })
})

describe('#303C client SW + UX', () => {
  it('minimal SW handles push + same-origin click; no Workbox cache', () => {
    assert.match(sw, /addEventListener\('push'/)
    assert.match(sw, /addEventListener\('notificationclick'/)
    assert.match(sw, /showNotification\('ShinkAIdo'/)
    assert.match(sw, /clients\.openWindow|client\.focus/)
    assert.doesNotMatch(sw, /workbox\.precaching|precacheAndRoute|caches\.open\(/i)
    assert.match(sw, /No Workbox/)
    assert.match(manifest, /"name": "ShinkAIdo"/)
    assert.match(indexHtml, /manifest\.webmanifest/)
    assert.match(webPushClient, /userVisibleOnly:\s*true/)
    assert.match(webPushClient, /requestPermission/)
    assert.match(optIn, /Attiva notifiche/)
    assert.match(optIn, /Non ora/)
    assert.match(notificationsSettings, /resolvePushToggleModel|Notifiche/)
    assert.match(settings, /NotificationsSettings/)
    assert.match(privacyCopy, /pushNotifications:/)
    assert.match(envExample, /VITE_VAPID_PUBLIC_KEY/)
    assert.match(envExample, /VAPID_KEYS_JSON/)
    assert.match(readme, /1 minute|\* \* \* \* \*/)
    assert.match(readme, /reminder-push-dispatch/)
  })

  it('permission prompt only inside explicit enable helper', () => {
    assert.match(webPushClient, /export async function enableWebPushFromUserGesture/)
    assert.match(webPushClient, /Notification\.requestPermission/)
    assert.doesNotMatch(optIn, /Notification\.requestPermission/)
    assert.match(optIn, /enableWebPushFromUserGesture/)
  })
})

describe('#303C protected contracts', () => {
  it('keeps Core / no extra push Vercel function / no OpenAI on push path', () => {
    assert.ok((chatApi.match(/\.responses\.create\(/g) || []).length >= 1)
    assert.match(chatApi, /maxDuration:\s*120/)
    assert.match(coreParams, /stream:\s*false/)
    assert.match(coreParams, /effort:\s*['"]none['"]/)
    assert.doesNotMatch(protocol, /from ['"]openai['"]|responses\.create/)
    assert.match(protocol, /No OpenAI/)
    assert.doesNotMatch(pushSubs, /from ['"]openai['"]|responses\.create/)
    assert.equal(deployed.length, 11)
    assert.ok(!deployed.includes('api/push.ts'))
  })
})

describe('#303C listDue ignores push_sent_at (next-open)', () => {
  it('due query does not filter push_sent_at', () => {
    const dueFn = remindersJs.slice(
      remindersJs.indexOf('export async function listDueReminders'),
      remindersJs.indexOf('export async function getReminderById'),
    )
    assert.doesNotMatch(dueFn, /\.(eq|lte|is)\(\s*['"]push_sent_at['"]/)
    assert.match(dueFn, /Do not filter on claim_owner/)
  })
})

console.log('ok: #303C web push contracts')
