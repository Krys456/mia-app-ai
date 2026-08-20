/**
 * #322 — Deterministic Translation intent (IT/EN).
 * Outer guard must run BEFORE Timer / Phone / other action routers.
 */

import { extractLanguageMention, foldLang, normalizeTargetLanguage } from './languages.js'

export const TRANSLATION_MAX_INPUT_CHARS = 4000

function fold(raw) {
  return foldLang(raw)
}

export function detectTranslationLanguage(text, fallback = 'it') {
  const t = fold(text)
  const it = (t.match(/\b(traduci|traducilo|traducila|traduzione|come\s+si\s+dice|inglese|francese|spagnolo)\b/g) || [])
    .length
  const en = (t.match(/\b(translate|translation|how\s+do\s+you\s+say|english|french|spanish|german)\b/g) || [])
    .length
  if (en > it) return 'en'
  if (it > en) return 'it'
  return fallback === 'en' ? 'en' : 'it'
}

function isMetaTranslationTalk(t) {
  return /\b(cos[' ]?e\s+(una\s+)?traduzione|what\s+is\s+(a\s+)?translation|come\s+funziona\s+(google\s+)?translate|how\s+does\s+(google\s+)?translate|parliamo\s+dell[ae]\s+lingua|parliamo\s+di\s+lingue|scrivi\s+una\s+storia|write\s+(a\s+)?stor(y|ia)|quanto\s+guadagna|how\s+much\s+(does\s+a\s+)?translator|migliore\s+lingua\s+da\s+imparare|best\s+language\s+to\s+learn|google\s+translate)\b/.test(
    t,
  )
}

function isDocumentOrVisionTranslate(t) {
  return /\b(traduci\s+(questo\s+)?(documento|pdf|file|docx)|translate\s+(this\s+)?(document|pdf|file)|traduci\s+il\s+testo\s+in\s+questa\s+(foto|immagine)|translate\s+(the\s+)?text\s+in\s+(this\s+)?(photo|image|picture)|traduci\s+questa\s+(foto|immagine))\b/.test(
    t,
  )
}

/**
 * Extract quoted segment from original (preserves casing).
 * @param {string} raw
 */
export function extractQuotedSource(raw) {
  const patterns = [
    /[«"]([^«»"]{1,4000})[»"]/,
    /['']([^'']{1,4000})['']/,
    /["“]([^"”]{1,4000})["”]/,
    /'([^']{1,4000})'/,
  ]
  for (const re of patterns) {
    const m = String(raw || '').match(re)
    if (m && m[1] && m[1].trim()) return m[1].trim()
  }
  return null
}

/**
 * Colon / dash source: "Traduci in inglese: Ciao" / "Translate into Italian: Hello"
 * @param {string} raw
 */
