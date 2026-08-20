/**
 * #318 — Deterministic percentage templates (IT/EN).
 * Only uses percentages explicitly supplied by the user (no live VAT tables).
 */

import { formatDisplayResult, sanitizeNumber } from './format.js'
import { CALC_ERROR } from './limits.js'

/**
 * Parse a number from NL fragment (supports IT comma decimals, optional €/$).
 * @param {string} raw
 * @returns {{ value: number, money: boolean, currencySymbol: string|null } | null}
 */
export function parseNumberish(raw) {
  let s = String(raw || '').trim()
  if (!s) return null
  let currencySymbol = null
  let money = false
  const cur = s.match(/([€$£])|(\bEUR\b|\bUSD\b|\bGBP\b)/i)
  if (cur) {
    money = true
    currencySymbol = cur[1] || cur[2].toUpperCase()
    s = s.replace(/[€$£]/g, '').replace(/\b(EUR|USD|GBP)\b/gi, '').trim()
  }
  // Remove thin spaces / NBSP used as thousands
  s = s.replace(/[\u00A0\u202F\s]/g, '')
  // Italian: 1.234,56 → 1234.56 ; or 79,99 → 79.99
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) {
    s = s.replace(/\./g, '').replace(',', '.')
  } else if (/^\d+,\d+$/.test(s)) {
    s = s.replace(',', '.')
  } else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) {
    // EN thousands 1,234.56
    s = s.replace(/,/g, '')
  }
  const v = Number(s)
  if (!Number.isFinite(v)) return null
  return { value: v, money, currencySymbol }
}

/**
 * @param {string} raw
 * @returns {null | {
 *   operation: string
 *   result: number
 *   normalizedExpression: string
 *   steps: string[]
 *   money?: boolean
 *   currencySymbol?: string|null
 *   base?: number
 *   percent?: number
 * }}
 */
