#!/usr/bin/env node
/**
 * #304A2 — Operator/dev-only Google Calendar READ smoke.
 *
 * NOT a Vercel function. NOT an API route. Do not deploy.
 *
 * Usage:
 *   CALENDAR_ENABLED=true \
 *   CALENDAR_SMOKE_USER_ID=<supabase auth.uid()> \
 *   GOOGLE_OAUTH_CLIENT_ID=… \
 *   GOOGLE_OAUTH_CLIENT_SECRET=… \
 *   SHINKAIDO_CALENDAR_ENCRYPTION_KEY=… \
 *   SUPABASE_URL=… \
 *   SUPABASE_SERVICE_ROLE_KEY=… \
 *   node scripts/calendar-read-smoke.mjs
 *
 * Optional:
 *   CALENDAR_SMOKE_SHOW_NAMES=1   # print truncated calendar summaries / event titles
 *
 * Safe output only: counts + optional truncated names. Never tokens or raw Google JSON.
 */

import { listCalendars, listEvents, freeBusy } from '../lib/server/calendar-read.js'
import { isCalendarError } from '../lib/server/calendar-errors.js'

function requireEnv(name) {
  const v = (process.env[name] || '').trim()
  if (!v) {
    console.error(`[calendar-read-smoke] missing env: ${name}`)
    process.exit(2)
  }
  return v
}

function trunc(s, n = 80) {
  const t = typeof s === 'string' ? s : ''
  return t.length > n ? `${t.slice(0, n)}…` : t
}

async function main() {
  const userId = requireEnv('CALENDAR_SMOKE_USER_ID')
  requireEnv('SHINKAIDO_CALENDAR_ENCRYPTION_KEY')
  requireEnv('GOOGLE_OAUTH_CLIENT_ID')
  requireEnv('GOOGLE_OAUTH_CLIENT_SECRET')
  requireEnv('SUPABASE_URL')
  requireEnv('SUPABASE_SERVICE_ROLE_KEY')

  if (String(process.env.CALENDAR_ENABLED || '').trim().toLowerCase() !== 'true') {
    console.error('[calendar-read-smoke] CALENDAR_ENABLED must be true')
    process.exit(2)
  }

  const showNames = String(process.env.CALENDAR_SMOKE_SHOW_NAMES || '').trim() === '1'
  const requestId = `smoke-${Date.now()}`

  console.log('[calendar-read-smoke] start', { requestId, userIdLen: userId.length })

  const calendars = await listCalendars(userId, { requestId })
  console.log('[calendar-read-smoke] listCalendars', {
    calendarCount: calendars.calendars.length,
    selectedCount: calendars.calendars.filter((c) => c.selected).length,
  })
  if (showNames) {
    for (const c of calendars.calendars.slice(0, 10)) {
      console.log('  calendar', {
        primary: c.primary,
        selected: c.selected,
        summary: trunc(c.summary),
        timeZone: c.timeZone,
      })
    }
  }

  const events = await listEvents(userId, {
    range: 'tomorrow',
    requestId,
  })
  console.log('[calendar-read-smoke] listEvents(tomorrow)', {
    eventCount: events.events.length,
    timeMin: events.timeMin,
    timeMax: events.timeMax,
    timeZone: events.timeZone,
  })
  if (showNames) {
    for (const e of events.events.slice(0, 10)) {
      console.log('  event', {
        allDay: e.allDay,
        start: e.start,
        title: trunc(e.title),
      })
    }
  }

  const fb = await freeBusy(userId, {
    timeMin: events.timeMin,
    timeMax: events.timeMax,
    timeZone: events.timeZone,
    requestId,
  })
  const busyCount = fb.calendars.reduce((n, c) => n + c.busy.length, 0)
  console.log('[calendar-read-smoke] freeBusy', {
    calendarCount: fb.calendars.length,
    busyRangeCount: busyCount,
  })

  console.log('[calendar-read-smoke] ok')
}

main().catch((err) => {
  const code = isCalendarError(err) ? err.code : 'smoke_failed'
  console.error('[calendar-read-smoke] failed', { code })
  process.exit(1)
})
