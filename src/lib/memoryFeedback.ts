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

const SUBJECT_LABELS: Record<MemoryFeedbackLocale, Record<string, string>> = {
  it: {
    color: 'Colore preferito',
    food: 'Cibo preferito',
    character: 'Personaggio preferito',
    anime: 'Anime preferito',
    sport: 'Sport preferito',
    animal: 'Animale preferito',
    game: 'Gioco preferito',
    book: 'Libro preferito',
    music: 'Musica preferita',
    film: 'Film preferito',
    movie: 'Film preferito',
    artist: 'Artista preferito',
  },
  en: {
    color: 'Favorite color',
    food: 'Favorite food',
    character: 'Favorite character',
    anime: 'Favorite anime',
    sport: 'Favorite sport',
    animal: 'Favorite animal',
    game: 'Favorite game',
    book: 'Favorite book',
    music: 'Favorite music',
    film: 'Favorite film',
    movie: 'Favorite movie',
    artist: 'Favorite artist',
  },
  fr: {
    color: 'Couleur préférée',
    food: 'Plat préféré',
    character: 'Personnage préféré',
    anime: 'Anime préféré',
    sport: 'Sport préféré',
  },
  es: {
    color: 'Color favorito',
    food: 'Comida favorita',
    character: 'Personaje favorito',
    anime: 'Anime favorito',
    sport: 'Deporte favorito',
  },
  de: {
    color: 'Lieblingsfarbe',
    food: 'Lieblingsessen',
    character: 'Lieblingsfigur',
    anime: 'Lieblingsanime',
    sport: 'Lieblingssport',
  },
}

const PROJECT_LABELS: Record<MemoryFeedbackLocale, string> = {
  it: 'Progetto principale',
  en: 'Primary project',
  fr: 'Projet principal',
  es: 'Proyecto principal',
  de: 'Hauptprojekt',
}

/**
 * Localize a safe server displayText gloss for the Memory indicator.
 * Accepts "Favorite color: viola" / "Primary project: BrAIn" / plain values.
 */
export function localizeMemoryDisplayText(
  displayText: string | undefined | null,
  locale: MemoryFeedbackLocale = 'en',
): string {
  const raw = String(displayText || '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!raw) return ''

  // Server gloss is English canonical ("Favorite color: viola"); localize label.
  const favorite = raw.match(/^Favorite\s+([a-z][\w-]{1,40}):\s*(.+)$/i)
  if (favorite) {
    const subject = favorite[1].toLowerCase()
    const value = favorite[2].trim()
    if (/^(anche|also|pure|oltre)\b/i.test(value)) return ''
    const label =
      SUBJECT_LABELS[locale]?.[subject] ||
      SUBJECT_LABELS.en[subject] ||
      (locale === 'it' ? `Preferito: ${subject}` : `Favorite ${subject}`)
    return `${label}: ${value}`
  }

  // Already-localized IT/other favorite gloss — keep value, refresh label if known.
  const localizedFavorite = raw.match(
    /^(Colore preferito|Cibo preferito|Personaggio preferito|Anime preferito|Sport preferito|Couleur préférée|Color favorito|Lieblingsfarbe):\s*(.+)$/i,
  )
  if (localizedFavorite) {
    const value = localizedFavorite[2].trim()
    if (/^(anche|also|pure|oltre)\b/i.test(value)) return ''
    return raw
  }

  const project = raw.match(/^Primary project:\s*(.+)$/i)
  if (project) {
    return `${PROJECT_LABELS[locale] || PROJECT_LABELS.en}: ${project[1].trim()}`
  }

  const localizedProject = raw.match(
    /^(Progetto principale|Projet principal|Proyecto principal|Hauptprojekt):\s*(.+)$/i,
  )
  if (localizedProject) {
    return `${PROJECT_LABELS[locale] || PROJECT_LABELS.en}: ${localizedProject[2].trim()}`
  }

  if (/^(anche|also|pure|oltre)\b/i.test(raw)) return ''
  return raw
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
      !looksUnsafeClientDisplayText(cleaned) &&
      !/^(anche|also|pure)\b/i.test(cleaned)
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
