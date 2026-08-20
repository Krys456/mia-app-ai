/**
 * #319 — Apply Unit Conversion intents (client orchestration; no Core / no Search).
 */

import { roundToDecimals, sanitizeNumber } from '../calculator/format.js'
import {
  createConversionContext,
  isConversionContextFresh,
} from './active-context.js'
import { convertUnits } from './convert.js'
import { unitConversionCopy, unitErrorToCopyKey } from './copy.js'
import { formatConversionNumber, formatQuantity } from './format.js'
import { detectUnitConversionIntent } from './intent.js'
import { UNIT_ERROR } from './limits.js'
import { getUnitById } from './registry.js'

/**
 * @param {{
 *   text: string
 *   languageHint?: 'it'|'en'
 *   conversionContext?: import('./active-context.js').ActiveConversionContext | null
 *   env?: { copyTextSync?: (t: string) => boolean }
 * }} input
 */
export function applyUnitConversionIntent(input) {
  const lang = input.languageHint === 'en' ? 'en' : 'it'
  const ctx = isConversionContextFresh(input.conversionContext) ? input.conversionContext : null
  const intent = detectUnitConversionIntent(input.text, {
    languageHint: lang,
    hasConversionContext: Boolean(ctx),
  })

  if (intent.intent !== 'unit-conversion') {
    return {
      handled: false,
      reply: null,
      diag: { unitIntent: 'none', failureCode: intent.failureCode || null },
    }
  }

  const language = intent.language || lang

  // --- Copy ---
  if (intent.operation === 'copy_result') {
    if (!ctx) {
      return {
        handled: true,
        reply: unitConversionCopy('copy_need_context', language),
        status: 'error',
        diag: baseDiag({
          operation: 'copy_result',
          contextFound: false,
          failureCode: UNIT_ERROR.no_context,
        }),
      }
    }
    let ok = false
    if (typeof input.env?.copyTextSync === 'function') {
      try {
        ok = Boolean(input.env.copyTextSync(String(ctx.displayResult || ctx.resultValue)))
      } catch {
        ok = false
      }
    }
    return {
      handled: true,
      reply: unitConversionCopy(ok ? 'copy_ok' : 'copy_fail', language),
      status: ok ? 'ok' : 'error',
      conversionContext: ctx,
      diag: baseDiag({
        operation: 'copy_result',
        contextFound: true,
        contextReused: true,
        dimension: ctx.dimension,
        sourceUnit: ctx.sourceUnit,
        targetUnit: ctx.targetUnit,
        failureCode: ok ? null : 'copy_failed',
        parserStatus: 'ok',
      }),
    }
  }

  // --- Follow-ups ---
  if (intent.followUp) {
    if (!ctx) {
      return {
        handled: true,
        reply: unitConversionCopy('no_context', language),
        status: 'error',
        diag: baseDiag({
          operation: intent.operation,
          contextFound: false,
          failureCode: UNIT_ERROR.no_context,
        }),
      }
    }
    return applyFollowUp(intent, ctx, language)
  }

  // --- Early failure from intent (ambiguous storage / too long / malformed) ---
  if (intent.failureCode && !intent.sourceUnitId) {
    return errorResult(intent.failureCode, language, intent)
  }

  if (
    typeof intent.value !== 'number' ||
    !intent.sourceUnitId ||
    !intent.targetUnitId
  ) {
    return errorResult(UNIT_ERROR.malformed, language, intent)
  }

  return finalizeConvert(intent.value, intent.sourceUnitId, intent.targetUnitId, language, {
    contextFound: Boolean(ctx),
    contextReused: false,
    operation: 'convert',
  })
}

