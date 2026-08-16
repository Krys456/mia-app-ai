/**
 * Vision Lens task shortcuts (#274).
 * Localized Read/Explain captions for the SAME Core multimodal path.
 * Exact strings are ephemeral — skip durable Memory extraction.
 */

import {
  deriveStickyConversationLanguage,
  detectLanguageSignal,
} from './language-awareness.js'

/** @typedef {'it'|'en'|'es'|'fr'|'de'} VisionLang */

const SUPPORTED = new Set(['it', 'en', 'es', 'fr', 'de'])

/** @type {Record<VisionLang, { read: string, explain: string }>} */
export const VISION_TASK_PROMPTS = {
  it: {
    read: 'Leggi e trascrivi il testo visibile nell’immagine.',
    explain: 'Spiega ciò che è mostrato nell’immagine.',
  },
  en: {
    read: 'Read and transcribe the visible text in the image.',
    explain: 'Explain what is shown in the image.',
  },
  es: {
    read: 'Lee y transcribe el texto visible en la imagen.',
    explain: 'Explica lo que se muestra en la imagen.',
  },
  fr: {
    read: 'Lis et transcris le texte visible dans l’image.',
    explain: 'Explique ce qui est montré dans l’image.',
  },
  de: {
    read: 'Lies den sichtbaren Text im Bild und schreibe ihn ab.',
    explain: 'Erkläre, was auf dem Bild zu sehen ist.',
  },
}

/** @returns {string[]} */
export function listVisionTaskShortcutTexts() {
  /** @type {string[]} */
  const out = []
  for (const lang of Object.keys(VISION_TASK_PROMPTS)) {
    const pair = VISION_TASK_PROMPTS[/** @type {VisionLang} */ (lang)]
    out.push(pair.read, pair.explain)
  }
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
 * Prefer established conversation language over navigator/default EN.
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
  // Navigator only when there is no conversational evidence yet.
  if (!hasThreadText) {
    const primary = String(navigatorLanguage || '')
      .trim()
      .toLowerCase()
      .split(/[-_]/)[0]
    if (SUPPORTED.has(primary)) return /** @type {VisionLang} */ (primary)
  }

  return 'en'
}
