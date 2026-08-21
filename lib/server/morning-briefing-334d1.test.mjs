/**
 * #334D1 — Morning briefing schedule / due-window / push protocol tests.
 * Run: node --test lib/server/morning-briefing-334d1.test.mjs
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  isMorningBriefingDue,
  normalizeDaysOfWeek,
  normalizeLocalTimeHhMm,
  validateMorningBriefingScheduleInput,
  localWallClockParts,
  MORNING_BRIEFING_DEFAULT_DAYS,
} from './morning-briefing-schedule.js'
import {
  buildMorningBriefingPushPayload,
  buildReminderPushPayload,
  validateServiceWorkerPushPayload,
} from './reminder-push-protocol.js'
import { isValidIanaTimeZone } from './reminder-time.js'

const root = process.cwd()
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

// Function budget freeze
assert.equal(Object.keys(JSON.parse(read('vercel.json')).functions).length, 11)
assert.doesNotMatch(read('vercel.json'), /"crons"/)
assert.ok(fs.existsSync('supabase/functions/morning-briefing-dispatch/index.ts'))
assert.ok(fs.existsSync('supabase/migrations/20260821120000_morning_briefing_334d1.sql'))
assert.match(read('supabase/config.toml'), /morning-briefing-dispatch/)
assert.doesNotMatch(read('api/daily-briefing.ts'), /openai|responses\.create/)
assert.doesNotMatch(read('supabase/functions/morning-briefing-dispatch/index.ts'), /openai/)
assert.match(read('api/daily-briefing.ts'), /morning_schedule_upsert/)
assert.doesNotMatch(read('supabase/functions/morning-briefing-dispatch/index.ts'), /claim_due_reminders/)

// Validation
assert.equal(normalizeLocalTimeHhMm('8:00'), '08:00')
assert.equal(normalizeLocalTimeHhMm('08:00'), '08:00')
assert.equal(normalizeLocalTimeHhMm('24:00'), null)
assert.equal(normalizeLocalTimeHhMm('abc'), null)
assert.deepEqual(normalizeDaysOfWeek([1, 2, 5]), [1, 2, 5])
assert.equal(normalizeDaysOfWeek([0, 1]), null)
assert.equal(normalizeDaysOfWeek([]), null)
assert.equal(isValidIanaTimeZone('Europe/Rome'), true)
assert.equal(isValidIanaTimeZone('Not/AZone'), false)

{
  const ok = validateMorningBriefingScheduleInput({
    enabled: true,
    localTime: '07:30',
    daysOfWeek: [1, 2, 3, 4, 5],
    timezone: 'Europe/Rome',
  })
  assert.equal(ok.ok, true)
  assert.equal(ok.data.localTime, '07:30')
}

{
  const bad = validateMorningBriefingScheduleInput({
    enabled: true,
    localTime: '25:00',
    daysOfWeek: [1],
    timezone: 'Europe/Rome',
  })
  assert.equal(bad.ok, false)
  assert.ok(bad.errors.localTime)
}

{
  const badTz = validateMorningBriefingScheduleInput({
    enabled: true,
    localTime: '08:00',
    daysOfWeek: MORNING_BRIEFING_DEFAULT_DAYS,
    timezone: 'Invalid/Zone',
  })
  assert.equal(badTz.ok, false)
}

// Due window — construct a fixed instant: 2026-08-21 is Friday (ISO 5)
{
  // 08:05 Europe/Rome summer = 06:05 UTC
  const now = new Date('2026-08-21T06:05:00.000Z')
  const due = isMorningBriefingDue(
    {
      enabled: true,
      localTime: '08:00',
      daysOfWeek: [1, 2, 3, 4, 5],
      timezone: 'Europe/Rome',
      lastDeliveredLocalDate: null,
    },
    { now, windowMinutes: 10 },
  )
  assert.equal(due.due, true, JSON.stringify(due))
  assert.equal(due.localDate, '2026-08-21')
}

{
  const now = new Date('2026-08-21T06:05:00.000Z')
  const notDue = isMorningBriefingDue(
    {
      enabled: true,
      localTime: '08:00',
      daysOfWeek: [1, 2, 3, 4, 5],
      timezone: 'Europe/Rome',
      lastDeliveredLocalDate: '2026-08-21',
    },
    { now },
  )
  assert.equal(notDue.due, false)
  assert.equal(notDue.reason, 'already_delivered')
}

{
  const now = new Date('2026-08-21T06:05:00.000Z')
  const weekend = isMorningBriefingDue(
    {
      enabled: true,
      localTime: '08:00',
      daysOfWeek: [6, 7],
      timezone: 'Europe/Rome',
    },
    { now },
  )
  assert.equal(weekend.due, false)
  assert.equal(weekend.reason, 'wrong_weekday')
}

{
  const now = new Date('2026-08-21T05:30:00.000Z') // 07:30 Rome — before 08:00
  const early = isMorningBriefingDue(
    {
      enabled: true,
      localTime: '08:00',
      daysOfWeek: [5],
      timezone: 'Europe/Rome',
    },
    { now },
  )
  assert.equal(early.due, false)
  assert.equal(early.reason, 'before_window')
}

{
  const wall = localWallClockParts('Europe/Rome', new Date('2026-08-21T06:00:00.000Z'))
  assert.equal(wall.hhmm, '08:00')
  assert.equal(wall.isoWeekday, 5)
}

// Push protocol
{
  const rem = buildReminderPushPayload({ reminderId: 'r1', title: 'Pay' })
  assert.equal(rem.type, 'reminder')
  const remV = validateServiceWorkerPushPayload(rem)
  assert.equal(remV.ok, true)
  assert.equal(remV.data.type, 'reminder')

  // Legacy without type still works
  const legacy = validateServiceWorkerPushPayload({
    reminderId: 'r2',
    title: 'Call',
    url: '/?reminder=r2',
  })
  assert.equal(legacy.ok, true)
}

{
  const morning = buildMorningBriefingPushPayload({ localDate: '2026-08-21' })
  assert.equal(morning.type, 'morning_briefing')
  assert.match(morning.body, /pronto|ready/i)
  assert.equal(morning.url, '/?briefing=morning')
  assert.doesNotMatch(morning.body, /impegno|promemoria|°C|Milano/i)
  const v = validateServiceWorkerPushPayload(morning)
  assert.equal(v.ok, true)
  assert.equal(v.data.type, 'morning_briefing')
}

{
  const bad = validateServiceWorkerPushPayload({
    type: 'morning_briefing',
    url: 'https://evil.example/',
  })
  assert.equal(bad.ok, false)
}

{
  const bad = validateServiceWorkerPushPayload({
    type: 'morning_briefing',
    url: '/?briefing=morning&user=abc',
  })
  assert.equal(bad.ok, false)
}

// SW source contracts
{
  const sw = read('public/sw.js')
  assert.match(sw, /morning_briefing/)
  assert.match(sw, /briefing=morning/)
  assert.match(sw, /reminderId/)
  assert.match(sw, /postMessage/)
  assert.match(sw, /deliverMorningIntent/)
}

// Deep-link / settings presence
assert.match(read('src/components/SettingsDrawer.tsx'), /MorningBriefingSettings/)
assert.match(read('src/App.tsx'), /MorningBriefingDeepLinkHost/)
assert.match(read('src/components/MorningBriefingDeepLinkHost.tsx'), /sendMessage\('Briefing'\)/)
assert.doesNotMatch(read('src/components/MorningBriefingDeepLinkHost.tsx'), /requestChatCompletion|\/api\/chat\.ts/)

// Reminder semantics untouched in schedule module
assert.doesNotMatch(read('lib/server/morning-briefing-schedule.js'), /claim_due_reminders|push_sent_at/)

console.log('morning-briefing-334d1.test.mjs: ok')
