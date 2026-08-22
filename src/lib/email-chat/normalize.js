/**
 * #337B — Email chat text normalization (apostrophes / accents).
 * Mirrors src/lib/calendar-chat/normalize.js.
 */

export function foldEmailText(raw) {
  return String(raw || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/['’`´]/g, "'")
    .replace(/\bcos'e\b/g, "cos'e")
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}
