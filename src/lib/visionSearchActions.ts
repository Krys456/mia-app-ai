/**
 * #312 — Vision × Search UI helpers (Cerca / Search action + NL trigger text).
 * Does not upload images; only sends a textual follow-up into Core.
 */

import { resolveVisionActionLang, type VisionLang } from './visionActions'

export type VisionSearchUiLang = 'it' | 'en'

const SEARCH_LABELS: Record<VisionSearchUiLang, string> = {
  it: 'Cerca',
  en: 'Search',
}

const BUTTON_TRIGGERS: Record<VisionSearchUiLang, string> = {
  it: 'Cercalo online.',
  en: 'Search this online.',
}

export function resolveVisionSearchUiLang(input: {
  messages?: Array<{ role?: string; content?: string }>
  navigatorLanguage?: string | null
}): VisionSearchUiLang {
  const lang: VisionLang = resolveVisionActionLang(input)
  return lang === 'it' ? 'it' : 'en'
}

export function visionSearchActionLabel(lang: VisionSearchUiLang): string {
  return SEARCH_LABELS[lang] || SEARCH_LABELS.en
}

/** Textual follow-up sent when the user presses Cerca / Search. */
export function visionSearchButtonTrigger(lang: VisionSearchUiLang): string {
  return BUTTON_TRIGGERS[lang] || BUTTON_TRIGGERS.en
}

function messageHasImageAttachment(msg: {
  attachments?: Array<{ kind?: string; type?: string } | null> | null
}): boolean {
  const atts = msg?.attachments
  if (!Array.isArray(atts)) return false
  return atts.some((a) => a && (a.kind === 'image' || a.type === 'image'))
}

/**
 * Show Cerca/Search only on the assistant reply that answered a Vision (image) turn.
 * Avoids cluttering ordinary text responses.
 */
export function shouldShowVisionSearchAction(
  messages: Array<{
    id?: string
    role?: string
    kind?: string
    attachments?: Array<{ kind?: string; type?: string } | null> | null
  }>,
  assistantMessageId: string,
): boolean {
  if (!Array.isArray(messages) || !assistantMessageId) return false
  const idx = messages.findIndex((m) => m.id === assistantMessageId)
  if (idx < 0) return false
  const assistant = messages[idx]
  if (assistant?.role !== 'assistant' || assistant.kind === 'error') return false

  // Walk back to the immediately preceding user turn
  for (let i = idx - 1; i >= 0; i -= 1) {
    const m = messages[i]
    if (m?.role === 'user') {
      return messageHasImageAttachment(m)
    }
  }
  return false
}

/** Client opt-in: `?vision_search_diag=1` */
export function isVisionSearchDiagClientEnabled(
  search: string | null | undefined = typeof window !== 'undefined' ? window.location.search : '',
): boolean {
  try {
    const q = String(search || '')
    if (!q) return false
    const params = new URLSearchParams(q.startsWith('?') ? q.slice(1) : q)
    const v = params.get('vision_search_diag')
    return v === '1' || v === 'true'
  } catch {
    return false
  }
}
