/**
 * #320 — Safe Energy Math diagnostics (?energy_math_diag=1).
 */

export const ENERGY_MATH_DIAG_BUILD = '320-1'

export function isEnergyMathDiagEnabled(search) {
  try {
    const q =
      search != null
        ? String(search)
        : typeof window !== 'undefined'
          ? window.location.search
          : ''
    if (!q) return false
    const params = new URLSearchParams(q.startsWith('?') ? q.slice(1) : q)
    const v = params.get('energy_math_diag')
    return v === '1' || v === 'true'
  } catch {
    return false
  }
}

export function buildEnergyMathDiag(partial = {}) {
  let buildId = ENERGY_MATH_DIAG_BUILD
  try {
    if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_BUILD_ID) {
      buildId = import.meta.env.VITE_BUILD_ID
    }
  } catch {
    /* ignore */
  }
  return {
    route: 'energy-math-action',
    diagBuild: ENERGY_MATH_DIAG_BUILD,
    buildId,
    requestId: partial.requestId || `em_${Date.now().toString(36)}`,
    energyMathIntent: partial.energyMathIntent ?? 'energy-math',
    operation: partial.operation ?? null,
    inputDimensions: partial.inputDimensions ?? null,
    outputDimension: partial.outputDimension ?? null,
    parserStatus: partial.parserStatus ?? null,
    contextFound: Boolean(partial.contextFound),
    contextReused: Boolean(partial.contextReused),
    assumptionMode: partial.assumptionMode ?? null,
    responseMode: partial.responseMode ?? 'deterministic',
    failureCode: partial.failureCode ?? null,
  }
}

export function rememberEnergyMathDiag(diag) {
  try {
    if (typeof sessionStorage === 'undefined') return
    sessionStorage.setItem('shinkaido.energyMathDiag.last', JSON.stringify(diag))
  } catch {
    /* ignore */
  }
}

export function logEnergyMathSafe(fields = {}) {
  try {
    console.info(
      '[energy-math-action]',
      JSON.stringify({
        route: 'energy-math-action',
        operation: fields.operation ?? null,
        inputDimensions: fields.inputDimensions ?? null,
        outputDimension: fields.outputDimension ?? null,
        parserStatus: fields.parserStatus ?? null,
        assumptionMode: fields.assumptionMode ?? null,
        failureCode: fields.failureCode ?? null,
        contextReused: Boolean(fields.contextReused),
      }),
    )
  } catch {
    /* ignore */
  }
}
