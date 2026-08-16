/**
 * Vision Lens task shortcuts (#274).
 * Localized Read/Explain captions for the SAME Core multimodal path.
 * Exact strings are ephemeral — skip durable Memory extraction.
 */

/** @typedef {'it'|'en'|'es'|'fr'|'de'} VisionLang */

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
