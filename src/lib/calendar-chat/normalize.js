/**
 * #336B — Calendar chat text normalization (apostrophes / accents).
 */

export function foldCalendarText(raw) {
  return String(raw || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/['’`´]/g, "'")
    .replace(/\bcos'ho\b/g, 'cosa ho')
    .replace(/\bcos'e\b/g, "cos'e")
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}
