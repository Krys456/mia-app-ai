/** #320 — Energy Math barrel. */
export {
  detectEnergyMathIntent,
  detectEnergyMathFollowUp,
  detectEnergyMathLanguage,
  looksQuotedOrInjectedEnergy,
  extractEnergyQuantities,
  parseEnergyMathComposition,
  classifyEnergyMathComposition,
  looksEnergyMathShaped,
} from './energy-math/intent.js'
export {
  createEnergyMathContext,
  loadEnergyMathContext,
  saveEnergyMathContext,
  clearEnergyMathContext,
  isEnergyMathContextFresh,
  ENERGY_MATH_CONTEXT_TTL_MS,
} from './energy-math/active-context.js'
export {
  applyEnergyMathIntent,
  buildEnergyMathContextBlock,
} from './energy-math/controller.js'
export { energyMathCopy, energyErrorToCopyKey } from './energy-math/copy.js'
export {
  ENERGY_MATH_DIAG_BUILD,
  isEnergyMathDiagEnabled,
  buildEnergyMathDiag,
  rememberEnergyMathDiag,
  logEnergyMathSafe,
} from './energy-math/diag.js'
export {
  computeEnergyFromPowerTime,
  computePowerFromEnergyTime,
  computeTimeFromEnergyPower,
} from './energy-math/engine.js'
export { makeQuantity, toCanonical, preferDisplayQuantity } from './energy-math/quantity.js'
export { ENERGY_MATH_LIMITS, ENERGY_MATH_ERROR } from './energy-math/limits.js'
