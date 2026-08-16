/**
 * Recognition.lang hint for #273 dictation.
 * Client-only hybrid: recent user sticky → navigator.language → en-US.
 * Does not change Core #262 LANGUAGE semantics.
 */

export type DictationLangCode = 'it' | 'en' | 'es' | 'fr' | 'de'

const BCP47: Record<DictationLangCode, string> = {
  it: 'it-IT',
  en: 'en-US',
  es: 'es-ES',
  fr: 'fr-FR',
  de: 'de-DE',
}

const IT =
  /\b(che|come|sono|perché|perche|voglio|vorrei|ciao|grazie|dimmi|parliamo|oggi|domani|allenarmi|presto|qualcosa|fotografia)\b/i
const EN =
  /\b(the|what|how|why|should|would|could|please|hello|hey|today|tomorrow|want|about|project|remember)\b/i
const ES =
  /\b(qué|que|cómo|como|estoy|hola|gracias|quiero|porque|también|tambien|proyecto|recuerda)\b/i
const FR =
  /\b(que|qui|comment|pourquoi|bonjour|merci|veux|voudrais|aujourd|demain|projet|parlons)\b/i
const DE =
  /\b(was|wie|warum|hallo|danke|bitte|heute|morgen|projekt|möchte|mochte|erzähl|erzaehl)\b/i

function scoreLang(text: string): DictationLangCode | null {
  const t = String(text || '').trim()
  if (!t || t.length < 3) return null
  const scores: Record<DictationLangCode, number> = {
    it: (t.match(IT) || []).length,
    en: (t.match(EN) || []).length,
    es: (t.match(ES) || []).length,
    fr: (t.match(FR) || []).length,
    de: (t.match(DE) || []).length,
  }
  let best: DictationLangCode | null = null
  let bestScore = 0
  for (const code of Object.keys(scores) as DictationLangCode[]) {
    if (scores[code] > bestScore) {
      best = code
      bestScore = scores[code]
    }
  }
  return bestScore >= 1 ? best : null
}

/**
 * Newest → oldest confident user text wins as sticky hint.
 */
export function deriveDictationLangFromMessages(
  messages: Array<{ role?: string; content?: string }> | null | undefined,
): DictationLangCode | null {
  const list = Array.isArray(messages) ? messages : []
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const m = list[i]
    if (!m || m.role !== 'user') continue
    const content = typeof m.content === 'string' ? m.content.trim() : ''
    if (!content) continue
    const hit = scoreLang(content)
    if (hit) return hit
  }
  return null
}

export function localeToDictationLang(locale: string | undefined | null): DictationLangCode | null {
  const primary = String(locale || '')
    .trim()
    .toLowerCase()
    .split(/[-_]/)[0]
  if (primary === 'it' || primary === 'en' || primary === 'es' || primary === 'fr' || primary === 'de') {
    return primary
  }
  return null
}

/**
 * Hybrid recognition.lang resolution for Web Speech.
 */
export function resolveRecognitionLang(input: {
  messages?: Array<{ role?: string; content?: string }>
  navigatorLanguage?: string | null
}): string {
  const sticky = deriveDictationLangFromMessages(input.messages)
  if (sticky) return BCP47[sticky]
  const fromNav = localeToDictationLang(input.navigatorLanguage)
  if (fromNav) return BCP47[fromNav]
  return BCP47.en
}

export function dictationLangToBcp47(code: DictationLangCode): string {
  return BCP47[code]
}