export function tryPercentageTemplate(raw) {
  const text = String(raw || '').trim().replace(/[?¿]+$/g, '').trim()
  const folded = text
    .normalize('NFKC')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')

  // Strip leading cues
  const body = folded
    .replace(/^(?:quanto\s+(?:fa|e|è)|calcola(?:mi)?|calculate|what\s+is|what's)\s+/i, '')
    .replace(/^(?:il|la|the)\s+/i, '')
    .trim()

  // --- X% of Y / X% di Y ---
  {
    const m =
      body.match(/^(\d+(?:[.,]\d+)?)\s*%\s*(?:di|of)\s+(.+)$/i) ||
      text.match(/(?:^|\s)(\d+(?:[.,]\d+)?)\s*%\s*(?:di|of)\s+(.+)$/i)
    if (m) {
      const pct = parseNumberish(m[1])
      const base = parseNumberish(m[2])
      if (pct && base) {
        const result = sanitizeNumber((base.value * pct.value) / 100)
        return {
          operation: 'percent_of',
          result,
          normalizedExpression: `${pct.value}% of ${base.value}`,
          steps: [`${pct.value}% di ${base.value} = ${base.value} × ${pct.value}/100 = ${result}`],
          money: base.money,
          currencySymbol: base.currencySymbol,
          base: base.value,
          percent: pct.value,
        }
      }
    }
  }

  // --- Increase Y by X% ---
  {
    const m = body.match(
      /^(?:aumenta|incrementa|increase)\s+(.+?)\s+(?:del|di|by|of)\s+(\d+(?:[.,]\d+)?)\s*%$/i,
    )
    if (m) {
      const base = parseNumberish(m[1])
      const pct = parseNumberish(m[2])
      if (base && pct) {
        const result = sanitizeNumber(base.value * (1 + pct.value / 100))
        return {
          operation: 'percent_increase',
          result,
          normalizedExpression: `${base.value} + ${pct.value}%`,
          steps: [
            `${base.value} + ${pct.value}% = ${base.value} × (1 + ${pct.value}/100) = ${result}`,
          ],
          money: base.money,
          currencySymbol: base.currencySymbol,
          base: base.value,
          percent: pct.value,
        }
      }
    }
    // "850 + 22%" shorthand
    const m2 = body.match(/^(.+?)\s*\+\s*(\d+(?:[.,]\d+)?)\s*%$/)
    if (m2) {
      const base = parseNumberish(m2[1])
      const pct = parseNumberish(m2[2])
      if (base && pct) {
        const result = sanitizeNumber(base.value * (1 + pct.value / 100))
        return {
          operation: 'percent_increase',
          result,
          normalizedExpression: `${base.value} + ${pct.value}%`,
          steps: [
            `${base.value} + ${pct.value}% = ${base.value} × (1 + ${pct.value}/100) = ${result}`,
          ],
          money: base.money,
          currencySymbol: base.currencySymbol,
        }
      }
    }
  }

  // --- Decrease / discount ---
  {
    const patterns = [
      /^(?:togli|leva|sottrai|take|remove)\s+(?:il\s+)?(\d+(?:[.,]\d+)?)\s*%\s+(?:da|from|off)\s+(.+)$/i,
      /^(?:sconto\s+del|discount\s+of)\s+(\d+(?:[.,]\d+)?)\s*%\s+(?:su|on|off)\s+(.+)$/i,
      /^(?:take)\s+(\d+(?:[.,]\d+)?)\s*%\s+off\s+(.+)$/i,
      /^(.+?)\s*-\s*(\d+(?:[.,]\d+)?)\s*%$/,
    ]
    for (const re of patterns) {
      const m = body.match(re) || text.match(re)
      if (!m) continue
      let pct
      let base
      if (re.source.startsWith('^(.+?)')) {
        base = parseNumberish(m[1])
        pct = parseNumberish(m[2])
      } else {
        pct = parseNumberish(m[1])
        base = parseNumberish(m[2])
      }
      if (base && pct) {
        const result = sanitizeNumber(base.value * (1 - pct.value / 100))
        return {
          operation: 'percent_decrease',
          result,
          normalizedExpression: `${base.value} - ${pct.value}%`,
          steps: [
            `${base.value} − ${pct.value}% = ${base.value} × (1 − ${pct.value}/100) = ${result}`,
          ],
          money: base.money,
          currencySymbol: base.currencySymbol,
          base: base.value,
          percent: pct.value,
        }
      }
    }
  }

  // --- Reverse: X is Y% of what ---
  {
    const m = body.match(
      /^(\d+(?:[.,]\d+)?)\s+(?:e|è|is)\s+(?:il\s+|the\s+)?(\d+(?:[.,]\d+)?)\s*%\s+(?:di\s+quale\s+numero|of\s+what(?:\s+number)?|di\s+cosa)$/i,
    )
    if (m) {
      const part = parseNumberish(m[1])
      const pct = parseNumberish(m[2])
      if (part && pct && pct.value !== 0) {
        const result = sanitizeNumber((part.value * 100) / pct.value)
        return {
          operation: 'percent_reverse',
          result,
          normalizedExpression: `${part.value} is ${pct.value}% of ?`,
          steps: [
            `${part.value} = ${pct.value}% di X → X = ${part.value} × 100 / ${pct.value} = ${result}`,
          ],
          money: part.money,
          currencySymbol: part.currencySymbol,
        }
      }
    }
  }

  // --- VAT-style: add X% IVA to Y ---
  {
    const m = body.match(
      /^(?:aggiungi\s+(?:l['']?)?iva|add\s+(?:the\s+)?(?:vat|iva)|aggiungi)\s+(\d+(?:[.,]\d+)?)\s*%\s+(?:a|to|su)\s+(.+)$/i,
    )
    if (m) {
      const pct = parseNumberish(m[1])
      const base = parseNumberish(m[2])
      if (base && pct) {
        const result = sanitizeNumber(base.value * (1 + pct.value / 100))
        return {
          operation: 'percent_vat_add',
          result,
          normalizedExpression: `${base.value} + IVA ${pct.value}%`,
          steps: [
            `${base.value} + ${pct.value}% = ${base.value} × (1 + ${pct.value}/100) = ${result}`,
          ],
          money: base.money || true,
          currencySymbol: base.currencySymbol,
        }
      }
    }
  }

  return null
}

/**
 * Format a percentage computation for reply.
 */
export function formatPercentResult(computed, language = 'it') {
  if (!computed || computed.status === 'error') return null
  const display = formatDisplayResult(computed.result, {
    language,
    money: Boolean(computed.money),
    currencySymbol: computed.currencySymbol || null,
  })
  return {
    ...computed,
    status: 'ok',
    displayResult: display,
  }
}

export { CALC_ERROR }
