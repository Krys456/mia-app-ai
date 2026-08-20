/**
 * #319 — Safe unit-conversion diagnostics (?unit_conversion_diag=1).
 */

export const UNIT_CONVERSION_DIAG_BUILD = '319-1'

export function isUnitConversionDiagEnabled(search) {
  try {
    const q =
      search != null
        ? String(search)
        : typeof window !== 'undefined'
          ? window.location.search
          : ''
    if (!q) return false
    const params = new URLSearchParams(q.startsWith('?') ? q.slice(1) : q)
    const v = params.get('unit_conversion_diag')
    return v === '1' || v === 'true'
  } catch {
    return false
  }
}

export function buildUnitConversionDiag(partial = {}) {
  let buildId = UNIT_CONVERSION_DIAG_BUILD
  try {
    if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_BUILD_ID) {
      buildId = import.meta.env.VITE_BUILD_ID
    }
  } catch {
    /* ignore */
  }
  return {
    route: 'unit-conversion-action',
    diagBuild: UNIT_CONVERSION_DIAG_BUILD,
    buildId,
    requestId: partial.requestId || `unit_${Date.now().toString(36)}`,
    unitIntent: partial.unitIntent ?? 'unit-conversion',
    operation: partial.operation ?? null,
    dimension: partial.dimension ?? null,
    sourceUnit: partial.sourceUnit ?? null,
    targetUnit: partial.targetUnit ?? null,
    parserStatus: partial.parserStatus ?? null,
    contextFound: Boolean(partial.contextFound),
    contextReused: Boolean(partial.contextReused),
    responseMode: partial.responseMode ?? 'deterministic',
    failureCode: partial.failureCode ?? null,
  }
}

export function rememberUnitConversionDiag(diag) {
  try {
    if (typeof sessionStorage === 'undefined') return
    sessionStorage.setItem('shinkaido.unitConversionDiag.last', JSON.stringify(diag))
  } catch {
    /* ignore */
  }
}

export function logUnitConversionSafe(fields = {}) {
  try {
    console.info(
      '[unit-conversion-action]',
      JSON.stringify({
        route: 'unit-conversion-action',
        operation: fields.operation ?? null,
        dimension: fields.dimension ?? null,
        sourceUnit: fields.sourceUnit ?? null,
        targetUnit: fields.targetUnit ?? null,
        parserStatus: fields.parserStatus ?? null,
        failureCode: fields.failureCode ?? null,
        contextReused: Boolean(fields.contextReused),
      }),
    )
  } catch {
    /* ignore */
  }
}
