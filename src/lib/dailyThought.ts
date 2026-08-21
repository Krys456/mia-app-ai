/**
 * #335B — Curated ShinkAIdo daily thoughts.
 * Local, offline, deterministic by local calendar day. No API / model / quotes DB.
 */

export const DAILY_THOUGHTS_IT: readonly string[] = [
  'Il passo più piccolo cambia già il sentiero.',
  'Non devi vedere tutta la strada. Basta riconoscere il prossimo passo.',
  'Lascia spazio a ciò che conta.',
  'La calma non è assenza di moto: è direzione scelta.',
  'Ciò che è essenziale spesso parla piano.',
  'Un respiro pieno è già un ritorno a sé.',
  'Il vuoto non è mancanza: è margine per nascere.',
  'Cammina con leggerezza: il giorno ti segue.',
  'La forma si rivela solo dopo aver lasciato andare.',
  'Oggi basta una cosa fatta con presenza.',
  'Il silenzio è un maestro paziente.',
  'Non forzare il fiume: ascolta dove scorre.',
]

/** Stable local YYYY-MM-DD key (browser timezone). */
export function localDateKey(now: Date = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** Deterministic index from date key — same thought for the same local day. */
export function dailyThoughtIndex(
  dateKey: string,
  length: number = DAILY_THOUGHTS_IT.length,
): number {
  if (length <= 0) return 0
  let h = 2166136261
  for (let i = 0; i < dateKey.length; i += 1) {
    h ^= dateKey.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return Math.abs(h) % length
}

export function dailyThoughtForDate(now: Date = new Date()): string {
  const key = localDateKey(now)
  const idx = dailyThoughtIndex(key)
  return DAILY_THOUGHTS_IT[idx] ?? DAILY_THOUGHTS_IT[0]
}
