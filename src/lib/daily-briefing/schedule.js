/**
 * #334C — Schedule intelligence (overlaps, back-to-back, free windows).
 * Deterministic; no travel-time speculation.
 */

import { eventStartMs } from './priority.js'

const BACK_TO_BACK_GAP_MS = 15 * 60 * 1000

/**
 * @param {object[]} calendarItems
 * @param {{ now?: Date, timeZone?: string }} [opts]
 */
export function analyzeSchedule(calendarItems, opts = {}) {
  const now = opts.now || new Date()
  const nowMs = now.getTime()
  const timed = []
  for (const ev of calendarItems || []) {
    if (!ev || ev.allDay) continue
    const startMs = eventStartMs(ev)
    if (startMs == null) continue
    let endMs = null
    try {
      if (ev.end) {
        const d = new Date(ev.end)
        if (!Number.isNaN(d.getTime())) endMs = d.getTime()
      }
    } catch {
      /* ignore */
    }
    if (endMs == null) endMs = startMs + 60 * 60 * 1000
    timed.push({
      id: String(ev.id || ''),
      title: String(ev.title || ''),
      startMs,
      endMs,
      raw: ev,
    })
  }
  timed.sort((a, b) => a.startMs - b.startMs)

  const overlaps = []
  for (let i = 0; i < timed.length; i++) {
    for (let j = i + 1; j < timed.length; j++) {
      const a = timed[i]
      const b = timed[j]
      if (b.startMs < a.endMs && a.startMs < b.endMs) {
        overlaps.push({ a, b })
      }
    }
  }

  const backToBack = []
  for (let i = 0; i < timed.length - 1; i++) {
    const a = timed[i]
    const b = timed[i + 1]
    const gap = b.startMs - a.endMs
    if (gap >= 0 && gap <= BACK_TO_BACK_GAP_MS) {
      backToBack.push({ a, b, gapMs: gap })
    }
  }

  const upcoming = timed.filter((e) => e.endMs >= nowMs - 5 * 60 * 1000)
  const freeWindows = []
  if (upcoming.length) {
    const first = upcoming[0]
    if (first.startMs - nowMs >= 45 * 60 * 1000) {
      freeWindows.push({
        kind: 'until_first',
        fromMs: nowMs,
        toMs: first.startMs,
        minutes: Math.round((first.startMs - nowMs) / 60000),
      })
    }
    for (let i = 0; i < upcoming.length - 1; i++) {
      const a = upcoming[i]
      const b = upcoming[i + 1]
      const gap = b.startMs - a.endMs
      if (gap >= 45 * 60 * 1000) {
        freeWindows.push({
          kind: 'between',
          fromMs: a.endMs,
          toMs: b.startMs,
          minutes: Math.round(gap / 60000),
          afterId: a.id,
          beforeId: b.id,
        })
      }
    }
  } else if (!timed.length) {
    freeWindows.push({ kind: 'all_day', fromMs: nowMs, toMs: null, minutes: null })
  }

  const next = upcoming[0] || null
  const minutesUntilNext =
    next && next.startMs > nowMs ? Math.round((next.startMs - nowMs) / 60000) : null

  return {
    timed,
    upcoming,
    overlaps,
    backToBack,
    freeWindows,
    next,
    minutesUntilNext,
  }
}
