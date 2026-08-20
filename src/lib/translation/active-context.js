/**
 * #322 — Session-only activeTranslationContext.
 */

export const TRANSLATION_CONTEXT_KEY = 'shinkaido.activeTranslation.v1'
export const TRANSLATION_CONTEXT_TTL_MS = 20 * 60 * 1000

export function createTranslationContext(input) {
  if (!input || typeof input !== 'object') return null
  const sourceText = String(input.sourceText || '').slice(0, 4000)
  const translatedText = String(input.translatedText || '').slice(0, 8000)
  if (!sourceText || !translatedText) return null
  const now = input.createdAt || Date.now()
  return {
    sourceText,
    translatedText,
    sourceLanguage: input.sourceLanguage || 'auto',
    targetLanguage: input.targetLanguage || null,
    targetCode: input.targetCode || null,
    mode: input.mode || 'preserve',
    language: input.language === 'en' ? 'en' : 'it',
    createdAt: now,
    expiresAt: input.expiresAt || now + TRANSLATION_CONTEXT_TTL_MS,
  }
}

export function isTranslationContextFresh(ctx, nowMs = Date.now()) {
  if (!ctx || typeof ctx !== 'object') return false
  if (!ctx.sourceText || !ctx.translatedText) return false
  if (typeof ctx.expiresAt !== 'number') return false
  return ctx.expiresAt > nowMs
}

export function loadTranslationContext(
  storage = typeof sessionStorage !== 'undefined' ? sessionStorage : null,
  nowMs = Date.now(),
) {
  if (!storage) return null
  try {
    const raw = storage.getItem(TRANSLATION_CONTEXT_KEY)
    if (!raw) return null
    const ctx = JSON.parse(raw)
    if (!isTranslationContextFresh(ctx, nowMs)) {
      storage.removeItem(TRANSLATION_CONTEXT_KEY)
      return null
    }
    return ctx
  } catch {
    return null
  }
}

export function saveTranslationContext(
  ctx,
  storage = typeof sessionStorage !== 'undefined' ? sessionStorage : null,
) {
  if (!storage) return
  try {
    if (!ctx || !isTranslationContextFresh(ctx)) {
      storage.removeItem(TRANSLATION_CONTEXT_KEY)
      return
    }
    storage.setItem(TRANSLATION_CONTEXT_KEY, JSON.stringify(ctx))
  } catch {
    /* ignore */
  }
}

export function clearTranslationContext(
  storage = typeof sessionStorage !== 'undefined' ? sessionStorage : null,
) {
  if (!storage) return
  try {
    storage.removeItem(TRANSLATION_CONTEXT_KEY)
  } catch {
    /* ignore */
  }
}
