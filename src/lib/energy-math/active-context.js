/**
 * #320 — Bounded activeEnergyMathContext (session only).
 */

export const ENERGY_MATH_CONTEXT_KEY = 'shinkaido.activeEnergyMath.v1'
export const ENERGY_MATH_CONTEXT_TTL_MS = 15 * 60 * 1000

/**
 * @typedef {{
 *   operation: string
 *   inputs: Record<string, unknown>
 *   canonicalInputs: Record<string, number>
 *   resultCanonical: number
 *   resultDimension: string
 *   resultUnitId: string
 *   resultValue: number
 *   displayResult: string
 *   displayExpression: string
 *   assumptions: string
 *   assumptionMode: string
 *   language: 'it'|'en'
 *   createdAt: number
 *   expiresAt: number
 * }} ActiveEnergyMathContext
 */

export function createEnergyMathContext(input) {
  if (typeof input.resultCanonical !== 'number' || !Number.isFinite(input.resultCanonical)) return null
  const now = input.createdAt || Date.now()
  return {
    operation: String(input.operation || ''),
    formula: String(input.formula || ''),
    inputs: input.inputs && typeof input.inputs === 'object' ? input.inputs : {},
    canonicalInputs:
      input.canonicalInputs && typeof input.canonicalInputs === 'object' ? input.canonicalInputs : {},
    resultCanonical: input.resultCanonical,
    resultDimension: String(input.resultDimension || ''),
    resultUnitId: String(input.resultUnitId || ''),
    resultValue: typeof input.resultValue === 'number' ? input.resultValue : input.resultCanonical,
    displayResult: String(input.displayResult || ''),
    displayExpression: String(input.displayExpression || ''),
    assumptions: String(input.assumptions || ''),
    assumptionMode: String(input.assumptionMode || 'constant_power'),
    language: input.language === 'en' ? 'en' : 'it',
    createdAt: now,
    expiresAt: input.expiresAt || now + ENERGY_MATH_CONTEXT_TTL_MS,
  }
}

export function isEnergyMathContextFresh(ctx, nowMs = Date.now()) {
  if (!ctx || typeof ctx !== 'object') return false
  if (typeof ctx.resultCanonical !== 'number' || !Number.isFinite(ctx.resultCanonical)) return false
  if (typeof ctx.expiresAt !== 'number') return false
  return ctx.expiresAt > nowMs
}

export function loadEnergyMathContext(
  storage = typeof sessionStorage !== 'undefined' ? sessionStorage : null,
  nowMs = Date.now(),
) {
  if (!storage) return null
  try {
    const raw = storage.getItem(ENERGY_MATH_CONTEXT_KEY)
    if (!raw) return null
    const ctx = JSON.parse(raw)
    if (!isEnergyMathContextFresh(ctx, nowMs)) {
      storage.removeItem(ENERGY_MATH_CONTEXT_KEY)
      return null
    }
    return ctx
  } catch {
    return null
  }
}

export function saveEnergyMathContext(
  ctx,
  storage = typeof sessionStorage !== 'undefined' ? sessionStorage : null,
) {
  if (!storage) return
  try {
    if (!ctx || !isEnergyMathContextFresh(ctx)) {
      storage.removeItem(ENERGY_MATH_CONTEXT_KEY)
      return
    }
    storage.setItem(ENERGY_MATH_CONTEXT_KEY, JSON.stringify(ctx))
  } catch {
    /* ignore */
  }
}

export function clearEnergyMathContext(
  storage = typeof sessionStorage !== 'undefined' ? sessionStorage : null,
) {
  if (!storage) return
  try {
    storage.removeItem(ENERGY_MATH_CONTEXT_KEY)
  } catch {
    /* ignore */
  }
}
