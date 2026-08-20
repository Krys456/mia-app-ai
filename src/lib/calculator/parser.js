/**
 * #318 — Restricted recursive-descent arithmetic parser.
 * NO eval, NO Function, NO identifiers, NO property access.
 */

import { sanitizeNumber } from './format.js'
import { CALC_ERROR, CALC_LIMITS } from './limits.js'

/** @typedef {{ type: string, value?: string|number }} Token */

const SECURITY_RE =
  /\b(eval|function|fetch|alert|constructor|__proto__|prototype|process|require|import|window|document|globalthis|global)\b/i

/**
 * Normalize user math text before tokenization.
 * @param {string} raw
 */
export function normalizeMathText(raw) {
  let s = String(raw || '')
  s = s.replace(/[×✕✖⨯]/g, '*')
  s = s.replace(/[÷∕]/g, '/')
  s = s.replace(/√/g, 'sqrt')
  s = s.replace(/\*\*/g, '^')
  // 3.5 × 10^8 already has ×→*; also "3.5 * 10^8" is fine as expr
  // Compact "3,5e8" / spaces around e
  s = s.replace(/(\d)\s*[eE]\s*([+-]?\d)/g, '$1e$2')
  return s
}

/**
 * Ambiguous Italian list commas: multiple commas as separators → reject later.
 * Convert a single decimal comma between digits when unambiguous.
 * @param {string} s
 */
export function normalizeDecimalCommas(s) {
  const text = String(s)
  // If pattern like "1,2,3" (list) — leave commas; tokenizer will fail → malformed
  // Convert digit,digit+ when not part of thousands with multiple groups
  // P0: only replace isolated decimal commas: N,DDD where not followed by another ,digit
  return text.replace(/(\d),(\d+)/g, (full, a, b, offset, whole) => {
    const before = whole.slice(Math.max(0, offset - 1), offset)
    const after = whole.slice(offset + full.length, offset + full.length + 2)
    // Thousands style 1.234,56 handled separately; if another comma digit follows → ambiguous
    if (/,\d/.test(after)) return full // leave; will be invalid
    // If looks like thousands: 1,234 with exactly 3 digits and more digits before — ambiguous in IT
    // P0 rule: if fractional part length is 3 AND integer part has length>=1 and next is end/op → could be thousands
    // Spec: reject ambiguous comma-heavy. Treat , with 1-2 digit frac as decimal; 3-digit alone as decimal if short int
    if (b.length <= 6 && !/,/.test(whole.slice(offset + full.length))) {
      return `${a}.${b}`
    }
    return full
  })
}

/**
 * Strip wrapping "quanto fa" / "calculate" wrappers leaving expression-ish core.
 * @param {string} raw
 */
