/**
 * #355B — Places chat text normalization (apostrophes / accents).
 * Mirrors src/lib/calendar-chat/normalize.js and src/lib/email-chat/normalize.js.
 */

export function foldPlacesText(raw) {
  return String(raw || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/['’`´]/g, "'")
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}
