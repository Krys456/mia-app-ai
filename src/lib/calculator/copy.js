/**
 * #318 — Calculator copy (IT/EN).
 */

export function calculatorCopy(key, lang, vars = {}) {
  const it = {
    div_zero: 'Non è possibile dividere per zero.',
    domain: 'Operazione non valida nel dominio dei numeri reali (es. radice di un negativo).',
    malformed: 'Non riesco a interpretare quell’espressione.',
    invalid_char: 'L’espressione contiene caratteri non supportati.',
    security: 'Espressione non consentita.',
    too_long: 'Espressione troppo lunga.',
    too_many_tokens: 'Espressione troppo complessa.',
    depth: 'Troppe parentesi o annidamenti.',
    paren: 'Parentesi non bilanciate.',
    overflow: 'Risultato troppo grande o non rappresentabile.',
    exponent: 'Esponente troppo grande.',
    empty: 'Manca un’espressione da calcolare.',
    unsupported: 'Questo tipo di calcolo non è ancora supportato in modo deterministico.',
    copy_ok: 'Risultato copiato negli appunti.',
    copy_fail: 'Non sono riuscito a copiare il risultato.',
    copy_need_context: 'Non ho un risultato di calcolo recente da copiare.',
    no_context_followup: 'Non ho un risultato precedente su cui applicare l’operazione. Dimmi pure l’espressione completa.',
    explain_header: 'Passaggi:',
    result_line: `${vars.expression || ''} = ${vars.result || ''}`.trim(),
  }
  const en = {
    div_zero: 'Cannot divide by zero.',
    domain: 'Operation invalid over the real numbers (e.g. square root of a negative).',
    malformed: "I can't parse that expression.",
    invalid_char: 'The expression contains unsupported characters.',
    security: 'That expression is not allowed.',
    too_long: 'Expression is too long.',
    too_many_tokens: 'Expression is too complex.',
    depth: 'Too much nesting or parentheses.',
    paren: 'Unbalanced parentheses.',
    overflow: 'Result is too large or not representable.',
    exponent: 'Exponent is too large.',
    empty: 'Missing an expression to calculate.',
    unsupported: 'That kind of calculation is not supported deterministically yet.',
    copy_ok: 'Result copied to the clipboard.',
    copy_fail: "Couldn't copy the result.",
    copy_need_context: 'I don’t have a recent calculation result to copy.',
    no_context_followup:
      "I don’t have a previous result to apply that to. Send the full expression.",
    explain_header: 'Steps:',
    result_line: `${vars.expression || ''} = ${vars.result || ''}`.trim(),
  }
  const table = lang === 'en' ? en : it
  return table[key] || table.malformed
}

export function errorCodeToCopyKey(code) {
  const map = {
    divide_by_zero: 'div_zero',
    domain_error: 'domain',
    malformed_expression: 'malformed',
    malformed_parentheses: 'paren',
    invalid_characters: 'invalid_char',
    security_rejected: 'security',
    expression_too_long: 'too_long',
    too_many_tokens: 'too_many_tokens',
    excessive_nesting: 'depth',
    overflow: 'overflow',
    exponent_too_large: 'exponent',
    empty_expression: 'empty',
    unsupported: 'unsupported',
  }
  return map[code] || 'malformed'
}
