/**
 * #320 — Energy Math copy (IT/EN).
 */

export function energyMathCopy(key, lang, vars = {}) {
  const it = {
    ok: vars.line || '',
    ok_with_assumption: vars.assumption
      ? `${vars.line || ''}\n\n${vars.assumption}`
      : vars.line || '',
    explain_header: 'Calcolo:',
    assumption_constant:
      'Calcolo ideale assumendo potenza costante per tutta la durata.',
    assumption_appliance:
      'Calcolo ideale: si assume che il carico resti costante per tutta la durata indicata.',
    assumption_pv:
      'Calcolo teorico se quella potenza fosse mantenuta costantemente per tutta la durata. Non è una stima reale di produzione fotovoltaica (irraggiamento, orientamento, perdite, meteo, ecc. non sono considerati).',
    assumption_runtime:
      vars.runtimeDetail ||
      'Matematicamente, runtime ideale assumendo tutta l’energia utilizzabile e un carico costante.',
    incompatible: 'Non posso combinare quelle grandezze in un calcolo energetico deterministico.',
    missing: 'Mancano potenza, energia o durata necessarie per il calcolo.',
    malformed: 'Non riesco a interpretare quel calcolo energetico.',
    negative: 'Valori negativi non sono ammessi per questo calcolo.',
    divide_zero: 'Divisione per zero: durata o potenza non valida.',
    zero_time: 'La durata non può essere zero per calcolare la potenza media.',
    zero_power: 'La potenza non può essere zero per calcolare la durata.',
    overflow: 'Valore troppo grande per un calcolo sicuro.',
    too_long: 'Richiesta troppo lunga.',
    no_context: 'Non ho un calcolo energetico recente. Scrivi la richiesta completa (es. 2 kW per 3 ore).',
    copy_ok: 'Risultato copiato negli appunti.',
    copy_fail: 'Non sono riuscito a copiare il risultato.',
    copy_need_context: 'Non ho un risultato energetico recente da copiare.',
    unsupported: 'Questo tipo di calcolo energetico non è ancora supportato in modo deterministico.',
    retarget_mismatch: 'Non posso esprimere quel risultato in quell’unità (dimensione diversa).',
  }
  const en = {
    ok: vars.line || '',
    ok_with_assumption: vars.assumption
      ? `${vars.line || ''}\n\n${vars.assumption}`
      : vars.line || '',
    explain_header: 'Calculation:',
    assumption_constant: 'Ideal calculation assuming constant power for the full duration.',
    assumption_appliance:
      'Ideal calculation: assumes the load stays constant for the stated duration.',
    assumption_pv:
      'Theoretical energy if that power were held constant for the full duration. Not a real PV yield estimate (irradiance, orientation, losses, weather, etc. are not included).',
    assumption_runtime:
      vars.runtimeDetail ||
      'Ideal mathematical runtime assuming fully usable energy and a constant load.',
    incompatible: 'I can’t combine those quantities into a deterministic energy calculation.',
    missing: 'Missing power, energy, or duration needed for the calculation.',
    malformed: "I can't parse that energy calculation.",
    negative: 'Negative values are not allowed for this calculation.',
    divide_zero: 'Division by zero: invalid duration or power.',
    zero_time: 'Duration can’t be zero when computing average power.',
    zero_power: 'Power can’t be zero when computing runtime.',
    overflow: 'Value is too large for a safe calculation.',
    too_long: 'Request is too long.',
    no_context: 'I don’t have a recent energy calculation. Send the full request (e.g. 2 kW for 3 hours).',
    copy_ok: 'Result copied to the clipboard.',
    copy_fail: "Couldn't copy the result.",
    copy_need_context: 'I don’t have a recent energy result to copy.',
    unsupported: 'That energy calculation isn’t supported deterministically yet.',
    retarget_mismatch: 'I can’t express that result in that unit (different dimension).',
  }
  const table = lang === 'en' ? en : it
  return table[key] || table.malformed
}

export function energyErrorToCopyKey(code) {
  const map = {
    incompatible_dimensions: 'incompatible',
    missing_quantity: 'missing',
    malformed_energy_math: 'malformed',
    negative_value: 'negative',
    divide_by_zero: 'divide_zero',
    zero_time: 'zero_time',
    zero_power: 'zero_power',
    overflow: 'overflow',
    input_too_long: 'too_long',
    no_context: 'no_context',
    unsupported: 'unsupported',
    empty_energy_math: 'malformed',
  }
  return map[code] || 'malformed'
}

/**
 * Build assumption sentence for a result.
 */
export function buildAssumptionText(mode, lang, vars = {}) {
  if (mode === 'ideal_constant_power_pv_math') {
    return energyMathCopy('assumption_pv', lang)
  }
  if (mode === 'ideal_runtime') {
    const detail =
      lang === 'en'
        ? `Mathematically about ${vars.displayResult || 'this duration'}, assuming ${vars.energyLabel || 'the stated energy'} is fully usable and a constant load of ${vars.powerLabel || 'the stated power'}.`
        : `Matematicamente, circa ${vars.displayResult || 'questa durata'} assumendo ${vars.energyLabel || 'l’energia indicata'} completamente utilizzabile e un carico costante di ${vars.powerLabel || 'la potenza indicata'}.`
    return energyMathCopy('assumption_runtime', lang, { runtimeDetail: detail })
  }
  if (mode === 'constant_load') {
    return energyMathCopy('assumption_appliance', lang)
  }
  return energyMathCopy('assumption_constant', lang)
}
