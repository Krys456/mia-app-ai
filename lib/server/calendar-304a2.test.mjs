/**
 * #304A2 — Google Calendar Read Service (mocked).
 * Run: node --experimental-strip-types --test lib/server/calendar-304a2.test.mjs
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, it, beforeEach } from 'node:test'
import { pathToFileURL } from 'node:url'

const root = process.cwd()
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

const vercel = JSON.parse(read('vercel.json'))
const deployed = Object.keys(vercel.functions || {})
const chatApi = read('api/chat.ts')
const coreParams = read('lib/server/core-responses-params.js')
const envExample = read('.env.example')
const readmeA2 = read('supabase/migrations/README-304A2-CALENDAR-READ.md')
const smokeSrc = read('scripts/calendar-read-smoke.mjs')
const httpSrc = read('lib/server/calendar-google-http.js')
const readSrc = read('lib/server/calendar-read.js')
const refreshSrc = read('lib/server/calendar-token-refresh.js')
const normalizeSrc = read('lib/server/calendar-normalize.js')
const errorsSrc = read('lib/server/calendar-errors.js')

const USER_A = '11111111-1111-4111-8111-111111111111'
const USER_B = '22222222-2222-4222-8222-222222222222'

function testKeyHex() {
  return 'a'.repeat(64)
}

function baseEnv(extra = {}) {
  return {
    CALENDAR_ENABLED: 'true',
    SHINKAIDO_CALENDAR_ENCRYPTION_KEY: testKeyHex(),
    GOOGLE_OAUTH_CLIENT_ID: 'client-id',
    GOOGLE_OAUTH_CLIENT_SECRET: 'client-secret',
    ...extra,
  }
}

async function enc(plaintext) {
  const crypto = await import(
    pathToFileURL(path.join(root, 'lib/server/calendar-token-crypto.js')).href
  )
  const r = await crypto.encryptToken(plaintext, testKeyHex())
  assert.equal(r.ok, true)
  return r.ciphertext
}

function mockResponse(status, json, headers = {}) {
  const h = new Map(
    Object.entries(headers).map(([k, v]) => [String(k).toLowerCase(), String(v)]),
  )
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name) => h.get(String(name).toLowerCase()) || null,
    },
    json: async () => json,
    text: async () => JSON.stringify(json),
  }
}

/**
 * Chainable supabase mock for calendar_connections.
 */
function createSupabaseMock(rowByUser) {
  /** @type {Array<{ table: string, op: string, filters: Record<string, unknown>, payload?: unknown }>} */
  const calls = []

  function makeBuilder(initial) {
    const state = {
      table: initial.table,
      op: initial.op || 'select',
      filters: {},
      payload: initial.payload,
      wantSingle: false,
    }
    const api = {
      select(cols) {
        state.select = cols
        return api
      },
      update(payload) {
        state.op = 'update'
        state.payload = payload
        return api
      },
      eq(k, v) {
        state.filters[k] = v
        return api
      },
      is(k, v) {
        state.filters[`${k}__is`] = v
        return api
      },
      maybeSingle() {
        state.wantSingle = true
        calls.push({ ...state, filters: { ...state.filters } })
        return Promise.resolve(resolve())
      },
      then(resolveP, rejectP) {
        calls.push({ ...state, filters: { ...state.filters } })
        return Promise.resolve(resolve()).then(resolveP, rejectP)
      },
    }
    function resolve() {
      const uid = state.filters.user_id
      const provider = state.filters.provider
      if (provider && provider !== 'google') {
        return { data: null, error: null }
      }
      if (state.op === 'select') {
        const row = rowByUser.get(uid) || null
        return { data: row ? { ...row } : null, error: null }
      }
      if (state.op === 'update') {
        const row = rowByUser.get(uid)
        if (!row) return { data: null, error: null }
        if (state.filters.id && row.id !== state.filters.id) {
          return { data: null, error: null }
        }
        if ('token_expires_at' in state.filters) {
          if (row.token_expires_at !== state.filters.token_expires_at) {
            return { data: null, error: null }
          }
        }
        if ('token_expires_at__is' in state.filters) {
          if (row.token_expires_at != null) return { data: null, error: null }
        }
        Object.assign(row, state.payload)
        return { data: { ...row }, error: null }
      }
      return { data: null, error: null }
    }
    return api
  }

  return {
    calls,
    from(table) {
      return makeBuilder({ table, op: 'select' })
    },
    rowByUser,
  }
}