function applyFollowUp(intent, ctx, language) {
  const op = intent.operation

  if (op === 'same_pair') {
    return finalizeConvert(intent.value, ctx.sourceUnit, ctx.targetUnit, language, {
      contextFound: true,
      contextReused: true,
      operation: 'same_pair',
    })
  }

  if (op === 'retarget') {
    // Current physical quantity is resultValue in targetUnit → new target
    return finalizeConvert(ctx.resultValue, ctx.targetUnit, intent.targetUnitId, language, {
      contextFound: true,
      contextReused: true,
      operation: 'retarget',
    })
  }

  if (op === 'double') {
    const next = sanitizeNumber(ctx.inputValue * 2)
    return finalizeConvert(next, ctx.sourceUnit, ctx.targetUnit, language, {
      contextFound: true,
      contextReused: true,
      operation: 'double',
    })
  }

  if (op === 'round') {
    const dec = typeof intent.decimals === 'number' ? intent.decimals : 2
    const rounded = roundToDecimals(ctx.resultValue, dec)
    const displayResult = formatQuantity(rounded, ctx.targetUnit, language)
    const displayInput = formatQuantity(ctx.inputValue, ctx.sourceUnit, language)
    const conversionContext = createConversionContext({
      inputValue: ctx.inputValue,
      canonicalValue: ctx.canonicalValue,
      dimension: ctx.dimension,
      sourceUnit: ctx.sourceUnit,
      targetUnit: ctx.targetUnit,
      resultValue: rounded,
      displayResult,
      displayInput,
      language,
    })
    const reply = unitConversionCopy('ok', language, { displayInput, displayResult })
    return {
      handled: true,
      reply,
      status: 'ok',
      result: rounded,
      displayResult,
      conversionContext,
      unitUi: buildUnitUi(conversionContext),
      diag: baseDiag({
        operation: 'round',
        parserStatus: 'ok',
        contextFound: true,
        contextReused: true,
        dimension: ctx.dimension,
        sourceUnit: ctx.sourceUnit,
        targetUnit: ctx.targetUnit,
        failureCode: null,
      }),
    }
  }

  return errorResult(UNIT_ERROR.unsupported, language, intent, ctx)
}

function finalizeConvert(value, sourceId, targetId, language, meta) {
  const converted = convertUnits({ value, sourceUnit: sourceId, targetUnit: targetId })
  if (converted.status !== 'ok') {
    return errorResult(converted.errorCode || UNIT_ERROR.malformed, language, {
      operation: meta.operation || 'convert',
      sourceUnitId: sourceId,
      targetUnitId: targetId,
    })
  }

  const displayInput = formatQuantity(converted.inputValue, converted.sourceUnit, language)
  const displayResult = formatQuantity(converted.resultValue, converted.targetUnit, language)
  const conversionContext = createConversionContext({
    inputValue: converted.inputValue,
    canonicalValue: converted.canonicalValue,
    dimension: converted.dimension,
    sourceUnit: converted.sourceUnit,
    targetUnit: converted.targetUnit,
    resultValue: converted.resultValue,
    displayResult,
    displayInput,
    language,
  })

  return {
    handled: true,
    reply: unitConversionCopy('ok', language, { displayInput, displayResult }),
    status: 'ok',
    result: converted.resultValue,
    displayResult,
    conversionContext,
    unitUi: buildUnitUi(conversionContext),
    model: {
      status: 'ok',
      dimension: converted.dimension,
      inputValue: converted.inputValue,
      sourceUnit: converted.sourceUnit,
      targetUnit: converted.targetUnit,
      canonicalValue: converted.canonicalValue,
      resultValue: converted.resultValue,
      displayInput,
      displayResult,
    },
    diag: baseDiag({
      operation: meta.operation || 'convert',
      parserStatus: 'ok',
      contextFound: Boolean(meta.contextFound),
      contextReused: Boolean(meta.contextReused),
      dimension: converted.dimension,
      sourceUnit: converted.sourceUnit,
      targetUnit: converted.targetUnit,
      failureCode: null,
    }),
  }
}

function errorResult(code, language, intent = {}, ctx = null) {
  let key = unitErrorToCopyKey(code)
  // Prefer specific power/energy copy when units look like kW/kWh
  if (code === UNIT_ERROR.power_energy) {
    const s = intent.sourceUnitId || ''
    const t = intent.targetUnitId || ''
    if ((s === 'kw' && t === 'kwh') || (s === 'kwh' && t === 'kw')) {
      key = 'power_energy'
    } else {
      key = 'power_energy_generic'
    }
  }
  return {
    handled: true,
    reply: unitConversionCopy(key, language),
    status: 'error',
    conversionContext: ctx,
    diag: baseDiag({
      operation: intent.operation || 'convert',
      parserStatus: 'error',
      contextFound: Boolean(ctx),
      dimension: null,
      sourceUnit: intent.sourceUnitId || null,
      targetUnit: intent.targetUnitId || null,
      failureCode: code,
    }),
  }
}

function buildUnitUi(ctx) {
  if (!ctx) return null
  const src = getUnitById(ctx.sourceUnit)
  const tgt = getUnitById(ctx.targetUnit)
  return {
    kind: 'result',
    source: formatQuantity(ctx.inputValue, ctx.sourceUnit, ctx.language),
    target: formatQuantity(ctx.resultValue, ctx.targetUnit, ctx.language),
    sourceSymbol: src?.symbol || ctx.sourceUnit,
    targetSymbol: tgt?.symbol || ctx.targetUnit,
    actions: [{ id: 'copy_result', label: ctx.language === 'en' ? 'Copy' : 'Copia' }],
  }
}

function baseDiag(partial) {
  return {
    unitIntent: 'unit-conversion',
    responseMode: 'deterministic',
    ...partial,
  }
}
