/**
 * #318 — Safe calculator diagnostics (?calculator_diag=1).
 * Do not log full expressions by default.
 */

export const CALCULATOR_DIAG_BUILD = '318-1'

export function isCalculatorDiagEnabled(search) {
  try {
    const q =
      search != null
        ? String(search)
        : typeof window !== 'undefined'
          ? window.location.search
          : ''
    if (!q) return false
    const params = new URLSearchParams(q.startsWith('?') ? q.slice(1) : q)
    const v = params.get('calculator_diag')
    return v === '1' || v === 'true'
  } catch {
    return false
  }
}

export function buildCalculatorDiag(partial = {}) {
  let buildId = CALCULATOR_DIAG_BUILD
  try {
    if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_BUILD_ID) {
      buildId = import.meta.env.VITE_BUILD_ID
    }
  } catch {
    /* ignore */
  }
  return {
    route: 'calculator-action',
    diagBuild: CALCULATOR_DIAG_BUILD,
    buildId,
    requestId: partial.requestId || `calc_${Date.now().toString(36)}`,
    calculatorIntent: partial.calculatorIntent ?? 'calculator',
    operation: partial.operation ?? null,
    parserStatus: partial.parserStatus ?? null,
    resultType: partial.resultType ?? null,
    contextFound: Boolean(partial.contextFound),
    contextReused: Boolean(partial.contextReused),
    responseMode: partial.responseMode ?? 'deterministic',
    expressionLength:
      typeof partial.expressionLength === 'number' ? partial.expressionLength : null,
    failureCode: partial.failureCode ?? null,
  }
}

export function rememberCalculatorDiag(diag) {
  try {
    if (typeof sessionStorage === 'undefined') return
    sessionStorage.setItem('shinkaido.calculatorDiag.last', JSON.stringify(diag))
  } catch {
    /* ignore */
  }
}

export function logCalculatorSafe(fields = {}) {
  try {
    console.info(
      '[calculator-action]',
      JSON.stringify({
        route: 'calculator-action',
        operation: fields.operation ?? null,
        parserStatus: fields.parserStatus ?? null,
        failureCode: fields.failureCode ?? null,
        contextReused: Boolean(fields.contextReused),
      }),
    )
  } catch {
    /* ignore */
  }
}
