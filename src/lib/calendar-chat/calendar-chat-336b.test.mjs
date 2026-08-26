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
import {
  createCalendarContext,
  rememberCalendarContext,
  resolveCalendarContext,
  clearCalendarContext,
  isCalendarContextFresh,
  CALENDAR_CONTEXT_TTL_MS,
  resetModuleCalendarRuntimeForTests,
} from './active-context.js'
import { runCalendarLocalExchangeTurn } from './chat-turn.js'
import { resolveCalendarTurnClaim } from './calendar-turn-claim.js'
import {
  markActiveLocalExchange,
  isCalendarLocalExchangeActive,
  clearCalendarLocalExchange,
  peekActiveLocalExchange,
  resetModuleActiveLocalExchangeForTests,
} from './local-exchange-ownership.js'

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
    assert.equal(fnCount, 13)
  })

  it('wires ChatContext Calendar before Briefing and Home quick action', () => {
    const ctx = read('src/context/ChatContext.tsx')
    assert.match(ctx, /resolveCalendarTurnClaim/)
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

describe('calendar-chat-375P active-context persistence', () => {
  function memoryStorage() {
    const mem = new Map()
    return {
      getItem: (k) => (mem.has(k) ? mem.get(k) : null),
      setItem: (k, v) => {
        mem.set(k, String(v))
      },
      removeItem: (k) => {
        mem.delete(k)
      },
    }
  }

  function failingStorage() {
    return {
      getItem: () => {
        throw new Error('storage_blocked')
      },
      setItem: () => {
        throw new Error('storage_blocked')
      },
      removeItem: () => {
        throw new Error('storage_blocked')
      },
    }
  }

  const now = new Date('2026-08-23T15:00:00+02:00')
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

  it('full two-turn: Cosa ho oggi? then E domani? via runtime (Core NOT called)', async () => {
    resetModuleCalendarRuntimeForTests()
    const runtimeRef = { current: null }
    const storage = memoryStorage()
    const inFlightRef = { current: false }

    const t1 = await runCalendarLocalExchangeTurn({
      text: 'Cosa ho oggi?',
      languageHint: 'it',
      runtimeRef,
      storage,
      inFlightRef,
      timeZone: 'Europe/Rome',
      now,
      requestFn: async () => todayPack,
    })
    assert.equal(t1.handled, true)
    assert.equal(t1.coreCalled, false)
    assert.ok(runtimeRef.current)
    assert.equal(isCalendarContextFresh(runtimeRef.current), true)

    let requestedRange = null
    let coreCalled = false
    const t2 = await runCalendarLocalExchangeTurn({
      text: 'E domani?',
      languageHint: 'it',
      runtimeRef,
      storage,
      inFlightRef,
      timeZone: 'Europe/Rome',
      now,
      requestFn: async (opts) => {
        requestedRange = opts.range
        return { status: 'empty', items: [], fetchedAt: new Date().toISOString() }
      },
    })
    if (t2.coreCalled) coreCalled = true
    assert.equal(t2.hasCalendarContext, true)
    assert.equal(t2.intent.intent, 'calendar')
    assert.equal(t2.intent.dayRef, 'tomorrow')
    assert.equal(t2.intent.dayShiftFollowUp, true)
    assert.equal(t2.coreCalled, false)
    assert.equal(coreCalled, false)
    assert.equal(requestedRange, 'tomorrow')
    assert.equal(t2.result.diag.modelCalls, 0)
  })

  it('E oggi? / E lunedì? use runtime context', async () => {
    resetModuleCalendarRuntimeForTests()
    const runtimeRef = { current: null }
    const storage = memoryStorage()
    await runCalendarLocalExchangeTurn({
      text: 'Cosa ho oggi?',
      languageHint: 'it',
      runtimeRef,
      storage,
      timeZone: 'Europe/Rome',
      now,
      requestFn: async () => todayPack,
    })

    const oggi = await runCalendarLocalExchangeTurn({
      text: 'E oggi?',
      languageHint: 'it',
      runtimeRef,
      storage,
      timeZone: 'Europe/Rome',
      now,
      requestFn: async () => todayPack,
    })
    assert.equal(oggi.coreCalled, false)
    assert.equal(oggi.intent.dayRef, 'today')
    assert.equal(oggi.intent.dayShiftFollowUp, true)

    const lun = await runCalendarLocalExchangeTurn({
      text: 'E lunedì?',
      languageHint: 'it',
      runtimeRef,
      storage,
      timeZone: 'Europe/Rome',
      now,
      requestFn: async () => ({ status: 'empty', items: [], fetchedAt: new Date().toISOString() }),
    })
    assert.equal(lun.coreCalled, false)
    assert.equal(lun.intent.dayRef.kind, 'weekday')
    assert.equal(lun.intent.dayRef.weekday, 1)
  })

  it('expired context is not used', () => {
    resetModuleCalendarRuntimeForTests()
    const runtimeRef = { current: null }
    const storage = memoryStorage()
    const createdAt = Date.now() - CALENDAR_CONTEXT_TTL_MS - 1000
    const expired = createCalendarContext({
      labelDay: 'today',
      timezone: 'Europe/Rome',
      events: [],
      status: 'ok',
      createdAt,
      expiresAt: createdAt + CALENDAR_CONTEXT_TTL_MS,
    })
    rememberCalendarContext(expired, { runtimeRef, storage, nowMs: createdAt })
    // Force stale into runtime/storage with past expiresAt
    runtimeRef.current = expired
    storage.setItem('shinkaido.activeCalendar.v1', JSON.stringify(expired))
    const resolved = resolveCalendarContext({
      runtimeRef,
      storage,
      nowMs: Date.now(),
    })
    assert.equal(resolved, null)
    assert.equal(runtimeRef.current, null)
  })

  it('no context: E domani? does not claim Calendar (Core path)', async () => {
    resetModuleCalendarRuntimeForTests()
    resetModuleActiveLocalExchangeForTests()
    const runtimeRef = { current: null }
    const storage = memoryStorage()
    const t = await runCalendarLocalExchangeTurn({
      text: 'E domani?',
      languageHint: 'it',
      runtimeRef,
      activeLocalExchangeRef: { current: null },
      storage,
      timeZone: 'Europe/Rome',
      now,
      requestFn: async () => todayPack,
    })
    assert.equal(t.hasCalendarContext, false)
    assert.equal(t.intent.intent, 'none')
    assert.equal(t.coreCalled, true)
    assert.equal(t.handled, false)
  })

  it('E OAuth? is not Calendar even with runtime context', async () => {
    resetModuleCalendarRuntimeForTests()
    resetModuleActiveLocalExchangeForTests()
    const runtimeRef = { current: null }
    const storage = memoryStorage()
    await runCalendarLocalExchangeTurn({
      text: 'Cosa ho oggi?',
      languageHint: 'it',
      runtimeRef,
      storage,
      timeZone: 'Europe/Rome',
      now,
      requestFn: async () => todayPack,
    })
    const t = await runCalendarLocalExchangeTurn({
      text: 'E OAuth?',
      languageHint: 'it',
      runtimeRef,
      storage,
      timeZone: 'Europe/Rome',
      now,
      requestFn: async () => todayPack,
    })
    assert.equal(t.intent.intent, 'none')
    assert.equal(t.coreCalled, true)
  })

  it('context isolation: clearCalendarContext drops module so other holders miss', async () => {
    resetModuleCalendarRuntimeForTests()
    resetModuleActiveLocalExchangeForTests()
    const a = { current: null }
    const b = { current: null }
    const storageA = memoryStorage()
    const storageB = memoryStorage()
    await runCalendarLocalExchangeTurn({
      text: 'Cosa ho oggi?',
      languageHint: 'it',
      runtimeRef: a,
      storage: storageA,
      timeZone: 'Europe/Rome',
      now,
      requestFn: async () => todayPack,
    })
    assert.ok(a.current)
    // newChat-equivalent: clear module + holder A + storage A
    clearCalendarContext(storageA, a)
    resetModuleActiveLocalExchangeForTests()
    assert.equal(resolveCalendarContext({ runtimeRef: b, storage: storageB }), null)
    const t = await runCalendarLocalExchangeTurn({
      text: 'E domani?',
      languageHint: 'it',
      runtimeRef: b,
      activeLocalExchangeRef: { current: null },
      storage: storageB,
      timeZone: 'Europe/Rome',
      now,
      requestFn: async () => todayPack,
    })
    assert.equal(t.coreCalled, true)
  })

  it('storage failure does not kill runtime follow-up', async () => {
    resetModuleCalendarRuntimeForTests()
    const runtimeRef = { current: null }
    const storage = failingStorage()
    const t1 = await runCalendarLocalExchangeTurn({
      text: 'Cosa ho oggi?',
      languageHint: 'it',
      runtimeRef,
      storage,
      timeZone: 'Europe/Rome',
      now,
      requestFn: async () => todayPack,
    })
    assert.equal(t1.handled, true)
    assert.ok(runtimeRef.current)

    const t2 = await runCalendarLocalExchangeTurn({
      text: 'E domani?',
      languageHint: 'it',
      runtimeRef,
      storage,
      timeZone: 'Europe/Rome',
      now,
      requestFn: async () => ({ status: 'empty', items: [], fetchedAt: new Date().toISOString() }),
    })
    assert.equal(t2.hasCalendarContext, true)
    assert.equal(t2.intent.dayShiftFollowUp, true)
    assert.equal(t2.coreCalled, false)
  })

  it('rapid second message cannot race Calendar result (in-flight)', async () => {
    resetModuleCalendarRuntimeForTests()
    const runtimeRef = { current: null }
    const storage = memoryStorage()
    const inFlightRef = { current: false }

    let release
    const gate = new Promise((resolve) => {
      release = resolve
    })

    const firstPromise = runCalendarLocalExchangeTurn({
      text: 'Cosa ho oggi?',
      languageHint: 'it',
      runtimeRef,
      storage,
      inFlightRef,
      timeZone: 'Europe/Rome',
      now,
      requestFn: async () => {
        await gate
        return todayPack
      },
    })

    // Allow first turn to set inFlight
    await new Promise((r) => setTimeout(r, 5))
    assert.equal(inFlightRef.current, true)

    const raced = await runCalendarLocalExchangeTurn({
      text: 'E domani?',
      languageHint: 'it',
      runtimeRef,
      storage,
      inFlightRef,
      timeZone: 'Europe/Rome',
      now,
      requestFn: async () => todayPack,
    })
    assert.equal(raced.blockedByInFlight, true)
    assert.equal(raced.coreCalled, false)

    release()
    const first = await firstPromise
    assert.equal(first.handled, true)
    assert.equal(inFlightRef.current, false)
    assert.ok(runtimeRef.current)
  })

  it('ChatContext wires resolveCalendarContext + remember + inFlight (source)', () => {
    const chat = read('src/context/ChatContext.tsx')
    assert.match(chat, /resolveCalendarContext/)
    assert.match(chat, /rememberCalendarContext/)
    assert.match(chat, /calendarRuntimeRef/)
    assert.match(chat, /activeLocalExchangeRef/)
    assert.match(chat, /resolveCalendarTurnClaim/)
    assert.match(chat, /markActiveLocalExchange/)
    assert.match(chat, /inFlightRef\.current = true/)
    assert.match(chat, /clearCalendarContext/)
    assert.doesNotMatch(
      chat,
      /const calendarCtx = loadCalendarContext\(\)/,
    )
    assert.match(chat, /lastAssistantHadCalendar/)
  })

  it('clearCalendarContext isolates new chat', () => {
    resetModuleCalendarRuntimeForTests()
    const runtimeRef = { current: null }
    const storage = memoryStorage()
    const ctx = createCalendarContext({
      labelDay: 'today',
      timezone: 'UTC',
      events: [],
      status: 'ok',
    })
    rememberCalendarContext(ctx, { runtimeRef, storage })
    clearCalendarContext(storage, runtimeRef)
    assert.equal(runtimeRef.current, null)
    assert.equal(resolveCalendarContext({ runtimeRef, storage }), null)
  })

  it('#375R browser-proven shape round-trips (no domain/intent/dayRef required)', () => {
    resetModuleCalendarRuntimeForTests()
    const runtimeRef = { current: null }
    const storage = memoryStorage()
    // Live Preview stored shape after "Cosa ho oggi?" — createCalendarContext fields only.
    const ctx = createCalendarContext({
      dateRange: { range: 'today', labelDay: 'today', dayYmd: '2026-08-23' },
      labelDay: 'today',
      timezone: 'Etc/GMT+12',
      fetchedAt: '2026-08-23T15:00:00.000Z',
      events: [
        {
          id: 'bday',
          title: 'Buon compleanno!',
          start: '2026-08-23',
          end: '2026-08-24',
          allDay: true,
        },
      ],
      focusIndex: 0,
      queryType: 'list',
      status: 'ok',
      language: 'it',
      dayYmd: '2026-08-23',
    })
    assert.equal('domain' in ctx, false)
    assert.equal('intent' in ctx, false)
    assert.equal('dayRef' in ctx, false)
    assert.equal(typeof ctx.expiresAt, 'number')
    assert.equal(isCalendarContextFresh(ctx), true)

    rememberCalendarContext(ctx, { runtimeRef, storage })
    // Simulate provider remount: empty runtime, storage still present.
    const remounted = { current: null }
    const resolved = resolveCalendarContext({ runtimeRef: remounted, storage })
    assert.ok(resolved)
    assert.equal(resolved.status, 'ok')
    assert.equal(typeof resolved.expiresAt, 'number')

    const t2 = detectCalendarIntent('E domani?', {
      languageHint: 'it',
      hasCalendarContext: Boolean(resolved),
    })
    assert.equal(t2.intent, 'calendar')
    assert.equal(t2.dayRef, 'tomorrow')
    assert.equal(t2.dayShiftFollowUp, true)
  })

  it('storage→resolve→E domani LOCAL_EXCHANGE (not Core) with live shape', async () => {
    resetModuleCalendarRuntimeForTests()
    const runtimeRef = { current: null }
    const storage = memoryStorage()
    const now = new Date('2026-08-23T16:00:00.000Z')

    const t1 = await runCalendarLocalExchangeTurn({
      text: 'Cosa ho oggi?',
      languageHint: 'it',
      runtimeRef,
      storage,
      timeZone: 'Europe/Rome',
      now,
      requestFn: async () => ({
        status: 'ok',
        items: [
          {
            id: 'bday',
            title: 'Buon compleanno!',
            start: '2026-08-23',
            end: '2026-08-24',
            allDay: true,
            status: 'confirmed',
          },
        ],
        fetchedAt: now.toISOString(),
        timeZone: 'Europe/Rome',
      }),
    })
    assert.equal(t1.coreCalled, false)
    assert.ok(storage.getItem('shinkaido.activeCalendar.v1'))

    // Drop runtime only — second turn must hydrate from storage (live remount case).
    runtimeRef.current = null
    let requestedRange = null
    const t2 = await runCalendarLocalExchangeTurn({
      text: 'E domani?',
      languageHint: 'it',
      runtimeRef,
      storage,
      timeZone: 'Europe/Rome',
      now,
      requestFn: async (opts) => {
        requestedRange = opts.range
        return {
          status: 'empty',
          items: [],
          fetchedAt: now.toISOString(),
          timeZone: 'Europe/Rome',
        }
      },
    })
    assert.equal(t2.hasCalendarContext, true)
    assert.equal(t2.coreCalled, false)
    assert.equal(t2.intent.dayRef, 'tomorrow')
    assert.equal(requestedRange, 'tomorrow')
  })
})

describe('calendar-chat-336b timezone (#375R)', () => {
  it('rejects Etc/GMT* as unreliable client timezone', async () => {
    const { isUnreliableCalendarTimeZone, resolveClientCalendarTimeZone } = await import(
      './controller.js'
    )
    assert.equal(isUnreliableCalendarTimeZone('Etc/GMT+12'), true)
    assert.equal(isUnreliableCalendarTimeZone('Etc/GMT-2'), true)
    assert.equal(isUnreliableCalendarTimeZone('Europe/Rome'), false)
    assert.equal(resolveClientCalendarTimeZone('Etc/GMT+12'), null)
    assert.equal(resolveClientCalendarTimeZone('Europe/Rome'), 'Europe/Rome')
  })

  it('Etc/GMT+12 morning: omit bad TZ; pack Europe/Rome excludes birthday from tomorrow', async () => {
    const morningUtc = new Date('2026-08-23T10:00:00.000Z')
    const birthday = {
      id: 'bday',
      title: 'Buon compleanno!',
      start: '2026-08-23',
      end: '2026-08-24',
      allDay: true,
      status: 'confirmed',
    }
    let sentTz = 'SENT_UNDEFINED'
    const r = await applyCalendarIntent({
      text: 'Cosa ho domani?',
      languageHint: 'it',
      timeZone: 'Etc/GMT+12',
      now: morningUtc,
      requestFn: async (opts) => {
        sentTz = opts.timeZone
        // Server authoritative zone after rejecting Etc/GMT*.
        return {
          status: 'ok',
          items: [birthday],
          fetchedAt: morningUtc.toISOString(),
          timeZone: 'Europe/Rome',
        }
      },
    })
    assert.equal(sentTz, undefined)
    assert.equal(r.handled, true)
    assert.equal(r.calendarContext.timezone, 'Europe/Rome')
    assert.equal(r.calendarContext.dayYmd, '2026-08-24')
    assert.equal(r.calendarContext.events.length, 0)
    assert.match(String(r.reply || ''), /non risultano impegni/i)
  })
})

describe('calendar-chat-375S sticky follow-up + membership', () => {
  function memStore() {
    const mem = new Map()
    return {
      getItem: (k) => (mem.has(k) ? mem.get(k) : null),
      setItem: (k, v) => {
        mem.set(k, String(v))
      },
      removeItem: (k) => {
        mem.delete(k)
      },
    }
  }

  const birthday = {
    id: 'bday',
    title: 'Buon compleanno!',
    start: '2026-08-23',
    end: '2026-08-24',
    allDay: true,
    status: 'confirmed',
  }
  const now = new Date('2026-08-23T16:00:00.000Z')

  it('ownership ref arms E domani? without runtime ctx (not Core)', async () => {
    resetModuleCalendarRuntimeForTests()
    resetModuleActiveLocalExchangeForTests()
    const runtimeRef = { current: null }
    const ownershipRef = { current: null }
    markActiveLocalExchange(ownershipRef, 'calendar')
    const storage = memStore()
    let requestedRange = null
    const t = await runCalendarLocalExchangeTurn({
      text: 'E domani?',
      languageHint: 'it',
      runtimeRef,
      activeLocalExchangeRef: ownershipRef,
      storage,
      timeZone: 'Europe/Rome',
      now,
      requestFn: async (opts) => {
        requestedRange = opts.range
        return {
          status: 'ok',
          items: [birthday],
          fetchedAt: now.toISOString(),
          timeZone: 'Europe/Rome',
        }
      },
    })
    assert.equal(t.coreCalled, false)
    assert.equal(t.intent.dayShiftFollowUp, true)
    assert.equal(requestedRange, 'tomorrow')
    assert.equal(t.result.calendarContext.events.length, 0)
    assert.equal(t.result.calendarContext.dayYmd, '2026-08-24')
  })

  it('sticky lastAssistantHadCalendar alone arms E domani? (not Core)', async () => {
    resetModuleCalendarRuntimeForTests()
    resetModuleActiveLocalExchangeForTests()
    let coreCalls = 0
    const t = await runCalendarLocalExchangeTurn({
      text: 'E domani?',
      languageHint: 'it',
      runtimeRef: { current: null },
      activeLocalExchangeRef: { current: null },
      lastAssistantHadCalendar: true,
      storage: memStore(),
      timeZone: 'Europe/Rome',
      now,
      requestFn: async () => {
        coreCalls += 1
        return {
          status: 'empty',
          items: [],
          fetchedAt: now.toISOString(),
          timeZone: 'Europe/Rome',
        }
      },
    })
    assert.equal(t.coreCalled, false)
    assert.equal(t.intent.dayShiftFollowUp, true)
    // requestFn is Calendar API — not Core. Core would be coreCalled true with 0 API.
    assert.equal(coreCalls, 1)
  })

  it('E dopodomani? excludes birthday (Aug 25)', async () => {
    const r = await applyCalendarIntent({
      text: 'E dopodomani?',
      languageHint: 'it',
      hasCalendarContext: true,
      timeZone: 'Europe/Rome',
      now,
      requestFn: async () => ({
        status: 'ok',
        items: [birthday],
        fetchedAt: now.toISOString(),
        timeZone: 'Europe/Rome',
      }),
    })
    assert.equal(r.handled, true)
    assert.equal(r.calendarContext.dayYmd, '2026-08-25')
    assert.equal(r.calendarContext.events.length, 0)
  })

  it('E oggi? keeps birthday', async () => {
    const r = await applyCalendarIntent({
      text: 'E oggi?',
      languageHint: 'it',
      hasCalendarContext: true,
      timeZone: 'Europe/Rome',
      now,
      requestFn: async () => ({
        status: 'ok',
        items: [birthday],
        fetchedAt: now.toISOString(),
        timeZone: 'Europe/Rome',
      }),
    })
    assert.equal(r.handled, true)
    assert.equal(r.calendarContext.dayYmd, '2026-08-23')
    assert.equal(r.calendarContext.events.length, 1)
  })

  it('ChatContext ownership wiring (source)', () => {
    const chat = read('src/context/ChatContext.tsx')
    assert.match(chat, /activeLocalExchangeRef/)
    assert.match(chat, /resolveCalendarTurnClaim/)
    assert.match(chat, /markActiveLocalExchange/)
  })

  it('runCalendarQuery omits TZ so listEvents can use primary', async () => {
    const { runCalendarQuery } = await import(
      '../../../lib/server/daily-briefing/calendar-query.js'
    )
    let sawTimeZone = 'MISSING'
    const pack = await runCalendarQuery('user-1', {
      range: 'tomorrow',
      now,
      env: { CALENDAR_ENABLED: 'true' },
      listEventsFn: async (_uid, opts) => {
        sawTimeZone = opts.timeZone
        return {
          events: [birthday],
          timeMin: '2026-08-23T22:00:00.000Z',
          timeMax: '2026-08-24T22:00:00.000Z',
          timeZone: 'Europe/Rome',
        }
      },
    })
    assert.equal(sawTimeZone, undefined)
    assert.equal(pack.timeZone, 'Europe/Rome')
    assert.equal(pack.queryMeta.dayYmd, '2026-08-24')
    assert.equal(pack.items.length, 0)
    assert.equal(pack.queryMeta.rawCount, 1)
    assert.equal(pack.queryMeta.keptCount, 0)
  })
})

describe('calendar-chat-375T ChatProvider-lifecycle two-turn', () => {
  function memStore() {
    const mem = new Map()
    return {
      getItem: (k) => (mem.has(k) ? mem.get(k) : null),
      setItem: (k, v) => {
        mem.set(k, String(v))
      },
      removeItem: (k) => {
        mem.delete(k)
      },
    }
  }

  function failingStore() {
    return {
      getItem: () => {
        throw new Error('storage_blocked')
      },
      setItem: () => {
        throw new Error('storage_blocked')
      },
      removeItem: () => {
        throw new Error('storage_blocked')
      },
    }
  }

  const birthday = {
    id: 'bday',
    title: 'Buon compleanno!',
    start: '2026-08-23',
    end: '2026-08-24',
    allDay: true,
    status: 'confirmed',
  }
  const now = new Date('2026-08-23T16:00:00.000Z')

  async function twoTurn(followUpText, storage, expectRange) {
    resetModuleCalendarRuntimeForTests()
    resetModuleActiveLocalExchangeForTests()
    const runtimeRef = { current: null }
    const ownershipRef = { current: null }
    const inFlightRef = { current: false }

    const t1 = await runCalendarLocalExchangeTurn({
      text: 'Cosa ho oggi?',
      languageHint: 'it',
      runtimeRef,
      activeLocalExchangeRef: ownershipRef,
      storage,
      inFlightRef,
      timeZone: 'Europe/Rome',
      now,
      requestFn: async () => ({
        status: 'ok',
        items: [birthday],
        fetchedAt: now.toISOString(),
        timeZone: 'Europe/Rome',
      }),
    })
    assert.equal(t1.coreCalled, false)
    assert.ok(t1.calendarUi)
    assert.equal(ownershipRef.current?.domain, 'calendar')
    assert.equal(peekActiveLocalExchange()?.domain, 'calendar')
    // #375U checkpoint: AFTER turn 1 fully committed, ownership MUST still be calendar.
    assert.equal(t1.ownershipAfterCommit, 'calendar')

    // Drop React-style runtime pack — module ownership + sticky must still arm.
    runtimeRef.current = null
    let requestedRange = null
    let coreCalled = false
    const t2 = await runCalendarLocalExchangeTurn({
      text: followUpText,
      languageHint: 'it',
      runtimeRef,
      activeLocalExchangeRef: ownershipRef,
      lastAssistantHadCalendar: Boolean(t1.calendarUi),
      storage,
      inFlightRef,
      timeZone: 'Europe/Rome',
      now,
      requestFn: async (opts) => {
        requestedRange = opts.range || (opts.timeMin ? 'explicit' : null)
        return {
          status: 'empty',
          items: [],
          fetchedAt: now.toISOString(),
          timeZone: 'Europe/Rome',
        }
      },
    })
    if (t2.coreCalled) coreCalled = true
    assert.equal(coreCalled, false)
    assert.equal(t2.coreCalled, false)
    assert.ok(t2.calendarUi)
    assert.equal(t2.intent.dayShiftFollowUp, true)
    if (expectRange) assert.equal(requestedRange, expectRange)
    return { t1, t2, ownershipRef, runtimeRef }
  }

  it('Cosa ho oggi? → E domani? same provider refs (not Core)', async () => {
    await twoTurn('E domani?', memStore(), 'tomorrow')
  })

  it('Cosa ho oggi? → E oggi?', async () => {
    await twoTurn('E oggi?', memStore(), 'today')
  })

  it('Cosa ho oggi? → E dopodomani?', async () => {
    const { t2 } = await twoTurn('E dopodomani?', memStore(), null)
    assert.equal(t2.intent.dayRef, 'day_after_tomorrow')
  })

  it('sessionStorage failure: ownership still routes E domani? to Calendar', async () => {
    await twoTurn('E domani?', failingStore(), 'tomorrow')
  })

  it('fresh chat: bare E domani? is NOT Calendar', async () => {
    resetModuleCalendarRuntimeForTests()
    resetModuleActiveLocalExchangeForTests()
    const t = await runCalendarLocalExchangeTurn({
      text: 'E domani?',
      languageHint: 'it',
      runtimeRef: { current: null },
      activeLocalExchangeRef: { current: null },
      storage: memStore(),
      timeZone: 'Europe/Rome',
      now,
      requestFn: async () => {
        throw new Error('should_not_query')
      },
    })
    assert.equal(t.coreCalled, true)
    assert.equal(t.handled, false)
  })

  it('newChat clears ownership so E domani? is unclaimed', async () => {
    resetModuleActiveLocalExchangeForTests()
    const ownershipRef = { current: null }
    markActiveLocalExchange(ownershipRef, 'calendar')
    assert.equal(isCalendarLocalExchangeActive(ownershipRef), true)
    assert.equal(peekActiveLocalExchange()?.domain, 'calendar')
    markActiveLocalExchange(ownershipRef, null, { reason: 'newChat' })
    assert.equal(isCalendarLocalExchangeActive(ownershipRef), false)
    assert.equal(peekActiveLocalExchange(), null)

    const t = await runCalendarLocalExchangeTurn({
      text: 'E domani?',
      languageHint: 'it',
      runtimeRef: { current: null },
      activeLocalExchangeRef: ownershipRef,
      storage: memStore(),
      timeZone: 'Europe/Rome',
      now,
      requestFn: async () => {
        throw new Error('should_not_query')
      },
    })
    assert.equal(t.coreCalled, true)
  })

  it('resolveCalendarTurnClaim is the ChatContext claim path (source)', () => {
    const chat = read('src/context/ChatContext.tsx')
    assert.match(chat, /resolveCalendarTurnClaim\(/)
    assert.match(chat, /markActiveLocalExchange\(activeLocalExchangeRef,\s*'calendar'\)/)
    assert.match(chat, /clearCalendarLocalExchange\(activeLocalExchangeRef/)
    assert.match(chat, /lastAssistantHadCalendar/)
    assert.match(chat, /peekActiveLocalExchange/)
  })
})

describe('calendar-chat-375U ownership lifecycle (live failure harness)', () => {
  function memStore() {
    const mem = new Map()
    return {
      getItem: (k) => (mem.has(k) ? mem.get(k) : null),
      setItem: (k, v) => {
        mem.set(k, String(v))
      },
      removeItem: (k) => {
        mem.delete(k)
      },
    }
  }
  const now = new Date('2026-08-23T16:00:00.000Z')
  const birthday = {
    id: 'bday',
    title: 'Buon compleanno!',
    start: '2026-08-23',
    end: '2026-08-24',
    allDay: true,
    status: 'confirmed',
  }

  it('module ownership survives React-ref remount; E domani? Core calls = 0', async () => {
    resetModuleCalendarRuntimeForTests()
    resetModuleActiveLocalExchangeForTests()
    const storage = memStore()
    const runtimeRef = { current: null }
    const ownershipRefA = { current: null }

    const t1 = await runCalendarLocalExchangeTurn({
      text: 'Cosa ho oggi?',
      languageHint: 'it',
      runtimeRef,
      activeLocalExchangeRef: ownershipRefA,
      storage,
      timeZone: 'Europe/Rome',
      now,
      requestFn: async () => ({
        status: 'ok',
        items: [birthday],
        fetchedAt: now.toISOString(),
        timeZone: 'Europe/Rome',
      }),
    })
    assert.equal(t1.coreCalled, false)
    assert.equal(peekActiveLocalExchange()?.domain, 'calendar')

    // Simulate ChatProvider remount: brand-new useRef holders, drop storage.
    const ownershipRefB = { current: null }
    const runtimeRefB = { current: null }
    let apiCalls = 0
    const t2 = await runCalendarLocalExchangeTurn({
      text: 'E domani?',
      languageHint: 'it',
      runtimeRef: runtimeRefB,
      activeLocalExchangeRef: ownershipRefB,
      lastAssistantHadCalendar: false,
      storage: {
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {},
      },
      timeZone: 'Europe/Rome',
      now,
      requestFn: async () => {
        apiCalls += 1
        return {
          status: 'empty',
          items: [],
          fetchedAt: now.toISOString(),
          timeZone: 'Europe/Rome',
        }
      },
    })
    assert.equal(t2.coreCalled, false, 'module ownership must claim turn 2')
    assert.equal(apiCalls, 1)
    assert.equal(t2.intent.dayShiftFollowUp, true)
  })

  it('after turn1 commit + UI messages sticky, claim before Core is calendar', () => {
    resetModuleActiveLocalExchangeForTests()
    markActiveLocalExchange({ current: null }, 'calendar')
    // Simulate messages after LOCAL_EXCHANGE reducer commit.
    const messages = [
      { role: 'user', content: 'Cosa ho oggi?' },
      { role: 'assistant', content: 'Oggi hai un impegno.', calendarUi: { kind: 'status', chip: 'Calendar', actions: [] } },
    ]
    let lastAssistantHadCalendar = false
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i]?.role === 'assistant') {
        lastAssistantHadCalendar = Boolean(messages[i].calendarUi)
        break
      }
    }
    // Drop ref (remount) + drop module temporarily to prove sticky alone.
    resetModuleActiveLocalExchangeForTests()
    const claim = resolveCalendarTurnClaim({
      text: 'E domani?',
      languageHint: 'it',
      calendarCtx: null,
      activeLocalExchangeRef: { current: null },
      lastAssistantHadCalendar,
    })
    assert.equal(lastAssistantHadCalendar, true)
    assert.equal(claim.claim, true)
    assert.equal(claim.dayShiftFollowUp, true)
  })

  it('core_fallthrough clear is intentional for non-calendar USER turns', () => {
    resetModuleActiveLocalExchangeForTests()
    const ref = { current: null }
    markActiveLocalExchange(ref, 'calendar')
    clearCalendarLocalExchange(ref, { reason: 'core_fallthrough' })
    assert.equal(isCalendarLocalExchangeActive(ref), false)
    assert.equal(peekActiveLocalExchange(), null)
  })

  it('ChatProvider has no remount key; single provider (source)', () => {
    const app = read('src/App.tsx')
    assert.match(app, /<ChatProvider>/)
    assert.doesNotMatch(app, /<ChatProvider\s+key=/)
    const matches = app.match(/ChatProvider/g) || []
    assert.ok(matches.length >= 2) // import + JSX
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
    const calIdx = ctx.indexOf('Calendar chat before Daily Briefing')
    const chatIdx = ctx.indexOf('runAssistantCompletion(history')
    assert.ok(calIdx > 0)
    assert.ok(chatIdx > calIdx)
    assert.match(ctx, /Never fall through to \/api\/chat/)
    // Matched calendar block returns true before Core
    const block = ctx.slice(calIdx, chatIdx)
    assert.match(block, /claim\.claim/)
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
