/**
 * #313 — Detect whether a text follow-up refers to the active document.
 */

/**
 * @param {unknown} text
 */
function normalize(text) {
  return String(text || '')
    .normalize('NFKC')
    .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035`]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
}

/**
 * Explicitly unrelated to the document (weather, calendar-ish, new topic).
 * @param {string} ascii
 */
function looksUnrelated(ascii) {
  if (
    /\b(che\s+tempo|weather|forecast|meteo|piove|temperature)\b/.test(ascii) ||
    /\b(cos['']?ho\s+domani|calendario|appuntament|reminder|promemoria)\b/.test(ascii) ||
    /\b(ultime\s+notizie|news\s+di\s+oggi|stock\s+market)\b/.test(ascii)
  ) {
    // Allow if also clearly about the document
    if (/\b(documento|pdf|file|testo|tabella|paragrafo|pagina|conclusione)\b/.test(ascii)) {
      return false
    }
    return true
  }
  return false
}

/**
 * @param {string} ascii
 */
function looksDocumentReferent(ascii) {
  if (!ascii) return false

  if (
    /\b(questo\s+documento|il\s+pdf|il\s+file|questo\s+file|questo\s+testo|quello\s+che\s+ti\s+ho\s+mandato|nel\s+documento|del\s+documento|sul\s+documento)\b/.test(
      ascii,
    )
  ) {
    return true
  }
  if (
    /\b(this\s+document|the\s+pdf|the\s+file|this\s+file|this\s+text|in\s+the\s+document|about\s+the\s+document)\b/.test(
      ascii,
    )
  ) {
    return true
  }

  if (
    /\b(approfondisci|continua|spiegamelo|spiegamela|riassumilo|riassumila|traduci|fammi\s+(\d+\s+)?(delle\s+)?domande|domande\s+per\s+studiare|qual\s+[eè]\s+la\s+conclusione|secondo\s+punto|terzo\s+punto|parte\s+finale|quella\s+tabella|nella\s+conclusione|nel\s+secondo|dove\s+parla|pagina\s+\d+|paragrafo)\b/.test(
      ascii,
    )
  ) {
    return true
  }

  if (
    /\b(go\s+deeper|tell\s+me\s+more|explain\s+(it|this)\s+better|summarize\s+(it|this)|make\s+(me\s+)?(some\s+)?questions|what\s+is\s+the\s+conclusion|second\s+point|final\s+part|that\s+table|where\s+does\s+it\s+(talk|mention)|page\s+\d+)\b/.test(
      ascii,
    )
  ) {
    return true
  }

  // Short deixis after a document turn
  if (
    /^(approfondisci|continua|spiegamelo|spiegamela|riassumilo|ok\s+e\s+poi|e\s+poi|dimmi\s+di\s+piu|tell\s+me\s+more|go\s+on)[.!?]*$/.test(
      ascii,
    )
  ) {
    return true
  }

  // "su questo" / "di questo" study tasks
  if (/\b(su\s+questo|di\s+questo|about\s+this|from\s+this)\b/.test(ascii) && ascii.length < 120) {
    return true
  }

  return false
}

/**
 * @param {unknown} text
 * @param {{ hasActiveDocument?: boolean }} [opts]
 * @returns {{
 *   refersToDocument: boolean
 *   unrelated: boolean
 *   shouldReuseDocument: boolean
 *   kind: 'document_followup' | 'unrelated' | 'none'
 * }}
 */
export function detectDocumentReferenceIntent(text, opts = {}) {
  const hasDoc = opts.hasActiveDocument === true
  const ascii = normalize(text)

  if (!hasDoc) {
    return {
      refersToDocument: false,
      unrelated: false,
      shouldReuseDocument: false,
      kind: 'none',
    }
  }

  if (!ascii) {
    // Empty caption with no new file is handled elsewhere; empty text follow-up alone is rare.
    return {
      refersToDocument: false,
      unrelated: false,
      shouldReuseDocument: false,
      kind: 'none',
    }
  }

  if (looksUnrelated(ascii)) {
    return {
      refersToDocument: false,
      unrelated: true,
      shouldReuseDocument: false,
      kind: 'unrelated',
    }
  }

  if (looksDocumentReferent(ascii)) {
    return {
      refersToDocument: true,
      unrelated: false,
      shouldReuseDocument: true,
      kind: 'document_followup',
    }
  }

  return {
    refersToDocument: false,
    unrelated: false,
    shouldReuseDocument: false,
    kind: 'none',
  }
}
