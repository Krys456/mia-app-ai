/**
 * #318 — Deterministic Calculator intent (IT/EN).
 * Only explicit USER calculation turns — never arbitrary numbers in prose.
 */

import { tryPercentageTemplate } from './percent.js'
import { stripCalcCue } from './parser.js'
import { analyzeOuterUserRequest } from '../outer-content-gate.js'

function fold(raw) {
  return String(raw || '')
    .normalize('NFKC')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function detectCalculatorLanguage(text, fallback = 'it') {
  const t = fold(text)
  const it = (t.match(/\b(quanto|calcola|diviso|moltiplic|aumenta|togli|percento|radice)\b/g) || [])
    .length
  const en = (t.match(/\b(calculate|what|percent|divide|multiply|increase|sqrt|off)\b/g) || [])
    .length
  if (en > it) return 'en'
  if (it > en) return 'it'
  return fallback
}

export function looksQuotedOrInjectedCalc(raw) {
  const t = String(raw || '')
  if (/^["“«].*["”»]\s*$/s.test(t.trim())) return true
  if (/\b(ignore\s+(all\s+)?instructions|ignora\s+le\s+istruzioni)\b/i.test(t)) return true
  return false
}

function isMetaMathTalk(t) {
  // Pure definitions / pedagogy — never Calculator
  if (
    /\b(cos[' ]?e\s+(una\s+|il\s+|la\s+)?(percentuale|radice|matematica)|what\s+is\s+a\s+(percentage|square\s+root)|spiegami\s+cos[' ]?e)\b/.test(
      t,
    )
  ) {
    return true
  }
  if (/\b(cos[' ]?e\s+il\s+\d+\s*%|what\s+is\s+(the\s+)?\d+\s*%\s*\??\s*$)/.test(t)) {
    return true
  }
  if (
    /\b(parliamo|let'?s\s+talk|scrivi\s+una\s+storia|write\s+a\s+story|ho\s+\d+\s+anni|eravamo\s+in\s+\d+|parliamo\s+del\s+numero)\b/.test(
      t,
    )
  ) {
    return true
  }
  // Unit conversion — defer (#319)
  if (
    /\b(\d+(?:[.,]\d+)?)\s*(km|mi|miles|kg|lb|lbs|celsius|fahrenheit|°\s*c|°\s*f|cm|inch|inches|litri|liters|gallons?)\b/.test(
      t,
    ) &&
    /\b(in|to|a|convert|converti)\b/.test(t)
  ) {
    return true
  }
  // FX — defer
  const fx = t.match(/\b(eur|usd|gbp|btc)\b/g) || []
  if (fx.length >= 2 && /\b(in|to|a)\b/.test(t)) return true
  // Equations with variables
  if (/\bx\b/.test(t) && /=/.test(t) && /\d/.test(t)) return true
  return false
}

function looksBareArithmetic(t) {
  const s = String(t || '').trim()
  if (!s) return false
  if (!/\d/.test(s)) return false
  if (/^\+?\d{8,}$/.test(s.replace(/\s/g, ''))) return false
  const hasOp =
    /[\+\-\*\/×÷^√%]/.test(s) ||
    /\bsqrt\s*\(/.test(s) ||
    /\d\s*\*\*\s*\d/.test(s) ||
    /\d\s*e\s*[+-]?\d/i.test(s)
  if (!hasOp) return false
  // After removing sqrt keyword, only math alphabet left
  const stripped = s.replace(/\bsqrt\b/gi, '')
  if (!/^[\d\s\.\,\+\-\*\/×÷^√%()eE]+$/.test(stripped)) return false
  return true
}

function looksExplicitCalcCue(t) {
  return (
    /\b(quanto\s+fa|calcola(?:mi)?|fai\s+il\s+calcolo|calculate|what(?:'s|\s+is)|computa)\b/.test(t) ||
    /\b(diviso|moltiplicat[oa]|piu|più|meno|per\s+\d|volte)\b/.test(t) &&
      /\d/.test(t) &&
      /[\+\-\*\/×÷^%]|\b(diviso|per|volte|piu|più|meno)\b/.test(t)
  )
}

/**
 * Follow-ups against activeCalculationContext.
 * @returns {false | { kind: string, operation: string, operand?: number, decimals?: number }}
 */
export function detectCalcFollowUp(raw, opts = {}) {
  if (!opts.hasCalcContext) return false
  const stripped = String(raw || '')
    .trim()
    .replace(/^(ok|okay|va bene|allora|quindi|perfetto|e|and)[,.]?\s+/i, '')
    .replace(/[.!?]+$/g, '')
    .trim()
  const t = fold(stripped)

  if (looksQuotedOrInjectedCalc(raw) || isMetaMathTalk(t)) return false

  // Explanation / steps
  if (
    /^\s*(spiegami(?:\s+come(?:\s+hai\s+fatto)?)?|mostrami\s+i\s+passaggi|show\s+(?:me\s+)?(?:the\s+)?steps|explain(?:\s+how)?)\s*[.!]?\s*$/i.test(
      stripped,
    ) ||
    /\b(spiegami\s+come\s+hai\s+fatto|mostrami\s+i\s+passaggi|show\s+steps|explain\s+how)\b/.test(t)
  ) {
    return { kind: 'explain', operation: 'explain' }
  }

  // Copy result
  if (
    /\b(copia\s+il\s+risultato|copy\s+the\s+result|copia\s+risultato)\b/.test(t) ||
    /^\s*(copia\s+il\s+risultato|copy\s+(the\s+)?result)\s*[.!]?\s*$/i.test(stripped)
  ) {
    return { kind: 'copy_result', operation: 'copy_result' }
  }

  const div = t.match(
    /^(?:dividilo|dividila|dividi(?:lo|la)?|divide\s+it)\s+(?:per|by)\s+(\d+(?:[.,]\d+)?)\s*$/,
  )
  if (div) return { kind: 'follow_up', operation: 'divide', operand: Number(String(div[1]).replace(',', '.')) }

  const add = t.match(/^(?:aggiungi|add|somma)\s+(\d+(?:[.,]\d+)?)\s*$/)
  if (add) return { kind: 'follow_up', operation: 'add', operand: Number(String(add[1]).replace(',', '.')) }

  const mul = t.match(
    /^(?:moltiplicalo|moltiplicala|moltiplica(?:lo|la)?|multiply\s+it)\s+(?:per|by|for)\s+(\d+(?:[.,]\d+)?)\s*$/,
  )
  if (mul) return { kind: 'follow_up', operation: 'multiply', operand: Number(String(mul[1]).replace(',', '.')) }

  const sub = t.match(/^(?:sottrai|togli|subtract)\s+(\d+(?:[.,]\d+)?)\s*$/)
  if (sub) {
    return { kind: 'follow_up', operation: 'subtract', operand: Number(String(sub[1]).replace(',', '.')) }
  }

  const round = t.match(
    /^(?:arrotondalo|arrotonda(?:lo)?|round\s+it)\s+(?:a|to)\s+(\d+)\s*(?:decimali|decimal\s+places?|decimals?)?\s*$/,
  )
  if (round) {
    return { kind: 'follow_up', operation: 'round', decimals: Number(round[1]) }
  }

  return false
}

/**
 * @returns {{
 *   intent: 'calculator' | 'none'
 *   language: 'it'|'en'
 *   operation?: string
 *   expressionText?: string | null
 *   followUp?: boolean
 *   followUpKind?: string
 *   operand?: number
 *   decimals?: number
 *   percentHit?: boolean
 *   failureCode?: string | null
 * }}
 */
export function detectCalculatorIntent(raw, opts = {}) {
  const text = String(raw || '').trim()
  if (!text) return { intent: 'none', language: 'it' }

  const language = detectCalculatorLanguage(text, opts.languageHint === 'en' ? 'en' : 'it')

  // #330A3 — CONTENT IS NOT AUTHORIZATION
  const outer = analyzeOuterUserRequest(text)
  if (outer.contentIsData) {
    return { intent: 'none', language, failureCode: 'content_is_data' }
  }

  if (looksQuotedOrInjectedCalc(text)) {
    return { intent: 'none', language, failureCode: 'quoted_or_injected' }
  }

  const t = fold(text)
  if (isMetaMathTalk(t)) {
    return { intent: 'none', language, failureCode: 'meta_or_deferred' }
  }

  const follow = detectCalcFollowUp(text, {
    hasCalcContext: true, // detect patterns; controller enforces fresh context
  })
  // Only honor follow-ups when caller has context OR it's copy/explain (controller gates)
  if (follow) {
    if (
      opts.hasCalcContext ||
      follow.operation === 'copy_result' ||
      follow.operation === 'explain'
    ) {
      return {
        intent: 'calculator',
        language,
        operation: follow.operation,
        followUp: true,
        followUpKind: follow.kind,
        operand: follow.operand,
        decimals: follow.decimals,
      }
    }
    // Stale/missing context but clear follow-up phrasing → still Calculator (honest error)
    if (follow.kind === 'follow_up') {
      return {
        intent: 'calculator',
        language,
        operation: follow.operation,
        followUp: true,
        followUpKind: follow.kind,
        operand: follow.operand,
        decimals: follow.decimals,
      }
    }
  }

  // Percentage templates
  const pct = tryPercentageTemplate(text)
  if (pct) {
    return {
      intent: 'calculator',
      language,
      operation: pct.operation,
      expressionText: text,
      percentHit: true,
      followUp: false,
    }
  }

  const stripped = stripCalcCue(text)
  const strippedFold = fold(stripped)

  // Explicit cue + expression-ish remainder
  if (looksExplicitCalcCue(t)) {
    const candidate = strippedFold || t
    // "quanto fa" alone — not enough
    if (!/\d/.test(candidate)) {
      return { intent: 'none', language, failureCode: 'incomplete' }
    }
    // Prefer expression after cue
    if (looksBareArithmetic(fold(stripped)) || tryPercentageTemplate(stripped) || /[\+\-\*\/×÷^√%]/.test(stripped)) {
      return {
        intent: 'calculator',
        language,
        operation: 'expression',
        expressionText: stripped,
        followUp: false,
      }
    }
    // "quanto fa 125 × 17" after strip
    if (/\d/.test(stripped) && (/[\+\-\*\/×÷^√%]/.test(stripped) || /\bsqrt\b/.test(strippedFold))) {
      return {
        intent: 'calculator',
        language,
        operation: 'expression',
        expressionText: stripped,
        followUp: false,
      }
    }
  }

  // Bare arithmetic only
  if (looksBareArithmetic(t) || looksBareArithmetic(fold(stripped))) {
    return {
      intent: 'calculator',
      language,
      operation: 'expression',
      expressionText: stripped || text,
      followUp: false,
    }
  }

  // Word operators: "200 diviso 4"
  const wordOp = text.match(
    /^(\d+(?:[.,]\d+)?)\s+(diviso|diviso\s+per|per|volte|più|piu|meno|moltiplicato\s+per|divided\s+by|times|plus|minus)\s+(\d+(?:[.,]\d+)?)\s*[.?!]?\s*$/i,
  )
  if (wordOp) {
    const map = {
      diviso: '/',
      'diviso per': '/',
      'divided by': '/',
      per: '*',
      volte: '*',
      'moltiplicato per': '*',
      times: '*',
      più: '+',
      piu: '+',
      plus: '+',
      meno: '-',
      minus: '-',
    }
    const opKey = fold(wordOp[2])
    const op = map[opKey] || map[wordOp[2].toLowerCase()]
    if (op) {
      return {
        intent: 'calculator',
        language,
        operation: 'expression',
        expressionText: `${wordOp[1]} ${op} ${wordOp[3]}`,
        followUp: false,
      }
    }
  }

  return { intent: 'none', language }
}
