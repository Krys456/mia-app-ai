/**
 * #313 — Ephemeral model guidance when a document is attached or reused.
 * Never shown as user-visible system dump in the UI.
 */

/**
 * @param {{
 *   filename?: string
 *   reused?: boolean
 *   uncertainPages?: boolean
 * }} [input]
 */
export function buildDocumentChatAppendix(input = {}) {
  const name = String(input.filename || 'document').slice(0, 80)
  const lines = [
    'DOCUMENT CHAT (reuse existing OpenAI file_id / input_file — do not invent file contents):',
    `- Active document filename (metadata only): ${name}`,
    input.reused
      ? '- This turn reuses the active document file_id from earlier in the conversation.'
      : '- This turn includes a document file_id attachment.',
    'Rules:',
    '- Ground answers in the attached document content when relevant.',
    '- Distinguish clearly: (1) what the document says, (2) general knowledge, (3) what is uncertain.',
    '- Do not fabricate page numbers, section titles, or quotes that are not supported.',
    '- If the user asks for an exact page and page structure is unclear, say precise page grounding may be limited — do not invent pages.',
    '- If a detail cannot be found in the document, say so.',
    '- If the PDF appears scanned/image-only and content cannot be read reliably, suggest photographing a page and using Vision AI — do not invent OCR.',
    '- Never request or log raw document bytes.',
  ]
  return lines.join('\n')
}

/**
 * Localized empty-document default caption (server/model nudge).
 * Spec #313 §9.
 * @param {'it'|'en'|string} lang
 */
export function documentEmptyPromptForLang(lang) {
  if (lang === 'en') {
    return 'Analyze this document and briefly explain what it is about.'
  }
  if (lang === 'es') {
    return 'Analiza este documento y explícalo brevemente.'
  }
  if (lang === 'fr') {
    return 'Analyse ce document et explique brièvement de quoi il parle.'
  }
  if (lang === 'de') {
    return 'Analysiere dieses Dokument und erkläre kurz, worum es geht.'
  }
  return 'Analizza questo documento e dimmi in breve di cosa tratta.'
}

/**
 * User-facing expiry guidance (no provider internals).
 * @param {'it'|'en'|string} lang
 */
export function documentExpiredUserMessage(lang) {
  if (lang === 'en') {
    return 'This document is no longer available in the session. Please upload it again and we can continue where we left off.'
  }
  return 'Questo documento non è più disponibile nella sessione. Ricaricalo e possiamo continuare da dove eravamo rimasti.'
}
