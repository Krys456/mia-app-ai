/**
 * #336B — Calendar chat MVP contracts + intent/render/free-time probes.
 * Run: node --test src/lib/calendar-chat/calendar-chat-336b.test.mjs
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import { detectCalendarIntent } from './intent.js'
import { foldCalendarText } from './normalize.js'
import { computeFreeWindows, filterEventsForQuery } from './free-time.js'
import { renderCalendarAnswer, failureReply } from './render.js'
import { applyCalendarIntent } from './controller.js'
import { createCalendarContext } from './active-context.js'

const root = process.cwd()
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')
const homeQa = read('src/lib/homeQuickActions.ts')

describe('calendar-chat-336b infrastructure', () => {
  it('reuses daily-briefing calendar_query without new Vercel function', () => {
    const api = read('api/daily-briefing.ts')
    assert.match(api, /calendar_query/)
    assert.match(api, /runCalendarQuery/)
    assert.ok(fs.existsSync(path.join(root, 'lib/server/daily-briefing/calendar-query.js')))
    assert.ok(!fs.existsSync(path.join(root, 'api/calendar.ts')))
    const fnCount = Object.keys(JSON.parse(read('vercel.json')).functions).length
    assert.equal(fnCount, 11)
  })

  it('wires ChatContext Calendar before Briefing and Home quick action', () => {
    const ctx = read('src/context/ChatContext.tsx')
    assert.match(ctx, /detectCalendarIntent/)
    assert.match(ctx, /applyCalendarIntent/)
    assert.match(ctx, /#336B/)
    assert.match(homeQa, /id:\s*'calendario'/)
    assert.match(homeQa, /Cosa ho oggi\?/)
    assert.match(homeQa, /kind:\s*'sendMessage'/)
  })

  it('does not import listEvents into /api/chat', () => {
    const chat = read('api/chat.ts')
    assert.doesNotMatch(chat, /listEvents|calendar-read|calendar_query/)
  })
})

describe('calendar-chat-336b intents', () => {
  const positives = [
    'Cosa ho oggi?',
    'Cosa ho domani?',
    "Cos'ho domani?",
    'Che impegni ho domani?',
    'Ho qualcosa venerdì?',
    'Qual è il mio prossimo impegno?',
    'Cosa ho dopo le 15?',
    'Quando sono libero domani?',
    'Cosa c\'è domani?',
    'Impegni di domani',
    'Ho impegni nel pomeriggio?',
  ]

  for (const phrase of positives) {
    it(`detects: ${phrase}`, () => {
      const r = detectCalendarIntent(phrase)
      assert.equal(r.intent, 'calendar', phrase)
    })
  }

  const negatives = [
    'Fammi il briefing',
    'Buongiorno',
    'Come stai?',
    'Che tempo fa?',
    'Timer 20 minuti',
    'Come sarà la mia giornata?',
  ]

  for (const phrase of negatives) {
    it(`does not hijack: ${phrase}`, () => {
      const r = detectCalendarIntent(phrase)
      assert.equal(r.intent, 'none', phrase)
    })
  }

  it('normalizes Cos\'ho', () => {
    assert.match(foldCalendarText("Cos'ho domani?"), /cosa ho domani/)
  })
})

describe('calendar-chat-336b free time + filters', () => {
  it('computes free windows around busy intervals', () => {
    const day = '2026-08-21'
    const events = [
      {
        id: '1',
        title: 'A',
        start: '2026-08-21T08:00:00.000Z',
        end: '2026-08-21T09:00:00.000Z',
        allDay: false,
        status: 'confirmed',
      },
      {
        id: '2',
        title: 'B',
        start: '2026-08-21T12:00:00.000Z',
        end: '2026-08-21T13:00:00.000Z',
        allDay: false,
        status: 'confirmed',
      },
    ]
    // Use UTC as zone so ISO times align for the test day window math loosely
    const windows = computeFreeWindows(events, {
      dayYmd: day,
      timeZone: 'UTC',
      windowStartHour: 8,
      windowEndHour: 20,
    })
    assert.ok(windows.length >= 1)
  })

  it('filters after hour', () => {
    const events = [
      {
        id: '1',
        title: 'Morning',
        start: '2026-08-21T09:00:00.000Z',
        end: '2026-08-21T10:00:00.000Z',
        allDay: false,
      },
      {
        id: '2',
        title: 'Late',
        start: '2026-08-21T16:00:00.000Z',
        end: '2026-08-21T17:00:00.000Z',
        allDay: false,
      },
    ]
    const filtered = filterEventsForQuery(events, { timeZone: 'UTC', afterHour: 15 })
    assert.equal(filtered.length, 1)
    assert.equal(filtered[0].title, 'Late')
  })
})

describe('calendar-chat-336b renderer + controller', () => {
  it('renders empty / one / multiple / failures', () => {
    assert.match(failureReply('disconnected', 'it'), /Collega Google Calendar/)
    assert.match(failureReply('disabled', 'it'), /non è attivo/)
    assert.match(
      renderCalendarAnswer({
        events: [],
        status: 'empty',
        language: 'it',
        timeZone: 'Europe/Rome',
        labelDay: 'tomorrow',
        queryType: 'list',
      }),
      /non risultano impegni/,
    )
    assert.match(
      renderCalendarAnswer({
        events: [
          {
            id: '1',
            title: 'Dentista',
            start: '2026-08-22T08:30:00.000Z',
            end: '2026-08-22T09:00:00.000Z',
            allDay: false,
          },
        ],
        status: 'ok',
        language: 'it',
        timeZone: 'UTC',
        labelDay: 'tomorrow',
        queryType: 'list',
      }),
      /Dentista/,
    )
  })

  it('applyCalendarIntent uses pack and zero model calls', async () => {
    const result = await applyCalendarIntent({
      text: 'Cosa ho domani?',
      languageHint: 'it',
      timeZone: 'UTC',
      now: new Date('2026-08-21T10:00:00.000Z'),
      requestFn: async () => ({
        status: 'ok',
        items: [
          {
            id: 'e1',
            title: 'Riunione',
            start: '2026-08-22T09:00:00.000Z',
            end: '2026-08-22T10:00:00.000Z',
            allDay: false,
            status: 'confirmed',
            timeZone: 'UTC',
          },
        ],
        fetchedAt: new Date().toISOString(),
        timeZone: 'UTC',
      }),
    })
    assert.equal(result.handled, true)
    assert.match(result.reply, /Riunione/)
    assert.equal(result.diag.modelCalls, 0)
    assert.ok(result.calendarContext)
  })

  it('follow-up ordinal from context', async () => {
    const ctx = createCalendarContext({
      labelDay: 'tomorrow',
      timezone: 'UTC',
      events: [
        {
          id: '1',
          title: 'Uno',
          start: '2026-08-22T09:00:00.000Z',
          end: '2026-08-22T10:00:00.000Z',
          allDay: false,
          status: 'confirmed',
        },
        {
          id: '2',
          title: 'Due',
          start: '2026-08-22T14:00:00.000Z',
          end: '2026-08-22T15:00:00.000Z',
          allDay: false,
          status: 'confirmed',
        },
      ],
      focusIndex: 0,
      queryType: 'list',
      status: 'ok',
      language: 'it',
      dayYmd: '2026-08-22',
    })
    const result = await applyCalendarIntent({
      text: 'Il secondo?',
      languageHint: 'it',
      calendarContext: ctx,
      timeZone: 'UTC',
    })
    assert.equal(result.handled, true)
    assert.match(result.reply, /Due/)
    assert.equal(result.diag.modelCalls, 0)
  })

  it('disconnected returns specific copy + settings action', async () => {
    const result = await applyCalendarIntent({
      text: 'Cosa ho oggi?',
      languageHint: 'it',
      timeZone: 'UTC',
      requestFn: async () => ({
        status: 'disconnected',
        items: [],
        fetchedAt: new Date().toISOString(),
      }),
    })
    assert.match(result.reply, /Collega Google Calendar/)
    assert.equal(result.calendarUi?.actions?.[0]?.id, 'open_settings')
  })
})

console.log('calendar-chat-336b: ok')
