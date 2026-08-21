/**
 * #335B — Contextual Home greeting from browser-local daypart + display name.
 * Display name: settings.personalization.displayName only (no Memory inference).
 */

export type HomeDayPart = 'morning' | 'afternoon' | 'evening'

/** Browser-local hour → daypart (no timezone API required for Home). */
export function homeDayPart(now: Date = new Date()): HomeDayPart {
  const h = now.getHours()
  if (h < 12) return 'morning'
  if (h < 18) return 'afternoon'
  return 'evening'
}

export function homeGreetingBase(
  part: HomeDayPart,
  language: 'it' | 'en' = 'it',
): string {
  if (language === 'en') {
    if (part === 'afternoon') return 'Good afternoon'
    if (part === 'evening') return 'Good evening'
    return 'Good morning'
  }
  if (part === 'afternoon') return 'Buon pomeriggio'
  if (part === 'evening') return 'Buonasera'
  return 'Buongiorno'
}

/**
 * Full greeting line. With name: "Buongiorno, Cristian."
 * Without: "Buongiorno."
 */
export function formatHomeGreeting(
  displayName: string | null | undefined,
  opts?: { now?: Date; language?: 'it' | 'en' },
): { text: string; name: string; base: string; dayPart: HomeDayPart } {
  const language = opts?.language === 'en' ? 'en' : 'it'
  const dayPart = homeDayPart(opts?.now ?? new Date())
  const base = homeGreetingBase(dayPart, language)
  const name = typeof displayName === 'string' ? displayName.trim().slice(0, 40) : ''
  if (!name) {
    return { text: `${base}.`, name: '', base, dayPart }
  }
  return { text: `${base}, ${name}.`, name, base, dayPart }
}
