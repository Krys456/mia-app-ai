/**
 * #320 — Apply Energy Math intents (client orchestration; no Core / no Search).
 */

import { formatQuantity } from '../unit-conversion/format.js'
import {
  createEnergyMathContext,
  isEnergyMathContextFresh,
} from './active-context.js'
import {
  buildAssumptionText,
  energyErrorToCopyKey,
  energyMathCopy,
} from './copy.js'
import {
  computeEnergyFromPowerTime,
  computePowerFromEnergyTime,
  computeTimeFromEnergyPower,
  makeQuantity,
  preferDisplayQuantity,
  roundCanonicalResult,
} from './engine.js'
import { detectEnergyMathIntent } from './intent.js'
import { ENERGY_MATH_ERROR } from './limits.js'
import { formatCanonicalAs } from './quantity.js'

/**
 * @param {{
 *   text: string
 *   languageHint?: 'it'|'en'
 *   energyContext?: import('./active-context.js').ActiveEnergyMathContext | null
 *   env?: { copyTextSync?: (t: string) => boolean }
 * }} input
 */
export function applyEnergyMathIntent(input) {
  const lang = input.languageHint === 'en' ? 'en' : 'it'
  const ctx = isEnergyMathContextFresh(input.energyContext) ? input.energyContext : null
  const intent = detectEnergyMathIntent(input.text, {
    languageHint: lang,
    hasEnergyContext: Boolean(ctx),
  })

  if (intent.intent !== 'energy-math') {
    return {
      handled: false,
      reply: null,
      diag: { energyMathIntent: 'none', failureCode: intent.failureCode || null },
    }
  }

  const language = intent.language || lang

  if (intent.operation === 'copy_result') {
    if (!ctx) {
      return {
        handled: true,
        reply: energyMathCopy('copy_need_context', language),
        status: 'error',
        diag: baseDiag({
          operation: 'copy_result',
          contextFound: false,
          failureCode: ENERGY_MATH_ERROR.no_context,
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
      reply: energyMathCopy(ok ? 'copy_ok' : 'copy_fail', language),
      status: ok ? 'ok' : 'error',
      energyContext: ctx,
      diag: baseDiag({
        operation: 'copy_result',
        contextFound: true,
        contextReused: true,
        outputDimension: ctx.resultDimension,
        assumptionMode: ctx.assumptionMode,
        failureCode: ok ? null : 'copy_failed',
        parserStatus: 'ok',
      }),
    }
  }

  if (intent.operation === 'explain') {
    if (!ctx) {
      return {
        handled: true,
        reply: energyMathCopy('no_context', language),
        status: 'error',
        diag: baseDiag({
          operation: 'explain',
          contextFound: false,
          failureCode: ENERGY_MATH_ERROR.no_context,
        }),
      }
    }
    const header = energyMathCopy('explain_header', language)
    const reply = `${ctx.displayExpression}\n= ${ctx.displayResult}\n\n${header}\n${ctx.formula || ctx.operation}${
      ctx.assumptions ? `\n\n${ctx.assumptions}` : ''
    }`
    return {
      handled: true,
      reply,
      status: 'ok',
      energyContext: ctx,
      energyUi: buildEnergyUi(ctx),
      energyMathContextBlock: buildEnergyMathContextBlock(ctx),
      diag: baseDiag({
        operation: 'explain',
        contextFound: true,
        contextReused: true,
        outputDimension: ctx.resultDimension,
        assumptionMode: ctx.assumptionMode,
        parserStatus: 'ok',
        failureCode: null,
      }),
    }
  }

  if (intent.followUp) {
    if (!ctx) {
      return {
        handled: true,
        reply: energyMathCopy('no_context', language),
        status: 'error',
        diag: baseDiag({
          operation: intent.operation,
          contextFound: false,
          failureCode: ENERGY_MATH_ERROR.no_context,
        }),
      }
    }
    return applyFollowUp(intent, ctx, language)
  }

  if (intent.failureCode && !intent.power && !intent.energy) {
    return errorResult(intent.failureCode, language, intent)
  }

  return runOperation(intent, language, { contextFound: Boolean(ctx), contextReused: false })
}

function applyFollowUp(intent, ctx, language) {
  const op = intent.operation

  if (op === 'retarget_time') {
    // Prefer: keep prior power, new time → energy (if last was power×time or we have power in inputs)
    const power = reviveQty(ctx.inputs?.power) || reviveFromCanonical(ctx, 'power')
    if (!power || !intent.time) {
      return errorResult(ENERGY_MATH_ERROR.missing_quantity, language, intent, ctx)
    }
    return runOperation(
      {
        operation: 'power_times_time',
        power,
        time: intent.time,
        assumptionMode: ctx.assumptionMode || 'constant_power',
        language,
      },
      language,
      { contextFound: true, contextReused: true },
    )
  }

  if (op === 'retarget_power') {
    // If prior had time (power×time), recompute energy with new power.
    // If prior was runtime (energy/power), recompute runtime with new power.
    const time = reviveQty(ctx.inputs?.time)
    const energy = reviveQty(ctx.inputs?.energy)
    if (time && intent.power) {
      return runOperation(
        {
          operation: 'power_times_time',
          power: intent.power,
          time,
          assumptionMode: ctx.assumptionMode || 'constant_power',
          language,
        },
        language,
        { contextFound: true, contextReused: true },
      )
    }
    if (energy && intent.power) {
      return runOperation(
        {
          operation: 'energy_over_power',
          energy,
          power: intent.power,
          assumptionMode: 'ideal_runtime',
          language,
        },
        language,
        { contextFound: true, contextReused: true },
      )
    }
    return errorResult(ENERGY_MATH_ERROR.missing_quantity, language, intent, ctx)
  }

  if (op === 'retarget_unit') {
    if (intent.targetDimension !== ctx.resultDimension) {
      return {
        handled: true,
        reply: energyMathCopy('retarget_mismatch', language),
        status: 'error',
        energyContext: ctx,
        diag: baseDiag({
          operation: 'retarget_unit',
          contextFound: true,
          contextReused: true,
          failureCode: ENERGY_MATH_ERROR.incompatible,
          outputDimension: ctx.resultDimension,
        }),
      }
    }
    const formatted = formatCanonicalAs(
      ctx.resultCanonical,
      ctx.resultDimension,
      intent.targetUnitId,
      language,
    )
    if (!formatted) {
      return errorResult(ENERGY_MATH_ERROR.malformed, language, intent, ctx)
    }
    const energyContext = createEnergyMathContext({
      ...ctx,
      resultUnitId: formatted.unitId,
      resultValue: formatted.value,
      displayResult: formatted.display,
      language,
    })
    const line = `${ctx.displayExpression} = ${formatted.display}`
    return {
      handled: true,
      reply: line,
      status: 'ok',
      result: formatted.value,
      displayResult: formatted.display,
      energyContext,
      energyUi: buildEnergyUi(energyContext),
      diag: baseDiag({
        operation: 'retarget_unit',
        parserStatus: 'ok',
        contextFound: true,
        contextReused: true,
        outputDimension: ctx.resultDimension,
        assumptionMode: ctx.assumptionMode,
        failureCode: null,
      }),
    }
  }

  if (op === 'round') {
    const dec = typeof intent.decimals === 'number' ? intent.decimals : 2
    const roundedCanon = roundCanonicalResult(ctx.resultCanonical, dec)
    // Round in display unit space for friendlier UX
    const roundedDisplayVal = roundCanonicalResult(ctx.resultValue, dec)
    const displayResult = formatQuantity(roundedDisplayVal, ctx.resultUnitId, language)
    const energyContext = createEnergyMathContext({
      ...ctx,
      resultCanonical: roundedCanon,
      resultValue: roundedDisplayVal,
      displayResult,
      language,
    })
    return {
      handled: true,
      reply: `${ctx.displayExpression} = ${displayResult}`,
      status: 'ok',
      result: roundedDisplayVal,
      displayResult,
      energyContext,
      energyUi: buildEnergyUi(energyContext),
      diag: baseDiag({
        operation: 'round',
        parserStatus: 'ok',
        contextFound: true,
        contextReused: true,
        outputDimension: ctx.resultDimension,
        assumptionMode: ctx.assumptionMode,
        failureCode: null,
      }),
    }
  }

  return errorResult(ENERGY_MATH_ERROR.unsupported, language, intent, ctx)
}

function reviveQty(raw) {
  if (!raw || typeof raw !== 'object') return null
  return makeQuantity(Number(raw.value), raw.unitId)
}

function reviveFromCanonical(ctx, dim) {
  if (dim === 'power' && typeof ctx.canonicalInputs?.powerW === 'number') {
    return makeQuantity(ctx.canonicalInputs.powerW, 'w')
  }
  if (dim === 'time' && typeof ctx.canonicalInputs?.timeS === 'number') {
    return makeQuantity(ctx.canonicalInputs.timeS, 's')
  }
  if (dim === 'energy' && typeof ctx.canonicalInputs?.energyJ === 'number') {
    return makeQuantity(ctx.canonicalInputs.energyJ, 'j')
  }
  return null
}

function runOperation(intent, language, meta) {
  const assumptionMode = intent.assumptionMode || 'constant_power'
  let computed
  /** @type {Record<string, unknown>} */
  const inputs = {}
  let exprParts = []

  if (intent.operation === 'power_times_time') {
    if (!intent.power || !intent.time) {
      return errorResult(ENERGY_MATH_ERROR.missing_quantity, language, intent)
    }
    inputs.power = intent.power
    inputs.time = intent.time
    computed = computeEnergyFromPowerTime({ power: intent.power, time: intent.time })
    exprParts = [
      formatQuantity(intent.power.value, intent.power.unitId, language),
      '×',
      formatQuantity(intent.time.value, intent.time.unitId, language),
    ]
  } else if (intent.operation === 'energy_over_time') {
    if (!intent.energy || !intent.time) {
      return errorResult(ENERGY_MATH_ERROR.missing_quantity, language, intent)
    }
    inputs.energy = intent.energy
    inputs.time = intent.time
    computed = computePowerFromEnergyTime({ energy: intent.energy, time: intent.time })
    exprParts = [
      formatQuantity(intent.energy.value, intent.energy.unitId, language),
      '÷',
      formatQuantity(intent.time.value, intent.time.unitId, language),
    ]
  } else if (intent.operation === 'energy_over_power') {
    if (!intent.energy || !intent.power) {
      return errorResult(ENERGY_MATH_ERROR.missing_quantity, language, intent)
    }
    inputs.energy = intent.energy
    inputs.power = intent.power
    computed = computeTimeFromEnergyPower({ energy: intent.energy, power: intent.power })
    exprParts = [
      formatQuantity(intent.energy.value, intent.energy.unitId, language),
      '÷',
      formatQuantity(intent.power.value, intent.power.unitId, language),
    ]
  } else {
    return errorResult(ENERGY_MATH_ERROR.unsupported, language, intent)
  }

  if (computed.status !== 'ok') {
    return errorResult(computed.errorCode || ENERGY_MATH_ERROR.malformed, language, intent)
  }

  const preferred = preferDisplayQuantity(
    computed.resultCanonical,
    computed.resultDimension,
    language,
  )
  const displayExpression = exprParts.join(' ')
  const line = `${displayExpression} = ${preferred.display}`

  const assumption = buildAssumptionText(assumptionMode, language, {
    displayResult: preferred.display,
    energyLabel: inputs.energy
      ? formatQuantity(inputs.energy.value, inputs.energy.unitId, language)
      : null,
    powerLabel: inputs.power
      ? formatQuantity(inputs.power.value, inputs.power.unitId, language)
      : null,
  })

  // Always attach assumption for PV and runtime; light note for appliance/constant
  const includeAssumption =
    assumptionMode === 'ideal_constant_power_pv_math' ||
    assumptionMode === 'ideal_runtime' ||
    assumptionMode === 'constant_load'

  const reply = includeAssumption
    ? energyMathCopy('ok_with_assumption', language, { line, assumption })
    : line

  const energyContext = createEnergyMathContext({
    operation: computed.operation,
    formula: computed.formula,
    inputs,
    canonicalInputs: computed.canonicalInputs,
    resultCanonical: computed.resultCanonical,
    resultDimension: computed.resultDimension,
    resultUnitId: preferred.unitId,
    resultValue: preferred.value,
    displayResult: preferred.display,
    displayExpression,
    assumptions: assumption,
    assumptionMode,
    language,
  })

  const inputDimensions = Object.values(inputs)
    .map((q) => (q && q.dimension) || null)
    .filter(Boolean)

  return {
    handled: true,
    reply,
    status: 'ok',
    result: preferred.value,
    displayResult: preferred.display,
    energyContext,
    energyUi: buildEnergyUi(energyContext),
    energyMathContextBlock: buildEnergyMathContextBlock(energyContext),
    diag: baseDiag({
      operation: computed.operation,
      parserStatus: 'ok',
      contextFound: Boolean(meta.contextFound),
      contextReused: Boolean(meta.contextReused),
      inputDimensions,
      outputDimension: computed.resultDimension,
      assumptionMode,
      failureCode: null,
    }),
  }
}

function errorResult(code, language, intent = {}, ctx = null) {
  return {
    handled: true,
    reply: energyMathCopy(energyErrorToCopyKey(code), language),
    status: 'error',
    energyContext: ctx,
    diag: baseDiag({
      operation: intent.operation || 'compose',
      parserStatus: 'error',
      contextFound: Boolean(ctx),
      assumptionMode: intent.assumptionMode || null,
      failureCode: code,
    }),
  }
}

function buildEnergyUi(ctx) {
  if (!ctx) return null
  return {
    kind: 'result',
    title: ctx.language === 'en' ? 'Energy' : 'Energia',
    expression: ctx.displayExpression,
    result: ctx.displayResult,
    actions: [
      { id: 'copy_result', label: ctx.language === 'en' ? 'Copy' : 'Copia' },
      { id: 'show_calculation', label: ctx.language === 'en' ? 'Show calculation' : 'Mostra calcolo' },
    ],
  }
}

function baseDiag(partial) {
  return {
    energyMathIntent: 'energy-math',
    responseMode: 'deterministic',
    ...partial,
  }
}

/**
 * Structured grounding for optional Core explanation (RESULT AUTHORITATIVE).
 */
export function buildEnergyMathContextBlock(ctx) {
  if (!ctx) return ''
  const lines = [
    'ENERGY_MATH_CONTEXT (deterministic; RESULT IS AUTHORITATIVE)',
    `operation: ${ctx.operation}`,
    `formula: ${ctx.formula || ''}`,
    `expression: ${ctx.displayExpression}`,
    `result: ${ctx.displayResult}`,
    `result_dimension: ${ctx.resultDimension}`,
    `assumption_mode: ${ctx.assumptionMode}`,
    `assumptions: ${ctx.assumptions || ''}`,
    'Guidance: explain only; do not recompute; do not alter the final result; distinguish ideal math from real-world estimates.',
  ]
  return lines.join('\n')
}
