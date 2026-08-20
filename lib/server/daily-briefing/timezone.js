/**
 * #321 — Timezone / local-date helpers for Daily Briefing.
 * Never use Vercel UTC as the user's "today".
 */

/**
 * @param {unknown} timezone
 * @returns {string | null}
 */
export function sanitizeBriefingTimeZone(timezone) {
  const tz = typeof timezone === 'string' ? timezone.trim().slice(0, 64) : ''
  if (!tz) return null
  try {
    Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date())
    return tz
  } catch {
    return null
  }
}

/**
 * Local calendar date YYYY-MM-DD in IANA zone.
 * @param {string} timeZone
 * @param {Date} [now]
 */
export function localDateKeyInZone(timeZone, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const y = parts.find((p) => p.type === 'year')?.value
  const m = parts.find((p) => p.type === 'month')?.value
  const d = parts.find((p) => p.type === 'day')?.value
  return `${y}-${m}-${d}`
}

/**
 * @param {string} timeZone
 * @param {Date} [now]
 */
export function tomorrowDateKeyInZone(timeZone, now = new Date()) {
  // Add 26h then read local date — robust enough across DST for briefing day+1
  const shifted = new Date(now.getTime() + 26 * 60 * 60 * 1000)
  const today = localDateKeyInZone(timeZone, now)
  let candidate = localDateKeyInZone(timeZone, shifted)
  if (candidate === today) {
    candidate = localDateKeyInZone(timeZone, new Date(now.getTime() + 36 * 60 * 60 * 1000))
  }
  // Walk forward hour-by-hour until date changes (DST-safe)
  if (candidate === today) {
    for (let h = 1; h <= 48; h++) {
      const k = localDateKeyInZone(timeZone, new Date(now.getTime() + h * 60 * 60 * 1000))
      if (k !== today) return k
    }
  }
  return candidate
}

/**
 * Date key of an instant in a zone.
 * @param {string|Date} isoOrDate
 * @param {string} timeZone
 */
export function dateKeyOfInstant(isoOrDate, timeZone) {
  const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate)
  if (Number.isNaN(d.getTime())) return null
  return localDateKeyInZone(timeZone, d)
}

/**
 * Format HH:mm in zone from ISO.
 * @param {string} iso
 * @param {string} timeZone
 * @param {'it'|'en'} [language]
 */
export function formatLocalTime(iso, timeZone, language = 'it') {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  try {
    return new Intl.DateTimeFormat(language === 'en' ? 'en-GB' : 'it-IT', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(d)
  } catch {
    return ''
  }
}

/**
 * @param {unknown} ms
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 * @template T
 */
export function withTimeout(ms, fn) {
  const limit = Math.max(500, Math.min(Number(ms) || 8000, 20000))
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const err = new Error('timeout')
      err.code = 'timeout'
      reject(err)
    }, limit)
    Promise.resolve()
      .then(fn)
      .then(
        (v) => {
          clearTimeout(timer)
          resolve(v)
        },
        (e) => {
          clearTimeout(timer)
          reject(e)
        },
      )
  })
}
