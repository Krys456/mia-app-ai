/**
 * #318 — Centralized numeric display / precision helpers.
 * Avoid exposing binary float artifacts (e.g. 0.1+0.2 → 0.3).
 */

/**
 * Clean IEEE noise after arithmetic (no money rounding yet).
 * @param {number} n
 */
export function sanitizeNumber(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return n
  if (Object.is(n, -0)) return 0
  // Round to 12 decimal places to kill float dust, then rely on format for display.
  const cleaned = Math.round(n * 1e12) / 1e12
  if (!Number.isFinite(cleaned)) return n
  return cleaned
}

/**
 * @param {number} n
 * @param {{
 *   language?: 'it'|'en'
 *   money?: boolean
 *   currencySymbol?: string | null
 *   maxDecimals?: number
 * }} [opts]
 */
export function formatDisplayResult(n, opts = {}) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return String(n)
  const money = Boolean(opts.money)
  const lang = opts.language === 'en' ? 'en' : 'it'

  let value = sanitizeNumber(n)
  if (money) {
    value = Math.round(value * 100) / 100
  }

  const abs = Math.abs(value)
  const negative = value < 0
  const sign = negative ? '-' : ''
  const absVal = Math.abs(value)

  let intStr
  let fracStr = ''

  if (money) {
    const fixed = absVal.toFixed(2)
    const [i, f] = fixed.split('.')
    intStr = i
    fracStr = f
  } else if (Number.isInteger(absVal) || Math.abs(absVal - Math.round(absVal)) < 1e-12) {
    intStr = String(Math.round(absVal))
  } else if (abs >= 1e10 || (abs > 0 && abs < 1e-6)) {
    const sci = value.toExponential(6).replace(/\.?0+e/, 'e').replace(/e\+/, 'e')
    const sym = opts.currencySymbol
    return sym ? `${sci} ${sym}`.trim() : sci
  } else {
    // Up to 12 dp, strip trailing zeros
    let fixed = absVal.toFixed(12).replace(/\.?0+$/, '')
    if (!fixed.includes('.')) {
      intStr = fixed
    } else {
      const parts = fixed.split('.')
      intStr = parts[0]
      fracStr = parts[1]
    }
  }

  // Thousands grouping
  if ((money || Number(intStr) >= 1000) && intStr) {
    intStr = intStr.replace(/\B(?=(\d{3})+(?!\d))/g, lang === 'it' ? '.' : ',')
  }

  let display
  if (fracStr) {
    display = lang === 'it' ? `${sign}${intStr},${fracStr}` : `${sign}${intStr}.${fracStr}`
  } else if (money) {
    display = lang === 'it' ? `${sign}${intStr},00` : `${sign}${intStr}.00`
  } else {
    display = `${sign}${intStr}`
  }

  const sym = opts.currencySymbol
  if (sym) return `${display} ${sym}`.trim()
  return display
}

/**
 * Round to N decimal places (deterministic).
 * @param {number} n
 * @param {number} decimals
 */
export function roundToDecimals(n, decimals) {
  const d = Math.max(0, Math.min(12, Math.floor(decimals)))
  const f = 10 ** d
  return sanitizeNumber(Math.round(n * f) / f)
}
