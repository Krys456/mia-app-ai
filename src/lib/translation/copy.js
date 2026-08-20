/**
 * #322 — Translation copy / error strings (IT/EN).
 */

export function translationCopy(key, lang, vars = {}) {
  const it = {
    missing_text:
      'Dimmi cosa vuoi tradurre (testo tra virgolette, dopo i due punti, o riferisciti al messaggio precedente).',
    missing_target_language: 'In quale lingua vuoi la traduzione?',
    context_missing: 'Non ho un testo recente da tradurre. Incollalo o scrivilo tra virgolette.',
    context_ambiguous: 'Quale testo vuoi tradurre: il tuo messaggio precedente o la mia ultima risposta?',
    too_long:
      'Questo testo è troppo lungo per la traduzione rapida. Per documenti lunghi useremo la modalità Document Translation.',
    provider_error: 'Non riesco a completare la traduzione in questo momento. Riprova tra poco.',
    offline: 'Sembra che non ci sia connessione. Riprova quando sei online.',
    rate_limited: 'Troppe richieste di traduzione. Attendi un momento e riprova.',
    invalid_request: 'Richiesta di traduzione non valida.',
    pronunciation_deferred: 'La pronuncia guidata arriverà in un aggiornamento successivo.',
    copy_ok: 'Traduzione copiata negli appunti.',
    copy_fail: 'Non sono riuscito a copiare la traduzione.',
    copy_need_context: 'Non ho una traduzione recente da copiare.',
  }
  const en = {
    missing_text:
      'Tell me what to translate (quoted text, after a colon, or refer to the previous message).',
    missing_target_language: 'Which language should I translate into?',
    context_missing: 'I don’t have recent text to translate. Paste it or put it in quotes.',
    context_ambiguous: 'Which text should I translate: your previous message or my last reply?',
    too_long:
      'This text is too long for quick translation. For long documents we’ll use Document Translation mode.',
    provider_error: 'I can’t complete the translation right now. Try again shortly.',
    offline: 'It looks like you’re offline. Try again when you’re connected.',
    rate_limited: 'Too many translation requests. Wait a moment and try again.',
    invalid_request: 'Invalid translation request.',
    pronunciation_deferred: 'Guided pronunciation will come in a later update.',
    copy_ok: 'Translation copied to the clipboard.',
    copy_fail: 'I couldn’t copy the translation.',
    copy_need_context: 'I don’t have a recent translation to copy.',
  }
  const table = lang === 'en' ? en : it
  return table[key] || table.provider_error
}

/**
 * Strip model chatter wrappers from translation output.
 * @param {string} raw
 */
export function sanitizeTranslatedOutput(raw) {
  let t = String(raw || '').trim()
  if (!t) return ''
  // Drop common preambles
  t = t.replace(/^(certainly[!.,]?\s*|sure[!.,]?\s*|of course[!.,]?\s*|certo[!.,]?\s*|ecco[!.,]?\s*)/i, '')
  t = t.replace(/^(here(?:'s| is)\s+(the\s+)?translation\s*:?\s*)/i, '')
  t = t.replace(/^(the\s+)?translation\s*(:|is\s*:?)\s*/i, '')
  t = t.replace(/^(la\s+traduzione\s*(:|(è|e)\s*:?)\s*)/i, '')
  t = t.replace(/^(translation\s*:?\s*)/i, '')
  t = t.replace(/^(traduzione\s*:?\s*)/i, '')
  // Strip wrapping fences / quotes if the whole answer is one quoted block
  if (/^```[\s\S]*```$/.test(t)) {
    t = t.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '').trim()
  }
  if (
    (t.startsWith('"') && t.endsWith('"') && t.length > 2) ||
    (t.startsWith('«') && t.endsWith('»') && t.length > 2)
  ) {
    // Only unwrap if single-line short-ish
    if (!t.slice(1, -1).includes('\n') && t.length < 280) {
      t = t.slice(1, -1).trim()
    }
  }
  return t.trim()
}
