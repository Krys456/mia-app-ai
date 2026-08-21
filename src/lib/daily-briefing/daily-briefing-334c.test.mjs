/**
 * #334C — Briefing Intelligence contracts.
 * Run: node --test src/lib/daily-briefing/daily-briefing-334c.test.mjs
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { detectDailyBriefingIntent, detectBriefingFollowUp } from './intent.js'
import { composeDailyBriefing } from './render.js'
import { buildBriefingPriorities } from './priority.js'
import { createBriefingContext } from './active-context.js'
import { answerBriefingFollowUp } from './followups.js'
import { analyzeSchedule } from './schedule.js'
import {
  normalizeBriefingSettings,
  sanitizeBriefingCity,
  detectBriefingPreferenceIntent,
  preferenceAck,
  applyBriefingPresentationPrefs,
} from './preferences.js'

const root = process.cwd()
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

// Architecture freezes
assert.equal(Object.keys(JSON.parse(read('vercel.json')).functions).length, 11)
assert.doesNotMatch(read('src/lib/daily-briefing/controller.js'), /openai|responses\.create|\/api\/chat/)
assert.doesNotMatch(read('src/lib/daily-briefing/preferences.js'), /openai|\/api\/chat/)
assert.doesNotMatch(read('src/lib/daily-briefing/schedule.js'), /openai|\/api\/chat/)
assert.match(read('src/lib/daily-briefing/controller.js'), /modelCalls:\s*0/)
assert.match(read('src/components/SettingsDrawer.tsx'), /Briefing quotidiano/)
assert.match(read('src/types.ts'), /DailyBriefingSettings/)
assert.doesNotMatch(read('src/lib/daily-briefing/preferences.js'), /supabase|from\(['"]memories/)

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
        umbrellaRecommended: true,
        rainLikely: true,
      },
    },
    ...overrides,
  }
}

// --- PREFERENCES ---
{
  const d = normalizeBriefingSettings(undefined)
  assert.equal(d.length, 'balanced')
  assert.equal(d.weatherEnabled, true)
  assert.equal(d.preferredWeatherCity, null)
}

{
  const c = normalizeBriefingSettings({ length: 'concise' })
  assert.equal(c.length, 'concise')
  const det = normalizeBriefingSettings({ length: 'detailed' })
  assert.equal(det.length, 'detailed')
}

{
  const off = normalizeBriefingSettings({ weatherEnabled: false })
  assert.equal(off.weatherEnabled, false)
  const model = applyBriefingPresentationPrefs(sampleModel(), off)
  assert.equal(model.weather.hiddenByPref, true)
  assert.notEqual(model.weather.status, 'ok')
}

{
  assert.equal(sanitizeBriefingCity('Milano'), 'Milano')
  assert.equal(sanitizeBriefingCity('  Roma  '), 'Roma')
  assert.equal(sanitizeBriefingCity(''), null)
  assert.equal(sanitizeBriefingCity('12.34'), null)
  const withCity = normalizeBriefingSettings({ preferredWeatherCity: 'Milano' })
  assert.equal(withCity.preferredWeatherCity, 'Milano')
  const cleared = normalizeBriefingSettings({ preferredWeatherCity: null })
  assert.equal(cleared.preferredWeatherCity, null)
}

// Weather city priority documented in weather-source (request > context > preferred)
{
  const src = read('src/lib/daily-briefing/weather-source.js')
  assert.match(src, /citySource: 'request'/)
  assert.match(src, /citySource: 'active_context'/)
  assert.match(src, /citySource: 'preferred'/)
  assert.match(src, /location_required/)
}

// Length modes
{
  const model = sampleModel()
  const schedule = analyzeSchedule(model.calendar.items, { now: NOW })
  const balanced = composeDailyBriefing(model, 'it', { now: NOW, length: 'balanced', schedule })
  const concise = composeDailyBriefing(model, 'it', { now: NOW, length: 'concise', schedule })
  const detailed = composeDailyBriefing(model, 'it', { now: NOW, length: 'detailed', schedule })
  assert.ok(concise.text.length < balanced.text.length || concise.text.includes('Prossimo'))
  assert.ok(detailed.text.length >= balanced.text.length || detailed.text.includes('Oggi'))
  assert.match(concise.text, /Urgente|Prossimo|Pay invoice|Dentist/)
  assert.doesNotMatch(concise.text, /Da ricordare:/)
}

// Priority V2 — overdue first
{
  const pri = buildBriefingPriorities(sampleModel(), { now: NOW })
  assert.equal(pri[0].kind, 'overdue_reminder')
  assert.ok(pri.some((p) => p.kind === 'next_event'))
}

// Overlaps + back-to-back + free windows
{
  const items = [
    {
      id: 'a',
      title: 'A',
      start: '2026-08-20T12:00:00.000Z',
      end: '2026-08-20T13:00:00.000Z',
      allDay: false,
    },
    {
      id: 'b',
      title: 'B',
      start: '2026-08-20T12:30:00.000Z',
      end: '2026-08-20T14:00:00.000Z',
      allDay: false,
    },
  ]
  const ov = analyzeSchedule(items, { now: NOW })
  assert.equal(ov.overlaps.length, 1)
}

{
  const items = [
    {
      id: 'a',
      title: 'A',
      start: '2026-08-20T12:00:00.000Z',
      end: '2026-08-20T13:00:00.000Z',
      allDay: false,
    },
    {
      id: 'b',
      title: 'B',
      start: '2026-08-20T13:10:00.000Z',
      end: '2026-08-20T14:00:00.000Z',
      allDay: false,
    },
  ]
  const bt = analyzeSchedule(items, { now: NOW })
  assert.equal(bt.backToBack.length, 1)
  const text = composeDailyBriefing(
    sampleModel({
      calendar: { status: 'ok', items },
      reminders: { status: 'ok', overdue: [], today: [] },
    }),
    'it',
    { now: NOW, length: 'balanced', schedule: bt },
  )
  assert.match(text.text, /quasi consecutivi/)
}

{
  const items = [
    {
      id: 'late',
      title: 'Late',
      start: '2026-08-20T14:00:00.000Z',
      end: '2026-08-20T15:00:00.000Z',
      allDay: false,
    },
  ]
  const fw = analyzeSchedule(items, { now: NOW })
  assert.ok(fw.freeWindows.some((w) => w.kind === 'until_first'))
  assert.ok(fw.minutesUntilNext != null && fw.minutesUntilNext > 0)
}

// Quiet day
{
  const quiet = composeDailyBriefing(
    sampleModel({
      calendar: { status: 'empty', items: [] },
      reminders: { status: 'empty', overdue: [], today: [] },
      weather: {
        status: 'ok',
        snapshot: {
          locationLabel: 'Milano',
          temperatureMinC: 18,
          temperatureMaxC: 24,
          rainLikely: false,
        },
      },
    }),
    'it',
    { now: NOW, length: 'balanced' },
  )
  assert.match(quiet.text, /giornata è libera|Per ora/)
  assert.match(quiet.text, /Milano|sono previsti/)
}

{
  const quietNoWx = composeDailyBriefing(
    sampleModel({
      calendar: { status: 'empty', items: [] },
      reminders: { status: 'empty', overdue: [], today: [] },
      weather: { status: 'unavailable', snapshot: null, hiddenByPref: true },
    }),
    'it',
    { now: NOW },
  )
  assert.match(quietNoWx.text, /libera|impegni/)
  assert.doesNotMatch(quietNoWx.text, /Milano/)
}

// Preference intents — persistent vs temporary
{
  const persistCity = detectBriefingPreferenceIntent('Usa Milano per il meteo del briefing')
  assert.equal(persistCity?.persist, true)
  assert.equal(persistCity?.patch?.preferredWeatherCity, 'Milano')
  assert.match(preferenceAck(persistCity.patch, 'it', true), /Milano/)

  const persistShort = detectBriefingPreferenceIntent('Voglio briefing brevi')
  assert.equal(persistShort?.persist, true)
  assert.equal(persistShort?.patch?.length, 'concise')

  const persistWxOff = detectBriefingPreferenceIntent('Non mostrarmi il meteo nel briefing')
  assert.equal(persistWxOff?.persist, true)
  assert.equal(persistWxOff?.patch?.weatherEnabled, false)

  const persistBalanced = detectBriefingPreferenceIntent('Ripristina il briefing bilanciato')
  assert.equal(persistBalanced?.persist, true)
  assert.equal(persistBalanced?.patch?.length, 'balanced')

  const tempShort = detectBriefingPreferenceIntent('Riassumilo più brevemente')
  assert.equal(tempShort?.persist, false)
  assert.equal(tempShort?.oneShotLength, 'concise')
  assert.equal(preferenceAck({}, 'it', false), null)

  const tempDet = detectBriefingPreferenceIntent('Fammi la versione dettagliata')
  assert.equal(tempDet?.persist, false)
  assert.equal(tempDet?.oneShotLength, 'detailed')

  // Normal chat must not be hijacked
  assert.equal(detectBriefingPreferenceIntent('Come stai oggi?'), null)
  assert.equal(detectBriefingPreferenceIntent('Briefing'), null)
}

// Follow-ups
{
  assert.equal(detectBriefingFollowUp('quando sono libero?')?.kind, 'free_windows')
  assert.equal(detectBriefingFollowUp('ho impegni sovrapposti?')?.kind, 'overlaps')
  assert.equal(
    detectBriefingFollowUp('quanto tempo ho prima del prossimo?')?.kind,
    'time_until_next',
  )
  assert.equal(detectBriefingFollowUp('quanti promemoria ho?')?.kind, 'reminder_count')
  assert.equal(detectBriefingFollowUp('qual è la cosa più urgente?')?.kind, 'most_urgent')
  assert.equal(detectBriefingFollowUp('riassumilo più brevemente')?.kind, 'render_concise')
  assert.equal(detectBriefingFollowUp('fammi la versione dettagliata')?.kind, 'render_detailed')
}

{
  const model = sampleModel({
    calendar: {
      status: 'ok',
      items: [
        {
          id: 'a',
          title: 'A',
          start: '2026-08-20T12:00:00.000Z',
          end: '2026-08-20T13:00:00.000Z',
          allDay: false,
        },
        {
          id: 'b',
          title: 'B',
          start: '2026-08-20T12:30:00.000Z',
          end: '2026-08-20T14:00:00.000Z',
          allDay: false,
        },
      ],
    },
  })
  const schedule = analyzeSchedule(model.calendar.items, { now: NOW })
  const composed = composeDailyBriefing(model, 'it', { now: NOW, schedule })
  const ctx = createBriefingContext({
    targetDate: model.targetDate,
    timezone: model.timezone,
    calendarItems: model.calendar.items,
    reminderItems: [{ id: 'o1', title: 'Pay invoice', fireAt: '2026-08-20T05:00:00.000Z', overdue: true }],
    weatherSnapshot: model.weather.snapshot,
    presentationItems: composed.presentationItems,
    priorities: composed.priorities,
    schedule,
    lastModel: model,
    renderLength: 'balanced',
    displayText: composed.text,
    language: 'it',
    generatedAt: '2026-08-20T06:00:00.000Z',
  })

  const free = answerBriefingFollowUp({ followUpKind: 'free_windows' }, ctx, 'it', { now: NOW })
  assert.equal(free.handled, true)
  assert.match(free.reply, /liber|minuti/i)

  const ov = answerBriefingFollowUp({ followUpKind: 'overlaps' }, ctx, 'it', { now: NOW })
  assert.match(ov.reply, /Sovrapposizioni|A ↔ B/)

  const until = answerBriefingFollowUp({ followUpKind: 'time_until_next' }, ctx, 'it', { now: NOW })
  assert.match(until.reply, /minuti/)

  const urgent = answerBriefingFollowUp({ followUpKind: 'most_urgent' }, ctx, 'it', { now: NOW })
  assert.match(urgent.reply, /urgente|Pay invoice|A/i)

  const count = answerBriefingFollowUp({ followUpKind: 'reminder_count' }, ctx, 'it', { now: NOW })
  assert.match(count.reply, /promemoria/)
}

// Partial failure still composes
{
  const partial = composeDailyBriefing(
    sampleModel({
      calendar: { status: 'unavailable', items: [] },
      reminders: { status: 'ok', overdue: [], today: [{ id: 'r1', title: 'X', fireAt: '2026-08-20T15:00:00.000Z' }] },
      weather: { status: 'error', snapshot: null },
    }),
    'it',
    { now: NOW },
  )
  assert.ok(partial.text.length > 10)
  assert.match(partial.text, /ricordare|X/i)
}

// Agenda not stolen
assert.equal(detectDailyBriefingIntent('Cosa ho oggi?').intent, 'none')
assert.equal(detectDailyBriefingIntent('Briefing').intent, 'daily-briefing')

// Regressions — #334B path still wired
assert.match(read('src/context/ChatContext.tsx'), /applyDailyBriefingIntent/)
assert.match(read('src/context/ChatContext.tsx'), /detectBriefingPreferenceIntent/)
assert.match(read('src/context/ChatContext.tsx'), /briefingPrefs/)
assert.match(read('src/lib/dailyBriefing.js'), /detectBriefingPreferenceIntent/)
assert.match(read('src/lib/dailyBriefing.js'), /analyzeSchedule/)

// Kami / visual system not ripped out
assert.match(read('src/components/SettingsDrawer.tsx'), /settings-briefing/)
assert.doesNotMatch(read('src/lib/daily-briefing/render.js'), /dashboard|card-grid/)

console.log('daily-briefing-334c.test.mjs: ok')
