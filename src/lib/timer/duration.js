/**
 * #314 — Deterministic timer duration parser (IT/EN).
 */

export const TIMER_MIN_MS = 5_000
export const TIMER_MAX_MS = 24 * 60 * 60 * 1000

export function normalizeTimerText(raw) {
  return String(raw || '')
    .normalize('NFKC')
    .replace(/[\u2018\u2019\u02BC\u0060\u00B4]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

function asciiFold(s) {
  return normalizeTimerText(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
}

export function parseTimerDurationMs(raw) {
  const text = asciiFold(raw)
  if (!text) return null

  const idioms = [
    [/\bmezz[' ]?ora\b|\bhalf\s+(an\s+)?hour\b|\bmezza\s+ora\b/, 30 * 60_000],
    [/\bmezzo\s+minuto\b|\bhalf\s+(a\s+)?minute\b/, 30_000],
    [/\bun[' ]?ora\b(?!\s+e\b)|\ban?\s+hour\b(?!\s+and\b)/, 60 * 60_000],
    [
      /\bun\s+minuto\s+e\s+mezzo\b|\bone\s+and\s+a\s+half\s+minutes?\b|\b1\.5\s+minutes?\b/,
      90_000,
    ],
  ]
  for (const [re, ms] of idioms) {
    if (re.test(text)) {
      if (!/\be\s+\d|\band\s+\d|\d+\s*(ora|hour|minut|second)/.test(text.replace(re, ' '))) {
        return clampOrReject(ms)
      }
    }
  }

  let total = 0
  let matched = false

  const unitRe =
    /(\d+(?:[.,]\d+)?|un['a]?|una|uno|one|a|an)\s*(ore|ora|hours?|hrs?|minuti|minuto|mins?|minutes?|secondi|secondo|secs?|seconds?)/gi
  let m
  while ((m = unitRe.exec(text)) !== null) {
    const qty = parseQty(m[1])
    if (qty == null || !Number.isFinite(qty) || qty < 0) return null
    const mult = unitToMs(m[2])
    if (!mult) return null
    total += qty * mult
    matched = true
  }

  if (!matched) {
    const compact = text.match(/\b(\d+(?:[.,]\d+)?)\s*(h|hr|hrs|m|min|mins|s|sec|secs)\b/i)
    if (compact) {
      const qty = parseQty(compact[1])
      const mult = unitToMs(compact[2])
      if (qty != null && mult) {
        total = qty * mult
        matched = true
      }
    }
  }

  const eMezzo = text.match(/\b(\d+)\s*(minuti|minuto|minutes?|mins?)\s+e\s+mezzo\b/)
  if (eMezzo) {
    const n = Number(eMezzo[1])
    if (Number.isFinite(n)) {
      total = n * 60_000 + 30_000
      matched = true
    }
  }

  if (!matched || total <= 0) return null
  return clampOrReject(Math.round(total))
}

function parseQty(raw) {
  const s = String(raw || '')
    .trim()
    .toLowerCase()
  if (!s) return null
  if (
    s === "un'" ||
    s === 'un' ||
    s === 'una' ||
    s === 'uno' ||
    s === 'one' ||
    s === 'a' ||
    s === 'an'
  ) {
    return 1
  }
  const n = Number(s.replace(',', '.'))
  if (!Number.isFinite(n)) return null
  return n
}

function unitToMs(unit) {
  const u = unit.toLowerCase()
  if (/^(ore|ora|hours?|hrs?|h)$/.test(u)) return 60 * 60_000
  if (/^(minuti|minuto|minutes?|mins?|m|min)$/.test(u)) return 60_000
  if (/^(secondi|secondo|seconds?|secs?|s|sec)$/.test(u)) return 1000
  return null
}

function clampOrReject(ms) {
  if (!Number.isFinite(ms) || ms < TIMER_MIN_MS || ms > TIMER_MAX_MS) return null
  return Math.round(ms)
}

export function formatDurationLabel(ms, lang) {
  const totalSec = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (lang === 'it') {
    const parts = []
    if (h) parts.push(h === 1 ? '1 ora' : `${h} ore`)
    if (m) parts.push(m === 1 ? '1 minuto' : `${m} minuti`)
    if (s && !h) parts.push(s === 1 ? '1 secondo' : `${s} secondi`)
    if (!parts.length) return '0 secondi'
    if (parts.length === 1) return parts[0]
    if (parts.length === 2) return `${parts[0]} e ${parts[1]}`
    return `${parts[0]}, ${parts[1]} e ${parts[2]}`
  }
  const parts = []
  if (h) parts.push(h === 1 ? '1 hour' : `${h} hours`)
  if (m) parts.push(m === 1 ? '1 minute' : `${m} minutes`)
  if (s && !h) parts.push(s === 1 ? '1 second' : `${s} seconds`)
  if (!parts.length) return '0 seconds'
  if (parts.length === 1) return parts[0]
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`
  return `${parts[0]}, ${parts[1]}, and ${parts[2]}`
}

export function formatCountdown(ms) {
  const totalSec = Math.max(0, Math.ceil(ms / 1000))
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  if (h > 0) return `${h}:${mm}:${ss}`
  return `${mm}:${ss}`
}

export function formatRemainingSpoken(ms, lang) {
  const totalSec = Math.max(0, Math.ceil(ms / 1000))
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (lang === 'it') {
    if (totalSec === 0) return '0 secondi'
    const parts = []
    if (h) parts.push(h === 1 ? '1 ora' : `${h} ore`)
    if (m) parts.push(m === 1 ? '1 minuto' : `${m} minuti`)
    if (s || parts.length === 0) parts.push(s === 1 ? '1 secondo' : `${s} secondi`)
    if (parts.length === 1) return parts[0]
    if (parts.length === 2) return `${parts[0]} e ${parts[1]}`
    return `${parts[0]}, ${parts[1]} e ${parts[2]}`
  }
  if (totalSec === 0) return '0 seconds'
  const parts = []
  if (h) parts.push(h === 1 ? '1 hour' : `${h} hours`)
  if (m) parts.push(m === 1 ? '1 minute' : `${m} minutes`)
  if (s || parts.length === 0) parts.push(s === 1 ? '1 second' : `${s} seconds`)
  if (parts.length === 1) return parts[0]
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`
  return `${parts[0]}, ${parts[1]}, and ${parts[2]}`
}
