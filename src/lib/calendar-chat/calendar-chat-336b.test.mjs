/**
 * #336B — Calendar chat MVP contracts + intent/render/free-time probes.
 * Run: node --test src/lib/calendar-chat/calendar-chat-336b.test.mjs
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import { detectCalendarIntent, detectDayShiftFollowUp } from './intent.js'
import { foldCalendarText } from './normalize.js'
import {
  computeFreeWindows,
  filterEventsForQuery,
  filterEventsForAllDayDayMembership,
  allDayEventIncludesYmd,
} from './free-time.js'
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

describe('calendar-chat-336b day-shift follow-ups (#375M)', () => {
  const ctxOpts = { languageHint: 'it', hasCalendarContext: true }

  it('E domani? with context → calendar tomorrow (not Core)', () => {
    const r = detectCalendarIntent('E domani?', ctxOpts)
    assert.equal(r.intent, 'calendar')
    assert.equal(r.dayRef, 'tomorrow')
    assert.equal(r.followUp, false)
    assert.equal(r.dayShiftFollowUp, true)
  })

  it('E oggi? with context → calendar today', () => {
    const r = detectCalendarIntent('E oggi?', ctxOpts)
    assert.equal(r.intent, 'calendar')
    assert.equal(r.dayRef, 'today')
  })

  it('E lunedì? with context → weekday calendar query', () => {
    const r = detectCalendarIntent('E lunedì?', ctxOpts)
    assert.equal(r.intent, 'calendar')
    assert.equal(typeof r.dayRef, 'object')
    assert.equal(r.dayRef.kind, 'weekday')
    assert.equal(r.dayRef.weekday, 1)
  })

  it('And tomorrow? / What about tomorrow? (en)', () => {
    assert.equal(detectCalendarIntent('And tomorrow?', { ...ctxOpts, languageHint: 'en' }).dayRef, 'tomorrow')
    assert.equal(
      detectCalendarIntent('What about tomorrow?', { ...ctxOpts, languageHint: 'en' }).intent,
      'calendar',
    )
  })

  it('Domani invece? / Per martedì? with context', () => {
    assert.equal(detectCalendarIntent('Domani invece?', ctxOpts).dayRef, 'tomorrow')
    const mar = detectCalendarIntent('Per martedì?', ctxOpts)
    assert.equal(mar.intent, 'calendar')
    assert.equal(mar.dayRef.weekday, 2)
  })

  it('E OAuth? with context is NOT Calendar', () => {
    assert.equal(detectCalendarIntent('E OAuth?', ctxOpts).intent, 'none')
    assert.equal(detectDayShiftFollowUp(foldCalendarText('E OAuth?')), null)
  })

  it('E perché? with context stays repeat_status follow-up', () => {
    const r = detectCalendarIntent('E perché?', ctxOpts)
    assert.equal(r.intent, 'calendar')
    assert.equal(r.followUp, true)
    assert.equal(r.followUpKind, 'repeat_status')
  })

  it('No Calendar context: E domani? does not fabricate Calendar intent', () => {
    const r = detectCalendarIntent('E domani?', { languageHint: 'it', hasCalendarContext: false })
    assert.equal(r.intent, 'none')
  })

  it('applyCalendarIntent: Cosa ho oggi? then E domani? stays local with tomorrow query', async () => {
    const todayPack = {
      status: 'ok',
      items: [
        {
          id: 'b1',
          title: 'Buon compleanno!',
          start: '2026-08-23',
          end: '2026-08-24',
          allDay: true,
          status: 'confirmed',
        },
      ],
      fetchedAt: new Date().toISOString(),
    }
    const first = await applyCalendarIntent({
      text: 'Cosa ho oggi?',
      languageHint: 'it',
      timeZone: 'Europe/Rome',
      now: new Date('2026-08-23T15:00:00+02:00'),
      requestFn: async () => todayPack,
    })
    assert.equal(first.handled, true)
    assert.ok(first.calendarContext)
    assert.match(first.reply, /Oggi|oggi/)

    let requestedRange = null
    const second = await applyCalendarIntent({
      text: 'E domani?',
      languageHint: 'it',
      timeZone: 'Europe/Rome',
      now: new Date('2026-08-23T15:00:00+02:00'),
      calendarContext: first.calendarContext,
      requestFn: async (opts) => {
        requestedRange = opts.range
        return { status: 'empty', items: [], fetchedAt: new Date().toISOString() }
      },
    })
    assert.equal(second.handled, true)
    assert.equal(requestedRange, 'tomorrow')
    assert.equal(second.diag.modelCalls, 0)
    assert.equal(second.diag.terminatesLocally, true)
    assert.doesNotMatch(second.reply, /non posso vedere|in questa chat/i)
  })
})

describe('calendar-chat-336b all-day day membership (#375M)', () => {
  const birthday = {
    id: 'bday',
    title: 'Buon compleanno!',
    start: '2026-08-23',
    end: '2026-08-24',
    allDay: true,
    status: 'confirmed',
  }
  const multi = {
    id: 'trip',
    title: 'Vacanza',
    start: '2026-08-23',
    end: '2026-08-25',
    allDay: true,
    status: 'confirmed',
  }

  it('single-day all-day: include D, exclude D+1', () => {
    assert.equal(allDayEventIncludesYmd(birthday, '2026-08-23'), true)
    assert.equal(allDayEventIncludesYmd(birthday, '2026-08-24'), false)
    assert.equal(filterEventsForAllDayDayMembership([birthday], '2026-08-23').length, 1)
    assert.equal(filterEventsForAllDayDayMembership([birthday], '2026-08-24').length, 0)
  })

  it('multi-day all-day: include D and D+1, exclude D+2', () => {
    assert.equal(allDayEventIncludesYmd(multi, '2026-08-23'), true)
    assert.equal(allDayEventIncludesYmd(multi, '2026-08-24'), true)
    assert.equal(allDayEventIncludesYmd(multi, '2026-08-25'), false)
  })

  it('Cosa ho domani? excludes today single-day birthday; oggi includes it', async () => {
    const now = new Date('2026-08-23T15:00:00+02:00')
    const requestFn = async (opts) => ({
      status: 'ok',
      // Simulate Google over-returning the birthday into tomorrow window
      items: [birthday],
      fetchedAt: new Date().toISOString(),
      range: opts.range,
    })
    const today = await applyCalendarIntent({
      text: 'Cosa ho oggi?',
      languageHint: 'it',
      timeZone: 'Europe/Rome',
      now,
      requestFn,
    })
    assert.match(today.reply, /Buon compleanno/)
    assert.match(today.reply, /Oggi|oggi/)

    const tmr = await applyCalendarIntent({
      text: 'Cosa ho domani?',
      languageHint: 'it',
      timeZone: 'Europe/Rome',
      now,
      requestFn,
    })
    assert.doesNotMatch(tmr.reply, /Buon compleanno/)
    assert.match(tmr.reply, /domani/i)
  })

  it('timed event near midnight is not dropped by all-day filter', () => {
    const timed = {
      id: 't1',
      title: 'Late',
      start: '2026-08-23T21:30:00.000Z',
      end: '2026-08-23T22:30:00.000Z',
      allDay: false,
      status: 'confirmed',
    }
    const kept = filterEventsForAllDayDayMembership([timed, birthday], '2026-08-24')
    assert.equal(kept.length, 1)
    assert.equal(kept[0].id, 't1')
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

describe('calendar-chat-336b no Core fallthrough', () => {
  it('ChatContext returns before /api/chat for Calendar claim', () => {
    const ctx = read('src/context/ChatContext.tsx')
    const calIdx = ctx.indexOf('#336B — Calendar chat')
    const chatIdx = ctx.indexOf('runAssistantCompletion(history')
    assert.ok(calIdx > 0)
    assert.ok(chatIdx > calIdx)
    assert.match(ctx, /Never fall through to \/api\/chat/)
    // Matched calendar block returns true before Core
    const block = ctx.slice(calIdx, chatIdx)
    assert.match(block, /intent === 'calendar'/)
    assert.match(block, /return true/)
  })

  it('maps 401 auth HTTP to disconnected (not generic error)', async () => {
    const { mapCalendarQueryResponse } = await import('./api.js')
    const pack = mapCalendarQueryResponse(
      { status: 401 },
      { error: 'Unauthorized', code: 'unauthorized' },
      'Europe/Rome',
    )
    assert.equal(pack.status, 'disconnected')
  })

  const terminalStatuses = [
    'disabled',
    'disconnected',
    'reconnect_required',
    'timeout',
    'error',
    'empty',
    'ok',
  ]

  for (const status of terminalStatuses) {
    it(`matched intent + ${status} terminates locally (no Core)`, async () => {
      const result = await applyCalendarIntent({
        text: 'Cosa ho domani?',
        languageHint: 'it',
        timeZone: 'UTC',
        now: new Date('2026-08-21T10:00:00.000Z'),
        requestFn: async () => ({
          status,
          items:
            status === 'ok'
              ? [
                  {
                    id: '1',
                    title: 'X',
                    start: '2026-08-22T09:00:00.000Z',
                    end: '2026-08-22T10:00:00.000Z',
                    allDay: false,
                    status: 'confirmed',
                  },
                ]
              : [],
          fetchedAt: new Date().toISOString(),
        }),
      })
      assert.equal(result.handled, true)
      assert.ok(result.reply)
      assert.equal(result.diag.modelCalls, 0)
      assert.equal(result.diag.terminatesLocally, true)
      assert.doesNotMatch(result.reply, /accesso diretto|condividi qui|tuoi account/i)
      if (status !== 'ok' && status !== 'empty') {
        assert.ok(result.calendarContext)
        assert.equal(result.calendarContext.status, status)
      }
    })
  }

  it('failure follow-up "Perché?" stays local (never Core wording)', async () => {
    const fail = await applyCalendarIntent({
      text: 'Cosa ho oggi?',
      languageHint: 'it',
      timeZone: 'UTC',
      requestFn: async () => ({
        status: 'error',
        items: [],
        fetchedAt: new Date().toISOString(),
      }),
    })
    const follow = await applyCalendarIntent({
      text: 'Perché?',
      languageHint: 'it',
      calendarContext: fail.calendarContext,
      timeZone: 'UTC',
    })
    assert.equal(follow.handled, true)
    assert.match(follow.reply, /Non riesco a leggere il calendario/)
    assert.equal(follow.diag.modelCalls, 0)
    assert.doesNotMatch(follow.reply, /accesso diretto|condividi qui/i)
  })
})

console.log('calendar-chat-336b: ok')
