/**
 * #320 — Safety limits for deterministic Energy Math.
 */

export const ENERGY_MATH_LIMITS = Object.freeze({
  maxRawLength: 280,
  maxValueAbs: 1e15,
  maxResultAbs: 1e18,
  displayMaxDecimals: 4,
})

export const ENERGY_MATH_ERROR = Object.freeze({
  empty: 'empty_energy_math',
  too_long: 'input_too_long',
  malformed: 'malformed_energy_math',
  invalid_number: 'invalid_number',
  unknown_unit: 'unknown_unit',
  incompatible: 'incompatible_dimensions',
  missing_quantity: 'missing_quantity',
  overflow: 'overflow',
  divide_zero: 'divide_by_zero',
  negative: 'negative_value',
  zero_time: 'zero_time',
  zero_power: 'zero_power',
  no_context: 'no_context',
  security: 'security_rejected',
  unsupported: 'unsupported',
})
