/**
 * Client Memory feedback helpers (#281).
 * UI localization only — do not use Core LANGUAGE detection.
 */

export type MemoryFeedbackType = 'created' | 'updated' | 'removed'

export interface MemoryFeedbackEvent {
  type: MemoryFeedbackType
  /** Optional short safe gloss — never ids / fact_key / confidence / etc. */
  displayText?: string
}

export type MemoryFeedbackLocale = 'it' | 'en' | 'fr' | 'es' | 'de'

const LABELS: Record<
  MemoryFeedbackLocale,
  Record<MemoryFeedbackType, string>
> = {
  it: {
    created: 'Memoria salvata',
    updated: 'Memoria aggiornata',
    removed: 'Memoria rimossa',
  },
  en: {
    created: 'Memory saved',
    updated: 'Memory updated',
    removed: 'Memory removed',
  },
  fr: {
    created: 'Mémoire enregistrée',
    updated: 'Mémoire mise à jour',
    removed: 'Mémoire supprimée',
  },
  es: {
    created: 'Memoria guardada',
    updated: 'Memoria actualizada',
    removed: 'Memoria eliminada',
  },
  de: {
    created: 'Erinnerung gespeichert',
    updated: 'Erinnerung aktualisiert',
    removed: 'Erinnerung entfernt',
  },
}

const DISPLAY_TEXT_CLIENT_MAX = 72

/**
 * Resolve UI locale from navigator (or explicit override). Fallback EN.
 */
export function resolveMemoryFeedbackLocale(
  languageHint?: string | null,
): MemoryFeedbackLocale {
  const raw = String(languageHint || '').trim().toLowerCase()
  const primary = raw.split(/[-_]/)[0] || ''
  if (primary === 'it' || primary === 'en' || primary === 'fr' || primary === 'es' || primary === 'de') {
    return primary
  }
  return 'en'
}

export function memoryFeedbackLabel(
  type: MemoryFeedbackType,
  locale: MemoryFeedbackLocale = 'en',
): string {
  return LABELS[locale]?.[type] ?? LABELS.en[type]
}

/**
 * Normalize API memoryEvent (new object or legacy string) → typed notice.
 */
export function parseMemoryFeedbackEvent(raw: unknown): MemoryFeedbackEvent | null {
  if (raw == null) return null

  // Legacy coarse strings (temporary compatibility)
  if (raw === 'saved') return { type: 'created' }
  if (raw === 'updated') return { type: 'updated' }

  if (typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  const type = obj.type
  if (type !== 'created' && type !== 'updated' && type !== 'removed') return null

  let displayText: string | undefined
  if (typeof obj.displayText === 'string') {
    const cleaned = obj.displayText.replace(/\s+/g, ' ').trim()
    if (
      cleaned &&
      cleaned.length <= DISPLAY_TEXT_CLIENT_MAX &&
      !looksUnsafeClientDisplayText(cleaned)
    ) {
      displayText = cleaned
    }
  }

  return displayText ? { type, displayText } : { type }
}

function looksUnsafeClientDisplayText(text: string): boolean {
  if (/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(text)) {
    return true
  }
  if (
    /\b(preferences|identity|projects|settings|habits|events)\.[a-z0-9_.-]+/i.test(text)
  ) {
    return true
  }
  if (
    /\b(fact[_-]?key|confidence|importance|usage[_-]?count|user[_-]?id|memory[_-]?id)\b/i.test(
      text,
    )
  ) {
    return true
  }
  return false
}
