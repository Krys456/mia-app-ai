/**
 * #334B — Personal Daily Briefing MVP contracts + follow-ups.
 * Run: node --test src/lib/daily-briefing/daily-briefing-334b.test.mjs
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { detectDailyBriefingIntent } from './intent.js'
import { composeDailyBriefing, greetingForDayPart, buildBriefingUi } from './render.js'
import { buildBriefingPriorities, dayPartInZone } from './priority.js'
import { createBriefingContext } from './active-context.js'
import { answerBriefingFollowUp } from './followups.js'

const root = process.cwd()
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

// Architecture freezes
assert.match(read('vercel.json'), /api\/daily-briefing\.ts/)
assert.equal(Object.keys(JSON.parse(read('vercel.json')).functions).length, 11)
assert.doesNotMatch(read('src/lib/daily-briefing/controller.js'), /openai|responses\.create|\/api\/chat/)
assert.doesNotMatch(read('src/lib/daily-briefing/render.js'), /openai|responses\.create/)
assert.doesNotMatch(read('src/lib/daily-briefing/followups.js'), /openai|responses\.create/)
assert.match(read('src/lib/daily-briefing/controller.js'), /modelCalls:\s*0/)

const NOW = new Date('2026-08-20T06:00:00.000Z') // 08:00 Rome summer

function sampleModel(overrides = {}) {
  return {
    status: 'ok',
    targetDate: '2026-08-20',
    timezone: 'Europe/Rome',
    calendar: {
      status: 'ok',
      items: [
        {
          id: '1',
          title: 'Dentist',
          start: '2026-08-20T08:30:00.000Z',
          end: '2026-08-20T09:30:00.000Z',
          allDay: false,
          status: 'confirmed',
        },
        {
          id: '2',
          title: 'Meeting',
          start: '2026-08-20T13:00:00.000Z',
          end: '2026-08-20T14:00:00.000Z',
          allDay: false,
          status: 'confirmed',
        },
      ],
    },
    reminders: {
      status: 'ok',
      overdue: [
        {
          id: 'o1',
          title: 'Pay invoice',
          fireAt: '2026-08-20T05:00:00.000Z',
          timezone: 'Europe/Rome',
          overdue: true,
        },
      ],
      today: [
        {
          id: 'r1',
          title: 'Call Luca',
          fireAt: '2026-08-20T15:00:00.000Z',
          timezone: 'Europe/Rome',
          overdue: false,
        },
      ],
    },
    weather: {
      status: 'ok',
      snapshot: {
        locationLabel: 'Milano',
        temperatureMinC: 12,
        temperatureMaxC: 19,
        temperatureC: 15,
        umbrellaRecommended: true,
        rainLikely: true,
      },
    },
    ...overrides,
  }
}

// --- Triggers ---
assert.equal(detectDailyBriefingIntent('Briefing').intent, 'daily-briefing')
assert.equal(detectDailyBriefingIntent('Fammi il briefing di oggi').intent, 'daily-briefing')
assert.equal(detectDailyBriefingIntent('Come sarà la mia giornata?').intent, 'daily-briefing')
assert.equal(detectDailyBriefingIntent('Buongiorno').intent, 'none')
assert.equal(detectDailyBriefingIntent('Cosa ho oggi?').intent, 'none')

// --- Daypart greeting ---
assert.equal(greetingForDayPart('it', 'morning'), 'Buongiorno.')
assert.equal(greetingForDayPart('it', 'afternoon'), 'Buon pomeriggio.')
assert.equal(greetingForDayPart('it', 'evening'), 'Buonasera.')
assert.equal(greetingForDayPart('en', 'morning'), 'Good morning.')
assert.equal(dayPartInZone('Europe/Rome', new Date('2026-08-20T07:00:00.000Z')), 'morning')
assert.equal(dayPartInZone('Europe/Rome', new Date('2026-08-20T13:00:00.000Z')), 'afternoon')

// --- Priority: overdue before events ---
{
  const pri = buildBriefingPriorities(sampleModel(), { now: NOW })
  assert.equal(pri[0].kind, 'overdue_reminder')
  assert.ok(pri.some((p) => p.kind === 'next_event'))
  assert.ok(pri.some((p) => p.kind === 'weather'))
}

// --- Compose full ---
{
  const { text, presentationItems } = composeDailyBriefing(sampleModel(), 'it', { now: NOW })
  assert.match(text, /Buongiorno|Buon pomeriggio/)
  assert.match(text, /Pay invoice|scadut/)
  assert.match(text, /Dentist/)
  assert.match(text, /Meeting|Oggi/)
  assert.match(text, /Call Luca/)
  assert.match(text, /ombrello|Milano/)
  assert.ok(presentationItems.length >= 3)
  assert.equal(presentationItems[0].ordinal, 1)
}

// --- Partial calendar unavailable ---
{
  const { text } = composeDailyBriefing(
    sampleModel({
      status: 'partial_success',
      calendar: { status: 'disconnected', items: [] },
    }),
    'it',
    { now: NOW },
  )
  assert.match(text, /Call Luca|Pay invoice/)
  assert.doesNotMatch(text, /Dentist/)
  assert.doesNotMatch(text, /connetti il calendario/i)
}

// --- Empty quiet day ---
{
  const { text } = composeDailyBriefing(
    {
      status: 'ok',
      timezone: 'Europe/Rome',
      calendar: { status: 'empty', items: [] },
      reminders: { status: 'empty', overdue: [], today: [] },
      weather: { status: 'location_required' },
    },
    'it',
    { now: NOW },
  )
  assert.match(text, /libera|informazioni collegate|città/i)
  assert.doesNotMatch(text, /Dentist|Meeting/)
}

// --- Nothing usable ---
{
  const { text } = composeDailyBriefing(
    {
      status: 'error',
      timezone: 'Europe/Rome',
      calendar: { status: 'error', items: [] },
      reminders: { status: 'unavailable', overdue: [], today: [] },
      weather: { status: 'unavailable' },
    },
    'it',
    { now: NOW },
  )
  assert.match(text, /abbastanza informazioni|briefing/i)
}

// --- UI chips Kami ---
{
  const ui = buildBriefingUi(sampleModel(), 'it')
  assert.equal(ui.kind, 'summary')
  assert.ok(ui.chips.some((c) => c.id === 'calendar'))
  assert.ok(ui.chips.some((c) => c.id === 'reminders'))
  const css = read('src/components/chat/DailyBriefingUi.css')
  assert.match(css, /the-way-washi/)
  assert.match(css, /the-way-sumi/)
  assert.doesNotMatch(css, /glow|neon/i)
}

// --- Follow-ups ---
{
  const composed = composeDailyBriefing(sampleModel(), 'it', { now: NOW })
  const ctx = createBriefingContext({
    targetDate: '2026-08-20',
    timezone: 'Europe/Rome',
    language: 'it',
    calendarItems: sampleModel().calendar.items,
    reminderItems: [
      ...sampleModel().reminders.overdue.map((r) => ({ ...r, overdue: true })),
      ...sampleModel().reminders.today,
    ],
    weatherSnapshot: sampleModel().weather.snapshot,
    presentationItems: composed.presentationItems,
    priorities: composed.priorities,
    displayText: composed.text,
    focusIndex: -1,
  })

  const secondo = answerBriefingFollowUp(
    { followUpKind: 'ordinal', ordinal: 2 },
    ctx,
    'it',
    { now: NOW },
  )
  assert.equal(secondo.handled, true)
  assert.match(secondo.reply, /\S/)
  assert.ok(typeof secondo.briefingContext.focusIndex === 'number')

  const ambiguous = answerBriefingFollowUp(
    { followUpKind: 'ordinal', ordinal: 9 },
    ctx,
    'it',
    { now: NOW },
  )
  assert.match(ambiguous.reply, /non c’è un punto|punto 9/i)

  const next = answerBriefingFollowUp({ followUpKind: 'prossimo' }, ctx, 'it', { now: NOW })
  assert.match(next.reply, /Dentist|Prossimo/i)

  const after = answerBriefingFollowUp(
    { followUpKind: 'e_dopo' },
    next.briefingContext,
    'it',
    { now: NOW },
  )
  assert.match(after.reply, /Meeting|Dopo|Call Luca|altro/i)

  const before = answerBriefingFollowUp(
    { followUpKind: 'before_time', beforeHour: 14 },
    ctx,
    'it',
    { now: NOW },
  )
  assert.match(before.reply, /prima delle 14/i)
  assert.match(before.reply, /Dentist/)
  assert.doesNotMatch(before.reply, /Call Luca/)

  const overdue = answerBriefingFollowUp({ followUpKind: 'overdue' }, ctx, 'it', { now: NOW })
  assert.match(overdue.reply, /Pay invoice/)

  const umbrella = answerBriefingFollowUp({ followUpKind: 'umbrella' }, ctx, 'it', { now: NOW })
  assert.match(umbrella.reply, /ombrello|Sì/i)
}

// Intent matrix follow-ups
assert.equal(
  detectDailyBriefingIntent('Il secondo?', { hasBriefingContext: true }).ordinal,
  2,
)
assert.equal(
  detectDailyBriefingIntent('E dopo?', { hasBriefingContext: true }).followUpKind,
  'e_dopo',
)
assert.equal(
  detectDailyBriefingIntent('Ho qualcosa di scaduto?', { hasBriefingContext: true }).followUpKind,
  'overdue',
)
assert.equal(
  detectDailyBriefingIntent('Che tempo farà?', { hasBriefingContext: true }).followUpKind,
  'weather',
)
assert.equal(
  detectDailyBriefingIntent('Mi serve l\'ombrello?', { hasBriefingContext: true }).followUpKind,
  'umbrella',
)

console.log('daily-briefing-334b.test.mjs: ok')
