/**
 * #322 — Apply Translation intent (client orchestration).
 */

import { requestTranslation } from './api.js'
import {
  createTranslationContext,
  isTranslationContextFresh,
} from './active-context.js'
import { sanitizeTranslatedOutput, translationCopy } from './copy.js'
import {
  detectTranslationIntent,
  resolvePreviousMessageSource,
  TRANSLATION_MAX_INPUT_CHARS,
} from './intent.js'
import { languageChipLabel } from './languages.js'

/**
 * @param {{
 *   text: string
 *   languageHint?: 'it'|'en'
 *   translationContext?: object | null
 *   messages?: Array<{ role?: string, content?: string }>
 *   env?: { copyTextSync?: (t: string) => boolean }
 * }} input
 */
export async function applyTranslationIntent(input) {
  const langHint = input.languageHint === 'en' ? 'en' : 'it'
  const ctx = isTranslationContextFresh(input.translationContext) ? input.translationContext : null
  const intent = detectTranslationIntent(input.text, {
    languageHint: langHint,
    hasTranslationContext: Boolean(ctx),
  })

  if (intent.intent !== 'translation') {
    return {
      handled: false,
      reply: null,
      diag: { translationIntent: 'none', failureCode: intent.failureCode || null },
    }
  }

  const language = intent.language || langHint

  if (intent.operation === 'copy') {
    if (!ctx?.translatedText) {
      return {
        handled: true,
        reply: translationCopy('copy_need_context', language),
        status: 'context_missing',
        diag: {
          translationIntent: 'translation',
          operation: 'copy',
          status: 'context_missing',
          failureCode: 'context_missing',
          contextReused: false,
        },
      }
    }
    let ok = false
    if (typeof input.env?.copyTextSync === 'function') {
      try {
        ok = Boolean(input.env.copyTextSync(String(ctx.translatedText)))
      } catch {
        ok = false
      }
    }
    return {
      handled: true,
      reply: translationCopy(ok ? 'copy_ok' : 'copy_fail', language),
      status: ok ? 'ok' : 'error',
      translationContext: ctx,
      diag: {
        translationIntent: 'translation',
        operation: 'copy',
        status: ok ? 'ok' : 'error',
        failureCode: ok ? null : 'copy_fail',
        contextReused: true,
        targetLanguage: ctx.targetCode || null,
      },
    }
  }

  if (intent.operation === 'pronunciation_deferred') {
    return {
      handled: true,
      reply: translationCopy('pronunciation_deferred', language),
      status: 'ok',
      translationContext: ctx,
      diag: {
        translationIntent: 'translation',
        operation: 'pronunciation_deferred',
        status: 'ok',
        failureCode: 'pronunciation_deferred',
        contextReused: true,
      },
    }
  }

  // Resolve source text
  let sourceText = intent.sourceText
  let contextReference = intent.contextReference || 'explicit'
  let contextReused = false

  if (!sourceText && (intent.operation === 'retranslate' || contextReference === 'previous_translation')) {
    if (ctx?.sourceText) {
      sourceText = ctx.sourceText
      contextReused = true
      contextReference = 'previous_translation'
    }
  }

  if (!sourceText && typeof contextReference === 'string' && contextReference.startsWith('previous')) {
    const resolved = resolvePreviousMessageSource(input.messages || [], contextReference)
    if (!resolved.ok) {
      return {
        handled: true,
        reply: translationCopy('context_missing', language),
        status: 'context_missing',
        diag: {
          translationIntent: 'translation',
          operation: intent.operation,
          status: 'context_missing',
          failureCode: 'context_missing',
          contextReference,
        },
      }
    }
    if (contextReference === 'previous_ambiguous' && !intent.sourceText) {
      // Still use last user if present; ask only if nothing
    }
    sourceText = resolved.text
    contextReused = true
  }

  if (!sourceText || !String(sourceText).trim()) {
    return {
      handled: true,
      reply: translationCopy('missing_text', language),
      status: 'missing_text',
      diag: {
        translationIntent: 'translation',
        operation: intent.operation,
        status: 'missing_text',
        failureCode: 'missing_text',
        contextReference,
      },
    }
  }

  sourceText = String(sourceText).trim()
  if (sourceText.length > TRANSLATION_MAX_INPUT_CHARS) {
    return {
      handled: true,
      reply: translationCopy('too_long', language),
      status: 'too_long',
      diag: {
        translationIntent: 'translation',
        operation: intent.operation,
        status: 'too_long',
        failureCode: 'too_long',
        inputLength: sourceText.length,
      },
    }
  }

  // Target language
  let target = intent.targetLanguage
  if (!target && ctx?.targetLanguage) {
    target = ctx.targetLanguage
    contextReused = true
  }
  if (!target) {
    return {
      handled: true,
      reply: translationCopy('missing_target_language', language),
      status: 'missing_target_language',
      diag: {
        translationIntent: 'translation',
        operation: intent.operation,
        status: 'missing_target_language',
        failureCode: 'missing_target_language',
      },
    }
  }

  const mode = intent.mode || ctx?.mode || 'preserve'
  const targetName =
    typeof target === 'object'
      ? target.labelEn || target.name || target.code
      : String(target)

  const api = await requestTranslation({
    text: sourceText,
    targetLanguage: targetName,
    sourceLanguage: 'auto',
    mode,
    language,
  })

  if (api.status === 'offline' || api.failureCode === 'offline') {
    return {
      handled: true,
      reply: translationCopy('offline', language),
      status: 'offline',
      diag: {
        translationIntent: 'translation',
        operation: intent.operation || 'translate',
        status: 'offline',
        failureCode: 'offline',
        contextReused,
        targetLanguage: target.code || targetName,
        inputLength: sourceText.length,
      },
    }
  }

  if (api.status === 'rate_limited' || api.failureCode === 'rate_limited') {
    return {
      handled: true,
      reply: translationCopy('rate_limited', language),
      status: 'rate_limited',
      diag: {
        translationIntent: 'translation',
        operation: 'translate',
        status: 'rate_limited',
        failureCode: 'rate_limited',
        contextReused,
        targetLanguage: target.code || targetName,
        inputLength: sourceText.length,
      },
    }
  }

  let translated = sanitizeTranslatedOutput(api.translatedText || '')
  if (api.status !== 'ok' || !translated) {
    return {
      handled: true,
      reply: translationCopy('provider_error', language),
      status: 'provider_error',
      diag: {
        translationIntent: 'translation',
        operation: 'translate',
        status: 'provider_error',
        failureCode: api.failureCode || 'provider_error',
        contextReused,
        targetLanguage: target.code || targetName,
        model: api.model || null,
        provider: 'openai',
        inputLength: sourceText.length,
      },
    }
  }

  const translationContext = createTranslationContext({
    sourceText,
    translatedText: translated,
    sourceLanguage: api.detectedSourceLanguage || 'auto',
    targetLanguage: target,
    targetCode: target.code || null,
    mode,
    language,
  })

  const chip = languageChipLabel(target, api.detectedSourceLanguage || 'auto', language)
  const translationUi = {
    kind: 'result',
    chip,
    actions: [
      {
        id: 'copy',
        label: language === 'en' ? 'Copy' : 'Copia',
      },
    ],
  }

  return {
    handled: true,
    reply: translated,
    status: 'ok',
    translationContext,
    translationUi,
    diag: {
      translationIntent: 'translation',
      operation: intent.operation || 'translate',
      status: 'ok',
      failureCode: null,
      sourceLanguageMode: 'auto',
      targetLanguage: target.code || targetName,
      contextReference,
      contextReused,
      inputLength: sourceText.length,
      provider: 'openai',
      model: api.model || null,
    },
  }
}
