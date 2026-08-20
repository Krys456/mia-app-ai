/**
 * #318 — Apply Calculator intents (client orchestration; no Core for simple results).
 */

import {
  createCalculationContext,
  isCalculationContextFresh,
} from './active-context.js'
import { calculatorCopy, errorCodeToCopyKey } from './copy.js'
import { formatDisplayResult, roundToDecimals, sanitizeNumber } from './format.js'
import { detectCalculatorIntent } from './intent.js'
import { CALC_ERROR } from './limits.js'
import { evaluateExpression, normalizeMathText } from './parser.js'
import { tryPercentageTemplate } from './percent.js'

/**
 * @param {{
 *   text: string
 *   languageHint?: 'it'|'en'
 *   calcContext?: import('./active-context.js').ActiveCalculationContext | null
 *   env?: { copyTextSync?: (t: string) => boolean }
 * }} input
 */
export function applyCalculatorIntent(input) {
  const lang = input.languageHint === 'en' ? 'en' : 'it'
  const ctx = isCalculationContextFresh(input.calcContext) ? input.calcContext : null
  const intent = detectCalculatorIntent(input.text, {
    languageHint: lang,
    hasCalcContext: Boolean(ctx),
  })

  if (intent.intent !== 'calculator') {
    return {
      handled: false,
      reply: null,
      diag: { calculatorIntent: 'none', failureCode: intent.failureCode || null },
    }
  }

  // --- Copy result ---
  if (intent.operation === 'copy_result') {
    if (!ctx) {
      return {
        handled: true,
        reply: calculatorCopy('copy_need_context', intent.language || lang),
        status: 'error',
        diag: {
          calculatorIntent: 'calculator',
          operation: 'copy_result',
          contextFound: false,
          failureCode: 'no_context',
          responseMode: 'deterministic',
        },
      }
    }
    const env = input.env || {}
    let ok = false
    if (typeof env.copyTextSync === 'function') {
      try {
        ok = Boolean(env.copyTextSync(String(ctx.displayResult || ctx.lastResult)))
      } catch {
        ok = false
      }
    }
    return {
      handled: true,
      reply: calculatorCopy(ok ? 'copy_ok' : 'copy_fail', intent.language || lang),
      status: ok ? 'ok' : 'error',
      calcContext: ctx,
      diag: {
        calculatorIntent: 'calculator',
        operation: 'copy_result',
        contextFound: true,
        contextReused: true,
        responseMode: 'deterministic',
        failureCode: ok ? null : 'copy_failed',
      },
    }
  }

  // --- Explain / steps ---
  if (intent.operation === 'explain') {
    if (!ctx) {
      return {
        handled: true,
        reply: calculatorCopy('no_context_followup', intent.language || lang),
        status: 'error',
        diag: {
          calculatorIntent: 'calculator',
          operation: 'explain',
          contextFound: false,
          failureCode: 'no_context',
          responseMode: 'deterministic',
        },
      }
    }
    const steps = Array.isArray(ctx.steps) && ctx.steps.length ? ctx.steps : null
    const header = calculatorCopy('explain_header', intent.language || lang)
    const line = `${ctx.lastExpression} = ${ctx.displayResult}`
    const reply = steps
      ? `${line}\n\n${header}\n${steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`
      : line
    // Optional grounding block for future Core (not sent automatically)
    const grounding = buildCalculationContextBlock(ctx)
    return {
      handled: true,
      reply,
      status: 'ok',
      calcContext: ctx,
      calculationContextBlock: grounding,
      calcUi: buildCalcUi(ctx),
      diag: {
        calculatorIntent: 'calculator',
        operation: 'explain',
        contextFound: true,
        contextReused: true,
        responseMode: 'deterministic',
        parserStatus: 'ok',
        resultType: ctx.resultType,
      },
    }
  }

  // --- Follow-ups ---
  if (intent.followUp && intent.operation && intent.operation !== 'explain') {
    if (!ctx) {
      return {
        handled: true,
        reply: calculatorCopy('no_context_followup', intent.language || lang),
        status: 'error',
        diag: {
          calculatorIntent: 'calculator',
          operation: intent.operation,
          contextFound: false,
          failureCode: 'no_context',
          responseMode: 'deterministic',
        },
      }
    }
    return applyFollowUp(intent, ctx, intent.language || lang)
  }

  // --- Percentage templates ---
  const pct = tryPercentageTemplate(input.text)
  if (pct) {
    return finalizeOk(
      {
        status: 'ok',
        operation: pct.operation,
        normalizedExpression: pct.normalizedExpression,
        result: pct.result,
        steps: pct.steps,
        money: pct.money,
        currencySymbol: pct.currencySymbol,
      },
      intent.language || lang,
      { contextFound: Boolean(ctx), expressionLength: String(input.text).length },
    )
  }

  // --- Expression ---
  const exprText = intent.expressionText || stripNoise(input.text)
  const evaluated = evaluateExpression(exprText)
  if (evaluated.status !== 'ok') {
    const key = errorCodeToCopyKey(evaluated.errorCode || CALC_ERROR.malformed)
    return {
      handled: true,
      reply: calculatorCopy(key, intent.language || lang),
      status: 'error',
      diag: {
        calculatorIntent: 'calculator',
        operation: 'expression',
        parserStatus: 'error',
        failureCode: evaluated.errorCode || CALC_ERROR.malformed,
        responseMode: 'deterministic',
        expressionLength: String(exprText).length,
        contextFound: Boolean(ctx),
      },
    }
  }

  return finalizeOk(
    {
      status: 'ok',
      operation: 'expression',
      normalizedExpression: evaluated.normalizedExpression || normalizeMathText(exprText),
      result: evaluated.result,
      steps: evaluated.steps || [],
      money: false,
      currencySymbol: null,
    },
    intent.language || lang,
    { contextFound: Boolean(ctx), expressionLength: String(exprText).length },
  )
}