export function stripCalcCue(raw) {
  let s = String(raw || '').trim()
  s = s.replace(/^[¿?¡!\s]+/, '')
  s = s.replace(
    /^(?:quanto\s+fa|calcola(?:mi)?|fai\s+il\s+calcolo|calculate|what\s+is|what's|whats)\s+/i,
    '',
  )
  s = s.replace(/\?+\s*$/, '')
  return s.trim()
}

/**
 * @param {string} input
 * @returns {{ ok: true, tokens: Token[] } | { ok: false, errorCode: string }}
 */
export function tokenize(input) {
  const src = normalizeDecimalCommas(normalizeMathText(input))
  if (SECURITY_RE.test(src)) {
    return { ok: false, errorCode: CALC_ERROR.security }
  }
  if (/[=;{}[\]`$]|::|\.\./.test(src)) {
    return { ok: false, errorCode: CALC_ERROR.invalid_char }
  }

  /** @type {Token[]} */
  const tokens = []
  let i = 0
  const n = src.length

  while (i < n) {
    const ch = src[i]
    if (/\s/.test(ch)) {
      i += 1
      continue
    }

    if (ch === '(') {
      tokens.push({ type: 'lparen' })
      i += 1
      continue
    }
    if (ch === ')') {
      tokens.push({ type: 'rparen' })
      i += 1
      continue
    }
    if (ch === '+') {
      tokens.push({ type: 'plus' })
      i += 1
      continue
    }
    if (ch === '-') {
      tokens.push({ type: 'minus' })
      i += 1
      continue
    }
    if (ch === '*') {
      tokens.push({ type: 'mul' })
      i += 1
      continue
    }
    if (ch === '/') {
      tokens.push({ type: 'div' })
      i += 1
      continue
    }
    if (ch === '^') {
      tokens.push({ type: 'pow' })
      i += 1
      continue
    }
    if (ch === '%') {
      tokens.push({ type: 'percent_sign' })
      i += 1
      continue
    }

    // sqrt function name
    if (/^[sS][qQ][rR][tT]/.test(src.slice(i))) {
      tokens.push({ type: 'sqrt' })
      i += 4
      continue
    }

    // Number: 3.14, 3e8, .5
    if (/\d/.test(ch) || (ch === '.' && /\d/.test(src[i + 1] || ''))) {
      let j = i
      let num = ''
      while (j < n && /\d/.test(src[j])) {
        num += src[j]
        j += 1
      }
      if (src[j] === '.') {
        num += '.'
        j += 1
        while (j < n && /\d/.test(src[j])) {
          num += src[j]
          j += 1
        }
      }
      if (src[j] === 'e' || src[j] === 'E') {
        num += 'e'
        j += 1
        if (src[j] === '+' || src[j] === '-') {
          num += src[j]
          j += 1
        }
        if (!/\d/.test(src[j] || '')) {
          return { ok: false, errorCode: CALC_ERROR.malformed }
        }
        while (j < n && /\d/.test(src[j])) {
          num += src[j]
          j += 1
        }
      }
      const value = Number(num)
      if (!Number.isFinite(value)) {
        return { ok: false, errorCode: CALC_ERROR.overflow }
      }
      tokens.push({ type: 'number', value })
      i = j
      continue
    }

    return { ok: false, errorCode: CALC_ERROR.invalid_char }
  }

  if (tokens.length > CALC_LIMITS.maxTokens) {
    return { ok: false, errorCode: CALC_ERROR.too_many_tokens }
  }
  return { ok: true, tokens }
}

/**
 * Evaluate tokenized expression.
 * @param {Token[]} tokens
 * @returns {{ ok: true, value: number, steps: string[] } | { ok: false, errorCode: string }}
 */
export function evaluateTokens(tokens) {
  let pos = 0
  let depth = 0
  let parenDepth = 0
  /** @type {string[]} */
  const steps = []

  function peek() {
    return tokens[pos] || { type: 'eof' }
  }
  function consume() {
    const t = tokens[pos]
    pos += 1
    return t
  }

  function parseExpression() {
    depth += 1
    if (depth > CALC_LIMITS.maxParseDepth) {
      throw Object.assign(new Error('depth'), { code: CALC_ERROR.depth })
    }
    let left = parseTerm()
    while (peek().type === 'plus' || peek().type === 'minus') {
      const op = consume().type
      const right = parseTerm()
      const next = op === 'plus' ? left + right : left - right
      if (!Number.isFinite(next)) throw Object.assign(new Error('overflow'), { code: CALC_ERROR.overflow })
      steps.push(`${sanitizeNumber(left)} ${op === 'plus' ? '+' : '−'} ${sanitizeNumber(right)} = ${sanitizeNumber(next)}`)
      left = next
    }
    depth -= 1
    return left
  }

  function parseTerm() {
    let left = parsePower()
    while (peek().type === 'mul' || peek().type === 'div') {
      const op = consume().type
      const right = parsePower()
      if (op === 'div') {
        if (right === 0) throw Object.assign(new Error('div0'), { code: CALC_ERROR.div_zero })
        const next = left / right
        if (!Number.isFinite(next)) throw Object.assign(new Error('overflow'), { code: CALC_ERROR.overflow })
        steps.push(`${sanitizeNumber(left)} ÷ ${sanitizeNumber(right)} = ${sanitizeNumber(next)}`)
        left = next
      } else {
        const next = left * right
        if (!Number.isFinite(next)) throw Object.assign(new Error('overflow'), { code: CALC_ERROR.overflow })
        steps.push(`${sanitizeNumber(left)} × ${sanitizeNumber(right)} = ${sanitizeNumber(next)}`)
        left = next
      }
    }
    return left
  }

  // Right-associative power
  function parsePower() {
    const base = parseUnary()
    if (peek().type === 'pow') {
      consume()
      const exp = parsePower()
      if (Math.abs(exp) > CALC_LIMITS.maxExponentAbs) {
        throw Object.assign(new Error('exp'), { code: CALC_ERROR.exponent })
      }
      if (Math.abs(base) > CALC_LIMITS.maxPowerBaseAbs && Math.abs(exp) > 1) {
        throw Object.assign(new Error('overflow'), { code: CALC_ERROR.overflow })
      }
      const next = base ** exp
      if (!Number.isFinite(next)) throw Object.assign(new Error('overflow'), { code: CALC_ERROR.overflow })
      if (Math.abs(next) > CALC_LIMITS.maxResultAbs) {
        throw Object.assign(new Error('overflow'), { code: CALC_ERROR.overflow })
      }
      steps.push(`${sanitizeNumber(base)}^${sanitizeNumber(exp)} = ${sanitizeNumber(next)}`)
      return next
    }
    return base
  }

  function parseUnary() {
    if (peek().type === 'plus') {
      consume()
      return parseUnary()
    }
    if (peek().type === 'minus') {
      consume()
      const v = parseUnary()
      return -v
    }
    return parsePrimary()
  }

  function parsePrimary() {
    const t = peek()
    if (t.type === 'number') {
      consume()
      return /** @type {number} */ (t.value)
    }
    if (t.type === 'sqrt') {
      consume()
      let arg
      if (peek().type === 'lparen') {
        consume()
        parenDepth += 1
        if (parenDepth > CALC_LIMITS.maxParenDepth) {
          throw Object.assign(new Error('depth'), { code: CALC_ERROR.depth })
        }
        arg = parseExpression()
        if (peek().type !== 'rparen') {
          throw Object.assign(new Error('paren'), { code: CALC_ERROR.paren })
        }
        consume()
        parenDepth -= 1
      } else {
        arg = parseUnary()
      }
      if (arg < 0) throw Object.assign(new Error('domain'), { code: CALC_ERROR.domain })
      const next = Math.sqrt(arg)
      steps.push(`√${sanitizeNumber(arg)} = ${sanitizeNumber(next)}`)
      return next
    }
    if (t.type === 'lparen') {
      consume()
      parenDepth += 1
      if (parenDepth > CALC_LIMITS.maxParenDepth) {
        throw Object.assign(new Error('depth'), { code: CALC_ERROR.depth })
      }
      const v = parseExpression()
      if (peek().type !== 'rparen') {
        throw Object.assign(new Error('paren'), { code: CALC_ERROR.paren })
      }
      consume()
      parenDepth -= 1
      return v
    }
    throw Object.assign(new Error('malformed'), { code: CALC_ERROR.malformed })
  }

  try {
    if (!tokens.length) return { ok: false, errorCode: CALC_ERROR.empty }
    const value = parseExpression()
    if (peek().type !== 'eof') {
      return { ok: false, errorCode: CALC_ERROR.malformed }
    }
    if (!Number.isFinite(value) || Number.isNaN(value)) {
      return { ok: false, errorCode: CALC_ERROR.overflow }
    }
    if (Math.abs(value) > CALC_LIMITS.maxResultAbs) {
      return { ok: false, errorCode: CALC_ERROR.overflow }
    }
    return { ok: true, value: sanitizeNumber(value), steps }
  } catch (err) {
    const code = err && typeof err === 'object' && 'code' in err ? String(err.code) : CALC_ERROR.malformed
    return { ok: false, errorCode: code }
  }
}

/**
 * Parse & evaluate a raw arithmetic expression string.
 * @param {string} raw
 */
export function evaluateExpression(raw) {
  const text = String(raw || '').trim()
  if (!text) return { status: 'error', errorCode: CALC_ERROR.empty }
  if (text.length > CALC_LIMITS.maxRawLength) {
    return { status: 'error', errorCode: CALC_ERROR.too_long }
  }
  if (SECURITY_RE.test(text)) {
    return { status: 'error', errorCode: CALC_ERROR.security }
  }

  const tok = tokenize(text)
  if (!tok.ok) return { status: 'error', errorCode: tok.errorCode }
  const ev = evaluateTokens(tok.tokens)
  if (!ev.ok) return { status: 'error', errorCode: ev.errorCode }
  return {
    status: 'ok',
    operation: 'expression',
    normalizedExpression: normalizeMathText(text).replace(/\s+/g, ''),
    result: ev.value,
    steps: ev.steps,
  }
}
