/**
 * #334B — Deterministic Daily Briefing priority engine.
 * Ranking is explainable from verified source data only. No model.
 */

/**
 * Instant ms for an event start (all-day / date-only → start of that local day is not forced).
 * @param {object} ev
 * @returns {number | null}
 */
export function eventStartMs(ev) {
  if (!ev || ev.allDay) return null
  const start = ev.start
  if (typeof start === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(start)) return null
  try {
    const d = new Date(start)
    return Number.isNaN(d.getTime()) ? null : d.getTime()
  } catch {
    return null
  }
}

/**
 * @param {object} item reminder
 * @returns {number | null}
 */
export function reminderFireMs(item) {
  try {
    const d = new Date(item.fireAt)
    return Number.isNaN(d.getTime()) ? null : d.getTime()
  } catch {
    return null
  }
}

/**
 * Local hour 0–23 in zone.
 * @param {string} timeZone
 * @param {Date} [now]
 */
export function localHourInZone(timeZone, now = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timeZone || 'UTC',
      hour: '2-digit',
      hour12: false,
    }).formatToParts(now)
    const h = parts.find((p) => p.type === 'hour')?.value
    const n = Number(h)
    return Number.isFinite(n) ? n % 24 : 12
  } catch {
    return 12
  }
}

/**
 * @param {string} timeZone
 * @param {Date} [now]
 * @returns {'morning'|'afternoon'|'evening'}
 */
export function dayPartInZone(timeZone, now = new Date()) {
  const h = localHourInZone(timeZone, now)
  if (h < 12) return 'morning'
  if (h < 18) return 'afternoon'
  return 'evening'
}

/**
 * Build ranked presentation items from a verified briefing model.
 * Ordinals in the UI/reply MUST follow this array order.
 *
 * @param {object} model
 * @param {{ now?: Date, soonMs?: number }} [opts]
 * @returns {object[]}
 */
