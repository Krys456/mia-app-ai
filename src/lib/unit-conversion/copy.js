/**
 * #319 — Unit Conversion copy (IT/EN).
 */

export function unitConversionCopy(key, lang, vars = {}) {
  const it = {
    ok: `${vars.displayInput || ''} = ${vars.displayResult || ''}`.trim(),
    incompatible: 'Non posso convertire unità di grandezze diverse.',
    power_energy:
      'Non posso convertire direttamente kW in kWh: kW misura la potenza, mentre kWh misura l’energia. Serve anche una durata.',
    power_energy_generic:
      'Non posso convertire potenza in energia (o viceversa) senza una durata. Specifica le ore/minuti, oppure scegli unità della stessa grandezza.',
    absolute_zero: 'Valore sotto lo zero assoluto: conversione non valida.',
    unknown_unit: 'Non riconosco una delle unità. Usa un’unità supportata (es. km, mi, kg, °C).',
    malformed: 'Non riesco a interpretare quella conversione.',
    invalid_number: 'Numero non valido.',
    overflow: 'Valore troppo grande per una conversione sicura.',
    too_long: 'Richiesta troppo lunga.',
    ambiguous_storage:
      '“Giga/mega” è ambiguo: indica GB/MB (decimale, 1000) oppure GiB/MiB (binario, 1024).',
    no_context: 'Non ho una conversione recente su cui basarmi. Scrivi la conversione completa (es. 10 km in miglia).',
    copy_ok: 'Risultato copiato negli appunti.',
    copy_fail: 'Non sono riuscito a copiare il risultato.',
    copy_need_context: 'Non ho un risultato di conversione recente da copiare.',
    security: 'Richiesta non consentita.',
    unsupported: 'Questa conversione non è ancora supportata in modo deterministico.',
  }
  const en = {
    ok: `${vars.displayInput || ''} = ${vars.displayResult || ''}`.trim(),
    incompatible: 'I can’t convert between different physical dimensions.',
    power_energy:
      'I can’t convert kW directly to kWh: kW is power, kWh is energy. You also need a duration.',
    power_energy_generic:
      'I can’t convert power to energy (or vice versa) without a duration. Add hours/minutes, or pick same-dimension units.',
    absolute_zero: 'Value is below absolute zero — conversion rejected.',
    unknown_unit: 'I don’t recognize one of those units. Use a supported unit (e.g. km, mi, kg, °C).',
    malformed: "I can't parse that conversion.",
    invalid_number: 'Invalid number.',
    overflow: 'Value is too large for a safe conversion.',
    too_long: 'Request is too long.',
    ambiguous_storage:
      '“Giga/mega” is ambiguous: say GB/MB (decimal, 1000) or GiB/MiB (binary, 1024).',
    no_context: 'I don’t have a recent conversion to build on. Send the full conversion (e.g. 10 km to miles).',
    copy_ok: 'Result copied to the clipboard.',
    copy_fail: "Couldn't copy the result.",
    copy_need_context: 'I don’t have a recent conversion result to copy.',
    security: 'That request is not allowed.',
    unsupported: 'That conversion is not supported deterministically yet.',
  }
  const table = lang === 'en' ? en : it
  return table[key] || table.malformed
}

export function unitErrorToCopyKey(code) {
  const map = {
    incompatible_dimensions: 'incompatible',
    power_vs_energy: 'power_energy',
    below_absolute_zero: 'absolute_zero',
    unknown_unit: 'unknown_unit',
    malformed_conversion: 'malformed',
    invalid_number: 'invalid_number',
    overflow: 'overflow',
    input_too_long: 'too_long',
    ambiguous_storage: 'ambiguous_storage',
    no_context: 'no_context',
    security_rejected: 'security',
    unsupported: 'unsupported',
    empty_conversion: 'malformed',
  }
  return map[code] || 'malformed'
}
