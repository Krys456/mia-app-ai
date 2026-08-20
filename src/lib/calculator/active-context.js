/**
 * #318 — Bounded activeCalculationContext (session only).
 */

export const CALC_CONTEXT_KEY = 'shinkaido.activeCalculation.v1'
export const CALC_CONTEXT_TTL_MS = 15 * 60 * 1000

/**
 * @typedef {{
 *   lastExpression: string
 *   lastResult: number
 *   displayResult: string
 *   resultType: string
 *   operation: string
 *   steps: string[]
 *   money: boolean
 *   currencySymbol: string | null
 *   language: 'it' | 'en'
 *   createdAt: number
 *   expiresAt: number
 * }} ActiveCalculationContext
 */

export function createCalculationContext(input) {
  if (typeof input.lastResult !== 'number' || !Number.isFinite(input.lastResult)) return null
  const now = input.createdAt || Date.now()
  return {
    lastExpression: String(input.lastExpression || '').slice(0, 200),
    lastResult: input.lastResult,
    displayResult: String(input.displayResult || input.lastResult),
    resultType: String(input.resultType || 'number'),
    operation: String(input.operation || 'expression'),
    steps: Array.isArray(input.steps) ? input.steps.slice(0, 20) : [],
    money: Boolean(input.money),
    currencySymbol: input.currencySymbol || null,
    language: input.language === 'en' ? 'en' : 'it',
    createdAt: now,
    expiresAt: input.expiresAt || now + CALC_CONTEXT_TTL_MS,
  }
}

export function isCalculationContextFresh(ctx, nowMs = Date.now()) {
  if (!ctx || typeof ctx !== 'object') return false
  if (typeof ctx.lastResult !== 'number' || !Number.isFinite(ctx.lastResult)) return false
  if (typeof ctx.expiresAt !== 'number') return false
  return ctx.expiresAt > nowMs
}

export function loadCalculationContext(
  storage = typeof sessionStorage !== 'undefined' ? sessionStorage : null,
  nowMs = Date.now(),
) {
  if (!storage) return null
  try {
    const raw = storage.getItem(CALC_CONTEXT_KEY)
    if (!raw) return null
    const ctx = JSON.parse(raw)
    if (!isCalculationContextFresh(ctx, nowMs)) {
      storage.removeItem(CALC_CONTEXT_KEY)
      return null
    }
    return ctx
  } catch {
    return null
  }
}

export function saveCalculationContext(
  ctx,
  storage = typeof sessionStorage !== 'undefined' ? sessionStorage : null,
) {
  if (!storage) return
  try {
    if (!ctx || !isCalculationContextFresh(ctx)) {
      storage.removeItem(CALC_CONTEXT_KEY)
      return
    }
    storage.setItem(CALC_CONTEXT_KEY, JSON.stringify(ctx))
  } catch {
    /* ignore */
  }
}

export function clearCalculationContext(
  storage = typeof sessionStorage !== 'undefined' ? sessionStorage : null,
) {
  if (!storage) return
  try {
    storage.removeItem(CALC_CONTEXT_KEY)
  } catch {
    /* ignore */
  }
}
