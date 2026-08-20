/**
 * #319 — Bounded activeConversionContext (session only; no Memory/Supabase).
 */

export const CONV_CONTEXT_KEY = 'shinkaido.activeConversion.v1'
export const CONV_CONTEXT_TTL_MS = 15 * 60 * 1000

/**
 * @typedef {{
 *   inputValue: number
 *   canonicalValue: number
 *   dimension: string
 *   sourceUnit: string
 *   targetUnit: string
 *   resultValue: number
 *   displayResult: string
 *   displayInput: string
 *   language: 'it' | 'en'
 *   createdAt: number
 *   expiresAt: number
 * }} ActiveConversionContext
 */

export function createConversionContext(input) {
  if (typeof input.inputValue !== 'number' || !Number.isFinite(input.inputValue)) return null
  if (typeof input.resultValue !== 'number' || !Number.isFinite(input.resultValue)) return null
  const now = input.createdAt || Date.now()
  return {
    inputValue: input.inputValue,
    canonicalValue: typeof input.canonicalValue === 'number' ? input.canonicalValue : input.inputValue,
    dimension: String(input.dimension || ''),
    sourceUnit: String(input.sourceUnit || ''),
    targetUnit: String(input.targetUnit || ''),
    resultValue: input.resultValue,
    displayResult: String(input.displayResult || input.resultValue),
    displayInput: String(input.displayInput || input.inputValue),
    language: input.language === 'en' ? 'en' : 'it',
    createdAt: now,
    expiresAt: input.expiresAt || now + CONV_CONTEXT_TTL_MS,
  }
}

export function isConversionContextFresh(ctx, nowMs = Date.now()) {
  if (!ctx || typeof ctx !== 'object') return false
  if (typeof ctx.resultValue !== 'number' || !Number.isFinite(ctx.resultValue)) return false
  if (typeof ctx.expiresAt !== 'number') return false
  return ctx.expiresAt > nowMs
}

export function loadConversionContext(
  storage = typeof sessionStorage !== 'undefined' ? sessionStorage : null,
  nowMs = Date.now(),
) {
  if (!storage) return null
  try {
    const raw = storage.getItem(CONV_CONTEXT_KEY)
    if (!raw) return null
    const ctx = JSON.parse(raw)
    if (!isConversionContextFresh(ctx, nowMs)) {
      storage.removeItem(CONV_CONTEXT_KEY)
      return null
    }
    return ctx
  } catch {
    return null
  }
}

export function saveConversionContext(
  ctx,
  storage = typeof sessionStorage !== 'undefined' ? sessionStorage : null,
) {
  if (!storage) return
  try {
    if (!ctx || !isConversionContextFresh(ctx)) {
      storage.removeItem(CONV_CONTEXT_KEY)
      return
    }
    storage.setItem(CONV_CONTEXT_KEY, JSON.stringify(ctx))
  } catch {
    /* ignore */
  }
}

export function clearConversionContext(
  storage = typeof sessionStorage !== 'undefined' ? sessionStorage : null,
) {
  if (!storage) return
  try {
    storage.removeItem(CONV_CONTEXT_KEY)
  } catch {
    /* ignore */
  }
}
