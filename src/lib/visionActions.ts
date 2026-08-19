/**
 * Client Vision Lens actions (#274 / #312A) — localized shortcuts into SAME Core.
 * Sticky resolution mirrors lib/server/vision-task-shortcuts.js (kept in sync by tests).
 */

import {
  deriveDictationLangFromMessages,
  localeToDictationLang,
  type DictationLangCode,
} from './dictationLanguage'
import {
  visionSearchButtonTrigger,
  type VisionSearchUiLang,
} from './visionSearchActions'

export type VisionAction = 'analyze' | 'read' | 'explain' | 'identify' | 'search'
export type VisionLang = DictationLangCode

const PROMPTS: Record<
  VisionLang,
  { read: string; explain: string; identify: string }
> = {
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

const PLACEHOLDERS: Record<'it' | 'en', string> = {
  it: 'Chiedi qualcosa su questa immagine...',
  en: 'Ask something about this image...',
}

const ACTION_LABELS: Record<
  'it' | 'en',
  Record<VisionAction, string>
> = {
  it: {
    analyze: 'Analizza',
    explain: 'Spiega',
    identify: 'Identifica',
    read: 'Leggi testo',
    search: 'Cerca',
  },
  en: {
    analyze: 'Analyze',
    explain: 'Explain',
    identify: 'Identify',
    read: 'Read text',
    search: 'Search',
  },
}

export function listVisionTaskShortcutTexts(): string[] {
  const out: string[] = []
  for (const code of Object.keys(PROMPTS) as VisionLang[]) {
    out.push(PROMPTS[code].read, PROMPTS[code].explain, PROMPTS[code].identify)
  }
  // #312 / #312A Search shortcut captions (ephemeral — not durable Memory)
  out.push('Cercalo online.', 'Cercalo online', 'Search this online.', 'Search this online')
  out.push('__VISION_SEARCH_GENERIC__')
  return out
}

export function isVisionTaskShortcut(text: unknown): boolean {
  if (typeof text !== 'string') return false
  const t = text.trim()
  if (!t) return false
  return listVisionTaskShortcutTexts().includes(t)
}

/**
 * Prefer established conversation language over navigator/default.
 * Empty thread → navigator (ShinkAIdo Italian-first fallback: it).
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
    return localeToDictationLang(input.navigatorLanguage) || 'it'
  }

  // Thread exists but lexical sticky unclear — navigator, then Italian-first product default.
  return localeToDictationLang(input.navigatorLanguage) || 'it'
}

export function visionUiLang(lang: VisionLang): 'it' | 'en' {
  return lang === 'it' ? 'it' : 'en'
}

export function visionPromptPlaceholder(lang: VisionLang): string {
  return PLACEHOLDERS[visionUiLang(lang)]
}

export function visionActionLabel(action: VisionAction, lang: VisionLang): string {
  return ACTION_LABELS[visionUiLang(lang)][action]
}

/** Caption for sendMessage. Analyze → empty (image-only sticky path). Search → #312 trigger. */
export function captionForVisionAction(action: VisionAction, lang: VisionLang): string {
  if (action === 'analyze') return ''
  if (action === 'search') {
    const ui: VisionSearchUiLang = visionUiLang(lang)
    return visionSearchButtonTrigger(ui)
  }
  return PROMPTS[lang][action]
}

/**
 * #312A — custom prompt wins over quick-action shortcuts.
 * Empty custom + action → shortcut caption. Empty custom + no action → analyze (empty).
 */
export function resolveVisionSubmitCaption(input: {
  customText?: string | null
  action?: VisionAction | null
  lang: VisionLang
}): string {
  const custom = typeof input.customText === 'string' ? input.customText.trim() : ''
  if (custom) return custom
  if (input.action) return captionForVisionAction(input.action, input.lang)
  return ''
}
