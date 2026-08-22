/**
 * #336B regression — action isolation + morning schedule Supabase client await.
 * Run: node --test lib/server/daily-briefing-action-isolation-336b.test.mjs
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import {
  disableMorningBriefingSchedule,
  getMorningBriefingSchedule,
  morningBriefingScheduleOwnerScope,
  upsertMorningBriefingSchedule,
} from './morning-briefing-schedule.js'
import { runCalendarQuery } from './daily-briefing/calendar-query.js'

const root = process.cwd()
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

function makeChain(result) {
  const chain = {
    select() {
      return chain
    },
    eq() {
      return chain
    },
    maybeSingle: async () => result,
    upsert() {
      return chain
    },
    update() {
      return chain
    },
    single: async () => result,
  }
  return chain
}

function makeClient(handlers) {
  const calls = { from: [] }
  return {
    calls,
    client: {
      from(table) {
        calls.from.push(table)
        const h = handlers[table]
        if (!h) throw new Error(`unexpected table ${table}`)
        return typeof h === 'function' ? h() : h
      },
    },
  }
}

describe('morning schedule awaits real Supabase client', () => {
  it('source always awaits getServiceSupabase()', () => {
    const src = read('lib/server/morning-briefing-schedule.js')
    assert.match(src, /await getSb\(\)/)
    assert.doesNotMatch(src, /const supabase = getServiceSupabase\(\)/)
    assert.doesNotMatch(src, /ensureAuthUserRow\(getServiceSupabase\(\)/)
  })

  it('getMorningBriefingSchedule calls .from on awaited client', async () => {
    const scope = morningBriefingScheduleOwnerScope('user-1')
    const { calls, client } = makeClient({
      morning_briefing_schedules: makeChain({ data: null, error: null }),
    })
    let gotPromise = false
    const schedule = await getMorningBriefingSchedule(scope, {
      getServiceSupabase: async () => {
        gotPromise = true
        return client
      },
    })
    assert.equal(gotPromise, true)
    assert.deepEqual(calls.from, ['morning_briefing_schedules'])
    assert.equal(schedule.exists, false)
    assert.equal(schedule.enabled, false)
  })

  it('rejects Promise-as-client the same way the live bug did', async () => {
    const scope = morningBriefingScheduleOwnerScope('user-1')
    await assert.rejects(
      async () => {
        // Simulate the pre-fix regression: factory returns a Promise but caller forgets await.
        const supabase = Promise.resolve({
          from() {
            return makeChain({ data: null, error: null })
          },
        })
        await supabase.from('morning_briefing_schedules')
      },
      (err) => {
        assert.match(String(err?.message || err), /from is not a function/)
        return true
      },
    )
  })

  it('upsert + disable CRUD use awaited client', async () => {
    const scope = morningBriefingScheduleOwnerScope('user-2')
    const row = {
      user_id: 'user-2',
      enabled: true,
      local_time: '08:00',
      days_of_week: [1, 2, 3, 4, 5],
      timezone: 'Europe/Rome',
      last_delivered_local_date: null,
      created_at: '2026-08-21T00:00:00.000Z',
      updated_at: '2026-08-21T00:00:00.000Z',
    }
    let state = null
    const { calls, client } = makeClient({
      users: makeChain({ data: { id: 'user-2' }, error: null }),
      morning_briefing_schedules: {
        select() {
          return this
        },
        eq() {
          return this
        },
        maybeSingle: async () => ({ data: state, error: null }),
        upsert(next) {
          state = { ...row, ...next }
          return this
        },
        update(patch) {
          state = { ...state, ...patch }
          return this
        },
        single: async () => ({ data: state, error: null }),
      },
    })

    const deps = {
      getServiceSupabase: async () => client,
      ensureAuthUserRow: async (sb, id) => {
        assert.equal(typeof sb.from, 'function')
        assert.equal(id, 'user-2')
        return id
      },
    }

    const up = await upsertMorningBriefingSchedule(
      {
        enabled: true,
        localTime: '08:00',
        daysOfWeek: [1, 2, 3, 4, 5],
        timezone: 'Europe/Rome',
      },
      scope,
      deps,
    )
    assert.equal(up.ok, true)
    assert.equal(up.schedule.enabled, true)
    assert.ok(calls.from.includes('morning_briefing_schedules'))

    const off = await disableMorningBriefingSchedule(scope, deps)
    assert.equal(off.ok, true)
    assert.equal(off.schedule.enabled, false)
  })
})

describe('calendar_query action isolation on /api/daily-briefing', () => {
  it('calendar_query branch does not call morning schedule helpers', () => {
    const api = read('api/daily-briefing.ts')
    const calIdx = api.indexOf("safeBody.action === 'calendar_query'")
    const mornPostIdx = api.indexOf('isMorningScheduleAction(safeBody.action)')
    assert.ok(calIdx > 0)
    assert.ok(mornPostIdx > calIdx)

    const calendarBlock = api.slice(calIdx, mornPostIdx)
    assert.match(calendarBlock, /runCalendarQuery/)
    assert.doesNotMatch(calendarBlock, /getMorningBriefingSchedule/)
    assert.doesNotMatch(calendarBlock, /upsertMorningBriefingSchedule/)
    assert.doesNotMatch(calendarBlock, /disableMorningBriefingSchedule/)
    assert.doesNotMatch(calendarBlock, /morningBriefingScheduleOwnerScope/)
    assert.doesNotMatch(calendarBlock, /schedule_unavailable/)
    assert.match(calendarBlock, /calendar_query_failed/)
  })

  it('morning schedule scope is only created inside schedule branches', () => {
    const api = read('api/daily-briefing.ts')
    // Must not create schedule owner scope before action dispatch for all POSTs.
    assert.doesNotMatch(
      api,
      /const scope = morningBriefingScheduleOwnerScope\(user\.userId\)\s*\n\s*\/\/ --- #334D1/,
    )
    assert.match(api, /morning_schedule/)
    assert.match(api, /morningBriefingScheduleOwnerScope\(user\.userId\)/)
  })

  it('calendar client never requests morning_schedule', () => {
    const apiJs = read('src/lib/calendar-chat/api.js')
    assert.match(apiJs, /action:\s*'calendar_query'/)
    assert.doesNotMatch(apiJs, /morning_schedule/)
  })

  it('calendar_query cannot return schedule_unavailable (source contract)', () => {
    const api = read('api/daily-briefing.ts')
    const calStart = api.indexOf("safeBody.action === 'calendar_query'")
    const calEnd = api.indexOf('isMorningScheduleAction(safeBody.action)')
    const block = api.slice(calStart, calEnd)
    assert.doesNotMatch(block, /schedule_unavailable/)
    assert.match(block, /code: 'calendar_query_failed'/)
  })

  it('runCalendarQuery reaches listEvents and stays local on failure', async () => {
    let listed = false
    const pack = await runCalendarQuery('user-cal', {
      timeZone: 'Europe/Rome',
      range: 'tomorrow',
      env: { CALENDAR_ENABLED: 'true' },
      listEventsFn: async () => {
        listed = true
        return { events: [] }
      },
    })
    assert.equal(listed, true)
    assert.equal(pack.status, 'empty')
    assert.ok(['ok', 'empty', 'disabled', 'disconnected', 'reconnect_required', 'timeout', 'error'].includes(pack.status))
  })

  it('Calendar failure does not depend on morning schedule module', async () => {
    const { CalendarError } = await import('./calendar-errors.js')
    const pack = await runCalendarQuery('user-cal', {
      timeZone: 'Europe/Rome',
      range: 'tomorrow',
      env: { CALENDAR_ENABLED: 'true' },
      listEventsFn: async () => {
        throw new CalendarError('google_unavailable', 'boom')
      },
    })
    assert.equal(pack.status, 'error')
    assert.equal(pack.failureCode, 'google_unavailable')
  })

  it('no /api/chat calendar fallback', () => {
    const chat = read('api/chat.ts')
    assert.doesNotMatch(chat, /listEvents|calendar-read|calendar_query|schedule_unavailable/)
  })

  it('normal daily briefing path remains distinct from calendar_query', () => {
    const api = read('api/daily-briefing.ts')
    assert.match(api, /buildDailyBriefingServerPayload/)
    const calIdx = api.indexOf("safeBody.action === 'calendar_query'")
    // Invocation site (not the import line) must run after calendar_query early-return.
    const callIdx = api.indexOf('await buildDailyBriefingServerPayload')
    assert.ok(calIdx > 0)
    assert.ok(callIdx > calIdx)
  })
})
