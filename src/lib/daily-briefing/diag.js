/**
 * #321 — Safe Daily Briefing diagnostics (?daily_briefing_diag=1).
 */

export const DAILY_BRIEFING_DIAG_BUILD = '321-1'

export function isDailyBriefingDiagEnabled(search) {
  try {
    const q =
      search != null
        ? String(search)
        : typeof window !== 'undefined'
          ? window.location.search
          : ''
    if (!q) return false
    const params = new URLSearchParams(q.startsWith('?') ? q.slice(1) : q)
    const v = params.get('daily_briefing_diag')
    return v === '1' || v === 'true'
  } catch {
    return false
  }
}

export function buildDailyBriefingDiag(partial = {}) {
  let buildId = DAILY_BRIEFING_DIAG_BUILD
  try {
    if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_BUILD_ID) {
      buildId = import.meta.env.VITE_BUILD_ID
    }
  } catch {
    /* ignore */
  }
  return {
    route: 'daily-briefing-action',
    diagBuild: DAILY_BRIEFING_DIAG_BUILD,
    buildId,
    requestId: partial.requestId || `db_${Date.now().toString(36)}`,
    targetDate: partial.targetDate ?? null,
    timezoneSource: partial.timezoneSource ?? null,
    calendarStatus: partial.calendarStatus ?? null,
    calendarItemCount:
      typeof partial.calendarItemCount === 'number' ? partial.calendarItemCount : null,
    reminderStatus: partial.reminderStatus ?? null,
    reminderCount: typeof partial.reminderCount === 'number' ? partial.reminderCount : null,
    weatherStatus: partial.weatherStatus ?? null,
    sourceTimeouts: Boolean(partial.sourceTimeouts),
    partialSuccess: Boolean(partial.partialSuccess),
    renderMode: partial.renderMode ?? 'deterministic',
    failureCode: partial.failureCode ?? null,
  }
}

export function rememberDailyBriefingDiag(diag) {
  try {
    if (typeof sessionStorage === 'undefined') return
    sessionStorage.setItem('shinkaido.dailyBriefingDiag.last', JSON.stringify(diag))
  } catch {
    /* ignore */
  }
}

export function logDailyBriefingSafe(fields = {}) {
  try {
    console.info(
      '[daily-briefing-action]',
      JSON.stringify({
        route: 'daily-briefing-action',
        calendarStatus: fields.calendarStatus ?? null,
        reminderStatus: fields.reminderStatus ?? null,
        weatherStatus: fields.weatherStatus ?? null,
        partialSuccess: Boolean(fields.partialSuccess),
        failureCode: fields.failureCode ?? null,
      }),
    )
  } catch {
    /* ignore */
  }
}
