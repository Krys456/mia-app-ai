/** #318 — Calculator / Math Engine barrel. */
export {
  detectCalculatorIntent,
  detectCalcFollowUp,
  detectCalculatorLanguage,
  looksQuotedOrInjectedCalc,
} from './calculator/intent.js'
export {
  createCalculationContext,
  loadCalculationContext,
  saveCalculationContext,
  clearCalculationContext,
  isCalculationContextFresh,
  CALC_CONTEXT_TTL_MS,
} from './calculator/active-context.js'
export {
  applyCalculatorIntent,
  buildCalculationContextBlock,
} from './calculator/controller.js'
export { calculatorCopy, errorCodeToCopyKey } from './calculator/copy.js'
export {
  CALCULATOR_DIAG_BUILD,
  isCalculatorDiagEnabled,
  buildCalculatorDiag,
  rememberCalculatorDiag,
  logCalculatorSafe,
} from './calculator/diag.js'
export {
  evaluateExpression,
  evaluateTokens,
  tokenize,
  normalizeMathText,
  stripCalcCue,
} from './calculator/parser.js'
export { tryPercentageTemplate, parseNumberish } from './calculator/percent.js'
export { formatDisplayResult, sanitizeNumber, roundToDecimals } from './calculator/format.js'
export { CALC_LIMITS, CALC_ERROR } from './calculator/limits.js'
