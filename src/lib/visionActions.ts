/**
 * Client Vision Lens actions (#274) — localized shortcuts into SAME Core.
 * Sticky resolution mirrors lib/server/vision-task-shortcuts.js (kept in sync by tests).
 */

import {
  deriveDictationLangFromMessages,
  localeToDictationLang,
  type DictationLangCode,
} from './dictationLanguage'

export type VisionAction = 'analyze' | 'read' | 'explain'
export type VisionLang = DictationLangCode

const PROMPTS: Record<VisionLang, { read: string; explain: string }> = {
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
  for (const code of Object.keys(PROMPTS) as VisionLang[]) {
    out.push(PROMPTS[code].read, PROMPTS[code].explain)
  }
  return out
}

export function isVisionTaskShortcut(text: unknown): boolean {
  if (typeof text !== 'string') return false
  const t = text.trim()
  if (!t) return false
  return listVisionTaskShortcutTexts().includes(t)
}

/**
 * Prefer established conversation language over navigator/default EN.
 * Navigator is used ONLY when the thread has no user/assistant text yet.
 */
export function resolveVisionActionLang(input: {
  messages?: Array<{ role?: string; content?: string }>
  navigatorLanguage?: string | null
}): VisionLang {
  const list = Array.isArray(input.messages) ? input.messages : []
  const fromUsers = deriveDictationLangFromMessages(list)
  if (fromUsers) return fromUsers

  // Secondary: treat recent assistant turns as language evidence for Vision captions.
  const assistantAsUser = list
    .filter((m) => m?.role === 'assistant' && typeof m.content === 'string' && m.content.trim())
    .map((m) => ({ role: 'user' as const, content: String(m.content) }))
  const fromAssistant = deriveDictationLangFromMessages(assistantAsUser)
  if (fromAssistant) return fromAssistant

  const hasThreadText = list.some(
    (m) =>
      (m?.role === 'user' || m?.role === 'assistant') &&
      typeof m.content === 'string' &&
      m.content.trim().length > 0,
  )
  if (!hasThreadText) {
    return localeToDictationLang(input.navigatorLanguage) || 'en'
  }

  // Thread exists but lexical sticky unclear — still avoid flipping to navigator EN.
  // Fall back to navigator only as last resort (may match user's device language).
  return localeToDictationLang(input.navigatorLanguage) || 'en'
}

/** Caption for sendMessage. Analyze → empty (image-only sticky path). */
export function captionForVisionAction(action: VisionAction, lang: VisionLang): string {
  if (action === 'analyze') return ''
  return PROMPTS[lang][action]
}
