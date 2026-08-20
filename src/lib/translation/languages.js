/**
 * #322 — Target language aliases → normalized codes / display labels.
 */

/** @type {Record<string, { code: string, labelIt: string, labelEn: string }>} */
const ENTRIES = {
  italiano: { code: 'it', labelIt: 'Italiano', labelEn: 'Italian' },
  italian: { code: 'it', labelIt: 'Italiano', labelEn: 'Italian' },
  inglese: { code: 'en', labelIt: 'Inglese', labelEn: 'English' },
  english: { code: 'en', labelIt: 'Inglese', labelEn: 'English' },
  spagnolo: { code: 'es', labelIt: 'Spagnolo', labelEn: 'Spanish' },
  spanish: { code: 'es', labelIt: 'Spagnolo', labelEn: 'Spanish' },
  espanol: { code: 'es', labelIt: 'Spagnolo', labelEn: 'Spanish' },
  francese: { code: 'fr', labelIt: 'Francese', labelEn: 'French' },
  french: { code: 'fr', labelIt: 'Francese', labelEn: 'French' },
  tedesco: { code: 'de', labelIt: 'Tedesco', labelEn: 'German' },
  german: { code: 'de', labelIt: 'Tedesco', labelEn: 'German' },
  deutsch: { code: 'de', labelIt: 'Tedesco', labelEn: 'German' },
  portoghese: { code: 'pt', labelIt: 'Portoghese', labelEn: 'Portuguese' },
  portuguese: { code: 'pt', labelIt: 'Portoghese', labelEn: 'Portuguese' },
  giapponese: { code: 'ja', labelIt: 'Giapponese', labelEn: 'Japanese' },
  japanese: { code: 'ja', labelIt: 'Giapponese', labelEn: 'Japanese' },
  cinese: { code: 'zh', labelIt: 'Cinese', labelEn: 'Chinese' },
  chinese: { code: 'zh', labelIt: 'Cinese', labelEn: 'Chinese' },
  mandarin: { code: 'zh', labelIt: 'Cinese', labelEn: 'Chinese' },
  coreano: { code: 'ko', labelIt: 'Coreano', labelEn: 'Korean' },
  korean: { code: 'ko', labelIt: 'Coreano', labelEn: 'Korean' },
  arabo: { code: 'ar', labelIt: 'Arabo', labelEn: 'Arabic' },
  arabic: { code: 'ar', labelIt: 'Arabo', labelEn: 'Arabic' },
  russo: { code: 'ru', labelIt: 'Russo', labelEn: 'Russian' },
  russian: { code: 'ru', labelIt: 'Russo', labelEn: 'Russian' },
  olandese: { code: 'nl', labelIt: 'Olandese', labelEn: 'Dutch' },
  dutch: { code: 'nl', labelIt: 'Olandese', labelEn: 'Dutch' },
  polacco: { code: 'pl', labelIt: 'Polacco', labelEn: 'Polish' },
  polish: { code: 'pl', labelIt: 'Polacco', labelEn: 'Polish' },
  greco: { code: 'el', labelIt: 'Greco', labelEn: 'Greek' },
  greek: { code: 'el', labelIt: 'Greco', labelEn: 'Greek' },
  turco: { code: 'tr', labelIt: 'Turco', labelEn: 'Turkish' },
  turkish: { code: 'tr', labelIt: 'Turco', labelEn: 'Turkish' },
  hindi: { code: 'hi', labelIt: 'Hindi', labelEn: 'Hindi' },
}

const ALIAS_RE = new RegExp(
  `\\b(${Object.keys(ENTRIES)
    .sort((a, b) => b.length - a.length)
    .map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|')})\\b`,
  'i',
)

export function foldLang(raw) {
  return String(raw || '')
    .normalize('NFKC')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * @param {string} rawName
 * @returns {{ code: string, name: string, labelIt: string, labelEn: string } | null}
 */
export function normalizeTargetLanguage(rawName) {
  const key = foldLang(rawName)
  if (!key) return null
  const hit = ENTRIES[key]
  if (hit) {
    return {
      code: hit.code,
      name: key,
      labelIt: hit.labelIt,
      labelEn: hit.labelEn,
    }
  }
  // Free-text language name (not artificially closed)
  if (/^[a-z]{2,40}(?:\s+[a-z]{2,40})?$/.test(key) && key.length >= 2) {
    const display = String(rawName || key).trim().slice(0, 40)
    return {
      code: key.slice(0, 16),
      name: key,
      labelIt: display,
      labelEn: display,
    }
  }
  return null
}

/**
 * Extract first language mention from folded text.
 * @param {string} folded
 */
export function extractLanguageMention(folded) {
  const m = folded.match(ALIAS_RE)
  if (!m) return null
  return normalizeTargetLanguage(m[1])
}

export function languageChipLabel(target, sourceCode, replyLang = 'it') {
  const tgt =
    replyLang === 'en'
      ? target?.labelEn || target?.name || '?'
      : target?.labelIt || target?.name || '?'
  const srcMap = {
    it: replyLang === 'en' ? 'IT' : 'IT',
    en: 'EN',
    es: 'ES',
    fr: 'FR',
    de: 'DE',
    pt: 'PT',
    ja: 'JA',
    zh: 'ZH',
    ko: 'KO',
    ar: 'AR',
    ru: 'RU',
    auto: '…',
  }
  const src = srcMap[sourceCode] || (sourceCode || '…').toUpperCase().slice(0, 4)
  const tgtCode = (target?.code || '?').toUpperCase().slice(0, 4)
  return `${src} → ${tgtCode}`
}

export { ALIAS_RE, ENTRIES as LANGUAGE_ENTRIES }
