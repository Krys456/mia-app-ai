/** #322 — Translation barrel. */
export {
  detectTranslationIntent,
  detectTranslationLanguage,
  extractQuotedSource,
  extractColonSource,
  resolvePreviousMessageSource,
  TRANSLATION_MAX_INPUT_CHARS,
} from './translation/intent.js'
export {
  normalizeTargetLanguage,
  extractLanguageMention,
  languageChipLabel,
} from './translation/languages.js'
export {
  createTranslationContext,
  loadTranslationContext,
  saveTranslationContext,
  clearTranslationContext,
  isTranslationContextFresh,
  TRANSLATION_CONTEXT_TTL_MS,
} from './translation/active-context.js'
export { applyTranslationIntent } from './translation/controller.js'
export {
  TRANSLATION_DIAG_BUILD,
  isTranslationDiagEnabled,
  buildTranslationDiag,
  rememberTranslationDiag,
  logTranslationSafe,
} from './translation/diag.js'
export { requestTranslation } from './translation/api.js'
export { translationCopy, sanitizeTranslatedOutput } from './translation/copy.js'