export function extractColonSource(raw) {
  const m = String(raw || '').match(
    /(?:traduci(?:lo|la)?|translate(?:\s+this|\s+that)?|come\s+si\s+dice|how\s+do\s+you\s+say)[\s\S]{0,80}?(?:in|into|to)\s+[\wàèéìòù'-]+\s*[:：]\s*(.+)$/i,
  )
  if (m && m[1] && m[1].trim()) return m[1].trim().replace(/^["«“'']+|["»”'']+$/g, '').trim()
  // "Traduci questo in spagnolo: ..."
  const m2 = String(raw || '').match(/:\s*(.+)$/)
  if (m2 && /\b(traduci|translate)\b/i.test(raw) && m2[1].trim().length >= 1) {
    const rest = m2[1].trim().replace(/^["«“'']+|["»”'']+$/g, '').trim()
    if (rest && !/^(in|into|to)\s+/i.test(rest)) return rest
  }
  return null
}

/**
 * "Come si dice buongiorno in giapponese" → buongiorno
 * @param {string} raw
 * @param {string} folded
 */
export function extractNaturalSaySource(raw, folded) {
  const mIt = folded.match(
    /\bcome\s+si\s+(?:dice|traduce)\s+(.+?)\s+in\s+[a-z]{2,40}\b/,
  )
  if (mIt && mIt[1]) {
    let s = mIt[1].replace(/^["«“'']+|["»”'']+$/g, '').trim()
    // Recover casing from raw approximately
    const fromRaw = extractQuotedSource(raw)
    if (fromRaw) return fromRaw
    return s.slice(0, TRANSLATION_MAX_INPUT_CHARS)
  }
  const mEn = folded.match(/\bhow\s+do\s+you\s+say\s+(.+?)\s+in\s+[a-z]{2,40}\b/)
  if (mEn && mEn[1]) {
    const fromRaw = extractQuotedSource(raw)
    if (fromRaw) return fromRaw
    return mEn[1].replace(/^["«“'']+|["»”'']+$/g, '').trim().slice(0, TRANSLATION_MAX_INPUT_CHARS)
  }
  return null
}

function looksPreviousReference(folded) {
  return /\b(messaggio\s+precedente|risposta\s+precedente|ultimo\s+messaggio|ultima\s+risposta|quello\s+che\s+hai\s+appena\s+scritto|previous\s+message|last\s+(answer|message|reply)|what\s+you\s+just\s+(wrote|said)|the\s+previous\s+(message|reply|answer))\b/.test(
    folded,
  )
}

function previousReferenceKind(folded) {
  if (
    /\b(risposta\s+precedente|ultima\s+risposta|quello\s+che\s+hai\s+appena\s+scritto|last\s+(answer|reply)|what\s+you\s+just\s+(wrote|said)|previous\s+(reply|answer))\b/.test(
      folded,
    )
  ) {
    return 'previous_assistant'
  }
  if (
    /\b(messaggio\s+precedente|ultimo\s+messaggio|previous\s+message|last\s+message)\b/.test(folded)
  ) {
    return 'previous_user'
  }
  return 'previous_ambiguous'
}

function looksStyleFollowUp(folded) {
  return /\b(piu\s+naturale|piu\s+letterale|piu\s+formale|mantieni\s+lo\s+stesso\s+tono|mantenendo\s+lo\s+stesso\s+tono|traduzione\s+piu\s+letterale|traduzione\s+letterale|make\s+it\s+more\s+natural|make\s+it\s+more\s+literal|more\s+formal|more\s+natural|more\s+literal|preserve\s+(the\s+)?(same\s+)?tone|same\s+tone)\b/.test(
    folded,
  )
}

function parseStyleMode(folded) {
  if (/\b(letterale|literal)\b/.test(folded)) return 'literal'
  if (/\b(formale|formal)\b/.test(folded)) return 'formal'
  if (/\b(naturale|natural)\b/.test(folded)) return 'natural'
  if (/\b(tono|tone|preserve)\b/.test(folded)) return 'preserve'
  return null
}

function looksTargetFollowUp(folded) {
  return /^(ora|adesso|now)\s+in\s+[a-z]{2,40}\s*[.!?]*$/.test(folded)
}

function looksCopy(folded) {
  return /\b(copia\s+la\s+traduzione|copy\s+the\s+translation|copia\s+traduzione)\b/.test(folded)
}

function looksPronounce(folded) {
  return /\b(come\s+si\s+pronuncia|how\s+(do\s+you\s+)?pronounce|pronuncia)\b/.test(folded)
}

/**
 * @param {string} raw
 * @param {{
 *   languageHint?: 'it'|'en'
 *   hasTranslationContext?: boolean
 * }} [opts]
 */
export function detectTranslationIntent(raw, opts = {}) {
  const text = String(raw || '').trim()
  const language = detectTranslationLanguage(text, opts.languageHint === 'en' ? 'en' : 'it')
  if (!text) {
    return { intent: 'none', language }
  }

  const t = fold(text)

  if (isMetaTranslationTalk(t)) {
    return { intent: 'none', language, failureCode: 'meta' }
  }
  if (isDocumentOrVisionTranslate(t)) {
    return { intent: 'none', language, failureCode: 'document_or_vision' }
  }

  // Whole-message quote alone — not an outer Translation request
  if (/^["“«].*["”»]\s*$/s.test(text)) {
    return { intent: 'none', language, failureCode: 'quoted_only' }
  }

  const hasCtx = Boolean(opts.hasTranslationContext)

  if (hasCtx && looksCopy(t)) {
    return {
      intent: 'translation',
      language,
      operation: 'copy',
      sourceText: null,
      targetLanguage: null,
      mode: null,
      contextReference: 'previous_translation',
      followUp: true,
    }
  }

  if (hasCtx && looksPronounce(t)) {
    return {
      intent: 'translation',
      language,
      operation: 'pronunciation_deferred',
      sourceText: null,
      targetLanguage: null,
      mode: null,
      contextReference: 'previous_translation',
      followUp: true,
      failureCode: 'pronunciation_deferred',
    }
  }

  if (hasCtx && looksStyleFollowUp(t)) {
    const lang = extractLanguageMention(t)
    return {
      intent: 'translation',
      language,
      operation: 'retranslate',
      sourceText: null,
      targetLanguage: lang,
      mode: parseStyleMode(t) || 'preserve',
      contextReference: 'previous_translation',
      followUp: true,
    }
  }

  // "Rendilo più naturale in inglese" / "Make it more natural in French" without only-style regex
  if (
    hasCtx &&
    /\b(rendilo|mettilo|make\s+it)\b/.test(t) &&
    (/\b(naturale|natural|letterale|literal|formale|formal|tono|tone)\b/.test(t) ||
      extractLanguageMention(t))
  ) {
    const lang = extractLanguageMention(t)
    return {
      intent: 'translation',
      language,
      operation: 'retranslate',
      sourceText: null,
      targetLanguage: lang,
      mode: parseStyleMode(t) || (lang ? null : 'preserve'),
      contextReference: 'previous_translation',
      followUp: true,
    }
  }

  if (hasCtx && looksTargetFollowUp(t)) {
    const lang = extractLanguageMention(t)
    if (lang) {
      return {
        intent: 'translation',
        language,
        operation: 'retranslate',
        sourceText: null,
        targetLanguage: lang,
        mode: null,
        contextReference: 'previous_translation',
        followUp: true,
      }
    }
  }

  // Explicit translate / how do you say
  const translateCue =
    /\b(traduci(?:lo|la)?|translate|come\s+si\s+dice|come\s+si\s+traduce|how\s+do\s+you\s+say|rendilo\s+in|mettilo\s+in)\b/.test(
      t,
    ) ||
    /\b(traduci\s+questo|translate\s+this|translate\s+that|traduci\s+il\s+messaggio|translate\s+the\s+(previous\s+)?message)\b/.test(
      t,
    )

  // "Traducilo mantenendo lo stesso tono" with context
  if (hasCtx && /\b(traducilo|traducila|translate\s+(it|that|this))\b/.test(t) && !extractLanguageMention(t)) {
    const mode = parseStyleMode(t) || 'preserve'
    return {
      intent: 'translation',
      language,
      operation: 'retranslate',
      sourceText: null,
      targetLanguage: null,
      mode,
      contextReference: 'previous_translation',
      followUp: true,
    }
  }

  if (!translateCue && !(hasCtx && /\b(traducilo|traducila|rendilo|mettilo)\b/.test(t))) {
    return { intent: 'none', language }
  }

  // Need translate cue or context retranslate with target
  const target =
    extractLanguageMention(
      t.replace(/\b(traduci|translate|come\s+si\s+dice|how\s+do\s+you\s+say)\b/g, ' '),
    ) || extractLanguageMention(t)

  // "Traducilo in inglese" with/without context
  if (/\b(traducilo|traducila|translate\s+(it|that))\b/.test(t)) {
    if (!target && !hasCtx) {
      return {
        intent: 'translation',
        language,
        operation: 'translate',
        sourceText: null,
        targetLanguage: null,
        mode: parseStyleMode(t),
        contextReference: null,
        failureCode: 'missing_target_language',
      }
    }
    if (!target && hasCtx) {
      return {
        intent: 'translation',
        language,
        operation: 'retranslate',
        sourceText: null,
        targetLanguage: null,
        mode: parseStyleMode(t) || 'preserve',
        contextReference: 'previous_translation',
        followUp: true,
      }
    }
  }

  let contextReference = 'explicit'
  let sourceText = extractQuotedSource(text)
  if (!sourceText) sourceText = extractColonSource(text)
  if (!sourceText) sourceText = extractNaturalSaySource(text, t)

  if (!sourceText && looksPreviousReference(t)) {
    contextReference = previousReferenceKind(t)
    sourceText = null
  } else if (!sourceText && /\b(traducilo|traducila|translate\s+(it|that|this)|traduci\s+questo|translate\s+this)\b/.test(t)) {
    if (hasCtx) {
      contextReference = 'previous_translation'
    } else {
      contextReference = 'previous_ambiguous'
    }
  }

  // Mode from same utterance
  const mode = parseStyleMode(t) || 'preserve'

  if (!target && !hasCtx) {
    // "Traduci Ciao" without language
    if (sourceText || contextReference.startsWith('previous')) {
      return {
        intent: 'translation',
        language,
        operation: 'translate',
        sourceText,
        targetLanguage: null,
        mode,
        contextReference,
        failureCode: 'missing_target_language',
      }
    }
    return { intent: 'none', language }
  }

  return {
    intent: 'translation',
    language,
    operation: contextReference === 'previous_translation' && hasCtx ? 'retranslate' : 'translate',
    sourceText,
    targetLanguage: target,
    mode,
    contextReference,
    followUp: false,
  }
}

/**
 * Resolve previous message from chat history (excluding current turn).
 * @param {Array<{ role?: string, content?: string }>} messages
 * @param {'previous_user'|'previous_assistant'|'previous_ambiguous'} kind
 */
export function resolvePreviousMessageSource(messages, kind) {
  const list = Array.isArray(messages) ? messages : []
  if (kind === 'previous_assistant') {
    for (let i = list.length - 1; i >= 0; i -= 1) {
      const m = list[i]
      if (m?.role === 'assistant' && String(m.content || '').trim()) {
        return { ok: true, text: String(m.content).trim().slice(0, TRANSLATION_MAX_INPUT_CHARS) }
      }
    }
    return { ok: false, failureCode: 'context_missing' }
  }
  if (kind === 'previous_user') {
    for (let i = list.length - 1; i >= 0; i -= 1) {
      const m = list[i]
      if (m?.role === 'user' && String(m.content || '').trim()) {
        return { ok: true, text: String(m.content).trim().slice(0, TRANSLATION_MAX_INPUT_CHARS) }
      }
    }
    return { ok: false, failureCode: 'context_missing' }
  }
  // ambiguous: prefer last user, else last assistant
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const m = list[i]
    if (m?.role === 'user' && String(m.content || '').trim()) {
      return { ok: true, text: String(m.content).trim().slice(0, TRANSLATION_MAX_INPUT_CHARS), resolvedAs: 'user' }
    }
  }
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const m = list[i]
    if (m?.role === 'assistant' && String(m.content || '').trim()) {
      return {
        ok: true,
        text: String(m.content).trim().slice(0, TRANSLATION_MAX_INPUT_CHARS),
        resolvedAs: 'assistant',
      }
    }
  }
  return { ok: false, failureCode: 'context_missing' }
}

export { normalizeTargetLanguage, isDocumentOrVisionTranslate, isMetaTranslationTalk }
