/**
 * Vision Lens task shortcuts (#274 / #312A).
 * Localized Read/Explain/Identify captions for the SAME Core multimodal path.
 * Exact strings are ephemeral — skip durable Memory extraction.
 */

import {
  deriveStickyConversationLanguage,
  detectLanguageSignal,
} from './language-awareness.js'

/** @typedef {'it'|'en'|'es'|'fr'|'de'} VisionLang */

const SUPPORTED = new Set(['it', 'en', 'es', 'fr', 'de'])

/** @type {Record<VisionLang, { read: string, explain: string, identify: string }>} */
export const VISION_TASK_PROMPTS = {
  it: {
    read: 'Leggi e trascrivi il testo visibile nell’immagine.',
    explain: 'Spiega ciò che è mostrato nell’immagine.',
    identify: 'Identifica l’oggetto, il soggetto o il prodotto principale nell’immagine.',
  },
  en: {
    read: 'Read and transcribe the visible text in the image.',
    explain: 'Explain what is shown in the image.',
    identify: 'Identify the main object, subject, or product in the image.',
  },
  es: {
    read: 'Lee y transcribe el texto visible en la imagen.',
    explain: 'Explica lo que se muestra en la imagen.',
    identify: 'Identifica el objeto, sujeto o producto principal en la imagen.',
  },
  fr: {
    read: 'Lis et transcris le texte visible dans l’image.',
    explain: 'Explique ce qui est montré dans l’image.',
    identify: 'Identifie l’objet, le sujet ou le produit principal dans l’image.',
  },
  de: {
    read: 'Lies den sichtbaren Text im Bild und schreibe ihn ab.',
    explain: 'Erkläre, was auf dem Bild zu sehen ist.',
    identify: 'Identifiziere das Hauptobjekt, Motiv oder Produkt im Bild.',
  },
}

/** @returns {string[]} */
export function listVisionTaskShortcutTexts() {
  /** @type {string[]} */
  const out = []
  for (const lang of Object.keys(VISION_TASK_PROMPTS)) {
    const pair = VISION_TASK_PROMPTS[/** @type {VisionLang} */ (lang)]
    out.push(pair.read, pair.explain, pair.identify)
  }
  out.push('Cercalo online.', 'Cercalo online', 'Search this online.', 'Search this online')
  out.push('__VISION_SEARCH_GENERIC__')
  return out
}

/**
 * True when caption is a known Vision UI task shortcut (not a durable user fact).
 * @param {unknown} text
 */
export function isVisionTaskShortcut(text) {
  if (typeof text !== 'string') return false
  const t = text.trim()
  if (!t) return false
  return listVisionTaskShortcutTexts().includes(t)
}

/**
 * Sticky language for Vision action captions / image-only nudge.
 * Prefer established conversation language over navigator.
 * Empty thread → navigator; ShinkAIdo Italian-first fallback (not EN-universal).
 * @param {Array<{ role?: string, content?: string }> | null | undefined} messages
 * @param {string | null | undefined} [navigatorLanguage]
 * @returns {VisionLang}
 */
export function resolveVisionStickyLang(messages, navigatorLanguage) {
  const list = Array.isArray(messages) ? messages : []
  const fromUsers = deriveStickyConversationLanguage(list, '')
  if (SUPPORTED.has(fromUsers)) return /** @type {VisionLang} */ (fromUsers)

  // Secondary: recent confident assistant turn (thread already speaking a language).
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const m = list[i]
    if (!m || m.role !== 'assistant' || typeof m.content !== 'string') continue
    const signal = detectLanguageSignal(m.content)
    if (signal.confident && SUPPORTED.has(signal.language)) {
      return /** @type {VisionLang} */ (signal.language)
    }
  }

  const hasThreadText = list.some(
    (m) =>
      (m?.role === 'user' || m?.role === 'assistant') &&
      typeof m.content === 'string' &&
      m.content.trim().length > 0,
  )
  const primary = String(navigatorLanguage || '')
    .trim()
    .toLowerCase()
    .split(/[-_]/)[0]
  // Navigator when there is no conversational evidence yet — or as last resort.
  if (!hasThreadText) {
    if (SUPPORTED.has(primary)) return /** @type {VisionLang} */ (primary)
    return 'it'
  }

  if (SUPPORTED.has(primary)) return /** @type {VisionLang} */ (primary)
  return 'it'
}