export function buildBriefingPriorities(model, opts = {}) {
  const now = opts.now || new Date()
  const nowMs = now.getTime()
  const soonMs = typeof opts.soonMs === 'number' ? opts.soonMs : 90 * 60 * 1000
  const cal = model.calendar || { status: 'unavailable', items: [] }
  const rem = model.reminders || { status: 'unavailable', overdue: [], today: [] }
  const wx = model.weather || { status: 'unavailable' }
  const items = []

  // 1. Overdue reminders
  if (rem.status === 'ok' && Array.isArray(rem.overdue)) {
    for (const r of rem.overdue) {
      if (!r) continue
      items.push({
        id: `rem-overdue-${String(r.id || items.length)}`,
        kind: 'overdue_reminder',
        rank: 10,
        source: 'reminders',
        title: String(r.title || ''),
        when: r.fireAt || null,
        whenMs: reminderFireMs(r),
        overdue: true,
        raw: r,
      })
    }
  }

  // Calendar timed vs all-day
  const calItems = cal.status === 'ok' && Array.isArray(cal.items) ? cal.items.slice() : []
  const timed = []
  const allDay = []
  for (const ev of calItems) {
    if (!ev) continue
    const ms = eventStartMs(ev)
    if (ms == null || ev.allDay) {
      allDay.push(ev)
    } else {
      timed.push({ ev, ms })
    }
  }
  timed.sort((a, b) => a.ms - b.ms)

  // 2–3. Next / remaining timed events (skip clearly ended if end known; else keep if start >= now - 15m)
  let nextAssigned = false
  for (const { ev, ms } of timed) {
    const endMs = (() => {
      try {
        if (!ev.end) return null
        const d = new Date(ev.end)
        return Number.isNaN(d.getTime()) ? null : d.getTime()
      } catch {
        return null
      }
    })()
    const passed = endMs != null ? endMs < nowMs : ms < nowMs - 15 * 60 * 1000
    if (passed) continue
    const soon = ms - nowMs <= soonMs && ms >= nowMs - 5 * 60 * 1000
    const isNext = !nextAssigned
    if (isNext) nextAssigned = true
    items.push({
      id: `cal-${String(ev.id || ms)}`,
      kind: isNext ? 'next_event' : 'timed_event',
      rank: isNext ? (soon ? 20 : 25) : 30,
      source: 'calendar',
      title: String(ev.title || ''),
      when: ev.start,
      whenMs: ms,
      allDay: false,
      soon: Boolean(soon && isNext),
      raw: ev,
    })
  }

  // 4. All-day events
  for (const ev of allDay) {
    items.push({
      id: `cal-allday-${String(ev.id || ev.title)}`,
      kind: 'all_day_event',
      rank: 40,
      source: 'calendar',
      title: String(ev.title || ''),
      when: ev.start || null,
      whenMs: null,
      allDay: true,
      raw: ev,
    })
  }

  // 5. Reminders due today (not overdue)
  if (rem.status === 'ok' && Array.isArray(rem.today)) {
    const todaySorted = rem.today
      .slice()
      .map((r) => ({ r, ms: reminderFireMs(r) }))
      .sort((a, b) => (a.ms ?? 0) - (b.ms ?? 0))
    for (const { r, ms } of todaySorted) {
      if (!r) continue
      items.push({
        id: `rem-today-${String(r.id || items.length)}`,
        kind: 'today_reminder',
        rank: 50,
        source: 'reminders',
        title: String(r.title || ''),
        when: r.fireAt || null,
        whenMs: ms,
        overdue: false,
        raw: r,
      })
    }
  }

  // 6. Weather that materially affects the day
  if (wx.status === 'ok' && wx.snapshot) {
    const s = wx.snapshot
    const actionable = Boolean(s.umbrellaRecommended || s.rainLikely)
    const extreme =
      (typeof s.temperatureMaxC === 'number' && s.temperatureMaxC >= 32) ||
      (typeof s.temperatureMinC === 'number' && s.temperatureMinC <= 0) ||
      (typeof s.temperatureC === 'number' && (s.temperatureC >= 32 || s.temperatureC <= 0))
    if (actionable || extreme) {
      items.push({
        id: 'wx-day',
        kind: 'weather',
        rank: actionable ? 60 : 65,
        source: 'weather',
        title: s.locationLabel || 'weather',
        rainLikely: Boolean(s.umbrellaRecommended || s.rainLikely),
        snapshot: s,
        raw: s,
      })
    } else {
      // Still include as low-priority weather note so ordinals can reference meteo if shown
      items.push({
        id: 'wx-day',
        kind: 'weather',
        rank: 70,
        source: 'weather',
        title: s.locationLabel || 'weather',
        rainLikely: false,
        snapshot: s,
        mild: true,
        raw: s,
      })
    }
  }

  items.sort((a, b) => a.rank - b.rank || (a.whenMs ?? 0) - (b.whenMs ?? 0))

  // Quiet day marker when calendar empty + no reminders + no actionable weather
  const hasPersonal = items.some((i) => i.source === 'calendar' || i.source === 'reminders')
  if (!hasPersonal) {
    const calEmpty = cal.status === 'empty' || (cal.status === 'ok' && !calItems.length)
    const remEmpty =
      rem.status === 'empty' ||
      (rem.status === 'ok' && !(rem.overdue?.length || rem.today?.length))
    if (calEmpty && remEmpty) {
      items.push({
        id: 'quiet-day',
        kind: 'quiet',
        rank: 90,
        source: 'system',
        title: 'quiet',
      })
    }
  }

  // Stable presentation index (1-based for users)
  return items.map((it, idx) => ({ ...it, ordinal: idx + 1 }))
}

/**
 * Items the user actually "sees" as numbered briefing points (exclude quiet marker from ordinals if alone?).
 * Quiet can be a point; weather mild counts.
 * @param {object[]} priorities
 */
export function presentationItemsForOrdinals(priorities) {
  return (priorities || []).filter((p) => p.kind !== 'quiet' || (priorities || []).length === 1)
}
