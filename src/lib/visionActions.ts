/**
 * Client Vision Lens actions (#274) — localized shortcuts into SAME Core.
 */

import {
  deriveDictationLangFromMessages,
  localeToDictationLang,
  type DictationLangCode,
} from './dictationLanguage'

export type VisionAction = 'analyze' | 'read' | 'explain'

const PROMPTS: Record<DictationLangCode, { read: string; explain: string }> = {
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

export function listVisionTaskShortcutTexts(): string[] {
  const out: string[] = []
  for (const code of Object.keys(PROMPTS) as DictationLangCode[]) {
    out.push(PROMPTS[code].read, PROMPTS[code].explain)
  }
  return out
}

/** Mirror of server `isVisionTaskShortcut` for client tests. */
export function isVisionTaskShortcut(text: unknown): boolean {
  if (typeof text !== 'string') return false
  const t = text.trim()
  if (!t) return false
  return listVisionTaskShortcutTexts().includes(t)
}

export function resolveVisionActionLang(input: {
  messages?: Array<{ role?: string; content?: string }>
  navigatorLanguage?: string | null
}): DictationLangCode {
  return (
    deriveDictationLangFromMessages(input.messages) ||
    localeToDictationLang(input.navigatorLanguage) ||
    'en'
  )
}

/**
 * Caption for sendMessage. Analyze → empty (image-only sticky path).
 */
export function captionForVisionAction(
  action: VisionAction,
  lang: DictationLangCode,
): string {
  if (action === 'analyze') return ''
  return PROMPTS[lang][action]
}
