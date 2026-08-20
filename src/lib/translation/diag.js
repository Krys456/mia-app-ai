/**
 * #322 — Safe Translation diagnostics (?translation_diag=1).
 */

export const TRANSLATION_DIAG_BUILD = '322-1'

export function isTranslationDiagEnabled(search) {
  try {
    const q =
      search != null
        ? String(search)
        : typeof window !== 'undefined'
          ? window.location.search
          : ''
    if (!q) return false
    const params = new URLSearchParams(q.startsWith('?') ? q.slice(1) : q)
    const v = params.get('translation_diag')
    return v === '1' || v === 'true'
  } catch {
    return false
  }
}

function inputLengthBucket(len) {
  if (typeof len !== 'number' || len < 0) return null
  if (len <= 40) return 'xs'
  if (len <= 200) return 's'
  if (len <= 800) return 'm'
  if (len <= 2000) return 'l'
  return 'xl'
}

export function buildTranslationDiag(partial = {}) {
  let buildId = TRANSLATION_DIAG_BUILD
  try {
    if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_BUILD_ID) {
      buildId = import.meta.env.VITE_BUILD_ID
    }
  } catch {
    /* ignore */
  }
  return {
    route: 'translation-action',
    diagBuild: TRANSLATION_DIAG_BUILD,
    buildId,
    requestId: partial.requestId || `tr_${Date.now().toString(36)}`,
    translationIntent: partial.translationIntent ?? null,
    operation: partial.operation ?? null,
    sourceLanguageMode: partial.sourceLanguageMode ?? 'auto',
    targetLanguage: partial.targetLanguage ?? null,
    contextReference: partial.contextReference ?? null,
    contextReused: Boolean(partial.contextReused),
    inputLengthBucket: partial.inputLengthBucket ?? inputLengthBucket(partial.inputLength),
    provider: partial.provider ?? 'openai',
    model: partial.model ?? null,
    status: partial.status ?? null,
    failureCode: partial.failureCode ?? null,
  }
}

export function rememberTranslationDiag(diag) {
  try {
    if (typeof sessionStorage === 'undefined') return
    sessionStorage.setItem('shinkaido.translationDiag.last', JSON.stringify(diag))
  } catch {
    /* ignore */
  }
}

export function logTranslationSafe(fields = {}) {
  try {
    console.info(
      '[translation-action]',
      JSON.stringify({
        route: 'translation-action',
        operation: fields.operation ?? null,
        targetLanguage: fields.targetLanguage ?? null,
        contextReused: Boolean(fields.contextReused),
        status: fields.status ?? null,
        failureCode: fields.failureCode ?? null,
      }),
    )
  } catch {
    /* ignore */
  }
}

export { inputLengthBucket }