function stripNoise(raw) {
  return String(raw || '')
    .replace(/^[¿?¡!\s]+/, '')
    .replace(/\?+\s*$/, '')
    .trim()
}

function applyFollowUp(intent, ctx, lang) {
  const op = intent.operation
  let next = ctx.lastResult
  /** @type {string[]} */
  const steps = [...(ctx.steps || [])]
  let expression = ctx.lastExpression

  if (op === 'divide') {
    const d = Number(intent.operand)
    if (!Number.isFinite(d)) {
      return errorReply(CALC_ERROR.malformed, lang, intent)
    }
    if (d === 0) {
      return errorReply(CALC_ERROR.div_zero, lang, intent, ctx)
    }
    next = sanitizeNumber(ctx.lastResult / d)
    expression = `(${ctx.displayResult}) ÷ ${d}`
    steps.push(`${ctx.lastResult} ÷ ${d} = ${next}`)
  } else if (op === 'add') {
    const a = Number(intent.operand)
    next = sanitizeNumber(ctx.lastResult + a)
    expression = `(${ctx.displayResult}) + ${a}`
    steps.push(`${ctx.lastResult} + ${a} = ${next}`)
  } else if (op === 'subtract') {
    const a = Number(intent.operand)
    next = sanitizeNumber(ctx.lastResult - a)
    expression = `(${ctx.displayResult}) − ${a}`
    steps.push(`${ctx.lastResult} − ${a} = ${next}`)
  } else if (op === 'multiply') {
    const a = Number(intent.operand)
    next = sanitizeNumber(ctx.lastResult * a)
    expression = `(${ctx.displayResult}) × ${a}`
    steps.push(`${ctx.lastResult} × ${a} = ${next}`)
  } else if (op === 'round') {
    const dec = typeof intent.decimals === 'number' ? intent.decimals : 2
    next = roundToDecimals(ctx.lastResult, dec)
    expression = `round(${ctx.displayResult}, ${dec})`
    steps.push(`Arrotonda ${ctx.lastResult} a ${dec} decimali → ${next}`)
  } else {
    return errorReply(CALC_ERROR.unsupported, lang, intent, ctx)
  }

  if (!Number.isFinite(next)) {
    return errorReply(CALC_ERROR.overflow, lang, intent, ctx)
  }

  return finalizeOk(
    {
      status: 'ok',
      operation: op,
      normalizedExpression: expression,
      result: next,
      steps,
      money: ctx.money,
      currencySymbol: ctx.currencySymbol,
    },
    lang,
    { contextFound: true, contextReused: true, expressionLength: expression.length },
  )
}

function errorReply(code, lang, intent, ctx = null) {
  return {
    handled: true,
    reply: calculatorCopy(errorCodeToCopyKey(code), lang),
    status: 'error',
    calcContext: ctx,
    diag: {
      calculatorIntent: 'calculator',
      operation: intent.operation,
      parserStatus: 'error',
      failureCode: code,
      responseMode: 'deterministic',
      contextFound: Boolean(ctx),
    },
  }
}

function finalizeOk(computed, lang, meta = {}) {
  const display = formatDisplayResult(computed.result, {
    language: lang,
    money: Boolean(computed.money),
    currencySymbol: computed.currencySymbol || null,
  })
  const expr = computed.normalizedExpression
  const reply =
    lang === 'en' ? `${prettyExpr(expr)} = ${display}` : `${prettyExpr(expr)} = ${display}`

  const calcContext = createCalculationContext({
    lastExpression: prettyExpr(expr),
    lastResult: computed.result,
    displayResult: display,
    resultType: computed.money ? 'money' : 'number',
    operation: computed.operation,
    steps: computed.steps || [],
    money: computed.money,
    currencySymbol: computed.currencySymbol,
    language: lang,
  })

  return {
    handled: true,
    reply,
    status: 'ok',
    result: computed.result,
    displayResult: display,
    calcContext,
    calcUi: buildCalcUi(calcContext),
    diag: {
      calculatorIntent: 'calculator',
      operation: computed.operation,
      parserStatus: 'ok',
      resultType: calcContext?.resultType || 'number',
      contextFound: Boolean(meta.contextFound),
      contextReused: Boolean(meta.contextReused),
      responseMode: 'deterministic',
      expressionLength: meta.expressionLength ?? null,
      failureCode: null,
      activeCalculationContextCreated: Boolean(calcContext),
    },
  }
}

function prettyExpr(expr) {
  return String(expr || '')
    .replace(/\*/g, '×')
    .replace(/\//g, '÷')
}

function buildCalcUi(ctx) {
  if (!ctx) return null
  return {
    kind: 'result',
    expression: ctx.lastExpression,
    result: ctx.displayResult,
    actions: [{ id: 'copy_result', label: ctx.language === 'en' ? 'Copy' : 'Copia' }],
  }
}

/**
 * Structured grounding for optional Core explanation (RESULT AUTHORITATIVE).
 */
export function buildCalculationContextBlock(ctx) {
  if (!ctx) return ''
  const lines = [
    'CALCULATION_CONTEXT (deterministic; RESULT IS AUTHORITATIVE)',
    `expression: ${ctx.lastExpression}`,
    `result: ${ctx.displayResult}`,
    `numeric_result: ${ctx.lastResult}`,
  ]
  if (Array.isArray(ctx.steps) && ctx.steps.length) {
    lines.push('steps:')
    ctx.steps.forEach((s, i) => lines.push(`  ${i + 1}. ${s}`))
  }
  lines.push('Guidance: explain only; do not recompute; do not alter the final result.')
  return lines.join('\n')
}
