/**
 * #303A — Reminder foundation contracts (static + unit).
 * Run: node --test lib/server/reminders-303a.test.mjs
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import { pathToFileURL } from 'node:url'

const root = process.cwd()
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

const migration = read('supabase/migrations/20260818053000_reminders_303a.sql')
const rateLimit = read('lib/server/rate-limit.js')
const remindersJs = read('lib/server/reminders.js')
const apiIndex = read('api/reminders/index.ts')
const apiId = read('api/reminders/[id].ts')
const vercel = read('vercel.json')
const appTsx = read('src/App.tsx')
const privacyCopy = read('src/lib/privacyCopy.ts')
const privacyPage = read('src/pages/PrivacyData.tsx')
const settings = read('src/components/SettingsDrawer.tsx')
const dueHost = read('src/components/DueReminderHost.tsx')
const reminderTypes = read('src/lib/reminderTypes.ts')
const reminderApi = read('src/lib/reminderApi.ts')
const chatApi = read('api/chat.ts')
const coreParams = read('lib/server/core-responses-params.js')
const envExample = read('.env.example')

describe('#303A reminders foundation', () => {
  it('migration creates reminders with RLS enable and no policies', () => {
    assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.reminders/)
    assert.match(migration, /fire_at TIMESTAMPTZ NOT NULL/)
    assert.match(migration, /timezone TEXT NOT NULL/)
    assert.match(migration, /ALTER TABLE public\.reminders ENABLE ROW LEVEL SECURITY/)
    assert.doesNotMatch(migration, /^\s*CREATE POLICY/m)
    assert.match(migration, /Intentionally NO CREATE POLICY/)
    assert.match(migration, /reminders_user_fire_at_idx/)
    assert.match(migration, /reminders_user_status_fire_at_idx/)
    assert.doesNotMatch(migration, /RRULE|recurrence_rule/)
  })

  it('API routes use JWT auth, ignore body user_id, rate-limit reminders bucket', () => {
    assert.match(apiIndex, /requireMemoryApiUser/)
    assert.match(apiIndex, /bucket:\s*['"]reminders['"]/)
    assert.match(apiIndex, /user_id:\s*_ignoredUserId/)
    assert.match(apiId, /requireMemoryApiUser/)
    assert.match(apiId, /bucket:\s*['"]reminders['"]/)
    assert.match(vercel, /api\/reminders\/index\.ts/)
    assert.match(vercel, /api\/reminders\/\[id\]\.ts/)
    assert.match(rateLimit, /reminders:\s*\{\s*requests:\s*40/)
  })

  it('server CRUD is owner-scoped and does not log title/body', () => {
    assert.match(remindersJs, /requireExplicitUserId/)
    assert.match(remindersJs, /\.eq\('user_id',\s*userId\)/)
    assert.doesNotMatch(remindersJs, /console\.(log|info|warn|error)\([^)]*title/)
    assert.doesNotMatch(remindersJs, /console\.(log|info|warn|error)\([^)]*body/)
    assert.match(apiIndex, /safeErrorSnippet/)
    assert.match(apiIndex, /SAFE_REMINDER_ERROR|Impossibile gestire i promemoria/)
  })

  it('proposal type exists and confirm path is explicit', () => {
    assert.match(reminderTypes, /export interface ReminderProposal/)
    assert.match(reminderTypes, /NEVER persisted|never persisted/i)
    assert.match(reminderApi, /createReminderFromProposal/)
    assert.match(reminderApi, /buildManualReminderProposal/)
  })

  it('UI surfaces + in-app delivery without push/cron/openai', () => {
    assert.match(appTsx, /ReminderManage/)
    assert.match(appTsx, /DueReminderHost/)
    assert.match(settings, /Gestisci promemoria/)
    assert.match(dueHost, /listDueReminders|pollDueRemindersAfterAuth/)
    assert.match(dueHost, /markReminderDelivered/)
    assert.match(dueHost, /useAuthBootstrap/)
    assert.match(reminderApi, /resolveChatAuthForRequest/)
    assert.doesNotMatch(dueHost, /Notification\.requestPermission|serviceWorker\.register|web-push|getUserMedia/)
    assert.doesNotMatch(apiIndex, /openai|responses\.create|OpenAI/i)
    assert.doesNotMatch(remindersJs, /openai|responses\.create/i)
  })

  it('privacy + feature flags documented', () => {
    assert.match(privacyCopy, /reminders:/)
    assert.match(privacyCopy, /promemoria|notifiche push/i)
    assert.match(privacyPage, /privacy-reminders-title|Promemoria/)
    assert.match(envExample, /VITE_REMINDERS_ENABLED/)
    assert.match(envExample, /REMINDERS_ENABLED/)
  })

  it('does not touch Core invariants', () => {
    assert.equal((chatApi.match(/\.responses\.create\(/g) || []).length, 1)
    assert.match(chatApi, /maxDuration:\s*120/)
    assert.match(coreParams, /stream:\s*false/)
    assert.match(coreParams, /effort:\s*['"]none['"]/)
    assert.doesNotMatch(chatApi, /from ['"].*reminders/)
  })
})

describe('#303A reminder validation units', () => {
  it('rejects past fire_at and invalid timezone; accepts valid create', async () => {
    const mod = await import(pathToFileURL(path.join(root, 'lib/server/reminders.js')).href)
    const now = new Date('2026-08-18T12:00:00.000Z')
    const past = mod.validateReminderCreateInput(
      {
        title: 'Chiamare Marco',
        fire_at: '2026-08-18T10:00:00.000Z',
        timezone: 'Europe/Rome',
      },
      now,
    )
    assert.equal(past.ok, false)
    assert.equal(past.errors.fire_at, 'reminder_in_past')

    const badTz = mod.validateReminderCreateInput(
      {
        title: 'Test',
        fire_at: '2026-08-19T15:00:00.000Z',
        timezone: 'Not/AZone',
      },
      now,
    )
    assert.equal(badTz.ok, false)

    const ok = mod.validateReminderCreateInput(
      {
        title: 'Chiamare Marco',
        fire_at: '2026-08-19T15:00:00.000Z',
        timezone: 'Europe/Rome',
        user_id: 'attacker-should-be-ignored',
      },
      now,
    )
    assert.equal(ok.ok, true)
    assert.equal(ok.data.title, 'Chiamare Marco')
    assert.equal(ok.data.timezone, 'Europe/Rome')
  })

  it('status transitions and feature gate', async () => {
    const limits = await import(
      pathToFileURL(path.join(root, 'lib/server/reminder-field-limits.js')).href
    )
    assert.equal(limits.canTransitionReminderStatus('pending', 'delivered'), true)
    assert.equal(limits.canTransitionReminderStatus('pending', 'cancelled'), true)
    assert.equal(limits.canTransitionReminderStatus('cancelled', 'pending'), false)
    assert.equal(limits.canTransitionReminderStatus('delivered', 'completed'), true)

    const gate = await import(
      pathToFileURL(path.join(root, 'lib/server/reminders-enabled.js')).href
    )
    assert.equal(gate.isRemindersEnabled({}), true)
    assert.equal(gate.isRemindersEnabled({ REMINDERS_ENABLED: '0' }), false)
  })

  it('client manual proposal does not invent persistence helpers incorrectly', async () => {
    // Dynamic import of TS via strip-types is awkward; assert source contracts instead.
    assert.match(reminderApi, /buildManualReminderProposal/)
    assert.match(reminderApi, /zonedLocalToUtcIso/)
    assert.match(reminderApi, /già passate/)
  })
})

console.log('ok: #303A reminders foundation contracts')