describe('#304A2 file surface + readonly guarantees', () => {
  it('adds only lib/server calendar read modules + smoke + docs', () => {
    for (const rel of [
      'lib/server/calendar-errors.js',
      'lib/server/calendar-normalize.js',
      'lib/server/calendar-google-http.js',
      'lib/server/calendar-token-refresh.js',
      'lib/server/calendar-read.js',
      'scripts/calendar-read-smoke.mjs',
      'supabase/migrations/README-304A2-CALENDAR-READ.md',
    ]) {
      assert.equal(fs.existsSync(path.join(root, rel)), true, rel)
    }
  })

  it('does not add Vercel calendar routes or schema migration', () => {
    assert.equal(deployed.length, 13)
    assert.ok(!deployed.some((f) => f.includes('calendar')))
    assert.equal(fs.existsSync(path.join(root, 'api/calendar.ts')), false)
    const migrations = fs.readdirSync(path.join(root, 'supabase/migrations'))
    assert.ok(!migrations.some((f) => /304a2/i.test(f) && f.endsWith('.sql')))
  })

  it('does not wire Calendar into /api/chat', () => {
    assert.doesNotMatch(chatApi, /listCalendars|listEvents|freeBusy|calendar-read/)
    assert.match(readSrc, /NOT wired into \/api\/chat/)
  })

  it('allowlists only read Google Calendar endpoints + FreeBusy + token', () => {
    assert.match(httpSrc, /www\.googleapis\.com/)
    assert.match(httpSrc, /oauth2\.googleapis\.com/)
    assert.match(httpSrc, /calendarList/)
    assert.match(httpSrc, /freeBusy/)
    assert.match(httpSrc, /singleEvents/)
    assert.match(httpSrc, /orderBy/)
    assert.match(httpSrc, /method !== 'GET'/)
    assert.match(httpSrc, /path\.includes\('\/acl'\)/)
    assert.doesNotMatch(httpSrc, /events:insert|events\.insert/)
    assert.doesNotMatch(
      httpSrc,
      /googleapis\.com\/calendar\/v3\/calendars\/[^'"\s]+\/events['"`]\s*,\s*\{\s*method:\s*['"]POST['"]/,
    )
  })

  it('documents env + smoke; never auto-runs live Google', () => {
    assert.match(envExample, /#304A2/)
    assert.match(envExample, /CALENDAR_SMOKE_USER_ID/)
    assert.match(readmeA2, /No migration/)
    assert.match(readmeA2, /#304A3/)
    assert.match(smokeSrc, /CALENDAR_SMOKE_USER_ID/)
    assert.doesNotMatch(smokeSrc, /process\.env\.ACCESS_TOKEN|console\.log\([^)]*token/i)
  })
})

describe('#304A2 errors + sanitize + range', () => {
  it('exposes safe CalendarError codes only', async () => {
    const mod = await import(pathToFileURL(path.join(root, 'lib/server/calendar-errors.js')).href)
    assert.ok(mod.CALENDAR_ERROR_CODES.includes('owner_required'))
    assert.ok(mod.CALENDAR_ERROR_CODES.includes('reconnect_required'))
    assert.ok(mod.CALENDAR_ERROR_CODES.includes('range_too_large'))
    const e = new mod.CalendarError('not_a_real_code', 'leak google body xyz')
    assert.equal(e.code, 'google_unavailable')
    assert.match(errorsSrc, /owner_required/)
  })

  it('sanitizes titles: NFC, control/bidi strip, truncate', async () => {
    const mod = await import(pathToFileURL(path.join(root, 'lib/server/calendar-normalize.js')).href)
    const dirty = `Meet\u202E\u0001${'X'.repeat(200)}`
    const title = mod.sanitizeEventTitle(dirty)
    assert.ok(!title.includes('\u202E'))
    assert.ok(!title.includes('\u0001'))
    assert.ok(title.length <= 120)
    assert.equal(mod.sanitizeEventTitle(''), '(untitled)')
    assert.equal(mod.sanitizeCalendarSummary(null), '(calendar)')
  })

  it('#375R sanitizeTimeZone rejects Etc/GMT* (inverted POSIX)', async () => {
    const mod = await import(pathToFileURL(path.join(root, 'lib/server/calendar-normalize.js')).href)
    assert.equal(mod.sanitizeTimeZone('Europe/Rome'), 'Europe/Rome')
    assert.equal(mod.sanitizeTimeZone('UTC'), 'UTC')
    assert.equal(mod.sanitizeTimeZone('Etc/GMT+12'), null)
    assert.equal(mod.sanitizeTimeZone('Etc/GMT-1'), null)
    assert.equal(mod.isUnreliableCalendarTimeZone('Etc/GMT+12'), true)
  })

  it('rejects invalid and oversized ranges', async () => {
    const mod = await import(pathToFileURL(path.join(root, 'lib/server/calendar-normalize.js')).href)
    assert.throws(
      () =>
        mod.resolveEventRange({
          timeMin: '2026-01-01T00:00:00.000Z',
          timeMax: '2026-03-01T00:00:00.000Z',
          timeZone: 'UTC',
        }),
      (e) => e.code === 'range_too_large',
    )
    assert.throws(
      () =>
        mod.resolveEventRange({
          timeMin: 'bad',
          timeMax: 'also-bad',
          timeZone: 'UTC',
        }),
      (e) => e.code === 'invalid_range',
    )
  })

  it('resolves today/tomorrow/week/next with IANA timezone', async () => {
    const mod = await import(pathToFileURL(path.join(root, 'lib/server/calendar-normalize.js')).href)
    const now = new Date('2026-03-08T15:00:00.000Z') // DST spring US
    const r = mod.resolveEventRange({ range: 'tomorrow', timeZone: 'America/New_York', now })
    assert.ok(r.timeMin < r.timeMax)
    assert.equal(r.timeZone, 'America/New_York')
    const week = mod.resolveEventRange({ range: 'week', timeZone: 'Europe/Rome', now })
    const spanDays = (Date.parse(week.timeMax) - Date.parse(week.timeMin)) / 86400000
    assert.ok(spanDays >= 6.9 && spanDays <= 7.1)
  })

  it('normalizes timed, all-day, skips cancelled/malformed', async () => {
    const mod = await import(pathToFileURL(path.join(root, 'lib/server/calendar-normalize.js')).href)
    assert.equal(mod.normalizeGoogleEvent({ id: 'c', status: 'cancelled', start: {}, end: {} }, 'cal'), null)
    assert.equal(mod.normalizeGoogleEvent({ summary: 'x' }, 'cal'), null)
    const timed = mod.normalizeGoogleEvent(
      {
        id: 'e1',
        status: 'confirmed',
        summary: 'Standup',
        start: { dateTime: '2026-08-19T09:00:00-04:00', timeZone: 'America/New_York' },
        end: { dateTime: '2026-08-19T09:30:00-04:00', timeZone: 'America/New_York' },
        description: 'SECRET',
        attendees: [{ email: 'a@b.com' }],
        location: 'Room',
      },
      'primary',
    )
    assert.equal(timed.title, 'Standup')
    assert.equal(timed.allDay, false)
    assert.ok(timed.start.endsWith('Z'))
    assert.equal(timed.description, undefined)
    assert.equal(timed.attendees, undefined)
    const allDay = mod.normalizeGoogleEvent(
      {
        id: 'e2',
        summary: 'Holiday',
        start: { date: '2026-12-25' },
        end: { date: '2026-12-26' },
      },
      'primary',
    )
    assert.equal(allDay.allDay, true)
    assert.equal(allDay.start, '2026-12-25')
    assert.equal(allDay.end, '2026-12-26')
  })

  it('all-day day membership uses exclusive end.date (#375M)', async () => {
    const mod = await import(pathToFileURL(path.join(root, 'lib/server/calendar-normalize.js')).href)
    const single = { allDay: true, start: '2026-08-23', end: '2026-08-24' }
    const multi = { allDay: true, start: '2026-08-23', end: '2026-08-25' }
    assert.equal(mod.allDayEventIncludesYmd(single, '2026-08-23'), true)
    assert.equal(mod.allDayEventIncludesYmd(single, '2026-08-24'), false)
    assert.equal(mod.allDayEventIncludesYmd(multi, '2026-08-23'), true)
    assert.equal(mod.allDayEventIncludesYmd(multi, '2026-08-24'), true)
    assert.equal(mod.allDayEventIncludesYmd(multi, '2026-08-25'), false)
    assert.equal(mod.resolveDayScopedYmd({ range: 'tomorrow', timeZone: 'Europe/Rome', now: new Date('2026-08-23T15:00:00+02:00') }), '2026-08-24')
    assert.equal(mod.resolveDayScopedYmd({ range: 'week', timeZone: 'Europe/Rome', now: new Date('2026-08-23T15:00:00+02:00') }), null)
    // Single-day weekday window via timeMin/timeMax
    const monStart = mod.startOfZonedDayUtc('2026-08-24', 'Europe/Rome')
    const monEnd = mod.startOfZonedDayUtc('2026-08-25', 'Europe/Rome')
    assert.equal(
      mod.resolveDayScopedYmd({
        timeZone: 'Europe/Rome',
        timeMin: monStart.toISOString(),
        timeMax: monEnd.toISOString(),
      }),
      '2026-08-24',
    )
    const filtered = mod.filterEventsForAllDayDayMembership([single], '2026-08-24')
    assert.equal(filtered.length, 0)
  })
})

describe('#304A2 Google HTTP client', () => {
  it('rejects non-allowlisted hosts and write-shaped event methods', async () => {
    const mod = await import(pathToFileURL(path.join(root, 'lib/server/calendar-google-http.js')).href)
    await assert.rejects(
      () => mod.googleFetchJson({ url: 'https://evil.example/x', method: 'GET' }),
      (e) => e.code === 'google_unavailable',
    )
    await assert.rejects(
      () =>
        mod.googleFetchJson({
          url: 'https://www.googleapis.com/calendar/v3/calendars/primary/events',
          method: 'POST',
          body: '{}',
        }),
      (e) => e.code === 'google_forbidden',
    )
    await assert.rejects(
      () =>
        mod.googleFetchJson({
          url: 'https://www.googleapis.com/calendar/v3/calendars/primary/acl',
          method: 'GET',
        }),
      (e) => e.code === 'google_forbidden',
    )
  })

  it('maps 401/403/timeout and retries 429 once with Retry-After cap', async () => {
    const mod = await import(pathToFileURL(path.join(root, 'lib/server/calendar-google-http.js')).href)
    let calls401 = 0
    await assert.rejects(
      () =>
        mod.googleFetchJson({
          url: 'https://www.googleapis.com/calendar/v3/users/me/calendarList',
          fetchImpl: async () => {
            calls401 += 1
            return mockResponse(401, { error: 'nope' })
          },
        }),
      (e) => e.code === 'google_unauthorized',
    )
    assert.equal(calls401, 1)

    let calls429 = 0
    const ok = await mod.googleFetchJson({
      url: 'https://www.googleapis.com/calendar/v3/users/me/calendarList',
      fetchImpl: async () => {
        calls429 += 1
        if (calls429 === 1) return mockResponse(429, { error: 'rate' }, { 'retry-after': '1' })
        return mockResponse(200, { items: [] })
      },
    })
    assert.equal(calls429, 2)
    assert.equal(ok.ok, true)

    await assert.rejects(
      () =>
        mod.googleFetchJson({
          url: 'https://www.googleapis.com/calendar/v3/users/me/calendarList',
          timeoutMs: 20,
          fetchImpl: async (_url, init) =>
            new Promise((_, reject) => {
              init.signal.addEventListener('abort', () => {
                const err = new Error('aborted')
                err.name = 'AbortError'
                reject(err)
              })
            }),
        }),
      (e) => e.code === 'google_timeout',
    )
  })

  it('retries 5xx once and does not retry 400', async () => {
    const mod = await import(pathToFileURL(path.join(root, 'lib/server/calendar-google-http.js')).href)
    let n5 = 0
    await assert.rejects(
      () =>
        mod.googleFetchJson({
          url: 'https://www.googleapis.com/calendar/v3/freeBusy',
          method: 'POST',
          body: '{}',
          fetchImpl: async () => {
            n5 += 1
            return mockResponse(503, { error: 'down' })
          },
        }),
      (e) => e.code === 'google_unavailable',
    )
    assert.equal(n5, 2)

    let n4 = 0
    await assert.rejects(
      () =>
        mod.googleFetchJson({
          url: 'https://www.googleapis.com/calendar/v3/users/me/calendarList',
          fetchImpl: async () => {
            n4 += 1
            return mockResponse(400, { error: 'bad' })
          },
        }),
      (e) => e.code === 'google_unavailable',
    )
    assert.equal(n4, 1)
  })
})

describe('#304A2 token refresh + ownership', () => {
  beforeEach(async () => {
    const refresh = await import(
      pathToFileURL(path.join(root, 'lib/server/calendar-token-refresh.js')).href
    )
    refresh.resetCalendarRefreshInFlightForTests()
  })

  it('requires owner and feature gate', async () => {
    const refresh = await import(
      pathToFileURL(path.join(root, 'lib/server/calendar-token-refresh.js')).href
    )
    await assert.rejects(
      () => refresh.getValidGoogleAccessToken({ userId: '', env: baseEnv() }),
      (e) => e.code === 'owner_required',
    )
    await assert.rejects(
      () =>
        refresh.getValidGoogleAccessToken({
          userId: USER_A,
          env: baseEnv({ CALENDAR_ENABLED: 'false' }),
        }),
      (e) => e.code === 'calendar_disabled',
    )
  })

  it('connected valid token decrypts without refresh', async () => {
    const refresh = await import(
      pathToFileURL(path.join(root, 'lib/server/calendar-token-refresh.js')).href
    )
    const accessEnc = await enc('access-live')
    const refreshEnc = await enc('refresh-live')
    const row = {
      id: 'row-a',
      user_id: USER_A,
      status: 'connected',
      access_token_enc: accessEnc,
      refresh_token_enc: refreshEnc,
      token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
      selected_calendar_ids: null,
    }
    const sb = createSupabaseMock(new Map([[USER_A, row]]))
    let fetchCalls = 0
    const out = await refresh.getValidGoogleAccessToken({
      userId: USER_A,
      supabase: sb,
      env: baseEnv(),
      fetchImpl: async () => {
        fetchCalls += 1
        return mockResponse(500, {})
      },
    })
    assert.equal(out.accessToken, 'access-live')
    assert.equal(out.refreshed, false)
    assert.equal(fetchCalls, 0)
    assert.equal(sb.calls[0].filters.user_id, USER_A)
    assert.equal(sb.calls[0].filters.provider, 'google')
  })

  it('disconnected / reconnect_required / missing row', async () => {
    const refresh = await import(
      pathToFileURL(path.join(root, 'lib/server/calendar-token-refresh.js')).href
    )
    for (const status of ['disconnected', 'pending', 'error']) {
      const sb = createSupabaseMock(
        new Map([
          [
            USER_A,
            {
              id: '1',
              user_id: USER_A,
              status,
              access_token_enc: await enc('a'),
              refresh_token_enc: await enc('r'),
              token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
            },
          ],
        ]),
      )
      await assert.rejects(
        () =>
          refresh.getValidGoogleAccessToken({
            userId: USER_A,
            supabase: sb,
            env: baseEnv(),
          }),
        (e) => e.code === 'not_connected',
      )
    }
    const sb2 = createSupabaseMock(
      new Map([
        [
          USER_A,
          {
            id: '1',
            user_id: USER_A,
            status: 'reconnect_required',
            access_token_enc: null,
            refresh_token_enc: await enc('r'),
            token_expires_at: null,
          },
        ],
      ]),
    )
    await assert.rejects(
      () =>
        refresh.getValidGoogleAccessToken({
          userId: USER_A,
          supabase: sb2,
          env: baseEnv(),
        }),
      (e) => e.code === 'reconnect_required',
    )
    const sb3 = createSupabaseMock(new Map())
    await assert.rejects(
      () =>
        refresh.getValidGoogleAccessToken({
          userId: USER_A,
          supabase: sb3,
          env: baseEnv(),
        }),
      (e) => e.code === 'not_connected',
    )
  })

  it('owner isolation: user B cannot load user A row', async () => {
    const refresh = await import(
      pathToFileURL(path.join(root, 'lib/server/calendar-token-refresh.js')).href
    )
    const rowA = {
      id: 'row-a',
      user_id: USER_A,
      status: 'connected',
      access_token_enc: await enc('access-a'),
      refresh_token_enc: await enc('refresh-a'),
      token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
    }
    const sb = createSupabaseMock(new Map([[USER_A, rowA]]))
    await assert.rejects(
      () =>
        refresh.getValidGoogleAccessToken({
          userId: USER_B,
          supabase: sb,
          env: baseEnv(),
        }),
      (e) => e.code === 'not_connected',
    )
  })

  it('refreshes expired token, preserves refresh token, replaces when Google returns new', async () => {
    const refresh = await import(
      pathToFileURL(path.join(root, 'lib/server/calendar-token-refresh.js')).href
    )
    const accessEnc = await enc('old-access')
    const refreshEnc = await enc('old-refresh')
    const row = {
      id: 'row-a',
      user_id: USER_A,
      status: 'connected',
      access_token_enc: accessEnc,
      refresh_token_enc: refreshEnc,
      token_expires_at: new Date(Date.now() - 1000).toISOString(),
      selected_calendar_ids: null,
    }
    const sb = createSupabaseMock(new Map([[USER_A, row]]))
    const out = await refresh.getValidGoogleAccessToken({
      userId: USER_A,
      supabase: sb,
      env: baseEnv(),
      now: new Date(),
      fetchImpl: async (url, init) => {
        assert.match(String(url), /oauth2\.googleapis\.com\/token/)
        assert.equal(init.method, 'POST')
        assert.doesNotMatch(String(init.body), /old-access/)
        return mockResponse(200, {
          access_token: 'new-access',
          expires_in: 3600,
        })
      },
    })
    assert.equal(out.accessToken, 'new-access')
    assert.equal(out.refreshed, true)
    assert.equal(row.refresh_token_enc, refreshEnc)

    // Replacement refresh token
    refresh.resetCalendarRefreshInFlightForTests()
    const row2 = {
      id: 'row-a',
      user_id: USER_A,
      status: 'connected',
      access_token_enc: accessEnc,
      refresh_token_enc: refreshEnc,
      token_expires_at: new Date(Date.now() - 1000).toISOString(),
    }
    const sb2 = createSupabaseMock(new Map([[USER_A, row2]]))
    await refresh.getValidGoogleAccessToken({
      userId: USER_A,
      supabase: sb2,
      env: baseEnv(),
      fetchImpl: async () =>
        mockResponse(200, {
          access_token: 'new-access-2',
          refresh_token: 'brand-new-refresh',
          expires_in: 3600,
        }),
    })
    assert.notEqual(row2.refresh_token_enc, refreshEnc)
  })

  it('invalid_grant marks reconnect_required; encryption failure typed', async () => {
    const refresh = await import(
      pathToFileURL(path.join(root, 'lib/server/calendar-token-refresh.js')).href
    )
    const row = {
      id: 'row-a',
      user_id: USER_A,
      status: 'connected',
      access_token_enc: await enc('old'),
      refresh_token_enc: await enc('refresh'),
      token_expires_at: new Date(Date.now() - 1000).toISOString(),
    }
    const sb = createSupabaseMock(new Map([[USER_A, row]]))
    await assert.rejects(
      () =>
        refresh.getValidGoogleAccessToken({
          userId: USER_A,
          supabase: sb,
          env: baseEnv(),
          fetchImpl: async () => mockResponse(400, { error: 'invalid_grant' }),
        }),
      (e) => e.code === 'reconnect_required',
    )
    assert.equal(row.status, 'reconnect_required')

    refresh.resetCalendarRefreshInFlightForTests()
    const row2 = {
      id: 'row-a',
      user_id: USER_A,
      status: 'connected',
      access_token_enc: 'not-valid-ciphertext',
      refresh_token_enc: await enc('refresh'),
      token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
    }
    const sb2 = createSupabaseMock(new Map([[USER_A, row2]]))
    await assert.rejects(
      () =>
        refresh.getValidGoogleAccessToken({
          userId: USER_A,
          supabase: sb2,
          env: baseEnv(),
        }),
      (e) => e.code === 'encryption_failure',
    )
  })

  it('never logs token material in refresh module source', () => {
    assert.doesNotMatch(refreshSrc, /console\.log\([^)]*accessToken|console\.log\([^)]*refresh_token/)
    assert.doesNotMatch(refreshSrc, /JSON\.stringify\(tokenJson\)/)
  })
})

describe('#304A2 listCalendars / listEvents / freeBusy', () => {
  beforeEach(async () => {
    const refresh = await import(
      pathToFileURL(path.join(root, 'lib/server/calendar-token-refresh.js')).href
    )
    refresh.resetCalendarRefreshInFlightForTests()
  })

  async function connectedSb(extra = {}, nowMs = Date.now()) {
    const row = {
      id: 'row-a',
      user_id: USER_A,
      status: 'connected',
      access_token_enc: await enc('access-live'),
      refresh_token_enc: await enc('refresh-live'),
      token_expires_at: new Date(nowMs + 3600_000).toISOString(),
      selected_calendar_ids: null,
      ...extra,
    }
    return { row, sb: createSupabaseMock(new Map([[USER_A, row]])) }
  }

  it('listCalendars: primary selected by default, caps at 20, sanitizes names', async () => {
    const cal = await import(pathToFileURL(path.join(root, 'lib/server/calendar-read.js')).href)
    const { sb } = await connectedSb()
    const items = []
    for (let i = 0; i < 25; i += 1) {
      items.push({
        id: `cal-${i}`,
        summary: i === 0 ? `Primary\u202E${'Z'.repeat(200)}` : `Cal ${i}`,
        primary: i === 0,
        timeZone: 'UTC',
      })
    }
    const out = await cal.listCalendars(USER_A, {
      supabase: sb,
      env: baseEnv(),
      fetchImpl: async (url) => {
        assert.match(String(url), /calendarList/)
        return mockResponse(200, { items })
      },
    })
    assert.equal(out.calendars.length, 20)
    assert.equal(out.calendars[0].selected, true)
    assert.ok(out.calendars[0].summary.length <= 120)
    assert.ok(!out.calendars[0].summary.includes('\u202E'))
    assert.equal(out.calendars.filter((c) => c.selected).length, 1)
  })

  it('selected_calendar_ids validated; inaccessible skipped; empty when none remain', async () => {
    const cal = await import(pathToFileURL(path.join(root, 'lib/server/calendar-read.js')).href)
    const { sb } = await connectedSb({
      selected_calendar_ids: ['cal-1', 'missing', 'cal-2', '', null, 'cal-x', 'cal-3', 'cal-4', 'cal-5', 'cal-6'],
    })
    const items = [
      { id: 'primary', summary: 'P', primary: true, timeZone: 'UTC' },
      { id: 'cal-1', summary: 'One', timeZone: 'UTC' },
      { id: 'cal-2', summary: 'Two', timeZone: 'UTC' },
      { id: 'cal-3', summary: 'Three', timeZone: 'UTC' },
      { id: 'cal-4', summary: 'Four', timeZone: 'UTC' },
      { id: 'cal-5', summary: 'Five', timeZone: 'UTC' },
      { id: 'cal-6', summary: 'Six', timeZone: 'UTC' },
    ]
    const listed = await cal.listCalendars(USER_A, {
      supabase: sb,
      env: baseEnv(),
      fetchImpl: async () => mockResponse(200, { items }),
    })
    const selected = listed.calendars.filter((c) => c.selected).map((c) => c.id)
    assert.deepEqual(selected, ['cal-1', 'cal-2', 'cal-3', 'cal-4', 'cal-5'])

    const fixedNow = new Date('2026-08-19T12:00:00.000Z')
    const { sb: sbEmpty } = await connectedSb(
      { selected_calendar_ids: ['nope'] },
      fixedNow.getTime(),
    )
    const events = await cal.listEvents(USER_A, {
      range: 'today',
      timeZone: 'UTC',
      supabase: sbEmpty,
      env: baseEnv(),
      now: fixedNow,
      fetchImpl: async (url) => {
        if (String(url).includes('calendarList')) {
          return mockResponse(200, { items: [{ id: 'primary', summary: 'P', primary: true }] })
        }
        throw new Error('should not query events when no calendars selected')
      },
    })
    assert.deepEqual(events.events, [])
  })

  it('listEvents: merges calendars, sorts, caps 40, excludes cancelled, next returns one', async () => {
    const cal = await import(pathToFileURL(path.join(root, 'lib/server/calendar-read.js')).href)
    const fixedNow = new Date('2026-08-19T08:00:00.000Z')
    const { sb } = await connectedSb(
      { selected_calendar_ids: ['cal-a', 'cal-b'] },
      fixedNow.getTime(),
    )
    const many = []
    for (let i = 0; i < 45; i += 1) {
      const start = new Date(Date.UTC(2026, 7, 19, 10, 0, 0) + i * 60_000)
      const end = new Date(start.getTime() + 30_000)
      many.push({
        id: `a-${i}`,
        summary: `A${i}`,
        status: 'confirmed',
        start: { dateTime: start.toISOString() },
        end: { dateTime: end.toISOString() },
      })
    }
    const out = await cal.listEvents(USER_A, {
      range: 'today',
      timeZone: 'UTC',
      supabase: sb,
      env: baseEnv(),
      now: fixedNow,
      fetchImpl: async (url) => {
        const u = String(url)
        if (u.includes('calendarList')) {
          return mockResponse(200, {
            items: [
              { id: 'cal-a', summary: 'A', primary: true, timeZone: 'UTC' },
              { id: 'cal-b', summary: 'B', timeZone: 'UTC' },
            ],
          })
        }
        if (u.includes('/calendars/cal-a/events')) {
          return mockResponse(200, {
            items: [
              ...many,
              {
                id: 'cancelled',
                status: 'cancelled',
                summary: 'Nope',
                start: { dateTime: '2026-08-19T09:00:00Z' },
                end: { dateTime: '2026-08-19T10:00:00Z' },
              },
              { id: 'bad', summary: 'x' },
            ],
          })
        }
        if (u.includes('/calendars/cal-b/events')) {
          return mockResponse(200, {
            items: [
              {
                id: 'b1',
                summary: 'Early B',
                start: { dateTime: '2026-08-19T07:00:00Z' },
                end: { dateTime: '2026-08-19T07:30:00Z' },
              },
              {
                id: 'recurring-instance',
                summary: 'Recurring',
                recurringEventId: 'series',
                start: { dateTime: '2026-08-19T09:05:00Z' },
                end: { dateTime: '2026-08-19T09:20:00Z' },
              },
            ],
          })
        }
        return mockResponse(404, {})
      },
    })
    assert.equal(out.events.length, 40)
    assert.equal(out.events[0].id, 'b1')
    assert.ok(!out.events.some((e) => e.id === 'cancelled'))
    assert.ok(out.events.some((e) => e.id === 'recurring-instance'))
    for (let i = 1; i < out.events.length; i += 1) {
      assert.ok(
        Date.parse(out.events[i - 1].start) <= Date.parse(out.events[i].start),
        `sort break at ${i}`,
      )
    }

    const next = await cal.listEvents(USER_A, {
      range: 'next',
      timeZone: 'UTC',
      supabase: sb,
      env: baseEnv(),
      now: fixedNow,
      fetchImpl: async (url) => {
        if (String(url).includes('calendarList')) {
          return mockResponse(200, {
            items: [
              { id: 'cal-a', summary: 'A', primary: true, timeZone: 'UTC' },
              { id: 'cal-b', summary: 'B', timeZone: 'UTC' },
            ],
          })
        }
        return mockResponse(200, {
          items: [
            {
              id: 'soon',
              summary: 'Soon',
              start: { dateTime: '2026-08-19T09:00:00Z' },
              end: { dateTime: '2026-08-19T09:30:00Z' },
            },
          ],
        })
      },
    })
    assert.equal(next.events.length, 1)
  })

  it('listEvents rejects >31 day range; empty calendars OK', async () => {
    const cal = await import(pathToFileURL(path.join(root, 'lib/server/calendar-read.js')).href)
    const { sb } = await connectedSb()
    await assert.rejects(
      () =>
        cal.listEvents(USER_A, {
          timeMin: '2026-01-01T00:00:00.000Z',
          timeMax: '2026-03-15T00:00:00.000Z',
          supabase: sb,
          env: baseEnv(),
          fetchImpl: async () =>
            mockResponse(200, { items: [{ id: 'primary', summary: 'P', primary: true }] }),
        }),
      (e) => e.code === 'range_too_large',
    )
  })

  it('freeBusy returns normalized busy ranges; free calendars empty busy', async () => {
    const cal = await import(pathToFileURL(path.join(root, 'lib/server/calendar-read.js')).href)
    const { sb } = await connectedSb({
      selected_calendar_ids: ['cal-a', 'cal-b'],
    })
    const out = await cal.freeBusy(USER_A, {
      timeMin: '2026-08-19T00:00:00.000Z',
      timeMax: '2026-08-20T00:00:00.000Z',
      timeZone: 'UTC',
      supabase: sb,
      env: baseEnv(),
      fetchImpl: async (url, init) => {
        const u = String(url)
        if (u.includes('calendarList')) {
          return mockResponse(200, {
            items: [
              { id: 'cal-a', summary: 'A', primary: true, timeZone: 'UTC' },
              { id: 'cal-b', summary: 'B', timeZone: 'UTC' },
            ],
          })
        }
        assert.match(u, /freeBusy/)
        assert.equal(init.method, 'POST')
        return mockResponse(200, {
          calendars: {
            'cal-a': {
              busy: [{ start: '2026-08-19T10:00:00Z', end: '2026-08-19T11:00:00Z' }],
            },
            'cal-b': { busy: [] },
          },
        })
      },
    })
    assert.equal(out.calendars.length, 2)
    assert.equal(out.calendars[0].busy.length, 1)
    assert.equal(out.calendars[1].busy.length, 0)
    assert.ok(out.calendars[0].busy[0].start.endsWith('Z'))
  })

  it('freeBusy invalid range; partial missing calendar entries safe', async () => {
    const cal = await import(pathToFileURL(path.join(root, 'lib/server/calendar-read.js')).href)
    const { sb } = await connectedSb()
    await assert.rejects(
      () =>
        cal.freeBusy(USER_A, {
          timeMin: 'nope',
          timeMax: 'still-nope',
          supabase: sb,
          env: baseEnv(),
        }),
      (e) => e.code === 'invalid_range',
    )

    const { sb: sb2 } = await connectedSb({ selected_calendar_ids: ['cal-a', 'cal-b'] })
    const out = await cal.freeBusy(USER_A, {
      timeMin: '2026-08-19T00:00:00.000Z',
      timeMax: '2026-08-20T00:00:00.000Z',
      supabase: sb2,
      env: baseEnv(),
      fetchImpl: async (url) => {
        if (String(url).includes('calendarList')) {
          return mockResponse(200, {
            items: [
              { id: 'cal-a', summary: 'A', primary: true },
              { id: 'cal-b', summary: 'B' },
            ],
          })
        }
        return mockResponse(200, { calendars: { 'cal-a': { busy: [] } } })
      },
    })
    assert.equal(out.calendars.length, 2)
    assert.deepEqual(out.calendars[1].busy, [])
  })
})

describe('#304A2 regressions (#304A1 / #303 / Core / Memory / Vision / Privacy)', () => {
  it('keeps 11 Vercel functions and Core invariants', () => {
    assert.equal(deployed.length, 13)
    assert.ok(deployed.includes('api/chat.ts'))
    assert.ok(deployed.includes('api/daily-briefing.ts'))
    assert.ok((chatApi.match(/\.responses\.create\(/g) || []).length >= 1)
    assert.match(chatApi, /maxDuration:\s*120/)
    assert.match(coreParams, /stream:\s*false/)
    assert.match(coreParams, /effort:\s*['"]none['"]/)
  })

  it('does not regress #304A1 OAuth / encryption / Edge', () => {
    assert.equal(fs.existsSync(path.join(root, 'lib/server/calendar-304a1.test.mjs')), true)
    assert.equal(fs.existsSync(path.join(root, 'supabase/functions/calendar-oauth-start/index.ts')), true)
    assert.equal(fs.existsSync(path.join(root, 'supabase/functions/calendar-oauth-callback/index.ts')), true)
    assert.equal(fs.existsSync(path.join(root, 'supabase/functions/calendar-connection/index.ts')), true)
    assert.match(read('lib/server/calendar-oauth.js'), /calendar\.readonly/)
    assert.match(read('supabase/migrations/20260819090000_calendar_connections_304a1.sql'), /calendar_connections/)
  })

  it('does not regress reminders / push / memory surfaces', () => {
    assert.match(read('supabase/migrations/20260818053000_reminders_303a.sql'), /CREATE TABLE IF NOT EXISTS public\.reminders/)
    assert.match(read('supabase/migrations/20260818120000_reminders_push_303c.sql'), /push_subscriptions/)
    assert.equal(fs.existsSync(path.join(root, 'api/memories/index.ts')), true)
    assert.equal(fs.existsSync(path.join(root, 'api/reminders/index.ts')), true)
  })

  it('does not add Vision API route or Privacy regression hooks in chat', () => {
    assert.equal(fs.existsSync(path.join(root, 'api/vision.ts')), false)
    assert.doesNotMatch(chatApi, /calendar-read|listCalendars/)
    assert.match(read('src/lib/privacyCopy.ts'), /googleCalendar|Calendar/)
  })

  it('source never logs titles/tokens/raw Google bodies', () => {
    for (const src of [readSrc, refreshSrc, httpSrc, normalizeSrc]) {
      assert.doesNotMatch(src, /console\.log\([^)]*summary|console\.log\([^)]*title/)
      assert.doesNotMatch(src, /console\.log\([^)]*access_token|console\.log\([^)]*ciphertext/)
    }
  })
})
