/** #319 — Unit Conversion barrel. */
export {
  detectUnitConversionIntent,
  detectUnitFollowUp,
  detectUnitConversionLanguage,
  looksQuotedOrInjectedUnit,
  parseConversionPair,
  parseValueUnit,
} from './unit-conversion/intent.js'
export {
  createConversionContext,
  loadConversionContext,
  saveConversionContext,
  clearConversionContext,
  isConversionContextFresh,
  CONV_CONTEXT_TTL_MS,
} from './unit-conversion/active-context.js'
export { applyUnitConversionIntent } from './unit-conversion/controller.js'
export { unitConversionCopy, unitErrorToCopyKey } from './unit-conversion/copy.js'
export {
  UNIT_CONVERSION_DIAG_BUILD,
  isUnitConversionDiagEnabled,
  buildUnitConversionDiag,
  rememberUnitConversionDiag,
  logUnitConversionSafe,
} from './unit-conversion/diag.js'
export { convertUnits, convertTemperature, convertLinear } from './unit-conversion/convert.js'
export {
  resolveUnit,
  getUnitById,
  listUnits,
  matchUnitAtStart,
} from './unit-conversion/registry.js'
export { formatConversionNumber, formatQuantity } from './unit-conversion/format.js'
export { UNIT_LIMITS, UNIT_ERROR } from './unit-conversion/limits.js'
